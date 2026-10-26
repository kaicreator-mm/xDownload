/**
 * #154 S6 explicit-collection seam authority — the installed 1.2 private
 * handlers behind the OS-verified session gate: journal-frozen collection
 * admission over the submitted collection_page_range contract, the sequential
 * declared-range page walk (durable admit BEFORE the browser navigates,
 * frozen page records with Core-minted member identities), single-use
 * connection-bound private selection challenges (BEGIN/COMMIT), Core-
 * constructed CONFIRMED contract + BATCH snapshot over the chosen subset,
 * single durable execution intent per lineage, plus the required fail-closed
 * negatives (unverified transport, wrong surface, legacy composition, scope
 * mismatch, out-of-range/skipped/unadmitted page, forged membership,
 * mismatched challenge, duplicate execution, restart replay rebuild).
 * The declared range is the ONLY navigation bound: no command here can widen
 * it, and budget exhaustion can never create a natural-end assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  s6CollectionTupleDigest,
  s6SelectionTupleDigest,
  type CommandEnvelope,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type SeamJournal,
  type SeamResponse,
  type S6CollectionBeginner,
  type VerifiedPeerSessionPort,
} from '../src/index.ts';
import { peer, rawCommand } from './helpers.ts';

const CONNECTION = 'conn-s6-001';
const OTHER_CONNECTION = 'conn-s6-other';
const AGGREGATE = 'contract-s6-wired-001';
const SNAPSHOT = 'snapshot-s6-wired-001';
const PREPARE_ID = `s6prepare:${AGGREGATE}:${SNAPSHOT}`;
const COLLECTION_ORIGIN = 'http://127.0.0.1:8100';
const COLLECTION_IDENTITY = 'playlist/canary-s6';
const FROM_PAGE = 1;
const TO_PAGE = 2;

interface Clock {
  now: number;
}

function verifiedSession(connectionId: string): OsVerifiedPeerSession {
  return {
    transportKind: 'WINDOWS_NAMED_PIPE',
    connectionId,
    userSid: 'S-1-5-21-1',
    userName: 'DOMAIN\\user',
    clientPid: 4242,
    logonSessionId: '0x0000000001234567',
    sameUserAsCore: true,
    sameLogonSessionAsCore: true,
    verifiedAt: '2026-10-27T00:00:00Z',
  };
}

function frame(
  server: CoreSeamServer,
  sessions: VerifiedPeerSessionPort,
  raw: Record<string, unknown>,
  connectionId = CONNECTION,
): SeamResponse {
  return server.handleFrame(JSON.stringify(raw), sessions, connectionId);
}

function s6Command(input: {
  readonly commandType: string;
  readonly payload: unknown;
  readonly expectedRevision?: number;
  readonly requestId?: string;
  readonly surface?: 'CLI' | 'DESKTOP_UI' | 'BROWSER_EXTENSION';
  readonly aggregateId?: string;
  readonly connectionId?: string;
  readonly correlation?: Record<string, string>;
}): Record<string, unknown> {
  return rawCommand({
    commandType: input.commandType as CommandEnvelope['commandType'],
    aggregateId: input.aggregateId ?? AGGREGATE,
    payload: input.payload,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    asPeer: peer(input.surface ?? 'BROWSER_EXTENSION'),
    ...(input.correlation === undefined ? {} : { correlation: input.correlation }),
  });
}

function draftPageRangeContract(): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId: AGGREGATE,
    status: 'DRAFT',
    intentType: 'COLLECTION',
    requestedTarget: 'target-s6-wired-001',
    collectionIdentity: COLLECTION_IDENTITY,
    membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/playlist-v1' },
    requestedScope: {
      kind: 'collection_page_range',
      collectionIdentity: COLLECTION_IDENTITY,
      fromPage: FROM_PAGE,
      toPage: TO_PAGE,
    },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
    automationMode: 'ASSISTED',
    explorationPermission: 'COLLECTION_MEMBER_EDGES',
    budgetProfile: {
      discovery: {
        domain: 'discovery',
        maxGeneratedRequests: 20,
        maxNavigationActions: 20,
        maxModelCalls: 1,
      },
      transfer: {
        domain: 'transfer',
        maxBytes: 1_000_000,
        maxSegments: 40,
        maxActiveTransferMs: 600_000,
        maxRetryTransferRequests: 2,
      },
      globalSafety: {
        domain: 'global_safety',
        maxTotalGeneratedRequests: 40,
        maxActiveElapsedMs: 600_000,
      },
    },
    authorizationContextRef: 'authctx/installed-s6-lane',
    validationPolicy: {
      requiredLayers: ['membership', 'target', 'transfer', 'coverage'],
    },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
  };
}

function preparePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    collectionOrigin: COLLECTION_ORIGIN,
    provenanceKey: `tab-7/frame-0/${COLLECTION_ORIGIN}/playlist/-/-`,
    collectionIdentity: COLLECTION_IDENTITY,
    fromPage: FROM_PAGE,
    toPage: TO_PAGE,
    ...overrides,
  };
}

function recordPagePayload(
  pageNumber: number,
  hrefs: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    prepareId: PREPARE_ID,
    pageNumber,
    members: hrefs.map((href, index) => ({ href, text: `file ${String(index)}` })),
    ...overrides,
  };
}

function beginnerCalls(): { calls: unknown[]; beginner: S6CollectionBeginner } {
  const calls: unknown[] = [];
  return {
    calls,
    beginner: {
      begin: (input) => {
        calls.push(input);
      },
    },
  };
}

interface S6World {
  readonly server: CoreSeamServer;
  readonly journal: SeamJournal;
  readonly registry: VerifiedPeerSessionPort;
  readonly clock: Clock;
}

function world(options: { readonly beginner?: S6CollectionBeginner | null } = {}): S6World {
  const journal = createInMemorySeamJournal();
  const registry = createVerifiedPeerSessionRegistry();
  registry.record(verifiedSession(CONNECTION));
  registry.record(verifiedSession(OTHER_CONNECTION));
  const clock: Clock = { now: Date.parse('2026-10-27T00:00:00Z') };
  const drive =
    options.beginner === null ? undefined : (options.beginner ?? { begin: () => undefined });
  const server = createCoreSeamServer({
    expectedPeer: {
      installId: 'install-001',
      userId: 'user-001',
      allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
    },
    journal,
    s6Challenge: { ttlMs: 120_000, now: () => clock.now },
    s6Collection: drive,
  });
  if (!server.ok) {
    throw new Error(`server construction failed: ${JSON.stringify(server.diagnostics)}`);
  }
  return { server: server.value, journal, registry, clock };
}

async function submitDraft(w: S6World): Promise<void> {
  const submitted = frame(
    w.server,
    w.registry,
    s6Command({ commandType: 'SUBMIT_CONTRACT', payload: draftPageRangeContract() }),
  );
  if (submitted.outcome !== 'ACCEPTED') {
    throw new Error(`draft submit failed: ${JSON.stringify(submitted.diagnostics)}`);
  }
}

async function prepare(w: S6World, payload = preparePayload()): Promise<SeamResponse> {
  return frame(
    w.server,
    w.registry,
    s6Command({
      commandType: 'PREPARE_S6_COLLECTION',
      payload,
      expectedRevision: 1,
      correlation: { snapshotId: SNAPSHOT },
    }),
  );
}

function currentRevision(w: S6World): number {
  return w.server.inspectProjection(AGGREGATE)?.contract.revision ?? 0;
}

async function recordPage(
  w: S6World,
  pageNumber: number,
  hrefs: readonly string[],
  options: { readonly skipAdmit?: boolean } = {},
): Promise<SeamResponse> {
  if (!options.skipAdmit && pageNumber !== FROM_PAGE) {
    const admitted = frame(
      w.server,
      w.registry,
      s6Command({
        commandType: 'ADMIT_S6_COLLECTION_PAGE',
        payload: { snapshotId: SNAPSHOT, prepareId: PREPARE_ID, pageNumber },
        expectedRevision: currentRevision(w),
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    if (admitted.outcome !== 'ACCEPTED') {
      return admitted;
    }
  }
  return frame(
    w.server,
    w.registry,
    s6Command({
      commandType: 'RECORD_S6_COLLECTION_PAGE',
      payload: recordPagePayload(pageNumber, hrefs),
      expectedRevision: currentRevision(w),
      correlation: { snapshotId: SNAPSHOT },
    }),
  );
}

function projectionOf(w: S6World, key: string): Record<string, unknown> | undefined {
  const view = w.server.inspectProjection(AGGREGATE) as unknown as
    Record<string, unknown> | undefined;
  return view?.[key] as Record<string, unknown> | undefined;
}

function frozenMemberIds(w: S6World): readonly string[] {
  const pages =
    (projectionOf(w, 's6Pages') as
      { readonly members?: readonly { readonly memberId: string }[] }[] | undefined) ?? [];
  return pages.flatMap((page) => (page.members ?? []).map((member) => member.memberId));
}

async function walkTwoPages(w: S6World): Promise<void> {
  await submitDraft(w);
  const prepared = await prepare(w);
  expect(prepared.outcome).toBe('ACCEPTED');
  const page1 = await recordPage(w, 1, [
    `${COLLECTION_ORIGIN}/p1-file-1.bin`,
    `${COLLECTION_ORIGIN}/p1-file-2.bin`,
  ]);
  expect(page1.outcome).toBe('ACCEPTED');
  const page2 = await recordPage(w, 2, [`${COLLECTION_ORIGIN}/p2-file-1.bin`]);
  expect(page2.outcome).toBe('ACCEPTED');
}

async function confirmSelection(
  w: S6World,
  selected: readonly string[],
  options: {
    readonly connectionId?: string;
    readonly revision?: number;
    readonly digest?: string;
    readonly challenge?: string;
    readonly phase?: 'BEGIN' | 'COMMIT';
  } = {},
): Promise<SeamResponse> {
  const digest =
    options.digest ??
    s6SelectionTupleDigest({
      contractId: AGGREGATE,
      snapshotId: SNAPSHOT,
      prepareId: PREPARE_ID,
      selectedMemberIds: selected,
    });
  const phase = options.phase ?? 'BEGIN';
  return frame(
    w.server,
    w.registry,
    s6Command({
      commandType: 'CONFIRM_S6_COLLECTION',
      payload: {
        phase,
        snapshotId: SNAPSHOT,
        prepareId: PREPARE_ID,
        selectedMemberIds: [...selected],
        displayedTupleDigest: digest,
        ...(phase === 'COMMIT' ? { confirmationChallenge: options.challenge ?? '' } : {}),
      },
      expectedRevision: options.revision ?? 5,
      correlation: { snapshotId: SNAPSHOT },
    }),
    options.connectionId ?? CONNECTION,
  );
}

describe('#154 S6 explicit-collection seam authority', () => {
  it('freezes the admission over the matching page-range contract and mints page member identities', async () => {
    const w = world();
    await walkTwoPages(w);
    const prepared = projectionOf(w, 's6PreparedCollection');
    expect(prepared?.['prepareId']).toBe(PREPARE_ID);
    expect(prepared?.['fromPage']).toBe(FROM_PAGE);
    expect(prepared?.['toPage']).toBe(TO_PAGE);
    expect(prepared?.['observedTupleDigest']).toBe(
      s6CollectionTupleDigest({
        collectionOrigin: COLLECTION_ORIGIN,
        provenanceKey: `tab-7/frame-0/${COLLECTION_ORIGIN}/playlist/-/-`,
        collectionIdentity: COLLECTION_IDENTITY,
        fromPage: FROM_PAGE,
        toPage: TO_PAGE,
      }),
    );
    const pages = projectionOf(w, 's6Pages') as
      readonly { pageNumber: number; members: readonly { memberId: string }[] }[] | undefined;
    expect(pages?.length).toBe(2);
    expect(frozenMemberIds(w).length).toBe(3);
  });

  it('rejects a prepare tuple that does not match the submitted contract scope', async () => {
    const w = world();
    await submitDraft(w);
    const rejected = await prepare(w, preparePayload({ toPage: 5 }));
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects a page outside the declared frozen range — the walk never widens', async () => {
    const w = world();
    await submitDraft(w);
    expect((await prepare(w)).outcome).toBe('ACCEPTED');
    const rejected = await recordPage(w, TO_PAGE + 1, [`${COLLECTION_ORIGIN}/p3-file-1.bin`], {
      skipAdmit: true,
    });
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.diagnostics?.[0]?.path).toBe('payload.pageNumber');
  });

  it('rejects a skipped page — the declared walk is sequential', async () => {
    const w = world();
    await submitDraft(w);
    expect((await prepare(w)).outcome).toBe('ACCEPTED');
    const admitted = frame(
      w.server,
      w.registry,
      s6Command({
        commandType: 'ADMIT_S6_COLLECTION_PAGE',
        payload: { snapshotId: SNAPSHOT, prepareId: PREPARE_ID, pageNumber: TO_PAGE },
        expectedRevision: 2,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(admitted.outcome).toBe('REJECTED');
    expect(admitted.diagnostics?.[0]?.path).toBe('payload.pageNumber');
  });

  it('rejects recording a later page without its durably admitted navigation intent', async () => {
    const w = world();
    await submitDraft(w);
    expect((await prepare(w)).outcome).toBe('ACCEPTED');
    expect(
      (
        await recordPage(w, FROM_PAGE, [
          `${COLLECTION_ORIGIN}/p1-file-1.bin`,
          `${COLLECTION_ORIGIN}/p1-file-2.bin`,
        ])
      ).outcome,
    ).toBe('ACCEPTED');
    const rejected = await recordPage(w, TO_PAGE, [`${COLLECTION_ORIGIN}/p2-file-1.bin`], {
      skipAdmit: true,
    });
    expect(rejected.outcome).toBe('REJECTED');
    expect(
      (rejected.diagnostics?.[0]?.message ?? '').includes('no durably admitted navigation intent'),
    ).toBe(true);
  });

  it('mints the single-use connection-bound challenge and consumes it atomically at COMMIT', async () => {
    const w = world();
    await walkTwoPages(w);
    const selected = frozenMemberIds(w).slice(0, 2);
    const begin = await confirmSelection(w, selected, { phase: 'BEGIN', revision: 5 });
    expect(begin.outcome).toBe('ACCEPTED');
    const challenge = begin.s6PrivateChallenge;
    expect(challenge?.confirmedGroupId).toBe(`s6group:${AGGREGATE}:${SNAPSHOT}`);
    // The challenge is connection-bound: another verified connection cannot
    // consume it.
    const crossConnection = await confirmSelection(w, selected, {
      phase: 'COMMIT',
      revision: 5,
      challenge: challenge?.value ?? '',
      connectionId: OTHER_CONNECTION,
    });
    expect(crossConnection.outcome).toBe('REJECTED');
    const committed = await confirmSelection(w, selected, {
      phase: 'COMMIT',
      revision: 5,
      challenge: challenge?.value ?? '',
    });
    expect(committed.outcome).toBe('ACCEPTED');
    const confirmed = projectionOf(w, 's6ConfirmedCollection');
    expect(confirmed?.['confirmedGroupId']).toBe(`s6group:${AGGREGATE}:${SNAPSHOT}`);
    // Single-use: a replayed COMMIT with the same challenge rejects.
    const replay = await confirmSelection(w, selected, {
      phase: 'COMMIT',
      revision: 6,
      challenge: challenge?.value ?? '',
    });
    expect(replay.outcome).toBe('REJECTED');
  });

  it('rejects a selection referencing a member outside the frozen page records', async () => {
    const w = world();
    await walkTwoPages(w);
    const forged = ['s6m-0000000000000000'];
    const begin = await confirmSelection(w, forged, { phase: 'BEGIN', revision: 5 });
    expect(begin.outcome).toBe('REJECTED');
    expect(begin.diagnostics?.[0]?.path).toBe('payload.selectedMemberIds');
  });

  it('rejects execution without the confirmed collection and refuses a second intent', async () => {
    const w = world();
    const { calls, beginner } = beginnerCalls();
    const world2 = world({ beginner });
    await walkTwoPages(world2);
    const early = frame(
      world2.server,
      world2.registry,
      s6Command({
        commandType: 'EXECUTE_S6_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s6group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 5,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(early.outcome).toBe('REJECTED');
    const selected = frozenMemberIds(world2);
    const begin = await confirmSelection(world2, selected, { phase: 'BEGIN', revision: 5 });
    expect(begin.outcome).toBe('ACCEPTED');
    const committed = await confirmSelection(world2, selected, {
      phase: 'COMMIT',
      revision: 5,
      challenge: begin.s6PrivateChallenge?.value ?? '',
    });
    expect(committed.outcome).toBe('ACCEPTED');
    const executed = frame(
      world2.server,
      world2.registry,
      s6Command({
        commandType: 'EXECUTE_S6_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s6group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 6,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(executed.outcome).toBe('ACCEPTED');
    expect(calls.length).toBe(1);
    const duplicate = frame(
      world2.server,
      world2.registry,
      s6Command({
        commandType: 'EXECUTE_S6_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s6group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 7,
        requestId: 's6-exec-dup-request',
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(duplicate.outcome).toBe('REJECTED');
    expect(calls.length).toBe(1);
    void w;
  });

  it('fails closed on a CLI surface and on an unverified transport', async () => {
    const w = world();
    await submitDraft(w);
    const cli = frame(
      w.server,
      w.registry,
      s6Command({
        commandType: 'PREPARE_S6_COLLECTION',
        payload: preparePayload(),
        expectedRevision: 1,
        surface: 'CLI',
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(cli.outcome).toBe('REJECTED');
    expect(cli.diagnostics?.[0]?.path).toBe('peer.surface');
    const unverified = frame(
      w.server,
      w.registry,
      s6Command({
        commandType: 'PREPARE_S6_COLLECTION',
        payload: preparePayload(),
        expectedRevision: 1,
        correlation: { snapshotId: SNAPSHOT },
      }),
      'conn-unregistered',
    );
    expect(unverified.outcome).toBe('REJECTED');
    expect(unverified.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });

  it('keeps every S6 command failing closed in a legacy composition without the driver', async () => {
    const w = world({ beginner: null });
    await submitDraft(w);
    const rejected = await prepare(w);
    // The live-dispatch gate refuses before apply: a verified-session 1.2
    // command with no installed private handler fails closed (the apply-level
    // 'no S6 collection driver' check stays as the second layer).
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    expect(
      (rejected.diagnostics?.[0]?.message ?? '').includes(
        'no installed private Core command handler',
      ),
    ).toBe(true);
  });

  it('rebuilds the frozen/confirmed truth and the execution intent from journal replay', async () => {
    const { calls, beginner } = beginnerCalls();
    const w = world({ beginner });
    await walkTwoPages(w);
    const selected = frozenMemberIds(w);
    const begin = await confirmSelection(w, selected, { phase: 'BEGIN', revision: 5 });
    expect(begin.outcome).toBe('ACCEPTED');
    const committed = await confirmSelection(w, selected, {
      phase: 'COMMIT',
      revision: 5,
      challenge: begin.s6PrivateChallenge?.value ?? '',
    });
    expect(committed.outcome).toBe('ACCEPTED');
    const executed = frame(
      w.server,
      w.registry,
      s6Command({
        commandType: 'EXECUTE_S6_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s6group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 6,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(executed.outcome).toBe('ACCEPTED');
    // Restart: replay the journal into a fresh server (same composition) —
    // the raw challenge never reached the journal; the record shape re-applies.
    const replayJournal = w.journal;
    const registry2 = createVerifiedPeerSessionRegistry();
    registry2.record(verifiedSession(CONNECTION));
    const server2 = createCoreSeamServer({
      expectedPeer: {
        installId: 'install-001',
        userId: 'user-001',
        allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
      },
      journal: replayJournal,
      s6Collection: { begin: () => undefined },
    });
    if (!server2.ok) {
      throw new Error('replay server construction failed');
    }
    const view = server2.value.inspectProjection(AGGREGATE) as unknown as
      Record<string, unknown> | undefined;
    expect(
      (view?.['s6PreparedCollection'] as Record<string, unknown> | undefined)?.['prepareId'],
    ).toBe(PREPARE_ID);
    expect(((view?.['s6Pages'] as readonly unknown[] | undefined) ?? []).length).toBe(2);
    expect(
      (view?.['s6ConfirmedCollection'] as Record<string, unknown> | undefined)?.[
        'confirmedGroupId'
      ],
    ).toBe(`s6group:${AGGREGATE}:${SNAPSHOT}`);
    expect(
      JSON.stringify(view?.['s6ConfirmedCollection'] ?? {}).includes('confirmationChallenge'),
    ).toBe(false);
    expect(server2.value.pendingS6Executions().length).toBe(1);
    expect(calls.length).toBe(1);
  });
});
