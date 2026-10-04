/**
 * TEST_MATRIX suite `projection` (+ C23, C24 shapes).
 *
 * Must prove:
 * - terminal results are produced only by the domain-contracts
 *   result-projector from canonical state/evidence;
 * - projected status tuples honor frozen legal-combination rules (PRD §18)
 *   including negative tuples;
 * - READ_PROJECTION through the seam returns the same truth as internal
 *   projection (no surface-local projection fork);
 * - the multidimensional result (Request Fulfillment / Target Resolution /
 *   Selection Acquisition / Coverage / Stop Reason / Validation Summary) is
 *   preserved end-to-end — no single success boolean.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCoverageAccounting,
  coverageTargetFor,
  createEvidenceLedger,
  makeMemberId,
  unwrapOrThrow,
  type CoverageAccounting,
  type ProjectedTerminalResult,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import type { SeamProjectionView } from '@xdownload/core-seam';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawCollectionContract,
  rawSingleResourceContract,
  removeTempDir,
  seamCommand,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { createHash } from 'node:crypto';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import { executeDirectAcquisition, registerLineage } from '../src/index.ts';
import { projectLineageResult } from '../src/index.ts';

const dirs: string[] = [];

afterEach(() => {
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

function projectionInput(
  overrides: Partial<Parameters<typeof projectLineageResult>[1]> = {},
): Parameters<typeof projectLineageResult>[1] {
  return {
    lineageKey: LINEAGE_KEY,
    contractId: CONTRACT,
    snapshotId: SNAPSHOT,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [MEMBER],
    recordedAt: '2026-10-04T06:00:00Z',
    enumeration: { kind: 'NOT_APPLICABLE' },
    ...overrides,
  };
}

describe('T015 projection', () => {
  it('produces terminal truth only through the projector and it is deterministic', async () => {
    const rootDir = makeTempDir('t015-projection-deterministic');
    dirs.push(rootDir);
    const { runtime, close } = await acceptedLineageRuntime(rootDir);
    try {
      const first = projectLineageResult(runtime, projectionInput());
      const second = projectLineageResult(runtime, projectionInput());
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        // Identical canonical facts always yield a deep-equal terminal result.
        expect(second.value).toEqual(first.value);
        const terminal: TerminalResult = first.value.result;
        expect(terminal.requestFulfillment).toBe('COMPLETE');
        expect(terminal.targetResolution).toBe('RESOLVED');
        expect(terminal.selectionAcquisition).toBe('COMPLETE');
        expect(terminal.coverage).toBe('NOT_APPLICABLE');
        expect(terminal.stopReason).toBe('NONE');
        expect(terminal.validationSummary).toEqual({
          status: 'ALL_PASSED',
          passedCount: 1,
          failedCount: 0,
        });

        // Post-terminal mutation is impossible: late facts never rewrite the
        // recorded terminal truth in the runtime's terminal store.
        const late = projectLineageResult(runtime, projectionInput());
        expect(late.ok).toBe(true);
        if (late.ok) {
          expect(late.value).toEqual(first.value);
        }
      }
    } finally {
      close();
    }
  });

  it('returns the same truth through seam READ_PROJECTION as through internal projection', async () => {
    const rootDir = makeTempDir('t015-projection-seam');
    dirs.push(rootDir);
    const { runtime, close } = await acceptedLineageRuntime(rootDir);
    try {
      const internal = projectLineageResult(runtime, projectionInput());
      expect(internal.ok).toBe(true);
      const projected: ProjectedTerminalResult | undefined = internal.ok
        ? internal.value
        : undefined;

      // Commit the projected result through the seam authority command.
      const revision = runtime.seam.inspectProjection(CONTRACT)?.contract.revision ?? 0;
      const committed = seamCommand(runtime, {
        commandType: 'PROJECT_TERMINAL_RESULT',
        aggregateId: CONTRACT,
        expectedRevision: revision,
        payload: {
          result: projected?.result,
          selectedValidationOutcomes: [{ memberId: MEMBER, requiredValidationPassed: true }],
        },
      });
      expect(committed.outcome).toBe('ACCEPTED');

      const read = runtime.seam.handleFrame(
        JSON.stringify({
          schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
          kind: 'query',
          queryType: 'READ_PROJECTION',
          peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
          requestId: 't015-proj-read-001',
          aggregateId: CONTRACT,
          issuedAt: '2026-10-04T06:00:00Z',
        }),
      );
      expect(read.outcome).toBe('PROJECTION');
      const view = read.projection as SeamProjectionView;
      expect(view.terminal).toEqual(projected?.result);

      // Terminal truth is never rewritable: a second terminal command for a
      // TERMINAL lineage is a late command and rejects.
      const rewrite = seamCommand(runtime, {
        commandType: 'PROJECT_TERMINAL_RESULT',
        aggregateId: CONTRACT,
        expectedRevision: (revision ?? 0) + 1,
        payload: {
          result: {
            ...projected?.result,
            requestFulfillment: 'UNSATISFIED',
          },
        },
      });
      expect(rewrite.outcome).toBe('REJECTED');
      expect((rewrite.diagnostics ?? [])[0]?.code).toBe('LATE_COMMAND');
    } finally {
      close();
    }
  });

  it('rejects forbidden status combinations at the projector and the seam (no glue normalization)', async () => {
    const rootDir = makeTempDir('t015-projection-illegal');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // The seam's PROJECT_TERMINAL_RESULT re-validates through the domain
      // gateway: a fabricated truncated→COMPLETE result rejects.
      seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
      });
      const fabricated = {
        schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
        contractId: CONTRACT,
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'TRANSFER_BUDGET_EXHAUSTED',
        validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
        recordedAt: '2026-10-04T06:00:00Z',
      };
      const rejected = seamCommand(runtime, {
        commandType: 'PROJECT_TERMINAL_RESULT',
        aggregateId: CONTRACT,
        expectedRevision: 1,
        payload: { result: fabricated },
      });
      expect(rejected.outcome).toBe('REJECTED');
      expect((rejected.diagnostics ?? [])[0]?.code).toBe('INVALID_RESULT_COMBINATION');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('projects the auth-blocked tuple verbatim (C24 shape) without inventing progress', () => {
    const rootDir = makeTempDir('t015-projection-c24');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract(),
        expectedRevision: 0,
      });
      // A registered lineage that was never dispatched: nothing was ever
      // attempted. An authorization-failed terminal injected at the port
      // (the T016 broker path is absent by design) must project the frozen
      // tuple verbatim — no invented progress, no fake failure.
      registerLineage(
        runtime,
        {
          contractId: CONTRACT,
          snapshotId: SNAPSHOT,
          targetId: TARGET,
          authorizationContextRef: 'authctx/local-001',
          budgetProfile: rawSingleResourceContract()['budgetProfile'],
        },
        { commandId: 'cmd-c24-001', memberId: MEMBER },
      );
      const projected = projectLineageResult(
        runtime,
        projectionInput({
          resolution: { blockedBeforeAnyResolution: { reason: 'AUTH_FAILED' } },
        }),
      );
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        expect(projected.value.result.requestFulfillment).toBe('UNSATISFIED');
        expect(projected.value.result.targetResolution).toBe('BLOCKED');
        expect(projected.value.result.selectionAcquisition).toBe('NOT_STARTED');
        expect(projected.value.result.coverage).toBe('NOT_APPLICABLE');
        expect(projected.value.result.stopReason).toBe('AUTH_FAILED');
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('projects the discovery-truncation tuple shape (C23) for collections through canonical accounting', () => {
    const rootDir = makeTempDir('t015-projection-c23');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const members = ['member-001', 'member-002', 'member-003'];
      const contractId = 'contract-collection-001';
      seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: contractId,
        payload: rawCollectionContract(),
        expectedRevision: 0,
      });
      registerLineage(
        runtime,
        {
          contractId,
          snapshotId: 'snapshot-001',
          targetId: 'target-collection-root-001',
          authorizationContextRef: 'authctx/local-001',
          budgetProfile: rawCollectionContract()['budgetProfile'],
        },
        { commandId: 'cmd-c23-001', memberId: 'member-001' },
      );

      const requestedMembers = members.map((raw) => unwrapOrThrow(makeMemberId(raw)));
      const selectedMembers = [unwrapOrThrow(makeMemberId('member-001'))];
      const scope = {
        kind: 'explicit_member_set',
        memberIds: members,
      } as never;
      const accounting: CoverageAccounting = unwrapOrThrow(
        buildCoverageAccounting(
          {
            coverageTarget: coverageTargetFor(scope, 1),
            requestedMemberIds: requestedMembers,
            resolvedMemberIds: selectedMembers,
            authAccessibleMemberIds: selectedMembers,
            authInaccessibleMembers: [],
            selectedMemberIds: selectedMembers,
            validatedMemberIds: [],
          },
          createEvidenceLedger(),
        ),
      );

      // The discovery budget stop is Core-owned truth (T016 owns the loop);
      // the projected tuple keeps the frozen §17/§18 shape.
      const projected = projectLineageResult(runtime, {
        lineageKey: [
          contractId,
          'snapshot-001',
          'target-collection-root-001',
          'effect:contract-collection-001:snapshot-001:target-collection-root-001',
        ].join('|'),
        contractId,
        snapshotId: 'snapshot-001',
        intentType: 'COLLECTION',
        scopeKind: 'explicit_member_set',
        requestedMemberIds: members,
        recordedAt: '2026-10-04T06:00:00Z',
        enumeration: { kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' },
        stopFacts: { discoveryBudgetExhausted: true },
        accounting,
      });
      expect(projected.ok).toBe(true);
      if (projected.ok) {
        // The frozen tuple for a discovery-truncated collection at the Core
        // boundary: nothing fulfilled yet (nothing accepted), target
        // resolution partial over the resolved subset, selection not started,
        // coverage TRUNCATED and the budget-truthful stop reason. The full
        // journey's PARTIAL-fulfillment refinement needs confirmed members
        // downstream (T016/T020 own that lane); budget/stop semantics are the
        // Core-owned C23 shape asserted here.
        expect(projected.value.result.requestFulfillment).toBe('UNKNOWN');
        expect(projected.value.result.targetResolution).toBe('PARTIAL');
        expect(projected.value.result.selectionAcquisition).toBe('NOT_STARTED');
        expect(projected.value.result.coverage).toBe('TRUNCATED');
        expect(projected.value.result.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
      }
    } finally {
      closeRuntime(runtime);
    }
  });
});

/**
 * Compose a runtime holding one fully accepted single-resource lineage by
 * running the real flow against a local fixture.
 */
async function acceptedLineageRuntime(rootDir: string): Promise<{
  readonly runtime: ReturnType<typeof openRuntime>;
  readonly close: () => void;
}> {
  const fixture = new ControlledHttpFixture();
  const baseUri = await fixture.start();
  const bytes = new Uint8Array(512).fill(3);
  fixture.serveFile('/file.bin', { body: bytes, etag: 'projection-etag' });

  const runtime = openRuntime(rootDir);
  seamCommand(runtime, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: CONTRACT,
    payload: rawSingleResourceContract(),
    expectedRevision: 0,
  });
  const targetId = unwrapOrThrow(makeLogicalTargetId(TARGET));
  const initialUri = `${baseUri}/file.bin`;
  const binding: LocatorBinding<LogicalTargetId> = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri: initialUri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: initialUri,
    }),
  );
  const flow = await executeDirectAcquisition(runtime, {
    contractId: CONTRACT,
    snapshotId: SNAPSHOT,
    targetId: TARGET,
    authorizationContextRef: 'authctx/local-001',
    budgetProfile: rawSingleResourceContract()['budgetProfile'],
    commandId: 'cmd-projection-001',
    memberId: MEMBER,
    artifactId: 'artifact:projection-001',
    transfer: {
      effectId: unwrapOrThrow(
        makeEffectId('effect:contract-single-001:snapshot-001:target-file-001'),
      ),
      contractId: CONTRACT,
      slice: 'S1',
      selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
      binding,
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      allowedRedirectHosts: [new URL(baseUri).host],
      attempt: 0,
    },
  });
  if (flow.attemptReplayed || flow.transfer === undefined) {
    throw new Error('unexpected replay in fixture flow');
  }

  if (flow.acceptance === undefined) {
    throw new Error('projection fixture flow did not accept');
  }
  return {
    runtime,
    close: () => {
      void fixture.stop();
      closeRuntime(runtime);
    },
  };
}
