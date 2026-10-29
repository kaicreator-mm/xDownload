/**
 * v0.2 T06 — media C/Host bridge-seam Kernel permit (self-held types).
 *
 * The media bridge executes only after the selected Kernel issues a durable
 * permit for one confirmed media acquisition. No other lane's permit type is
 * imported: this seam is owned by the media lane and validated fail-closed
 * from `unknown` (exact keys, no widening), mirroring the T04 direct-lane
 * gate pattern. A missing/mismatched permit refuses the operation with a
 * typed diagnostic BEFORE any network or filesystem effect can exist.
 *
 * Pure contract/validation layer: constructing or validating a permit never
 * performs I/O and grants no authority by itself.
 */
import {
  decodeBudgetProfile,
  diagnostic,
  fail,
  ok,
  type BudgetProfile,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import {
  INTENT_FIELD_PATTERN,
  REFERENCE_TOKEN_PATTERN,
} from '../../../download-domain-app/src/contracts/index.ts';

/** The only C operation this lane executes (frozen v0.2 operation vocabulary). */
export const MEDIA_ACQUIRE_OPERATION = 'media.acquire';

/**
 * Kernel-issued permit binding one confirmed media intent to its authorized
 * network scope and transfer budget. The bridge refuses to execute unless
 * this permit validates and binds the exact confirmed intent being executed.
 */
export interface MediaAcquisitionPermit {
  readonly kind: 'media-acquisition-permit';
  readonly permitId: string;
  readonly operationId: 'media.acquire';
  /** Must equal the confirmed intent's requestId (single-effect binding). */
  readonly requestId: string;
  /** Must equal the confirmed intent's lineageId (single-lineage binding). */
  readonly lineageId: string;
  /** Exact manifest/media-playlist origins the Kernel authorized. */
  readonly allowedManifestOrigins: readonly string[];
  /** Exact segment origins the Kernel authorized. */
  readonly allowedSegmentOrigins: readonly string[];
  /** Canonical complete budget profile (single budget truth for the effect). */
  readonly budget: BudgetProfile;
}

const PERMIT_FIELDS = [
  'kind',
  'permitId',
  'operationId',
  'requestId',
  'lineageId',
  'allowedManifestOrigins',
  'allowedSegmentOrigins',
  'budget',
] as const;

function validateOriginList(
  value: unknown,
  path: string,
): DomainValidationResult<readonly string[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, `${path} must be a 1..32 element origin array`),
    ]);
  }
  const origins = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', path, `${path} entries must be strings`),
      ]);
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', path, `${path} entries must be absolute URLs`),
      ]);
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.pathname !== '/' ||
      parsed.origin !== raw ||
      origins.has(raw)
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          path,
          `${path} entries must be unique, exact, credential-free http(s) origins`,
        ),
      ]);
    }
    origins.add(raw);
  }
  return ok([...origins]);
}

/**
 * Exact-key fail-closed permit validation. Unknown fields are refused, never
 * dropped: an enlarged permit cannot silently grow after the Kernel sealed it.
 */
export function validateMediaAcquisitionPermit(
  input: unknown,
): DomainValidationResult<MediaAcquisitionPermit> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'permit',
        'media acquisition requires a Kernel permit object (refused before any effect)',
      ),
    ]);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(PERMIT_FIELDS as readonly string[]).includes(key)) {
      return fail([
        diagnostic('SCOPE_WIDENING_REFUSED', key, `unknown permit field is refused: ${key}`),
      ]);
    }
  }
  if (record.kind !== 'media-acquisition-permit') {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'permit.kind',
        "permit.kind must be 'media-acquisition-permit'",
      ),
    ]);
  }
  if (typeof record.permitId !== 'string' || !REFERENCE_TOKEN_PATTERN.test(record.permitId)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'permitId', 'permitId must be a bounded opaque token'),
    ]);
  }
  if (record.operationId !== MEDIA_ACQUIRE_OPERATION) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'operationId',
        `permit does not authorize ${MEDIA_ACQUIRE_OPERATION}`,
      ),
    ]);
  }
  for (const key of ['requestId', 'lineageId'] as const) {
    if (typeof record[key] !== 'string' || !INTENT_FIELD_PATTERN.test(record[key] as string)) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          key,
          `${key} must match ${INTENT_FIELD_PATTERN.source}`,
        ),
      ]);
    }
  }
  const manifestOrigins = validateOriginList(
    record.allowedManifestOrigins,
    'allowedManifestOrigins',
  );
  if (!manifestOrigins.ok) return manifestOrigins;
  const segmentOrigins = validateOriginList(record.allowedSegmentOrigins, 'allowedSegmentOrigins');
  if (!segmentOrigins.ok) return segmentOrigins;
  const budget = decodeBudgetProfile(record.budget);
  if (!budget.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'budget',
        'permit.budget must decode as a canonical complete BudgetProfile',
      ),
    ]);
  }
  return ok({
    kind: 'media-acquisition-permit',
    permitId: record.permitId,
    operationId: MEDIA_ACQUIRE_OPERATION,
    requestId: record.requestId as string,
    lineageId: record.lineageId as string,
    allowedManifestOrigins: manifestOrigins.value,
    allowedSegmentOrigins: segmentOrigins.value,
    budget: budget.value,
  });
}
