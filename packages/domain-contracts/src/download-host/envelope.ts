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
 *
 * Both decoders are strict plain-object validators: hostile object
 * geometry (arrays, class instances, accessors, symbol keys), unknown
 * fields, missing fields and out-of-bounds values refuse fail-closed —
 * nothing is silently dropped or coerced. Pure contract layer: no I/O, no
 * App/Host/Core imports.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';
import { isBoundedByteCount, isSha256Digest } from './fields.ts';
import { validateArtifactPath } from './paths.ts';
import { exactKeys, stableRecord } from './records.ts';

/** Bounded external reference grammar riding every envelope. */
const EXTERNAL_REF_MAX = 512;
const ERROR_CODE_MAX = 128;
const ERROR_MESSAGE_MAX = 1024;
const STOP_REASON_MAX = 64;

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

function malformed(path: string, message: string) {
  return fail([diagnostic('MALFORMED_REQUIRED_FIELD', path, message)]);
}

/**
 * Normalize an unknown adapter return into the envelope grammar. The
 * envelope must be a plain data object with exactly the frozen keys;
 * pending phases must NOT carry an outcome field at all (a forged outcome
 * on an accepted/running ACK refuses instead of being dropped); terminal
 * outcomes must be exactly typed with bounded strings. Fail-closed
 * throughout.
 */
export function normalizeEffectEnvelope(raw: unknown): DomainValidationResult<EffectEnvelope> {
  const stable = stableRecord(raw, 'envelope');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, ['phase', 'externalRef', 'outcome'], 'envelope', ['outcome']);
  if (!keys.ok) return keys;
  const externalRef = record.externalRef;
  if (
    typeof externalRef !== 'string' ||
    externalRef.length === 0 ||
    externalRef.length > EXTERNAL_REF_MAX
  ) {
    return malformed(
      'envelope.externalRef',
      `externalRef must be a bounded string (1..${EXTERNAL_REF_MAX})`,
    );
  }
  if (record.phase === 'accepted' || record.phase === 'running') {
    // Strict: a pending envelope carrying ANY outcome field is a forgery
    // attempt and refuses; the outcome is never silently discarded.
    if (Object.hasOwn(record, 'outcome')) {
      return malformed(
        'envelope.outcome',
        `${record.phase} envelopes must not carry an outcome; only 'terminal' settles an effect`,
      );
    }
    return ok(Object.freeze({ phase: record.phase, externalRef }));
  }
  if (record.phase !== 'terminal') {
    return malformed('envelope.phase', "phase must be 'accepted' | 'running' | 'terminal'");
  }
  if (!Object.hasOwn(record, 'outcome')) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'envelope.outcome',
        'terminal envelope requires an outcome',
      ),
    ]);
  }
  const outcome = stableRecord(record.outcome, 'envelope.outcome');
  if (!outcome.ok) return outcome;
  const outcomeKeys = exactKeys(outcome.value, ['ok', 'output', 'error'], 'envelope.outcome', [
    'output',
    'error',
  ]);
  if (!outcomeKeys.ok) return outcomeKeys;
  if (outcome.value.ok === true) {
    if (Object.hasOwn(outcome.value, 'error')) {
      return malformed('envelope.outcome.error', 'ok outcomes must not carry an error field');
    }
    if (!Object.hasOwn(outcome.value, 'output')) {
      return fail([
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'envelope.outcome.output',
          'ok terminal outcome requires an output record',
        ),
      ]);
    }
    const output = stableRecord(outcome.value.output, 'envelope.outcome.output');
    if (!output.ok) return output;
    return ok(
      Object.freeze({
        phase: 'terminal',
        externalRef,
        outcome: Object.freeze({ ok: true as const, output: Object.freeze(output.value) }),
      }),
    );
  }
  if (outcome.value.ok !== false) {
    return malformed('envelope.outcome.ok', 'terminal outcome.ok must be boolean');
  }
  if (Object.hasOwn(outcome.value, 'output')) {
    return malformed('envelope.outcome.output', 'failed outcomes must not carry an output field');
  }
  if (!Object.hasOwn(outcome.value, 'error')) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'envelope.outcome.error',
        'failed terminal outcome requires a typed error',
      ),
    ]);
  }
  const error = stableRecord(outcome.value.error, 'envelope.outcome.error');
  if (!error.ok) return error;
  const errorKeys = exactKeys(error.value, ['code', 'message'], 'envelope.outcome.error');
  if (!errorKeys.ok) return errorKeys;
  const code = error.value.code;
  const message = error.value.message;
  if (typeof code !== 'string' || code.length === 0 || code.length > ERROR_CODE_MAX) {
    return malformed(
      'envelope.outcome.error.code',
      `error.code must be a bounded string (1..${ERROR_CODE_MAX})`,
    );
  }
  if (typeof message !== 'string' || message.length === 0 || message.length > ERROR_MESSAGE_MAX) {
    return malformed(
      'envelope.outcome.error.message',
      `error.message must be a bounded string (1..${ERROR_MESSAGE_MAX})`,
    );
  }
  return ok(
    Object.freeze({
      phase: 'terminal',
      externalRef,
      outcome: Object.freeze({
        ok: false as const,
        error: Object.freeze({ code, message }),
      }),
    }),
  );
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
 * grammar: a plain data object with exactly the frozen keys; digest must
 * be lowercase 64-hex; bytes a positive safe integer within the v0.2
 * profile bound; stopReason a bounded terminal token; and the path must
 * stay inside the authorized root — evidence can never widen the confirmed
 * output scope.
 */
export function validateMaterializedEvidence(
  evidence: unknown,
  outputRootScope: string,
): DomainValidationResult<MaterializedEvidence> {
  const stable = stableRecord(evidence, 'evidence');
  if (!stable.ok) return stable;
  const record = stable.value;
  const keys = exactKeys(record, EVIDENCE_KEYS, 'evidence');
  if (!keys.ok) return keys;
  if (!isSha256Digest(record.fileSha256)) {
    return malformed('evidence.fileSha256', 'fileSha256 must be lowercase 64-hex');
  }
  if (!isBoundedByteCount(record.bytesWritten)) {
    return malformed(
      'evidence.bytesWritten',
      'bytesWritten must be a positive safe integer within the v0.2 profile bound',
    );
  }
  if (
    typeof record.stopReason !== 'string' ||
    record.stopReason.length === 0 ||
    record.stopReason.length > STOP_REASON_MAX
  ) {
    return malformed(
      'evidence.stopReason',
      `stopReason must be a bounded terminal token (1..${STOP_REASON_MAX})`,
    );
  }
  const pathCheck = validateArtifactPath(outputRootScope, record.artifactPath);
  if (!pathCheck.ok) return pathCheck;
  return ok(
    Object.freeze({
      fileSha256: record.fileSha256,
      bytesWritten: record.bytesWritten,
      artifactPath: pathCheck.value,
      stopReason: record.stopReason,
    }),
  );
}
