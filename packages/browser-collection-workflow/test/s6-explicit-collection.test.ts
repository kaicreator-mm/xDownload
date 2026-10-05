/**
 * TEST_MATRIX suite `s6-explicit-collection` (+ C04, C06).
 *
 * Must prove (fixture/observation-feed level):
 * - a declared CollectionIdentity with a deterministic supported membership
 *   relation drives a finite or naturally terminable composed flow (C04):
 *   VERIFIED_COMPLETE only with identity/membership closure evidence via the
 *   declared natural-end relation;
 * - only declared collection continuation/member-detail edges are followed;
 *   any attempt at a general site frontier is rejected (C06);
 * - a natural-end signal without a declared template relation is not a stop
 *   authority (declared bounds stay frozen).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { decodeAcquisitionContract } from '@xdownload/domain-contracts';
import type { DiscoveryEvent } from '@xdownload/discovery-recipe';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import { runCollectionFlow } from '../src/index.ts';
import {
  budgetsOpen,
  injectedConfirmationSource,
  playlistContract,
  SCHEMA,
  seedBytes,
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

const ALL = ['pl-member-001', 'pl-member-002', 'pl-member-003', 'pl-member-004'];
const NATURAL_END_RELATION = { declaredByTemplate: true, templateRef: 'template/playlist-v1' };

async function startFixture(): Promise<string> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const member of ALL) {
    fixture.serveFile(`/${member}.bin`, {
      body: seedBytes(256, member),
      etag: `s6-${member}`,
    });
  }
  return baseUri;
}

function deliveryFor(baseUri: string) {
  return (memberId: string) => ({
    kind: 'direct' as const,
    targetId: memberId,
    artifactId: `artifact:${memberId}`,
    locator: { kind: 'direct' as const, uri: `${baseUri}/${memberId}.bin` },
    provenance: {
      binding: 'DECLARED_DELIVERY_EDGE' as const,
      originLocatorUri: `${baseUri}/playlist`,
    },
    declaredRedirectHosts: [new URL(baseUri).host],
    expectedSha256: sha256(seedBytes(256, memberId)),
  });
}

describe('T016 s6-explicit-collection', () => {
  it('reaches VERIFIED_COMPLETE only through the declared natural-end relation with identity closure (C04)', async () => {
    const baseUri = await startFixture();
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_NATURAL_END' },
      'DECLARED_CONTINUATION_EDGES',
    );
    // The supported template declares its deterministic membership relation:
    // the confirmed basis names exactly these four members.
    const snapshot = snapshotFor(contract, ALL.slice(0, 2));

    const rootDir = makeTempDir('t016-s6-c04');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const events: DiscoveryEvent[] = [
        { kind: 'MEMBER_OBSERVED', memberId: ALL[0]!, basis: 'FROZEN_BASIS' },
        { kind: 'MEMBER_OBSERVED', memberId: ALL[1]!, basis: 'FROZEN_BASIS' },
        // Two further members arrive through the declared continuation edge.
        { kind: 'MEMBER_OBSERVED', memberId: ALL[2]!, basis: 'CONTINUATION_EDGE' },
        { kind: 'MEMBER_OBSERVED', memberId: ALL[3]!, basis: 'CONTINUATION_EDGE' },
        // The template's validated end relation closes the collection.
        { kind: 'NATURAL_END_VALIDATED', relation: 'template/playlist-v1:endlist' },
      ];
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        naturalEndRelation: NATURAL_END_RELATION,
        events,
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(baseUri),
        declaredRequestedMemberIds: ALL,
        authorization: {
          origin: baseUri,
          provenanceChain: 'tab-9/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s6-c04',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T04:00:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // The natural-end stop is the validated declared relation.
      expect(result.session.stop).toEqual({
        kind: 'NATURAL_COLLECTION_END',
        validatedRelation: 'template/playlist-v1:endlist',
      });
      expect(result.requestedMemberIds).toEqual(ALL);

      // VERIFIED_COMPLETE only with identity closure evidence: the sufficient
      // basis is DECLARED_TOTAL_WITH_CLOSURE over the validated natural end.
      expect(result.coverageBasis?.kind).toBe('SUFFICIENT');
      if (result.coverageBasis?.kind === 'SUFFICIENT') {
        expect(result.coverageBasis.basis.basis).toBe('DECLARED_TOTAL_WITH_CLOSURE');
        if (result.coverageBasis.basis.basis === 'DECLARED_TOTAL_WITH_CLOSURE') {
          expect(result.coverageBasis.basis.closure).toBe('NATURAL_END_VALIDATED');
          expect(result.coverageBasis.basis.declaredTotal).toBe(4);
        }
      }
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('COMPLETE');
      expect(terminal?.targetResolution).toBe('RESOLVED');
      expect(terminal?.selectionAcquisition).toBe('COMPLETE');
      expect(terminal?.coverage).toBe('VERIFIED_COMPLETE');
      expect(terminal?.stopReason).toBe('NATURAL_COLLECTION_END');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('rejects any general site frontier: only declared collection/member edges are followed (C06)', async () => {
    const baseUri = await startFixture();
    const contract = playlistContract();
    const snapshot = snapshotFor(contract, ALL.slice(0, 2));

    const rootDir = makeTempDir('t016-s6-c06');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // (a) A crawl/frontier scope is structurally unrepresentable.
      const frontier = decodeAcquisitionContract({
        schemaIdentity: SCHEMA,
        contractId: 'contract-frontier-attempt',
        status: 'CONFIRMED',
        intentType: 'COLLECTION',
        requestedTarget: 'target-whole-domain',
        requestedScope: { kind: 'all_domain_pdfs', domain: 'fixture.invalid' },
        continuationScope: { kind: 'DECLARED_NATURAL_END' },
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
        automationMode: 'AUTO',
        explorationPermission: 'DECLARED_CONTINUATION_EDGES',
        budgetProfile: {
          discovery: { domain: 'discovery', maxNavigationActions: 1000 },
          transfer: { domain: 'transfer', maxBytes: 1_000_000_000 },
          globalSafety: { domain: 'global_safety' },
        },
        authorizationContextRef: 'authctx/local-frontier',
        validationPolicy: { requiredLayers: ['membership', 'target'] },
        stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
        resultPolicy: { requireMultidimensionalResult: true },
        confirmedAt: '2026-10-04T02:00:00Z',
      });
      expect(frontier.ok).toBe(false);
      if (!frontier.ok) {
        expect(frontier.diagnostics[0]?.code).toBe('UNKNOWN_ENUM_VALUE');
      }

      // (b) A page observation outside the confirmed collection bounds is
      // typed-rejected by the composed flow; the frontier never widens.
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        events: [
          { kind: 'MEMBER_OBSERVED', memberId: ALL[0]!, basis: 'FROZEN_BASIS' },
          { kind: 'MEMBER_OBSERVED', memberId: ALL[1]!, basis: 'FROZEN_BASIS' },
          { kind: 'PAGE_OBSERVED', logicalPage: 999, pageIdentity: 'frontier-page-999' },
          // The confirmed collection walk closes; the frontier page stayed out.
          { kind: 'COLLECTION_ENUMERATION_CLOSED' },
        ] as DiscoveryEvent[],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(baseUri),
        declaredRequestedMemberIds: ALL.slice(0, 2),
        authorization: {
          origin: baseUri,
          provenanceChain: 'tab-9/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s6-c06',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T04:10:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      // Page events carry no page-accounting authority in member-basis
      // collection scopes; the frontier observation never widened membership:
      // resolved members stay exactly the confirmed two.
      expect(outcome.result.session.resolvedMemberIds).toEqual(ALL.slice(0, 2));
      expect(outcome.result.terminalResult?.coverage).toBe('VERIFIED_COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('treats an undeclared natural-end signal as a non-authority and keeps declared bounds frozen', async () => {
    const baseUri = await startFixture();
    // Batch-count continuation WITHOUT a declared natural-end relation.
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 1 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, ALL.slice(0, 2));

    const rootDir = makeTempDir('t016-s6-undeclared-end');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        // A natural-end signal without a declared template relation must not
        // stop discovery or widen anything; the declared batch bound governs.
        events: [
          { kind: 'MEMBER_OBSERVED', memberId: ALL[0]!, basis: 'FROZEN_BASIS' },
          { kind: 'MEMBER_OBSERVED', memberId: ALL[1]!, basis: 'FROZEN_BASIS' },
          { kind: 'NATURAL_END_VALIDATED', relation: 'template/playlist-v1:endlist' },
          { kind: 'MEMBER_OBSERVED', memberId: ALL[2]!, basis: 'CONTINUATION_EDGE' },
          { kind: 'MEMBER_OBSERVED', memberId: ALL[3]!, basis: 'CONTINUATION_EDGE' },
        ] as DiscoveryEvent[],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(baseUri),
        declaredRequestedMemberIds: ALL,
        authorization: {
          origin: baseUri,
          provenanceChain: 'tab-9/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s6-end',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T04:20:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;
      // The undeclared signal never stopped the session as natural end.
      expect(result.session.stop?.kind).not.toBe('NATURAL_COLLECTION_END');
      // The declared batch bound (count 1) still governs continuation.
      expect(result.session.continuationMembersAdmitted).toBe(1);
      expect(
        result.rejections.some(
          (rejection) => rejection.kind === 'DECLARED_BOUND_REACHED' && rejection.count === 1,
        ),
      ).toBe(true);
      expect(result.session.stop?.kind).toBe('USER_SCOPE_REACHED');
    } finally {
      closeRuntime(runtime);
    }
  });
});
