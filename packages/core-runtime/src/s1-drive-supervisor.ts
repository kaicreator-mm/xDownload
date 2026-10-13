/**
 * #101 R1/F03 — bounded same-process supervision for Core-internal S1
 * direct-execution drives.
 *
 * The seam's `begin` hook and the composition reconcile fire the S1 driver
 * as a fire-and-continuation task; a rejected/thrown drive must never be
 * silently swallowed (an accepted EXECUTE would leave an ACTIVE lineage
 * with no live visibility until the client wait times out). The supervisor
 * gives every drive:
 *
 * - **bounded same-process retry**: transient faults (transport/IO errors
 *   between the durable pieces) are re-driven a bounded number of times
 *   with a small backoff. Re-driving is reconcile-first safe: once the
 *   durable work item exists, `driveS1DirectExecution` re-derives truth
 *   from durable facts only (no re-download, no double budget charge), and
 *   deterministic rejections (admission/cancellation) exhaust the bound
 *   without side effects.
 * - **observable health**: every failed attempt records a bounded,
 *   read-only health entry on the runtime (latest per aggregate) and
 *   notifies the composition's optional observer, so a running Core can
 *   surface a degraded drive without restarting. Entries are diagnostics
 *   only — the supervisor never invents terminal truth, never unregisters
 *   an intent and never touches lineage state; the intent stays registered
 *   so restart reconcile continues to re-drive it (UNKNOWN stays UNKNOWN
 *   until durable truth exists).
 */

/** Observable state of one failed S1 drive (latest per aggregate, bounded). */
export interface S1DriveHealthEntry {
  readonly aggregateId: string;
  /** Attempts consumed so far for the current drive episode (>= 1). */
  readonly attempts: number;
  /** DEGRADED: retrying; DRAINED: succeeded after failures; EXHAUSTED: gave up. */
  readonly outcome: 'DEGRADED' | 'DRAINED' | 'EXHAUSTED';
  /** Verbatim diagnostic message of the last failed attempt (bounded). */
  readonly lastError: string;
  /** ISO timestamp of the last failed attempt. */
  readonly lastAt: string;
}

export interface S1DriveSupervisorOptions {
  /** Total drive attempts per episode (default 3; minimum 1). */
  readonly maxAttempts?: number;
  /** Base backoff between attempts in ms (default 100; attempt n waits n*base). */
  readonly backoffMs?: number;
  /** Bounded number of aggregates kept in the health ledger (default 64). */
  readonly healthCapacity?: number;
  /** Injectable delay (tests); defaults to a real timer. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Observer notified on every health transition (core-host stderr relay). */
  readonly onHealth?: (entry: S1DriveHealthEntry) => void;
}

export interface S1DriveSupervisor {
  /**
   * Drive one aggregate under supervision. Concurrent drives for the same
   * aggregate coalesce onto the in-flight episode (a reconcile racing a
   * begin never double-drives); different aggregates drive independently.
   */
  drive(aggregateId: string, run: () => Promise<void>): Promise<void>;
  /** Bounded latest-state health ledger (diagnostic read-only view). */
  health(): readonly S1DriveHealthEntry[];
}

const MAX_MESSAGE_LENGTH = 200;

function messageOf(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown drive failure';
  return raw.length <= MAX_MESSAGE_LENGTH ? raw : `${raw.slice(0, MAX_MESSAGE_LENGTH)}...`;
}

export function createS1DriveSupervisor(options: S1DriveSupervisorOptions = {}): S1DriveSupervisor {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffMs = Math.max(0, options.backoffMs ?? 100);
  const capacity = Math.max(1, options.healthCapacity ?? 64);
  const delay =
    options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const onHealth = options.onHealth;
  const inFlight = new Map<string, Promise<void>>();
  const health = new Map<string, S1DriveHealthEntry>();

  const record = (entry: S1DriveHealthEntry): void => {
    health.delete(entry.aggregateId);
    health.set(entry.aggregateId, entry);
    while (health.size > capacity) {
      const oldest = health.keys().next();
      if (oldest.done) {
        break;
      }
      health.delete(oldest.value);
    }
    onHealth?.(entry);
  };

  const episode = async (aggregateId: string, run: () => Promise<void>): Promise<void> => {
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        await run();
        const last = health.get(aggregateId);
        if (last !== undefined && attempts > 1) {
          record({ ...last, attempts, outcome: 'DRAINED' });
        }
        return;
      } catch (error) {
        const entry: S1DriveHealthEntry = {
          aggregateId,
          attempts,
          outcome: 'DEGRADED',
          lastError: messageOf(error),
          lastAt: new Date().toISOString(),
        };
        record(entry);
        if (attempts >= maxAttempts) {
          record({ ...entry, outcome: 'EXHAUSTED' });
          // The intent stays registered; restart reconcile re-drives it.
          // No terminal is invented and the fault stays observable.
          return;
        }
        await delay(backoffMs * attempts);
      }
    }
  };

  return {
    drive(aggregateId: string, run: () => Promise<void>): Promise<void> {
      const pending = inFlight.get(aggregateId);
      if (pending !== undefined) {
        return pending;
      }
      const task = episode(aggregateId, run).finally(() => {
        inFlight.delete(aggregateId);
      });
      inFlight.set(aggregateId, task);
      return task;
    },
    health: () => [...health.values()],
  };
}
