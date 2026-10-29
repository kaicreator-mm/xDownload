/**
 * TEST_MATRIX suite `duplicate-command` (+ C01, C13).
 *
 * Must prove:
 * - re-submission of an already-accepted idempotent command is absorbed
 *   without creating a second effect lineage;
 * - duplicate submit cannot bypass revision/idempotency gating at the seam;
 * - concurrent duplicate submissions converge to one accepted lineage
 *   (single-writer integrity).
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  rawSingleResourceContract,
  removeTempDir,
  requestIdOf,
  seamCommand,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { executeDirectAcquisition, registerLineage } from '../src/index.ts';
import { LedgerConnection } from '@xdownload/persistence-ledger';

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

const CONTRACT = 'contract-single-001';
const SNAPSHOT = 'snapshot-001';
const TARGET = 'target-file-001';
const MEMBER = 'member-file-001';
const LINEAGE_KEY = [
  CONTRACT,
  SNAPSHOT,
  TARGET,
  'effect:contract-single-001:snapshot-001:target-file-001',
].join('|');

function transferRequestFor(baseUri: string, bytes: Uint8Array) {
  const targetId = unwrapOrThrow(makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  return {
    effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice: 'S1' as const,
    selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
    binding: unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: initialUri,
      }),
    ),
    expectedSha256: createSha256(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  };
}

function createSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('T015 duplicate-command', () => {
  it('absorbs re-submission of an accepted idempotent command without a second lineage (C01)', async () => {
    const rootDir = makeTempDir('t015-duplicate-seam');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const payloadContract = rawSingleResourceContract();
      const first = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: payloadContract,
        expectedRevision: 0,
        requestId: requestIdOf('dup-001'),
      });
      expect(first.outcome).toBe('ACCEPTED');
      const revisionAfterFirst = runtime.seam.inspectProjection(CONTRACT)?.contract.revision;

      // Duplicate re-submission: SAME idempotent identity + SAME payload.
      const duplicate = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: payloadContract,
        expectedRevision: 1,
        requestId: requestIdOf('dup-001'),
      });
      expect(duplicate.outcome).toBe('ACCEPTED');
      expect(duplicate.acceptance?.converged).toBe(true);
      expect(runtime.seam.inspectProjection(CONTRACT)?.contract.revision).toBe(revisionAfterFirst);

      // Conflicting duplicate (same id, different payload) rejects typed.
      const conflicting = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract({ requestedTarget: 'target-other-001' }),
        expectedRevision: 1,
        requestId: requestIdOf('dup-001'),
      });
      expect(conflicting.outcome).toBe('REJECTED');
      expect((conflicting.diagnostics ?? [])[0]?.code).toBe('IDEMPOTENCY_CONFLICT');

      // A duplicate CANNOT bypass the revision gate: a fresh request id with
      // a stale expectedRevision rejects with the current revision revealed.
      const stale = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract({ contractId: 'contract-single-009' }),
        expectedRevision: 0,
        requestId: requestIdOf('dup-stale-001'),
      });
      expect(stale.outcome).toBe('REJECTED');
      expect((stale.diagnostics ?? [])[0]?.code).toBe('REVISION_MISMATCH');
      expect(stale.currentRevision).toBe(1);

      // With a current revision, re-creation of the SAME aggregate identity
      // is still a typed duplicate allocation (no second authority event).
      const recreate = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract(),
        expectedRevision: 1,
        requestId: requestIdOf('dup-recreate-001'),
      });
      expect(recreate.outcome).toBe('REJECTED');
      expect((recreate.diagnostics ?? [])[0]?.code).toBe('DUPLICATE_ALLOCATION');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('converges duplicate lineage submissions onto one frozen effect identity', () => {
    const rootDir = makeTempDir('t015-duplicate-lineage');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const seed = {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
      };
      const first = registerLineage(runtime, seed, {
        commandId: 'cmd-dup-001',
        memberId: MEMBER,
      });
      expect(first.submission.converged).toBe(false);

      // Same work from a "second client": the derived canonical effect id is
      // identical, so the submission converges; no second lineage exists.
      const second = registerLineage(runtime, seed, {
        commandId: 'cmd-dup-002',
        memberId: MEMBER,
      });
      expect(second.submission.converged).toBe(true);
      expect(second.submission.lineageKey).toBe(first.submission.lineageKey);
      expect(second.submission.effectId).toBe(first.submission.effectId);
      expect(second.workItemId).toBe(first.workItemId);

      // Exactly one durable work item carries the lineage.
      const workItems = runtime.writer.reader
        .workItems()
        .filter((workItem) => workItem.contractId === CONTRACT);
      expect(workItems.length).toBe(1);

      // A forked effect identity for the same logical work is rejected.
      const fork = runtime.scheduler.submitLineage({
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        requestedEffectId: 'effect:forged-fork',
      });
      expect(fork.ok).toBe(false);
      if (!fork.ok) {
        expect(fork.rejection.code).toBe('LINEAGE_FORK_REJECTED');
      }

      // A second writable path for the same database stays rejected while
      // the authoritative writer is open (concurrent duplicate protection).
      expect(() => LedgerConnection.openWriter(runtime.layout.dbPath)).toThrowError(
        /second writable ledger/,
      );
    } finally {
      closeRuntime(runtime);
    }
  });

  it('converges interleaved duplicate flow executions to one accepted lineage (C13 shape)', async () => {
    const rootDir = makeTempDir('t015-duplicate-flow');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(2048, 5);
    fixture.serveFile('/file.bin', { body: bytes, etag: 'dupflow-etag' });

    const runtime = openRuntime(rootDir);
    try {
      const input = {
        contractId: CONTRACT,
        snapshotId: SNAPSHOT,
        targetId: TARGET,
        authorizationContextRef: 'authctx/local-001',
        budgetProfile: rawSingleResourceContract()['budgetProfile'],
        memberId: MEMBER,
        artifactId: 'artifact:duplicate-001',
      };
      // Interleaved duplicate executions (distinct command ids, same frozen
      // work identity) — the single-writer path serializes them.
      const [first, second] = await Promise.all([
        executeDirectAcquisition(runtime, {
          ...input,
          commandId: 'cmd-flow-001',
          transfer: transferRequestFor(baseUri, bytes),
        }),
        executeDirectAcquisition(runtime, {
          ...input,
          commandId: 'cmd-flow-002',
          transfer: transferRequestFor(baseUri, bytes),
        }),
      ]);
      expect(first.submission.lineageKey).toBe(LINEAGE_KEY);
      expect(second.submission.lineageKey).toBe(LINEAGE_KEY);
      expect(first.workItemId).toBe(second.workItemId);
      expect([first.submission.converged, second.submission.converged].sort()).toEqual([
        false,
        true,
      ]);

      // The durable end state is ONE accepted artifact and ONE scheduler
      // acceptance, with the transfer budget charged once (single-writer).
      const workItems = runtime.writer.reader
        .workItems()
        .filter((workItem) => workItem.contractId === CONTRACT);
      expect(workItems.length).toBe(1);
      expect(workItems[0]?.lifecycleState).toBe('ACCEPTED');
      const consumptionEntries = runtime.writer.reader
        .budgetEntries(first.workItemId)
        .filter((entry) => entry.kind === 'CONSUMPTION' && entry.limitKey === 'bytes');
      expect(consumptionEntries.length).toBe(1);
      expect(consumptionEntries[0]?.amount).toBe(bytes.byteLength);
    } finally {
      closeRuntime(runtime);
    }
  });
});
