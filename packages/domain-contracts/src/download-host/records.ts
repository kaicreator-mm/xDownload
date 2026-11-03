/**
 * V022 A01 — neutral Host-operation contracts: stable-record helpers.
 *
 * Internal defensive primitives shared by the exact-key Host request
 * validators. A request DTO is decoded from untrusted `unknown` input, so
 * the decode step must survive hostile objects (revoked proxies, accessors,
 * symbol keys) without throwing and without admitting non-plain shapes.
 * Pure: no I/O, no Node APIs, no App/Host/Core imports.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';

/**
 * Snapshot a value as a plain own-enumerable data record. Refuses arrays,
 * class instances, accessors, non-enumerable fields and symbol keys so the
 * exact-key check below can never be widened by object-geometry tricks.
 */
export function stableRecord(
  value: unknown,
  path: string,
): DomainValidationResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, path + ' must be a plain data object'),
    ]);
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', path, path + ' must be a plain data object'),
      ]);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        return fail([
          diagnostic('SCOPE_WIDENING_REFUSED', path, 'symbol fields are not permitted'),
        ]);
      }
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            path + '.' + key,
            'accessor/non-enumerable fields are refused',
          ),
        ]);
      }
      snapshot[key] = descriptor.value;
    }
    return ok(snapshot);
  } catch {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'hostile or revoked object is refused'),
    ]);
  }
}

/**
 * Exact-key no-widening check: unknown keys refuse (never drop silently),
 * required keys must be own-present. Keys listed in `optional` may be
 * absent; every other key in `keys` must be present.
 */
export function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): DomainValidationResult<void> {
  const allowed = new Set<string>(keys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    return fail([
      diagnostic('SCOPE_WIDENING_REFUSED', path + '.' + unknown, 'unknown field is refused'),
    ]);
  }
  const optionalSet = new Set<string>(optional);
  const missing = keys.find((key) => !optionalSet.has(key) && !Object.hasOwn(record, key));
  if (missing !== undefined) {
    return fail([
      diagnostic('MISSING_REQUIRED_FIELD', path + '.' + missing, 'required field is missing'),
    ]);
  }
  return ok(undefined);
}
