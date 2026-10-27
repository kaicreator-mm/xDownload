/**
 * #154 installed S6 explicit-collection execution driver — the Core-runtime
 * side of the browser finite playlist/gallery journey.
 *
 * The seam's synchronous authority apply only registered one durable S6
 * execution intent over the ALREADY durably Core-confirmed collection (the
 * frozen CONFIRMED contract + BATCH snapshot + the frozen declared-range
 * page records); this driver performs the REAL bounded per-member acquisition
 * strictly after the accepted-command journal commit through the reviewed
 * confirmed-collection path (`runConfirmedS6Collection` → the generic T016
 * collection flow → the Core-owned direct HTTP engine). There is no second
 * executor and no browser-side byte lane: the members are delivered by Core
 * itself. The declared page range was already frozen at PREPARE/RECORD time —
 * the driver NEVER navigates, widens or re-derives membership.
 *
 * Truth discipline (the S1/S3/S4/S5 drive discipline):
 * - reconcile-first: an already-terminal lineage converges without any new
 *   effect; a durably CANCELLED lineage never records an executed terminal
 *   across the cutoff (the projection stays the truthful CANCELLED state);
 * - a driver failure never invents terminal truth: the intent stays
 *   registered so a later reconcile can re-drive it;
 * - per-member outcomes and the aggregate terminal are recorded verbatim
 *   from the collection flow (`recordS6MemberOutcomes` +
 *   `recordExecutedTerminal`); the driver computes no status of its own.
 * Coverage truth is the T007 projector output over the frozen walked pages:
 * an incomplete declared-range walk yields truthful TRUNCATED/UNKNOWN —
 * never a COMPLETE manufactured from the subset that happened to be walked.
 */

import { createAuthBroker } from '@xdownload/browser-auth-broker';
import type { CoreRuntime } from '@xdownload/core-runtime';
import { budgetRemaining, type BudgetRemaining } from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type S6ConfirmedCollectionRecord,
  type S6ExecutionIntentInput,
  type S6MemberOutcomeRecord,
  type S6PageRecord,
  type S6PreparedCollectionRecord,
  type SeamResult,
} from '@xdownload/core-seam';
import { runConfirmedS6Collection } from './s6-confirmed-collection.ts';
import type { MemberDelivery } from './collection-flow.ts';

/** The zero-consumed state of every budget domain (fresh confirmed collection). */
const ZERO_CONSUMED = {
  discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
  transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
  globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
} as const;

/** Least-authority TTL of the Core-zone per-member capabilities (S2 lane parity). */
const S6_AUTH_TTL_MS = 600_000;

function seamLineageStatus(
  runtime: CoreRuntime,
  aggregateId: string,
): 'ACTIVE' | 'CANCELLED' | 'TERMINAL' | undefined {
  return runtime.seam.inspectProjection(aggregateId)?.lineage.status;
}

/**
 * Drive one registered S6 collection execution to a Core-derived terminal.
 * Every member delivery derives from the Core-frozen page records joined to
 * the confirmed selection — the browser's observed hrefs never re-enter at
 * execution time, and pages outside the frozen declared range never exist
 * here.
 */
export async function driveS6CollectionExecution(
  runtime: CoreRuntime,
  input: {
    readonly aggregateId: string;
    readonly requestId: string;
    readonly confirmed: S6ConfirmedCollectionRecord;
    readonly prepared: S6PreparedCollectionRecord;
    readonly pages: readonly S6PageRecord[];
  },
): Promise<SeamResult<void>> {
  const status = seamLineageStatus(runtime, input.aggregateId);
  if (status === 'TERMINAL' || status === 'CANCELLED') {
    // Reconcile convergence: nothing more to record — the projection already
    // carries the durable truth (terminal, or the user-cancelled cutoff).
    return seamOk(undefined);
  }
  const { confirmed, prepared, pages } = input;
  if (pages.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'pages',
        'the registered S6 execution carries no frozen observed pages; execution fails closed',
        'L2-#154-§execute',
      ),
    ]);
  }
  const frozenHrefs = new Map<string, string>();
  for (const page of pages) {
    for (const member of page.members) {
      frozenHrefs.set(member.memberId, member.href);
    }
  }
  const selected = confirmed.selectedMemberIds.filter((memberId) => frozenHrefs.has(memberId));
  if (selected.length !== confirmed.selectedMemberIds.length) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'confirmed.selectedMemberIds',
        'the confirmed selection references members outside the frozen page records; execution fails closed',
        'L2-#154-§execute',
      ),
    ]);
  }
  let collectionHost: string;
  try {
    collectionHost = new URL(prepared.collectionOrigin).host;
  } catch {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'prepared.collectionOrigin',
        'the frozen collection origin is not a parseable http(s) origin; execution fails closed',
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
      memberHost = collectionHost;
    }
    return {
      kind: 'direct',
      targetId: memberId,
      artifactId: `artifact:${memberId}`,
      locator: { kind: 'direct', uri: href },
      provenance: { binding: 'SELECTED_RESOURCE_PROVENANCE', originLocatorUri: href },
      declaredRedirectHosts: Array.from(new Set([collectionHost, memberHost])),
      // No publisher digest exists for a page-observed anchor; the member's
      // own bytes are the acceptance evidence (the conservative provenance
      // basis, never a fabricated digest oracle — C34).
      expectedSha256: undefined,
    };
  };
  // The bounded discovery feed is derived from the frozen declared-range
  // pages only: one PAGE_OBSERVED per frozen page (in range order) and one
  // FROZEN_BASIS MEMBER_OBSERVED per confirmed member. Under a
  // collection_page_range scope the walk stops USER_SCOPE_REACHED exactly
  // when every declared page was observed — budget exhaustion can never
  // create that stop, and an unwalked page keeps the session truthfully
  // unclosed. No COLLECTION_ENUMERATION_CLOSED is fed: closing the
  // enumeration by hand could mask an incomplete declared-range walk.
  // Member observations come BEFORE their page event: the declared-range
  // walk stops (USER_SCOPE_REACHED) the moment every declared page was
  // observed, and any member fed after the stop would be silently dropped —
  // the frozen members of the final page must be admitted first.
  const events = [
    ...pages.flatMap((page) => [
      ...page.members
        .filter((member) => selected.includes(member.memberId))
        .map((member) => ({
          kind: 'MEMBER_OBSERVED' as const,
          memberId: member.memberId,
          basis: 'FROZEN_BASIS' as const,
        })),
      {
        kind: 'PAGE_OBSERVED' as const,
        logicalPage: page.pageNumber,
        pageIdentity: `${prepared.prepareId}:p${String(page.pageNumber)}`,
      },
    ]),
  ];
  const result = await runConfirmedS6Collection({
    runtime,
    broker: createAuthBroker(),
    contract: confirmed.contract,
    snapshot: confirmed.snapshot,
    events,
    budgetSteps: [budgetsOpen],
    deliveryFor,
    authorization: {
      origin: prepared.collectionOrigin,
      provenanceChain: prepared.provenanceKey,
      ttlMs: S6_AUTH_TTL_MS,
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
          ? 'reason' in rejection && typeof rejection.reason === 'string'
            ? `${rejection.stage}:${rejection.reason}`
            : rejection.stage
          : 'unknown';
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        `s6.collection.${detail}`,
        `the confirmed S6 collection execution was refused by the collection flow (stage ${detail}); no terminal is invented`,
        'L2-#154-§execute',
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
        's6.collection.terminal',
        'the collection flow completed without a Core-projector terminal; refusing to record an invented terminal',
        'L2-#154-§execute',
      ),
    ]);
  }
  const members: S6MemberOutcomeRecord[] = result.result.memberOutcomes.map((outcome) => ({
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
  const recordedMembers = runtime.seam.recordS6MemberOutcomes(input.aggregateId, members);
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
 * supervised S6 drive function bound to one authoritative Core runtime
 * (dependency inversion — this package depends on core-runtime, never the
 * reverse).
 */
export function createS6CollectionDriver(): (
  runtime: CoreRuntime,
) => (input: S6ExecutionIntentInput) => Promise<SeamResult<void>> {
  return (runtime: CoreRuntime) => (input) => driveS6CollectionExecution(runtime, input);
}
