/**
 * T02 cross-surface convergence over the single-K Domain App route: every
 * surface binds through the SAME `bindSurfaceToCore` binder and reaches the
 * ONE Core-owned K through the same seam route. No surface ever holds a K
 * instance of its own; the same job projection renders byte-identically
 * through every bound surface.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { closeCoreRuntime, createCoreRuntime, type CoreRuntime } from '@xdownload/core-runtime';
// The T015/T017 harness owns the loopback seam binding fixture; reuse it
// verbatim (the established cross-package test import).
import { bindLoopbackSeam } from '../../core-runtime/test/helpers.ts';
import { bindSurfaceToCore, renderProjectionBytes, type BoundSurface } from '../src/index.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const EXPECTED_PEER = {
  installId: 'install-t02',
  userId: 'user-t02',
  allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
} as const;

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `req-t02-${prefix}-${String(requestCounter).padStart(4, '0')}`;
}

function composeCoreWithDomainApp(rootDir: string): CoreRuntime {
  return createCoreRuntime({
    rootDir,
    expectedPeer: EXPECTED_PEER as unknown as CoreRuntime['expectedPeer'],
    domainApp: {},
  });
}

function bind(surface: 'CLI' | 'DESKTOP_UI', target: { host: string; port: number }): BoundSurface {
  return bindSurfaceToCore({
    surface,
    installId: EXPECTED_PEER.installId,
    userId: EXPECTED_PEER.userId,
    transport: createLoopbackClientTransport(),
    target,
    makeRequestId: () => nextRequestId(`${surface.toLowerCase()}-auto`),
    now: () => '2026-10-04T01:00:00.000Z',
  });
}

/**
 * A seam-valid confirmed S4 intent whose targetRef is not seeded: the one
 * K's Host bridge refuses it typed (fast, offline), which still exercises
 * the whole route (admission → durable claim → K send → truthful outcome).
 */
function confirmedIntent(lineageId: string, requestId: string): Record<string, unknown> {
  const nowMs = Date.now();
  return {
    requestId,
    lineageId,
    contractId: 'contract-s4-surface-001',
    targetRef: 'ref:s4-surface-unseeded',
    outputRootScope: resolve(join(dirs[dirs.length - 1] ?? '.', 'output')),
    allowedOperation: 'media.acquire',
    selection: {
      confirmedSelectionId: 'confirmed-s4-surface-001',
      previewId: 'preview-s4-surface-001',
      snapshotId: 'snapshot-s4-surface-001',
      memberId: 'member-s4-surface-001',
      manifestUri: 'http://127.0.0.1/master.m3u8',
      mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1',
      renditionKey: 'rend-0',
      renditionUri: 'http://127.0.0.1/media.m3u8',
      displayedTupleDigest: 'a'.repeat(64),
      confirmedAt: new Date(nowMs - 1_000).toISOString(),
      expiresAt: new Date(nowMs + 120_000).toISOString(),
    },
    caller: { actor: 't02-surface', sessionRef: 'session-s4-surface-001' },
  };
}

async function waitForJobStatus(
  surface: BoundSurface,
  lineageId: string,
  wanted: readonly string[],
): Promise<{
  readonly status: string;
  readonly owner?: string;
  readonly error?: { readonly code: string };
}> {
  const deadline = Date.now() + 20_000;
  let last: { status?: string; owner?: string; error?: { code: string } } = {};
  while (Date.now() < deadline) {
    const response = await surface.readJobProjection(lineageId);
    const projection = response.projection as
      { status?: string; owner?: string; error?: { code: string } } | undefined;
    if (projection !== undefined) {
      last = projection;
      if (projection.status !== undefined && wanted.includes(projection.status)) {
        return { status: projection.status, owner: projection.owner, error: projection.error };
      }
    }
    await new Promise((resolvePause) => setTimeout(resolvePause, 25));
  }
  throw new Error(
    `job projection for '${lineageId}' did not reach ${wanted.join('/')} in time; last=${JSON.stringify(last)}`,
  );
}

describe('T02 surfaces share the one K through the seam route', () => {
  it('serves two bound surfaces through the same Core K with byte-identical projections', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 't02-surface-'));
    dirs.push(rootDir);
    const runtime = composeCoreWithDomainApp(rootDir);
    const seam = await bindLoopbackSeam(runtime);
    let cli: BoundSurface | undefined;
    let desktop: BoundSurface | undefined;
    try {
      await runtime.domainApp?.ready;
      expect(runtime.domainApp?.isLoaded()).toBe(true);
      cli = bind('CLI', seam.target);
      desktop = bind('DESKTOP_UI', seam.target);

      // Each surface sends its own v0.2 lineage. The envelope requestId is
      // explicit so it binds to the intent's requestId (the seam's T01
      // binding check).
      const requestIdA = nextRequestId('cli-intent');
      const requestIdB = nextRequestId('ui-intent');
      const sendA = await cli.submitDomainAppIntent({
        lineageId: 'lineage-t02-cli-001',
        intent: confirmedIntent('lineage-t02-cli-001', requestIdA),
        requestId: requestIdA,
      });
      const sendB = await desktop.submitDomainAppIntent({
        lineageId: 'lineage-t02-ui-001',
        intent: confirmedIntent('lineage-t02-ui-001', requestIdB),
        requestId: requestIdB,
      });
      expect(sendA.outcome).toBe('ACCEPTED');
      expect(sendB.outcome).toBe('ACCEPTED');
      expect(sendA.route).toBe('v0.2');
      expect(sendB.route).toBe('v0.2');

      // ONE K served both surfaces: two bridge acquire calls, one runtime,
      // one process-global bridge pin.
      const settledA = await waitForJobStatus(cli, 'lineage-t02-cli-001', ['FAILED']);
      const settledB = await waitForJobStatus(desktop, 'lineage-t02-ui-001', ['FAILED']);
      expect(settledA.owner).toBe('new-k');
      expect(settledB.owner).toBe('new-k');
      expect(settledA.error?.code).toBe('CONTRACT_BINDING_MISMATCH');
      expect(runtime.domainApp?.pin.acquireCalls).toBe(2);
      expect(runtime.domainApp?.pin.registryRefusals).toBe(2);

      // Projection parity: the same lineage read through BOTH surfaces
      // renders the exact same bytes (render, never recompute).
      const viaCli = await cli.readJobProjection('lineage-t02-cli-001');
      const viaDesktop = await desktop.readJobProjection('lineage-t02-cli-001');
      expect(viaCli.outcome).toBe('PROJECTION');
      expect(viaDesktop.outcome).toBe('PROJECTION');
      expect(renderProjectionBytes(viaDesktop.projection)).toBe(
        renderProjectionBytes(viaCli.projection),
      );
    } finally {
      await cli?.close();
      await desktop?.close();
      closeCoreRuntime(runtime);
      await seam.stop();
    }
  });

  it('keeps the legacy canonical command path intact through the binder and fenced both ways', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 't02-surface-legacy-'));
    dirs.push(rootDir);
    const runtime = composeCoreWithDomainApp(rootDir);
    const seam = await bindLoopbackSeam(runtime);
    let surface: BoundSurface | undefined;
    try {
      await runtime.domainApp?.ready;
      surface = bind('CLI', seam.target);
      const contract = {
        schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
        contractId: 'contract-single-001',
        status: 'CONFIRMED',
        intentType: 'SINGLE_RESOURCE',
        requestedTarget: 'target-file-001',
        requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
        continuationScope: { kind: 'NONE' },
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
        automationMode: 'AUTO',
        explorationPermission: 'NONE',
        budgetProfile: {
          discovery: { domain: 'discovery', maxGeneratedRequests: 50 },
          transfer: {
            domain: 'transfer',
            maxBytes: 1_000_000,
            maxSegments: 50,
            maxActiveTransferMs: 3_600_000,
            maxRetryTransferRequests: 5,
          },
          globalSafety: {
            domain: 'global_safety',
            maxTotalGeneratedRequests: 500,
            maxActiveElapsedMs: 7_200_000,
          },
        },
        authorizationContextRef: 'authctx/local-001',
        validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
        stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
        resultPolicy: { requireMultidimensionalResult: true },
        confirmedAt: '2026-10-04T00:00:00Z',
      };
      const response = await surface.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: contract,
        expectedRevision: 0,
        requestId: nextRequestId('legacy'),
      });
      expect(response.outcome).toBe('ACCEPTED');
      const projection = await surface.readProjection('contract-single-001');
      expect(projection.outcome).toBe('PROJECTION');

      // The legacy-owned lineage fences the v0.2 route.
      const requestId = nextRequestId('conflict');
      const conflict = await surface.submitDomainAppIntent({
        lineageId: 'contract-single-001',
        intent: confirmedIntent('contract-single-001', requestId),
        requestId,
      });
      expect(conflict.outcome).toBe('REJECTED');
      expect(conflict.route).toBe('v0.2');
      expect(conflict.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_CONFLICT');

      // The legacy job projection route serves the old-core lineage truth.
      const legacyJob = await surface.readJobProjection('contract-single-001');
      expect(legacyJob.outcome).toBe('PROJECTION');
      const legacyView = legacyJob.projection as { owner?: string; status?: string };
      expect(legacyView.owner).toBe('old-core');
      expect(legacyView.status).toBe('RUNNING');
    } finally {
      await surface?.close();
      closeCoreRuntime(runtime);
      await seam.stop();
    }
  });
});
