/**
 * V022 A01 — neutral Host-operation contracts: opaque targetRef grammar.
 *
 * The confirmed targetRef is ONLY an opaque resolution handle. Both Domain
 * App (sealing the intent) and the trusted Host (resolving the handle
 * through its injected registry) must apply the exact same grammar, so the
 * single definition lives here. A value shaped like a raw locator (absolute
 * URI with a scheme, a leading filesystem separator, or a drive-letter
 * path) is refused: raw locators are never a C config authority and are
 * never parsed into a handle. Pure: no URL constructor, no path join, no
 * I/O.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';

/** The bounded opaque-token grammar a targetRef/registry handle must match. */
export const REFERENCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

const RAW_LOCATOR_URI_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * True when the value is shaped like a raw locator. This is a NEGATIVE
 * assertion only — it never extracts or interprets a locator; it exists so
 * a locator-shaped handle can never enter or pass through the boundary.
 */
export function isRawLocatorShape(value: string): boolean {
  return (
    RAW_LOCATOR_URI_PATTERN.test(value) || /^[/\\]/.test(value) || /^[A-Za-z]:[/\\]/.test(value)
  );
}

/**
 * Validate an opaque targetRef handle: bounded token grammar plus the
 * explicit raw-locator negative. Fail-closed; the returned value is the
 * original token (handles stay opaque — nothing here resolves them).
 */
export function validateOpaqueTargetRef(value: unknown): DomainValidationResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'targetRef',
        `targetRef must be a bounded opaque token matching ${REFERENCE_TOKEN_PATTERN.source}`,
      ),
    ]);
  }
  // Raw-locator shapes refuse with their dedicated diagnostic even when they
  // would also violate the token grammar (e.g. '/etc/passwd'): a locator
  // substitution is a stronger statement than a malformed handle.
  if (isRawLocatorShape(value)) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        'targetRef',
        'targetRef is shaped like a raw URL/path locator; handles are opaque tokens and are never parsed as locators',
      ),
    ]);
  }
  if (!REFERENCE_TOKEN_PATTERN.test(value)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'targetRef',
        `targetRef must be a bounded opaque token matching ${REFERENCE_TOKEN_PATTERN.source}`,
      ),
    ]);
  }
  return ok(value);
}
