/**
 * #154 installed S6 collection execution driver — real closed loop over a
 * real CoreRuntime + controlled local HTTP: the frozen declared-range page
 * records feed the trusted collection flow, Core acquires every confirmed
 * member itself, per-member outcome records + the aggregate COLLECTION
 * terminal land through recordExecutedTerminal, a partially walked declared
 * range stays truthfully incomplete (never COMPLETE), and re-drive converges
 * (reconcile-first).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  S6ConfirmedCollectionRecord,
  S6PageRecord,
  S6PreparedCollectionRecord,
} from '@xdownload/core-seam';
import {
  s6CollectionTupleDigest,
  s6PageTupleDigest,
  s6SelectionTupleDigest,
} from '@xdownload/core-seam';
import { decodeAcquisitionContract, decodeSelectionSnapshot } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
  seamCommand,
} from '../../core-runtime/test/helpers.ts';
import { driveS6CollectionExecution } from '../src/s6-installed-execution.ts';
import { pageRangeContract, payload, snapshotFor } from './fixtures.ts';

const MEMBER_IDS = ['pl-member-001', 'pl-member-002', 'pl-member-003'] as const;
const AGGREGATE = 'contract-s6-driver-001';
const SNAPSHOT = 'snapshot-s6-driver-001';
const PREPARE_ID = `s6prepare:${AGGREGATE}:${SNAPSHOT}`;
const PROVENANCE_KEY = 'tab-9/frame-0/http://127.0.0.1:9/playlist/-/-';
const fixtures: ControlledHttpFixture[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.stop();
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

interface DriverWorld {
  readonly fixture: ControlledHttpFixture;
  readonly origin: string;
  readonly prepared: S6PreparedCollectionRecord;
  readonly pages: S6PageRecord[];
  readonly confirmed: S6ConfirmedCollectionRecord;
}

async function driverWorld(
  options: { readonly walkedPages?: 1 | 2; readonly failingMember?: boolean } = {},
): Promise<DriverWorld & { runtime: ReturnType<typeof openRuntime> }> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const origin = await fixture.start();
  const walked = options.walkedPages ?? 2;
  const pageMembers: string[][] =
    walked === 2 ? [MEMBER_IDS.slice(0, 2), MEMBER_IDS.slice(2, 3)] : [MEMBER_IDS.slice(0, 2)];
  const walkedIds = new Set(pageMembers.flat());
  for (const memberId of MEMBER_IDS) {
    if (options.failingMember === true && memberId === MEMBER_IDS[MEMBER_IDS.length - 1]) {
      // An unregistered path serves 404 — a truthful per-member failure.
      continue;
    }
    if (walkedIds.has(memberId)) {
      fixture.serveFile(`/${memberId}.bin`, {
        body: payload(256, memberId.length + 3),
        etag: `s6-installed-${memberId}`,
      });
    }
  }
  const base = pageRangeContract(1, 2, {
    contractId: AGGREGATE,
    collectionIdentity: 'playlist/s6-driver-001',
    requestedScope: {
      kind: 'collection_page_range',
      collectionIdentity: 'playlist/s6-driver-001',
      fromPage: 1,
      toPage: 2,
    },
    authorizationContextRef: 'authctx/installed-s6-lane',
  });
  const selected = pageMembers.flat();
  const snapshotRaw = snapshotFor(base, selected);
  const contract = decodeAcquisitionContract({
    ...JSON.parse(JSON.stringify(base)),
    selectionSnapshotRef: SNAPSHOT,
    confirmedAt: '2026-10-27T00:00:00Z',
  });
  if (!contract.ok) throw new Error('contract decode failed');
  const snapshot = decodeSelectionSnapshot({
    ...JSON.parse(JSON.stringify(snapshotRaw)),
    snapshotId: SNAPSHOT,
  });
  if (!snapshot.ok) throw new Error('snapshot decode failed');
  const pages: S6PageRecord[] = pageMembers.map((memberIds, index) => ({
    pageNumber: index + 1,
    members: Object.freeze(
      memberIds.map((memberId) => ({
        memberId,
        href: `${origin}/${memberId}.bin`,
        text: memberId,
      })),
    ),
    observedTupleDigest: s6PageTupleDigest({
      pageNumber: index + 1,
      hrefs: memberIds.map((memberId) => `${origin}/${memberId}.bin`),
    }),
    recordedAt: '2026-10-27T00:00:00Z',
  }));
  const prepared: S6PreparedCollectionRecord = {
    prepareId: PREPARE_ID,
    snapshotId: SNAPSHOT,
    collectionOrigin: origin,
    provenanceKey: PROVENANCE_KEY,
    collectionIdentity: 'playlist/s6-driver-001',
    fromPage: 1,
    toPage: 2,
    observedTupleDigest: s6CollectionTupleDigest({
      collectionOrigin: origin,
      provenanceKey: PROVENANCE_KEY,
      collectionIdentity: 'playlist/s6-driver-001',
      fromPage: 1,
      toPage: 2,
    }),
    status: 'AVAILABLE',
    preparedAt: '2026-10-27T00:00:00Z',
  };
  const confirmed: S6ConfirmedCollectionRecord = {
    confirmedGroupId: `s6group:${AGGREGATE}:${SNAPSHOT}`,
    prepareId: PREPARE_ID,
    snapshotId: SNAPSHOT,
    selectedMemberIds: Object.freeze(selected),
    displayedTupleDigest: s6SelectionTupleDigest({
      contractId: AGGREGATE,
      snapshotId: SNAPSHOT,
      prepareId: PREPARE_ID,
      selectedMemberIds: selected,
    }),
    contract: contract.value,
    snapshot: snapshot.value,
    confirmedAt: '2026-10-27T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const root = makeTempDir('s6-installed-execution');
  dirs.push(root);
  const runtime = openRuntime(root);
  // The production flow registers the aggregate through SUBMIT_CONTRACT
  // before any S6 command; mirror that so the lineage exists for the
  // driver's outcome/terminal recording.
  const submitted = seamCommand(runtime, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: AGGREGATE,
    payload: JSON.parse(JSON.stringify(contract.value)) as Record<string, unknown>,
    asPeer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
  });
  if (submitted.outcome !== 'ACCEPTED') {
    closeRuntime(runtime);
    throw new Error(`aggregate submit failed: ${JSON.stringify(submitted.diagnostics)}`);
  }
  // The production CONFIRM_S6_COLLECTION binds the Core-constructed confirmed
  // snapshot on the lineage; mirror that binding through the generic
  // CONFIRM_SNAPSHOT command (the same durable state the coverage accounting
  // gate reads).
  const snapshotted = seamCommand(runtime, {
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: AGGREGATE,
    expectedRevision: 1,
    payload: JSON.parse(JSON.stringify(snapshot.value)) as Record<string, unknown>,
    asPeer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
  });
  if (snapshotted.outcome !== 'ACCEPTED') {
    closeRuntime(runtime);
    throw new Error(`snapshot binding failed: ${JSON.stringify(snapshotted.diagnostics)}`);
  }
  return { fixture, origin, prepared, pages, confirmed, runtime };
}

describe('#154 S6 collection execution driver (real CoreRuntime + real HTTP)', () => {
  it('downloads every confirmed member through Core and records per-member + aggregate terminals', async () => {
    const world = await driverWorld();
    try {
      const result = await driveS6CollectionExecution(world.runtime, {
        aggregateId: AGGREGATE,
        requestId: 'req-exec-001',
        confirmed: world.confirmed,
        prepared: world.prepared,
        pages: world.pages,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const view = world.runtime.seam.inspectProjection(AGGREGATE) as unknown as Record<
        string,
        unknown
      >;
      const members = view['s6Members'] as readonly Record<string, unknown>[];
      expect(members).toHaveLength(3);
      expect(members.every((member) => member['accepted'] === true)).toBe(true);
      const terminal = view['terminal'] as Record<string, unknown>;
      // The declared 1..2 range was fully walked: the USER_SCOPE_REACHED stop
      // closes the requested scope — a truthful COMPLETE over the confirmed set.
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect(terminal['coverage']).toBe('VERIFIED_COMPLETE');
      expect(world.runtime.writer.reader.workItems()).toHaveLength(3);
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('keeps a partially walked declared range truthfully incomplete — never COMPLETE', async () => {
    const world = await driverWorld({ walkedPages: 1 });
    try {
      const result = await driveS6CollectionExecution(world.runtime, {
        aggregateId: AGGREGATE,
        requestId: 'req-exec-partial',
        confirmed: world.confirmed,
        prepared: world.prepared,
        pages: world.pages.slice(0, 1),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const view = world.runtime.seam.inspectProjection(AGGREGATE) as unknown as Record<
        string,
        unknown
      >;
      const members = view['s6Members'] as readonly Record<string, unknown>[];
      expect(members).toHaveLength(2);
      expect(members.every((member) => member['accepted'] === true)).toBe(true);
      const terminal = view['terminal'] as Record<string, unknown>;
      // Page 2 of the declared 1..2 range was never walked: the session never
      // closed, so coverage can never claim VERIFIED_COMPLETE — walk/budget
      // exhaustion is never a verified-complete collection. (The confirmed
      // selection itself was fully delivered — requestFulfillment reflects
      // the confirmed-set delivery, while the COVERAGE axis stays honest.)
      expect(terminal['coverage']).not.toBe('VERIFIED_COMPLETE');
      expect(terminal['coverage']).not.toBe('COMPLETE');
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('records a truthful partial terminal when one member cannot be acquired', async () => {
    const world = await driverWorld({ failingMember: true });
    try {
      const result = await driveS6CollectionExecution(world.runtime, {
        aggregateId: AGGREGATE,
        requestId: 'req-exec-404',
        confirmed: world.confirmed,
        prepared: world.prepared,
        pages: world.pages,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const view = world.runtime.seam.inspectProjection(AGGREGATE) as unknown as Record<
        string,
        unknown
      >;
      const members = view['s6Members'] as readonly Record<string, unknown>[];
      expect(members).toHaveLength(3);
      const failed = members.filter((member) => member['accepted'] !== true);
      expect(failed).toHaveLength(1);
      const terminal = view['terminal'] as Record<string, unknown>;
      // Per-member failure surfaces in the aggregate terminal truthfully —
      // never COMPLETE over a failed member, never a masked success.
      expect(terminal['requestFulfillment']).toBe('PARTIAL');
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('converges on re-drive without re-downloading (reconcile discipline)', async () => {
    const world = await driverWorld();
    try {
      const first = await driveS6CollectionExecution(world.runtime, {
        aggregateId: AGGREGATE,
        requestId: 'req-exec-reconcile',
        confirmed: world.confirmed,
        prepared: world.prepared,
        pages: world.pages,
      });
      expect(first.ok).toBe(true);
      const before = world.fixture.requests.length;
      const again = await driveS6CollectionExecution(world.runtime, {
        aggregateId: AGGREGATE,
        requestId: 'req-exec-reconcile',
        confirmed: world.confirmed,
        prepared: world.prepared,
        pages: world.pages,
      });
      expect(again.ok).toBe(true);
      expect(world.fixture.requests.length).toBe(before);
    } finally {
      closeRuntime(world.runtime);
    }
  });
});
