/**
 * #153 CLI `hls` command — the installed S4 user journey against the REAL
 * seam server authority (S4 drivers + OS-verified session registry wired
 * exactly like the Core host) through an in-process client transport:
 * capability probe, contract/snapshot freeze, Core-journalled preview with
 * Core-observed variants, explicit interactive rendition choice, private
 * BEGIN challenge, YES/NO confirmation, COMMIT, EXECUTE and the bounded
 * terminal wait, plus the fail-closed negatives (no pipe, no interactive
 * terminal, declined gesture, unknown preselected rendition, truthful
 * preview refusal, legacy Core).
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createVerifiedPeerSessionRegistry,
  type CoreSeamServer,
  type OsVerifiedPeerSession,
  type SeamClientTransport,
  type SeamListenTarget,
  type VerifiedPeerSessionPort,
} from '@xdownload/core-seam';
import type { TerminalResult } from '@xdownload/domain-contracts';
import { parseArgv } from '../src/args.ts';
import {
  runAdapter,
  type AdapterPorts,
  type RenditionSelection,
  type SelectionGesture,
} from '../src/adapter.ts';

const INSTALL = 'hlstest';
const USER = 'user-cli-001';
const PIPE = String.raw`\\.\pipe\xdownload-core-hlstest`;
const MANIFEST = 'https://cdn.example.org/vod/master.m3u8';
const RENDITION_A = 'https://cdn.example.org/vod/rend-360p.m3u8';
const RENDITION_B = 'https://cdn.example.org/vod/rend-720p.m3u8';
const CONNECTION = 'conn-hls-001';

function sessionOf(connectionId: string): OsVerifiedPeerSession {
  return {
    transportKind: 'WINDOWS_NAMED_PIPE',
    connectionId,
    userSid: 'S-1-5-21-7',
    userName: 'DOMAIN\\user',
    clientPid: 9101,
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

interface HlsComposition {
  readonly server: CoreSeamServer;
  readonly sessions: VerifiedPeerSessionPort;
  readonly executed: string[];
  readonly previewMode: 'two-variants' | 'unreachable';
}

function composeServer(
  previewMode: HlsComposition['previewMode'] = 'two-variants',
): HlsComposition {
  const sessions = createVerifiedPeerSessionRegistry();
  sessions.record(sessionOf(CONNECTION));
  const executed: string[] = [];
  const serverRef: { current?: CoreSeamServer } = {};
  const factory = createCoreSeamServer({
    expectedPeer: {
      installId: INSTALL,
      userId: USER,
      allowedSurfaces: ['CLI'],
    },
    journal: createInMemorySeamJournal(),
    s4Challenge: { ttlMs: 120_000, now: () => Date.now() },
    s4Preview: {
      begin: (input) => {
        const seam = serverRef.current;
        if (seam === undefined) return;
        if (previewMode === 'unreachable') {
          seam.recordS4PreviewResult(input.aggregateId, {
            ...input.preview,
            status: 'FAILED',
            failureReason: 'MANIFEST_UNREACHABLE',
          });
          return;
        }
        seam.recordS4PreviewResult(input.aggregateId, {
          ...input.preview,
          status: 'AVAILABLE',
          variants: [
            {
              key: 'rend-0',
              uri: RENDITION_A,
              bandwidth: 800_000,
              codecs: 'avc1.42e01e,mp4a.40.2',
              width: 640,
              height: 360,
            },
            { key: 'rend-1', uri: RENDITION_B, bandwidth: 2_000_000 },
          ],
        });
      },
    },
    s4SelectedHls: {
      begin: (input) => {
        executed.push(input.selection.renditionKey);
        const seam = serverRef.current;
        if (seam === undefined) return;
        const recorded = seam.recordExecutedTerminal(
          input.aggregateId,
          terminalOf(input.aggregateId),
        );
        expect(recorded.ok).toBe(true);
      },
    },
  });
  if (!factory.ok) {
    throw new Error('server composition failed');
  }
  serverRef.current = factory.value;
  return { server: factory.value, sessions, executed, previewMode };
}

function ports(
  composition: HlsComposition,
  selection: RenditionSelection | undefined,
  gesture: SelectionGesture | undefined,
): AdapterPorts {
  let counter = 0;
  return {
    clientTransport: inProcessTransport(composition.server, composition.sessions),
    readSource: async () => '',
    now: () => new Date().toISOString(),
    makeRequestId: () => `req-hls-${String((counter += 1)).padStart(3, '0')}`,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    epochMs: () => Date.now(),
    ...(selection === undefined ? {} : { selectRendition: async () => selection }),
    ...(gesture === undefined ? {} : { confirmSelection: async () => gesture }),
  };
}

const HLS_ARGV = [
  'hls',
  '--manifest',
  MANIFEST,
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

describe('#153 CLI hls argument grammar', () => {
  it('parses the closed hls invocation', () => {
    const parsed = parseArgv(HLS_ARGV);
    expect(parsed.kind).toBe('hls');
    if (parsed.kind !== 'hls') return;
    expect(parsed.manifestUri).toBe(MANIFEST);
    expect(parsed.renditionKey).toBeUndefined();
    expect(parsed.target.pipeName).toBe(PIPE);
  });

  it('requires the OS-verified pipe target (no loopback hls lane)', () => {
    expect(() =>
      parseArgv(['hls', '--manifest', MANIFEST, '--install-id', INSTALL, '--user-id', USER]),
    ).toThrow();
    expect(() =>
      parseArgv([
        'hls',
        '--manifest',
        MANIFEST,
        '--install-id',
        INSTALL,
        '--user-id',
        USER,
        '--port',
        '7070',
      ]),
    ).toThrow(/--pipe-name/);
  });

  it('rejects a manifest outside the closed public HLS grammar', () => {
    for (const url of [
      'http://cdn.example.org/vod/master.m3u8',
      'https://cdn.example.org/vod/master.m3u8?token=x',
      'https://cdn.example.org/vod/master.m3u8#frag',
      'https://user@cdn.example.org/vod/master.m3u8',
      'https://cdn.example.org:8443/vod/master.m3u8',
      'https://cdn.example.org/vod/master.mp4',
      'https://localhost/vod/master.m3u8',
    ]) {
      expect(() => parseArgv([...HLS_ARGV.slice(0, 2), url, ...HLS_ARGV.slice(3)])).toThrow();
    }
  });
});

describe('#153 CLI hls user journey', () => {
  it('drives preview → rendition choice → confirmation → execution → terminal', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'confirmed', renditionKey: '1' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(0);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.status');
    expect(document['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(composition.executed).toEqual(['rend-1']);
  });

  it('accepts an explicit --rendition preselection with the same YES/NO gesture', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv([...HLS_ARGV, '--rendition', 'rend-0']),
      ports(composition, { choice: 'confirmed', renditionKey: '0' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(0);
    expect(composition.executed).toEqual(['rend-0']);
  });

  it('stops before any confirmation when the user declines the rendition choice', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'declined' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(3);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['state']).toBe('DECLINED');
    expect(composition.executed).toHaveLength(0);
    expect(composition.server.pendingS4Executions()).toHaveLength(0);
  });

  it('stops before any confirmation when the user declines the displayed tuple', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'confirmed', renditionKey: '0' }, 'declined'),
    );
    expect(result.exitCode).toBe(3);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.s4-selection');
    expect(document['state']).toBe('DECLINED');
    expect(document['confirmed']).toBe(false);
    expect(composition.executed).toHaveLength(0);
    expect(composition.server.pendingS4Executions()).toHaveLength(0);
  });

  it('stops before any Core round trip without an interactive terminal', async () => {
    const composition = composeServer();
    const result = await runAdapter(parseArgv(HLS_ARGV), ports(composition, undefined, undefined));
    expect(result.exitCode).toBe(3);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['error']).toBe('USAGE');
    expect(composition.server.pendingS4Executions()).toHaveLength(0);
    expect(composition.executed).toHaveLength(0);
  });

  it('stops on an interactive choice that names no Core-observed variant', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'confirmed', renditionKey: 'rend-9' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(3);
    expect(composition.executed).toHaveLength(0);
  });

  it('rejects an explicit --rendition that the preview did not observe', async () => {
    const composition = composeServer();
    const result = await runAdapter(
      parseArgv([...HLS_ARGV, '--rendition', 'rend-7']),
      ports(composition, { choice: 'confirmed', renditionKey: '0' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(1);
    expect(composition.executed).toHaveLength(0);
  });

  it('projects the truthful preview refusal without any selection', async () => {
    const composition = composeServer('unreachable');
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'confirmed', renditionKey: '0' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(2);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.rejection');
    expect(composition.executed).toHaveLength(0);
  });

  it('requires a Core advertising seam 1.2 with the S4 drivers installed', async () => {
    const legacy = createCoreSeamServer({
      expectedPeer: { installId: INSTALL, userId: USER, allowedSurfaces: ['CLI'] },
    });
    if (!legacy.ok) {
      throw new Error('legacy composition failed');
    }
    const composition = {
      server: legacy.value,
      sessions: createVerifiedPeerSessionRegistry(),
      executed: [] as string[],
      previewMode: 'two-variants' as const,
    };
    const result = await runAdapter(
      parseArgv(HLS_ARGV),
      ports(composition, { choice: 'confirmed', renditionKey: '0' }, 'confirmed'),
    );
    expect(result.exitCode).toBe(2);
    const document = JSON.parse(result.document) as Record<string, unknown>;
    expect(document['document']).toBe('xdownload.cli.rejection');
  });
});
