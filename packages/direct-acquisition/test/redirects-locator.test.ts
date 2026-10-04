/**
 * TEST_MATRIX suite `redirects-and-signed-locator-refresh` (ADR-011, frozen L2
 * invariant 4, counterexample C29): provenance-bound redirect/CDN hops retain
 * the frozen logical target identity, signed-locator expiry refresh re-binds
 * with provenance, and unrelated redirects / unbounded chains fail closed
 * without enlarging the requested single-target scope.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bindLocator,
  unwrapOrThrow,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import { directRequest, payload, targetIdOf, transferProfile } from './helpers/fixtures.ts';

const FULL = payload(100);

let origin: ControlledHttpFixture;
let cdn: ControlledHttpFixture;
let unrelated: ControlledHttpFixture;
let originBase: string;
let cdnBase: string;
let cdnHost: string;
let originHost: string;

beforeAll(async () => {
  origin = new ControlledHttpFixture();
  cdn = new ControlledHttpFixture();
  unrelated = new ControlledHttpFixture();
  originBase = await origin.start();
  cdnBase = await cdn.start();
  await unrelated.start();
  cdnHost = new URL(cdnBase).host;
  originHost = new URL(originBase).host;
});

afterAll(async () => {
  await origin.stop();
  await cdn.stop();
  await unrelated.stop();
});

beforeEach(() => {
  origin.clearRequests();
  cdn.clearRequests();
  unrelated.clearRequests();
});

describe('redirects: provenance-bound hops retain the frozen logical target (C29 bound path)', () => {
  it('declared CDN hop serves the frozen target: identity retained, one file transferred, no scope growth', async () => {
    origin.redirect('/origin.bin', `${cdnBase}/cdn.bin`);
    cdn.serveFile('/cdn.bin', { body: FULL, etag: '"cdn-1"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(originBase, '/origin.bin', FULL, {
          effectId: 'effect-001',
          allowedRedirectHosts: [cdnHost],
        }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.bytes).toEqual(FULL);
    expect(outcome.targetId).toBe('target-file-001');
    expect(outcome.locatorChain.length).toBe(2);
    for (const binding of outcome.locatorChain) {
      expect(binding.identity).toBe('target-file-001');
    }
    // Scope never enlarged: exactly one origin request and one CDN request,
    // and the delivered bytes still match the single frozen digest anchor.
    expect(origin.requests.length).toBe(1);
    expect(cdn.requests.length).toBe(1);
    expect(unrelated.requests.length).toBe(0);
    const locatorEvidence = outcome.evidence.find(
      (record) => record.claimType === 'RESOURCE_IDENTITY',
    );
    expect(locatorEvidence).toBeDefined();
    expect(outcome.allApplicableValidationPassed).toBe(true);
  });
});

describe('redirects: unrelated redirect fails closed (C29 rejected path)', () => {
  it('redirect to an undeclared host cannot claim the target; it is never even fetched', async () => {
    origin.redirect('/hijack.bin', `${unrelated.baseUri}/evil.bin`);
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(originBase, '/hijack.bin', FULL, {
          effectId: 'effect-001',
          allowedRedirectHosts: [cdnHost],
        }),
      ),
    );

    expect(outcome.reason).toBe('LOCATOR_SUBSTITUTION');
    expect(outcome.bytes).toBeUndefined();
    expect(outcome.targetResolved).toBe(false);
    const target = outcome.validations.find((check) => check.layer === 'target');
    expect(target?.passed).toBe(false);
    expect(outcome.terminalResult.targetResolution).toBe('BLOCKED');
    expect(outcome.terminalResult.stopReason).toBe('TARGET_CHANGED');
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
    // No target substitution: the frozen identity is preserved in the outcome
    // and the unrelated host was never contacted.
    expect(outcome.targetId).toBe('target-file-001');
    expect(unrelated.requests.length).toBe(0);
    expect(cdn.requests.length).toBe(0);
  });
});

describe('redirects: chains stay bounded — no scope expansion through redirects', () => {
  it('an unbounded redirect loop within declared hosts is stopped at the hop budget', async () => {
    origin.redirect('/loop-1.bin', `${originBase}/loop-2.bin`);
    origin.redirect('/loop-2.bin', `${originBase}/loop-3.bin`);
    origin.redirect('/loop-3.bin', `${originBase}/loop-4.bin`);
    origin.redirect('/loop-4.bin', `${originBase}/loop-5.bin`);
    origin.redirect('/loop-5.bin', `${originBase}/loop-6.bin`);
    origin.redirect('/loop-6.bin', `${originBase}/loop-7.bin`);
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(originBase, '/loop-1.bin', FULL, {
          effectId: 'effect-001',
          allowedRedirectHosts: [originHost, cdnHost],
        }),
      ),
    );

    expect(outcome.reason).toBe('REDIRECT_SCOPE_EXPANSION');
    expect(outcome.bytes).toBeUndefined();
    expect(outcome.terminalResult.stopReason).toBe('TARGET_CHANGED');
    // Bounded following: at most the initial request plus the hop budget.
    expect(origin.requests.length).toBeLessThanOrEqual(7);
    expect(outcome.allApplicableValidationPassed).toBe(false);
  });
});

describe('signed-locator refresh: expiry re-binds with provenance or fails closed', () => {
  it('expired signed locator refreshes to the same logical target with a provenance-bound URL', async () => {
    origin.on('/signed.bin', (_request, response) => {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('signature expired');
    });
    origin.serveFile('/signed-fresh.bin', {
      body: FULL,
      etag: '"fresh-1"',
      contentType: 'video/mp4',
    });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(originBase, '/signed.bin', FULL, { effectId: 'effect-001' }),
        locatorRefresher: async (current: LocatorBinding<LogicalTargetId>) =>
          unwrapOrThrow(
            bindLocator(
              { kind: 'signed', uri: origin.uri('/signed-fresh.bin') },
              current.identity,
              { binding: 'MEMBER_DELIVERY_EDGE', originLocatorUri: current.locator.uri },
            ),
          ),
      }),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.bytes).toEqual(FULL);
    expect(outcome.locatorChain.length).toBe(2);
    expect(outcome.locatorChain.every((binding) => binding.identity === 'target-file-001')).toBe(
      true,
    );
    // Both the expired and the refreshed request were charged to the seam.
    expect(ledger.transferRequestsReported).toBe(2);
  });

  it('refresh re-binding to a different logical target fails closed without fetching', async () => {
    const signedUri = origin.uri('/signed-other.bin');
    origin.on('/signed-other.bin', (_request, response) => {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('signature expired');
    });
    origin.serveFile('/signed-other-fresh.bin', { body: FULL, etag: '"fresh-2"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);
    const before = origin.requests.length;

    const outcome = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(originBase, '/signed-other.bin', FULL, { effectId: 'effect-001' }),
        locatorRefresher: async () =>
          unwrapOrThrow(
            bindLocator(
              { kind: 'signed', uri: origin.uri('/signed-other-fresh.bin') },
              targetIdOf('target-REPLACEMENT'),
              { binding: 'MEMBER_DELIVERY_EDGE', originLocatorUri: signedUri },
            ),
          ),
      }),
    );

    expect(outcome.reason).toBe('SIGNED_LOCATOR_REFRESH_FAILED');
    expect(outcome.bytes).toBeUndefined();
    expect(outcome.targetId).toBe('target-file-001');
    // The refreshed URL for the replacement target was never requested.
    expect(origin.requests.length).toBe(before + 1);
    expect(origin.requests.at(-1)?.path).toBe('/signed-other.bin');
  });

  it('refresh without provenance descending from the current locator fails closed', async () => {
    origin.on('/signed-noprovenance.bin', (_request, response) => {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('signature expired');
    });
    origin.serveFile('/signed-noprovenance-fresh.bin', { body: FULL, etag: '"fresh-3"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(originBase, '/signed-noprovenance.bin', FULL, {
          effectId: 'effect-001',
        }),
        locatorRefresher: async () =>
          unwrapOrThrow(
            bindLocator(
              { kind: 'signed', uri: origin.uri('/signed-noprovenance-fresh.bin') },
              targetIdOf('target-file-001'),
              { binding: 'MEMBER_DELIVERY_EDGE', originLocatorUri: 'https://elsewhere.example/x' },
            ),
          ),
      }),
    );

    expect(outcome.reason).toBe('SIGNED_LOCATOR_REFRESH_FAILED');
    expect(origin.requests.at(-1)?.path).toBe('/signed-noprovenance.bin');
  });
});
