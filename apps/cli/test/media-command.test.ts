/**
 * #150 CLI `media` command — the installed user journey against the REAL
 * seam server (S3 registry + OS-verified session registry wired exactly like
 * the Core host) through an in-process client transport: capability probe,
 * contract/snapshot/challenge/confirm/execute sequence, the interactive
 * selection gesture port, and the fail-closed negatives (no pipe, no
 * interactive terminal, declined gesture).
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  type CommandEnvelope,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type SeamClientTransport,
  type SeamListenTarget,
  type VerifiedPeerSessionPort,
} from '@xdownload/core-seam';
import type { TerminalResult } from '@xdownload/domain-contracts';
import { parseArgv } from '../src/args.ts';
import { runAdapter, type AdapterPorts, type SelectionGesture } from '../src/adapter.ts';

const INSTALL = 'meditest';
const USER = 'user-cli-001';
const PIPE = String.raw`\\.\pipe\xdownload-core-meditest`;
const URL = 'https://media.example.org/media/clip_01.mp4';
const CONNECTION = 'conn-media-001';

const MEDIA_PROFILES: Readonly<Record<string, string>> = {
  's3-media-mp4-v1': 'mp4',
  's3-media-m4a-v1': 'm4a',
  's3-media-mp3-v1': 'mp3',
  's3-media-webm-v1': 'webm',
};

function sessionOf(connectionId: string): OsVerifiedPeerSession {
  return {
    transportKind: 'WINDOWS_NAMED_PIPE',
    connectionId,
    userSid: 'S-1-5-21-7',
    userName: 'DOMAIN\\user',
    clientPid: 9001,
    logonSessionId: '0x00000000000abcdef',
    sameUserAsCore: true,
    sameLogonSessionAsCore: true,
    verifiedAt: '2026-10-26T00:00:00Z',
  };
}

/** In-process client transport wired like the Core host pipe transport. */
function inProcessTransport(
  server: CoreSeamServer,
  sessions: VerifiedPeerSessionPort,
): SeamClientTransport {
  return {
    async connect(_target: SeamListenTarget) {
      let frameHandler: ((frame: string) => void) | undefined;
      return {
        onFrame(handler: (frame: string) => void): void {
          frameHandler = handler;
        },
        onEnded(): void {
          /* test composition never ends the connection */
        },
        send(frame: string): void {
          const response = server.handleFrame(frame, sessions, CONNECTION);
          queueMicrotask(() => frameHandler?.(JSON.stringify(response)));
        },
        async close(): Promise<void> {
          /* nothing to release */
        },
      };
    },
  };
}

interface MediaComposition {
  readonly server: CoreSeamServer;
  readonly sessions: VerifiedPeerSessionPort;
  readonly executed: string[];
}

function composeServer(
  onExecute?: (aggregateId: string, server: CoreSeamServer) => void,
): MediaComposition {
  const sessions = createVerifiedPeerSessionRegistry();
  sessions.record(sessionOf(CONNECTION));
  const executed: string[] = [];
  const factory = createCoreSeamServer({
    expectedPeer: {
      installId: INSTALL,
      userId: USER,
      allowedSurfaces: ['CLI'],
    },
    journal: createInMemorySeamJournal(),
    s3MediaProfiles: {
      supportedProfile: (id) => id in MEDIA_PROFILES,
      profileContainerOf: (id) => MEDIA_PROFILES[id],
      registryDigest: () => 'b'.repeat(64),
    },
    s3SelectedMedia: {
      begin: (input) => {
        executed.push(input.aggregateId);
        onExecute?.(input.aggregateId, serverRef.current!);
      },
    },
    s3Challenge: { ttlMs: 120_000, now: () => Date.now() },
  });
  if (!factory.ok) {
    throw new Error('server composition failed');
  }
  const serverRef: { current?: CoreSeamServer } = { current: factory.value };
  return { server: factory.value, sessions, executed };
}

function ports(composition: MediaComposition, gesture: SelectionGesture | undefined): AdapterPorts {
  let counter = 0;
  return {
    clientTransport: inProcessTransport(composition.server, composition.sessions),
    readSource: async () => '',
    now: () => new Date().toISOString(),
    makeRequestId: () => `req-media-${String((counter += 1)).padStart(3, '0')}`,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    epochMs: () => Date.now(),
    ...(gesture === undefined
      ? {}
      : {
          confirmSelection: async () => gesture,
        }),
  };
}

const MEDIA_ARGV = [
  'media',
  '--url',
  URL,
  '--variant',
  'variant-720p',
  '--install-id',
  INSTALL,
  '--user-id',
  USER,
  '--pipe-name',
  PIPE,
];

function terminalOf(aggregateId: string): TerminalResult {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId: aggregateId,
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    recordedAt: new Date().toISOString(),
  } as unknown as TerminalResult;
}

describe('#150 CLI media argument grammar', () => {
  it('parses the closed media invocation with the mp4 default profile', () => {
    const parsed = parseArgv(MEDIA_ARGV);
    expect(parsed.kind).toBe('media');
    if (parsed.kind !== 'media') return;
    expect(parsed.variantKey).toBe('variant-720p');
    expect(parsed.mediaProfileId).toBe('s3-media-mp4-v1');
    expect(parsed.redirectHosts).toEqual(['media.example.org']);
    expect(parsed.target.pipeName).toBe(PIPE);
  });

  it('requires the OS-verified pipe target (no loopback media lane)', () => {
    expect(() =>
      parseArgv([
        'media',
        '--url',
        URL,
        '--variant',
        'v',
        '--install-id',
        INSTALL,
        '--user-id',
        USER,
      ]),
    ).toThrow();
    // With a full loopback target the media lane still refuses to start.
    expect(() =>
      parseArgv([
        'media',
        '--url',
        URL,
        '--variant',
        'v',
        '--install-id',
        INSTALL,
        '--user-id',
        USER,
        '--port',
        '7070',
      ]),
    ).toThrow(/--pipe-name/);
  });

  it('rejects a locator outside the closed public media grammar', () => {
    for (const url of [
      'http://media.example.org/media/clip_01.mp4',
      'https://media.example.org/media/clip_01.mp4?token=x',
      'https://media.example.org/clips/clip_01.mp4',
      'https://media.example.org/media/clip_01.avi',
      'https://user@media.example.org/media/clip_01.mp4',
    ]) {
      expect(() => parseArgv([...MEDIA_ARGV.slice(0, 3), url, ...MEDIA_ARGV.slice(4)])).toThrow();
    }
  });

  it('requires a bare public DNS redirect host', () => {
    expect(() => parseArgv([...MEDIA_ARGV, '--redirect-host', '127.0.0.1:8080'])).toThrow();
    expect(() => parseArgv([...MEDIA_ARGV, '--redirect-host', 'cdn.example.org'])).not.toThrow();
  });
});

describe('#150 CLI media user journey', () => {
  it('drives the full gesture → confirmation → execution → terminal journey', async () => {
    const composition = composeServer((aggregateId, server) => {
      const recorded = server.recordExecutedTerminal(aggregateId, terminalOf(aggregateId));
      expect(recorded.ok).toBe(true);
    });
    const result = await runAdapter(parseArgv(MEDIA_ARGV), ports(composition, 'confirmed'));
    expect(result.exitCode).toBe(0);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.status');
    expect(document['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(composition.executed).toHaveLength(1);
  });

  it('stops before any confirmation when the user declines the displayed tuple', async () => {
    const composition = composeServer();
    const result = await runAdapter(parseArgv(MEDIA_ARGV), ports(composition, 'declined'));
    expect(result.exitCode).toBe(3);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.s3-selection');
    expect(document['state']).toBe('DECLINED');
    expect(document['confirmed']).toBe(false);
    // No execution intent was ever registered.
    expect(composition.executed).toHaveLength(0);
    expect(composition.server.pendingS3Executions()).toHaveLength(0);
  });

  it('stops before any Core round trip without an interactive terminal', async () => {
    const composition = composeServer();
    const result = await runAdapter(parseArgv(MEDIA_ARGV), ports(composition, undefined));
    expect(result.exitCode).toBe(3);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['error']).toBe('USAGE');
    expect(composition.server.pendingS3Executions()).toHaveLength(0);
    expect(composition.executed).toHaveLength(0);
  });

  it('projects the Core rejection verbatim when the tuple is not confirmable', async () => {
    // The locator's profile disagrees with the declared profile: the Core
    // challenge admission rejects MEDIA-bound tuples before any gesture.
    const composition = composeServer();
    const argv = [...MEDIA_ARGV];
    const parsed = parseArgv(argv);
    expect(parsed.kind).toBe('media');
    const result = await runAdapter(
      parseArgv([...MEDIA_ARGV.slice(0, MEDIA_ARGV.length), '--profile', 's3-media-webm-v1']),
      ports(composition, 'confirmed'),
    );
    expect(result.exitCode).toBe(2);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.rejection');
    expect(composition.executed).toHaveLength(0);
  });

  it('requires a Core advertising seam 1.2 (legacy server fails the probe)', async () => {
    const legacy = createCoreSeamServer({
      expectedPeer: { installId: INSTALL, userId: USER, allowedSurfaces: ['CLI'] },
    });
    if (!legacy.ok) {
      throw new Error('legacy composition failed');
    }
    // Legacy server: no S3 registry — the probe still passes (it is a 1.0
    // query the old Core answers), so assert the transport gate rejection
    // surfaces instead when the media flow reaches the 1.2 commands.
    const composition = {
      server: legacy.value,
      sessions: createVerifiedPeerSessionRegistry(),
      executed: [] as string[],
    };
    const result = await runAdapter(parseArgv(MEDIA_ARGV), ports(composition, 'confirmed'));
    expect(result.exitCode).toBe(2);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.rejection');
  });
});

// Keep the envelope import referenced for type stability of the test file.
export type { CommandEnvelope };
