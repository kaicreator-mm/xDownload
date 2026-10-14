/**
 * T009 bounded asynchronous segment acquisition with Core-owned transfer
 * budget admission. This does NOT create a second scheduler or grant the
 * adapter authority to start a task: the host invokes it only after Core
 * commits the durable HLS effect intent.
 */
import { deepFreeze } from '@xdownload/domain-contracts';
import {
  normalizeFetchResult,
  type AcquisitionRun,
  type AcquisitionStop,
  type SegmentAcquisitionOutcome,
  type SegmentFetchResult,
} from './acquire.ts';
import type { TransferLedger } from './budget.ts';
import type { AsyncSegmentFetcherPort } from './http-segment.ts';
import type { SegmentPlan } from './plan.ts';

async function runAsync(
  plan: SegmentPlan,
  ledger: TransferLedger,
  fetcher: AsyncSegmentFetcherPort,
  prior: readonly SegmentAcquisitionOutcome[],
  attempt: number,
  retryPositions: ReadonlySet<number>,
): Promise<AcquisitionRun> {
  const outcomes: SegmentAcquisitionOutcome[] = [...prior];
  const successful: SegmentAcquisitionOutcome[] = [...prior];
  const priorPositions = new Set(prior.map((record) => record.entry.position));
  let stop: AcquisitionStop = deepFreeze({ kind: 'ALL_SEGMENTS_TRANSFERRED' });

  for (const entry of plan.entries) {
    if (priorPositions.has(entry.position)) continue;
    const work = retryPositions.has(entry.position) ? 'RETRY_TRANSFER_REQUEST' : 'SEGMENT_REQUEST';
    const remaining = ledger.remaining();
    const bytesLeft = remaining.transfer.perLimit['bytes'];
    // This is a conservative PRE-HTTP budget gate. A trusted fetcher MUST
    // advertise its worst-case byte bound; an unbounded or oversized fetch
    // must never launch simply because the segment's length is unknown.
    if (
      !Number.isSafeInteger(fetcher.maxResponseBytes) ||
      fetcher.maxResponseBytes < 1 ||
      (bytesLeft !== undefined && fetcher.maxResponseBytes > bytesLeft)
    ) {
      stop = deepFreeze({ kind: 'TRANSFER_BUDGET_EXHAUSTED', position: entry.position });
      break;
    }
    const admitted = ledger.admitTransferWork(work);
    if (!admitted.ok) {
      stop = ledger.remaining().globalSafety.exhausted
        ? deepFreeze({ kind: 'GLOBAL_SAFETY_LIMIT', position: entry.position })
        : deepFreeze({ kind: 'TRANSFER_BUDGET_EXHAUSTED', position: entry.position });
      break;
    }
    let delivered: SegmentFetchResult;
    try {
      delivered = await fetcher.fetch(entry);
    } catch {
      delivered = { ok: false, failure: 'UNREACHABLE' };
    }
    const result = normalizeFetchResult(entry, delivered);
    ledger.recordTransfer(work, result.ok ? result.bytes.length : 0);
    const outcome: SegmentAcquisitionOutcome = Object.freeze({ entry, attempt, result });
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
    failed: Object.freeze(outcomes.filter((item) => !item.result.ok)),
    stop,
  });
}

/** New effect: budget admission precedes every real asynchronous HTTP request. */
export async function acquirePlannedSegmentsAsync(
  plan: SegmentPlan,
  ledger: TransferLedger,
  fetcher: AsyncSegmentFetcherPort,
): Promise<AcquisitionRun> {
  return runAsync(plan, ledger, fetcher, [], 0, new Set());
}

/** Retry is bounded to the identical frozen plan and inherited Core ledger. */
export async function resumeAcquisitionAsync(
  previous: AcquisitionRun,
  ledger: TransferLedger,
  fetcher: AsyncSegmentFetcherPort,
): Promise<AcquisitionRun> {
  const retried = new Set(previous.outcomes.map((item) => item.entry.position));
  const attempt = Math.max(0, ...previous.outcomes.map((item) => item.attempt)) + 1;
  return runAsync(previous.plan, ledger, fetcher, previous.transferred, attempt, retried);
}
