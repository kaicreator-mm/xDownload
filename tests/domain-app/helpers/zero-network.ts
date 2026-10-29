/**
 * T10 zero-network assertion harness — a first-class oracle tool.
 *
 * "Zero requests" is asserted against recorded truth: every bounded fixture
 * origin enrolled in the audit is read through its request log, and the
 * assertion fails with the exact observed traffic when any request happened.
 *
 * Honest scope note (also asserted by the tests): this harness proves
 * zero-traffic against the bounded origins registered with it — the only
 * origins a hermetic harness can speak about. It never claims a global
 * OS-level network spy.
 */

import assert from 'node:assert/strict';
import type { BoundedHttpFixture, RecordedRequest } from './fixture-server.ts';

export interface OriginTraffic {
  readonly origin: string;
  readonly requestCount: number;
  readonly requests: readonly RecordedRequest[];
}

export interface ZeroNetworkReport {
  readonly label: string;
  readonly totalRequests: number;
  readonly origins: readonly OriginTraffic[];
  readonly zero: boolean;
}

/** Enrols bounded fixtures and asserts the recorded traffic is empty. */
export class NetworkAudit {
  private readonly fixtures: { readonly origin: string; readonly fixture: BoundedHttpFixture }[] =
    [];

  register(fixture: BoundedHttpFixture, label = fixture.baseUri): this {
    this.fixtures.push({ origin: label, fixture });
    return this;
  }

  /** Re-readable recorded-traffic report (no assertion, pure observation). */
  report(label: string): ZeroNetworkReport {
    const origins = this.fixtures.map(({ origin, fixture }) => ({
      origin,
      requestCount: fixture.requestCount(),
      requests: [...fixture.requests],
    }));
    const totalRequests = origins.reduce((sum, origin) => sum + origin.requestCount, 0);
    return { label, totalRequests, origins, zero: totalRequests === 0 };
  }

  /**
   * The zero-network assertion: passes only when every enrolled origin
   * recorded zero requests. The failure message carries the full observed
   * traffic so the diagnosis never has to be reconstructed.
   */
  assertZeroNetwork(label: string): void {
    const report = this.report(label);
    assert.equal(
      report.totalRequests,
      0,
      `zero-network violation for '${label}': ${JSON.stringify(report, null, 2)}`,
    );
  }
}

/** Convenience wrapper: audit over a fixed set of fixtures. */
export function auditNetwork(fixtures: readonly BoundedHttpFixture[]): NetworkAudit {
  const audit = new NetworkAudit();
  for (const fixture of fixtures) {
    audit.register(fixture);
  }
  return audit;
}
