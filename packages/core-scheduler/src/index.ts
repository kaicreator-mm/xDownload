/**
 * T006 Core scheduler / control layer — public surface.
 *
 * Deliberately selective: the consumption-token mint and other package
 * internals are not exported, so budget consumption records are
 * unconstructible outside the single authoritative mutation path.
 */

export { acceptanceCutoff, type CutoffDecision } from './cutoff.ts';

export {
  canonicalEffectId,
  decodeFactLog,
  lineageKeyOf,
  serializeFacts,
  validateLineageKeyFormat,
  type BudgetActionKind,
  type BudgetAmounts,
  type CancelSource,
  type CommitSequence,
  type DurableControlFact,
  type EffectOutcome,
  type LineageBinding,
  type LineageKey,
  type ReconciliationObservationKind,
  type UncommittedControlFact,
} from './facts.ts';

export {
  BudgetLedger,
  STOP_REASON_BY_DOMAIN,
  actionAmounts,
  billableActiveMs,
  decodeDurableBudgetProfile,
  type ActiveTimeObservation,
  type BudgetAction,
  type BudgetStopProjection,
  type ConsumptionRecord,
  type DispatchGrant,
  type LedgerAppend,
} from './budgets.ts';

export {
  controlTransition,
  cutoffDecisionFor,
  effectiveCancellation,
  isDispatchAllowed,
  isReconciliationPermitted,
  reduceLineages,
  reduceOneLineage,
  emptyLineageView,
  type ControlEventType,
  type LineageControlState,
  type LineageView,
} from './machine.ts';

export {
  CoreScheduler,
  type AcceptanceOutcome,
  type AttemptRecord,
  type CancelOutcome,
  type LineageSubmitInput,
  type LineageSubmission,
  type OutcomeRecord,
  type ReconciliationOutcome,
  type ResumeOutcome,
  type ResumeRequest,
} from './scheduler.ts';

export {
  InMemoryControlFactLog,
  isConsumptionToken,
  type ConsumptionToken,
  type DurableControlFactLog,
} from './store.ts';

export {
  controlOk,
  controlReject,
  controlUnwrap,
  type ControlRejection,
  type ControlRejectionCode,
  type ControlResult,
} from './rejections.ts';
