/**
 * v0.2 T11 — direct-lane composition matrix, V022-A02 domain-level rewrite
 * (node:test, Node24).
 *
 * A02 removed every App→Host import: the real end-to-end runtime scenarios
 * that used to live here (sealed BUILD loaded through the SDK public `load`,
 * the pinned T04 DirectAcquisitionBridge, the EXISTING DirectHttpAdapter and
 * a REAL 127.0.0.1 node:http fixture) relocated to the Core composition
 * root. This file now proves the DOMAIN-level contract only: sealed BUILD
 * identity/determinism, the T01 no-widening gate, the sealed capability ABI
 * seam, and the honest transitional assembly sentinel.
 *
 * RELOCATE-TO-CORE-A04 — integration scenarios moved from this file (each
 * must be re-established under the Core composition root in A04; no
 * coverage is silently dropped):
 *   1. P1 real journey: intent → K permit → T04 bridge → DirectHttpAdapter
 *      → digest-backed file (real bytes, truthful terminal
 *      query/subscription, single-triple evidence).
 *   2. P2 exactly one K permit / one journal row; replay adds none.
 *   3. N1 duplicate messageId idempotency with zero second effects.
 *   4. N2 mid-flight abort: caller AbortSignal propagation, no file, honest
 *      non-completion, explicit re-send under a fresh identity.
 *   5. N3 restart: durable store survives stop/reopen; replay idempotent.
 *   6. N4 digest mismatch: no file materialized, truthful failed journey.
 *   7. N5 T01 gate before send: widened intent / raw-locator targetRef
 *      refused with zero effects (bridge counters + fixture socket + durable
 *      store triple evidence).
 *   (Physical pieces each scenario needs: real Host bridge, K load, permit
 *   minting, 127.0.0.1 network fixture, materialization, restart,
 *   cancellation — all enumerated in Task Pack #341 "Test ownership".)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ACQUISITION_ROUTE,
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
} from '../business/composition.ts';
import { validateConfirmedIntent } from '../contracts/index.ts';
import {
  APP_ID_DIRECT,
  BUILD_ID_DIRECT,
  DIRECT_BRIDGE_PIN,
  DIRECT_CAPABILITY_MODULE_ID,
  assembleDownloadRuntime,
  sealDirectComposition,
} from './runtime.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// S — sealed direct composition identity (cheap, no runtime)
// ---------------------------------------------------------------------------

describe('S — sealed direct composition identity', () => {
  it('seals the T03 K/S bytes at their #183 PoC hashes with THIS lane as the capability', () => {
    const { built, routes } = sealDirectComposition();
    const kernel = built.modules.find((module) => module.role === 'kernel-primary');
    const standard = built.modules.find((module) => module.role === 'standard-primary');
    const capability = built.modules.find((module) => module.role === 'capability');
    assert.equal(kernel?.moduleSha256, POC183_KERNEL_MODULE_SHA256);
    assert.equal(standard?.moduleSha256, POC183_STANDARD_MODULE_SHA256);
    assert.equal(capability?.packageId, DIRECT_CAPABILITY_MODULE_ID);
    assert.equal(capability?.externalEffect, true);
    assert.equal(capability?.capabilityId, 'acquisition');
    assert.deepEqual(capability?.handlers, [
      { operationId: 'acquisition.acquire', handler: 'acquire' },
    ]);
    // The route is the T03 declaration, unchanged.
    assert.deepEqual(routes, [ACQUISITION_ROUTE]);
    assert.deepEqual(built.routes, [ACQUISITION_ROUTE]);
    assert.deepEqual(built.modules.map((module) => module.role).sort(), [
      'business',
      'capability',
      'kernel-primary',
      'standard-primary',
    ]);
    // BUILD identity constants stay frozen (K/S/B/C identifiers unchanged).
    assert.equal(built.appId, APP_ID_DIRECT);
    assert.equal(built.buildId, BUILD_ID_DIRECT);
  });

  it('seals deterministically: repeated seals reproduce the identical module hash set', () => {
    const first = sealDirectComposition().built;
    const second = sealDirectComposition().built;
    assert.deepEqual(
      first.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
      second.modules.map((module) => `${module.role}:${module.packageId}:${module.moduleSha256}`),
    );
    assert.equal(first.buildId, second.buildId);
  });
});

// ---------------------------------------------------------------------------
// N5-domain — the T01 no-widening gate refuses before any send (pure)
// ---------------------------------------------------------------------------

describe('N5-domain — T01 no-widening gate before send (pure contract)', () => {
  const validIntent = {
    requestId: 'n5-domain',
    lineageId: 'lineage-n5-domain',
    targetRef: 'ref:fixture/n5.bin',
    outputRootScope: '/tmp/xd-n5-domain',
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: 'a'.repeat(64),
    declaredBytes: 64,
    caller: { actor: 'zcode:xd-a02-builder-agent', sessionRef: 'session:a02' },
  };

  it('admits the exact-field intent through the canonical grammar', () => {
    const checked = validateConfirmedIntent(validIntent);
    assert.equal(checked.ok, true);
    if (checked.ok) {
      assert.equal(checked.value.targetRef, 'ref:fixture/n5.bin');
      assert.equal(checked.value.allowedOperation, 'acquisition.acquire');
    }
  });

  it('refuses a widened intent (extra field) with SCOPE_WIDENING_REFUSED', () => {
    const checked = validateConfirmedIntent({ ...validIntent, extraField: 'not allowed' });
    assert.equal(checked.ok, false);
    if (!checked.ok) {
      assert.equal(checked.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
    }
  });

  it('refuses a raw-locator targetRef with LOCATOR_SUBSTITUTION_REJECTED', () => {
    const checked = validateConfirmedIntent({
      ...validIntent,
      targetRef: 'https://evil.example/file.bin',
    });
    assert.equal(checked.ok, false);
    if (!checked.ok) {
      assert.equal(checked.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
    }
  });
});

// ---------------------------------------------------------------------------
// ABI — the sealed direct capability module keeps its Host bridge pin seam
// ---------------------------------------------------------------------------

describe('ABI — sealed direct capability bridge pin seam', () => {
  it('the sealed capability module reaches the DIRECT_BRIDGE_PIN globalThis seam', () => {
    // The sealed module carries the literal (bytes frozen since T11); the
    // exported constant must keep naming exactly that pin until A04.
    assert.equal(DIRECT_BRIDGE_PIN, '__xdownloadDirectAcquisitionBridge');
    const sealedSource = readFileSync(join(HERE, 'capability-acquisition-direct.mjs'), 'utf8');
    assert.ok(
      sealedSource.includes(`globalThis.${DIRECT_BRIDGE_PIN}`),
      'the sealed direct capability module must reach the same pin the transitional contract names',
    );
  });
});

// ---------------------------------------------------------------------------
// A02 sentinel — the relocated assembly fails closed with zero effects
// ---------------------------------------------------------------------------

describe('A02 sentinel — assembleDownloadRuntime relocation refusal', () => {
  it('rejects with DIRECT_RUNTIME_ASSEMBLY_RELOCATED and creates zero effects', async () => {
    const storePath = join(
      process.env['TEMP'] ?? '/tmp',
      `xd-a02-sentinel-${String(process.pid)}-${String(Date.now())}.json`,
    );
    await assert.rejects(
      assembleDownloadRuntime({ storePath, targetRefs: [] }),
      /DIRECT_RUNTIME_ASSEMBLY_RELOCATED/,
    );
    // Zero effects: no durable store file, no pin installed.
    assert.equal(existsSync(storePath), false);
    assert.equal(
      (globalThis as Record<string, unknown>)[DIRECT_BRIDGE_PIN],
      undefined,
      'the sentinel must never install a Host bridge pin',
    );
  });
});
