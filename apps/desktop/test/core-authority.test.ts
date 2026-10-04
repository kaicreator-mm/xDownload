/**
 * T014 suite: Core authority (cancellation/retry routing + idempotency).
 *
 * TEST_MATRIX `core-authority`:
 * - cancellation and retry route as Core control transitions; displayed
 *   outcomes come from resulting projections with no surface-local precedence;
 * - retry surfaces operate on the original failed member identities only;
 * - duplicate/repeated submits converge through seam idempotency and never
 *   create divergent UI-local outcomes.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmCollectionTask,
  confirmSingleResourceTask,
  coreProjection,
  coreRequestId,
  desktopAdapter,
  FIXED_NOW,
  lastRoutedOfType,
  sectionLines,
  startCore,
  surfaceToText,
  type CoreHandle,
} from './helpers.ts';
import {
  createSeamClient,
  createLoopbackClientTransport,
  currentSeamSchemaIdentity,
} from '@xdownload/core-seam';
import { deriveRetryDomain } from '../src/view-model.ts';

/**
 * Route a RETRY_FAILED_MEMBERS command directly through the seam, as another
 * surface (e.g. the CLI) would. The desktop adapter itself only ever routes
 * its exactly-derived retry domain; this helper establishes Core-side
 * retried-member state for repair-regression scenarios (T014-REV-P1-1).
 */
function directSeamRetry(
  core: CoreHandle,
  aggregateId: string,
  members: readonly string[],
): { readonly outcome: string } {
  const projection = coreProjection(core, aggregateId);
  if (projection === undefined) {
    throw new Error(`aggregate ${aggregateId} does not exist on the seam server`);
  }
  const response = core.server.handleFrame(
    JSON.stringify({
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'command',
      commandType: 'RETRY_FAILED_MEMBERS',
      peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
      requestId: coreRequestId(),
      aggregateId,
      expectedRevision: projection.contract.revision,
      correlation: {},
      issuedAt: FIXED_NOW,
      payload: { memberIds: [...members] },
    }),
  );
  return { outcome: response.outcome };
}

describe('core authority', () => {
  it('cancellation routes a CANCEL_LINEAGE control transition; the display follows the resulting projection', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    expect(sectionLines(outcome.display, 'Selection / progress')).toContain(
      'lineage status: ACTIVE',
    );

    const cancelled = await adapter.cancel();
    expect(cancelled.rejections).toStrictEqual([]);
    expect(lastRoutedOfType(cancelled, 'CANCEL_LINEAGE')).toBeDefined();
    // Displayed outcome comes from the re-read projection:
    expect(sectionLines(cancelled.display, 'Selection / progress')).toContain(
      'lineage status: CANCELLED',
    );
    const projection = coreProjection(core, contractId);
    expect(projection?.lineage.status).toBe('CANCELLED');
    expect(projection?.lineage.cancelOrder).toBe(1);
    await adapter.close();
    await core.stop();
  });

  it('a second cancel converges on the same Core order: no new precedence, no fabricated state change', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    await adapter.cancel();
    const second = await adapter.cancel();
    expect(second.rejections).toStrictEqual([]);
    // Core resolves the repeat through the same order (revision unchanged).
    const projection = coreProjection(core, outcome.routed[0]?.aggregateId ?? '');
    expect(projection?.lineage.cancelOrder).toBe(1);
    expect(sectionLines(second.display, 'Selection / progress')).toContain(
      'lineage status: CANCELLED',
    );
    await adapter.close();
    await core.stop();
  });

  it('a stale cancel from a concurrent surface is rejected by Core; the rejection is surfaced and the display re-syncs (C13)', async () => {
    const core = await startCore();
    const first = desktopAdapter(core);
    const second = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(first);
    const contractId = outcome.routed[0]?.aggregateId ?? '';

    // The second surface attaches to the same task and reads it…
    const synced = await second.attachAggregate(contractId);
    expect(synced.refusals).toStrictEqual([]);

    // …and cancels first; Core records its single control order.
    const secondCancel = await second.cancel();
    expect(secondCancel.rejections).toStrictEqual([]);
    expect(coreProjection(core, contractId)?.lineage.cancelOrder).toBe(1);

    // The first surface still holds the stale revision. Another surface
    // cannot inject its own precedence: Core rejects the stale transition,
    // the typed rejection is surfaced and the display re-syncs from the
    // projection.
    const staleCancel = await first.cancel();
    expect(first.lastRouted().filter((r) => r.commandType === 'CANCEL_LINEAGE')).toHaveLength(1);
    expect(staleCancel.rejections.length).toBeGreaterThan(0);
    expect(JSON.stringify(staleCancel.display)).toContain('REVISION_MISMATCH');
    expect(sectionLines(staleCancel.display, 'Selection / progress')).toContain(
      'lineage status: CANCELLED',
    );
    // Core shows exactly one cancel order — no surface-local precedence won.
    expect(coreProjection(core, contractId)?.lineage.cancelOrder).toBe(1);
    await first.close();
    await second.close();
    await core.stop();
  });

  it('retry routes RETRY_FAILED_MEMBERS on the original failed identities only when no member was retried yet (R=∅, |F|=|S| branch)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';

    // All three selected members failed (Core-internal runtime fact).
    const recorded = core.server.recordFailedMembers(contractId, [
      'member-001',
      'member-002',
      'member-003',
    ]);
    await adapter.refresh();
    expect(recorded.ok).toBe(true);

    const retry = await adapter.retryFailed();
    expect(retry.rejections).toStrictEqual([]);
    const retryCommand = lastRoutedOfType(retry, 'RETRY_FAILED_MEMBERS');
    expect(retryCommand).toBeDefined();
    // The routed identity domain is exactly the failed set — nothing else.
    const envelope = adapter
      .sentCommandEnvelopes()
      .findLast((e) => e.commandType === 'RETRY_FAILED_MEMBERS');
    expect(envelope?.payload).toStrictEqual({
      memberIds: ['member-001', 'member-002', 'member-003'],
    });
    expect(sectionLines(retry.display, 'Selection / progress')).toContain(
      'retried members: member-001, member-002, member-003',
    );
    await adapter.close();
    await core.stop();
  });

  it('after a full retry the failed domain stays exactly determined (|F|=|S|=|R|): a repeat retry routes the same original failed identities and Core converges', async () => {
    // Repair regression (T014-REV-P1-1): the former "repeat retry is refused"
    // expectation was an artifact of the rejected |selected \ retried| ===
    // |failed| predicate (candidates collapsed to ∅ → refusal). Under the
    // exact branches the domain is still exactly F = S when every selected
    // member failed and was retried, so the surface routes the same original
    // failed identities again and Core — the single authority — converges it.
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    expect(
      core.server.recordFailedMembers(contractId, ['member-001', 'member-002', 'member-003']).ok,
    ).toBe(true);
    await adapter.refresh();
    const first = await adapter.retryFailed();
    expect(first.rejections).toStrictEqual([]);
    const revisionBefore = coreProjection(core, contractId)?.contract.revision;

    const again = await adapter.retryFailed();
    expect(again.refusals).toStrictEqual([]);
    expect(again.rejections).toStrictEqual([]);
    const againEnvelope = adapter
      .sentCommandEnvelopes()
      .findLast((e) => e.commandType === 'RETRY_FAILED_MEMBERS');
    expect(againEnvelope?.payload).toStrictEqual({
      memberIds: ['member-001', 'member-002', 'member-003'],
    });
    // Core accepted the repeat: the routed domain is still exactly the
    // original failed identities (C12), and the revision advanced.
    expect(coreProjection(core, contractId)?.contract.revision).toBe((revisionBefore ?? 0) + 1);
    await adapter.close();
    await core.stop();
  });

  it('retry is refused when the projection does not expose the failed identities (no guessing)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    // Only 1 of 3 selected members failed: |selected \ retried| = 3 != 1.
    const recorded = core.server.recordFailedMembers(contractId, ['member-002']);
    await adapter.refresh();
    expect(recorded.ok).toBe(true);

    const refused = await adapter.retryFailed();
    expect(refused.routed.filter((r) => r.commandType === 'RETRY_FAILED_MEMBERS')).toHaveLength(0);
    expect(refused.refusals[0]).toContain('FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION');
    // The refusal is surfaced on the display; no command left the surface.
    expect(surfaceToText(refused.display)).toContain('FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION');
    await adapter.close();
    await core.stop();
  });

  it('repair regression T014-REV-P1-1: S={a,b,c}, F={b,c}, R={b} — the surface refuses to derive the retry domain (the old predicate routed non-failed {a,c})', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';

    // Core-side runtime facts: members 2 and 3 failed; member 2 was retried
    // by another surface routed directly through the seam.
    expect(core.server.recordFailedMembers(contractId, ['member-002', 'member-003']).ok).toBe(true);
    const direct = directSeamRetry(core, contractId, ['member-002']);
    expect(direct.outcome).toBe('ACCEPTED');
    await adapter.refresh();
    const projection = coreProjection(core, contractId);
    expect(projection?.lineage.failedMemberCount).toBe(2);
    expect(projection?.lineage.retriedMemberIds).toStrictEqual(['member-002']);

    // The projection exposes |failed| but not WHICH members failed. Neither
    // exact branch applies (|F|=2 ≠ |S|=3; |F|=2 ≠ |R|=1) → refuse, never
    // guess. The old predicate derived candidates {a,c} (|candidates| = |F|)
    // and would have routed a non-failed member while omitting still-failed b.
    const refused = await adapter.retryFailed();
    expect(refused.routed.filter((r) => r.commandType === 'RETRY_FAILED_MEMBERS')).toHaveLength(0);
    expect(refused.refusals[0]).toContain('FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION');
    expect(surfaceToText(refused.display)).toContain('FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION');
    // Core is untouched by the refused surface interaction.
    expect(coreProjection(core, contractId)?.lineage.retriedMemberIds).toStrictEqual([
      'member-002',
    ]);
    await adapter.close();
    await core.stop();
  });

  it('retry routes the retried-but-still-failed set when |F|=|R| (partial-retry branch)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 3);
    const contractId = outcome.routed[0]?.aggregateId ?? '';

    // Members 1 and 2 failed; both were retried through the seam. F={1,2},
    // R={1,2}: retried ⊆ failed with equal counts forces F = R — the domain
    // is exactly determined even though identities are not exposed.
    expect(core.server.recordFailedMembers(contractId, ['member-001', 'member-002']).ok).toBe(true);
    const direct = directSeamRetry(core, contractId, ['member-001', 'member-002']);
    expect(direct.outcome).toBe('ACCEPTED');
    await adapter.refresh();

    const retry = await adapter.retryFailed();
    expect(retry.refusals).toStrictEqual([]);
    expect(retry.rejections).toStrictEqual([]);
    const envelope = adapter
      .sentCommandEnvelopes()
      .findLast((e) => e.commandType === 'RETRY_FAILED_MEMBERS');
    expect(envelope?.payload).toStrictEqual({ memberIds: ['member-001', 'member-002'] });
    await adapter.close();
    await core.stop();
  });

  it('retry offers no path for replacement or new members (C12)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmCollectionTask(adapter, 2);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const recorded = core.server.recordFailedMembers(contractId, ['member-001', 'member-002']);
    await adapter.refresh();
    expect(recorded.ok).toBe(true);
    const retry = await adapter.retryFailed();
    expect(retry.rejections).toStrictEqual([]);

    // The adapter API accepts no member arguments at all: the routed domain
    // is always the Core-derived failed set. Verify every routed retry.
    const retryEnvelopes = adapter
      .sentCommandEnvelopes()
      .filter((e) => e.commandType === 'RETRY_FAILED_MEMBERS');
    expect(retryEnvelopes).toHaveLength(1);
    expect(retryEnvelopes[0]?.payload).toStrictEqual({
      memberIds: ['member-001', 'member-002'],
    });
    await adapter.close();
    await core.stop();
  });

  it('duplicate submits converge through seam idempotency and never create divergent UI-local outcomes', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    const before = adapter.currentDisplayText();

    // Re-submit the EXACT same envelope (same idempotent identity).
    const envelope = adapter
      .sentCommandEnvelopes()
      .find((e) => e.commandType === 'SUBMIT_CONTRACT');
    expect(envelope).toBeDefined();
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: core.target,
      peer: adapter.getDesktopPeer(),
    });
    const replay = await client.submitCommand(envelope!);
    expect(replay.outcome).toBe('ACCEPTED');
    expect(replay.acceptance?.converged).toBe(true);
    expect(replay.acceptance?.revision).toBe(1);
    await client.close();

    // The desktop's display is unchanged: no divergent UI-local outcome.
    adapter.viewAggregate(contractId);
    expect(adapter.currentDisplayText()).toBe(before);
    // Core still holds exactly one aggregate for the identity.
    expect(coreProjection(core, contractId)?.contract.revision).toBe(1);
    await adapter.close();
    await core.stop();
  });
});

describe('deriveRetryDomain — exact-branch regression (REVIEW_RESULT 5980174310, T014-REV-P1-1)', () => {
  it('refuses the reviewer counter-example S={a,b,c}, F={b,c}, R={b} (the old predicate derived and routed non-failed {a,c})', () => {
    const domain = deriveRetryDomain({
      selectedMemberIds: ['a', 'b', 'c'],
      retriedMemberIds: ['b'],
      failedMemberCount: 2,
    });
    expect(domain).toStrictEqual({
      kind: 'UNAVAILABLE',
      reason: 'FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION',
    });
  });

  it('routes selectedMemberIds when |failed| == |selected| (retried ⊆ failed ⊆ selected forces failed = selected)', () => {
    const domain = deriveRetryDomain({
      selectedMemberIds: ['a', 'b', 'c'],
      retriedMemberIds: ['a'],
      failedMemberCount: 3,
    });
    expect(domain).toStrictEqual({ kind: 'DETERMINED', memberIds: ['a', 'b', 'c'] });
  });

  it('routes retriedMemberIds when |failed| == |retried| (retried ⊆ failed with equal counts forces failed = retried)', () => {
    const domain = deriveRetryDomain({
      selectedMemberIds: ['a', 'b', 'c'],
      retriedMemberIds: ['b', 'c'],
      failedMemberCount: 2,
    });
    expect(domain).toStrictEqual({ kind: 'DETERMINED', memberIds: ['b', 'c'] });
  });

  it('refuses every other count: the failed set cannot be located between selected and retried', () => {
    const refused = deriveRetryDomain({
      selectedMemberIds: ['a', 'b', 'c'],
      retriedMemberIds: ['a'],
      failedMemberCount: 2,
    });
    expect(refused.kind).toBe('UNAVAILABLE');
  });

  it('keeps the zero-failed refusal', () => {
    expect(
      deriveRetryDomain({ selectedMemberIds: ['a'], retriedMemberIds: [], failedMemberCount: 0 }),
    ).toStrictEqual({ kind: 'UNAVAILABLE', reason: 'NO_FAILED_MEMBERS' });
  });
});
