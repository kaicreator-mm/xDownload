/**
 * T002 schema identity and version compatibility.
 *
 * Canonical values carry an explicit schema identity at every decoded or
 * public boundary. Unsupported or incompatible versions fail closed and are
 * never silently reinterpreted (frozen L2 invariant 1, TEST_MATRIX suite
 * `schema-versioning`).
 */

import {
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';

export const DOMAIN_CONTRACTS_SCHEMA_ID = 'xdownload.domain-contracts' as const;

/** Current canonical schema identity stamped onto every value this package constructs. */
export const DOMAIN_CONTRACTS_SCHEMA_VERSION = '1.0.0' as const;

/** Major versions this contract layer can decode deterministically. */
export const SUPPORTED_SCHEMA_MAJOR_VERSIONS: readonly number[] = [1];

export interface SchemaIdentity {
  readonly schema: typeof DOMAIN_CONTRACTS_SCHEMA_ID;
  readonly version: string;
}

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemVer(version: string): SemVer | undefined {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function currentSchemaIdentity(): SchemaIdentity {
  return { schema: DOMAIN_CONTRACTS_SCHEMA_ID, version: DOMAIN_CONTRACTS_SCHEMA_VERSION };
}

const SCHEMA_IDENTITY_KEYS: ReadonlySet<string> = new Set(['schema', 'version']);

/**
 * Decode an explicit schema identity from untrusted input. Missing,
 * malformed or unsupported versions reject — a boundary that requires a
 * version never guesses one.
 */
export function decodeSchemaIdentity(value: unknown): DomainValidationResult<SchemaIdentity> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'schemaIdentity', 'schema identity must be an object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SCHEMA_IDENTITY_KEYS.has(key)) {
      diagnostics.push(
        diagnostic('UNKNOWN_FIELD', `schemaIdentity.${key}`, 'unknown field on schema identity'),
      );
    }
  }
  if (record['schema'] !== DOMAIN_CONTRACTS_SCHEMA_ID) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_SCHEMA_IDENTITY',
        'schemaIdentity.schema',
        `expected schema '${DOMAIN_CONTRACTS_SCHEMA_ID}'`,
      ),
    );
  }
  if (typeof record['version'] !== 'string') {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'schemaIdentity.version',
        'version must be a semver string',
      ),
    );
  } else {
    const parsed = parseSemVer(record['version']);
    if (parsed === undefined) {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'schemaIdentity.version',
          `version '${record['version']}' is not a valid semver`,
        ),
      );
    } else if (!SUPPORTED_SCHEMA_MAJOR_VERSIONS.includes(parsed.major)) {
      diagnostics.push(
        diagnostic(
          'UNSUPPORTED_SCHEMA_VERSION',
          'schemaIdentity.version',
          `unsupported schema major version ${parsed.major}`,
          'schema-versioning',
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok({
    schema: record['schema'] as typeof DOMAIN_CONTRACTS_SCHEMA_ID,
    version: record['version'] as string,
  });
}

/**
 * Explicit version transition rule: compatible (same-major) transitions may
 * produce a new stamped successor; different-major transitions are
 * incompatible and fail closed. Historical identity is never mutated by a
 * migration — callers must mint a new identity for the successor value.
 */
export function assertExplicitVersionTransition(
  from: string,
  to: string,
): DomainValidationResult<void> {
  const fromParsed = parseSemVer(from);
  const toParsed = parseSemVer(to);
  if (fromParsed === undefined || toParsed === undefined) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'version',
        `version transition requires semver inputs, got '${from}' -> '${to}'`,
      ),
    ]);
  }
  if (fromParsed.major !== toParsed.major) {
    return fail([
      diagnostic(
        'INCOMPATIBLE_VERSION_TRANSITION',
        'version',
        `incompatible transition ${from} -> ${to}: major versions differ`,
        'schema-versioning',
      ),
    ]);
  }
  return ok(undefined);
}
