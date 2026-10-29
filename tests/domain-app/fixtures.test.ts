/**
 * T10 — deterministic factory and bounded-fixture self-tests. The harness
 * only trusts its own tools after they prove themselves: stable payload
 * digests, canonical intent construction (positive and negative), and every
 * fixture-server scenario behaving exactly as registered.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { BoundedHttpFixture } from './helpers/fixture-server.ts';
import { confirmedIntent, payload, payloadPrefix, sha256, unwrapOk } from './helpers/fixtures.ts';
import { readUntilInterrupted } from './helpers/recovery.ts';
import { validateConfirmedIntent } from './helpers/contracts.ts';

const FULL = payload(1024);
const VARIANT = payload(1024, 7);

let fixture: BoundedHttpFixture;
let baseUri: string;

before(async () => {
  fixture = new BoundedHttpFixture();
  baseUri = await fixture.start();
});

after(async () => {
  await fixture.stop();
});

describe('T10 deterministic factories', () => {
  it('payload is a pure function of (size, seed) — same inputs, same bytes and digest', () => {
    assert.deepEqual(payload(100, 0), payload(100, 0));
    assert.deepEqual(payload(257, 42), payload(257, 42));
    assert.equal(sha256(payload(1024)), sha256(payload(1024)));
  });

  it('different seeds produce different bytes and digests (variant detection is real)', () => {
    assert.notDeepEqual(payload(1024, 0), payload(1024, 7));
    assert.notEqual(sha256(payload(1024, 0)), sha256(payload(1024, 7)));
    assert.notDeepEqual(FULL, VARIANT);
  });

  it('payloadPrefix is exactly the durable prefix of the full payload (restart truth)', () => {
    const prefix = payloadPrefix(1024, 397);
    assert.equal(prefix.byteLength, 397);
    assert.deepEqual(prefix, FULL.subarray(0, 397));
    assert.equal(sha256(prefix), sha256(FULL.subarray(0, 397)));
    assert.notEqual(sha256(prefix), sha256(FULL));
    assert.throws(() => payloadPrefix(10, 11));
  });

  it('confirmedIntent returns a decoded canonical intent bound to the payload digest', () => {
    const intent = confirmedIntent(sha256(FULL), { declaredBytes: FULL.byteLength });
    assert.equal(intent.slice, 'S1');
    assert.equal(intent.digestAnchor, sha256(FULL));
    assert.equal(intent.declaredBytes, 1024);
    assert.equal(intent.allowedOperation, 'acquisition.acquire');
    assert.equal(intent.caller.actor, 't10-harness');
  });

  it('omitDigestAnchor builds the no-anchor basis; S3 is inside the frozen slice pair', () => {
    const bare = confirmedIntent(sha256(FULL), { omitDigestAnchor: true, slice: 'S3' });
    assert.equal(bare.digestAnchor, undefined);
    assert.equal(bare.slice, 'S3');
  });

  it('the factory never mints a widened or malformed intent (fail closed)', () => {
    const raw = confirmedIntent(sha256(FULL));
    const widened = validateConfirmedIntent({ ...raw, rogueField: 'scope-widening' });
    assert.equal(widened.ok, false);
    assert.ok(
      !widened.ok && widened.diagnostics.some((item) => item.code === 'SCOPE_WIDENING_REFUSED'),
      JSON.stringify(widened, null, 2),
    );
    const rawLocator = validateConfirmedIntent({
      ...raw,
      targetRef: 'https://raw-locator.example/file',
    });
    assert.equal(rawLocator.ok, false);
    assert.ok(
      !rawLocator.ok &&
        rawLocator.diagnostics.some((item) => item.code === 'LOCATOR_SUBSTITUTION_REJECTED'),
      JSON.stringify(rawLocator, null, 2),
    );
    assert.throws(() => unwrapOk(widened));
  });
});

describe('T10 bounded fixture scenarios', () => {
  it('serveComplete delivers the exact registered bytes and records the request', async () => {
    fixture.serveComplete('/deterministic.bin', { body: FULL, etag: `"${sha256(FULL)}"` });
    const response = await fetch(fixture.uri('/deterministic.bin'), {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(bytes, FULL);
    const recorded = fixture.requestsTo('/deterministic.bin');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.method, 'GET');
    assert.equal(recorded[0]?.host, new URL(baseUri).host);
  });

  it('serveTruncated delivers fewer bytes than declared, observed as an interrupted transfer', async () => {
    const declared = FULL.byteLength;
    const delivered = 397;
    fixture.serveTruncated('/truncated.bin', {
      body: payloadPrefix(declared, delivered),
      declaredLength: declared,
    });
    const read = await readUntilInterrupted(fixture.uri('/truncated.bin'), 2000);
    assert.equal(read.completed, false);
    assert.equal(read.bytes.byteLength, delivered);
    assert.notEqual(sha256(read.bytes), sha256(FULL));
  });

  it('serveNotFound answers 404 and is recorded', async () => {
    fixture.serveNotFound('/missing.bin');
    const response = await fetch(fixture.uri('/missing.bin'), {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 404);
    assert.equal(fixture.requestsTo('/missing.bin').length, 1);
  });

  it('serveRedirect registers and is followed by the default client', async () => {
    fixture.serveRedirect('/moved.bin', fixture.uri('/deterministic.bin'), 302);
    const response = await fetch(fixture.uri('/moved.bin'), { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.equal(fixture.requestsTo('/moved.bin').length, 1);
    assert.equal(fixture.requestsTo('/deterministic.bin').length, 2);
  });

  it('serveStall never completes on its own; the client-side interruption keeps partial truth', async () => {
    const stalled = fixture.serveStall('/stalled.bin', { declaredLength: FULL.byteLength });
    const read = await readUntilInterrupted(fixture.uri('/stalled.bin'), 100);
    assert.equal(read.completed, false);
    assert.equal(read.interruptedBy, 'client-timeout');
    assert.equal(read.bytes.byteLength, 0);
    stalled.destroy();
    assert.equal(stalled.settled, true);
  });

  it('unregistered paths fail closed with 404', async () => {
    const response = await fetch(fixture.uri('/never-registered.bin'), {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 404);
  });
});
