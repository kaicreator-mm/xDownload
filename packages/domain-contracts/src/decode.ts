/**
 * T002 structural decode helpers shared by every canonical value decoder.
 *
 * Structural shape validation is deliberately separated from cross-field
 * semantic invariant validation (see the frozen L3 reference pack): decoders
 * here only establish shape/enums/required fields; semantic rules live with
 * their domain modules.
 */

import {
  andThen,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';

/**
 * Fields that must never appear in canonical public contract data. Canonical
 * contracts carry opaque references (e.g. AuthorizationContextRef); raw
 * secrets are rejected outright (PRD §29, counterexample C21).
 */
export const RAW_SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'cookie',
  'cookies',
  'authorization',
  'credential',
  'credentials',
  'apiKey',
  'api_key',
  'privateKey',
  'sessionToken',
]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(
  value: unknown,
  path: string,
): DomainValidationResult<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', path, 'expected an object')]);
  }
  return ok(value);
}

/** Reject every key not in `known` — canonical boundaries do not silently accept unknown fields. */
export function rejectUnknownFields(
  record: Record<string, unknown>,
  known: readonly string[],
  path: string,
): DomainValidationResult<void> {
  const knownSet = new Set(known);
  const unknown = Object.keys(record).filter((key) => !knownSet.has(key));
  if (unknown.length > 0) {
    return fail(
      unknown.map((key) =>
        diagnostic(
          'UNKNOWN_FIELD',
          path === '' ? key : `${path}.${key}`,
          'unknown field at an authoritative boundary; fail closed',
        ),
      ),
    );
  }
  return ok(undefined);
}

/** Reject raw-secret fields regardless of nesting level declared by the canonical schema. */
export function rejectRawSecretFields(
  record: Record<string, unknown>,
  path: string,
): DomainValidationResult<void> {
  const offenders = Object.keys(record).filter((key) => RAW_SECRET_FIELD_NAMES.has(key));
  if (offenders.length > 0) {
    return fail(
      offenders.map((key) =>
        diagnostic(
          'RAW_SECRET_FIELD',
          path === '' ? key : `${path}.${key}`,
          'canonical public contract data must not carry raw secret fields; use opaque references',
          'PRD-§29',
        ),
      ),
    );
  }
  return ok(undefined);
}

export function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<string> {
  const value = record[key];
  if (typeof value !== 'string') {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        joinPath(path, key),
        `expected string, got ${describe(value)}`,
      ),
    ]);
  }
  return ok(value);
}

export function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<string> {
  return andThen(requireString(record, key, path), (value) =>
    value.length === 0
      ? fail([diagnostic('MALFORMED_REQUIRED_FIELD', joinPath(path, key), 'must be non-empty')])
      : ok(value),
  );
}

export function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<boolean> {
  const value = record[key];
  if (typeof value !== 'boolean') {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        joinPath(path, key),
        `expected boolean, got ${describe(value)}`,
      ),
    ]);
  }
  return ok(value);
}

export function requireInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<number> {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        joinPath(path, key),
        `expected integer, got ${describe(value)}`,
      ),
    ]);
  }
  return ok(value);
}

export function requireLiteral<K extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly K[],
  path: string,
): DomainValidationResult<K> {
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value as K)) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        joinPath(path, key),
        `expected one of [${allowed.join(', ')}], got ${describe(value)}`,
      ),
    ]);
  }
  return ok(value as K);
}

export function requireArrayOf(
  record: Record<string, unknown>,
  key: string,
  path: string,
  decodeItem: (item: unknown, itemPath: string) => DomainValidationResult<void>,
): DomainValidationResult<void> {
  const value = record[key];
  if (!Array.isArray(value)) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        joinPath(path, key),
        `expected array, got ${describe(value)}`,
      ),
    ]);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  value.forEach((item, index) => {
    const result = decodeItem(item, `${joinPath(path, key)}[${index}]`);
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
    }
  });
  return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
}

export function requireArrayOfStrings(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<readonly string[]> {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', joinPath(path, key), 'expected an array of strings'),
    ]);
  }
  return ok(value as readonly string[]);
}

export function requireOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<string | undefined> {
  if (!(key in record) || record[key] === undefined) {
    return ok(undefined);
  }
  return requireString(record, key, path);
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function requireIsoTimestamp(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<string> {
  return andThen(requireString(record, key, path), (value) => {
    if (!ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          joinPath(path, key),
          'expected an ISO-8601 timestamp',
        ),
      ]);
    }
    return ok(value);
  });
}

export function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}
