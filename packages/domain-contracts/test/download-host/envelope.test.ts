/**
 * TEST_MATRIX EFFECT-ENVELOPE-01 + MATERIALIZED-EVIDENCE-01 — accepted/running
 * EffectEnvelope states cannot be interpreted as terminal success, and
 * MaterializedEvidence is digest-backed and cannot widen the confirmed root.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeEffectEnvelope,
  validateMaterializedEvidence,
  type EffectEnvelope,
} from '../../src/index.ts';
import { expectCode } from '../helpers.ts';
import { DIGEST_A } from './fixtures.ts';

describe('EFFECT-ENVELOPE-01: pending phases are non-terminal', () => {
  it("normalizes 'accepted' and 'running' without any outcome", () => {
    for (const phase of ['accepted', 'running'] as const) {
      const result = normalizeEffectEnvelope({ phase, externalRef: 'ref-1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.phase).toBe(phase);
      expect(result.value).not.toHaveProperty('outcome');
      // A pending envelope can never satisfy a terminal-success check.
      expect(result.value.phase === 'terminal').toBe(false);
    }
  });

  it('a pending envelope carrying a forged outcome refuses (never dropped)', () => {
    const forged = {
      phase: 'accepted',
      externalRef: 'ref-1',
      outcome: { ok: true, output: { fileSha256: DIGEST_A } },
    };
    expectCode(normalizeEffectEnvelope(forged), 'MALFORMED_REQUIRED_FIELD');
  });

  it('a pending envelope with an explicit undefined outcome key still refuses', () => {
    expectCode(
      normalizeEffectEnvelope({ phase: 'running', externalRef: 'ref-1', outcome: undefined }),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('a fake pending ACK never becomes success through re-normalization', () => {
    const pending = normalizeEffectEnvelope({ phase: 'running', externalRef: 'ref-1' });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value.phase).not.toBe('terminal');
  });

  it('normalizes typed terminal success and failure', () => {
    const okResult = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ref-1',
      outcome: { ok: true, output: { artifactPath: '/var/out/root/f.bin' } },
    });
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.phase).toBe('terminal');
      if (okResult.value.phase === 'terminal') expect(okResult.value.outcome.ok).toBe(true);
    }

    const failResult = normalizeEffectEnvelope({
      phase: 'terminal',
      externalRef: 'ref-1',
      outcome: { ok: false, error: { code: 'DIGEST_MISMATCH', message: 'bytes differ' } },
    });
    expect(failResult.ok).toBe(true);
    if (failResult.ok && failResult.value.phase === 'terminal') {
      expect(failResult.value.outcome.ok).toBe(false);
    }
  });

  it('rejects malformed envelopes (bad phase, missing ref, untyped outcome)', () => {
    expectCode(normalizeEffectEnvelope(null), 'MALFORMED_REQUIRED_FIELD');
    expectCode(normalizeEffectEnvelope([]), 'MALFORMED_REQUIRED_FIELD');
    expectCode(
      normalizeEffectEnvelope({ phase: 'done', externalRef: 'ref-1' }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(normalizeEffectEnvelope({ phase: 'terminal' }), 'MISSING_REQUIRED_FIELD');
    expectCode(
      normalizeEffectEnvelope({ phase: 'accepted', externalRef: 'ref-1', extra: 1 }),
      'SCOPE_WIDENING_REFUSED',
    );
    expectCode(
      normalizeEffectEnvelope({ phase: 'terminal', externalRef: 'ref-1', outcome: null }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: false, error: { code: 7 } },
      }),
      'MISSING_REQUIRED_FIELD',
    );
  });

  it('strict terminal shape: exact outcome keys and bounded strings', () => {
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: true, output: {}, extra: 'x' },
      }),
      'SCOPE_WIDENING_REFUSED',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: false, error: { code: 'E', message: 'm', extra: 1 } },
      }),
      'SCOPE_WIDENING_REFUSED',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'x'.repeat(513),
        outcome: { ok: false, error: { code: 'E', message: 'm' } },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: false, error: { code: 'x'.repeat(129), message: 'm' } },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: false, error: { code: 'E', message: 'x'.repeat(1025) } },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: true, error: { code: 'E', message: 'm' } },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({
        phase: 'terminal',
        externalRef: 'ref-1',
        outcome: { ok: false, output: { a: 1 } },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      normalizeEffectEnvelope({ phase: 'terminal', externalRef: 'ref-1' }),
      'MISSING_REQUIRED_FIELD',
    );
  });

  it('rejects hostile object geometry on the envelope records', () => {
    const accessorEnvelope = {
      phase: 'terminal',
      externalRef: 'ref-1',
      get outcome() {
        return { ok: false, error: { code: 'E', message: 'm' } };
      },
    };
    expectCode(normalizeEffectEnvelope(accessorEnvelope), 'MALFORMED_REQUIRED_FIELD');
  });

  it('type-level: only the terminal variant carries an outcome', () => {
    const envelope: EffectEnvelope = { phase: 'accepted', externalRef: 'ref-1' };
    expect(envelope.phase).not.toBe('terminal');
  });
});

describe('MATERIALIZED-EVIDENCE-01: digest-backed and root-bounded', () => {
  const root = '/var/out/root';
  const valid = {
    fileSha256: DIGEST_A,
    bytesWritten: 1_024,
    artifactPath: '/var/out/root/file.bin',
    stopReason: 'COMPLETED',
  };

  it('accepts bounded digest-backed evidence inside the confirmed root', () => {
    const result = validateMaterializedEvidence(valid, root);
    expect(result.ok).toBe(true);
  });

  it('rejects evidence that widens the confirmed output root', () => {
    for (const artifactPath of [
      '/var/out/root-evil/file.bin',
      '/var/out/root/../escape.bin',
      '/var/other/file.bin',
      '/etc/passwd',
    ]) {
      expectCode(
        validateMaterializedEvidence({ ...valid, artifactPath }, root),
        'OUTPUT_ROOT_ESCAPED',
      );
    }
  });

  it('rejects non-digest, non-byte and unbounded stop-reason facts', () => {
    expectCode(
      validateMaterializedEvidence({ ...valid, fileSha256: 'A'.repeat(64) }, root),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateMaterializedEvidence({ ...valid, bytesWritten: 0 }, root),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateMaterializedEvidence({ ...valid, bytesWritten: 1.5 }, root),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateMaterializedEvidence({ ...valid, stopReason: '' }, root),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      validateMaterializedEvidence({ ...valid, stopReason: 'x'.repeat(65) }, root),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects unknown evidence keys (no-widening)', () => {
    expectCode(
      validateMaterializedEvidence({ ...valid, bonusField: 'x' }, root),
      'SCOPE_WIDENING_REFUSED',
    );
  });

  it('rejects evidence against a traversal root', () => {
    expectCode(validateMaterializedEvidence(valid, '/var/../etc'), 'OUTPUT_ROOT_ESCAPED');
  });
});
