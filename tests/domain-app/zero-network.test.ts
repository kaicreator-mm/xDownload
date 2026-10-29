/**
 * T10 — zero-network assertion harness tests. The zero-request oracle is a
 * first-class tool: it must pass for pure-contract operations over a live
 * bounded origin, and it must fail loudly (with the recorded traffic) when a
 * single request happens. Honest scope: the audit speaks for the bounded
 * origins enrolled with it — the only origins a hermetic harness can observe.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { BoundedHttpFixture } from './helpers/fixture-server.ts';
import { confirmedIntent, payload, sha256 } from './helpers/fixtures.ts';
import { NetworkAudit, auditNetwork } from './helpers/zero-network.ts';
import { validateConfirmedIntent } from './helpers/contracts.ts';

const FULL = payload(512);

let fixture: BoundedHttpFixture;

before(async () => {
  fixture = new BoundedHttpFixture();
  await fixture.start();
});

after(async () => {
  await fixture.stop();
});

describe('T10 zero-network harness', () => {
  it('a fresh audit over a live bounded origin records zero requests', () => {
    const audit = auditNetwork([fixture]);
    const report = audit.report('fresh');
    assert.equal(report.zero, true);
    assert.equal(report.totalRequests, 0);
    assert.deepEqual(
      report.origins.map((origin) => origin.origin),
      [fixture.baseUri],
    );
    audit.assertZeroNetwork('fresh — nothing ran yet');
  });

  it('pure contract operations make zero requests even with the origin up', () => {
    fixture.clearRequests();
    fixture.serveComplete('/never-fetched.bin', { body: FULL });

    const audit = auditNetwork([fixture]);
    const intent = confirmedIntent(sha256(FULL), { declaredBytes: FULL.byteLength });
    const decoded = validateConfirmedIntent(intent);
    assert.ok(decoded.ok);
    assert.equal(decoded.value.slice, 'S1');

    audit.assertZeroNetwork('intent sealing is pure — no origin traffic');
    assert.equal(fixture.requestsTo('/never-fetched.bin').length, 0);
  });

  it('a single real request is caught: the assertion fails carrying the recorded traffic', async () => {
    fixture.clearRequests();
    const audit = new NetworkAudit().register(fixture);
    assert.doesNotThrow(() => audit.assertZeroNetwork('before'));

    await fetch(fixture.uri('/one-request.bin'), { signal: AbortSignal.timeout(5000) });

    const report = audit.report('after-one-request');
    assert.equal(report.totalRequests, 1);
    assert.equal(report.origins[0]?.requests[0]?.path, '/one-request.bin');
    assert.throws(() => audit.assertZeroNetwork('after-one-request'), /zero-network violation/);
  });

  it('request counting is exact across clears (no stale traffic leaks between scenarios)', async () => {
    fixture.clearRequests();
    await fetch(fixture.uri('/counted.bin'), { signal: AbortSignal.timeout(5000) });
    assert.equal(fixture.requestCount(), 1);
    fixture.clearRequests();
    assert.equal(fixture.requestCount(), 0);
    const audit = auditNetwork([fixture]);
    assert.doesNotThrow(() => audit.assertZeroNetwork('clean slate'));
  });

  it('the audit spans multiple enrolled origins and names the violating one', async () => {
    const second = new BoundedHttpFixture();
    await second.start();
    try {
      fixture.clearRequests();
      second.serveComplete('/second-origin.bin', { body: FULL });
      const audit = new NetworkAudit().register(fixture, 'origin-a').register(second, 'origin-b');
      assert.doesNotThrow(() => audit.assertZeroNetwork('both quiet'));

      await fetch(second.uri('/second-origin.bin'), { signal: AbortSignal.timeout(5000) });

      const report = audit.report('one loud origin');
      assert.equal(report.totalRequests, 1);
      assert.equal(report.origins[0]?.requestCount, 0);
      assert.equal(report.origins[1]?.requestCount, 1);
      assert.throws(() => audit.assertZeroNetwork('one loud origin'), /origin-b/);
    } finally {
      await second.stop();
    }
  });
});
