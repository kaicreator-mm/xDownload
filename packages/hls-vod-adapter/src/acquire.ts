/**
 * T009 — segment acquisition engine over an injected fetcher port.
 *
 * ADR-006: the HLS adapter is a specialized adapter and does NOT implement
 * direct HTTP transfer itself; segment bytes arrive through the injected
 * SegmentFetcherPort (the direct-HTTP adapter lane is a sibling concern).
 * The engine is deterministic: it debits the transfer domain for every
 * request, classifies truncated responses independently of fetcher honesty
 * (declared byterange vs actual bytes), stops truthfully at the first failed
 * or budget-refused segment (missing segment is never success), and retry
 * operates only on the frozen plan with inherited remaining budget.
 */

import { deepFreeze } from '@xdownload/domain-contracts';
import type { SegmentPlan, SegmentPlanEntry } from './plan.ts';
import type { TransferLedger } from './budget.ts';

export type SegmentFetchFailure = 'MISSING' | 'UNREACHABLE' | 'TRUNCATED' | 'FAILED';

export interface SegmentFetchSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
}

export interface SegmentFetchFailureResult {
  readonly ok: false;
  readonly failure: SegmentFetchFailure;
  readonly detail?: string;
}

export type SegmentFetchResult = SegmentFetchSuccess | SegmentFetchFailureResult;

/** Port consumed by the adapter; the direct HTTP transfer adapter implements it (ADR-006). */
export interface SegmentFetcherPort {
  readonly fetcherId: string;
  fetch(entry: SegmentPlanEntry): SegmentFetchResult;
}

export interface SegmentAcquisitionOutcome {
  readonly entry: SegmentPlanEntry;
  readonly attempt: number;
  readonly result: SegmentFetchResult;
}

export type AcquisitionStop =
  | { readonly kind: 'ALL_SEGMENTS_TRANSFERRED' }
  | {
      readonly kind: 'SEGMENT_FAILURE';
      readonly position: number;
      readonly failure: SegmentFetchFailure;
    }
  | { readonly kind: 'TRANSFER_BUDGET_EXHAUSTED'; readonly position: number }
  | { readonly kind: 'GLOBAL_SAFETY_LIMIT'; readonly position: number };

export interface AcquisitionRun {
  readonly kind: 'hls-segment-acquisition-run';
  readonly plan: SegmentPlan;
  readonly outcomes: readonly SegmentAcquisitionOutcome[];
  readonly transferred: readonly SegmentAcquisitionOutcome[];
  readonly failed: readonly SegmentAcquisitionOutcome[];
  readonly stop: AcquisitionStop;
}

/**
 * Acquire planned segments in playlist order. Every request is admitted by
 * the transfer ledger first (C28); a missing/failed segment stops the run
 * truthfully and is never normalized into partial acceptance.
 */
export function acquirePlannedSegments(
  plan: SegmentPlan,
  ledger: TransferLedger,
  fetcher: SegmentFetcherPort,
): AcquisitionRun {
  return runFrom(plan, ledger, fetcher, [], 0);
}

/**
 * Resume a stopped run on the SAME frozen plan/binding with inherited
 * remaining budget. Positions already transferred are preserved on the same
 * effect lineage; previously attempted failed positions debit the retry
 * transfer budget. No scope re-derivation and no budget replenishment occur.
 */
export function resumeAcquisition(
  previous: AcquisitionRun,
  ledger: TransferLedger,
  fetcher: SegmentFetcherPort,
): AcquisitionRun {
  const attemptedPositions = new Set(previous.outcomes.map((outcome) => outcome.entry.position));
  const attemptBase = Math.max(0, ...previous.outcomes.map((outcome) => outcome.attempt));
  return runFrom(
    previous.plan,
    ledger,
    fetcher,
    previous.transferred,
    attemptBase + 1,
    attemptedPositions,
  );
}

function runFrom(
  plan: SegmentPlan,
  ledger: TransferLedger,
  fetcher: SegmentFetcherPort,
  transferred: readonly SegmentAcquisitionOutcome[],
  attemptBase: number,
  retryPositions?: ReadonlySet<number>,
): AcquisitionRun {
  const outcomes: SegmentAcquisitionOutcome[] = [...transferred];
  const transferredPositions = new Set(transferred.map((outcome) => outcome.entry.position));
  const successful: SegmentAcquisitionOutcome[] = [...transferred];
  let stop: AcquisitionStop = deepFreeze({ kind: 'ALL_SEGMENTS_TRANSFERRED' });
  for (const entry of plan.entries) {
    if (transferredPositions.has(entry.position)) {
      continue;
    }
    const work =
      retryPositions?.has(entry.position) === true ? 'RETRY_TRANSFER_REQUEST' : 'SEGMENT_REQUEST';
    const admission = ledger.admitTransferWork(work);
    if (!admission.ok) {
      stop = ledger.remaining().globalSafety.exhausted
        ? deepFreeze({ kind: 'GLOBAL_SAFETY_LIMIT', position: entry.position })
        : deepFreeze({ kind: 'TRANSFER_BUDGET_EXHAUSTED', position: entry.position });
      break;
    }
    const fetched = fetcher.fetch(entry);
    const result = normalizeFetchResult(entry, fetched);
    ledger.recordTransfer(work, result.ok ? result.bytes.length : 0);
    // Shallow freeze only: fetcher-provided segment bytes are TypedArrays and
    // must never be structurally frozen.
    const outcome: SegmentAcquisitionOutcome = Object.freeze({
      entry,
      attempt: attemptBase,
      result,
    });
    outcomes.push(outcome);
    if (!result.ok) {
      stop = deepFreeze({
        kind: 'SEGMENT_FAILURE',
        position: entry.position,
        failure: result.failure,
      });
      break;
    }
    successful.push(outcome);
  }
  return Object.freeze({
    kind: 'hls-segment-acquisition-run' as const,
    plan,
    outcomes: Object.freeze(outcomes),
    transferred: Object.freeze(successful),
    failed: Object.freeze(outcomes.filter((outcome) => !outcome.result.ok)),
    stop,
  });
}

/**
 * Normalize a fetch result: a fetcher reporting success with fewer bytes
 * than the declared byterange is classified TRUNCATED here — truncation
 * detection does not rely on fetcher honesty. Declared-length equality with
 * different bytes remains possible and is caught by assembly/probe media
 * validation, never by counting bytes.
 */
function normalizeFetchResult(
  entry: SegmentPlanEntry,
  fetched: SegmentFetchResult,
): SegmentFetchResult {
  if (!fetched.ok) {
    return fetched;
  }
  if (fetched.bytes.length === 0) {
    const failed: SegmentFetchFailureResult = {
      ok: false,
      failure: 'FAILED',
      detail: 'segment response carried zero bytes',
    };
    return deepFreeze(failed);
  }
  const declared = entry.byterange?.length;
  if (declared !== undefined && fetched.bytes.length !== declared) {
    const truncated: SegmentFetchFailureResult = {
      ok: false,
      failure: 'TRUNCATED',
      detail: `segment '${entry.identity}' declared ${String(declared)} bytes, received ${String(fetched.bytes.length)}`,
    };
    return deepFreeze(truncated);
  }
  return fetched;
}

/** All planned segments transferred (identity-set accounting, not a count shortcut). */
export function allSegmentsTransferred(run: AcquisitionRun): boolean {
  return run.stop.kind === 'ALL_SEGMENTS_TRANSFERRED';
}
