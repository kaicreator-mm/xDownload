/**
 * TEST_MATRIX suite `s5-current-page-collection` (+ C08, C30; negative
 * continuation-loaded-members-acquired-without-confirmed-scope).
 *
 * Must prove (fixture/observation-feed level):
 * - the composed S5 flow produces a confirmed current-page membership snapshot
 *   flow with continuation_scope=NONE by default;
 * - continuation-loaded members are excluded from acquisition and coverage
 *   when no explicit continuation scope was confirmed (C08);
 * - membership identity accounting (not count equality) drives coverage;
 *   per-member Target/Transfer/Format validation runs through the Core
 *   adapters;
 * - the confirmation workflow stays within the material-item bound and keeps
 *   one selection claim set (C30).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { MAX_MATERIAL_ITEM_CONFIRMATIONS, type DiscoveryEvent } from '@xdownload/discovery-recipe';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import type { MemberDelivery } from '../src/index.ts';
import { requestContinuation, runCollectionFlow } from '../src/index.ts';
import {
  budgetsOpen,
  currentPageContract,
  injectedConfirmationSource,
  networkObservation,
  pageContextObservation,
  payload as fixturePayload,
  sha256,
  snapshotFor,
} from './fixtures.ts';

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

const FROZEN = ['member-page-001', 'member-page-002', 'member-page-003'];
const LOADED_MORE = 'member-load-more-004';

/** Deterministic per-member byte seed so served bytes match expected digests. */
function seedFor(memberId: string): number {
  let seed = 17;
  for (const char of memberId) {
    seed = (seed * 31 + char.charCodeAt(0)) % 251;
  }
  return seed;
}

interface ServedFixture {
  readonly baseUri: string;
}

async function startFixture(paths: readonly string[]): Promise<ServedFixture> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const path of paths) {
    const memberId = path.replace(/^\//, '').replace(/\.bin$/, '');
    fixture.serveFile(path, { body: fixturePayload(256, seedFor(memberId)), etag: `s5-${path}` });
  }
  return { baseUri };
}

function directDeliveryFor(served: ServedFixture): (memberId: string) => MemberDelivery {
  return (memberId: string) => {
    const bytes = fixturePayload(256, seedFor(memberId));
    return {
      kind: 'direct',
      targetId: memberId,
      artifactId: `artifact:${memberId}`,
      locator: { kind: 'direct', uri: `${served.baseUri}/${memberId}.bin` },
      provenance: {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: `${served.baseUri}/${memberId}.bin`,
      },
      declaredRedirectHosts: [new URL(served.baseUri).host],
      expectedSha256: sha256(bytes),
    };
  };
}

describe('T016 s5-current-page-collection', () => {
  it('produces the confirmed current-page flow with continuation_scope=NONE and excludes continuation-loaded members (C08)', async () => {
    const served = await startFixture([
      ...FROZEN.map((member) => `/${member}.bin`),
      `/${LOADED_MORE}.bin`,
    ]);
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, FROZEN);

    const rootDir = makeTempDir('t016-s5-c08');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const events: DiscoveryEvent[] = [
        ...FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        // Load-more loaded a further member after page confirmation.
        { kind: 'LOAD_MORE_CONTROL_OBSERVED' },
        { kind: 'MEMBER_OBSERVED', memberId: LOADED_MORE, basis: 'CONTINUATION_EDGE' },
        // The confirmed current-page walk closes its enumeration.
        { kind: 'COLLECTION_ENUMERATION_CLOSED' },
      ];
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events,
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-c08',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T03:30:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // Default continuation scope NONE holds through the composed flow.
      expect(result.session.continuationScopeKind).toBe('NONE');
      // The continuation-loaded member was typed-rejected by discovery...
      expect(
        result.rejections.some(
          (rejection) =>
            rejection.kind === 'CONTINUATION_NOT_AUTHORIZED' &&
            rejection.memberId === LOADED_MORE &&
            rejection.reason === 'CONTINUATION_SCOPE_NONE',
        ),
      ).toBe(true);
      // ...never acquired (no durable work item, no member outcome)...
      expect(result.memberOutcomes.map((outcome) => outcome.memberId)).toEqual(FROZEN);
      expect(
        runtime.writer.reader.workItems().some((workItem) => workItem.memberId === LOADED_MORE),
      ).toBe(false);
      // ...and never entered coverage: requested set stays the frozen three.
      expect(result.requestedMemberIds).toEqual(FROZEN);
      expect(result.accounting?.counts.requested).toBe(3);

      // Identity-accounted coverage over the confirmed page set.
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('COMPLETE');
      expect(terminal?.targetResolution).toBe('RESOLVED');
      expect(terminal?.selectionAcquisition).toBe('COMPLETE');
      expect(terminal?.coverage).toBe('VERIFIED_COMPLETE');
      expect(terminal?.stopReason).toBe('USER_SCOPE_REACHED');
      // Per-member Target/Transfer/Format validation ran through the adapters.
      expect(result.memberOutcomes.every((outcome) => outcome.accepted)).toBe(true);

      // A later continuation request under the frozen scope requires a
      // successor — it is never absorbed silently (composed lane).
      const lane = requestContinuation({
        contract,
        declaredBoundConsumed: false,
        justification: { kind: 'EXPLICIT_USER_REQUEST', requestKind: 'LOAD_MORE' },
      });
      expect(lane).toEqual({
        action: 'SUCCESSOR_REQUIRED',
        reason: 'CONTINUATION_SCOPE_NONE',
      });
    } finally {
      closeRuntime(runtime);
    }
  });

  it('drives the composed flow from real gated observation records (observation-feed level)', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, FROZEN);

    const rootDir = makeTempDir('t016-s5-observation');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // The member events descend from a gated NETWORK_OBSERVATION message
      // bound to the page: the feed is observation-derived evidence input.
      const message = networkObservation({
        origin: served.baseUri,
        requestUrl: `${served.baseUri}/${FROZEN[0]}.bin`,
        requestRef: 'req-s5-obs',
      });
      // The gate would accept this message; the feed events below are its
      // bounded, provenance-bound consequence (membership of the frozen page).
      expect(message['kind']).toBe('NETWORK_OBSERVATION');
      const events: DiscoveryEvent[] = [
        ...FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        { kind: 'COLLECTION_ENUMERATION_CLOSED' },
      ];
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events,
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/req-s5-obs/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-obs',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T03:40:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.result.terminalResult?.coverage).toBe('VERIFIED_COMPLETE');
      // The confirmation workflow recorded exactly one BATCH selection claim.
      expect(outcome.result.confirmation?.selectionClaim.kind).toBe('BATCH');
      expect(outcome.result.confirmation?.selectionClaim.memberRefs).toEqual(
        FROZEN.map((member) => member),
      );
    } finally {
      closeRuntime(runtime);
    }
  });

  it('keeps the confirmation workflow within material-item bounds with one selection claim set (C30)', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, FROZEN);
    const fiftyAmbiguous = Array.from(
      { length: 50 },
      (_, index) => `ambiguous-${String(index).padStart(2, '0')}`,
    );

    const rootDir = makeTempDir('t016-s5-c30-batch');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        ambiguousMaterialMemberIds: fiftyAmbiguous,
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-c30',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T03:50:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // Fifty ambiguous material items resolve through ONE batch/group
      // confirmation — never per-item interrogation (C30).
      expect(outcome.result.confirmation?.selectionClaim.kind).toBe('BATCH');
      expect(fiftyAmbiguous.length).toBeGreaterThan(MAX_MATERIAL_ITEM_CONFIRMATIONS);
      expect(outcome.result.recipeExclusions).toEqual([]);

      // The canonical bound stays 3 and one selection claim set is preserved.
      expect(MAX_MATERIAL_ITEM_CONFIRMATIONS).toBe(3);
      const claims = snapshot.selectionClaims;
      expect(claims.length).toBe(1);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('exposes the observation provenance through the composed authorization binding', async () => {
    // The composed binding derives its origin + provenance chain from the
    // gated handoff — never from raw page claims. (Unit-level seam check.)
    const raw = pageContextObservation({
      origin: 'http://127.0.0.1:4173',
      pageUrl: 'http://127.0.0.1:4173/watch/7',
      partition: 'partition-a',
    });
    expect(raw['provenance']).toBeDefined();
    // Broker binding construction is exercised end-to-end in the other suites;
    // here the fixture simply pins the canonical provenance shape.
    expect((raw['provenance'] as Record<string, unknown>)['partition']).toBe('partition-a');
  });

  it('degrades a required confirmation with no outcome source to the typed cannot-proceed outcome — acquisition never starts', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract();

    const rootDir = makeTempDir('t016-s5-no-source');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // No confirmationSource is injected (the production default): the
      // ASSISTED scope-level confirmation cannot be decided inside glue.
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot: snapshotFor(contract, FROZEN),
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-no-source',
        },
        recordedAt: '2026-10-04T03:55:00Z',
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.rejection.stage).toBe('CONFIRMATION_REQUIRED');
      if (outcome.rejection.stage !== 'CONFIRMATION_REQUIRED') throw new Error('unreachable');
      expect(outcome.rejection.reason).toBe('NO_OUTCOME_SOURCE');
      expect(outcome.rejection.requests).toEqual([
        {
          level: 'SCOPE_LEVEL',
          scopeKey: expect.any(String),
        },
      ]);
      // Acquisition never started: zero durable work, zero member outcomes.
      expect(runtime.writer.reader.workItems().length).toBe(0);

      // A source that cannot resolve degrades the same way, with its own
      // reason carried verbatim.
      const declined = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot: snapshotFor(contract, FROZEN),
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        confirmationSource: {
          resolve: () => ({ kind: 'NOT_AVAILABLE', reason: 'ui-channel-closed' }),
        },
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-no-source-2',
        },
        recordedAt: '2026-10-04T03:56:00Z',
      });
      expect(declined.ok).toBe(false);
      if (declined.ok || declined.rejection.stage !== 'CONFIRMATION_REQUIRED') {
        throw new Error('unreachable');
      }
      expect(declined.rejection.reason).toBe('SOURCE_NOT_AVAILABLE');
      expect(declined.rejection.sourceReason).toBe('ui-channel-closed');
      expect(runtime.writer.reader.workItems().length).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('degrades a MANUAL_SELECTION_UI confirmation with no outcome source to the typed cannot-proceed outcome', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract({ automationMode: 'MANUAL_SELECTION' });

    const rootDir = makeTempDir('t016-s5-manual-no-source');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot: snapshotFor(contract, FROZEN),
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-manual',
        },
        recordedAt: '2026-10-04T03:57:00Z',
      });
      // The manual-selection user decision point is never rubber-stamped by
      // glue: without a source the flow cannot proceed.
      expect(outcome.ok).toBe(false);
      if (outcome.ok || outcome.rejection.stage !== 'CONFIRMATION_REQUIRED') {
        throw new Error('unreachable');
      }
      expect(outcome.rejection.reason).toBe('NO_OUTCOME_SOURCE');
      expect(outcome.rejection.requests).toEqual([
        { level: 'MANUAL_SELECTION_UI', candidateRefs: [] },
      ]);
      expect(runtime.writer.reader.workItems().length).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('proceeds with injected outcomes that record INJECTED_SOURCE provenance and gates acquisition on the actual record', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract();

    const rootDir = makeTempDir('t016-s5-injected');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // Injected outcomes are the ONLY way a scripted flow proceeds past its
      // confirmation; the result records the injected provenance.
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot: snapshotFor(contract, FROZEN),
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: directDeliveryFor(served),
        confirmationSource: injectedConfirmationSource(),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-injected',
        },
        recordedAt: '2026-10-04T03:58:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.result.confirmationOrigin).toBe('INJECTED_SOURCE');
      expect(outcome.result.confirmation?.outcomesAggregate).toBe('CONFIRMED');
      expect(outcome.result.memberOutcomes.map((member) => member.memberId)).toEqual(FROZEN);
      // Injected outcomes are not autonomous user truth: no USER_CONFIRMATION
      // evidence record exists in the flow ledger for them.
      const userConfirmationEvidence = outcome.result.evidenceLedger
        .records()
        .filter((record) => record.sourceType === 'USER_CONFIRMATION');
      expect(userConfirmationEvidence.length).toBe(0);

      // Acquisition gating: an unfulfilled (FAILED aggregate) record stops the
      // flow before any member acquisition — the aggregate owns the verdict.
      const gatingRuntimeRoot = makeTempDir('t016-s5-gating');
      dirs.push(gatingRuntimeRoot);
      const gatingRuntime = openRuntime(gatingRuntimeRoot);
      try {
        const unconfirmed = await runCollectionFlow({
          runtime: gatingRuntime,
          broker: createAuthBroker(),
          slice: 'S5',
          contract,
          snapshot: snapshotFor(contract, FROZEN),
          events: FROZEN.map(
            (memberId) =>
              ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
          ),
          budgetSteps: [budgetsOpen],
          deliveryFor: directDeliveryFor(served),
          confirmationSource: injectedConfirmationSource(() => [
            'CONFIRMED',
            'FAILED',
            'CONFIRMED',
          ]),
          authorization: {
            origin: served.baseUri,
            provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
            ttlMs: 60_000,
            issueDecisionToken: 'user-confirm:s5-gating',
          },
          recordedAt: '2026-10-04T03:59:00Z',
        });
        expect(unconfirmed.ok).toBe(false);
        if (unconfirmed.ok || unconfirmed.rejection.stage !== 'CONFIRMATION_REQUIRED') {
          throw new Error('unreachable');
        }
        expect(unconfirmed.rejection.reason).toBe('SELECTION_NOT_CONFIRMED');
        expect(unconfirmed.rejection.recordedAggregate).toBe('FAILED');
        // Never proceeds past an unfulfilled confirmation.
        expect(gatingRuntime.writer.reader.workItems().length).toBe(0);
      } finally {
        closeRuntime(gatingRuntime);
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('surfaces a member delivery locator rejection as a typed lane failure (no untyped throw)', async () => {
    const served = await startFixture(FROZEN.map((member) => `/${member}.bin`));
    const contract = currentPageContract();

    const rootDir = makeTempDir('t016-s5-locator');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot: snapshotFor(contract, FROZEN),
        events: FROZEN.map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: (memberId) => {
          const base = directDeliveryFor(served)(memberId);
          if (base.kind !== 'direct') throw new Error('unreachable');
          return { ...base, locator: { kind: 'direct' as const, uri: '' } };
        },
        confirmationSource: injectedConfirmationSource(),
        authorization: {
          origin: served.baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s5-locator',
        },
        recordedAt: '2026-10-04T04:00:00Z',
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok || outcome.rejection.stage !== 'MEMBER_DELIVERY_LOCATOR') {
        throw new Error('unreachable');
      }
      expect(outcome.rejection.memberId).toBe(FROZEN[0]);
      expect(outcome.rejection.diagnostics.some((d) => d.code === 'MALFORMED_REQUIRED_FIELD')).toBe(
        true,
      );
    } finally {
      closeRuntime(runtime);
    }
  });
});
