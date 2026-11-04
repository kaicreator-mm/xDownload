/**
 * v0.2 T12 — S3 media acquisition domain-level tests, V022-A04 edition
 * (node:test, colocated).
 *
 * The App is domain-only after A04: this file proves the sealed media BUILD
 * identity/determinism, the frozen route/operation vocabulary and the
 * sealed media capability ABI seam. The real end-to-end scenarios (SDK K
 * `load` with the pinned T06 media bridge seam, the EXISTING
 * @xdownload/hls-vod-adapter engine and a REAL bounded HLS fixture served
 * by node:http on an ephemeral 127.0.0.1 port) relocated to the Core
 * composition root and are re-established under
 * packages/core-runtime/test/domain-app-media-flow.test.ts (A04; R2-scoped
 * as component-level evidence — the generic media route cannot compose into
 * the production S4 one-K; exact SDK limitation with probe transcripts on
 * kaicreator-mm/xDownload#357). The media
 * targetRef registry grammar moved to the trusted Host
 * (packages/download-domain-host/src/media/media-target-registry.test.ts);
 * its Host-owned grammar tests live there. No coverage is silently dropped.
 *
 * RELOCATED-TO-CORE-A04 — integration scenario map (re-established under
 * the Core composition root as COMPONENT-LEVEL evidence, not the one-K
 * integration proof; physical pieces: real Host bridge, K load,
 * permit minting, loopback HTTP fixture, materialization, pin counters):
 *   1. S3 positive journey: master→playlist→segments through the real HLS
 *      engine under one K permit, digest-backed materialization evidence,
 *      exactly one durable permit, fixture hit accounting.
 *   2. Pre-send refusal with zero effects: foreign allowedOperation
 *      (MEDIA_OPERATION_MISMATCH), foreign slice (MEDIA_SLICE_MISMATCH),
 *      widened intent (MEDIA_INTENT_INVALID + SCOPE_WIDENING_REFUSED),
 *      missing sealed profile fields (MEDIA_PROFILE_BINDING_INCOMPLETE).
 *   3. Admitted-dispatch truthful failures with zero network: unknown
 *      targetRef (CONTRACT_BINDING_MISMATCH), sealed B profile bound
 *      refusal (declaredBytes over the 1 MiB application guard).
 *   4. Digest-anchor enforcement behind engine acceptance
 *      (MEDIA_DIGEST_MISMATCH; the tampered run must not overwrite the
 *      earlier completed artifact).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
} from '../business/composition.ts';
import { validateRouteTable } from '../contracts/index.ts';
import {
  MEDIA_ACQUIRE_OPERATION,
  MEDIA_BUSINESS_MODULE_ID,
  MEDIA_CAPABILITY_MODULE_ID,
  MEDIA_BRIDGE_PIN,
  MEDIA_ROUTE,
  MEDIA_SLICE,
  sealMediaComposition,
} from './s3-media.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// S3 — sealed media composition identity (cheap, no runtime)
// ---------------------------------------------------------------------------

describe('S3 — sealed media composition identity', () => {
  it('seals the T03 K/S bytes at their #183 PoC hashes with THIS lane as the media B/C', () => {
    const { built, routes } = sealMediaComposition();
    const kernel = built.modules.find((module) => module.role === 'kernel-primary');
    const standard = built.modules.find((module) => module.role === 'standard-primary');
    const business = built.modules.find((module) => module.role === 'business');
    const capability = built.modules.find((module) => module.role === 'capability');
    assert.equal(kernel?.moduleSha256, POC183_KERNEL_MODULE_SHA256);
    assert.equal(standard?.moduleSha256, POC183_STANDARD_MODULE_SHA256);
    assert.equal(business?.packageId, MEDIA_BUSINESS_MODULE_ID);
    assert.equal(capability?.packageId, MEDIA_CAPABILITY_MODULE_ID);
    assert.equal(capability?.externalEffect, true);
    assert.equal(capability?.capabilityId, 'media');
    assert.deepEqual(capability?.handlers, [
      { operationId: 'media.acquire', handler: 'acquireMedia' },
    ]);
    assert.deepEqual(routes, [MEDIA_ROUTE]);
    assert.deepEqual(built.routes, [MEDIA_ROUTE]);
  });

  it('seals deterministically: repeated seals reproduce the identical module hash set', () => {
    const first = sealMediaComposition().built;
    const second = sealMediaComposition().built;
    assert.deepEqual(
      first.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
      second.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
    );
  });

  it('keeps the route inside the frozen T01 media vocabulary (no widening)', () => {
    assert.equal(MEDIA_ACQUIRE_OPERATION, 'media.acquire');
    assert.equal(MEDIA_SLICE, 'S3');
    const routeCheck = validateRouteTable(
      [MEDIA_ROUTE],
      [
        {
          operationId: MEDIA_ACQUIRE_OPERATION,
          capabilityId: 'media',
          handlerId: 'acquireMedia',
          effectClass: 'non-idempotent',
          externalEffect: true,
        },
      ],
    );
    assert.equal(routeCheck.ok, true, 'the media route must stay on the frozen vocabulary');
  });
});

// ---------------------------------------------------------------------------
// ABI — the sealed media capability module keeps its Host bridge pin seam
// ---------------------------------------------------------------------------

describe('ABI — sealed media capability bridge pin seam', () => {
  it('the sealed capability module reaches the MEDIA_BRIDGE_PIN globalThis seam', () => {
    assert.equal(MEDIA_BRIDGE_PIN, '__xdownloadMediaAcquisitionBridge');
    const sealedSource = readFileSync(join(HERE, 'capability-media-acquire.mjs'), 'utf8');
    assert.ok(
      sealedSource.includes(`globalThis.${MEDIA_BRIDGE_PIN}`),
      'the sealed media capability module must reach the same pin the Core-side installer names',
    );
  });
});
