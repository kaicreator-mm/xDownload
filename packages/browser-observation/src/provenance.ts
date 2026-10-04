/**
 * T010 observation provenance (frozen L2 §6.4 / invariant 11).
 *
 * Every observation carries tab/frame/origin/request provenance. A record
 * without complete provenance can never cross into a privileged context:
 * provenance binding is what keeps an observation an evidence input instead
 * of self-certifying authority.
 */

import {
  RAW_SECRET_FIELD_NAMES,
  asRecord,
  diagnostic,
  fail,
  must,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireInteger,
  requireNonEmptyString,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

const PROVENANCE_KEYS: readonly string[] = [
  'tabId',
  'frameId',
  'origin',
  'requestRef',
  'partition',
] as const;

/** Origin values must be exact http(s) origins — never paths, never wildcards. */
const ORIGIN_PATTERN =
  /^https:\/\/[A-Za-z0-9._~:-]+(?::\d{1,5})?$|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

export interface ObservationProvenance {
  /** Browser tab identity assigned by the privileged extension context. */
  readonly tabId: number;
  /** Frame identity inside the tab (0 = main frame; sub-frames are distinct). */
  readonly frameId: number;
  /** Exact origin of the observed frame. */
  readonly origin: string;
  /** Opaque reference to the observed request when the kind is request-bound. */
  readonly requestRef?: string;
  /**
   * Partition context where browser state is partition-aware (cookie store
   * partitions). Binding context only — never authority to widen scope.
   */
  readonly partition?: string;
}

export function decodeObservationProvenance(
  value: unknown,
  path: string,
): DomainValidationResult<ObservationProvenance> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = asRecord(value, path);
  if (!record.ok) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'observation provenance must be an object'),
    ]);
  }
  const unknown = rejectUnknownFields(record.value, PROVENANCE_KEYS, path);
  if (!unknown.ok) {
    return unknown;
  }
  const rawSecrets = rejectRawSecretFields(record.value, path);
  if (!rawSecrets.ok) {
    return rawSecrets;
  }
  const tabId = must(requireInteger(record.value, 'tabId', path), diagnostics);
  if (tabId !== undefined && tabId < 0) {
    diagnostics.push(
      diagnostic('MALFORMED_REQUIRED_FIELD', join(path, 'tabId'), 'tabId must be >= 0'),
    );
  }
  const frameId = must(requireInteger(record.value, 'frameId', path), diagnostics);
  if (frameId !== undefined && frameId < 0) {
    diagnostics.push(
      diagnostic('MALFORMED_REQUIRED_FIELD', join(path, 'frameId'), 'frameId must be >= 0'),
    );
  }
  const origin = must(requireNonEmptyString(record.value, 'origin', path), diagnostics);
  if (origin !== undefined && !ORIGIN_PATTERN.test(origin)) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        join(path, 'origin'),
        'observation origin must be an exact http(s) origin (https always; http only for loopback)',
      ),
    );
  }
  const requestRef = must(
    requireOptionalNonEmptyString(record.value, 'requestRef', path),
    diagnostics,
  );
  const partition = must(
    requireOptionalNonEmptyString(record.value, 'partition', path),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const provenance: ObservationProvenance = {
    tabId: tabId!,
    frameId: frameId!,
    origin: origin!,
    ...(requestRef === undefined ? {} : { requestRef }),
    ...(partition === undefined ? {} : { partition }),
  };
  return { ok: true, value: Object.freeze(provenance) };
}

/** Raw-secret keys can never cross the observation boundary, even nested. */
export function containsRawSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRawSecretKey(item));
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (RAW_SECRET_FIELD_NAMES.has(key) || containsRawSecretKey(child)) {
        return true;
      }
    }
  }
  return false;
}

function requireOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): DomainValidationResult<string | undefined> {
  if (!(key in record) || record[key] === undefined) {
    return { ok: true, value: undefined };
  }
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path === '' ? key : `${path}.${key}`,
        'must be a non-empty string when present',
      ),
    ]);
  }
  return { ok: true, value };
}

function join(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}
