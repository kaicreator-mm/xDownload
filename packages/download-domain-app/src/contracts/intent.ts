/**
 * v0.2 T01 — canonical xDownload download-domain intent contract.
 *
 * Pure additive contract layer owned by Task T01 (frozen Task Pack,
 * version/v0.2.0). Encodes the frozen L2 A02/A05 decisions as data:
 * a confirmed download intent carries an OPAQUE targetRef that only the
 * trusted Host resolves — raw URLs/paths are never an untrusted C config
 * authority — and every field is validated against an exact key set so the
 * confirmed scope cannot widen after sealing (no-widening contract).
 *
 * This module imports only the existing @xdownload/domain-contracts
 * diagnostics family; it owns no admission/journal/runtime mechanism.
 */
import {
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';

/** Bounded caller identity riding every confirmed intent (auditable, opaque). */
export interface IntentCaller {
  readonly actor: string;
  readonly sessionRef: string;
}

/** Frozen slice vocabulary (existing direct-acquisition S1/S3 lanes). */
export type DownloadSlice = 'S1' | 'S3';

/**
 * The canonical confirmed download intent. One sealed instance is the only
 * thing a C/Host operation may execute against; nothing here can be widened
 * at runtime (exact-field validation below).
 */
export interface ConfirmedDownloadIntent {
  readonly requestId: string;
  readonly lineageId: string;
  /** Opaque resolution token; only the trusted Host turns it into a locator. */
  readonly targetRef: string;
  /** Absolute authorized output root; the artifact must materialize inside. */
  readonly outputRootScope: string;
  readonly allowedOperation: string;
  readonly slice: DownloadSlice;
  /** Optional frozen digest anchor (lowercase 64-hex) for the full bytes. */
  readonly digestAnchor?: string;
  /** Optional declared total size, bounded for the v0.2 profile. */
  readonly declaredBytes?: number;
  readonly caller: IntentCaller;
}

export const INTENT_FIELD_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const REFERENCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** v0.2 profile bound: 1 TiB per confirmed intent. */
export const MAX_DECLARED_BYTES = 1_099_511_627_776;

const INTENT_FIELDS = [
  'requestId',
  'lineageId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'slice',
  'digestAnchor',
  'declaredBytes',
  'caller',
] as const;

/**
 * Exact-key no-widening validation of a confirmed download intent. Unknown
 * fields are refused, never dropped silently: the confirmed scope cannot grow
 * between sealing and execution.
 */
export function validateConfirmedIntent(input: unknown): DomainValidationResult<ConfirmedDownloadIntent> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'intent', 'confirmed intent must be a plain object')]);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(INTENT_FIELDS as readonly string[]).includes(key)) {
      return fail([
        diagnostic('SCOPE_WIDENING_REFUSED', key, `unknown field is refused by the no-widening contract: ${key}`),
      ]);
    }
  }
  for (const key of ['requestId', 'lineageId', 'targetRef', 'outputRootScope', 'allowedOperation', 'slice', 'caller'] as const) {
    if (record[key] === undefined) {
      return fail([diagnostic('MISSING_REQUIRED_FIELD', key, `confirmed intent requires ${key}`)]);
    }
  }
  const requestId = record.requestId;
  if (typeof requestId !== 'string' || !INTENT_FIELD_PATTERN.test(requestId)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'requestId', 'requestId must match ^[a-z0-9][a-z0-9-]{0,63}$'),
    ]);
  }
  const lineageId = record.lineageId;
  if (typeof lineageId !== 'string' || !INTENT_FIELD_PATTERN.test(lineageId)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'lineageId', 'lineageId must match ^[a-z0-9][a-z0-9-]{0,63}$'),
    ]);
  }
  const targetRef = record.targetRef;
  const isRawLocator =
    typeof targetRef === 'string' &&
    (/^[a-z][a-z0-9+.-]*:\/\//i.test(targetRef) || /^[/\\]/.test(targetRef) || /^[A-Za-z]:[/\\]/.test(targetRef));
  if (typeof targetRef !== 'string' || isRawLocator || !REFERENCE_TOKEN_PATTERN.test(targetRef)) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        'targetRef',
        'targetRef must be an opaque bounded token; raw locators are not a C config authority',
      ),
    ]);
  }
  const outputRootScope = record.outputRootScope;
  const rootCheck = validateOutputRoot(outputRootScope);
  if (!rootCheck.ok) return rootCheck;
  const allowedOperation = record.allowedOperation;
  if (typeof allowedOperation !== 'string' || allowedOperation.length === 0 || allowedOperation.length > 128) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'allowedOperation', 'allowedOperation must be a bounded operation id'),
    ]);
  }
  const slice = record.slice;
  if (slice !== 'S1' && slice !== 'S3') {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'slice', "slice must be 'S1' or 'S3'")]);
  }
  let digestAnchor: string | undefined;
  if (record.digestAnchor !== undefined) {
    if (typeof record.digestAnchor !== 'string' || !SHA256_PATTERN.test(record.digestAnchor)) {
      return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'digestAnchor', 'digestAnchor must be lowercase 64-hex')]);
    }
    digestAnchor = record.digestAnchor;
  }
  let declaredBytes: number | undefined;
  if (record.declaredBytes !== undefined) {
    if (
      typeof record.declaredBytes !== 'number' ||
      !Number.isSafeInteger(record.declaredBytes) ||
      record.declaredBytes <= 0 ||
      record.declaredBytes > MAX_DECLARED_BYTES
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'declaredBytes',
          `declaredBytes must be a safe integer in (0, ${MAX_DECLARED_BYTES}]`,
        ),
      ]);
    }
    declaredBytes = record.declaredBytes;
  }
  const caller = record.caller;
  if (typeof caller !== 'object' || caller === null || Array.isArray(caller)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'caller', 'caller must be a plain object')]);
  }
  const callerRecord = caller as Record<string, unknown>;
  if (typeof callerRecord.actor !== 'string' || callerRecord.actor.length === 0 || callerRecord.actor.length > 128) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'caller.actor', 'caller.actor must be a bounded string')]);
  }
  if (
    typeof callerRecord.sessionRef !== 'string' ||
    callerRecord.sessionRef.length === 0 ||
    callerRecord.sessionRef.length > 256
  ) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'caller.sessionRef', 'caller.sessionRef must be bounded')]);
  }
  return ok({
    requestId,
    lineageId,
    targetRef,
    outputRootScope: rootCheck.value,
    allowedOperation,
    slice,
    ...(digestAnchor === undefined ? {} : { digestAnchor }),
    ...(declaredBytes === undefined ? {} : { declaredBytes }),
    caller: { actor: callerRecord.actor, sessionRef: callerRecord.sessionRef },
  });
}

/** Output-root containment grammar: absolute, resolved, no traversal. */
export function validateOutputRoot(root: unknown): DomainValidationResult<string> {
  if (typeof root !== 'string' || root.length === 0 || root.length > 512) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be a bounded path string')]);
  }
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(root)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be an absolute path')]);
  }
  const segments = root.split(/[\\/]/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.includes('..')) {
    return fail([diagnostic('OUTPUT_ROOT_ESCAPED', 'outputRoot', "output root must not contain '..' segments")]);
  }
  return ok(root);
}

/** Artifact path containment inside a validated root (no escape, no '..'). */
export function validateArtifactPath(root: string, artifactPath: string): DomainValidationResult<string> {
  const rootCheck = validateOutputRoot(root);
  if (!rootCheck.ok) return rootCheck;
  if (typeof artifactPath !== 'string' || artifactPath.length === 0 || artifactPath.length > 768) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'artifactPath', 'artifact path must be a bounded string')]);
  }
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  if (!artifactPath.startsWith(normalizedRoot)) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', 'artifact path escapes the authorized output root'),
    ]);
  }
  const remainder = artifactPath.slice(normalizedRoot.length);
  if (/^[\\/]/.test(remainder) === false) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', 'artifact path must be inside the output root'),
    ]);
  }
  const segments = remainder.split(/[\\/]/).filter((segment) => segment.length > 0);
  if (segments.includes('..')) {
    return fail([diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', "artifact path must not contain '..'")]);
  }
  return ok(artifactPath);
}
