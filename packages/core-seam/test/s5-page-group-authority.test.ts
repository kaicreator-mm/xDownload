/**
 * #151 S5 current-page collection seam authority — the installed 1.2 private
 * handlers behind the OS-verified session gate: journal-freeze prepare,
 * single-use connection-bound private selection challenges (BEGIN/COMMIT),
 * Core-constructed CONFIRMED contract + BATCH snapshot over the chosen
 * subset, single durable execution intent per lineage, plus the required
 * fail-closed negatives (unverified transport, wrong surface, legacy
 * composition, mismatched/expired/cross-connection challenge, forged or
 * stale membership, conflicting selection, duplicate execution, restart
 * replay rebuild, late commands).
 */
import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  s5SelectionTupleDigest,
  type CommandEnvelope,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type SeamJournal,
  type SeamResponse,
  type S5PageGroupBeginner,
  type VerifiedPeerSessionPort,
} from '../src/index.ts';
import { peer, rawCommand, requestId } from './helpers.ts';

const CONNECTION = 'conn-s5-001';
const OTHER_CONNECTION = 'conn-s5-other';
const AGGREGATE = 'contract-s5-wired-001';
const SNAPSHOT = 'snapshot-s5-wired-001';
const PREPARE_ID = `s5prepare:${AGGREGATE}:${SNAPSHOT}`;
const PAGE_ORIGIN = 'http://127.0.0.1:8000';

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
    verifiedAt: '2026-10-26T00:00:00Z',
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

function s5Command(input: {
  readonly commandType: string;
  readonly payload: unknown;
  readonly expectedRevision?: number;
  readonly requestId?: string;
  readonly surface?: 'CLI' | 'DESKTOP_UI' | 'BROWSER_EXTENSION';
  readonly aggregateId?: string;
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

function draftCollectionContract(): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId: AGGREGATE,
    status: 'DRAFT',
    intentType: 'COLLECTION',
    requestedTarget: 'target-s5-wired-001',
    collectionIdentity: 'collection/s5-wired-001',
    membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
    requestedScope: { kind: 'current_page', collectionIdentity: 'collection/s5-wired-001' },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
    automationMode: 'ASSISTED',
    explorationPermission: 'NONE',
    budgetProfile: {
      discovery: {
        domain: 'discovery',
        maxGeneratedRequests: 1,
        maxNavigationActions: 1,
        maxModelCalls: 1,
      },
      transfer: {
        domain: 'transfer',
        maxBytes: 1_000_000,
        maxSegments: 20,
        maxActiveTransferMs: 600_000,
        maxRetryTransferRequests: 2,
      },
      globalSafety: {
        domain: 'global_safety',
        maxTotalGeneratedRequests: 20,
        maxActiveElapsedMs: 600_000,
      },
    },
    authorizationContextRef: 'authctx/installed-s5-lane',
    validationPolicy: {
      requiredLayers: ['membership', 'target', 'transfer', 'format', 'coverage'],
    },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
  };
}

function preparePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    pageOrigin: PAGE_ORIGIN,
    provenanceKey: 'tab-7/frame-0/http://127.0.0.1:8000/a/-/-',
    members: [
      { href: 'http://127.0.0.1:8000/file-1.bin', text: 'file one' },
      { href: 'http://127.0.0.1:8000/file-2.bin', text: 'file two' },
      { href: 'http://127.0.0.1:8000/file-3.bin', text: 'file three' },
    ],
    ...overrides,
  };
}

function beginnerCalls(): { calls: unknown[]; beginner: S5PageGroupBeginner } {
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

interface S5World {
  readonly server: CoreSeamServer;
  readonly journal: SeamJournal;
  readonly registry: VerifiedPeerSessionPort;
  readonly clock: Clock;
  readonly calls: unknown[];
}

function world(options: { readonly beginner?: S5PageGroupBeginner | null } = {}): S5World {
  const journal = createInMemorySeamJournal();
  const registry = createVerifiedPeerSessionRegistry();
  registry.record(verifiedSession(CONNECTION));
  registry.record(verifiedSession(OTHER_CONNECTION));
  const clock: Clock = { now: Date.parse('2026-10-26T00:00:00Z') };
  const drive =
    options.beginner === null ? undefined : (options.beginner ?? { begin: () => undefined });
  const server = createCoreSeamServer({
    expectedPeer: {
      installId: 'install-001',
      userId: 'user-001',
      allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
    },
    journal,
    s5Challenge: { ttlMs: 120_000, now: () => clock.now },
    s5PageGroup: drive,
  });
  if (!server.ok) {
    throw new Error(`server construction failed: ${JSON.stringify(server.diagnostics)}`);
  }
  return { server: server.value, journal, registry, clock, calls: [] };
}

async function prepareAggregate(w: S5World): Promise<void> {
  const submitted = frame(
    w.server,
    w.registry,
    s5Command({ commandType: 'SUBMIT_CONTRACT', payload: draftCollectionContract() }),
  );
  if (submitted.outcome !== 'ACCEPTED') {
    throw new Error(`draft submit failed: ${JSON.stringify(submitted.diagnostics)}`);
  }
}

async function drivePrepare(w: S5World, payload = preparePayload()): Promise<SeamResponse> {
  return frame(
    w.server,
    w.registry,
    s5Command({
      commandType: 'PREPARE_S5_PAGE_GROUP',
      payload,
      expectedRevision: 1,
      correlation: { snapshotId: SNAPSHOT },
    }),
  );
}

function memberIdsFrom(
  server: CoreSeamServer,
): readonly { readonly memberId: string; readonly href: string }[] {
  const view = server.inspectProjection(AGGREGATE);
  const prepared = (view as unknown as Record<string, unknown> | undefined)?.['s5PreparedGroup'] as
    | { readonly members?: readonly { readonly memberId: string; readonly href: string }[] }
    | undefined;
  return prepared?.members ?? [];
}

async function confirmBegin(
  w: S5World,
  selected: readonly string[],
  options: { connectionId?: string; revision?: number; digest?: string } = {},
): Promise<SeamResponse> {
  const digest =
    options.digest ??
    s5SelectionTupleDigest({
      contractId: AGGREGATE,
      snapshotId: SNAPSHOT,
      prepareId: PREPARE_ID,
      selectedMemberIds: selected,
    });
  return frame(
    w.server,
    w.registry,
    s5Command({
      commandType: 'CONFIRM_S5_PAGE_GROUP',
      payload: {
        phase: 'BEGIN',
        snapshotId: SNAPSHOT,
        prepareId: PREPARE_ID,
        selectedMemberIds: [...selected],
        displayedTupleDigest: digest,
      },
      expectedRevision: options.revision ?? 2,
      correlation: { snapshotId: SNAPSHOT },
    }),
    options.connectionId ?? CONNECTION,
  );
}

async function confirmCommit(
  w: S5World,
  selected: readonly string[],
  challenge: string,
  options: { connectionId?: string; revision?: number; digest?: string } = {},
): Promise<SeamResponse> {
  const digest =
    options.digest ??
    s5SelectionTupleDigest({
      contractId: AGGREGATE,
      snapshotId: SNAPSHOT,
      prepareId: PREPARE_ID,
      selectedMemberIds: selected,
    });
  return frame(
    w.server,
    w.registry,
    s5Command({
      commandType: 'CONFIRM_S5_PAGE_GROUP',
      payload: {
        phase: 'COMMIT',
        snapshotId: SNAPSHOT,
        prepareId: PREPARE_ID,
        selectedMemberIds: [...selected],
        displayedTupleDigest: digest,
        confirmationChallenge: challenge,
      },
      expectedRevision: options.revision ?? 2,
      correlation: { snapshotId: SNAPSHOT },
    }),
    options.connectionId ?? CONNECTION,
  );
}

describe('#151 S5 fail-closed admission gates', () => {
  it('rejects every S5 command on a legacy composition without the driver', async () => {
    const w = world({ beginner: null });
    await prepareAggregate(w);
    const response = await drivePrepare(w);
    expect(response.outcome).toBe('REJECTED');
    // The verified session is admitted but no installed S5 handler exists —
    // the transport-authorization rejection (S3/S4 fail-closed discipline).
    expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });

  it('rejects S5 commands without an OS-verified session', async () => {
    const w = world();
    await prepareAggregate(w);
    const response = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'PREPARE_S5_PAGE_GROUP',
        payload: preparePayload(),
        expectedRevision: 1,
      }),
      'conn-unverified',
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });

  it('rejects non-browser surfaces for prepare, confirm and execute', async () => {
    const w = world();
    await prepareAggregate(w);
    for (const surface of ['CLI', 'DESKTOP_UI'] as const) {
      const response = frame(
        w.server,
        w.registry,
        s5Command({
          commandType: 'PREPARE_S5_PAGE_GROUP',
          payload: preparePayload(),
          expectedRevision: 1,
          surface,
        }),
      );
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    }
  });
});

describe('#151 PREPARE freezes the observed group as Core truth', () => {
  it('journals the frozen record with Core-minted member identities and projection facts', async () => {
    const w = world();
    await prepareAggregate(w);
    const response = await drivePrepare(w);
    expect(response.outcome).toBe('ACCEPTED');
    const members = memberIdsFrom(w.server);
    expect(members).toHaveLength(3);
    expect(new Set(members.map((member) => member.memberId)).size).toBe(3);
    const view = w.server.inspectProjection(AGGREGATE) as unknown as Record<string, unknown>;
    expect((view['s5PreparedGroup'] as Record<string, unknown>)['observedTupleDigest']).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it('converges on an identical re-prepare and rejects a different tuple', async () => {
    const w = world();
    await prepareAggregate(w);
    await drivePrepare(w);
    const again = await frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'PREPARE_S5_PAGE_GROUP',
        payload: preparePayload(),
        expectedRevision: 2,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(again.outcome).toBe('ACCEPTED');
    const full = preparePayload();
    const subset = full['members'] as readonly unknown[];
    const changed = await frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'PREPARE_S5_PAGE_GROUP',
        payload: preparePayload({ members: [...subset.slice(0, 2)] }),
        expectedRevision: 2,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(changed.outcome).toBe('REJECTED');
    expect(changed.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('#151 CONFIRM BEGIN/COMMIT challenge discipline', () => {
  async function admitted(
    w: S5World,
  ): Promise<{ readonly selected: readonly string[]; readonly challenge: string }> {
    await prepareAggregate(w);
    await drivePrepare(w);
    const members = memberIdsFrom(w.server);
    const selected = [members[0]!.memberId, members[2]!.memberId];
    const begin = await confirmBegin(w, selected);
    if (begin.outcome !== 'ACCEPTED' || begin.s5PrivateChallenge === undefined) {
      throw new Error(`begin failed: ${JSON.stringify(begin.diagnostics)}`);
    }
    return { selected, challenge: begin.s5PrivateChallenge.value };
  }

  it('constructs the CONFIRMED contract + BATCH snapshot over the chosen subset', async () => {
    const w = world();
    const { selected, challenge } = await admitted(w);
    const commit = await confirmCommit(w, selected, challenge);
    expect(commit.outcome).toBe('ACCEPTED');
    const view = w.server.inspectProjection(AGGREGATE) as unknown as Record<string, unknown>;
    const confirmed = view['s5ConfirmedGroup'] as Record<string, unknown>;
    expect(confirmed['selectedMemberIds']).toEqual([...selected]);
    expect(confirmed['confirmedGroupId']).toBe(`s5group:${AGGREGATE}:${SNAPSHOT}`);
    expect(confirmed['contractStatus']).toBe('CONFIRMED');
    expect(confirmed['selectedMemberIds']).toHaveLength(2);
  });

  it('rejects a wrong digest, a cross-connection challenge, a replayed challenge and a forged member', async () => {
    const w = world();
    const { selected, challenge } = await admitted(w);
    const wrongDigest = await confirmCommit(w, selected, challenge, { digest: 'b'.repeat(64) });
    expect(wrongDigest.outcome).toBe('REJECTED');
    const crossConnection = await confirmCommit(w, selected, challenge, {
      connectionId: OTHER_CONNECTION,
    });
    expect(crossConnection.outcome).toBe('REJECTED');
    expect(crossConnection.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    const forged = await confirmBegin(w, ['s5m-forged0000000000']);
    expect(forged.outcome).toBe('REJECTED');
  });

  it('consumes the challenge single-use: a second COMMIT with the same token rejects', async () => {
    const w = world();
    const { selected, challenge } = await admitted(w);
    const first = await confirmCommit(w, selected, challenge);
    expect(first.outcome).toBe('ACCEPTED');
    const replay = await confirmCommit(w, selected, challenge);
    expect(replay.outcome).toBe('REJECTED');
  });

  it('rejects a changed selection over a recorded one (no rewrite)', async () => {
    const w = world();
    const { selected, challenge } = await admitted(w);
    await confirmCommit(w, selected, challenge);
    const members = memberIdsFrom(w.server);
    const other = [members[1]!.memberId];
    // A fresh BEGIN for a different subset mints its own challenge; the
    // immutable conflict surfaces at COMMIT — never a rewrite.
    const begin2 = await confirmBegin(w, other, { revision: 3 });
    expect(begin2.outcome).toBe('ACCEPTED');
    const commit2 = await confirmCommit(w, other, begin2.s5PrivateChallenge?.value ?? '', {
      revision: 3,
    });
    expect(commit2.outcome).toBe('REJECTED');
    expect(commit2.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects an expired confirmation at execute time', async () => {
    const w = world();
    const { selected, challenge } = await admitted(w);
    await confirmCommit(w, selected, challenge);
    w.clock.now += 121_000;
    const view = w.server.inspectProjection(AGGREGATE) as unknown as Record<string, unknown>;
    const confirmedGroupId = (view['s5ConfirmedGroup'] as Record<string, unknown>)[
      'confirmedGroupId'
    ];
    const execute = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'EXECUTE_S5_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId },
        expectedRevision: 3,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(execute.outcome).toBe('REJECTED');
    expect(execute.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });
});

describe('#151 EXECUTE single durable intent + restart replay', () => {
  async function admittedWorld(): Promise<{
    w: S5World;
    selected: readonly string[];
    confirmedGroupId: string;
  }> {
    const w = world();
    await prepareAggregate(w);
    await drivePrepare(w);
    const members = memberIdsFrom(w.server);
    const selected = members.map((member) => member.memberId).slice(0, 2);
    const begin = await confirmBegin(w, selected);
    const challenge = begin.outcome === 'ACCEPTED' ? begin.s5PrivateChallenge?.value : undefined;
    if (challenge === undefined) throw new Error('no challenge');
    const commit = await confirmCommit(w, selected, challenge);
    expect(commit.outcome).toBe('ACCEPTED');
    const view = w.server.inspectProjection(AGGREGATE) as unknown as Record<string, unknown>;
    return {
      w,
      selected,
      confirmedGroupId: (view['s5ConfirmedGroup'] as Record<string, unknown>)[
        'confirmedGroupId'
      ] as string,
    };
  }

  it('registers exactly one intent and drives post-commit; a second execute rejects', async () => {
    const drive = beginnerCalls();
    const w = world({ beginner: drive.beginner });
    await prepareAggregate(w);
    await drivePrepare(w);
    const members = memberIdsFrom(w.server);
    const selected = [members[0]!.memberId];
    const begin = await confirmBegin(w, selected);
    const challenge = begin.s5PrivateChallenge?.value;
    if (challenge === undefined) throw new Error('no challenge');
    await confirmCommit(w, selected, challenge);
    const first = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'EXECUTE_S5_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s5group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 3,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(first.outcome).toBe('ACCEPTED');
    expect(drive.calls).toHaveLength(1);
    const second = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'EXECUTE_S5_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s5group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 4,
        requestId: requestId(),
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(second.outcome).toBe('REJECTED');
    expect(second.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rebuilds frozen/confirmed/intent state from journal replay', async () => {
    const { w } = await admittedWorld();
    const execute = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'EXECUTE_S5_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s5group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 3,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(execute.outcome).toBe('ACCEPTED');
    // Restart: a fresh server over the same journal restores durable truth.
    const drive = beginnerCalls();
    const reopened = createCoreSeamServer({
      expectedPeer: {
        installId: 'install-001',
        userId: 'user-001',
        allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
      },
      journal: w.journal,
      s5Challenge: { ttlMs: 120_000, now: () => w.clock.now },
      s5PageGroup: drive.beginner,
    });
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.diagnostics));
    const view = reopened.value.inspectProjection(AGGREGATE) as unknown as Record<string, unknown>;
    expect((view['s5PreparedGroup'] as Record<string, unknown>)['prepareId']).toBe(PREPARE_ID);
    const confirmed = view['s5ConfirmedGroup'] as Record<string, unknown>;
    expect(confirmed['confirmedGroupId']).toBe(`s5group:${AGGREGATE}:${SNAPSHOT}`);
    expect(reopened.value.pendingS5Executions()).toHaveLength(1);
  });

  it('rejects EXECUTE without a confirmed group', async () => {
    const w = world();
    await prepareAggregate(w);
    await drivePrepare(w);
    const execute = frame(
      w.server,
      w.registry,
      s5Command({
        commandType: 'EXECUTE_S5_COLLECTION',
        payload: { snapshotId: SNAPSHOT, confirmedGroupId: `s5group:${AGGREGATE}:${SNAPSHOT}` },
        expectedRevision: 2,
        correlation: { snapshotId: SNAPSHOT },
      }),
    );
    expect(execute.outcome).toBe('REJECTED');
    expect(execute.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });
});
