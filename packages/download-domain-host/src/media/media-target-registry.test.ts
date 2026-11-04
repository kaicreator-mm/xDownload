/**
 * V022-A04 — Host-owned media targetRef registry grammar tests
 * (node:test, colocated; pure, no I/O).
 *
 * The registry grammar moved from the Domain App integrations lane to the
 * Host (A04) because resolution facts are physical delivery truth. These
 * tests pin the exact-key no-widening record grammar and the opaque-handle
 * rules (bounded token grammar + the A01 neutral raw-locator negative
 * assertion) exactly as the T12 lane recorded them — the behavior is
 * relocation-invariant.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryMediaTargetRegistry,
  MEDIA_REGISTRY_PROTOCOLS,
  validateMediaTargetRecord,
} from './media-target-registry.ts';

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

describe('HOST-MEDIA-REGISTRY-01 — exact-key no-widening record grammar', () => {
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
});

describe('HOST-MEDIA-REGISTRY-02 — opaque handle rules (never parsed as locators)', () => {
  it('locator-shaped handles refuse; opaque handles resolve; unknown handles refuse', () => {
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

  it('seed construction refuses a malformed seed with MEDIA_REGISTRY_SEED_REFUSED', () => {
    assert.throws(
      () => new InMemoryMediaTargetRegistry([{ handle: 'ref:media/bad', record: { nope: true } }]),
      /MEDIA_REGISTRY_SEED_REFUSED/,
    );
  });
});
