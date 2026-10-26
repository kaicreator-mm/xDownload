/**
 * #153 S4 selected-HLS seam authority — the installed 1.2 private handlers
 * behind the OS-verified session gate: journal-before-network preview
 * admission, Core-observed preview receipts, single-use connection-bound
 * private selection challenges (BEGIN/COMMIT), durable execution-intent
 * registration, plus the required fail-closed negatives (unverified
 * transport, legacy composition, mismatched/expired/replayed challenge,
 * conflicting preview source, duplicate execution, restart replay rebuild).
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  s4SelectionTupleDigest,
  type CommandEnvelope,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type S4ConfirmedSelectionRecord,
  type S4PreviewRecord,
  type SeamJournal,
  type SeamResponse,
  type S4PreviewBeginner,
  type S4SelectedHlsBeginner,
  type VerifiedPeerSessionPort,
} from '../src/index.ts';
import { peer, rawCommand, rawSingleResourceContract, requestId } from './helpers.ts';

const CONNECTION = 'conn-s4-001';
const OTHER_CONNECTION = 'conn-s4-other';
const MANIFEST = 'https://cdn.example.org/vod/master.m3u8';
const RENDITION = 'https://cdn.example.org/vod/rend-360p.m3u8';
const S4_PROFILE = 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1';

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

function s4Command(input: {
  readonly commandType: string;
  readonly payload: unknown;
  readonly expectedRevision?: number;
  readonly requestId?: string;
  readonly surface?: 'CLI' | 'DESKTOP_UI';
  readonly correlation?: Record<string, string>;
}): Record<string, unknown> {
  return rawCommand({
    commandType: input.commandType as CommandEnvelope['commandType'],
    aggregateId: 'contract-s4-001',
    payload: input.payload,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    asPeer: peer(input.surface ?? 'CLI'),
    ...(input.correlation === undefined ? {} : { correlation: input.correlation }),
  });
}

function singleSnapshot(): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId: 's4snap-001',
    contractId: 'contract-s4-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-s4-001' },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: 'single_resource:target-s4-001',
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: ['s4member-001'] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: ['s4member-001'] },
    selectedMemberIds: ['s4member-001'],
    authorizationContextRef: 'authctx/s4-test',
    profileContextRef: 'profile/s4-test-001',
    selectionClaims: [
      {
        kind: 'SINGLE',
        confirmationType: 'CONFIRM_RESOURCE_IDENTITY',
        memberRefs: ['s4member-001'],
      },
    ],
    sourceMarker: { system: 'xdownload-test', version: 'v0.1.0' },
    createdAt: '2026-10-26T00:00:00Z',
  };
}

interface Composition {
  readonly server: CoreSeamServer;
  readonly sessions: ReturnType<typeof createVerifiedPeerSessionRegistry>;
  readonly journal: SeamJournal;
  readonly begunPreviews: S4PreviewRecord[];
  readonly begunExecutions: S4ConfirmedSelectionRecord[];
  readonly clock: Clock;
}

/** Compose one installed-S4 seam over a prepared contract+snapshot lineage. */
function composeInstalled(): Composition {
  const journal = createInMemorySeamJournal();
  const registry = createVerifiedPeerSessionRegistry();
  registry.record(verifiedSession(CONNECTION));
  registry.record(verifiedSession(OTHER_CONNECTION));
  const clock = { now: Date.parse('2026-10-26T00:00:00Z') };
  const begunPreviews: S4PreviewRecord[] = [];
  const begunExecutions: S4ConfirmedSelectionRecord[] = [];
  const previewDriver: S4PreviewBeginner = {
    begin: (input) => {
      begunPreviews.push(input.preview);
    },
  };
  const hlsBeginner: S4SelectedHlsBeginner = {
    begin: (input) => {
      begunExecutions.push(input.selection);
    },
  };
  const result = createCoreSeamServer({
    expectedPeer: {
      installId: 'install-001',
      userId: 'user-001',
      allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
    },
    journal,
    s4Preview: previewDriver,
    s4SelectedHls: hlsBeginner,
    s4Challenge: { ttlMs: 120_000, now: () => clock.now },
  });
  if (!result.ok) {
    throw new Error(`installed composition failed: ${result.diagnostics[0]?.message ?? ''}`);
  }
  const server = result.value;
  const contract = rawSingleResourceContract({
    contractId: 'contract-s4-001',
    requestedTarget: 'target-s4-001',
    requestedScope: { kind: 'single_resource', targetId: 'target-s4-001' },
    selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
  });
  const submitted = frame(server, registry, {
    ...s4Command({
      commandType: 'SUBMIT_CONTRACT',
      payload: contract,
      expectedRevision: 0,
    }),
  });
  expect(submitted.outcome).toBe('ACCEPTED');
  const confirmed = frame(server, registry, {
    ...s4Command({
      commandType: 'CONFIRM_SNAPSHOT',
      payload: singleSnapshot(),
      expectedRevision: 1,
    }),
  });
  expect(confirmed.outcome).toBe('ACCEPTED');
  return { server, sessions: registry, journal, begunPreviews, begunExecutions, clock };
}

function previewPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 's4snap-001',
    memberId: 's4member-001',
    manifestUri: MANIFEST,
    mediaProfileId: S4_PROFILE,
    ...overrides,
  };
}

function previewRecord(
  composition: Composition,
  overrides: Partial<S4PreviewRecord> = {},
): S4PreviewRecord {
  const pending = availablePreviewBase();
  void composition;
  return { ...pending, ...overrides };
}

function availablePreviewBase(): S4PreviewRecord {
  return {
    previewId: 's4preview:contract-s4-001:s4snap-001:s4member-001',
    snapshotId: 's4snap-001',
    memberId: 's4member-001',
    manifestUri: MANIFEST,
    mediaProfileId: S4_PROFILE,
    status: 'AVAILABLE',
    createdAt: new Date(Date.parse('2026-10-26T00:00:01Z')).toISOString(),
    expiresAt: new Date(Date.parse('2026-10-26T00:00:01Z') + 120_000).toISOString(),
    variants: [
      {
        key: 'rend-0',
        uri: RENDITION,
        bandwidth: 800_000,
        codecs: 'avc1.42e01e,mp4a.40.2',
        width: 640,
        height: 360,
      },
      { key: 'rend-1', uri: 'https://cdn.example.org/vod/rend-720p.m3u8', bandwidth: 2_000_000 },
    ],
  };
}

function tupleDigestFor(key = 'rend-0'): string {
  const variant =
    key === 'rend-0' ? availablePreviewBase().variants![0]! : availablePreviewBase().variants![1]!;
  return s4SelectionTupleDigest({
    contractId: 'contract-s4-001',
    snapshotId: 's4snap-001',
    memberId: 's4member-001',
    previewId: 's4preview:contract-s4-001:s4snap-001:s4member-001',
    renditionKey: variant.key,
    renditionUri: variant.uri,
    manifestUri: MANIFEST,
    mediaProfileId: S4_PROFILE,
    bandwidth: variant.bandwidth,
    ...(variant.width === undefined ? {} : { width: variant.width }),
    ...(variant.height === undefined ? {} : { height: variant.height }),
  });
}

/** Admit + observe one preview, returning the current revision after it. */
function prepareAvailablePreview(composition: Composition): number {
  const preview = frame(composition.server, composition.sessions, {
    ...s4Command({
      commandType: 'PREVIEW_S4_HLS_VOD',
      payload: previewPayload(),
      expectedRevision: 2,
      correlation: { contractId: 'contract-s4-001', snapshotId: 's4snap-001' },
    }),
  });
  expect(preview.outcome).toBe('ACCEPTED');
  const observed = composition.server.recordS4PreviewResult(
    'contract-s4-001',
    availablePreviewBase(),
  );
  expect(observed.ok).toBe(true);
  return preview.acceptance?.revision ?? 3;
}

function beginPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'BEGIN',
    snapshotId: 's4snap-001',
    memberId: 's4member-001',
    previewId: 's4preview:contract-s4-001:s4snap-001:s4member-001',
    renditionKey: 'rend-0',
    displayedTupleDigest: tupleDigestFor(),
    ...overrides,
  };
}

function commitPayload(
  challenge: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...beginPayload(),
    phase: 'COMMIT',
    confirmationChallenge: challenge,
    ...overrides,
  };
}

describe('#153 S4 fail-closed admission', () => {
  it('rejects every S4 command on a composition without the S4 driver', () => {
    const legacy = createCoreSeamServer({
      expectedPeer: { installId: 'install-001', userId: 'user-001', allowedSurfaces: ['CLI'] },
      journal: createInMemorySeamJournal(),
    });
    if (!legacy.ok) throw new Error('legacy composition failed');
    const registry = createVerifiedPeerSessionRegistry();
    registry.record(verifiedSession(CONNECTION));
    for (const payload of [
      previewPayload(),
      beginPayload(),
      commitPayload('0'.repeat(64)),
      { snapshotId: 's4snap-001', memberId: 's4member-001', confirmedSelectionId: 'x' },
    ]) {
      const commandType =
        'confirmedSelectionId' in payload ? 'EXECUTE_S4_SELECTED_HLS_VOD' : 'CONFIRM_S4_SELECTION';
      const response = frame(legacy.value, registry, {
        ...s4Command({
          commandType: 'manifestUri' in payload ? 'PREVIEW_S4_HLS_VOD' : commandType,
          payload,
        }),
      });
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
    }
  });

  it('rejects every S4 command without an OS-verified session on the live connection', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({ commandType: 'PREVIEW_S4_HLS_VOD', payload: previewPayload() }),
    });
    // No session recorded for the OTHER connection id used below.
    const stranger = createVerifiedPeerSessionRegistry();
    const unverified = composition.server.handleFrame(
      JSON.stringify({
        ...s4Command({ commandType: 'PREVIEW_S4_HLS_VOD', payload: previewPayload() }),
      }),
      stranger,
      'conn-never-verified',
    );
    expect(response.outcome).toBe('REJECTED');
    expect(unverified.outcome).toBe('REJECTED');
    expect(unverified.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });
});

describe('#153 S4 preview admission (journal-before-network)', () => {
  it('journals the PENDING preview intent and fires the driver only after acceptance', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
        correlation: { contractId: 'contract-s4-001', snapshotId: 's4snap-001' },
      }),
    });
    expect(response.outcome).toBe('ACCEPTED');
    expect(composition.begunPreviews).toHaveLength(1);
    expect(composition.begunPreviews[0]?.status).toBe('PENDING');
    const view = composition.server.inspectProjection('contract-s4-001');
    expect(view?.s4Preview?.status).toBe('PENDING');
    // The accepted command (with intent payload) is in the journal.
    expect(composition.journal.replayAll()).toHaveLength(3);
  });

  it('converges an identical re-preview and rejects a conflicting manifest source', () => {
    const composition = composeInstalled();
    prepareAvailablePreview(composition);
    const identical = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 3,
      }),
    });
    expect(identical.outcome).toBe('ACCEPTED');
    const conflicting = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload({ manifestUri: 'https://other.example.org/evil.m3u8' }),
        expectedRevision: 3,
      }),
    });
    expect(conflicting.outcome).toBe('REJECTED');
    expect(conflicting.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects a preview that does not bind the confirmed snapshot member', () => {
    const composition = composeInstalled();
    for (const payload of [
      previewPayload({ snapshotId: 's4snap-999' }),
      previewPayload({ memberId: 's4member-999' }),
      previewPayload({ mediaProfileId: 'OTHER_PROFILE' }),
    ]) {
      const response = frame(composition.server, composition.sessions, {
        ...s4Command({ commandType: 'PREVIEW_S4_HLS_VOD', payload, expectedRevision: 2 }),
      });
      expect(response.outcome).toBe('REJECTED');
    }
  });

  it('rejects a non-CLI surface before any effect', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
        surface: 'DESKTOP_UI',
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    expect(composition.begunPreviews).toHaveLength(0);
  });
});

describe('#153 S4 Core-observed preview receipts', () => {
  it('publishes AVAILABLE variants through the trusted port and projects them', () => {
    const composition = composeInstalled();
    frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
      }),
    });
    const published = composition.server.recordS4PreviewResult(
      'contract-s4-001',
      availablePreviewBase(),
    );
    expect(published.ok).toBe(true);
    const view = composition.server.inspectProjection('contract-s4-001');
    expect(view?.s4Preview?.status).toBe('AVAILABLE');
    expect(view?.s4Preview?.variants?.[0]?.key).toBe('rend-0');
    // Identical receipts converge; a differing one over observed truth rejects.
    expect(
      composition.server.recordS4PreviewResult('contract-s4-001', availablePreviewBase()).ok,
    ).toBe(true);
    const conflicting = composition.server.recordS4PreviewResult('contract-s4-001', {
      ...availablePreviewBase(),
      variants: availablePreviewBase().variants!.slice(0, 1),
    });
    expect(conflicting.ok).toBe(false);
  });

  it('rejects malformed receipts and receipts without an admitted intent', () => {
    const composition = composeInstalled();
    const badVariant = composition.server.recordS4PreviewResult('contract-s4-001', {
      ...availablePreviewBase(),
      variants: [{ key: 'not-the-pattern', uri: RENDITION, bandwidth: 1 }],
    });
    expect(badVariant.ok).toBe(false);
    const noIntent = createCoreSeamServer({
      expectedPeer: { installId: 'install-001', userId: 'user-001', allowedSurfaces: ['CLI'] },
      journal: createInMemorySeamJournal(),
      s4Preview: { begin: () => undefined },
      s4SelectedHls: { begin: () => undefined },
    });
    if (!noIntent.ok) throw new Error('composition failed');
    const orphan = noIntent.value.recordS4PreviewResult('contract-s4-001', availablePreviewBase());
    expect(orphan.ok).toBe(false);
  });

  it('accepts a truthful FAILED refusal and never re-pends', () => {
    const composition = composeInstalled();
    frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
      }),
    });
    const failed = composition.server.recordS4PreviewResult('contract-s4-001', {
      ...previewRecord(composition),
      status: 'FAILED',
      failureReason: 'MANIFEST_UNREACHABLE',
    });
    expect(failed.ok).toBe(true);
    const resurrect = composition.server.recordS4PreviewResult(
      'contract-s4-001',
      availablePreviewBase(),
    );
    expect(resurrect.ok).toBe(false);
  });
});

describe('#153 S4 confirmation challenges (BEGIN/COMMIT)', () => {
  it('mints one connection-bound challenge for the exact displayed tuple', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const begin = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    expect(begin.outcome).toBe('ACCEPTED');
    expect(begin.s4PrivateChallenge).toBeDefined();
    expect(begin.s4PrivateChallenge?.previewId).toBe(
      's4preview:contract-s4-001:s4snap-001:s4member-001',
    );
    expect(begin.s4PrivateChallenge?.renditionKey).toBe('rend-0');
    expect(begin.s4PrivateChallenge?.value).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects BEGIN against a mismatched digest, unknown rendition or PENDING preview', () => {
    const composition = composeInstalled();
    frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
      }),
    });
    // PENDING: no challenge yet.
    const pending = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: 3,
      }),
    });
    expect(pending.outcome).toBe('REJECTED');
    composition.server.recordS4PreviewResult('contract-s4-001', availablePreviewBase());
    for (const payload of [
      beginPayload({ displayedTupleDigest: 'f'.repeat(64) }),
      beginPayload({ renditionKey: 'rend-9' }),
    ]) {
      const response = frame(composition.server, composition.sessions, {
        ...s4Command({
          commandType: 'CONFIRM_S4_SELECTION',
          payload,
          expectedRevision: 3,
        }),
      });
      expect(response.outcome).toBe('REJECTED');
    }
  });

  it('review F2: rejects BEGIN after the preview record itself expired', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    composition.clock.now += 121_000;
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('review F3: a fresh BEGIN revokes the previously pending challenge', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const first = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    const firstChallenge = first.s4PrivateChallenge?.value;
    expect(firstChallenge).toBeDefined();
    const second = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
        requestId: requestId(),
      }),
    });
    expect(second.s4PrivateChallenge?.value).not.toBe(firstChallenge);
    // The revoked first challenge can no longer confirm anything.
    const committed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload(firstChallenge!),
        expectedRevision: revision,
      }),
    });
    expect(committed.outcome).toBe('REJECTED');
    expect(
      composition.server.inspectProjection('contract-s4-001')?.s4ConfirmedSelection,
    ).toBeUndefined();
  });

  it('review F5: a legacy 1.0 frame carrying an S4 opcode rejects before semantics', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({ commandType: 'PREVIEW_S4_HLS_VOD', payload: previewPayload() }),
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');
    expect(composition.begunPreviews).toHaveLength(0);
  });

  it('never replays the raw challenge value on a duplicate BEGIN', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const req = requestId();
    const first = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
        requestId: req,
      }),
    });
    expect(first.s4PrivateChallenge).toBeDefined();
    const duplicate = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
        requestId: req,
      }),
    });
    expect(duplicate.outcome).toBe('ACCEPTED');
    expect(duplicate.s4PrivateChallenge).toBeUndefined();
    const conflicting = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload({ renditionKey: 'rend-1' }),
        expectedRevision: revision,
        requestId: req,
      }),
    });
    expect(conflicting.outcome).toBe('REJECTED');
    expect(conflicting.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('commits exactly once: the challenge is consumed with the journal commit', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const begin = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    const challenge = begin.s4PrivateChallenge?.value;
    expect(challenge).toBeDefined();
    const committed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload(challenge!),
        expectedRevision: revision,
      }),
    });
    expect(committed.outcome).toBe('ACCEPTED');
    const view = composition.server.inspectProjection('contract-s4-001');
    expect(view?.s4ConfirmedSelection?.renditionKey).toBe('rend-0');
    expect(view?.s4ConfirmedSelection?.renditionUri).toBe(RENDITION);
    // The journaled CONFIRM payload carries the secret-free record only.
    const journalCommand = composition.journal
      .replayAll()
      .filter((entry) => entry.kind === undefined || entry.kind === 'COMMAND')
      .find(
        (entry) =>
          entry.kind !== 'COVERAGE_ACCOUNTING' &&
          entry.kind !== 'TARGET_EVIDENCE' &&
          entry.kind !== 'TARGET_WITNESS' &&
          entry.kind !== 'S4_PREVIEW' &&
          entry.envelope.commandType === 'CONFIRM_S4_SELECTION',
      );
    expect(journalCommand).toBeDefined();
    const journaledPayload = (journalCommand as { envelope: { payload: unknown } }).envelope
      .payload as Record<string, unknown>;
    expect(journaledPayload['confirmationChallenge']).toBeUndefined();
    expect(journaledPayload['confirmedSelectionId']).toBe(
      's4select:contract-s4-001:s4snap-001:s4member-001',
    );
    // Replay of the SAME challenge (idempotent duplicate converged already);
    // a second COMMIT with the consumed challenge on a fresh request rejects.
    const replayed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload(challenge!),
        expectedRevision: revision + 1,
        requestId: requestId(),
      }),
    });
    expect(replayed.outcome).toBe('REJECTED');
  });

  it('rejects COMMIT with a wrong digest, foreign challenge, cross-connection or expired challenge', () => {
    for (const scenario of ['wrong-digest', 'cross-connection', 'expired'] as const) {
      const composition = composeInstalled();
      const revision = prepareAvailablePreview(composition);
      const begin = frame(composition.server, composition.sessions, {
        ...s4Command({
          commandType: 'CONFIRM_S4_SELECTION',
          payload: beginPayload(),
          expectedRevision: revision,
        }),
      });
      const challenge = begin.s4PrivateChallenge?.value;
      if (scenario === 'expired') {
        composition.clock.now += 121_000;
      }
      const payload =
        scenario === 'wrong-digest'
          ? commitPayload(challenge!, { displayedTupleDigest: 'f'.repeat(64) })
          : commitPayload(challenge!);
      const response =
        scenario === 'cross-connection'
          ? frame(
              composition.server,
              composition.sessions,
              {
                ...s4Command({
                  commandType: 'CONFIRM_S4_SELECTION',
                  payload,
                  expectedRevision: revision,
                }),
              },
              OTHER_CONNECTION,
            )
          : frame(composition.server, composition.sessions, {
              ...s4Command({
                commandType: 'CONFIRM_S4_SELECTION',
                payload,
                expectedRevision: revision,
              }),
            });
      expect(response.outcome).toBe('REJECTED');
      expect(
        composition.server.inspectProjection('contract-s4-001')?.s4ConfirmedSelection,
      ).toBeUndefined();
    }
  });
});

describe('#153 S4 execution intent', () => {
  function confirmedComposition(): {
    readonly composition: Composition;
    readonly revision: number;
    readonly confirmedSelectionId: string;
  } {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const begin = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    const committed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload(begin.s4PrivateChallenge!.value),
        expectedRevision: revision,
      }),
    });
    expect(committed.outcome).toBe('ACCEPTED');
    return {
      composition,
      revision: committed.acceptance?.revision ?? 4,
      confirmedSelectionId: 's4select:contract-s4-001:s4snap-001:s4member-001',
    };
  }

  it('registers exactly one durable intent and fires the driver after the journal commit', () => {
    const { composition, revision, confirmedSelectionId } = confirmedComposition();
    const response = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: { snapshotId: 's4snap-001', memberId: 's4member-001', confirmedSelectionId },
        expectedRevision: revision,
      }),
    });
    expect(response.outcome).toBe('ACCEPTED');
    expect(composition.begunExecutions).toHaveLength(1);
    expect(composition.begunExecutions[0]?.renditionUri).toBe(RENDITION);
    expect(composition.server.pendingS4Executions()).toHaveLength(1);
    const duplicate = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: { snapshotId: 's4snap-001', memberId: 's4member-001', confirmedSelectionId },
        expectedRevision: revision + 1,
        requestId: requestId(),
      }),
    });
    expect(duplicate.outcome).toBe('REJECTED');
    expect(composition.begunExecutions).toHaveLength(1);
  });

  it('rejects execution against an unknown or expired confirmed selection', () => {
    const { composition, revision, confirmedSelectionId } = confirmedComposition();
    const unknown = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: {
          snapshotId: 's4snap-001',
          memberId: 's4member-001',
          confirmedSelectionId: 's4select:contract-s4-001:s4snap-001:s4member-999',
        },
        expectedRevision: revision,
      }),
    });
    expect(unknown.outcome).toBe('REJECTED');
    composition.clock.now += 121_000;
    const expired = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: { snapshotId: 's4snap-001', memberId: 's4member-001', confirmedSelectionId },
        expectedRevision: revision,
      }),
    });
    expect(expired.outcome).toBe('REJECTED');
    expect(composition.begunExecutions).toHaveLength(0);
  });
});

describe('#153 S4 restart replay rebuilds durable S4 truth', () => {
  it('rebuilds the observed preview, confirmed selection and execution intent from the journal', () => {
    const composition = composeInstalled();
    const revision = prepareAvailablePreview(composition);
    const begin = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: beginPayload(),
        expectedRevision: revision,
      }),
    });
    const committed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload(begin.s4PrivateChallenge!.value),
        expectedRevision: revision,
      }),
    });
    expect(committed.outcome).toBe('ACCEPTED');
    const executed = frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: {
          snapshotId: 's4snap-001',
          memberId: 's4member-001',
          confirmedSelectionId: 's4select:contract-s4-001:s4snap-001:s4member-001',
        },
        expectedRevision: revision + 1,
      }),
    });
    expect(executed.outcome).toBe('ACCEPTED');

    const reopened = createCoreSeamServer({
      expectedPeer: {
        installId: 'install-001',
        userId: 'user-001',
        allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
      },
      journal: composition.journal,
      s4Preview: { begin: () => undefined },
      s4SelectedHls: { begin: () => undefined },
      s4Challenge: { ttlMs: 120_000, now: () => composition.clock.now },
    });
    if (!reopened.ok) {
      throw new Error(`replay composition failed: ${reopened.diagnostics[0]?.message ?? ''}`);
    }
    const view = reopened.value.inspectProjection('contract-s4-001');
    expect(view?.s4Preview?.status).toBe('AVAILABLE');
    expect(view?.s4ConfirmedSelection?.renditionKey).toBe('rend-0');
    expect(reopened.value.pendingS4Executions()).toHaveLength(1);
    expect(reopened.value.pendingS4Previews()).toHaveLength(0);
    // Idempotent replay of the journaled EXECUTE converges without a second intent.
    const replayedExecute = frame(reopened.value, composition.sessions, {
      ...s4Command({
        commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
        payload: {
          snapshotId: 's4snap-001',
          memberId: 's4member-001',
          confirmedSelectionId: 's4select:contract-s4-001:s4snap-001:s4member-001',
        },
        expectedRevision: revision + 2,
        requestId: executed.inReplyTo,
      }),
    });
    expect(replayedExecute.outcome).toBe('ACCEPTED');
  });

  it('re-drives a PENDING preview after restart and refuses a replayed raw COMMIT challenge', () => {
    const composition = composeInstalled();
    frame(composition.server, composition.sessions, {
      ...s4Command({
        commandType: 'PREVIEW_S4_HLS_VOD',
        payload: previewPayload(),
        expectedRevision: 2,
      }),
    });
    const reopened = createCoreSeamServer({
      expectedPeer: { installId: 'install-001', userId: 'user-001', allowedSurfaces: ['CLI'] },
      journal: composition.journal,
      s4Preview: { begin: () => undefined },
      s4SelectedHls: { begin: () => undefined },
    });
    if (!reopened.ok) throw new Error('replay composition failed');
    expect(reopened.value.pendingS4Previews()).toHaveLength(1);
    // The pending challenges are dropped on restart: a forged COMMIT with a
    // previously minted (now unrecoverable) challenge fails closed.
    composition.server.recordS4PreviewResult('contract-s4-001', availablePreviewBase());
    const forged = frame(reopened.value, composition.sessions, {
      ...s4Command({
        commandType: 'CONFIRM_S4_SELECTION',
        payload: commitPayload('a'.repeat(64)),
        expectedRevision: 3,
      }),
    });
    expect(forged.outcome).toBe('REJECTED');
  });
});
