/**
 * T06 S4 HLS VOD confirmation and K/Host admission tests, V022-A02
 * domain-level rewrite (node:test, colocated).
 *
 * A02 removed every App→Host import: the real end-to-end scenarios (SDK K
 * `load` with the pinned T06 Host bridge driving the existing HLS/FFmpeg
 * engine over a REAL 127.0.0.1 fixture, incl. an ffmpeg-generated TS
 * fixture) relocated to the Core composition root — which already composes
 * the one production single-K route over the kept ABI seam
 * (`acquireS4HlsBridgePin`). This file now proves the DOMAIN-level contract
 * only: the closed explicit rendition-selection intent grammar, the sealed
 * S4 BUILD identity/determinism and the frozen route vocabulary, the
 * single-owner bridge pin registration discipline, the S4 composition
 * contribution seam, and the sealed S4 capability ABI pin.
 *
 * RELOCATE-TO-CORE-A04 — integration scenarios moved from this file (each
 * must be re-established under the Core composition root in A04; no
 * coverage is silently dropped):
 *   1. Unknown S4 target refusal through K/Host (typed
 *      CONTRACT_BINDING_MISMATCH registry refusal, zero media effects,
 *      empty output root).
 *   2. Topology refusals against a live loopback fixture with hit
 *      accounting: unclosed live playlist (MEDIA_TOPOLOGY_UNSUPPORTED),
 *      AES-128 protected media without key/segment requests
 *      (MEDIA_TOPOLOGY_UNSUPPORTED), duplicate variants before any media
 *      playlist fetch (MEDIA_MANIFEST_MALFORMED).
 *   3. Positive materialization: real ffmpeg-generated HLS VOD through
 *      K/Host with byte-for-byte artifact integrity (digest anchor,
 *      segment/playlist hit accounting, permit-bound terminal evidence).
 *   4. Standalone assembly conflict discipline: a second assembly beside a
 *      live runtime is refused (S4_BRIDGE_PIN_CONFLICT) instead of
 *      displacing the live holder's bridge/registry; re-acquire after stop.
 *   5. Single externally-built K composition of the S4 contribution with a
 *      stubbed bridge pin (the one-K splice shape the production Core route
 *      uses, exercised against a typed registry refusal).
 *   (Physical pieces: real Host bridge, K load, permit minting, loopback
 *   HTTP fixture, ffmpeg materialization, restart/cancellation — Task Pack
 *   #341.)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  APP_ID_S4_HLS_VOD,
  BUILD_ID_S4_HLS_VOD,
  S4_HLS_BRIDGE_PIN,
  S4_HLS_ROUTE,
  acquireS4HlsBridgePin,
  s4HlsCompositionContribution,
  s4HlsSealedPassthrough,
  sealS4HlsComposition,
} from './s4-hls-vod.ts';
import {
  S4_HLS_MEDIA_OPERATION,
  S4_HLS_MEDIA_PROFILE,
  s4HlsSelectionTupleDigest,
  validateConfirmedS4HlsIntent,
} from './s4-hls-vod-contract.ts';
import { validateRouteTable } from '../contracts/index.ts';
import {
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
} from '../business/composition.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

interface IntentOptions {
  readonly manifestUri?: string;
  readonly renditionUri?: string;
  readonly targetRef?: string;
  readonly digestAnchor?: string;
}

function confirmedIntent(
  outputRootScope: string,
  options: IntentOptions = {},
): Record<string, unknown> {
  const now = Date.now();
  const tuple = {
    contractId: 'contract-s4-001',
    snapshotId: 'snapshot-s4-001',
    memberId: 'member-s4-001',
    previewId: 'preview-s4-001',
    renditionKey: 'rend-0',
    renditionUri: options.renditionUri ?? 'https://cdn.example.test/vod/720p.m3u8',
    manifestUri: options.manifestUri ?? 'https://cdn.example.test/vod/master.m3u8',
    mediaProfileId: S4_HLS_MEDIA_PROFILE,
    bandwidth: 1_500_000,
    width: 1280,
    height: 720,
  };
  return {
    requestId: 'req-s4-001',
    lineageId: 'lineage-s4-001',
    contractId: tuple.contractId,
    targetRef: options.targetRef ?? 'ref:s4-target-missing',
    outputRootScope,
    allowedOperation: S4_HLS_MEDIA_OPERATION,
    selection: {
      confirmedSelectionId: 'confirmed-s4-001',
      previewId: tuple.previewId,
      snapshotId: tuple.snapshotId,
      memberId: tuple.memberId,
      manifestUri: tuple.manifestUri,
      mediaProfileId: tuple.mediaProfileId,
      renditionKey: tuple.renditionKey,
      renditionUri: tuple.renditionUri,
      displayedTupleDigest: s4HlsSelectionTupleDigest(tuple),
      confirmedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 59_000).toISOString(),
    },
    caller: { actor: 't06-test', sessionRef: 'session-s4-001' },
    ...(options.digestAnchor === undefined ? {} : { digestAnchor: options.digestAnchor }),
  };
}

describe('T06 S4 HLS VOD confirmation and K/Host admission', () => {
  it('accepts only the closed explicit rendition-selection contract', () => {
    const valid = validateConfirmedS4HlsIntent(confirmedIntent('/tmp/xd-s4-a02'));
    assert.equal(valid.ok, true);

    const widened = validateConfirmedS4HlsIntent({
      ...confirmedIntent('/tmp/xd-s4-a02'),
      rawUrl: 'https://cdn.example.test/vod/master.m3u8',
    });
    assert.equal(widened.ok, false);
    if (!widened.ok) assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
  });

  it('rejects future-dated and expired confirmation windows before K send', () => {
    const future = confirmedIntent('/tmp/xd-s4-a02');
    const futureSelection = future.selection as Record<string, unknown>;
    futureSelection.confirmedAt = new Date(Date.now() + 1_000).toISOString();
    futureSelection.expiresAt = new Date(Date.now() + 30_000).toISOString();
    assert.equal(validateConfirmedS4HlsIntent(future).ok, false);

    const expired = confirmedIntent('/tmp/xd-s4-a02');
    const expiredSelection = expired.selection as Record<string, unknown>;
    expiredSelection.confirmedAt = new Date(Date.now() - 61_000).toISOString();
    expiredSelection.expiresAt = new Date(Date.now() - 1_000).toISOString();
    assert.equal(validateConfirmedS4HlsIntent(expired).ok, false);
  });

  it('rejects a duplicate bridge registration without displacing the live holder', () => {
    const first = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error('expected first registration to succeed');

    const second = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => {
        throw new Error('never routed');
      },
    });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error('expected duplicate registration refusal');
    assert.equal(second.code, 'S4_BRIDGE_PIN_CONFLICT');

    // The live holder keeps its authority: the conflicting registration routed nothing.
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], first.lease.bridge);
    first.lease.release();
    first.lease.release();
    assert.equal((globalThis as Record<string, unknown>)[S4_HLS_BRIDGE_PIN], undefined);

    const reacquired = acquireS4HlsBridgePin({
      acquireS4HlsVod: async () => ({
        phase: 'terminal',
        externalRef: 'x',
        outcome: { ok: true, output: {} },
      }),
    });
    assert.equal(reacquired.ok, true);
    if (reacquired.ok) reacquired.lease.release();
  });
});

// ---------------------------------------------------------------------------
// S — sealed S4 composition identity + frozen route vocabulary (no runtime)
// ---------------------------------------------------------------------------

describe('S — sealed S4 HLS VOD composition identity', () => {
  it('seals the T03 K/S bytes at their #183 PoC hashes with the S4 B/C modules', () => {
    const built = sealS4HlsComposition();
    const kernel = built.modules.find((module) => module.role === 'kernel-primary');
    const standard = built.modules.find((module) => module.role === 'standard-primary');
    const business = built.modules.find((module) => module.role === 'business');
    const capability = built.modules.find((module) => module.role === 'capability');
    assert.equal(kernel?.moduleSha256, POC183_KERNEL_MODULE_SHA256);
    assert.equal(standard?.moduleSha256, POC183_STANDARD_MODULE_SHA256);
    assert.equal(business?.packageId, 'business-s4-hls-vod@0.2.1');
    assert.equal(capability?.packageId, 'capability-s4-hls-vod@0.2.1');
    assert.equal(capability?.externalEffect, true);
    assert.equal(capability?.capabilityId, 'media');
    assert.equal(built.appId, APP_ID_S4_HLS_VOD);
    assert.equal(built.buildId, BUILD_ID_S4_HLS_VOD);
    assert.deepEqual(built.routes, [S4_HLS_ROUTE]);
  });

  it('seals deterministically: repeated seals reproduce the identical module hash set', () => {
    const first = sealS4HlsComposition();
    const second = sealS4HlsComposition();
    assert.deepEqual(
      first.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
      second.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
    );
  });

  it('keeps the S4 route inside the frozen T01 media.acquire vocabulary (no widening)', () => {
    assert.equal(S4_HLS_ROUTE.operationId, S4_HLS_MEDIA_OPERATION);
    assert.equal(S4_HLS_MEDIA_OPERATION, 'media.acquire');
    const routeCheck = validateRouteTable(
      [S4_HLS_ROUTE],
      [
        {
          operationId: S4_HLS_MEDIA_OPERATION,
          capabilityId: 'media',
          handlerId: 'acquireS4HlsVod',
          effectClass: 'non-idempotent',
          externalEffect: true,
        },
      ],
    );
    assert.equal(routeCheck.ok, true, 'the S4 route must stay on the frozen vocabulary');
  });

  it('s4HlsCompositionContribution splices byte-identical sealed module inputs', () => {
    const contribution = s4HlsCompositionContribution();
    const sealed = sealS4HlsComposition();
    const sealedBusiness = sealed.modules.find((module) => module.role === 'business');
    const sealedCapability = sealed.modules.find((module) => module.role === 'capability');
    assert.equal(contribution.route, S4_HLS_ROUTE);
    assert.equal(contribution.declarations.length, 1);
    assert.equal(contribution.business.moduleSha256, sealedBusiness?.moduleSha256);
    assert.equal(contribution.capability.moduleSha256, sealedCapability?.moduleSha256);
    // The passthrough projection round-trips a built module losslessly.
    const kernel = sealed.modules.find((module) => module.role === 'kernel-primary');
    assert.ok(kernel);
    const passthrough = s4HlsSealedPassthrough(kernel);
    assert.equal(passthrough.moduleSha256, kernel.moduleSha256);
    assert.equal(passthrough.moduleSource, kernel.moduleSource);
  });
});

// ---------------------------------------------------------------------------
// ABI — the sealed S4 capability module keeps its Host bridge pin seam
// ---------------------------------------------------------------------------

describe('ABI — sealed S4 capability bridge pin seam', () => {
  it('the sealed capability module reaches the S4_HLS_BRIDGE_PIN globalThis seam', () => {
    assert.equal(S4_HLS_BRIDGE_PIN, '__xdownloadS4HlsVodBridge');
    const sealedSource = readFileSync(join(HERE, 's4-hls-vod-capability.mjs'), 'utf8');
    assert.ok(
      sealedSource.includes(`globalThis.${S4_HLS_BRIDGE_PIN}`),
      'the sealed S4 capability module must reach the same pin the Core route installs',
    );
  });
});
