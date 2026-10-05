/**
 * TEST_MATRIX suite `provenance-redirects` (+ C07, C29; negative
 * unrelated-redirect-inheriting-logical-target-identity).
 *
 * Must prove (fixture level):
 * - a provenance-bound redirect/CDN locator transition on an S2 member
 *   preserves logical target identity through the composed flow (C29);
 * - an unrelated redirect that does not descend from recorded provenance is
 *   rejected/fails truthfully and cannot silently substitute the target;
 * - locator changes are recorded as provenance facts without mutating
 *   contract/snapshot identity;
 * - member detail/CDN delivery hops keep logical member identity only through
 *   provenance-descending transitions (C07).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { resolveMemberDeliveryHop } from '@xdownload/discovery-recipe';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import { projectS2Flow, runS2AttachmentFlow } from '../src/index.ts';
import { pageContextObservation, sha256, singleResourceContract } from './fixtures.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = singleResourceContract();
const SNAPSHOT = 'snapshot-for-contract-s2-attachment';
const MEMBER = 'member-s2-file-001';
const TARGET_URI = '/file.bin';

function baseDelivery(baseUri: string, cdnBaseUri: string, bytes: Uint8Array) {
  return {
    locator: { kind: 'direct' as const, uri: `${baseUri}${TARGET_URI}` },
    provenance: {
      binding: 'SELECTED_RESOURCE_PROVENANCE' as const,
      originLocatorUri: `${baseUri}${TARGET_URI}`,
    },
    declaredRedirectHosts: [new URL(cdnBaseUri).host],
    expectedSha256: sha256(bytes),
  };
}

function observationFor(origin: string) {
  const raw = pageContextObservation({ origin, pageUrl: `${origin}/watch/29` });
  return { raw, observationId: 'obs-c29', capturedAtMs: 2_000 };
}

describe('T016 provenance-redirects', () => {
  it('accepts a provenance-bound redirect to the declared CDN and preserves logical target identity (C29)', async () => {
    const page = new ControlledHttpFixture();
    const cdn = new ControlledHttpFixture();
    fixtures.push(page, cdn);
    const pageBase = await page.start();
    const cdnBase = await cdn.start();
    const bytes = payload(1024, 8);
    page.redirect(TARGET_URI, `${cdnBase}/cdn/file.bin`);
    cdn.serveFile('/cdn/file.bin', { body: bytes, etag: 'cdn-etag' });

    const rootDir = makeTempDir('t016-c29-ok');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runS2AttachmentFlow({
        runtime,
        broker: createAuthBroker(),
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:c29-001',
        commandId: 'cmd-c29-001',
        observation: observationFor(pageBase),
        authorization: { origin: pageBase, ttlMs: 60_000, issueDecisionToken: 'user-confirm:c29' },
        delivery: baseDelivery(pageBase, cdnBase, bytes),
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // The declared-CDN hop is accepted and the final target validates.
      expect(outcome.flow.transfer?.reason).toBe('COMPLETED');
      expect(outcome.flow.transfer?.allApplicableValidationPassed).toBe(true);

      // Every hop keeps the frozen logical target identity; the hop is
      // recorded as a provenance fact with its binding kind.
      const facts = (outcome.flow.transfer?.locatorChain ?? []).map((hop) => ({
        identity: hop.identity,
        uri: hop.locator.uri,
        kind: hop.locator.kind,
        binding: hop.provenance.binding,
      }));
      expect(facts.length).toBe(2);
      expect(facts[0]?.uri).toBe(`${pageBase}${TARGET_URI}`);
      expect(facts[1]?.uri).toBe(`${cdnBase}/cdn/file.bin`);
      // The adapter records the hop with its canonical locator kind.
      expect(facts[1]?.kind).toBe('redirect');
      expect(new Set(facts.map((hop) => hop.identity)).size).toBe(1);
      expect(String(facts[0]?.identity)).toBe(CONTRACT.requestedTarget);

      // Contract/snapshot identity is unchanged by the locator transition:
      // the durable submission still binds the original contract/snapshot.
      expect(outcome.flow.submission.binding.contractId).toBe(CONTRACT.contractId);
      expect(outcome.flow.submission.binding.snapshotId).toBe(SNAPSHOT);

      const projected = projectS2Flow({
        runtime,
        flow: outcome.flow,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        recordedAt: '2026-10-04T03:00:00Z',
      });
      expect(projected.ok ? projected.value.result.requestFulfillment : undefined).toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('rejects an unrelated redirect without silent target substitution (negative)', async () => {
    const page = new ControlledHttpFixture();
    const cdn = new ControlledHttpFixture();
    const unrelated = new ControlledHttpFixture();
    fixtures.push(page, cdn, unrelated);
    const pageBase = await page.start();
    const cdnBase = await cdn.start();
    const unrelatedBase = await unrelated.start();
    const bytes = payload(1024, 9);
    // The declared delivery policy names only the declared CDN host; the page
    // redirects to an unrelated host instead.
    page.redirect(TARGET_URI, `${unrelatedBase}/evil/file.bin`);
    unrelated.serveFile('/evil/file.bin', { body: bytes, etag: 'evil-etag' });
    cdn.serveFile('/cdn/file.bin', { body: bytes, etag: 'cdn-etag' });

    const rootDir = makeTempDir('t016-c29-bad');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runS2AttachmentFlow({
        runtime,
        broker: createAuthBroker(),
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:c29-002',
        commandId: 'cmd-c29-002',
        observation: observationFor(pageBase),
        authorization: { origin: pageBase, ttlMs: 60_000, issueDecisionToken: 'user-confirm:c29b' },
        delivery: baseDelivery(pageBase, cdnBase, bytes),
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // The unrelated redirect fails closed (typed LOCATOR_SUBSTITUTION): no
      // validations pass, nothing is accepted, nothing is projected complete.
      expect(outcome.flow.transfer?.reason).toBe('LOCATOR_SUBSTITUTION');
      expect(outcome.flow.transfer?.allApplicableValidationPassed).toBe(false);
      expect(outcome.flow.acceptance).toBeUndefined();

      // No silent substitution: the recorded hops all still carry the frozen
      // logical target identity — the unrelated host never inherits it.
      const chain = outcome.flow.transfer?.locatorChain ?? [];
      expect(chain.length).toBeGreaterThan(0);
      expect(new Set(chain.map((hop) => hop.identity)).size).toBe(1);
      expect(String(chain[0]?.identity)).toBe(CONTRACT.requestedTarget);

      const projected = projectS2Flow({
        runtime,
        flow: outcome.flow,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        recordedAt: '2026-10-04T03:00:00Z',
      });
      expect(projected.ok).toBe(true);
      const terminal = projected.ok ? projected.value.result : undefined;
      expect(terminal?.requestFulfillment).not.toBe('COMPLETE');
      expect(terminal?.validationSummary.status).not.toBe('ALL_PASSED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('keeps member identity across provenance-bound delivery hops and rejects unrelated substitution (C07)', () => {
    const memberTarget = unwrapOrThrow(makeLogicalTargetId('member-c07-001'));
    const memberLocator = unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: 'https://fixture.invalid/watch/7' }, memberTarget, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://fixture.invalid/watch/7',
      }),
    );

    // A member-detail hop descending from the previous delivery locator keeps
    // the logical member identity (C07).
    const detailHop = resolveMemberDeliveryHop({
      memberLocator,
      nextLocator: { kind: 'cdn', uri: 'https://cdn.fixture.invalid/media/7.bin' },
      nextProvenance: {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://fixture.invalid/watch/7',
      },
    });
    expect(detailHop.ok).toBe(true);
    if (detailHop.ok) {
      expect(detailHop.value.identity).toBe(memberTarget);
    }

    // An unrelated substitution (no descending provenance) is rejected
    // instead of silently becoming the member's new truth.
    const substituted = resolveMemberDeliveryHop({
      memberLocator,
      nextLocator: { kind: 'cdn', uri: 'https://elsewhere.invalid/media/7.bin' },
      nextProvenance: {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://unrelated.invalid/other',
      },
    });
    expect(substituted.ok).toBe(false);
    if (!substituted.ok) {
      expect(substituted.diagnostics[0]?.code).toBe('LOCATOR_SUBSTITUTION_REJECTED');
    }
  });
});
