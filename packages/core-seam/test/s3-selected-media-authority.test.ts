/**
 * #150 S3 selected-media seam authority — the installed 1.2 private handlers
 * behind the OS-verified session gate: Core-issued single-use selection
 * challenges, durable candidate confirmation (journal-before-effect) and
 * execution-intent registration, plus the required fail-closed negatives
 * (unverified transport, legacy composition, consumed/expired/mismatched
 * challenge, wrong member/profile/tuple, duplicate execution, restart
 * replay rebuild).
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  s3SelectionTupleDigest,
  type CommandEnvelope,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type S3CandidateRecord,
  type SeamJournal,
  type SeamResponse,
  type S3SelectedMediaBeginner,
  type VerifiedPeerSessionPort,
} from '../src/index.ts';
import { rawCommand, rawSingleResourceContract, requestId, type PeerIdentity } from './helpers.ts';

const MEDIA_PROFILES: Readonly<Record<string, string>> = {
  's3-media-mp4-v1': 'mp4',
  's3-media-m4a-v1': 'm4a',
  's3-media-mp3-v1': 'mp3',
  's3-media-webm-v1': 'webm',
};

const PROFILES_PORT = {
  supportedProfile: (id: string) => id in MEDIA_PROFILES,
  profileContainerOf: (id: string) => MEDIA_PROFILES[id],
  profileProbeRevisionOf: () => 1,
  registryDigest: () => 'a'.repeat(64),
} as const;

const CONNECTION = 'conn-s3-001';
const LOCATOR = 'https://media.example.org/media/clip_01.mp4';

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
): SeamResponse {
  return server.handleFrame(JSON.stringify(raw), sessions, CONNECTION);
}

function s3Command(input: {
  readonly commandType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly expectedRevision?: number;
  readonly requestId?: string;
  readonly asPeer?: PeerIdentity;
}): Record<string, unknown> {
  return rawCommand({
    commandType: input.commandType as CommandEnvelope['commandType'],
    aggregateId: input.aggregateId,
    payload: input.payload,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    asPeer: input.asPeer,
  });
}

function singleSnapshot(contractId: string, targetId: string, memberId: string): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId: 's3snap-001',
    contractId,
    requestedScope: { kind: 'single_resource', targetId },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:${targetId}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    selectedMemberIds: [memberId],
    authorizationContextRef: 'authctx/s3-test',
    profileContextRef: 'profile/s3-test-001',
    selectionClaims: [
      { kind: 'SINGLE', confirmationType: 'CONFIRM_RESOURCE_IDENTITY', memberRefs: [memberId] },
    ],
    sourceMarker: { system: 'xdownload-test', version: 'v0.1.0' },
    createdAt: '2026-10-26T00:00:00Z',
  };
}

interface Composition {
  readonly server: CoreSeamServer;
  readonly sessions: ReturnType<typeof createVerifiedPeerSessionRegistry>;
  readonly journal: SeamJournal;
  readonly begun: { readonly candidate: S3CandidateRecord; readonly aggregateId: string }[];
  readonly clock: Clock;
}

/** Compose one installed-S3 seam over a prepared contract+snapshot lineage. */
function composeInstalled(options: { readonly prepare?: boolean } = {}): Composition {
  const journal = createInMemorySeamJournal();
  const registry = createVerifiedPeerSessionRegistry();
  registry.record(verifiedSession(CONNECTION));
  const clock = { now: Date.parse('2026-10-26T00:00:00Z') };
  const begun: { readonly candidate: S3CandidateRecord; readonly aggregateId: string }[] = [];
  const beginner: S3SelectedMediaBeginner = {
    begin: (input) => {
      begun.push({ candidate: input.candidate, aggregateId: input.aggregateId });
    },
  };
  const result = createCoreSeamServer({
    expectedPeer: {
      installId: 'install-001',
      userId: 'user-001',
      allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
    },
    journal,
    s3MediaProfiles: PROFILES_PORT,
    s3SelectedMedia: beginner,
    s3Challenge: { ttlMs: 120_000, now: () => clock.now },
  });
  if (!result.ok) {
    throw new Error(`installed composition failed: ${result.diagnostics[0]?.message ?? ''}`);
  }
  const server = result.value;
  if (options.prepare !== false) {
    // SUBMIT_CONTRACT (rev 0→1) then CONFIRM_SNAPSHOT (1→2).
    const contract = rawSingleResourceContract({
      contractId: 'contract-s3-001',
      requestedTarget: 'target-s3-001',
      requestedScope: { kind: 'single_resource', targetId: 'target-s3-001' },
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
    });
    const submitted = frame(server, registry, {
      ...s3Command({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-s3-001',
        payload: contract,
        expectedRevision: 0,
      }),
    });
    expect(submitted.outcome).toBe('ACCEPTED');
    const confirmed = frame(server, registry, {
      ...s3Command({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-s3-001',
        payload: singleSnapshot('contract-s3-001', 'target-s3-001', 's3member-001'),
        expectedRevision: 1,
      }),
    });
    expect(confirmed.outcome).toBe('ACCEPTED');
  }
  return { server, sessions: registry, journal, begun, clock };
}

function challengePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 's3snap-001',
    memberId: 's3member-001',
    variantKey: 'variant-720p',
    locatorUri: LOCATOR,
    declaredRedirectHosts: ['media.example.org', 'cdn.example.org'],
    mediaProfileId: 's3-media-mp4-v1',
    ...overrides,
  };
}

function requestChallenge(
  composition: Composition,
  payload: unknown,
  req?: string,
  expectedRevision = 2,
): SeamResponse {
  return frame(composition.server, composition.sessions, {
    ...s3Command({
      commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
      aggregateId: 'contract-s3-001',
      payload,
      expectedRevision,
      requestId: req,
    }),
  });
}

function confirmPayload(
  challenge: {
    readonly challenge: string;
    readonly tupleDigest: string;
    readonly coreRevision: number;
  },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...challengePayload(),
    selectionAttestation: {
      kind: 'EXPLICIT_CLI_GESTURE',
      interactionId: challenge.challenge,
      displayTupleDigest: challenge.tupleDigest,
      confirmedAt: '2026-10-26T00:00:30Z',
      expectedRevision: challenge.coreRevision,
    },
    ...overrides,
  };
}

describe('#150 S3 selection challenge issuance', () => {
  it('mints one single-use challenge bound to the canonical displayed tuple', () => {
    const composition = composeInstalled();
    const response = requestChallenge(composition, challengePayload());
    expect(response.outcome).toBe('ACCEPTED');
    expect(response.challenge).toBeDefined();
    const challenge = response.challenge!;
    expect(challenge.tupleDigest).toBe(
      s3SelectionTupleDigest({
        contractId: 'contract-s3-001',
        snapshotId: 's3snap-001',
        memberId: 's3member-001',
        variantKey: 'variant-720p',
        selectedLocator: LOCATOR,
        mediaProfileId: 's3-media-mp4-v1',
      }),
    );
    expect(challenge.coreRevision).toBe(2);
    expect(challenge.mediaProfilesDigest).toBe('a'.repeat(64));
  });

  it('replays the identical response for a duplicate requestId', () => {
    const composition = composeInstalled();
    const first = requestChallenge(composition, challengePayload(), 'req-ch-1');
    const second = requestChallenge(composition, challengePayload(), 'req-ch-1');
    expect(second.challenge?.challenge).toBe(first.challenge?.challenge);
  });

  it('rejects a member outside the confirmed snapshot', () => {
    const composition = composeInstalled();
    const response = requestChallenge(
      composition,
      challengePayload({ memberId: 's3member-other' }),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects an unregistered media profile id', () => {
    const composition = composeInstalled();
    const response = requestChallenge(
      composition,
      challengePayload({ mediaProfileId: 's3-media-mkv-v9' }),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('MEDIA_POLICY_REQUIRED');
  });

  it('rejects a profile whose container disagrees with the locator extension', () => {
    const composition = composeInstalled();
    const response = requestChallenge(
      composition,
      challengePayload({ mediaProfileId: 's3-media-webm-v1' }),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('requires the current aggregate revision', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
        aggregateId: 'contract-s3-001',
        payload: challengePayload(),
        expectedRevision: 7,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('REVISION_MISMATCH');
  });

  it('fails closed without an OS-verified session (loopback cannot claim it)', () => {
    const composition = composeInstalled();
    const raw = JSON.stringify({
      ...s3Command({
        commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
        aggregateId: 'contract-s3-001',
        payload: challengePayload(),
        expectedRevision: 2,
      }),
    });
    const response = composition.server.handleFrame(raw);
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });

  it('fails closed on a legacy composition without the S3 registry', () => {
    const result = createCoreSeamServer({
      expectedPeer: {
        installId: 'install-001',
        userId: 'user-001',
        allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      throw new Error('legacy composition failed');
    }
    const registry = createVerifiedPeerSessionRegistry();
    registry.record(verifiedSession(CONNECTION));
    const response = frame(result.value, registry, {
      ...s3Command({
        commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
        aggregateId: 'contract-s3-001',
        payload: challengePayload(),
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('TRANSPORT_UNAUTHORIZED');
  });
});

describe('#150 CONFIRM_S3_CANDIDATE durable confirmation', () => {
  it('accepts a live attested confirmation over the issued challenge', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('ACCEPTED');
    expect(response.acceptance?.revision).toBe(3);
    // The durable candidate lives in the journaled command payload.
    const commands = composition.journal
      .replayAll()
      .filter((entry) => entry.kind === 'COMMAND' || entry.kind === undefined);
    expect(
      commands.some(
        (entry) => 'envelope' in entry && entry.envelope.commandType === 'CONFIRM_S3_CANDIDATE',
      ),
    ).toBe(true);
  });

  it('rejects a self-minted attestation no Core challenge backs', () => {
    const composition = composeInstalled();
    const forged = confirmPayload({
      challenge: 'b'.repeat(64),
      tupleDigest: s3SelectionTupleDigest({
        contractId: 'contract-s3-001',
        snapshotId: 's3snap-001',
        memberId: 's3member-001',
        variantKey: 'variant-720p',
        selectedLocator: LOCATOR,
        mediaProfileId: 's3-media-mp4-v1',
      }),
      coreRevision: 2,
    });
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: forged,
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects a challenge replayed from a different OS-verified connection', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    // A second live same-user connection is a DIFFERENT transport session:
    // the challenge is bound to the issuing connection, never portable.
    const otherConnection = 'conn-s3-002';
    composition.sessions.record(verifiedSession(otherConnection));
    const raw = JSON.stringify({
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
      }),
    });
    const replay = composition.server.handleFrame(raw, composition.sessions, otherConnection);
    expect(replay.outcome).toBe('REJECTED');
    expect(replay.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    // No candidate was created by the replayed challenge.
    const projection = composition.server.inspectProjection('contract-s3-001');
    expect(projection?.lineage.status).toBe('ACTIVE');
  });

  it('rejects an expired challenge', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    composition.clock.now += 120_001;
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects an attestation binding a different displayed tuple', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    const swapped = confirmPayload(challenge, { variantKey: 'variant-1080p' });
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: swapped,
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('converges on an identical re-confirmation and conflicts on a different tuple', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    const first = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
      }),
    });
    expect(first.outcome).toBe('ACCEPTED');
    // Identical tuple under a fresh challenge converges without a new effect.
    const challenge2 = requestChallenge(composition, challengePayload(), undefined, 3).challenge!;
    const again = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge2),
        expectedRevision: 3,
        requestId: requestId(),
      }),
    });
    expect(again.outcome).toBe('ACCEPTED');
    // A different tuple under the same lineage key is an immutable conflict.
    const challenge3 = requestChallenge(
      composition,
      challengePayload({ variantKey: 'variant-1080p' }),
      undefined,
      3,
    ).challenge!;
    const conflict = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge3, { variantKey: 'variant-1080p' }),
        expectedRevision: 3,
        requestId: requestId(),
      }),
    });
    expect(conflict.outcome).toBe('REJECTED');
    expect(conflict.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('serves only the CLI surface', () => {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
        asPeer: { installId: 'install-001', userId: 'user-001', surface: 'DESKTOP_UI' },
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('requires a 1.2 envelope (1.1 frame cannot confirm)', () => {
    const composition = composeInstalled();
    const raw = {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload({
          challenge: 'c'.repeat(64),
          tupleDigest: 'd'.repeat(64),
          coreRevision: 2,
        }),
        expectedRevision: 2,
      }),
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.1.0' },
    };
    const response = frame(composition.server, composition.sessions, raw);
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');
  });
});

describe('#150 EXECUTE_S3_SELECTED_MEDIA registration and replay', () => {
  function confirmedComposition(): Composition {
    const composition = composeInstalled();
    const challenge = requestChallenge(composition, challengePayload()).challenge!;
    const confirmed = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'CONFIRM_S3_CANDIDATE',
        aggregateId: 'contract-s3-001',
        payload: confirmPayload(challenge),
        expectedRevision: 2,
      }),
    });
    expect(confirmed.outcome).toBe('ACCEPTED');
    return composition;
  }

  it('registers one intent and fires the runtime beginner AFTER the journal commit', () => {
    const composition = confirmedComposition();
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-s3-001',
        payload: { snapshotId: 's3snap-001', memberId: 's3member-001' },
        expectedRevision: 3,
      }),
    });
    expect(response.outcome).toBe('ACCEPTED');
    expect(response.acceptance?.revision).toBe(4);
    expect(composition.begun).toHaveLength(1);
    expect(composition.begun[0]?.candidate.locatorUri).toBe(LOCATOR);
    expect(composition.begun[0]?.candidate.mediaProfileId).toBe('s3-media-mp4-v1');
  });

  it('rejects execution before any confirmed candidate exists', () => {
    const composition = composeInstalled();
    const response = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-s3-001',
        payload: { snapshotId: 's3snap-001', memberId: 's3member-001' },
        expectedRevision: 2,
      }),
    });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects a second distinct execution request (recovery rides the prior intent)', () => {
    const composition = confirmedComposition();
    const first = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-s3-001',
        payload: { snapshotId: 's3snap-001', memberId: 's3member-001' },
        expectedRevision: 3,
      }),
    });
    expect(first.outcome).toBe('ACCEPTED');
    const second = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-s3-001',
        payload: { snapshotId: 's3snap-001', memberId: 's3member-001' },
        expectedRevision: 4,
        requestId: requestId(),
      }),
    });
    expect(second.outcome).toBe('REJECTED');
    expect(second.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    expect(composition.begun).toHaveLength(1);
  });

  it('rebuilds candidates and intents from journal replay without a live session', () => {
    const composition = confirmedComposition();
    const executed = frame(composition.server, composition.sessions, {
      ...s3Command({
        commandType: 'EXECUTE_S3_SELECTED_MEDIA',
        aggregateId: 'contract-s3-001',
        payload: { snapshotId: 's3snap-001', memberId: 's3member-001' },
        expectedRevision: 3,
      }),
    });
    expect(executed.outcome).toBe('ACCEPTED');
    // "Restart": a fresh server over the same journal replays every accepted
    // command (no verified session, no challenge registry) fail-closed clean.
    const reopened = createCoreSeamServer({
      expectedPeer: {
        installId: 'install-001',
        userId: 'user-001',
        allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
      },
      journal: composition.journal,
      s3MediaProfiles: PROFILES_PORT,
      s3SelectedMedia: {
        begin: () => undefined,
      },
    });
    expect(reopened.ok).toBe(true);
    if (reopened.ok !== true) {
      throw new Error('reopened composition failed');
    }
    const pending = reopened.value.pendingS3Executions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.candidate.variantKey).toBe('variant-720p');
    expect(pending[0]?.contract.contractId).toBe('contract-s3-001');
  });
});
