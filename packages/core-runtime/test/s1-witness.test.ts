/**
 * #113 Core durable target witness → ResolutionFacts.s1Target wiring —
 * end-to-end through the composed runtime against controlled localhost HTTP.
 *
 * Proves all three #103 §2.2 frozen tuples on the SAME Core source, driven
 * through the real S1 seam command and the real T008 transfer:
 * (a) URL-only success with PROBATIVE Target evidence → the exact §18.1
 *     COMPLETE tuple + ALL_PASSED;
 * (b) target-provenance unproven (undeclared redirect) after an attempted
 *     transfer → UNKNOWN/BLOCKED/FAILED/NOT_APPLICABLE/VALIDATION_FAILED
 *     with zero accepted bytes;
 * (c) independently published SHA mismatch → UNSATISFIED/RESOLVED/FAILED
 *     with Target RESOLVED and no accepted artifact — never COMPLETE.
 * Plus the negative battery: no witness on cancel-before-transfer, witness
 * survival + identical re-derivation across restart (no re-download,
 * no double charge), changed-basis/foreign-witness rejection, caller-
 * supplied resolution refusal, journal corruption fail-closed, and the S2
 * /collection lanes unchanged.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeAcquisitionContract } from '@xdownload/domain-contracts';
import type { SeamProjectionView } from '@xdownload/core-seam';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  removeTempDir,
  runtimeOptions,
  seamCommand,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import {
  closeCoreRuntime,
  durableLayout,
  projectLineageResult,
  registerLineage,
  reopenCoreRuntime,
  s1EffectIdentity,
} from '../src/index.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = 'contract-s1w-001';
const SNAPSHOT = 's1wsnap-001';
const MEMBER = 's1wmember-001';
const ARTIFACT = 's1wartifact-001';

function s1Payload(
  baseUri: string,
  host: string,
  overrides: { readonly expectedSha256?: string } = {},
): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    memberId: MEMBER,
    artifactId: ARTIFACT,
    delivery: {
      locatorUri: `${baseUri}/file.bin`,
      declaredRedirectHosts: [host],
      ...(overrides.expectedSha256 === undefined
        ? {}
        : { expectedSha256: overrides.expectedSha256 }),
    },
  };
}

async function waitForTerminal(
  inspect: () => SeamProjectionView | undefined,
): Promise<SeamProjectionView> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const view = inspect();
    if (view !== undefined && view.terminal !== undefined) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('terminal was not projected in time');
}

function tupleOf(view: SeamProjectionView): readonly [string, string, string, string, string] {
  const terminal = view.terminal!;
  return [
    terminal.requestFulfillment,
    terminal.targetResolution,
    terminal.selectionAcquisition,
    terminal.coverage,
    terminal.stopReason,
  ];
}

function setup(runtime: ReturnType<typeof openRuntime>, payload: unknown): void {
  expect(
    seamCommand(runtime, {
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: CONTRACT,
      payload: rawSingleResourceContract({ contractId: CONTRACT }),
    }).outcome,
  ).toBe('ACCEPTED');
  expect(
    seamCommand(runtime, {
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      aggregateId: CONTRACT,
      payload,
      expectedRevision: 1,
    }).outcome,
  ).toBe('ACCEPTED');
}

describe('#113 S1 crash-window replay of durable provenance failure', () => {
  it(
    'reconstructs tuple (b) from an effect-outcome-only journal after restart, without re-downloading',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-crash-window-b');
      dirs.push(rootDir);
      const raw = rawSingleResourceContract({ contractId: CONTRACT });
      const contractResult = decodeAcquisitionContract(raw);
      expect(contractResult.ok).toBe(true);
      if (!contractResult.ok) return;
      const contract = contractResult.value;
      const locator = 'http://127.0.0.1:9/file.bin';
      const payload = s1Payload('http://127.0.0.1:9', '127.0.0.1:9');

      // Simulated SIGKILL boundary: command intent not yet dispatched by the
      // seam, but the same canonical T015 scheduler/ledger has a work item,
      // dispatched attempt and committed FAILED/LOCATOR_SUBSTITUTION fact.
      // No staged bytes, TERMINAL_FAILURE row or target witness exists yet.
      const first = openRuntime(rootDir);
      try {
        expect(
          seamCommand(first, {
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: CONTRACT,
            payload: raw,
          }).outcome,
        ).toBe('ACCEPTED');
        const { submission, workItemId } = registerLineage(
          first,
          {
            contractId: CONTRACT,
            snapshotId: SNAPSHOT,
            targetId: contract.requestedTarget,
            authorizationContextRef: contract.authorizationContextRef,
            budgetProfile: contract.budgetProfile,
            frozenMemberIds: [MEMBER],
          },
          {
            commandId: `s1-direct:${CONTRACT}:${SNAPSHOT}:${MEMBER}`,
            memberId: MEMBER,
          },
        );
        const attemptId = `${workItemId}#attempt-1`;
        first.writer.dispatch({ workItemId, attemptId });
        expect(first.scheduler.startEffectAttempt(submission.lineageKey, attemptId).ok).toBe(true);
        first.writer.recordExternalEffectObserved(workItemId);
        expect(
          first.scheduler.recordEffectOutcome(submission.lineageKey, {
            attemptId,
            outcome: 'FAILED',
            failureCategory: 'LOCATOR_SUBSTITUTION',
          }).ok,
        ).toBe(true);
        const durableOutcome = first.scheduler.durableEffectOutcome(submission.lineageKey, attemptId);
        expect(durableOutcome).toEqual({
          outcome: 'FAILED',
          failureCategory: 'LOCATOR_SUBSTITUTION',
        });
        expect(first.writer.reader.artifacts(workItemId)).toHaveLength(0);
        expect(first.seam.targetWitnessFor(CONTRACT)).toBeUndefined();
      } finally {
        closeRuntime(first);
      }

      const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        expect(
          seamCommand(reopened, {
            commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
            aggregateId: CONTRACT,
            payload,
            expectedRevision: 1,
          }).outcome,
        ).toBe('ACCEPTED');
        const view = await waitForTerminal(() => reopened.seam.inspectProjection(CONTRACT));
        expect(tupleOf(view)).toEqual([
          'UNKNOWN',
          'BLOCKED',
          'FAILED',
          'NOT_APPLICABLE',
          'VALIDATION_FAILED',
        ]);
        expect(reopened.seam.targetWitnessFor(CONTRACT)).toMatchObject({
          status: 'PROVENANCE_UNPROVEN',
          unprovenReason: 'LOCATOR_SUBSTITUTION',
          locatorUri: locator,
        });
        // The previous FAILED attempt must never be re-issued: port :9 is
        // deliberately not served, proving terminal came from durable truth.
        const workItem = reopened.writer.reader
          .workItems()
          .find((row) => row.contractId === CONTRACT);
        expect(workItem).toBeDefined();
        expect(reopened.writer.reader.artifacts(workItem!.workItemId)).toHaveLength(0);
      } finally {
        closeRuntime(reopened);
      }
    },
  );
});

describe('#113 S1 target witness — the three frozen §2.2 tuples on the same Core source', () => {
  it(
    '(a) URL-only success: PROBATIVE provenance witness, exact §18.1 COMPLETE tuple, ALL_PASSED',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-success');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 4096 }, (_, i) => (i * 7) % 251));
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-a"' });

      const runtime = openRuntime(rootDir);
      try {
        // No digest anywhere in the command: the ordinary URL-only download.
        setup(runtime, s1Payload(baseUri, new URL(baseUri).host));
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(tupleOf(view)).toEqual([
          'COMPLETE',
          'RESOLVED',
          'COMPLETE',
          'NOT_APPLICABLE',
          'NONE',
        ]);
        expect(view.terminal?.validationSummary).toEqual({
          status: 'ALL_PASSED',
          passedCount: 1,
          failedCount: 0,
        });

        // The witness is the Core's own durable fact: RESOLVED on the
        // REQUESTED_LOCATOR_PROVENANCE basis with PROBATIVE certainty —
        // never a DECISIVE publisher-hash claim (C34).
        const witness = runtime.seam.targetWitnessFor(CONTRACT);
        expect(witness).toBeDefined();
        expect(witness?.status).toBe('RESOLVED');
        expect(witness?.transferAttempted).toBe(true);
        expect(witness?.basis).toBe('REQUESTED_LOCATOR_PROVENANCE');
        expect(witness?.certaintyClass).toBe('PROBATIVE');
        expect(witness?.memberId).toBe(MEMBER);
        expect(witness?.effectId).toBe(`effect:${CONTRACT}:${SNAPSHOT}:target-file-001`);
        expect(witness?.observedRedirectHosts).toEqual([new URL(baseUri).host]);
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    '(b) undeclared redirect after attempted transfer: UNKNOWN/BLOCKED/FAILED, zero accepted bytes',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-redirect');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      // The redirect leaves the declared delivery graph (localhost ≠ the
      // declared 127.0.0.1 host): the adapter fails closed BEFORE contacting
      // the undeclared host (C29).
      fixture.redirect('/file.bin', `http://localhost:${new URL(baseUri).port}/evil.bin`);

      const runtime = openRuntime(rootDir);
      try {
        setup(runtime, s1Payload(baseUri, new URL(baseUri).host));
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(tupleOf(view)).toEqual([
          'UNKNOWN',
          'BLOCKED',
          'FAILED',
          'NOT_APPLICABLE',
          'VALIDATION_FAILED',
        ]);
        // The bytes are not accepted as a validated artifact.
        expect(view.terminal?.validationSummary.status).not.toBe('ALL_PASSED');
        expect(view.targetEvidence).toBeUndefined();

        const witness = runtime.seam.targetWitnessFor(CONTRACT);
        expect(witness?.status).toBe('PROVENANCE_UNPROVEN');
        expect(witness?.transferAttempted).toBe(true);
        // A redirect to an undeclared host is the C29 unrelated-redirect
        // substitution branch of the delivery-graph fail-closed path.
        expect(witness?.unprovenReason).toBe('LOCATOR_SUBSTITUTION');
        expect(witness?.basis).toBeUndefined();

        // Exactly one request hit the origin; the undeclared host was never
        // contacted, and no bytes were staged or accepted.
        expect(fixture.requests).toHaveLength(1);
        const workItem = runtime.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        expect(runtime.recovery.classify(workItem!.workItemId).lifecycleClass).not.toBe('ACCEPTED');
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    '(c) independently published SHA mismatch: Target RESOLVED, acquisition FAILED, never COMPLETE',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-digest');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 2048 }, (_, i) => (i * 13) % 251));
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-c"' });
      // A separately sourced publisher digest that the delivered bytes do
      // not match (the harness never derives it from the fixture bytes).
      const publisherDigest = createHash('sha256').update('other-bytes').digest('hex');

      const runtime = openRuntime(rootDir);
      try {
        setup(
          runtime,
          s1Payload(baseUri, new URL(baseUri).host, { expectedSha256: publisherDigest }),
        );
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(tupleOf(view)).toEqual([
          'UNSATISFIED',
          'RESOLVED',
          'FAILED',
          'NOT_APPLICABLE',
          'VALIDATION_FAILED',
        ]);
        expect(view.terminal?.validationSummary.status).toBe('FAILED');
        // No accepted artifact exists for the mismatched bytes.
        expect(view.targetEvidence).toBeUndefined();

        // Target RESOLVED rests on the PROBATIVE provenance basis — the
        // published-digest claim FAILED, so the witness never asserts it as
        // DECISIVE (no self-hash/publisher oracle fabrication).
        const witness = runtime.seam.targetWitnessFor(CONTRACT);
        expect(witness?.status).toBe('RESOLVED');
        expect(witness?.transferAttempted).toBe(true);
        expect(witness?.basis).toBe('REQUESTED_LOCATOR_PROVENANCE');
        expect(witness?.certaintyClass).toBe('PROBATIVE');

        // The mismatched bytes were staged durably but never accepted.
        const workItem = runtime.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        expect(runtime.recovery.classify(workItem!.workItemId).lifecycleClass).not.toBe('ACCEPTED');
      } finally {
        closeRuntime(runtime);
      }
    },
  );
});

describe('#113 S1 target witness — negative battery', () => {
  it(
    'cancel before any transfer records no witness and keeps the frozen cancel tuple',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-cancel');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      fixture.serveFile('/file.bin', { body: new Uint8Array([9, 9, 9]) });

      const runtime = openRuntime(rootDir);
      try {
        expect(
          seamCommand(runtime, {
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: CONTRACT,
            payload: rawSingleResourceContract({ contractId: CONTRACT }),
          }).outcome,
        ).toBe('ACCEPTED');
        expect(
          seamCommand(runtime, {
            commandType: 'CANCEL_LINEAGE',
            aggregateId: CONTRACT,
            payload: {},
            expectedRevision: 1,
          }).outcome,
        ).toBe('ACCEPTED');
        expect(
          seamCommand(runtime, {
            commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
            aggregateId: CONTRACT,
            payload: s1Payload(baseUri, new URL(baseUri).host),
            expectedRevision: 2,
          }).outcome,
        ).toBe('REJECTED');
        // The cancel-before-execute path rejects the execution command
        // (LATE): no S1 intent is ever registered, the lineage closes as
        // CANCELLED without a terminal handover, and no witness exists —
        // the frozen cancellation truth stays untouched.
        expect(fixture.requests).toHaveLength(0);
        expect(runtime.seam.targetWitnessFor(CONTRACT)).toBeUndefined();
        expect(runtime.seam.inspectProjection(CONTRACT)?.lineage.status).toBe('CANCELLED');
        expect(runtime.seam.inspectProjection(CONTRACT)?.terminal).toBeUndefined();
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    'restart re-derives the identical witness from durable truth (no re-download, no double charge)',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-restart');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 1024 }, (_, i) => (i * 3) % 251));
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-r"' });

      const first = openRuntime(rootDir);
      setup(first, s1Payload(baseUri, new URL(baseUri).host));
      const before = await waitForTerminal(() => first.seam.inspectProjection(CONTRACT));
      expect(tupleOf(before)[0]).toBe('COMPLETE');
      const witnessBefore = first.seam.targetWitnessFor(CONTRACT);
      expect(witnessBefore?.status).toBe('RESOLVED');
      const transfersBefore = fixture.requests.length;
      closeCoreRuntime(first);

      const second = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        const view = await waitForTerminal(() => second.seam.inspectProjection(CONTRACT));
        expect(view.terminal).toEqual(before.terminal);
        // Identical witness convergence across restart — never rewritten.
        expect(second.seam.targetWitnessFor(CONTRACT)).toEqual(witnessBefore);
        expect(fixture.requests).toHaveLength(transfersBefore);
      } finally {
        closeCoreRuntime(second);
      }
    },
  );

  it(
    'kill before the witness record: the reconcile derives the witness from durable truth before the terminal',
    { timeout: 120_000 },
    async () => {
      const rootDir = makeTempDir('s1w-kill-window');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 512 }, (_, i) => (i * 11) % 251));
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-k"' });

      const runtime = openRuntime(rootDir);
      setup(runtime, s1Payload(baseUri, new URL(baseUri).host));
      const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
      expect(tupleOf(view)[0]).toBe('COMPLETE');
      const witness = runtime.seam.targetWitnessFor(CONTRACT);
      closeCoreRuntime(runtime);

      // Simulate the kill window (durable bytes exist, witness record lost):
      // strip the witness from the journaled facts and rewrite the journal
      // without it, then reopen — the reconcile must re-derive the identical
      // witness from the staged artifact + recovery classification BEFORE
      // re-deriving the terminal, byte-for-byte.
      const layout = durableLayout(rootDir);
      const lines = readFileSync(layout.journalPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      const filtered = lines.filter((line) => !line.includes('"TARGET_WITNESS"'));
      expect(filtered.length).toBe(lines.length - 1);
      writeFileSync(layout.journalPath, `${filtered.join('\n')}\n`);

      const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        // The restart reconcile re-derives the witness from durable truth
        // and journals it BEFORE the re-derived terminal — the identical
        // fact, never a rewritten one, and never a re-download.
        const reopenedView = await waitForTerminal(() => reopened.seam.inspectProjection(CONTRACT));
        expect(reopenedView.terminal).toEqual(view.terminal);
        expect(reopened.seam.targetWitnessFor(CONTRACT)).toEqual(witness);
        expect(fixture.requests).toHaveLength(1);
      } finally {
        closeCoreRuntime(reopened);
      }
    },
  );

  it(
    'a conflicting witness in the journal fails the reopen closed; a forged foreign witness rejects',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-tamper');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-t"' });

      const runtime = openRuntime(rootDir);
      setup(
        runtime,
        s1Payload(baseUri, new URL(baseUri).host, {
          expectedSha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
      expect(runtime.seam.targetWitnessFor(CONTRACT)?.basis).toBe('PUBLISHED_SHA256');
      closeCoreRuntime(runtime);

      // Forged/foreign witnesses can never enter through the trusted port.
      const forged = reopenCoreRuntime(runtimeOptions(rootDir));
      const rejected = forged.seam.recordTargetWitness('contract-other', {
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: ARTIFACT,
        effectId: `effect:${CONTRACT}:${SNAPSHOT}:target-file-001`,
        locatorUri: `${baseUri}/file.bin`,
        declaredRedirectHosts: [new URL(baseUri).host],
        observedRedirectHosts: [new URL(baseUri).host],
        status: 'RESOLVED',
        transferAttempted: true,
        basis: 'PUBLISHED_SHA256',
        certaintyClass: 'DECISIVE',
      });
      expect(rejected.ok).toBe(false);
      // Let the restart reconcile drain (the lineage re-derives its terminal
      // from durable truth) before closing the durable handles.
      await waitForTerminal(() => forged.seam.inspectProjection(CONTRACT));
      closeCoreRuntime(forged);

      // A corrupt durable witness line (unparsable journal entry) fails the
      // reopen closed — no partially-recovered authority, same discipline as
      // every other durable store. (The semantic-level conflicting-witness
      // replay rejection is covered at the seam in target-witness.test.ts.)
      const layout = durableLayout(rootDir);
      const lines = readFileSync(layout.journalPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      const tampered = lines.map((line) =>
        line.includes('"TARGET_WITNESS"') ? line.slice(0, Math.max(0, line.length - 8)) : line,
      );
      writeFileSync(layout.journalPath, `${tampered.join('\n')}\n`);
      expect(() => reopenCoreRuntime(runtimeOptions(rootDir))).toThrow();
    },
  );

  it(
    'the S1 target fact comes only from the durable witness — a caller-supplied resolution is refused',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-caller-fact');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      fixture.redirect('/file.bin', `http://localhost:${new URL(baseUri).port}/evil.bin`);

      const runtime = openRuntime(rootDir);
      try {
        setup(runtime, s1Payload(baseUri, new URL(baseUri).host));
        await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));

        // A caller pretending a RESOLVED target with an arbitrary evidence
        // string changes nothing: the projection joins the fact from the
        // Core's own durable witness only (PROVENANCE_UNPROVEN stays).
        const lineageKey = s1EffectIdentity({
          contractId: CONTRACT,
          snapshotId: SNAPSHOT,
          targetId: 'target-file-001',
        });
        expect(lineageKey.ok).toBe(true);
        if (!lineageKey.ok) {
          throw new Error('unreachable');
        }
        const projected = projectLineageResult(runtime, {
          lineageKey: lineageKey.value.lineageKey,
          contractId: CONTRACT,
          snapshotId: SNAPSHOT,
          intentType: 'SINGLE_RESOURCE',
          scopeKind: 'single_resource',
          requestedMemberIds: [MEMBER],
          recordedAt: '2026-10-14T00:00:00Z',
          enumeration: { kind: 'NOT_APPLICABLE' },
          resolution: {
            s1Target: {
              memberId: MEMBER,
              evidenceRef: 'caller/fabricated-proof',
              status: 'RESOLVED',
              transferAttempted: true,
            },
          },
        } as Parameters<typeof projectLineageResult>[1]);
        expect(projected.ok).toBe(true);
        if (projected.ok) {
          // The fabricated RESOLVED claim cannot upgrade the unproven truth.
          expect(projected.value.result.targetResolution).toBe('BLOCKED');
          expect(projected.value.result.requestFulfillment).toBe('UNKNOWN');
        }
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    'an accepted success after restart keeps the DECISIVE published basis identical across reopen',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1w-decisive');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => (i * 5) % 251));
      const digest = createHash('sha256').update(bytes).digest('hex');
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1w-d"' });

      const first = openRuntime(rootDir);
      setup(first, s1Payload(baseUri, new URL(baseUri).host, { expectedSha256: digest }));
      await waitForTerminal(() => first.seam.inspectProjection(CONTRACT));
      const witness = first.seam.targetWitnessFor(CONTRACT);
      expect(witness?.status).toBe('RESOLVED');
      expect(witness?.basis).toBe('PUBLISHED_SHA256');
      expect(witness?.certaintyClass).toBe('DECISIVE');
      closeCoreRuntime(first);

      const second = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        expect(second.seam.targetWitnessFor(CONTRACT)).toEqual(witness);
      } finally {
        closeCoreRuntime(second);
      }
    },
  );
});
