/**
 * v0.2 T12 — media targetRef registry (trusted Host side, S3 media lane;
 * write set packages/download-domain-app/src/integrations/**).
 *
 * The T04 targetRef registry discipline applied to the media lane: a
 * confirmed media intent carries an OPAQUE `targetRef`; this registry —
 * seeded by the trusted composition — is the ONLY thing that turns the
 * handle into the T06 bridge request facts (manifest locator, authorized
 * origins, budget profile). The handle is never parsed as a URL/path (the
 * explicit `isRawLocatorShape` negative assertion of the T04 registry is
 * reused verbatim), record fields are copied explicitly (exact-key record
 * grammar, no spread), and unknown handles are typed refusals, never guesses.
 *
 * The registry record is the SINGLE SOURCE the media pin forwards to the T06
 * bridge: `allowedManifestOrigins` / `allowedSegmentOrigins` / budget come
 * from here and nowhen else, so a derived permit can never be wider than the
 * seeded facts. The loopback-HTTP fixture exception is an explicit seeded
 * fact (`fixtureLoopbackHttp`); production compositions seed it false/absent
 * and the T06 engine default (production TLS/origin admission) applies.
 *
 * Pure contract/validation layer: registering or resolving never performs
 * I/O and grants no authority by itself.
 */
import {
  decodeBudgetProfile,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type BudgetProfile,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { REFERENCE_TOKEN_PATTERN } from '../contracts/index.ts';
import { isRawLocatorShape } from '../../../download-domain-host/src/direct/target-ref-registry.ts';

/** The only protocol this lane's registry accepts (T06 declared support). */
export const MEDIA_REGISTRY_PROTOCOLS = ['HLS'] as const;

/** Trusted-Host media delivery facts one opaque handle resolves to. */
export interface MediaTargetRecord {
  /** Explicit protocol declaration; only 'HLS' is registered or executed. */
  readonly protocol: 'HLS';
  /** Trusted-Host-resolved manifest locator for the frozen logical target. */
  readonly manifestUri: string;
  /** Exact rendition URI declared by the master playlist; optional. */
  readonly selectedRenditionUri?: string;
  /** Bounded artifact file name inside the authorized root (no separators). */
  readonly artifactFileName?: string;
  /** Exact manifest/media-playlist origins the lane may ever touch. */
  readonly allowedManifestOrigins: readonly string[];
  /** Exact segment origins the lane may ever touch. */
  readonly allowedSegmentOrigins: readonly string[];
  /** Canonical complete budget profile (single budget truth for the effect). */
  readonly budget: BudgetProfile;
  /**
   * Fixture-only loopback HTTP exception forwarded to the engine ports.
   * Production compositions MUST leave this absent/false.
   */
  readonly fixtureLoopbackHttp?: boolean;
  readonly manifestMaxBytes?: number;
  readonly segmentMaxBytes?: number;
  readonly timeoutMs?: number;
}

const MEDIA_TARGET_FIELDS: readonly string[] = [
  'protocol',
  'manifestUri',
  'selectedRenditionUri',
  'artifactFileName',
  'allowedManifestOrigins',
  'allowedSegmentOrigins',
  'budget',
  'fixtureLoopbackHttp',
  'manifestMaxBytes',
  'segmentMaxBytes',
  'timeoutMs',
];

function boundedOptionalString(value: unknown, max: number): boolean {
  return (
    value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= max)
  );
}

function boundedOptionalCount(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

function originArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 255)
  );
}

/**
 * Exact-key fail-closed record validation. Unknown fields are refused, never
 * dropped: a seeded record cannot carry a wider shape than this lane
 * forwards. Origin/budget grammar is re-validated by the T06 bridge at
 * dispatch (the derived permit is decoded there); this check keeps malformed
 * seeds out of the trusted registry itself.
 */
export function validateMediaTargetRecord(
  input: unknown,
): DomainValidationResult<MediaTargetRecord> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'record',
        'media target record must be a plain object',
      ),
    ]);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MEDIA_TARGET_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown media target record field is refused: ${key}`,
        ),
      ]);
    }
  }
  if (record.protocol !== 'HLS') {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'protocol',
        `media target records declare ${MEDIA_REGISTRY_PROTOCOLS.join(', ')} only`,
      ),
    ]);
  }
  if (
    typeof record.manifestUri !== 'string' ||
    record.manifestUri.length === 0 ||
    record.manifestUri.length > 2048
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'manifestUri',
        'manifestUri must be a bounded absolute locator string',
      ),
    ]);
  }
  try {
    void new URL(record.manifestUri);
  } catch {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'manifestUri',
        'manifestUri must parse as an absolute URL',
      ),
    ]);
  }
  if (!boundedOptionalString(record.selectedRenditionUri, 2048)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'selectedRenditionUri',
        'selectedRenditionUri must be a bounded string',
      ),
    ]);
  }
  if (!boundedOptionalString(record.artifactFileName, 64)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'artifactFileName',
        'artifactFileName must be a bounded file name',
      ),
    ]);
  }
  if (!originArray(record.allowedManifestOrigins) || !originArray(record.allowedSegmentOrigins)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'allowedManifestOrigins',
        'allowed origin lists must be non-empty arrays of bounded origin strings',
      ),
    ]);
  }
  const budget = decodeBudgetProfile(record.budget);
  if (!budget.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'budget',
        'budget must decode as a canonical complete BudgetProfile',
      ),
    ]);
  }
  if (record.fixtureLoopbackHttp !== undefined && typeof record.fixtureLoopbackHttp !== 'boolean') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'fixtureLoopbackHttp',
        'fixtureLoopbackHttp must be a boolean',
      ),
    ]);
  }
  if (
    !boundedOptionalCount(record.manifestMaxBytes) ||
    !boundedOptionalCount(record.segmentMaxBytes) ||
    !boundedOptionalCount(record.timeoutMs)
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'bounds',
        'manifestMaxBytes/segmentMaxBytes/timeoutMs must be positive safe integers',
      ),
    ]);
  }
  // Optional fields, narrowed from the guards above (the guards refused every
  // non-conforming shape, so these casts are check-then-assert, never trust).
  const selectedRenditionUri =
    record.selectedRenditionUri === undefined ? undefined : (record.selectedRenditionUri as string);
  const artifactFileName =
    record.artifactFileName === undefined ? undefined : (record.artifactFileName as string);
  const fixtureLoopbackHttp = record.fixtureLoopbackHttp === true ? true : undefined;
  const manifestMaxBytes =
    record.manifestMaxBytes === undefined ? undefined : (record.manifestMaxBytes as number);
  const segmentMaxBytes =
    record.segmentMaxBytes === undefined ? undefined : (record.segmentMaxBytes as number);
  const timeoutMs = record.timeoutMs === undefined ? undefined : (record.timeoutMs as number);
  const value: MediaTargetRecord = deepFreeze({
    protocol: 'HLS',
    manifestUri: record.manifestUri,
    ...(selectedRenditionUri === undefined ? {} : { selectedRenditionUri }),
    ...(artifactFileName === undefined ? {} : { artifactFileName }),
    allowedManifestOrigins: deepFreeze([...(record.allowedManifestOrigins as readonly string[])]),
    allowedSegmentOrigins: deepFreeze([...(record.allowedSegmentOrigins as readonly string[])]),
    budget: budget.value,
    ...(fixtureLoopbackHttp === undefined ? {} : { fixtureLoopbackHttp }),
    ...(manifestMaxBytes === undefined ? {} : { manifestMaxBytes }),
    ...(segmentMaxBytes === undefined ? {} : { segmentMaxBytes }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return ok(value);
}

export interface MediaTargetRefSeed {
  readonly handle: string;
  readonly record: unknown;
}

/**
 * In-memory media targetRef registry seeded by the trusted composition.
 * Mirrors the T04 registry contract: handles are bounded opaque tokens (never
 * locator-shaped), records are exact-key validated, and resolution is a plain
 * map get — a locator-shaped targetRef can never resolve, not even by
 * coincidence of the map contents.
 */
export class InMemoryMediaTargetRegistry {
  private readonly entries = new Map<string, MediaTargetRecord>();

  constructor(seeds: readonly MediaTargetRefSeed[] = []) {
    for (const seed of seeds) {
      const registered = this.register(seed.handle, seed.record);
      if (!registered.ok) {
        throw new Error(
          `MEDIA_REGISTRY_SEED_REFUSED: ${registered.diagnostics.map((entry) => entry.code).join(', ')}`,
        );
      }
    }
  }

  /** Seed one handle; locator-shaped handles and malformed records refuse. */
  register(handle: string, record: unknown): DomainValidationResult<MediaTargetRecord> {
    if (
      typeof handle !== 'string' ||
      handle.length === 0 ||
      !REFERENCE_TOKEN_PATTERN.test(handle)
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'targetRef',
          `registry handle must match the bounded token grammar ${String(REFERENCE_TOKEN_PATTERN)}`,
        ),
      ]);
    }
    if (isRawLocatorShape(handle)) {
      return fail([
        diagnostic(
          'LOCATOR_SUBSTITUTION_REJECTED',
          'targetRef',
          'registry handle is shaped like a raw URL/path locator; handles are opaque tokens and are never parsed as locators',
        ),
      ]);
    }
    const validated = validateMediaTargetRecord(record);
    if (!validated.ok) {
      return validated;
    }
    this.entries.set(handle, validated.value);
    return ok(validated.value);
  }

  /** Resolve a confirmed intent's opaque targetRef to its media delivery facts. */
  resolve(targetRef: string): DomainValidationResult<MediaTargetRecord> {
    if (typeof targetRef !== 'string' || targetRef.length === 0) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'targetRef',
          'targetRef must be a non-empty handle token',
        ),
      ]);
    }
    if (isRawLocatorShape(targetRef)) {
      return fail([
        diagnostic(
          'LOCATOR_SUBSTITUTION_REJECTED',
          'targetRef',
          'targetRef is shaped like a raw URL/path locator; only opaque registry handles resolve',
        ),
      ]);
    }
    const record = this.entries.get(targetRef);
    if (record === undefined) {
      return fail([
        diagnostic(
          'CONTRACT_BINDING_MISMATCH',
          'targetRef',
          `targetRef '${targetRef}' is not a handle bound in the injected media registry`,
        ),
      ]);
    }
    return ok(record);
  }
}
