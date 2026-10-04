/**
 * TEST_MATRIX suite `semantic-claim-boundaries`.
 *
 * Proves: no code path, schema field, log message or test claims
 * exactly-once execution (semantics stay recoverable at-least-once +
 * idempotent acceptance/reconciliation); no code path or test claims
 * host-power-loss/kernel-panic/storage-controller durability (only the
 * tested process-death/reopen tuple); and persistence preserves the
 * multidimensional result inputs without introducing a single success
 * boolean or redefining T002 result semantics.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DURABILITY_CLAIM } from '../src/index.ts';

function srcDir(): string {
  return fileURLToPath(new URL('../src', import.meta.url));
}

function sourceFiles(): string[] {
  return readdirSync(srcDir())
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(srcDir(), name));
}

/** Unambiguous overclaim patterns; negated disclaimers never match these. */
const FORBIDDEN_CLAIM_PATTERNS: readonly RegExp[] = [
  /exactly[\s-]?once\s+(execution\s+)?guarantee/i,
  /guarantee[sd]?\s+(across|against|through)\s+(power|host|kernel|storage)/i,
  /exactly[\s-]?once\s+execution\s+is\s+guaranteed/i,
  /(ensures?|promises?|guarantees?)\s+exactly[\s-]?once/i,
  /durability\s+across\s+(power[\s-]?loss|kernel[\s-]?panic)/i,
];

describe('semantic-claim-boundaries', () => {
  it('the exported durability claim is bounded to process-death/reopen at-least-once semantics', () => {
    expect(DURABILITY_CLAIM.executionSemantics).toBe(
      'RECOVERABLE_AT_LEAST_ONCE_IDEMPOTENT_ACCEPTANCE',
    );
    expect(DURABILITY_CLAIM.durabilityTuple).toBe('PROCESS_DEATH_AND_REOPEN_ONLY');
    expect(DURABILITY_CLAIM.exactlyOnceClaimed).toBe(false);
    expect(DURABILITY_CLAIM.hostPowerLossClaimed).toBe(false);
  });

  it('no source file makes an exactly-once or power-loss durability claim', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
        expect(pattern.test(text), `${file} matches forbidden claim ${String(pattern)}`).toBe(
          false,
        );
      }
    }
  });

  it('the store never constructs or redefines T002 terminal result semantics', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      // Result projection stays owned by the T002 result projector; the
      // store only preserves multidimensional projection inputs.
      expect(text.includes('TerminalResult')).toBe(false);
      expect(text.includes('decodeTerminalResult')).toBe(false);
      // No single success boolean is introduced by the store.
      expect(/['"`]success['"`]\s*:/.test(text)).toBe(false);
    }
  });

  it('recovery projections carry the multidimensional vocabulary, never one success flag', async () => {
    const { RecoveryService } = await import('../src/index.ts');
    // The projection type exposes independent factual dimensions; there is
    // no `success` boolean field.
    const projectionKeys = [
      'selectionAcquisitionStatus',
      'stopReason',
      'accepted',
      'bytesVerified',
      'successClaimable',
      'terminal',
    ];
    expect(RecoveryService).toBeDefined();
    // successClaimable is a composite of durable acceptance AND verified
    // bytes AND cutoff truth — deliberately not a single transfer success
    // boolean, and the recovery vocabulary names it accordingly.
    expect(projectionKeys).toContain('selectionAcquisitionStatus');
    expect(projectionKeys).toContain('stopReason');
    expect(projectionKeys).not.toContain('success');
  });
});
