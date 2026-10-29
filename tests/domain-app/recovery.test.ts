/**
 * T10 — recovery/restart negative fixtures. Partial and interrupted states
 * must speak the honest non-completion vocabulary and can never be laundered
 * into success: truncated bytes fail the digest anchor, pending envelopes
 * carry no outcome, restart evidence describes exactly the durable bytes,
 * late facts never rewrite terminal truth, and only the explicit retry/resume
 * control transition may reopen a terminal lineage (L2 §11.1).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { BoundedHttpFixture } from './helpers/fixture-server.ts';
import {
  FIXED_STAMP,
  contractIdOf,
  memberIdOf,
  payload,
  sha256,
  snapshotIdOf,
} from './helpers/fixtures.ts';
import {
  acceptedEnvelope,
  checkDigest,
  declaredVsDurable,
  materializeEvidence,
  readUntilInterrupted,
  removeTempRoot,
  runningEnvelope,
  tempOutputRoot,
  writePartialArtifact,
  HONEST_STOP_REASONS,
} from './helpers/recovery.ts';
import {
  buildTerminalResult,
  createTerminalResultStore,
  normalizeEffectEnvelope,
  projectResult,
  validateMaterializedEvidence,
  validateTerminalResult,
  type ProjectionFacts,
} from './helpers/contracts.ts';

const FULL = payload(1024);
const MEMBER = 'member-t10-001';
const SNAPSHOT = 'snapshot-t10-recovery-001';
const CONTRACT = contractIdOf('contract-t10-recovery-001');

let fixture: BoundedHttpFixture;
let outputRoot: string;

before(async () => {
  fixture = new BoundedHttpFixture();
  await fixture.start();
  outputRoot = tempOutputRoot('recovery');
});

after(() => {
  removeTempRoot(outputRoot);
  return fixture.stop();
});

describe('T10 truncated transfer — honest partial truth, never fake completion', () => {
  it('a declared-but-undelivered body yields observable partial bytes and a digest mismatch', async () => {
    fixture.serveTruncated('/rec-truncated.bin', {
      body: FULL.subarray(0, 397),
      declaredLength: FULL.byteLength,
    });
    const read = await readUntilInterrupted(fixture.uri('/rec-truncated.bin'), 2000);
    assert.equal(read.completed, false);
    assert.equal(read.interruptedBy, 'premature-eof');
    assert.equal(read.bytes.byteLength, 397);

    const digestCheck = checkDigest(read.bytes, sha256(FULL));
    assert.equal(digestCheck.matches, false);

    const artifact = {
      artifactPath: `${outputRoot}/rec-truncated.bin`,
      bytesOnDisk: read.bytes,
      declaredBytes: FULL.byteLength,
      sha256OnDisk: digestCheck.actualSha256,
      durableFileBytes: read.bytes.byteLength,
    };
    const durable = declaredVsDurable(artifact);
    assert.equal(durable.agrees, true);
    const evidence = materializeEvidence(artifact, HONEST_STOP_REASONS.truncated);
    assert.deepEqual(validateMaterializedEvidence(evidence, outputRoot).ok, true);
    assert.equal(evidence.bytesWritten, 397);
    assert.equal(evidence.stopReason, 'TRUNCATED');
  });

  it('the honest facts project UNSATISFIED/FAILED — and never COMPLETE', () => {
    const partialBytes = FULL.subarray(0, 397);
    assert.equal(checkDigest(partialBytes, sha256(FULL)).matches, false);
    const projected = projectResult({
      ...singleResourceFacts(),
      acceptedSelectedMemberIds: [],
      memberValidation: [{ memberId: memberIdOf(MEMBER), result: 'VALIDATION_FAILED' }],
    });
    assert.ok(projected.ok);
    const result = projected.value.result;
    assert.equal(result.requestFulfillment, 'UNSATISFIED');
    assert.equal(result.targetResolution, 'RESOLVED');
    assert.equal(result.selectionAcquisition, 'FAILED');
    assert.equal(result.coverage, 'NOT_APPLICABLE');
    assert.equal(result.stopReason, 'VALIDATION_FAILED');
    assert.deepEqual(result.validationSummary, {
      status: 'FAILED',
      passedCount: 0,
      failedCount: 1,
    });
  });

  it('budget exhaustion is never reinterpreted as completion (C02/PRD-§15.4)', () => {
    const fake = buildTerminalResult({
      contractId: CONTRACT,
      snapshotId: snapshotIdOf(SNAPSHOT),
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'NOT_APPLICABLE',
      stopReason: 'TRANSFER_BUDGET_EXHAUSTED',
      validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
      recordedAt: FIXED_STAMP,
    });
    assert.ok(fake.ok, 'the fake must decode — the refusal lives in the legal-combination gate');
    const refusal = validateTerminalResult(fake.value, {
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      selectedMemberCount: 1,
      selectedValidationOutcomes: [
        { memberId: memberIdOf(MEMBER), requiredValidationPassed: true },
      ],
    });
    assert.equal(refusal.ok, false);
    assert.ok(
      refusal.diagnostics.some(
        (item) =>
          item.code === 'INVALID_RESULT_COMBINATION' && (item.invariant ?? '').includes('C02'),
      ),
      JSON.stringify(refusal.diagnostics, null, 2),
    );
  });
});

describe('T10 stalled effect — pending envelopes never settle, fake terminals are refused', () => {
  it('a stalled response delivers nothing and only ends by external interruption', async () => {
    const stalled = fixture.serveStall('/rec-stalled.bin', { declaredLength: FULL.byteLength });
    const read = await readUntilInterrupted(fixture.uri('/rec-stalled.bin'), 100);
    assert.equal(read.completed, false);
    assert.equal(read.interruptedBy, 'client-timeout');
    assert.equal(read.bytes.byteLength, 0);
    stalled.release();
    assert.equal(stalled.settled, true);
  });

  it('accepted/running envelopes structurally carry no outcome and are not terminal', () => {
    const accepted = normalizeEffectEnvelope(acceptedEnvelope('ext-accepted-001'));
    assert.ok(accepted.ok);
    assert.equal(accepted.value.phase, 'accepted');
    assert.equal('outcome' in accepted.value, false);

    const running = normalizeEffectEnvelope(runningEnvelope('ext-running-001'));
    assert.ok(running.ok);
    assert.equal(running.value.phase, 'running');
    assert.equal('outcome' in running.value, false);
  });

  it('fake terminal envelopes are refused: no outcome, non-object outcome, untyped outcome.ok', () => {
    const noOutcome = normalizeEffectEnvelope({ phase: 'terminal', externalRef: 'ext-001' });
    assert.equal(noOutcome.ok, false);

    const nonObjectOutcome = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ext-001',
      outcome: 'success-by-fiat',
    });
    assert.equal(nonObjectOutcome.ok, false);

    const untypedOk = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ext-001',
      outcome: { ok: 'definitely' },
    });
    assert.equal(untypedOk.ok, false);

    const okWithoutOutput = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ext-001',
      outcome: { ok: true },
    });
    assert.equal(okWithoutOutput.ok, false);

    const failedWithoutTypedError = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ext-001',
      outcome: { ok: false },
    });
    assert.equal(failedWithoutTypedError.ok, false);
  });
});

describe('T10 restart lineage — durable truth, cutoff discipline, explicit resume only', () => {
  it('partial restart artifact: honest evidence names the interruption, not completion', () => {
    const artifact = writePartialArtifact(outputRoot, 'rec-restart.bin', FULL, 512);
    assert.equal(declaredVsDurable(artifact).agrees, true);
    const evidence = materializeEvidence(artifact, HONEST_STOP_REASONS.interrupted);
    assert.deepEqual(validateMaterializedEvidence(evidence, outputRoot).ok, true);
    assert.equal(evidence.fileSha256, sha256(FULL.subarray(0, 512)));
    assert.notEqual(evidence.fileSha256, sha256(FULL));
    assert.equal(evidence.bytesWritten, 512);
    assert.equal(evidence.stopReason, 'INTERRUPTED');
  });

  it('unproven restart state projects NOT_PERFORMED/UNKNOWN — no silent optimism', () => {
    const projected = projectResult({
      ...singleResourceFacts(),
      acceptedSelectedMemberIds: [],
      memberValidation: [{ memberId: memberIdOf(MEMBER), result: 'NOT_VALIDATED' }],
    });
    assert.ok(projected.ok);
    const result = projected.value.result;
    assert.equal(result.requestFulfillment, 'UNKNOWN');
    assert.equal(result.selectionAcquisition, 'NOT_STARTED');
    assert.deepEqual(result.validationSummary, {
      status: 'NOT_PERFORMED',
      passedCount: 0,
      failedCount: 0,
    });
  });

  it('the terminal store keeps frozen truth: late facts never rewrite it; only explicit resume reopens', () => {
    const store = createTerminalResultStore();
    const partialFacts: ProjectionFacts = {
      ...singleResourceFacts(),
      acceptedSelectedMemberIds: [],
      memberValidation: [{ memberId: memberIdOf(MEMBER), result: 'NOT_VALIDATED' }],
    };
    const first = store.project(partialFacts);
    assert.ok(first.ok);
    assert.equal(first.value.result.requestFulfillment, 'UNKNOWN');

    const recoveredFacts: ProjectionFacts = {
      ...singleResourceFacts(),
      acceptedSelectedMemberIds: [memberIdOf(MEMBER)],
      memberValidation: [{ memberId: memberIdOf(MEMBER), result: 'VALIDATED' }],
    };
    const late = store.project(recoveredFacts);
    assert.ok(late.ok);
    assert.deepEqual(
      late.value.result,
      first.value.result,
      'late facts must never rewrite terminal truth',
    );
    assert.equal(
      store.terminalFor('contract-t10-recovery-001', SNAPSHOT)?.result.requestFulfillment,
      'UNKNOWN',
    );

    const resumed = store.project({ ...recoveredFacts, explicitRetryResume: true });
    assert.ok(resumed.ok);
    assert.equal(resumed.value.result.requestFulfillment, 'COMPLETE');
    assert.equal(resumed.value.result.selectionAcquisition, 'COMPLETE');
    assert.deepEqual(resumed.value.result.validationSummary, {
      status: 'ALL_PASSED',
      passedCount: 1,
      failedCount: 0,
    });
    assert.equal(
      store.terminalFor('contract-t10-recovery-001', SNAPSHOT)?.result.stopReason,
      'NONE',
    );
  });
});

function singleResourceFacts(): ProjectionFacts {
  return {
    contractId: CONTRACT,
    snapshotId: snapshotIdOf(SNAPSHOT),
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    recordedAt: FIXED_STAMP,
    requestedMemberIds: [memberIdOf(MEMBER)],
    acceptedSelectedMemberIds: [memberIdOf(MEMBER)],
    enumeration: { kind: 'NOT_APPLICABLE' },
    resolution: {
      s1Target: {
        memberId: memberIdOf(MEMBER),
        evidenceRef: `ev-target-${SNAPSHOT}`,
        status: 'RESOLVED',
        transferAttempted: true,
      },
    },
  };
}
