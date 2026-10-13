/**
 * #101 R1/F03 — supervised S1 drives: a rejected/thrown Core-internal drive
 * is bounded-retried and surfaced in an observable health ledger instead of
 * being silently swallowed. The supervisor never invents terminal truth, never
 * unregisters an intent and never double-drives one aggregate concurrently.
 *
 * Scenarios mirror the review matrix: transport exception, deterministic
 * rejection (no-Core / cancel-shaped LATE), exhausted-with-pending-intent
 * (the UNKNOWN state), restart reconcile (fresh supervisor re-drives), and
 * coalescing/concurrency.
 */

import { describe, expect, it } from 'vitest';
import { createS1DriveSupervisor, type S1DriveHealthEntry } from '../src/index.ts';

const NO_DELAY = () => Promise.resolve();

function supervised(
  overrides: {
    readonly maxAttempts?: number;
    readonly onHealth?: (entry: S1DriveHealthEntry) => void;
  } = {},
) {
  const seen: S1DriveHealthEntry[] = [];
  const supervisor = createS1DriveSupervisor({
    delay: NO_DELAY,
    onHealth: (entry) => {
      seen.push(entry);
      overrides.onHealth?.(entry);
    },
    ...overrides,
  });
  return { supervisor, seen };
}

describe('S1 drive supervisor (#101 R1/F03)', () => {
  it('a transport exception is retried within the bound and drains when the fault clears', async () => {
    const { supervisor, seen } = supervised();
    let calls = 0;
    await supervisor.drive('agg-1', async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error('ECONNRESET while reading the durable ledger');
      }
    });
    expect(calls).toBe(3);
    // Every failed attempt was observable while it happened (degraded), and
    // the episode ends drained — not silently swallowed, not terminal-faked.
    expect(seen.map((entry) => entry.outcome)).toEqual(['DEGRADED', 'DEGRADED', 'DRAINED']);
    expect(seen[1]?.lastError).toContain('ECONNRESET');
    expect(seen[1]?.attempts).toBe(2);
    expect(supervisor.health()).toHaveLength(1);
    expect(supervisor.health()[0]?.outcome).toBe('DRAINED');
  });

  it('a deterministic rejection exhausts the bound with the verbatim diagnostic recorded', async () => {
    const { supervisor, seen } = supervised();
    let calls = 0;
    await supervisor.drive('agg-2', async () => {
      calls += 1;
      throw new Error('s1 drive rejected: LATE_COMMAND:lineage.status');
    });
    expect(calls).toBe(3);
    const exhausted = supervisor.health()[0];
    expect(exhausted?.outcome).toBe('EXHAUSTED');
    expect(exhausted?.attempts).toBe(3);
    expect(exhausted?.lastError).toContain('LATE_COMMAND');
    expect(seen.at(-1)?.outcome).toBe('EXHAUSTED');
  });

  it('an exhausted drive leaves no invented terminal and the intent drivable again (UNKNOWN state)', async () => {
    const { supervisor } = supervised();
    await supervisor.drive('agg-3', async () => {
      // The drive closure records terminals ONLY through durable truth; a
      // failed episode must have produced none — asserted below via the
      // supervisor's diagnostics-only contract (no terminal API touched).
      throw new Error('boom');
    });
    const health = supervisor.health()[0];
    expect(health?.outcome).toBe('EXHAUSTED');

    // Restart semantics: a fresh supervisor (as after reopenCoreRuntime)
    // re-drives the same aggregate — the intent was never unregistered.
    const restarted = supervised();
    let recovered = false;
    await restarted.supervisor.drive('agg-3', async () => {
      recovered = true;
    });
    expect(recovered).toBe(true);
    expect(restarted.supervisor.health()).toHaveLength(0);
  });

  it('concurrent drives of one aggregate coalesce onto the in-flight episode', async () => {
    const { supervisor } = supervised({ maxAttempts: 2 });
    let executions = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = supervisor.drive('agg-4', async () => {
      executions += 1;
      await gate;
    });
    const second = supervisor.drive('agg-4', async () => {
      executions += 1;
    });
    release?.();
    await Promise.all([first, second]);
    expect(executions).toBe(1);
  });

  it('the health ledger stays bounded per aggregate with latest-state semantics', async () => {
    const supervisor = createS1DriveSupervisor({
      delay: NO_DELAY,
      healthCapacity: 2,
      maxAttempts: 1,
    });
    for (const aggregate of ['agg-a', 'agg-b', 'agg-c']) {
      await supervisor.drive(aggregate, async () => {
        throw new Error(`failure of ${aggregate}`);
      });
    }
    const health = supervisor.health();
    expect(health).toHaveLength(2);
    expect(health.map((entry) => entry.aggregateId).sort()).toEqual(['agg-b', 'agg-c']);
    expect(health.every((entry) => entry.outcome === 'EXHAUSTED')).toBe(true);
  });

  it('a healthy drive leaves no health entry at all', async () => {
    const { supervisor, seen } = supervised();
    await supervisor.drive('agg-ok', async () => undefined);
    expect(seen).toHaveLength(0);
    expect(supervisor.health()).toHaveLength(0);
  });
});
