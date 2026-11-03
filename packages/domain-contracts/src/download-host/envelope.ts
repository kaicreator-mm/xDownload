/**
 * V022 A01 — neutral Host-operation contracts: effect envelope and
 * materialized-evidence output contracts.
 *
 * Every Host external-effect adapter returns the typed phase grammar below
 * (frozen A05: `accepted`/`running` are NOT terminal — only a typed
 * terminal outcome settles an effect, so a fake accepted/running ACK can
 * never become success). Successful materialization carries
 * `MaterializedEvidence`: digest-backed, byte-counted and bounded to the
 * confirmed output root — evidence can never widen the authorized scope.
 * Pure contract layer: no I/O, no App/Host/Core imports.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';
import { isBoundedByteCount, isSha256Digest } from './fields.ts';
import { validateArtifactPath } from './paths.ts';

/**
 * Typed phase grammar returned by every external effect adapter (A05).
 * Pending phases carry no outcome; terminal outcomes are exactly typed.
 */
export type EffectEnvelope =
  | { readonly phase: 'accepted'; readonly externalRef: string }
  | { readonly phase: 'running'; readonly externalRef: string }
  | {
      readonly phase: 'terminal';
      readonly externalRef: string;
      readonly outcome:
        | { readonly ok: true; readonly output: Record<string, unknown> }
        | {
            readonly ok: false;
            readonly error: { readonly code: string; readonly message: string };
          };
    };

/**
 * Normalize an unknown adapter return into the envelope grammar. Pending
 * phases carry no outcome (a fake accepted/running ACK can never become
 * success); terminal outcomes must be exactly typed.
 */
export function normalizeEffectEnvelope(raw: unknown): DomainValidationResult<EffectEnvelope> {
  if (typeof raw !== 'object' || raw === null) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'envelope', 'effect envelope must be a plain object'),
    ]);
  }
  const record = raw as Record<string, unknown>;
  const externalRef = record.externalRef;
  if (typeof externalRef !== 'string' || externalRef.length === 0) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'externalRef',
        'envelope requires a bounded externalRef',
      ),
    ]);
  }
  if (record.phase === 'accepted' || record.phase === 'running') {
    return ok({ phase: record.phase, externalRef } as EffectEnvelope);
  }
  if (record.phase !== 'terminal') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'phase',
        "phase must be 'accepted' | 'running' | 'terminal'",
      ),
    ]);
  }
  const outcome = record.outcome;
  if (typeof outcome !== 'object' || outcome === null) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'outcome',
        'terminal envelope requires an outcome record',
      ),
    ]);
  }
  const outcomeRecord = outcome as Record<string, unknown>;
  if (outcomeRecord.ok === true) {
    const output = outcomeRecord.output;
    if (typeof output !== 'object' || output === null) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'outcome.output',
          'ok terminal outcome carries a plain output record',
        ),
      ]);
    }
    return ok({
      phase: 'terminal',
      externalRef,
      outcome: { ok: true, output: output as Record<string, unknown> },
    });
  }
  if (outcomeRecord.ok !== false) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outcome.ok', 'terminal outcome.ok must be boolean'),
    ]);
  }
  const error = outcomeRecord.error;
  if (
    typeof error !== 'object' ||
    error === null ||
    typeof (error as Record<string, unknown>).code !== 'string' ||
    typeof (error as Record<string, unknown>).message !== 'string'
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'outcome.error',
        'failed terminal outcome carries a typed {code, message} error',
      ),
    ]);
  }
  const errorRecord = error as { code: string; message: string };
  return ok({
    phase: 'terminal',
    externalRef,
    outcome: { ok: false, error: { code: errorRecord.code, message: errorRecord.message } },
  });
}

/** Bounded materialized-artifact evidence returned by a trusted Host writer. */
export interface MaterializedEvidence {
  readonly fileSha256: string;
  readonly bytesWritten: number;
  readonly artifactPath: string;
  readonly stopReason: string;
}

const EVIDENCE_KEYS = ['fileSha256', 'bytesWritten', 'artifactPath', 'stopReason'] as const;

/**
 * Validate materialized evidence against the confirmed root and digest
 * grammar: digest must be lowercase 64-hex, bytes a positive safe integer
 * within the v0.2 profile bound, and the path must stay inside the
 * authorized root — evidence can never widen the confirmed output scope.
 */
export function validateMaterializedEvidence(
  evidence: unknown,
  outputRootScope: string,
): DomainValidationResult<MaterializedEvidence> {
  if (typeof evidence !== 'object' || evidence === null) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'evidence',
        'materialized evidence must be a plain object',
      ),
    ]);
  }
  const record = evidence as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(EVIDENCE_KEYS as readonly string[]).includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          'evidence.' + key,
          `unknown evidence field is refused: ${key}`,
        ),
      ]);
    }
  }
  const fileSha256 = record.fileSha256;
  if (!isSha256Digest(fileSha256)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'fileSha256', 'fileSha256 must be lowercase 64-hex'),
    ]);
  }
  const bytesWritten = record.bytesWritten;
  if (!isBoundedByteCount(bytesWritten)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'bytesWritten',
        'bytesWritten must be a positive safe integer within the v0.2 profile bound',
      ),
    ]);
  }
  const stopReason = record.stopReason;
  if (typeof stopReason !== 'string' || stopReason.length === 0 || stopReason.length > 64) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'stopReason',
        'stopReason must be a bounded terminal token',
      ),
    ]);
  }
  const pathCheck = validateArtifactPath(
    outputRootScope,
    typeof record.artifactPath === 'string' ? record.artifactPath : '',
  );
  if (!pathCheck.ok) return pathCheck;
  return ok({ fileSha256, bytesWritten, artifactPath: pathCheck.value, stopReason });
}
