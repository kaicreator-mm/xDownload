/**
 * T006 cancellation-vs-acceptance cutoff — pure ordering predicate
 * (frozen L2 invariant 20 / ADR-013).
 *
 * The cutoff is a deterministic function of committed durable fact order and
 * nothing else: adapter arrival time, process restarts and in-flight memory
 * cannot redefine it (L2 §11: one deterministic order).
 */

/**
 * `ACCEPTANCE_OPEN` — no durable cancellation authority exists; ordinary
 *   acceptance processing is open.
 * `ACCEPTANCE_BLOCKED` — durable `USER_CANCELLED` authority was committed
 *   before durable acceptance (or no acceptance exists yet): automatic
 *   recovery/reconciliation MUST NOT create acceptance for
 *   staged/completed/validated/materialized or externally
 *   successful-but-unaccepted bytes. Only an explicit retry/resume control
 *   transition may reopen processing on the same frozen lineage.
 * `ACCEPTANCE_STANDS` — durable acceptance was committed before cancellation:
 *   the accepted identity is not retroactively revoked; bounded
 *   materialization/finalization truth reconciliation remains available.
 */
export type CutoffDecision = 'ACCEPTANCE_OPEN' | 'ACCEPTANCE_BLOCKED' | 'ACCEPTANCE_STANDS';

/**
 * Pure cutoff decision from commit sequences of the two durable facts.
 *
 * Commit sequences come from a single durable total order, so they are never
 * equal; if a malformed log ever claims equality the decision fails closed to
 * cancel-wins (`ACCEPTANCE_BLOCKED`) rather than guessing.
 */
export function acceptanceCutoff(
  cancelCommit: number | undefined,
  acceptCommit: number | undefined,
): CutoffDecision {
  if (cancelCommit === undefined) {
    return 'ACCEPTANCE_OPEN';
  }
  if (acceptCommit === undefined || cancelCommit <= acceptCommit) {
    return 'ACCEPTANCE_BLOCKED';
  }
  return 'ACCEPTANCE_STANDS';
}
