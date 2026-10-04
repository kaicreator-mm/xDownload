/**
 * T006 lifecycle control state machine.
 *
 * Facts decide, machines derive: `reduceOneLineage` folds committed durable
 * control facts into a deterministic lineage view, so the same fact sequence
 * always yields the same state — including after process death/reopen.
 *
 * Authority model: the latest committed control authority wins. An explicit
 * authorized resume supersedes a prior cancellation (it reopens processing);
 * a later cancellation supersedes the resume again. Acceptance, once durable
 * and standing under the cutoff, is terminal for the effect identity.
 *
 * `controlTransition` is the exhaustive (state, event) legality table: every
 * pair is either an asserted transition or a typed rejection — there are no
 * "unexpected success" gaps.
 */

import type { MemberId } from '@xdownload/domain-contracts';
import { acceptanceCutoff, type CutoffDecision } from './cutoff.ts';
import type {
  CommitSequence,
  DurableControlFact,
  EffectOutcome,
  LineageBinding,
  LineageKey,
} from './facts.ts';
import { controlReject, type ControlResult } from './rejections.ts';

/** Lineage-level control states (per frozen Contract/Snapshot/target/effect lineage). */
export type LineageControlState = 'ACTIVE' | 'CANCELLED_SUPPRESSED' | 'ACCEPTED';

/** Control event kinds driven by the Core scheduler methods. */
export type ControlEventType =
  | 'SUBMIT_LINEAGE'
  | 'CANCEL'
  | 'ACCEPT'
  | 'RESUME'
  | 'DISPATCH'
  | 'START_ATTEMPT'
  | 'RECORD_OUTCOME'
  | 'RECONCILE';

/** Derived per-lineage control view (rebuildable from facts alone). */
export interface LineageView {
  readonly lineageKey: LineageKey;
  readonly state: LineageControlState;
  readonly binding?: LineageBinding;
  readonly frozenMemberIds: readonly MemberId[];
  /** Sequence of the lineageSubmitted fact; 0 when the lineage was never registered. */
  readonly submittedAt: CommitSequence;
  /** Sequence of the latest cancellation authority fact, if any. */
  readonly cancelledAt?: CommitSequence;
  /** Sequence of the first durable acceptance fact, if any. */
  readonly acceptedAt?: CommitSequence;
  /** Sequence of the latest explicit resume authorization, if any. */
  readonly resumedAt?: CommitSequence;
  /** All attempt ids observed for the lineage effect (at-least-once, order kept). */
  readonly attemptIds: readonly string[];
  /** Sequence of the latest SUCCEEDED outcome, if any. */
  readonly succeededAt?: CommitSequence;
  /** First recorded outcome per attempt id (never rewritten; replays reconcile). */
  readonly outcomes: ReadonlyMap<
    string,
    { readonly outcome: EffectOutcome; readonly sequence: CommitSequence }
  >;
  readonly reconciliationCount: number;
}

export function emptyLineageView(lineageKey: LineageKey): LineageView {
  return {
    lineageKey,
    state: 'ACTIVE',
    frozenMemberIds: [],
    submittedAt: 0,
    attemptIds: [],
    outcomes: new Map(),
    reconciliationCount: 0,
  };
}

/**
 * The cancellation authority currently governing the lineage: the latest
 * cancellation, unless a later explicit resume superseded it. This is what
 * makes "explicit retry/resume reopens processing" and "a re-cancel after
 * resume suppresses again" both derivable from facts.
 */
export function effectiveCancellation(view: LineageView): CommitSequence | undefined {
  if (view.cancelledAt === undefined) {
    return undefined;
  }
  if (view.resumedAt !== undefined && view.resumedAt > view.cancelledAt) {
    return undefined;
  }
  return view.cancelledAt;
}

/** The cutoff decision currently governing the lineage (pure ordering). */
export function cutoffDecisionFor(view: LineageView): CutoffDecision {
  return acceptanceCutoff(effectiveCancellation(view), view.acceptedAt);
}

/** New external dispatch (discovery/transfer/retry) is a state property, budgets aside. */
export function isDispatchAllowed(view: LineageView): boolean {
  return view.state === 'ACTIVE';
}

/**
 * Bounded reconciliation is permitted in every state once the lineage exists:
 * suppression blocks new work and automatic acceptance, never the
 * establishment of truthful pre-existing durable/external facts.
 */
export function isReconciliationPermitted(view: LineageView): boolean {
  return view.submittedAt > 0;
}

/** Deterministic state derivation from accumulated authority sequences. */
function deriveState(view: LineageView): LineageControlState {
  if (view.acceptedAt !== undefined) {
    const effectiveCancel = effectiveCancellation(view);
    if (effectiveCancel === undefined || view.acceptedAt < effectiveCancel) {
      return 'ACCEPTED';
    }
    // A well-formed log can never contain acceptance after unresumed
    // cancellation (the transition table rejects it); a malformed log fails
    // closed to suppression.
    return 'CANCELLED_SUPPRESSED';
  }
  return effectiveCancellation(view) === undefined ? 'ACTIVE' : 'CANCELLED_SUPPRESSED';
}

/** Reduce all committed facts into one view per lineage, in commit order. */
export function reduceLineages(
  facts: readonly DurableControlFact[],
): ReadonlyMap<LineageKey, LineageView> {
  const views = new Map<LineageKey, LineageView>();
  for (const fact of facts) {
    let view = views.get(fact.lineageKey);
    if (view === undefined) {
      view = emptyLineageView(fact.lineageKey);
      views.set(fact.lineageKey, view);
    }
    views.set(fact.lineageKey, applyFactToView(view, fact));
  }
  const derived = new Map<LineageKey, LineageView>();
  for (const [key, view] of views) {
    derived.set(key, { ...view, state: deriveState(view) });
  }
  return derived;
}

/** Reduce the facts of a single lineage into its derived view. */
export function reduceOneLineage(
  lineageKey: LineageKey,
  facts: readonly DurableControlFact[],
): LineageView {
  let view = emptyLineageView(lineageKey);
  for (const fact of facts) {
    if (fact.lineageKey === lineageKey) {
      view = applyFactToView(view, fact);
    }
  }
  return { ...view, state: deriveState(view) };
}

function applyFactToView(view: LineageView, fact: DurableControlFact): LineageView {
  switch (fact.kind) {
    case 'lineageSubmitted':
      return {
        ...view,
        binding: fact.binding,
        frozenMemberIds: fact.frozenMemberIds,
        submittedAt: fact.sequence,
      };
    case 'cancelAuthorityCommitted':
      return { ...view, cancelledAt: fact.sequence };
    case 'acceptanceCommitted':
      return { ...view, acceptedAt: view.acceptedAt ?? fact.sequence };
    case 'resumeAuthorized':
      return { ...view, resumedAt: fact.sequence };
    case 'effectAttemptStarted':
      return { ...view, attemptIds: [...view.attemptIds, fact.attemptId] };
    case 'effectOutcomeRecorded': {
      if (view.outcomes.has(fact.attemptId)) {
        // First recording wins; replays reconcile by identity and never rewrite.
        return view;
      }
      const outcomes = new Map(view.outcomes);
      outcomes.set(fact.attemptId, { outcome: fact.outcome, sequence: fact.sequence });
      return {
        ...view,
        outcomes,
        succeededAt: fact.outcome === 'SUCCEEDED' ? fact.sequence : view.succeededAt,
      };
    }
    case 'reconciliationObserved':
      return { ...view, reconciliationCount: view.reconciliationCount + 1 };
    case 'budgetReserved':
    case 'budgetConsumed':
      return view;
  }
}

/**
 * Exhaustive (state, event) legality. The scheduler consults this before
 * committing any fact; semantic guards (outcome evidence, authorization
 * identity, budgets) are layered on top, but a pair rejected here is
 * rejected everywhere.
 *
 * Returns the resulting state for legal transitions; typed rejections
 * otherwise. Reconciliation is legal in every existing state and changes no
 * state; duplicate cancel/accept/submit are convergent (idempotent) rather
 * than illegal.
 */
export function controlTransition(
  state: LineageControlState,
  event: ControlEventType,
): ControlResult<LineageControlState> {
  switch (event) {
    case 'SUBMIT_LINEAGE':
      // Duplicate submit converges onto the existing lineage (never forks).
      return { ok: true, value: state };
    case 'CANCEL':
      switch (state) {
        case 'ACTIVE':
          return { ok: true, value: 'CANCELLED_SUPPRESSED' };
        case 'CANCELLED_SUPPRESSED':
        case 'ACCEPTED':
          // Duplicate cancel is idempotent; a cancel after acceptance never
          // revokes the accepted identity (it stays recorded as authority).
          return { ok: true, value: state };
      }
      break;
    case 'ACCEPT':
      switch (state) {
        case 'ACTIVE':
          return { ok: true, value: 'ACCEPTED' };
        case 'CANCELLED_SUPPRESSED':
          return controlReject(
            'CANCELLATION_CUTOFF_VIOLATION',
            'durable USER_CANCELLED authority precedes acceptance: automatic acceptance is blocked (L2 invariant 20 / ADR-013)',
          );
        case 'ACCEPTED':
          // Duplicate acceptance converges to the same accepted identity.
          return { ok: true, value: 'ACCEPTED' };
      }
      break;
    case 'RESUME':
      switch (state) {
        case 'ACTIVE':
        case 'ACCEPTED':
          return controlReject(
            'UNAUTHORIZED_TRANSITION_REJECTED',
            state === 'ACTIVE'
              ? 'resume applies to a suppressed lineage; lineage is already active'
              : 'lineage is durably accepted; reopening would duplicate an accepted effect',
          );
        case 'CANCELLED_SUPPRESSED':
          // Only the explicit authorized transition reopens processing.
          return { ok: true, value: 'ACTIVE' };
      }
      break;
    case 'DISPATCH':
      switch (state) {
        case 'ACTIVE':
          return { ok: true, value: 'ACTIVE' };
        case 'CANCELLED_SUPPRESSED':
          return controlReject(
            'DISPATCH_SUPPRESSED',
            'durable cancellation is authoritative for a still-unaccepted lineage: no new discovery/transfer/retry dispatch',
          );
        case 'ACCEPTED':
          return controlReject(
            'UNAUTHORIZED_TRANSITION_REJECTED',
            'lineage is durably accepted: no further dispatch exists for this effect identity',
          );
      }
      break;
    case 'START_ATTEMPT':
      switch (state) {
        case 'ACTIVE':
          return { ok: true, value: 'ACTIVE' };
        case 'CANCELLED_SUPPRESSED':
          return controlReject(
            'DISPATCH_SUPPRESSED',
            'starting a new external effect attempt after authoritative cancellation is suppressed dispatch',
          );
        case 'ACCEPTED':
          return controlReject(
            'UNAUTHORIZED_TRANSITION_REJECTED',
            'lineage is durably accepted: no new attempt exists for this effect identity',
          );
      }
      break;
    case 'RECORD_OUTCOME':
      // Truthful outcome establishment is permitted in every state (an
      // in-flight at-least-once effect may complete around cancellation);
      // it never crosses the acceptance cutoff by itself.
      return { ok: true, value: state };
    case 'RECONCILE':
      // Bounded reconciliation is always permitted and never changes state.
      return { ok: true, value: state };
  }
}
