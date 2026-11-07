/**
 * v0.2 T11 — direct-lane composition matrix, V022-A04 domain-level edition
 * (node:test, Node24).
 *
 * The App is domain-only after A04: this file proves the DOMAIN-level
 * contract — sealed BUILD identity/determinism, the T01 no-widening gate,
 * and the sealed capability ABI seam. The real end-to-end runtime
 * scenarios (sealed BUILD loaded through the SDK public `load`, the pinned
 * T04 DirectAcquisitionBridge, the EXISTING DirectHttpAdapter and a REAL
 * 127.0.0.1 node:http fixture) relocated to the Core composition root and
 * are re-established under packages/core-runtime/test (A04:
 * slice-journey-testkit.ts assembles the direct runtime Core-side from the
 * stable App/Host package roots; domain-app-direct-flow.test.ts carries the
 * P1/P2/N1–N5 integration matrix). No coverage is silently dropped; no mock
 * transport anywhere.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    // exported constant must keep naming exactly that pin for the Core-side
    // installer.
    assert.equal(DIRECT_BRIDGE_PIN, '__xdownloadDirectAcquisitionBridge');
    const sealedSource = readFileSync(join(HERE, 'capability-acquisition-direct.mjs'), 'utf8');
    assert.ok(
      sealedSource.includes(`globalThis.${DIRECT_BRIDGE_PIN}`),
      'the sealed direct capability module must reach the same pin the Core-side installer names',
    );
  });
});
