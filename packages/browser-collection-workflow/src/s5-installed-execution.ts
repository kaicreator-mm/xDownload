/**
 * #151 installed S5 collection execution driver — the Core-runtime side of
 * the browser current-page batch journey.
 *
 * The seam's synchronous authority apply only registered one durable S5
 * execution intent over the ALREADY durably Core-confirmed page group (the
 * frozen CONFIRMED contract + BATCH snapshot); this driver performs the REAL
 * bounded per-member acquisition strictly after the accepted-command journal
 * commit through the reviewed #158 confirmed-group path
 * (`runConfirmedCurrentPageGroup` → the generic T016 collection flow → the
 * Core-owned direct HTTP engine). There is no second executor and no
 * browser-side byte lane: the members are delivered by Core itself, which is
 * exactly what distinguishes S5 from N separate S2 journeys.
 *
 * Truth discipline (the S1/S3/S4 drive discipline):
 * - reconcile-first: an already-terminal lineage converges without any new
 *   effect; a durably CANCELLED lineage never records an executed terminal
 *   across the cutoff (the projection stays the truthful CANCELLED state);
 * - a driver failure never invents terminal truth: the intent stays
 *   registered so a later reconcile can re-drive it;
 * - per-member outcomes and the aggregate terminal are recorded verbatim
 *   from the collection flow (`recordS5MemberOutcomes` +
 *   `recordExecutedTerminal`); the driver computes no status of its own.
 */

import { createAuthBroker } from '@xdownload/browser-auth-broker';
import type { CoreRuntime } from '@xdownload/core-runtime';
import { budgetRemaining, type BudgetRemaining } from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type S5ConfirmedGroupRecord,
  type S5ExecutionIntentInput,
  type S5MemberOutcomeRecord,
  type S5PreparedGroupRecord,
  type SeamResult,
} from '@xdownload/core-seam';
import { runConfirmedCurrentPageGroup } from './s5-confirmed-group.ts';
import type { MemberDelivery } from './collection-flow.ts';

/** The zero-consumed state of every budget domain (fresh confirmed group). */
const ZERO_CONSUMED = {
  discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
  transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
} as const;

/** Least-authority TTL of the Core-zone per-member capabilities (S2 lane parity). */
const S5_AUTH_TTL_MS = 600_000;

function seamLineageStatus(
  runtime: CoreRuntime,
  aggregateId: string,
): 'ACTIVE' | 'CANCELLED' | 'TERMINAL' | undefined {
  return runtime.seam.inspectProjection(aggregateId)?.lineage.status;
}

/**
 * Drive one registered S5 collection execution to a Core-derived terminal.
 * Every member delivery derives from the Core-frozen prepare record joined
 * to the confirmed selection — the browser's observed hrefs never re-enter
 * at execution time.
 */
export async function driveS5CollectionExecution(
  runtime: CoreRuntime,
  input: {
    readonly aggregateId: string;
    readonly requestId: string;
    readonly confirmed: S5ConfirmedGroupRecord;
    readonly prepared: S5PreparedGroupRecord;
  },
): Promise<SeamResult<void>> {
  const status = seamLineageStatus(runtime, input.aggregateId);
  if (status === 'TERMINAL' || status === 'CANCELLED') {
    // Reconcile convergence: nothing more to record — the projection already
    // carries the durable truth (terminal, or the user-cancelled cutoff).
    return seamOk(undefined);
  }
  const { confirmed, prepared } = input;
  const frozenHrefs = new Map(prepared.members.map((member) => [member.memberId, member.href]));
  const selected = confirmed.selectedMemberIds.filter((memberId) => frozenHrefs.has(memberId));
  if (selected.length !== confirmed.selectedMemberIds.length) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'confirmed.selectedMemberIds',
        'the confirmed selection references members outside the frozen prepare record; execution fails closed',
        'L2-#151-§execute',
      ),
    ]);
  }
  let pageHost: string;
  try {
    pageHost = new URL(prepared.pageOrigin).host;
  } catch {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'prepared.pageOrigin',
        'the frozen page origin is not a parseable http(s) origin; execution fails closed',
      ),
    ]);
  }
  const budgetsOpen: BudgetRemaining = budgetRemaining(
    confirmed.contract.budgetProfile,
    ZERO_CONSUMED,
  );
  const deliveryFor = (memberId: string): MemberDelivery => {
    const href = frozenHrefs.get(memberId) as string;
    let memberHost: string;
    try {
      memberHost = new URL(href).host;
    } catch {
      memberHost = pageHost;
    }
    return {
      kind: 'direct',
      targetId: memberId,
      artifactId: `artifact:${memberId}`,
      locator: { kind: 'direct', uri: href },
      provenance: { binding: 'SELECTED_RESOURCE_PROVENANCE', originLocatorUri: href },
      declaredRedirectHosts: Array.from(new Set([pageHost, memberHost])),
      // No publisher digest exists for a page-observed anchor; the member's
      // own bytes are the acceptance evidence (the conservative provenance
      // basis, never a fabricated digest oracle — C34).
      expectedSha256: undefined,
    };
  };
  const result = await runConfirmedCurrentPageGroup({
    runtime,
    broker: createAuthBroker(),
    contract: confirmed.contract,
    snapshot: confirmed.snapshot,
    events: [
      ...selected.map((memberId) => ({
        kind: 'MEMBER_OBSERVED' as const,
        memberId,
        basis: 'FROZEN_BASIS' as const,
      })),
      { kind: 'COLLECTION_ENUMERATION_CLOSED' as const },
    ],
    budgetSteps: [budgetsOpen],
    deliveryFor,
    authorization: {
      origin: prepared.pageOrigin,
      provenanceChain: prepared.provenanceKey,
      ttlMs: S5_AUTH_TTL_MS,
      issueDecisionToken: `user-confirm:${confirmed.contract.contractId}`,
    },
    recordedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    // Truthful refusal: the typed collection-flow rejection surfaces as a
    // driver failure; the intent stays registered (supervised bounded retry
    // / restart reconcile) and no terminal is ever invented here.
    const rejection = result.rejection;
    const detail =
      'error' in rejection && rejection.error instanceof Error
        ? rejection.error.message
        : 'stage' in rejection
          ? rejection.stage
          : 'unknown';
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        `s5.collection.${detail}`,
        `the confirmed S5 group execution was refused by the collection flow (stage ${detail}); no terminal is invented`,
        'L2-#151-§execute',
      ),
    ]);
  }
  if (
    result.result.terminalSource !== 'CORE_PROJECTOR' ||
    result.result.terminalResult === undefined
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        's5.collection.terminal',
        'the collection flow completed without a Core-projector terminal; refusing to record an invented terminal',
        'L2-#151-§execute',
      ),
    ]);
  }
  const members: S5MemberOutcomeRecord[] = result.result.memberOutcomes.map((outcome) => ({
    memberId: outcome.memberId,
    href: frozenHrefs.get(outcome.memberId) ?? '',
    outcome: outcome.kind,
    accepted: outcome.accepted,
    detail:
      outcome.kind === 'AUTH_DENIED'
        ? (outcome.auth?.reasons.map((reason) => reason.message).join('; ') ??
          'authorization denied')
        : outcome.accepted
          ? 'durably accepted with verified bytes'
          : 'acquisition did not reach durable acceptance',
  }));
  const recordedMembers = runtime.seam.recordS5MemberOutcomes(input.aggregateId, members);
  if (!recordedMembers.ok) {
    return recordedMembers;
  }
  const statusNow = seamLineageStatus(runtime, input.aggregateId);
  if (statusNow === 'CANCELLED') {
    // A durable user cancel crossed the drive: never record an executed
    // terminal across the cutoff; the truthful CANCELLED closure stays.
    return seamOk(undefined);
  }
  return runtime.seam.recordExecutedTerminal(input.aggregateId, result.result.terminalResult);
}

/**
 * The composition factory consumed by the Core runtime host: produces the
 * supervised S5 drive function bound to one authoritative Core runtime
 * (dependency inversion — this package depends on core-runtime, never the
 * reverse).
 */
export function createS5CollectionDriver(): (
  runtime: CoreRuntime,
) => (input: S5ExecutionIntentInput) => Promise<SeamResult<void>> {
  return (runtime: CoreRuntime) => (input) => driveS5CollectionExecution(runtime, input);
}
