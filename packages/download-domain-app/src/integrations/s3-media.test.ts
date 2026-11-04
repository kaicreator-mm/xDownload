/**
 * v0.2 T12 — S3 media acquisition tests, V022-A02 domain-level rewrite
 * (node:test, colocated).
 *
 * A02 removed every App→Host import: the real end-to-end scenarios (sealed
 * MEDIA composition loaded through the SDK public `load`, the pinned T06
 * media bridge seam, the EXISTING @xdownload/hls-vod-adapter engine and a
 * REAL bounded HLS fixture served by node:http on an ephemeral 127.0.0.1
 * port) relocated to the Core composition root. This file now proves the
 * DOMAIN-level contract only: sealed media BUILD identity/determinism, the
 * frozen route/operation vocabulary, the media targetRef registry grammar
 * (now over A01's neutral @xdownload/domain-contracts `isRawLocatorShape`),
 * and the sealed media capability ABI seam.
 *
 * RELOCATE-TO-CORE-A04 — integration scenarios moved from this file (each
 * must be re-established under the Core composition root in A04; no
 * coverage is silently dropped):
 *   1. S3 positive journey: master→playlist→segments through the real HLS
 *      engine under one K permit, digest-backed materialization evidence,
 *      exactly one durable permit, fixture hit accounting (1 master + 1
 *      playlist + 3 segments, no more), pin counters
 *      (acquireMediaCalls/completedExecutions/permitRefusals).
 *   2. Pre-send refusal with zero effects: foreign allowedOperation
 *      (MEDIA_OPERATION_MISMATCH), foreign slice (MEDIA_SLICE_MISMATCH),
 *      widened intent (MEDIA_INTENT_INVALID + SCOPE_WIDENING_REFUSED),
 *      missing sealed profile fields (MEDIA_PROFILE_BINDING_INCOMPLETE) —
 *      each proven against the physical fixture, the pin counters and the
 *      durable K store.
 *   3. Admitted-dispatch truthful failures with zero network: unknown
 *      targetRef (CONTRACT_BINDING_MISMATCH), sealed B profile bound
 *      refusal (declaredBytes over the 1 MiB application guard,
 *      EFFECT_ENVELOPE_MISSING with no dispatch and no permit).
 *   4. Digest-anchor enforcement behind engine acceptance
 *      (MEDIA_DIGEST_MISMATCH; the tampered run must not overwrite the
 *      earlier completed artifact).
 *   (Physical pieces: real Host bridge, K load, permit minting, loopback
 *   HTTP fixture, materialization, pin counters — Task Pack #341.)
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
import {
  InMemoryMediaTargetRegistry,
  MEDIA_REGISTRY_PROTOCOLS,
  validateMediaTargetRecord,
} from './media-registry.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function budgetFixture(): Record<string, unknown> {
  return {
    discovery: { domain: 'discovery', maxGeneratedRequests: 100 },
    transfer: {
      domain: 'transfer',
      maxBytes: 16_000_000,
      maxSegments: 16,
      maxRetryTransferRequests: 8,
    },
    globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 1000 },
  };
}

function validRecord(): Record<string, unknown> {
  return {
    protocol: 'HLS',
    manifestUri: 'https://cdn.example.test/master.m3u8',
    allowedManifestOrigins: ['https://cdn.example.test'],
    allowedSegmentOrigins: ['https://cdn.example.test'],
    budget: budgetFixture(),
  };
}

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
// Registry grammar — exact-key no-widening record + opaque handle rules
// ---------------------------------------------------------------------------

describe('S3-domain — media targetRef registry grammar (pure, no I/O)', () => {
  it('accepts a well-formed record and freezes it', () => {
    const checked = validateMediaTargetRecord(validRecord());
    assert.equal(checked.ok, true);
    if (checked.ok) {
      assert.equal(checked.value.protocol, 'HLS');
      assert.deepEqual([...MEDIA_REGISTRY_PROTOCOLS], ['HLS']);
    }
  });

  it('refuses an unknown record field with SCOPE_WIDENING_REFUSED', () => {
    const checked = validateMediaTargetRecord({ ...validRecord(), extraField: 'nope' });
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.equal(checked.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
  });

  it('refuses a non-HLS protocol declaration', () => {
    const checked = validateMediaTargetRecord({ ...validRecord(), protocol: 'DASH' });
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.equal(checked.diagnostics[0]?.code, 'UNKNOWN_ENUM_VALUE');
  });

  it('refuses a malformed canonical budget profile', () => {
    const checked = validateMediaTargetRecord({ ...validRecord(), budget: { nope: true } });
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.equal(checked.diagnostics[0]?.code, 'MALFORMED_REQUIRED_FIELD');
  });

  it('registry: locator-shaped handles refuse; opaque handles resolve; unknown handles refuse', () => {
    const registry = new InMemoryMediaTargetRegistry([
      { handle: 'ref:media/master', record: validRecord() },
    ]);
    // A01 neutral grammar: a raw URL/path can never enter or pass through.
    // URL-shaped handles pass the token grammar, so the explicit
    // raw-locator negative assertion is what refuses them.
    const locator = registry.register('https://evil.example/master.m3u8', validRecord());
    assert.equal(locator.ok, false);
    if (!locator.ok) assert.equal(locator.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
    // Absolute-path and drive-letter shapes violate the bounded token
    // grammar first (the registry checks the grammar before the locator
    // negative); either way they are refused, never resolved.
    for (const shaped of ['/etc/passwd', 'C:\\Windows\\file.m3u8']) {
      const refused = registry.register(shaped, validRecord());
      assert.equal(refused.ok, false);
    }
    // Resolution applies the locator negative to anything locator-shaped.
    const resolvedLocator = registry.resolve('https://evil.example/master.m3u8');
    assert.equal(resolvedLocator.ok, false);
    if (!resolvedLocator.ok) {
      assert.equal(resolvedLocator.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
    }
    const resolved = registry.resolve('ref:media/master');
    assert.equal(resolved.ok, true);
    const ghost = registry.resolve('ref:media/ghost');
    assert.equal(ghost.ok, false);
    if (!ghost.ok) assert.equal(ghost.diagnostics[0]?.code, 'CONTRACT_BINDING_MISMATCH');
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
      'the sealed media capability module must reach the same pin the transitional contract names',
    );
  });
});
