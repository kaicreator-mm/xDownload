/**
 * TEST_MATRIX suite `continuation-rules` (+ C11, C12; negatives
 * continuation-scope-inferred-from-budget-exhaustion,
 * snapshot-member-replacement-hidden-by-count-equality,
 * successor-identity-skipped-for-scope-expansion).
 *
 * Must prove (fixture level):
 * - a continuation request is admitted only through the composed lane within
 *   the frozen scope; a budget-exhaustion "justification" is refused outright;
 * - admitted expansion derives successor contract/snapshot identity; the
 *   original snapshot remains immutable historical authority (C11);
 * - failed-member retry operates on the original frozen member identities
 *   only (planFailedMemberRetry; C12) with no replacement membership, and
 *   contract/snapshot identity is immutable across retry;
 * - detectFrozenMembershipDrift rejects silent member drift through the
 *   composed flow — count equality never hides replacement.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
} from '@xdownload/domain-contracts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';
import type { DiscoveryEvent } from '@xdownload/discovery-recipe';
import { executeDirectAcquisition, projectLineageResult } from '@xdownload/core-runtime';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import {
  assertContinuationWithinFrozenScope,
  detectFrozenMembershipDrift,
  expandThroughSuccessor,
  planFailedMemberRetry,
  requestContinuation,
  runCollectionFlow,
} from '../src/index.ts';
import {
  budgetsOpen,
  currentPageContract,
  finiteSetContract,
  mid,
  payload,
  playlistContract,
  seedBytes,
  sha256,
  snapshotFor,
} from './fixtures.ts';

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

const FROZEN = ['c-member-001', 'c-member-002', 'c-member-003'];

async function startFixture(members: readonly string[]): Promise<string> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const member of members) {
    fixture.serveFile(`/${member}.bin`, { body: seedBytes(256, member), etag: `c-${member}` });
  }
  return baseUri;
}

describe('T016 continuation-rules', () => {
  it('admits continuation only within the frozen scope and refuses budget-inferred continuation (negative)', () => {
    const noneContract = currentPageContract();
    // continuation_scope=NONE: every user request needs a successor identity.
    expect(
      requestContinuation({
        contract: noneContract,
        declaredBoundConsumed: false,
        justification: { kind: 'EXPLICIT_USER_REQUEST', requestKind: 'LOAD_MORE' },
      }),
    ).toEqual({ action: 'SUCCESSOR_REQUIRED', reason: 'CONTINUATION_SCOPE_NONE' });

    // Budget exhaustion is never a continuation justification in any scope.
    const declaredContract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 3 },
      'DECLARED_CONTINUATION_EDGES',
    );
    expect(
      requestContinuation({
        contract: declaredContract,
        declaredBoundConsumed: false,
        justification: { kind: 'BUDGET_EXHAUSTED', domain: 'discovery' },
      }),
    ).toEqual({ action: 'REFUSED', reason: 'BUDGET_IS_NOT_CONTINUATION_AUTHORITY' });
    expect(
      requestContinuation({
        contract: noneContract,
        declaredBoundConsumed: false,
        justification: { kind: 'BUDGET_EXHAUSTED', domain: 'global_safety' },
      }),
    ).toEqual({ action: 'REFUSED', reason: 'BUDGET_IS_NOT_CONTINUATION_AUTHORITY' });

    // An explicit user request within the frozen declared bound is admitted;
    // a consumed bound requires a successor.
    expect(
      requestContinuation({
        contract: declaredContract,
        declaredBoundConsumed: false,
        justification: { kind: 'EXPLICIT_USER_REQUEST', requestKind: 'CONTINUE_NEXT_PAGE' },
      }),
    ).toEqual({ action: 'RUN_WITHIN_FROZEN_SCOPE' });
    expect(
      requestContinuation({
        contract: declaredContract,
        declaredBoundConsumed: true,
        justification: { kind: 'EXPLICIT_USER_REQUEST', requestKind: 'INCLUDE_MORE' },
      }),
    ).toEqual({ action: 'SUCCESSOR_REQUIRED', reason: 'FROZEN_BOUND_ALREADY_CONSUMED' });
  });

  it('derives confirmed successor identity for expansion while the original stays immutable (C11)', () => {
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 2 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, FROZEN.slice(0, 2));
    const contractBefore = JSON.stringify(contract);
    const snapshotBefore = JSON.stringify(snapshot);

    const expansion = expandThroughSuccessor({
      previousContract: contract,
      previousSnapshot: snapshot,
      newContinuationScope: { kind: 'DECLARED_NATURAL_END' },
      newSnapshotId: 'snapshot-successor-001',
      newSelectedMemberIds: [...FROZEN, 'c-member-004'],
      newSelectionClaims: [
        {
          kind: 'BATCH' as const,
          confirmationType: 'CONFIRM_SELECTION' as const,
          memberRefs: [...FROZEN, 'c-member-004'].map((id) => mid(id)),
        },
      ],
      confirmedAt: '2026-10-04T05:00:00Z',
    });
    expect(expansion.ok).toBe(true);
    if (!expansion.ok) throw new Error('unreachable');
    const bundle = expansion.value;

    // Fresh identity, explicit back-link, confirmed successor.
    expect(bundle.successorContract.contractId).not.toBe(contract.contractId);
    expect(bundle.successorContract.supersedesContractId).toBe(contract.contractId);
    expect(bundle.confirmedSuccessorContract.status).toBe('CONFIRMED');
    expect(bundle.successorSnapshot.snapshotId).toBe('snapshot-successor-001');
    expect(bundle.successorSnapshot.supersedesSnapshotId).toBe(snapshot.snapshotId);
    expect([...bundle.successorSnapshot.selectedMemberIds]).toEqual([...FROZEN, 'c-member-004']);
    expect(bundle.originalContractId).toBe(contract.contractId);
    expect(bundle.originalSnapshotId).toBe(snapshot.snapshotId);

    // The original contract/snapshot are immutable historical authority.
    expect(JSON.stringify(contract)).toBe(contractBefore);
    expect(JSON.stringify(snapshot)).toBe(snapshotBefore);

    // A copy of the frozen scope is not a semantic successor.
    const copy = expandThroughSuccessor({
      previousContract: bundle.confirmedSuccessorContract,
      previousSnapshot: bundle.successorSnapshot,
      newContinuationScope: { kind: 'DECLARED_NATURAL_END' },
      newSnapshotId: 'snapshot-successor-002',
      confirmedAt: '2026-10-04T05:10:00Z',
    });
    expect(copy.ok).toBe(false);
  });

  it('detects frozen-membership drift even when counts match (negative: replacement hidden by count equality)', () => {
    const contract = finiteSetContract(FROZEN);
    const snapshot = snapshotFor(contract, FROZEN);
    // Same membership: no drift.
    expect(detectFrozenMembershipDrift({ snapshot, currentlyObservedMemberIds: FROZEN }).ok).toBe(
      true,
    );
    // Order-insensitive identity comparison: still no drift.
    expect(
      detectFrozenMembershipDrift({
        snapshot,
        currentlyObservedMemberIds: [FROZEN[2]!, FROZEN[0]!, FROZEN[1]!],
      }).ok,
    ).toBe(true);
    // Same count, different identity: drift is detected — count equality
    // never hides replacement (C11/C01).
    const replaced = detectFrozenMembershipDrift({
      snapshot,
      currentlyObservedMemberIds: ['c-member-001', 'c-member-002', 'c-member-replacement'],
    });
    expect(replaced.ok).toBe(false);
    if (!replaced.ok) {
      expect(replaced.diagnostics[0]?.code).toBe('MEMBERSHIP_DRIFT');
    }
  });

  it('retries exactly the original failed frozen members on the frozen identities with no replacement membership (C12)', async () => {
    const members = [...FROZEN];
    const served = await startFixture(members);
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, members);

    const rootDir = makeTempDir('t016-c12-retry');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const broker = createAuthBroker();
      const events: DiscoveryEvent[] = members.map(
        (memberId) =>
          ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
      );
      const firstOutcome = await runCollectionFlow({
        runtime,
        broker,
        slice: 'S5',
        contract,
        snapshot,
        events,
        budgetSteps: [budgetsOpen],
        deliveryFor: (memberId) => ({
          kind: 'direct',
          targetId: memberId,
          artifactId: `artifact:${memberId}`,
          locator: { kind: 'direct', uri: `${served}/${memberId}.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${served}/${memberId}.bin`,
          },
          declaredRedirectHosts: [new URL(served).host],
          // Corrupt expectation for the second member: its transfer fails
          // validation (wrong digest) and surfaces truthfully.
          ...(memberId === members[1]
            ? { expectedSha256: sha256(payload(256, 999)) }
            : { expectedSha256: sha256(seedBytes(256, memberId)) }),
        }),
        authorization: {
          origin: served,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:c12',
        },
        recordedAt: '2026-10-04T05:20:00Z',
      });
      expect(firstOutcome.ok).toBe(true);
      if (!firstOutcome.ok) throw new Error('unreachable');
      const failed = firstOutcome.result.memberOutcomes
        .filter((outcome) => !outcome.accepted)
        .map((outcome) => outcome.memberId);
      expect(failed).toEqual([members[1]!]);

      // The composed retry domain: exactly the original failed frozen
      // identities; adding or replacing members is rejected.
      const retryPlan = planFailedMemberRetry({ snapshot, failedMemberIds: failed });
      expect(retryPlan.ok).toBe(true);
      if (retryPlan.ok) {
        expect([...retryPlan.value]).toEqual([members[1]!]);
      }
      const smuggled = planFailedMemberRetry({
        snapshot,
        failedMemberIds: [members[1]!, 'c-member-newcomer'],
      });
      expect(smuggled.ok).toBe(false);

      // The composed retry operates on the frozen identities only: the failed
      // member's lineage is durably bound to the ORIGINAL frozen member set,
      // and contract/snapshot identity is immutable across the retry domain.
      const retriedMember = retryPlan.ok ? retryPlan.value[0]! : undefined;
      expect(retriedMember).toBe(members[1]!);
      const failedFlow = firstOutcome.result.memberOutcomes.find(
        (outcome) => outcome.memberId === retriedMember,
      );
      expect(failedFlow?.kind).toBe('ACQUIRED');

      // A duplicate submission of the same canonical effect converges on the
      // durable truth instead of double-executing the external transfer —
      // retry authority stays with the frozen member identity, never a new
      // effect identity.
      const retryBytes = seedBytes(256, retriedMember!);
      const retryLocator = unwrapOrThrow(
        bindLocator(
          { kind: 'direct', uri: `${served}/${retriedMember!}.bin` },
          unwrapOrThrow(makeLogicalTargetId(retriedMember!)),
          {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${served}/${retriedMember!}.bin`,
          },
        ),
      );
      const retryFlow = await executeDirectAcquisition(runtime, {
        contractId: contract.contractId,
        snapshotId: snapshot.snapshotId,
        targetId: retriedMember!,
        authorizationContextRef: 'authctx/local-s5',
        budgetProfile: contract.budgetProfile,
        frozenMemberIds: [...snapshot.selectedMemberIds],
        commandId: `${contract.contractId}:${retriedMember!}:retry-1`,
        memberId: retriedMember!,
        artifactId: `artifact:${retriedMember!}`,
        transfer: {
          effectId: unwrapOrThrow(
            makeEffectId(`effect:${contract.contractId}:${snapshot.snapshotId}:${retriedMember!}`),
          ),
          contractId: contract.contractId,
          slice: 'S1',
          selectedMemberId: unwrapOrThrow(makeMemberId(retriedMember!)),
          binding: retryLocator,
          expectedSha256: sha256(retryBytes),
          allowedRedirectHosts: [new URL(served).host],
          attempt: 1,
        },
      });
      // The durable attempt already exists: the flow reconciles from durable
      // truth instead of re-executing (at-least-once discipline).
      expect(retryFlow.attemptReplayed).toBe(true);

      // The durable ledger carries only the original frozen member identities
      // — the retry domain created no new or replacement membership.
      const memberIds = new Set(runtime.writer.reader.workItems().map((item) => item.memberId));
      expect([...memberIds].sort()).toEqual([...members].sort());

      // The composed projection stays truthful: the still-unrepaired member is
      // never absorbed into a synthesized COMPLETE.
      const projected = projectLineageResult(runtime, {
        lineageKey: firstOutcome.result.memberOutcomes[0]!.flow!.lineageKey,
        contractId: contract.contractId,
        snapshotId: snapshot.snapshotId,
        intentType: 'COLLECTION',
        scopeKind: 'current_page',
        requestedMemberIds: [...snapshot.selectedMemberIds],
        recordedAt: '2026-10-04T05:30:00Z',
        enumeration: { kind: 'CONTINUATION_CLOSED' },
        accounting: firstOutcome.result.accounting,
        requiredLayers: contract.validationPolicy.requiredLayers,
      });
      expect(projected.ok).toBe(true);
      const terminal = projected.ok ? projected.value.result : undefined;
      // One member succeeded, the failed member's required validation is
      // terminal truth: the request stays truthfully partial and the failed
      // selection can never be absorbed into a COMPLETE.
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.selectionAcquisition).toBe('FAILED');
      expect(terminal?.coverage).not.toBe('VERIFIED_COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('rejects a scope change under the same contract identity — expansion requires successor identity (negative)', () => {
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 2 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, FROZEN.slice(0, 2));
    // Executing a larger continuation than the frozen bound under the same
    // contract is a SCOPE_MUTATION — never silently accepted (successor
    // identity is the only path, proven positive in the C11 test above).
    const withinFrozenScope = assertContinuationWithinFrozenScope({
      contract,
      executedContinuation: { kind: 'DECLARED_BATCH_COUNT', count: 2 },
    });
    expect(withinFrozenScope.ok).toBe(true);
    const enlarged = assertContinuationWithinFrozenScope({
      contract,
      executedContinuation: { kind: 'DECLARED_BATCH_COUNT', count: 5 },
    });
    expect(enlarged.ok).toBe(false);
    if (!enlarged.ok) {
      expect(enlarged.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
    }
    expect(snapshot.continuationScope).toEqual({ kind: 'DECLARED_BATCH_COUNT', count: 2 });
  });
});
