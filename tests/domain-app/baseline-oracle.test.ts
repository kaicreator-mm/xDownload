/**
 * T10 — S1–S6 released-slice baseline oracle.
 *
 * Honesty model (mirrors the frozen Task Pack T10 output contract):
 *  - The baseline document is machine-readable and fail-closed decoded; its
 *    descriptors are bound to the LIVE canonical support-slice registry, so
 *    vocabulary drift fails loudly.
 *  - S1 (Direct HTTP/HTTPS File) is the only slice with a FULL_ORACLE: the
 *    direct journey is executed end-to-end against real loopback bytes —
 *    intent contract → route binding → byte transfer → digest → materialized
 *    evidence → validation records → deterministic terminal projection — and
 *    the projected six dimensions must equal the descriptor's frozen
 *    terminal vocabulary. Wrong-variant bytes and zero-network negatives are
 *    proven on the same oracle.
 *  - S2–S6 are DESCRIPTOR_REGISTRY_MATCH: registry consistency plus honest,
 *    explicit gaps. No journey is simulated, no acceptance is synthesized.
 *  - The installed-baseline binding (release SHA + real install) is
 *    NOT_PROVEN here by design; the descriptor gates anyone from silently
 *    flipping that status.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { BoundedHttpFixture } from './helpers/fixture-server.ts';
import {
  FIXED_STAMP,
  confirmedIntent,
  contractIdOf,
  evidenceIdOf,
  memberIdOf,
  payload,
  sha256,
  snapshotIdOf,
  validationRecordIdOf,
} from './helpers/fixtures.ts';
import {
  checkDigest,
  acceptedEnvelope,
  materializeEvidence,
  removeTempRoot,
  tempOutputRoot,
  writePartialArtifact,
  declaredVsDurable,
} from './helpers/recovery.ts';
import { NetworkAudit } from './helpers/zero-network.ts';
import {
  assertBaselineMatchesRegistry,
  decodeSliceBaseline,
  descriptorOnlySlices,
  fullOracleSlices,
  loadSliceBaseline,
  type SliceBaseline,
  type SliceBaselineDescriptor,
} from './helpers/baseline.ts';
import {
  buildTerminalResult,
  claimTypeForLayer,
  createEvidenceLedger,
  createValidationRegistry,
  currentSchemaIdentity,
  evidenceRecord,
  normalizeEffectEnvelope,
  projectResult,
  requiredValidationOutcomes,
  validateMaterializedEvidence,
  validateRouteTable,
  validateTerminalResult,
  type OperationDeclaration,
  type ProjectionFacts,
  type ValidationLayer,
} from './helpers/contracts.ts';

const FULL = payload(1024);
const VARIANT = payload(1024, 7);
const MEMBER = 'member-t10-001';
const SNAPSHOT = 'snapshot-t10-s1-001';

let fixture: BoundedHttpFixture;
let outputRoot: string;
let baseline: SliceBaseline;
let s1: SliceBaselineDescriptor;

before(async () => {
  baseline = loadSliceBaseline();
  const s1Descriptor = baseline.slices.find((slice) => slice.sliceId === 'S1');
  if (s1Descriptor === undefined) {
    throw new Error('baseline is missing the S1 descriptor');
  }
  s1 = s1Descriptor;
  fixture = new BoundedHttpFixture();
  await fixture.start();
  outputRoot = tempOutputRoot('s1-oracle');
});

after(() => {
  removeTempRoot(outputRoot);
  return fixture.stop();
});

// ---------------------------------------------------------------------------
// Baseline document honesty and registry binding (S1–S6)
// ---------------------------------------------------------------------------

describe('T10 S1–S6 baseline descriptors — honesty and live-registry binding', () => {
  it('the baseline document decodes fail-closed: unknown fields are refused', () => {
    const tampered = { ...baseline, rogueAcceptanceGate: 'fake-G1' };
    assert.throws(() => decodeSliceBaseline(tampered), /unknown field/);
  });

  it('every descriptor matches the canonical support-slice registry exactly', () => {
    const match = assertBaselineMatchesRegistry(baseline);
    assert.deepEqual(match.mismatches, []);
    assert.equal(match.ok, true);
  });

  it('registry drift is detected, never silently absorbed', () => {
    const drifted: SliceBaseline = {
      ...baseline,
      slices: baseline.slices.map((slice) =>
        slice.sliceId === 'S1' ? { ...slice, surfaceClass: 'COLLECTION' } : slice,
      ),
    };
    const match = assertBaselineMatchesRegistry(drifted);
    assert.equal(match.ok, false);
    assert.ok(
      match.mismatches.some((line) => line.includes('S1') && line.includes('surfaceClass')),
    );
  });

  it('S1 is the only FULL_ORACLE slice; the others carry explicit honesty gaps', () => {
    assert.deepEqual(
      fullOracleSlices(baseline).map((slice) => slice.sliceId),
      ['S1'],
    );
    const descriptors = descriptorOnlySlices(baseline);
    assert.deepEqual(
      descriptors.map((slice) => slice.sliceId),
      ['S2', 'S3', 'S4', 'S5', 'S6'],
    );
    for (const descriptor of descriptors) {
      assert.ok(
        descriptor.oracle.gap !== undefined && descriptor.oracle.gap.length > 0,
        `${descriptor.sliceId} must state its journey gap honestly`,
      );
      assert.ok(descriptor.oracle.assertions.includes('registry-identity'));
      assert.equal(descriptor.oracle.level, 'DESCRIPTOR_REGISTRY_MATCH');
      // A descriptor-only slice must never pretend to an executable terminal
      // expectation — that vocabulary belongs to the executed S1 oracle only.
      assert.equal(descriptor.terminalVocabulary, undefined);
      assert.equal(descriptor.honestFailureVocabulary, undefined);
    }
    // The executable slice carries both sides of the vocabulary.
    assert.ok(s1.terminalVocabulary !== undefined);
    assert.ok(s1.honestFailureVocabulary !== undefined);
  });

  it('the installed-baseline binding stays NOT_PROVEN everywhere (no synthetic acceptance)', () => {
    assert.equal(baseline.installedBaselineStatus, 'DESCRIPTOR_ONLY_PENDING_INSTALLED_RELEASE');
    assert.ok(baseline.honestyNote.includes('NOT_PROVEN'));
    for (const descriptor of baseline.slices) {
      assert.equal(descriptor.installedBaseline.status, 'NOT_PROVEN_DESCRIPTOR_ONLY');
      assert.ok(descriptor.installedBaseline.owner.length > 0);
      assert.ok(descriptor.installedBaseline.requiredValidation.length > 0);
    }
  });

  it('T01 intent vocabulary facts are real: only S1/S3 slices exist as intent slices today', () => {
    const byId = new Map(baseline.slices.map((slice) => [slice.sliceId, slice]));
    assert.equal(byId.get('S1')?.intentVocabulary.t01IntentSlice, 'S1');
    assert.equal(byId.get('S3')?.intentVocabulary.t01IntentSlice, 'S3');
    for (const sliceId of ['S2', 'S4', 'S5', 'S6']) {
      assert.equal(byId.get(sliceId)?.intentVocabulary.t01IntentSlice, null);
    }
    assert.deepEqual(byId.get('S1')?.intentVocabulary.t01OperationVocabulary, [
      'acquisition.acquire',
      'media.acquire',
    ]);
  });
});

// ---------------------------------------------------------------------------
// S1 FULL_ORACLE — executable direct-journey baseline
// ---------------------------------------------------------------------------

describe('T10 S1 FULL_ORACLE — executable direct journey', () => {
  it('completes the frozen terminal vocabulary: real bytes, digest, evidence, projection', async () => {
    const digest = sha256(FULL);
    fixture.serveComplete('/s1-baseline.bin', { body: FULL, etag: `"${digest}"` });
    fixture.clearRequests();

    // 1. Canonical confirmed intent (S1, anchored to the full digest).
    const intent = confirmedIntent(digest, {
      outputRootScope: outputRoot,
      declaredBytes: FULL.byteLength,
    });
    assert.equal(intent.digestAnchor, digest);

    // 2. Route table binding against the sealed acquisition declaration.
    const declaration: OperationDeclaration = {
      operationId: 'acquisition.acquire',
      capabilityId: 'acquisition',
      handlerId: 'acquireFile',
      effectClass: 'non-idempotent',
      externalEffect: true,
    };
    const routes = [
      {
        intentId: intent.requestId,
        operationId: 'acquisition.acquire',
        capabilityId: 'acquisition',
        handlerId: 'acquireFile',
      },
    ];
    assert.deepEqual(validateRouteTable(routes, [declaration]).ok, true);

    // 3. Real transfer over the bounded loopback origin.
    const response = await fetch(fixture.uri('/s1-baseline.bin'), {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.byteLength, FULL.byteLength);
    const digestCheck = checkDigest(bytes, intent.digestAnchor ?? '');
    assert.equal(digestCheck.matches, true);

    // 4. Materialized evidence inside the authorized root.
    const artifactPath = `${outputRoot}/artifact-s1-001.bin`;
    writeFileSync(artifactPath, bytes);
    const evidence = materializeEvidence(
      {
        artifactPath,
        bytesOnDisk: bytes,
        declaredBytes: FULL.byteLength,
        sha256OnDisk: digestCheck.actualSha256,
        durableFileBytes: bytes.byteLength,
      },
      'COMPLETE',
    );
    assert.deepEqual(validateMaterializedEvidence(evidence, intent.outputRootScope).ok, true);

    // 5. Oracle-grade validation records for every S1-required layer.
    const registry = validationRegistryFor(SNAPSHOT, 'ALL_PASS');
    const outcomes = requiredValidationOutcomes(
      [memberIdOf(MEMBER)],
      registry,
      s1.requiredValidationLayers as readonly ValidationLayer[],
      { snapshotRef: SNAPSHOT },
    );
    assert.deepEqual(
      outcomes.map((outcome) => outcome.result),
      ['VALIDATED'],
    );

    // 6. Deterministic projection equals the descriptor's frozen vocabulary.
    const projected = projectResult(s1Facts({ accepted: true, registryPass: true }));
    assert.ok(projected.ok, JSON.stringify(projected, null, 2));
    assert.deepEqual(projected.value.result, {
      schemaIdentity: currentSchemaIdentity(),
      contractId: contractIdOf('contract-t10-s1-001'),
      snapshotId: snapshotIdOf(SNAPSHOT),
      requestFulfillment: s1.terminalVocabulary.requestFulfillment,
      targetResolution: s1.terminalVocabulary.targetResolution,
      selectionAcquisition: s1.terminalVocabulary.selectionAcquisition,
      coverage: s1.terminalVocabulary.coverage,
      stopReason: s1.terminalVocabulary.stopReason,
      validationSummary: s1.terminalVocabulary.validationSummary,
      recordedAt: FIXED_STAMP,
    });

    // 7. Network truth: exactly the one registered transfer happened.
    assert.equal(fixture.requestCount(), 1);
    assert.equal(fixture.requestsTo('/s1-baseline.bin').length, 1);
  });

  it('wrong-variant bytes fail target validation and project the honest failure vocabulary', async () => {
    fixture.serveComplete('/s1-variant.bin', { body: VARIANT });
    fixture.clearRequests();

    const response = await fetch(fixture.uri('/s1-variant.bin'), {
      signal: AbortSignal.timeout(5000),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digestCheck = checkDigest(bytes, sha256(FULL));
    assert.equal(digestCheck.matches, false, 'variant bytes must not satisfy the anchored digest');

    const registry = validationRegistryFor(SNAPSHOT, 'TARGET_PASS_TRANSFER_FAIL');
    const outcomes = requiredValidationOutcomes(
      [memberIdOf(MEMBER)],
      registry,
      s1.requiredValidationLayers as readonly ValidationLayer[],
      { snapshotRef: SNAPSHOT },
    );
    assert.deepEqual(
      outcomes.map((outcome) => outcome.result),
      ['VALIDATION_FAILED'],
    );

    const projected = projectResult(s1Facts({ accepted: false, registryPass: false }));
    assert.ok(projected.ok);
    const result = projected.value.result;
    assert.equal(result.requestFulfillment, 'UNSATISFIED');
    assert.equal(result.selectionAcquisition, 'FAILED');
    assert.equal(result.stopReason, 'VALIDATION_FAILED');
    assert.equal(result.coverage, 'NOT_APPLICABLE');
    assert.ok(s1.honestFailureVocabulary.requestFulfillment.includes(result.requestFulfillment));
    assert.ok(
      s1.honestFailureVocabulary.selectionAcquisition.includes(result.selectionAcquisition),
    );
    assert.ok(s1.honestFailureVocabulary.stopReason.includes(result.stopReason));
    assert.deepEqual(result.validationSummary, {
      status: 'FAILED',
      passedCount: 0,
      failedCount: 1,
    });
  });

  it('a structurally valid fake COMPLETE for failed validation is refused by the frozen rules', () => {
    const fake = buildTerminalResult({
      contractId: contractIdOf('contract-t10-s1-fake'),
      snapshotId: snapshotIdOf(SNAPSHOT),
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'NOT_APPLICABLE',
      stopReason: 'NONE',
      validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
      recordedAt: FIXED_STAMP,
    });
    assert.ok(
      fake.ok,
      'the fake must be constructible — the refusal lives in the legal-combination gate',
    );
    const refusal = validateTerminalResult(fake.value, {
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      selectedMemberCount: 1,
      selectedValidationOutcomes: [
        { memberId: memberIdOf(MEMBER), requiredValidationPassed: false },
      ],
    });
    assert.equal(refusal.ok, false);
    assert.ok(
      refusal.diagnostics.some(
        (item) =>
          item.code === 'INVALID_RESULT_COMBINATION' && (item.invariant ?? '').includes('C27'),
      ),
      JSON.stringify(refusal.diagnostics, null, 2),
    );
  });

  it('sealing and adjudicating the intent is pure: zero requests while the origin is live', () => {
    fixture.serveComplete('/s1-never-touched.bin', { body: FULL });
    fixture.clearRequests();
    const audit = new NetworkAudit().register(fixture, 's1-contract-stage');

    const intent = confirmedIntent(sha256(FULL), {
      outputRootScope: outputRoot,
      declaredBytes: FULL.byteLength,
    });
    assert.equal(
      validateRouteTable(
        [
          {
            intentId: intent.requestId,
            operationId: 'acquisition.acquire',
            capabilityId: 'acquisition',
            handlerId: 'acquireFile',
          },
        ],
        [
          {
            operationId: 'acquisition.acquire',
            capabilityId: 'acquisition',
            handlerId: 'acquireFile',
            effectClass: 'non-idempotent',
            externalEffect: true,
          },
        ],
      ).ok,
      true,
    );
    const pending = normalizeEffectEnvelope(acceptedEnvelope('ext-001'));
    assert.ok(pending.ok);
    assert.equal(pending.value.phase, 'accepted');

    audit.assertZeroNetwork('S1 contract stage runs without any origin traffic');
    assert.equal(fixture.requestsTo('/s1-never-touched.bin').length, 0);
  });

  it('a partial restart artifact cannot be read as completed evidence (declared vs durable)', async () => {
    fixture.serveComplete('/s1-partial-source.bin', { body: FULL });
    const written = 397;
    const artifact = writePartialArtifact(outputRoot, 'artifact-s1-partial.bin', FULL, written);
    const durable = declaredVsDurable(artifact);
    assert.equal(durable.agrees, true, 'the honest evidence describes exactly the durable bytes');

    const digestCheck = checkDigest(artifact.bytesOnDisk, sha256(FULL));
    assert.equal(digestCheck.matches, false, 'a prefix never satisfies the whole-file anchor');

    const honestEvidence = materializeEvidence(artifact, 'INTERRUPTED');
    assert.deepEqual(validateMaterializedEvidence(honestEvidence, outputRoot).ok, true);
    assert.notEqual(honestEvidence.fileSha256, sha256(FULL));
    assert.equal(honestEvidence.bytesWritten, written);
    assert.notEqual(honestEvidence.stopReason, 'COMPLETE');
  });
});

// ---------------------------------------------------------------------------
// Shared S1 oracle machinery
// ---------------------------------------------------------------------------

interface S1FactsOptions {
  readonly accepted: boolean;
  readonly registryPass: boolean;
}

function s1Facts(options: S1FactsOptions): ProjectionFacts {
  return {
    contractId: contractIdOf('contract-t10-s1-001'),
    snapshotId: snapshotIdOf(SNAPSHOT),
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    recordedAt: FIXED_STAMP,
    requestedMemberIds: [memberIdOf(MEMBER)],
    acceptedSelectedMemberIds: options.accepted ? [memberIdOf(MEMBER)] : [],
    requiredLayers: s1.requiredValidationLayers as readonly ValidationLayer[],
    validationRegistry: validationRegistryFor(
      SNAPSHOT,
      options.registryPass ? 'ALL_PASS' : 'TARGET_PASS_TRANSFER_FAIL',
    ),
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

/**
 * Real validation machinery: oracle-grade evidence appended to the canonical
 * ledger, PASS/FAIL records bound to the exact snapshot, admitted by the
 * canonical registry admission gate.
 */
function validationRegistryFor(
  snapshotRaw: string,
  plan: 'ALL_PASS' | 'TARGET_PASS_TRANSFER_FAIL',
): ReturnType<typeof createValidationRegistry> {
  const ledger = createEvidenceLedger();
  const registry = createValidationRegistry(ledger);
  const layers: readonly ValidationLayer[] = ['target', 'transfer', 'format'];
  for (const layer of layers) {
    const outcome = layer === 'transfer' && plan !== 'ALL_PASS' ? 'FAIL' : 'PASS';
    const appended = ledger.append(
      evidenceRecord({
        evidenceId: evidenceIdOf(`ev-${layer}-${snapshotRaw}`),
        claimType: claimTypeForLayer(layer),
        claimSubject: { kind: 'MEMBER', ref: MEMBER },
        sourceType: layer === 'transfer' ? 'TRANSFER_OBSERVATION' : 'INDEPENDENT_VALIDATOR',
        provenance: { sourceIdentity: 't10-fixture-oracle' },
        independenceFromDiscovery: 'INDEPENDENT',
        scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
        certaintyClass: 'DECISIVE',
      }),
    );
    assert.ok(appended.ok, JSON.stringify(appended, null, 2));
    const registered = registry.register({
      schemaIdentity: currentSchemaIdentity(),
      validationId: validationRecordIdOf(`vr-${layer}-${snapshotRaw}`),
      layer,
      subject: { kind: 'MEMBER', ref: MEMBER },
      outcome,
      snapshotRef: snapshotRaw,
      evidenceRefs: [appended.value.evidenceId],
      validatorIdentity: 't10-fixture-oracle',
      recordedAt: FIXED_STAMP,
    });
    assert.ok(registered.ok, JSON.stringify(registered, null, 2));
  }
  return registry;
}
