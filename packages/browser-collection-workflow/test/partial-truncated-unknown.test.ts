/**
 * TEST_MATRIX suite `partial-truncated-unknown-truth`
 * (+ C02, C03, C14, C23, C25, C28).
 *
 * Must prove (fixture/observation-feed level):
 * - discovery-budget exhaustion mid-collection yields the truthful
 *   PARTIAL/TRUNCATED tuple with a DiscoveryBudget stop reason and no
 *   continuation inference (C23);
 * - a global-safety cap stops the composed flow and projects
 *   PARTIAL/PARTIAL/TRUNCATED — never COMPLETE from cap exhaustion (C02);
 * - a failed next page / missing next control is failure, not natural end:
 *   coverage stays UNKNOWN with a truthful stop reason (C03);
 * - discovered targets succeeding while enumeration is unfinished never
 *   produce VERIFIED_COMPLETE coverage (C14);
 * - range-scoped requests bind CoverageTarget to the requested pages;
 *   VERIFIED_COMPLETE for the request never implies parent completeness (C25);
 * - a frozen-target HLS acquisition still executes through the Core budget
 *   ports after discovery exhaustion while Transfer/GlobalSafety remain, and
 *   the discovery stop stays truthful (C28);
 * - every terminal flow result is multidimensional, projected only through
 *   the T007 layer (canonical TerminalResult key set).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import {
  bindRenditionToTarget,
  createSyntheticMediaAssemblyPort,
  createSyntheticSegmentBytes,
  decodeMasterPlaylist,
  decodeMediaPlaylist,
} from '@xdownload/hls-vod-adapter';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
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
  budgetsDiscoveryExhausted,
  budgetsGlobalExhausted,
  budgetsOpen,
  currentPageContract,
  injectedConfirmationSource,
  pageRangeContract,
  playlistContract,
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

const PAGE_MEMBERS = ['pg-member-001', 'pg-member-002', 'pg-member-003', 'pg-member-004'];
const RANGE_MEMBERS = [
  'rg-member-p1a',
  'rg-member-p1b',
  'rg-member-p2a',
  'rg-member-p2b',
  'rg-member-p3a',
  'rg-member-p3b',
];

async function startFixture(members: readonly string[]): Promise<string> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const member of members) {
    fixture.serveFile(`/${member}.bin`, { body: seedBytes(128, member), etag: `p-${member}` });
  }
  return baseUri;
}

function deliveryFor(served: string) {
  return (memberId: string) => ({
    kind: 'direct' as const,
    targetId: memberId,
    artifactId: `artifact:${memberId}`,
    locator: { kind: 'direct' as const, uri: `${served}/${memberId}.bin` },
    provenance: {
      binding: 'SELECTED_RESOURCE_PROVENANCE' as const,
      originLocatorUri: `${served}/${memberId}.bin`,
    },
    declaredRedirectHosts: [new URL(served).host],
    expectedSha256: sha256(seedBytes(128, memberId)),
  });
}

const frozen = (memberId: string): DiscoveryEvent => ({
  kind: 'MEMBER_OBSERVED',
  memberId,
  basis: 'FROZEN_BASIS',
});
const continuation = (memberId: string): DiscoveryEvent => ({
  kind: 'MEMBER_OBSERVED',
  memberId,
  basis: 'CONTINUATION_EDGE',
});

function auth(served: string, token: string) {
  return {
    origin: served,
    provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
    ttlMs: 60_000,
    issueDecisionToken: token,
  };
}

describe('T016 partial-truncated-unknown-truth', () => {
  it('projects PARTIAL/PARTIAL/TRUNCATED when the global-safety cap stops a batch continuation (C02)', async () => {
    const served = await startFixture(PAGE_MEMBERS);
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 4 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, PAGE_MEMBERS.slice(0, 2));

    const rootDir = makeTempDir('t016-c02');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        events: [
          frozen(PAGE_MEMBERS[0]!),
          frozen(PAGE_MEMBERS[1]!),
          continuation(PAGE_MEMBERS[2]!),
          continuation(PAGE_MEMBERS[3]!),
        ],
        // The global-safety domain exhausts at the declared bound: the cap
        // stops discovery — it never becomes end of user scope.
        budgetSteps: [budgetsOpen, budgetsOpen, budgetsGlobalExhausted],
        deliveryFor: deliveryFor(served),
        declaredRequestedMemberIds: PAGE_MEMBERS,
        authorization: auth(served, 'user-confirm:c02'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:00:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;
      expect(result.session.stop?.kind).toBe('DISCOVERY_BUDGET_EXHAUSTED');

      // PARTIAL / PARTIAL / TRUNCATED through the Core projector — no
      // synthesized COMPLETE from cap exhaustion.
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.targetResolution).toBe('PARTIAL');
      expect(terminal?.coverage).toBe('TRUNCATED');
      expect(terminal?.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
      expect(result.enumeration).toEqual({ kind: 'TRUNCATED', by: 'GLOBAL_SAFETY' });
    } finally {
      closeRuntime(runtime);
    }
  });

  it('treats a failed next page / missing control as failure, never natural end (C03)', async () => {
    const served = await startFixture(RANGE_MEMBERS);
    const contract = pageRangeContract(1, 2);
    const snapshot = snapshotFor(contract, RANGE_MEMBERS.slice(0, 2));

    const rootDir = makeTempDir('t016-c03');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        events: [
          { kind: 'PAGE_OBSERVED', logicalPage: 1, pageIdentity: 'gallery-p1' },
          frozen(RANGE_MEMBERS[0]!),
          frozen(RANGE_MEMBERS[1]!),
          // The next page fails: continuation is unclosable — this is failure,
          // never natural end.
          { kind: 'PAGE_FAILED' },
        ],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(served),
        declaredRequestedMemberIds: RANGE_MEMBERS.slice(0, 4),
        authorization: auth(served, 'user-confirm:c03'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:10:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;
      expect(result.session.stop).toEqual({
        kind: 'CONTINUATION_UNCLOSABLE',
        cause: 'FAILED_NEXT_PAGE',
      });

      // Coverage stays UNKNOWN-or-TRUNCATED with a truthful stop reason; the
      // acquired page-1 members stand but never synthesize completeness.
      const terminal = result.terminalResult;
      expect(terminal?.coverage).toBe('UNKNOWN');
      expect(terminal?.stopReason).toBe('NO_PROGRESS');
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.targetResolution).toBe('PARTIAL');

      // NEXT_CONTROL_MISSING behaves the same way (second fixture runtime).
      const rootDir2 = makeTempDir('t016-c03b');
      dirs.push(rootDir2);
      const runtime2 = openRuntime(rootDir2);
      try {
        const outcome2 = await runCollectionFlow({
          runtime: runtime2,
          broker: createAuthBroker(),
          slice: 'S6',
          contract,
          snapshot,
          events: [
            { kind: 'PAGE_OBSERVED', logicalPage: 1, pageIdentity: 'gallery-p1' },
            frozen(RANGE_MEMBERS[0]!),
            frozen(RANGE_MEMBERS[1]!),
            { kind: 'NEXT_CONTROL_MISSING' },
          ],
          budgetSteps: [budgetsOpen],
          deliveryFor: deliveryFor(served),
          declaredRequestedMemberIds: RANGE_MEMBERS.slice(0, 4),
          authorization: auth(served, 'user-confirm:c03b'),
          confirmationSource: injectedConfirmationSource(),
          recordedAt: '2026-10-04T07:12:00Z',
        });
        expect(outcome2.ok).toBe(true);
        if (!outcome2.ok) throw new Error('unreachable');
        expect(outcome2.result.session.stop).toEqual({
          kind: 'CONTINUATION_UNCLOSABLE',
          cause: 'NEXT_CONTROL_MISSING',
        });
        expect(outcome2.result.terminalResult?.coverage).toBe('UNKNOWN');
        expect(outcome2.result.terminalResult?.stopReason).toBe('NO_PROGRESS');
      } finally {
        closeRuntime(runtime2);
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('never projects VERIFIED_COMPLETE while enumeration is unfinished (C14)', async () => {
    const served = await startFixture(PAGE_MEMBERS);
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, PAGE_MEMBERS);

    const rootDir = makeTempDir('t016-c14');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // Only two of the four frozen members were observed; the feed ends
      // without any closure event — enumeration truth is NOT_EXERCISED.
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events: [frozen(PAGE_MEMBERS[0]!), frozen(PAGE_MEMBERS[1]!)],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(served),
        authorization: auth(served, 'user-confirm:c14'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:20:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;
      expect(result.session.stop).toBeUndefined();
      expect(result.enumeration).toEqual({ kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' });

      // Selection may complete over the acquired subset while the request
      // stays partial — and coverage never becomes VERIFIED_COMPLETE.
      const terminal = result.terminalResult;
      expect(terminal?.selectionAcquisition).toBe('COMPLETE');
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.coverage).toBe('VERIFIED_SUBSET');
      expect(terminal?.coverage).not.toBe('VERIFIED_COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('projects the exact C23 tuple under discovery-budget exhaustion with no continuation inference', async () => {
    const served = await startFixture(PAGE_MEMBERS);
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 4 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, PAGE_MEMBERS.slice(0, 2));

    const rootDir = makeTempDir('t016-c23');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        events: [
          frozen(PAGE_MEMBERS[0]!),
          frozen(PAGE_MEMBERS[1]!),
          continuation(PAGE_MEMBERS[2]!),
          continuation(PAGE_MEMBERS[3]!),
        ],
        // DiscoveryBudget exhausts before the fourth member: enumeration
        // stops truthfully — the exhausted budget implies nothing.
        budgetSteps: [budgetsOpen, budgetsOpen, budgetsOpen, budgetsDiscoveryExhausted],
        deliveryFor: deliveryFor(served),
        declaredRequestedMemberIds: PAGE_MEMBERS,
        authorization: auth(served, 'user-confirm:c23'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:30:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // PARTIAL / PARTIAL / COMPLETE / TRUNCATED / DISCOVERY_BUDGET_EXHAUSTED.
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.targetResolution).toBe('PARTIAL');
      expect(terminal?.selectionAcquisition).toBe('COMPLETE');
      expect(terminal?.coverage).toBe('TRUNCATED');
      expect(terminal?.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
      expect(result.enumeration).toEqual({ kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' });
      expect(result.stopFacts.discoveryBudgetExhausted).toBe(true);

      // No continuation was inferred from the exhausted budget: the flow
      // minted no successor identity and stayed within the declared bound.
      expect(result.session.continuationMembersAdmitted).toBe(1);
      expect(JSON.stringify(result)).not.toContain('successor');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('binds coverage to the requested page range and never implies parent completeness (C25)', async () => {
    const served = await startFixture(RANGE_MEMBERS);
    const contract = pageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, RANGE_MEMBERS);

    const rootDir = makeTempDir('t016-c25');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const pages = [1, 2, 3].map(
        (page) =>
          ({
            kind: 'PAGE_OBSERVED',
            logicalPage: page,
            pageIdentity: `gallery-p${page}`,
          }) as DiscoveryEvent,
      );
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        // Members of the requested range resolve, then the page walk completes
        // (page three closes the frozen range with USER_SCOPE_REACHED).
        events: [...RANGE_MEMBERS.map(frozen), ...pages],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(served),
        declaredRequestedMemberIds: RANGE_MEMBERS,
        authorization: auth(served, 'user-confirm:c25'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:40:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // The CoverageTarget binds exactly the requested pages 1-3.
      expect(result.accounting?.coverageTarget.scopeKind).toBe('collection_page_range');
      expect(result.accounting?.coverageTarget.scopeIdentityKey).toContain('1..3');
      expect(result.requestedMemberIds).toEqual(RANGE_MEMBERS);

      // VERIFIED_COMPLETE for the REQUEST — with no parent-collection claim:
      // the ten-page parent is not implied anywhere in the composed result.
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('COMPLETE');
      expect(terminal?.coverage).toBe('VERIFIED_COMPLETE');
      expect(terminal?.stopReason).toBe('USER_SCOPE_REACHED');
      expect(result.accounting?.parentCollectionCoverage).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('parent');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('executes the frozen-target HLS acquisition after discovery exhaustion through Core budget ports (C28)', async () => {
    const served = await startFixture(PAGE_MEMBERS);
    const contract = playlistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 2 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const snapshot = snapshotFor(contract, PAGE_MEMBERS.slice(0, 1));

    const rootDir = makeTempDir('t016-c28');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // The frozen target's HLS media playlist with two segments.
      const targetId = unwrapOrThrow(makeLogicalTargetId(PAGE_MEMBERS[0]!));
      const masterText = [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video",RESOLUTION=1280x720',
        'media-720p.m3u8',
        '',
      ].join('\n');
      const decodedMaster = decodeMasterPlaylist(
        masterText,
        'https://fixture.invalid/vod/master.m3u8',
      );
      expect(decodedMaster.ok).toBe(true);
      const mediaText = [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-TARGETDURATION:4',
        '#EXTINF:4,seg-0',
        'seg-0.ts',
        '#EXTINF:3.5,seg-1',
        'seg-1.ts',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n');
      const decodedMedia = decodeMediaPlaylist(
        mediaText,
        'https://fixture.invalid/vod/media-720p.m3u8',
      );
      expect(decodedMedia.ok).toBe(true);
      if (!decodedMaster.ok || !decodedMedia.ok) throw new Error('unreachable');
      const manifestLocator = unwrapOrThrow(
        bindLocator({ kind: 'direct', uri: 'https://fixture.invalid/vod/master.m3u8' }, targetId, {
          binding: 'SELECTED_RESOURCE_PROVENANCE',
          originLocatorUri: 'https://fixture.invalid/vod/master.m3u8',
        }),
      );
      const rendition = unwrapOrThrow(
        bindRenditionToTarget({
          logicalTargetId: targetId,
          manifestLocator,
          master: decodedMaster.value,
          selectedVariant: decodedMaster.value.variants[0]!,
        }),
      );
      const mediaPlaylistLocator = unwrapOrThrow(
        bindLocator(
          { kind: 'direct', uri: 'https://fixture.invalid/vod/media-720p.m3u8' },
          targetId,
          {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: 'https://fixture.invalid/vod/master.m3u8',
          },
        ),
      );

      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S6',
        contract,
        snapshot,
        events: [
          frozen(PAGE_MEMBERS[0]!),
          // Discovery budget dies before the next continuation member.
          continuation(PAGE_MEMBERS[1]!),
        ],
        budgetSteps: [budgetsOpen, budgetsDiscoveryExhausted],
        deliveryFor: (memberId) => {
          expect(memberId).toBe(PAGE_MEMBERS[0]!);
          return {
            kind: 'hls',
            targetId: memberId,
            artifactId: `artifact:${memberId}`,
            binding: rendition,
            master: decodedMaster.value,
            mediaPlaylist: decodedMedia.value,
            mediaPlaylistLocator,
            fetcher: {
              fetcherId: 't016-fixture-fetcher/1',
              fetch: ((entry: { position: number; durationSeconds: number }) => ({
                ok: true as const,
                bytes: createSyntheticSegmentBytes({ durationSeconds: entry.durationSeconds }),
                entry,
              })) as never,
            },
            assemblyPort: createSyntheticMediaAssemblyPort(),
            recordedAt: '2026-10-04T07:50:00.000Z',
          };
        },
        declaredRequestedMemberIds: PAGE_MEMBERS,
        authorization: auth(served, 'user-confirm:c28'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T07:50:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // The discovery stop stays truthful.
      expect(result.session.stop?.kind).toBe('DISCOVERY_BUDGET_EXHAUSTED');
      expect(result.enumeration).toEqual({ kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' });

      // The frozen-target HLS acquisition still executed through the canonical
      // Core budget ports (Transfer/GlobalSafety remained).
      const acquired = result.memberOutcomes[0];
      expect(acquired?.kind).toBe('ACQUIRED');
      expect(acquired?.accepted).toBe(true);
      if (acquired?.flow && 'pipeline' in acquired.flow) {
        expect(acquired.flow.pipeline?.kind).toBe('COMPLETED');
        expect(acquired.flow.pipeline?.chain?.accepted).toBe(true);
      } else {
        throw new Error('expected an HLS pipeline outcome');
      }
      const budgetKinds = runtime.scheduler
        .log()
        .readAll()
        .map((fact) => fact.kind);
      expect(budgetKinds.filter((kind) => kind === 'budgetConsumed').length).toBeGreaterThan(0);

      // The composed truth: PARTIAL request over the declared membership with
      // a TRUNCATED enumeration — never a synthesized complete.
      expect(result.terminalResult?.requestFulfillment).toBe('PARTIAL');
      expect(result.terminalResult?.coverage).toBe('TRUNCATED');
      expect(result.terminalResult?.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('projects only canonical multidimensional terminal shapes (negative: no glue-local vocabulary)', async () => {
    const served = await startFixture(PAGE_MEMBERS);
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, PAGE_MEMBERS);

    const rootDir = makeTempDir('t016-canonical-shape');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events: PAGE_MEMBERS.map(frozen),
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(served),
        authorization: auth(served, 'user-confirm:shape'),
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T08:00:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // The terminal result is the T007 canonical shape and nothing else:
      // every dimension of the frozen multidimensional vocabulary is present
      // and no glue-local status/success field exists.
      const terminal = outcome.result.terminalResult;
      expect(Object.keys(terminal ?? {}).sort()).toEqual(
        [
          'contractId',
          'coverage',
          'recordedAt',
          'requestFulfillment',
          'schemaIdentity',
          'selectionAcquisition',
          'snapshotId',
          'stopReason',
          'targetResolution',
          'validationSummary',
        ].sort(),
      );
      expect(outcome.result.coreProjection?.ok).toBe(true);
    } finally {
      closeRuntime(runtime);
    }
  });
});
