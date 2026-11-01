/**
 * T02-R1 (#287) packaged Core host — Domain App route wiring acceptance.
 *
 * The packaged composition (startCoreHost) must pass the frozen T02
 * `domainApp` option on BOTH the create and the reopen branch, so a real
 * seam client over the loopback transport observes:
 *
 * - `DOMAIN_APP_SEND` on the explicit v0.2 route reaches the ONE K
 *   composition: the seam's own T01 pipeline validates the confirmed intent
 *   (`V02_INTENT_VALIDATOR_UNAVAILABLE` is gone) and the route admits the
 *   send (ACCEPTED); the drive outcome then lands in the durable route log
 *   and surfaces through `READ_JOB_PROJECTION` (an unseeded targetRef
 *   settles as the K's own typed `CONTRACT_BINDING_MISMATCH` refusal —
 *   truthful, never a fabricated success);
 * - `READ_JOB_PROJECTION` serves the real job projection (`owner: new-k`)
 *   for a claimed lineage, and the truthful typed refusal for an unknown
 *   lineage — never the uninstalled-provider stub;
 * - after a clean shutdown and a REOPEN over the same durable root (the
 *   installed restart path), the lineage owner and its settled outcome
 *   survive: the reopen branch carried the same domainApp option.
 *
 * Cross-platform: loopback TCP seam only (no win32 pipe dependency).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLoopbackClientTransport, currentSeamSchemaIdentity } from '@xdownload/core-seam';
import { startCoreHost, type CoreHostOptions } from '../core-host.ts';

const INSTALL_ID = 'test-install-v02';
const USER_ID = 'test-user-v02';
const PEER = { installId: INSTALL_ID, userId: USER_ID, surface: 'CLI' } as const;
const LINEAGE_ID = 'lineage-host-v02-001';

interface SeamFrameResponse {
  readonly outcome?: string;
  readonly route?: string;
  readonly acceptance?: { readonly converged?: boolean };
  readonly projection?: {
    readonly owner?: string;
    readonly status?: string;
    readonly error?: { readonly code?: string };
  };
  readonly diagnostics?: readonly { readonly code?: string }[];
}

/** One request/response round trip over a fresh loopback client connection. */
async function roundTrip(
  host: { readonly host: string; readonly port: number },
  frame: Record<string, unknown>,
): Promise<SeamFrameResponse> {
  const transport = createLoopbackClientTransport();
  const connection = await transport.connect({ host: host.host, port: host.port });
  try {
    return await new Promise<SeamFrameResponse>((resolve, reject) => {
      connection.onFrame((raw) => resolve(JSON.parse(raw) as SeamFrameResponse));
      connection.onEnded(() => reject(new Error('connection ended before response')));
      connection.send(JSON.stringify(frame));
    });
  } finally {
    await connection.close();
  }
}

function v02SendFrame(requestId: string, intent: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: PEER,
    requestId,
    aggregateId: LINEAGE_ID,
    issuedAt: new Date().toISOString(),
    payload: { intent },
  };
}

function v02JobQueryFrame(requestId: string, lineageId: string): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    route: 'v0.2',
    queryType: 'READ_JOB_PROJECTION',
    peer: PEER,
    requestId,
    aggregateId: lineageId,
    issuedAt: new Date().toISOString(),
  };
}

/** One confirmed S4 HLS intent that passes the seam's exact-key validation. */
function confirmedIntent(outputRootScope: string, requestId: string): Record<string, unknown> {
  const now = Date.now();
  return {
    requestId,
    lineageId: LINEAGE_ID,
    contractId: 'contract-host-v02-001',
    targetRef: 'ref:host-v02-unseeded',
    outputRootScope,
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'confirmed-host-v02-001',
      previewId: 'preview-host-v02-001',
      snapshotId: 'snapshot-host-v02-001',
      memberId: 'member-host-v02-001',
      manifestUri: 'https://media.example.com/vod/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
      renditionKey: 'rend-0',
      renditionUri: 'https://media.example.com/vod/media.m3u8',
      displayedTupleDigest:
        '0da7cf3f8e1a4f3e9b2c5d6a7f8e9d0c1b2a3948576f5e4d3c2b1a0968574736',
      confirmedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 120_000).toISOString(),
    },
    caller: { actor: 'core-host-test', sessionRef: 'session-host-v02-001' },
  };
}

async function waitForTerminalProjection(
  host: { readonly host: string; readonly port: number },
  lineageId: string,
  timeoutMs = 20_000,
): Promise<SeamFrameResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: SeamFrameResponse | undefined;
  while (Date.now() < deadline) {
    const response = await roundTrip(host, v02JobQueryFrame(`req-proj-${String(Date.now())}`, lineageId));
    last = response;
    const status = response.projection?.status;
    if (response.outcome === 'PROJECTION' && (status === 'SUCCEEDED' || status === 'FAILED')) {
      return response;
    }
    await new Promise((pause) => setTimeout(pause, 25));
  }
  throw new Error(`projection for '${lineageId}' did not settle; last=${JSON.stringify(last)}`);
}

describe('core-host Domain App route (#287 packaged wiring)', () => {
  const cleanup: string[] = [];
  afterAll(() => {
    for (const dir of cleanup.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function hostOptions(rootDir: string): CoreHostOptions {
    return { rootDir, installId: INSTALL_ID, userId: USER_ID, host: '127.0.0.1', port: 0 };
  }

  it('routes v0.2 submit to the one K and serves the real projection, on create and reopen', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xhost-v02-'));
    cleanup.push(dataRoot);
    const outputRoot = path.join(dataRoot, 'output');

    // ---- create branch: the packaged composition exposes the v0.2 route.
    const host = await startCoreHost(hostOptions(dataRoot));
    try {
      const send = await roundTrip(host, v02SendFrame('req-host-v02-001', confirmedIntent(outputRoot, 'req-host-v02-001')));
      // T01 validation passed (never V02_INTENT_VALIDATOR_UNAVAILABLE) and
      // the route admitted the send into the one K.
      expect(send.outcome).toBe('ACCEPTED');
      expect(send.route).toBe('v0.2');
      const refusalCodes = (send.diagnostics ?? []).map((entry) => entry.code);
      expect(refusalCodes).not.toContain('V02_INTENT_VALIDATOR_UNAVAILABLE');

      // The truthful drive outcome: the trusted registry has no seed for the
      // targetRef, so the K's own typed refusal settles durably.
      const projection = await waitForTerminalProjection(host, LINEAGE_ID);
      expect(projection.outcome).toBe('PROJECTION');
      expect(projection.projection?.owner).toBe('new-k');
      expect(projection.projection?.status).toBe('FAILED');
      expect(projection.projection?.error?.code).toBe('CONTRACT_BINDING_MISMATCH');

      // An unclaimed lineage is the truthful typed refusal of the INSTALLED
      // projection provider — not the uninstalled-provider stub.
      const unknown = await roundTrip(host, v02JobQueryFrame('req-host-v02-unknown', 'lineage-never-claimed'));
      expect(unknown.outcome).toBe('REJECTED');
      expect(unknown.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_UNAVAILABLE');
    } finally {
      await host.shutdown();
    }

    // ---- reopen branch: the installed restart path must carry the route.
    const reopened = await startCoreHost(hostOptions(dataRoot));
    try {
      // The durable route facts survive: owner new-k, settled FAILED outcome.
      const projection = await roundTrip(reopened, v02JobQueryFrame('req-host-v02-reopen', LINEAGE_ID));
      expect(projection.outcome).toBe('PROJECTION');
      expect(projection.projection?.owner).toBe('new-k');
      expect(projection.projection?.status).toBe('FAILED');
      expect(projection.projection?.error?.code).toBe('CONTRACT_BINDING_MISMATCH');

      // The route keeps admitting fresh v0.2 sends after reopen (sequence 2).
      const resend = await roundTrip(
        reopened,
        v02SendFrame('req-host-v02-002', confirmedIntent(outputRoot, 'req-host-v02-002')),
      );
      expect(resend.outcome).toBe('ACCEPTED');
      const settled = await waitForTerminalProjection(reopened, LINEAGE_ID);
      expect(settled.projection?.status).toBe('FAILED');
    } finally {
      await reopened.shutdown();
    }
  }, 60_000);
});
