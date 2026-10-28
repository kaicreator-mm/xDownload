/**
 * v0.2 T01 negative/positive contract tests — node:test (root Node24
 * toolchain, no manifest, per the frozen Task Pack: tests colocated inside
 * the T01 write set).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DOWNLOAD_OPERATIONS,
  MAX_DECLARED_BYTES,
  normalizeEffectEnvelope,
  validateArtifactPath,
  validateConfirmedIntent,
  validateMaterializedEvidence,
  validateOutputRoot,
  validateRouteTable,
  type OperationDeclaration,
} from './index.ts';

const SHA = 'a'.repeat(64);
const ROOT = 'C:/tmp/authorized-root';

function baseIntent(): Record<string, unknown> {
  return {
    requestId: 'req-001',
    lineageId: 'lineage-001',
    targetRef: 'ref:target-001',
    outputRootScope: ROOT,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: SHA,
    declaredBytes: 1024,
    caller: { actor: 'poc-host', sessionRef: 'session-001' },
  };
}

const DECLARATIONS: OperationDeclaration[] = [
  {
    operationId: 'acquisition.acquire',
    capabilityId: 'acquisition',
    handlerId: 'acquireFile',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
];

describe('validateConfirmedIntent — no-widening', () => {
  it('accepts a canonical confirmed intent unchanged', () => {
    const result = validateConfirmedIntent(baseIntent());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestId, 'req-001');
      assert.equal(result.value.slice, 'S1');
      assert.equal(result.value.digestAnchor, SHA);
    }
  });

  it('refuses unknown fields (SCOPE_WIDENING_REFUSED) — the confirmed scope cannot grow', () => {
    const widened = { ...baseIntent(), extraScope: 'http://127.0.0.1:1/evil' };
    const result = validateConfirmedIntent(widened);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
      assert.equal(result.diagnostics[0]?.path, 'extraScope');
    }
  });

  it('refuses missing required fields', () => {
    const partial = { ...baseIntent() } as Record<string, unknown>;
    delete partial.targetRef;
    const result = validateConfirmedIntent(partial);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0]?.code, 'MISSING_REQUIRED_FIELD');
  });

  it('refuses a raw URL as targetRef (opaque token only — L2 A02)', () => {
    const result = validateConfirmedIntent({ ...baseIntent(), targetRef: 'http://127.0.0.1:8080/file.bin' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
  });

  it('refuses malformed identifiers, digest anchors and size bounds', () => {
    assert.equal(validateConfirmedIntent({ ...baseIntent(), requestId: 'BAD_ID' }).ok, false);
    assert.equal(validateConfirmedIntent({ ...baseIntent(), digestAnchor: 'not-hex' }).ok, false);
    assert.equal(validateConfirmedIntent({ ...baseIntent(), declaredBytes: MAX_DECLARED_BYTES + 1 }).ok, false);
    assert.equal(validateConfirmedIntent({ ...baseIntent(), slice: 'S2' }).ok, false);
    const noCallerRole = { ...baseIntent(), caller: {} };
    assert.equal(validateConfirmedIntent(noCallerRole).ok, false);
  });
});

describe('output root and artifact path containment', () => {
  it('accepts an absolute root and refuses relative or traversing roots', () => {
    assert.equal(validateOutputRoot(ROOT).ok, true);
    assert.equal(validateOutputRoot('relative/root').ok, false);
    assert.equal(validateOutputRoot('C:/tmp/../secrets').ok, false);
  });

  it('refuses artifact paths escaping the authorized root', () => {
    assert.equal(validateArtifactPath(ROOT, `${ROOT}/file.bin`).ok, true);
    assert.equal(validateArtifactPath(ROOT, 'C:/tmp/other/file.bin').ok, false);
    assert.equal(validateArtifactPath(ROOT, `${ROOT}/../secrets/file.bin`).ok, false);
    assert.equal(validateArtifactPath(ROOT, ROOT).ok, false);
  });
});

describe('route table binding', () => {
  it('accepts a route table bound to sealed declarations', () => {
    const result = validateRouteTable(
      [{ intentId: 'confirmDownload', operationId: 'acquisition.acquire', capabilityId: 'acquisition', handlerId: 'acquireFile' }],
      DECLARATIONS,
    );
    assert.equal(result.ok, true);
    assert.ok(DOWNLOAD_OPERATIONS.includes('acquisition.acquire'));
  });

  it('refuses a route to an undeclared capability (exact contract binding mismatch)', () => {
    const result = validateRouteTable(
      [{ intentId: 'confirmDownload', operationId: 'acquisition.acquire', capabilityId: 'acquisition-missing', handlerId: 'acquireFile' }],
      DECLARATIONS,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0]?.code, 'CONTRACT_BINDING_MISMATCH');
  });

  it('refuses operations outside the frozen vocabulary', () => {
    const result = validateRouteTable(
      [{ intentId: 'confirmDownload', operationId: 'madeup.operation', capabilityId: 'acquisition', handlerId: 'acquireFile' }],
      DECLARATIONS,
    );
    assert.equal(result.ok, false);
  });
});

describe('effect envelope grammar (L2 A05)', () => {
  it('accepted/running phases carry no outcome', () => {
    const accepted = normalizeEffectEnvelope({ phase: 'accepted', externalRef: 'ref-1' });
    assert.equal(accepted.ok, true);
    if (accepted.ok && accepted.value.phase === 'accepted') {
      assert.equal('outcome' in accepted.value, false);
    }
  });

  it('terminal ok/failed outcomes are exactly typed', () => {
    const okTerminal = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ref-1',
      outcome: { ok: true, output: { fileSha256: SHA } },
    });
    assert.equal(okTerminal.ok, true);
    const failed = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ref-1',
      outcome: { ok: false, error: { code: 'USER_CANCELLED', message: 'cancelled' } },
    });
    assert.equal(failed.ok, true);
    const malformed = normalizeEffectEnvelope({ phase: 'terminal', externalRef: 'ref-1', outcome: { ok: false } });
    assert.equal(malformed.ok, false);
    const pendingAsSuccess = normalizeEffectEnvelope({ phase: 'pending', externalRef: 'ref-1' });
    assert.equal(pendingAsSuccess.ok, false);
  });
});

describe('materialized evidence validation', () => {
  it('accepts bounded evidence inside the root', () => {
    const result = validateMaterializedEvidence(
      { fileSha256: SHA, bytesWritten: 10, artifactPath: `${ROOT}/req-001.bin`, stopReason: 'COMPLETED' },
      ROOT,
    );
    assert.equal(result.ok, true);
  });

  it('refuses bad digests and escaping artifact paths', () => {
    assert.equal(
      validateMaterializedEvidence({ fileSha256: 'nope', bytesWritten: 1, artifactPath: `${ROOT}/x.bin`, stopReason: 'COMPLETED' }, ROOT)
        .ok,
      false,
    );
    assert.equal(
      validateMaterializedEvidence(
        { fileSha256: SHA, bytesWritten: 1, artifactPath: 'C:/elsewhere/x.bin', stopReason: 'COMPLETED' },
        ROOT,
      ).ok,
      false,
    );
  });
});
