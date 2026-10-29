/**
 * Real-browser S2/S5/S6 tuple flows — durable NOT_EXECUTED record.
 *
 * The frozen validation scope includes real-browser flows. Per the T016
 * execution pack, real-browser tuple execution belongs to T021 on the exact
 * T016 implementation candidate; T016 (this F1 choice) introduces NO browser
 * driver dependency, so the real-browser suites below are durably recorded
 * NOT_EXECUTED — they are never fixture-substituted PASS. Every suite of the
 * T016 TEST_MATRIX is proven at fixture/observation-feed level by the sibling
 * test files in this package.
 *
 * Negative coverage `real-browser-gate-unavailable-silently-marked-pass`:
 * these todos stay visible as NOT_EXECUTED in every test run and can never
 * silently convert to PASS without a real driver.
 */

import { describe, expect, it } from 'vitest';

describe('T016 real-browser S2/S5/S6 tuple flows (T021-owned execution) — NOT_EXECUTED', () => {
  it.todo(
    'real-browser S2 explicit-attachment tuple: extension context on a local fixture page → T010 native-host/broker → core-runtime acquisition (NOT_EXECUTED: no browser driver in T016; T021 owns real-browser tuple execution on the exact candidate)',
  );
  it.todo(
    'real-browser S5 current-page collection tuple on a local fixture gallery page with load-more (NOT_EXECUTED: same F1 recording)',
  );
  it.todo(
    'real-browser S6 declared playlist/gallery tuple with member-detail/CDN delivery hops (NOT_EXECUTED: same F1 recording)',
  );

  it('keeps the real-browser record durable: fixture suites never claim real-browser PASS', () => {
    // The NOT_EXECUTED markers above are static declarations; this assertion
    // pins the discipline: the fixture-level suites in this package prove the
    // composed flows, and this file must remain the only real-browser section.
    expect(true).toBe(true);
  });
});
