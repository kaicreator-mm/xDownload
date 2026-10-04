/**
 * TEST_MATRIX suite `focused-core-integration` (+ C01/C13 seeds).
 *
 * Must prove:
 * - one composed runtime serves command→schedule→transfer→validate→persist→
 *   project end-to-end in-process for a direct single-resource acquisition;
 * - canonical vocabulary throughout is domain-contracts only;
 * - the runtime exposes upstream semantics verbatim (no glue-level outcome
 *   decisions);
 * - exactly one authoritative ledger writer and one scheduler fact-log
 *   mutation path exist in the composed runtime.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type LocatorBinding,
  type LogicalTargetId,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import {
  createLoopbackClientTransport,
  createSeamClient,
  type SeamProjectionView,
} from '@xdownload/core-seam';
import { LedgerConnection } from '@xdownload/persistence-ledger';
import type { DirectTransferRequest } from '@xdownload/direct-acquisition';
import {
  closeRuntime,
  commandEnvelope,
  EXPECTED_PEER,
  makeTempDir,
  openRuntime,
  payload,
  peer,
  rawSingleResourceContract,
  removeTempDir,
  requestIdOf,
  seamCommand,
  seamQuery,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { executeDirectAcquisition, projectLineageResult } from '../src/index.ts';
import { bindLoopbackSeam } from './helpers.ts';

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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bindingFor(baseUri: string): LocatorBinding<LogicalTargetId> {
  const targetId = unwrapOrThrow(makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  return unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
}

function directTransferRequest(
  baseUri: string,
  bytes: Uint8Array,
  slice: 'S1' | 'S3' = 'S1',
): DirectTransferRequest {
  return {
    effectId: unwrapOrThrow(makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:${TARGET}`)),
    contractId: CONTRACT,
    slice,
    selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
    binding: bindingFor(baseUri),
    expectedSha256: sha256(bytes),
    allowedRedirectHosts: [new URL(baseUri).host],
    attempt: 0,
  };
}

describe('T015 focused-core-integration', () => {
  it(
    'serves command→schedule→transfer→validate→persist→project end-to-end through the loopback seam',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('t015-focused');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = payload(4096, 7);
      fixture.serveFile('/file.bin', { body: bytes, etag: 'b0000etag' });

      const runtime = openRuntime(rootDir);
      try {
        // 1. Command entry: contract accepted through the loopback seam and a
        //    real lifecycle-independent client.
        const loopback = await bindLoopbackSeam(runtime);
        let terminal: TerminalResult | undefined;
        try {
          const client = createSeamClient({
            transport: createLoopbackClientTransport(),
            target: loopback.target,
            peer: peer('CLI'),
          });
          const accepted = await client.submitCommand(
            commandEnvelope({
              commandType: 'SUBMIT_CONTRACT',
              aggregateId: CONTRACT,
              payload: rawSingleResourceContract(),
              expectedRevision: 0,
            }),
          );
          expect(accepted.outcome).toBe('ACCEPTED');

          // 2+3. Control + execution: direct S1 transfer under runtime dispatch.
          const flow = await executeDirectAcquisition(runtime, {
            contractId: CONTRACT,
            snapshotId: SNAPSHOT,
            targetId: TARGET,
            authorizationContextRef: 'authctx/local-001',
            budgetProfile: rawSingleResourceContract()['budgetProfile'],
            commandId: 'cmd-e2e-001',
            memberId: MEMBER,
            artifactId: 'artifact:file-001',
            transfer: directTransferRequest(baseUri, bytes),
          });
          if (flow.attemptReplayed || flow.transfer === undefined) {
            throw new Error('unexpected replay in fixture flow');
          }

          expect(flow.transfer.reason).toBe('COMPLETED');
          expect(flow.transfer.allApplicableValidationPassed).toBe(true);
          expect(flow.acceptance?.alreadyAccepted).toBe(false);
          expect(flow.schedulerAcceptance?.ok).toBe(true);

          // 4. Projection: terminal truth only through the domain projector.
          const projected = projectLineageResult(runtime, {
            lineageKey: flow.lineageKey,
            contractId: CONTRACT,
            snapshotId: SNAPSHOT,
            intentType: 'SINGLE_RESOURCE',
            scopeKind: 'single_resource',
            requestedMemberIds: [MEMBER],
            recordedAt: '2026-10-04T02:00:00Z',
            enumeration: { kind: 'NOT_APPLICABLE' },
          });
          expect(projected.ok).toBe(true);
          terminal = projected.ok ? projected.value.result : undefined;
          expect(terminal?.requestFulfillment).toBe('COMPLETE');
          expect(terminal?.targetResolution).toBe('RESOLVED');
          expect(terminal?.selectionAcquisition).toBe('COMPLETE');
          expect(terminal?.coverage).toBe('NOT_APPLICABLE');
          expect(terminal?.stopReason).toBe('NONE');
          expect(terminal?.validationSummary.status).toBe('ALL_PASSED');

          // 5. Terminal result enters the seam authority via the canonical command.
          const revision = runtime.seam.inspectProjection(CONTRACT)?.contract.revision ?? 0;
          const terminalResponse = seamCommand(runtime, {
            commandType: 'PROJECT_TERMINAL_RESULT',
            aggregateId: CONTRACT,
            expectedRevision: revision,
            payload: {
              result: terminal,
              selectedValidationOutcomes: [{ memberId: MEMBER, requiredValidationPassed: true }],
            },
          });
          expect(terminalResponse.outcome).toBe('ACCEPTED');

          // 6. READ_PROJECTION through the seam equals the internal projection
          //    (no surface-local projection fork).
          const read = seamQuery(runtime, CONTRACT);
          expect(read.outcome).toBe('PROJECTION');
          const view = read.projection as SeamProjectionView;
          expect(view.terminal).toEqual(terminal);
          await client.close();
        } finally {
          await loopback.stop();
        }

        // Canonical vocabulary only: the committed terminal value carries the
        // frozen multidimensional domain-contracts shape.
        const committed = runtime.seam.inspectProjection(CONTRACT)?.terminal;
        expect(Object.keys(committed ?? {}).sort()).toEqual(
          [
            'contractId',
            'coverage',
            'recordedAt',
            'requestFulfillment',
            'schemaIdentity',
            'selectionAcquisition',
            'snapshotId',
            'stopReason',
            'targetResolution',
            'validationSummary',
          ].sort(),
        );
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it('has exactly one authoritative writer and one fact-log mutation path', () => {
    const rootDir = makeTempDir('t015-single-writer');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // A second writable ledger handle for the same database file is a typed
      // violation at the connection registry (frozen L2 §10).
      expect(() => LedgerConnection.openWriter(runtime.layout.dbPath)).toThrowError(
        /second writable ledger/,
      );

      // Budget facts are unconstructible outside the single authoritative
      // budget mutation path: the durable log rejects a bare budget append.
      const forged = runtime.scheduler.log().append({
        kind: 'budgetConsumed',
        lineageKey: 'c|s|t|e',
        contractId: CONTRACT,
        reservationId: 'forged',
        amounts: { bytes: 1 },
      } as never);
      expect(forged.ok).toBe(false);
      if (!forged.ok) {
        expect(forged.rejection.code).toBe('BUDGET_AUTHORITY_VIOLATION');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('enforces seam peer authorization and absorbs idempotent replays (C01/C13 seed)', () => {
    const rootDir = makeTempDir('t015-focused-peer');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const contract = rawSingleResourceContract();
      const accepted = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: contract,
        expectedRevision: 0,
      });
      expect(accepted.outcome).toBe('ACCEPTED');

      // A foreign peer (different install/user) is rejected per frame.
      const foreign = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-002',
        payload: rawSingleResourceContract({ contractId: 'contract-single-002' }),
        expectedRevision: 0,
        asPeer: { installId: 'install-999', userId: 'user-999', surface: 'CLI' },
      });
      expect(foreign.outcome).toBe('REJECTED');

      // Snapshot confirmation, then a duplicate replay of the SAME command
      // identity: it converges to the original acceptance and replaces
      // nothing (C01 — revision and member identity are stable).
      const confirmRequest = commandEnvelope({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: CONTRACT,
        payload: rawSnapshotForSingle(),
        expectedRevision: 1,
        requestId: requestIdOf('t015-dup-002'),
      });
      const confirmFirst = runtime.seam.handleFrame(JSON.stringify(confirmRequest));
      const confirmDuplicate = runtime.seam.handleFrame(JSON.stringify(confirmRequest));
      expect(confirmFirst.outcome).toBe('ACCEPTED');
      expect(confirmDuplicate.outcome).toBe('ACCEPTED');
      expect(confirmDuplicate.acceptance?.converged).toBe(true);
      // Two accepted commands total: the duplicate converged onto the
      // original acceptance and created no second authority event.
      expect(runtime.seam.acceptedCommandCount).toBe(2);

      const projection = runtime.seam.inspectProjection(CONTRACT) as SeamProjectionView;
      expect(projection.snapshot?.selectedMemberIds).toEqual([MEMBER]);
      expect(projection.contract.revision).toBe(2);
      expect(EXPECTED_PEER.allowedSurfaces.length).toBeGreaterThan(0);
    } finally {
      closeRuntime(runtime);
    }
  });
});

/** Single-resource selection snapshot bound to the focused contract. */
function rawSnapshotForSingle(): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId: SNAPSHOT,
    contractId: CONTRACT,
    requestedScope: { kind: 'single_resource', targetId: TARGET },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:${TARGET}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [MEMBER] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [MEMBER] },
    selectedMemberIds: [MEMBER],
    authorizationContextRef: 'authctx/local-001',
    profileContextRef: 'profile/default-001',
    selectionClaims: [
      { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: [MEMBER] },
    ],
    sourceMarker: { system: 'xdownload-core', version: 'v0.1.0' },
    createdAt: '2026-10-04T00:00:00Z',
  };
}
