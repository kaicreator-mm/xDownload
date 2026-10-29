/**
 * v0.2 T04 — TargetRef registry resolver (trusted Host side).
 *
 * A confirmed download intent carries an OPAQUE `targetRef` (frozen T01
 * contract). The targetRef is ONLY a handle into an injected registry: the
 * resolver looks the handle up and returns the delivery facts the registry
 * was seeded with. This module NEVER parses a targetRef as a URL or a
 * filesystem path — there is no URL constructor, no path join and no scheme
 * inspection on the handle anywhere below, and both `register` and `resolve`
 * assert the explicit negative (`isRawLocatorShape`) so a raw locator can
 * never enter or pass through the registry as a handle. Unknown handles and
 * locator-shaped handles are typed refusals, never guesses.
 *
 * The Host trusts the registry because the registry is seeded by the trusted
 * composition (the same authority that sealed the intent), not because the
 * handle itself carries any meaning.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '@xdownload/domain-contracts';
import { REFERENCE_TOKEN_PATTERN } from '@xdownload/download-domain-app/src/contracts/index.ts';

/** Delivery facts a registry handle resolves to (locator + declared policy). */
export interface TargetRefRecord {
  /** Delivery locator URI of the frozen logical target. */
  readonly uri: string;
  /**
   * Declared redirect/CDN hosts for the delivery graph. This is the SINGLE
   * SOURCE the bridge forwards as `allowedRedirectHosts`; nothing else may
   * enlarge it (ADR-011 / C29 — redirects can never widen the scope).
   */
  readonly allowedRedirectHosts: readonly string[];
  /** Optional registry-declared total size (fallback for an intent without one). */
  readonly expectedTotalBytes?: number;
}

/** The T01 grammar a handle must satisfy: bounded opaque token, never a locator. */
export interface TargetRefRegistry {
  /** Resolve an opaque handle to its delivery facts; unknown handle is a typed refusal. */
  resolve(targetRef: string): DomainValidationResult<TargetRefRecord>;
}

const RAW_LOCATOR_URI_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * True when the value is shaped like a raw locator (absolute URI with a
 * scheme, a leading filesystem path separator, or a drive-letter path).
 * Mirrors the raw-locator grammar of the T01 intent contract; used ONLY as a
 * negative assertion on handles — never to parse a handle into a locator.
 */
export function isRawLocatorShape(value: string): boolean {
  return RAW_LOCATOR_URI_PATTERN.test(value) || /^[/\\]/.test(value) || /^[A-Za-z]:[/\\]/.test(value);
}

/** In-memory TargetRef registry seeded by the trusted composition. */
export class InMemoryTargetRefRegistry implements TargetRefRegistry {
  private readonly entries = new Map<string, TargetRefRecord>();

  constructor(entries: ReadonlyMap<string, TargetRefRecord> = new Map()) {
    for (const [handle, record] of entries) {
      const registered = this.register(handle, record);
      if (!registered.ok) {
        throw new Error(
          `seed handle refused by the registry contract: ${registered.diagnostics.map((entry) => entry.code).join(', ')}`,
        );
      }
    }
  }

  /**
   * Seed one handle. An explicit assertion refuses locator-shaped handles:
   * a handle that parses as a URL/path is by definition not an opaque
   * registry token (T01 R1 P2 — the targetRef must never BE a locator).
   */
  register(handle: string, record: TargetRefRecord): DomainValidationResult<TargetRefRecord> {
    if (typeof handle !== 'string' || handle.length === 0 || !REFERENCE_TOKEN_PATTERN.test(handle)) {
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
    if (typeof record.uri !== 'string' || record.uri.length === 0 || record.uri.length > 2048) {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', 'record.uri', 'record uri must be a bounded delivery locator string'),
      ]);
    }
    if (
      !Array.isArray(record.allowedRedirectHosts) ||
      record.allowedRedirectHosts.some((host) => typeof host !== 'string' || host.length === 0 || host.length > 255)
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'record.allowedRedirectHosts',
          'allowedRedirectHosts must be an array of bounded host tokens',
        ),
      ]);
    }
    if (
      record.expectedTotalBytes !== undefined &&
      (typeof record.expectedTotalBytes !== 'number' ||
        !Number.isSafeInteger(record.expectedTotalBytes) ||
        record.expectedTotalBytes <= 0)
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'record.expectedTotalBytes',
          'expectedTotalBytes must be a positive safe integer',
        ),
      ]);
    }
    this.entries.set(handle, record);
    return ok(record);
  }

  /**
   * Resolve a confirmed intent's targetRef. Lookup is a plain map get on the
   * opaque token — no URL/path interpretation happens here (asserted), and
   * every failure is a typed refusal.
   */
  resolve(targetRef: string): DomainValidationResult<TargetRefRecord> {
    if (typeof targetRef !== 'string' || targetRef.length === 0) {
      return fail([
        diagnostic('MALFORMED_REQUIRED_FIELD', 'targetRef', 'targetRef must be a non-empty handle token'),
      ]);
    }
    if (isRawLocatorShape(targetRef)) {
      // Explicit no-parse assertion: a locator-shaped targetRef can never be
      // resolved, not even by coincidence of the map contents.
      return fail([
        diagnostic(
          'LOCATOR_SUBSTITUTION_REJECTED',
          'targetRef',
          'targetRef is shaped like a raw URL/path locator; only opaque registry handles resolve (raw locators are not a C config authority)',
        ),
      ]);
    }
    const record = this.entries.get(targetRef);
    if (record === undefined) {
      return fail([
        diagnostic(
          'CONTRACT_BINDING_MISMATCH',
          'targetRef',
          `targetRef '${targetRef}' is not a handle bound in the injected registry`,
        ),
      ]);
    }
    return ok(record);
  }
}
