/**
 * T008 integrity hooks mapped to the frozen PRD §22 validation layers, as
 * applicable to direct single-file transfer (S1: Transfer/Format/Target,
 * S3 additionally Media). Every hook is fail-closed: transfer alone never
 * makes an artifact accepted, and truncated/corrupt/wrong-target bytes are
 * reported truthfully instead of normalized into success (frozen L2
 * invariant 18, counterexamples C09/C27).
 */

import { createHash } from 'node:crypto';
import type { MediaPolicy, RepresentationIdentity, ValidationLayerOutcome } from './port.ts';

export interface TransferValidationInput {
  readonly status: number;
  readonly sentRange: boolean;
  readonly resumeOffsetBytes: number;
  readonly responseIdentity: RepresentationIdentity;
  readonly receivedBytes: number;
  readonly expectedTotalBytes?: number;
  readonly contentRange: string | undefined;
}

/**
 * Transfer Validation (PRD §22): byte/range completeness and response
 * consistency — the received byte total must match the declared response
 * length (offset-aware for `206`), a declared expected total must match, and
 * a `206` must line up with the requested resume offset via `Content-Range`.
 */
export function validateTransfer(input: TransferValidationInput): ValidationLayerOutcome {
  const declared = input.responseIdentity.contentLength;
  if (input.responseIdentity.invalidContentLength === true) {
    return failed(
      'transfer',
      'INVALID_CONTENT_LENGTH',
      'response Content-Length is not a non-negative safe integer',
    );
  }

  if (input.status === 206 && input.sentRange) {
    const range = parseContentRangeHeader(input.contentRange);
    if (range === undefined) {
      return failed('transfer', 'MISSING_CONTENT_RANGE', '206 response without Content-Range');
    }
    if (range.start !== input.resumeOffsetBytes) {
      return failed(
        'transfer',
        'RANGE_MISMATCH',
        `206 range starts at ${String(range.start)} but resume offset was ${String(input.resumeOffsetBytes)}`,
      );
    }
    if (
      input.expectedTotalBytes !== undefined &&
      range.total !== undefined &&
      range.total !== input.expectedTotalBytes
    ) {
      return failed(
        'transfer',
        'RANGE_MISMATCH',
        `206 declares total ${String(range.total)} but the frozen target declares ${String(input.expectedTotalBytes)}`,
      );
    }
    const declaredSliceBytes = range.end - range.start + 1;
    if (declared !== undefined && declared !== declaredSliceBytes) {
      return failed(
        'transfer',
        'RANGE_LENGTH_MISMATCH',
        `Content-Length ${String(declared)} does not match Content-Range span ${String(declaredSliceBytes)}`,
      );
    }
    const expectedTotal = range.total ?? input.expectedTotalBytes;
    if (expectedTotal === undefined) {
      return failed(
        'transfer',
        'RANGE_TOTAL_UNKNOWN',
        'a resumed 206 response without an authoritative total cannot prove completion',
      );
    }
    if (range.end + 1 !== expectedTotal) {
      return failed(
        'transfer',
        'RANGE_MISMATCH',
        `206 range ends at ${String(range.end)} but the authoritative total is ${String(expectedTotal)}`,
      );
    }
    if (input.receivedBytes !== expectedTotal) {
      return failed(
        'transfer',
        'TRUNCATED_BODY',
        `resume from ${String(input.resumeOffsetBytes)} with ${String(declared ?? 0)} declared slice bytes yields ${String(expectedTotal)} total, but received ${String(input.receivedBytes)}`,
      );
    }
    return { layer: 'transfer', passed: true };
  }

  const expectedTotal = declared ?? input.expectedTotalBytes;
  if (expectedTotal !== undefined && input.receivedBytes !== expectedTotal) {
    return failed(
      'transfer',
      'TRUNCATED_BODY',
      `declared content length ${String(expectedTotal)} but received ${String(input.receivedBytes)} bytes`,
    );
  }
  if (
    input.expectedTotalBytes !== undefined &&
    declared !== undefined &&
    declared !== input.expectedTotalBytes
  ) {
    return failed(
      'transfer',
      'RESPONSE_INCONSISTENT',
      `response declares ${String(declared)} bytes but the frozen target declares ${String(input.expectedTotalBytes)}`,
    );
  }
  return { layer: 'transfer', passed: true };
}

function parseContentRangeHeader(
  value: string | undefined,
): { start: number; end: number; total?: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalRaw = match[3];
  const total = totalRaw === '*' || totalRaw === undefined ? undefined : Number(totalRaw);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (total !== undefined && (!Number.isSafeInteger(total) || total <= end))
  ) {
    return undefined;
  }
  return { start, end, ...(total === undefined ? {} : { total }) };
}

const HTML_SNIFF_PATTERN = /^\s*(?:<!doctype html|<html[\s>])/i;

export interface FormatValidationInput {
  readonly contentType: string | undefined;
  readonly bodyPrefix: Uint8Array;
  readonly expectedContentTypePrefix?: string;
}

/**
 * Format Validation (PRD §22): parseability/container checks including
 * rejection of login/error HTML masquerading as target content.
 */
export function validateFormat(input: FormatValidationInput): ValidationLayerOutcome {
  const contentType = input.contentType ?? '';
  const lowered = contentType.toLowerCase();
  if (lowered.startsWith('text/html')) {
    return failed(
      'format',
      'HTML_MASQUERADE_REJECTED',
      `content-type '${contentType}' indicates a login/error page, not target content`,
    );
  }
  const prefixText = new TextDecoder('utf-8', { fatal: false }).decode(
    input.bodyPrefix.subarray(0, 512),
  );
  if (HTML_SNIFF_PATTERN.test(prefixText)) {
    return failed(
      'format',
      'HTML_MASQUERADE_REJECTED',
      'body begins with an HTML document; login/error HTML cannot masquerade as target content',
    );
  }
  if (
    input.expectedContentTypePrefix !== undefined &&
    !lowered.startsWith(input.expectedContentTypePrefix.toLowerCase())
  ) {
    return failed(
      'format',
      'CONTENT_TYPE_MISMATCH',
      `content-type '${contentType}' does not match declared '${input.expectedContentTypePrefix}'`,
    );
  }
  return { layer: 'format', passed: true };
}

export interface TargetValidationInput {
  readonly bytes: Uint8Array;
  readonly expectedSha256?: string;
  readonly expectedTotalBytes?: number;
  /**
   * The URI that actually served the acquired bytes (last hop of the
   * realized locator chain); required for the provenance Target basis.
   */
  readonly servedUri?: string;
  /** The user-selected delivery locator the acquisition was bound to. */
  readonly originUri?: string;
  /** The declared delivery graph's admissible hosts (user-selected URI host included). */
  readonly declaredRedirectHosts?: readonly string[];
  /** Delivery-graph slice: S3 declarations are host-level (bare hostnames). */
  readonly slice?: 'S1' | 'S3';
}

/**
 * Target Validation (PRD §22): the acquired resource matches the
 * requested/confirmed frozen identity. Technically valid bytes of a
 * different variant are rejected — validity alone is not the Target claim
 * (counterexample C09).
 *
 * Two truthful bases exist (C34):
 * - `PUBLISHED_SHA256` — the request declared an independently published
 *   digest; the acquired bytes must match it exactly.
 * - `REQUESTED_LOCATOR_PROVENANCE` — no publisher anchor exists; the claim
 *   is explicitly structural: the bytes must have been served by a URI
 *   inside the declared delivery graph rooted at the user-selected locator.
 *   The digest is computed for corruption detection downstream and is NEVER
 *   promoted to an independent identity oracle.
 *
 * Without the provenance facts (served URI + declared graph) the provenance
 * basis cannot make a truthful claim and fails NOT_VALIDATED — it never
 * passes on absence of evidence.
 */
export function validateTarget(input: TargetValidationInput): ValidationLayerOutcome {
  // Size is evidence on BOTH bases: a declared total the acquired bytes
  // contradict fails the Target layer before any identity claim is made.
  if (input.expectedTotalBytes !== undefined && input.bytes.length !== input.expectedTotalBytes) {
    return failed(
      'target',
      'SIZE_MISMATCH',
      `acquired ${String(input.bytes.length)} bytes but the frozen target declares ${String(input.expectedTotalBytes)}`,
    );
  }
  if (input.expectedSha256 === undefined) {
    if (
      input.servedUri === undefined ||
      input.originUri === undefined ||
      input.declaredRedirectHosts === undefined
    ) {
      return failed(
        'target',
        'TARGET_PROVENANCE_NOT_VALIDATED',
        'no published digest anchor and no provenance facts (served URI / declared delivery graph); the Target claim cannot be truthfully made',
      );
    }
    let served: URL;
    try {
      served = new URL(input.servedUri);
    } catch {
      return failed(
        'target',
        'TARGET_PROVENANCE_INVALID',
        `the serving URI '${input.servedUri}' is not a resolvable URI inside the declared delivery graph`,
      );
    }
    if (served.protocol !== 'http:' && served.protocol !== 'https:') {
      return failed(
        'target',
        'TARGET_PROVENANCE_INVALID',
        `the serving URI '${input.servedUri}' is outside the http(s) declared delivery graph`,
      );
    }
    const originProtocol = /^https:/iu.test(input.originUri) ? 'https:' : 'http:';
    if (originProtocol === 'https:' && served.protocol !== 'https:') {
      return failed(
        'target',
        'TARGET_PROVENANCE_INVALID',
        `the serving URI '${input.servedUri}' downgrades the confirmed https delivery graph onto plaintext http`,
      );
    }
    const slice = input.slice ?? 'S1';
    const admitted =
      slice === 'S1'
        ? input.declaredRedirectHosts.includes(served.host)
        : input.declaredRedirectHosts.some(
            (entry) => entry === served.host || (!entry.includes(':') && entry === served.hostname),
          );
    if (!admitted) {
      return failed(
        'target',
        'TARGET_PROVENANCE_INVALID',
        `the serving URI host '${served.host}' is not inside the declared delivery graph rooted at '${input.originUri}'`,
      );
    }
    return { layer: 'target', passed: true };
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256)) {
    return failed(
      'target',
      'MALFORMED_IDENTITY_ANCHOR',
      'expectedSha256 must be lowercase hex sha-256',
    );
  }
  const digest = createHash('sha256').update(input.bytes).digest('hex');
  if (digest !== input.expectedSha256) {
    return failed(
      'target',
      'DIGEST_MISMATCH',
      `acquired bytes digest ${digest} does not match the frozen target identity anchor ${input.expectedSha256}`,
    );
  }
  return { layer: 'target', passed: true };
}

export interface MediaValidationInput {
  readonly bytes: Uint8Array;
  readonly policy: MediaPolicy;
}

/**
 * Media Validation (PRD §22, S3): expected tracks/media presence via
 * declared byte signatures (container/track sanity). A confirmed candidate
 * with a missing required track/structure cannot pass (counterexample C27).
 */
export function validateMedia(input: MediaValidationInput): ValidationLayerOutcome {
  // T008 is exported to JavaScript callers, even though TypeScript types the
  // request. Runtime-invalid external policies must fail as Media validation,
  // not throw before the canonical negative terminal can be projected.
  const signatures = input.policy?.signatures;
  if (!Array.isArray(signatures)) {
    return failed('media', 'MALFORMED_MEDIA_POLICY', 'media signatures must be an array');
  }
  // S3 Media is a required, independent validation dimension. Neither an
  // omitted policy nor an empty required-signature set can be evidence that
  // an MP4/audio track or container is actually valid (#105 / PRD §28).
  if (signatures.length === 0) {
    return failed(
      'media',
      'MEDIA_POLICY_REQUIRED',
      'no independently applicable media structure check was declared',
    );
  }
  if (signatures.length > 16) {
    return failed('media', 'MALFORMED_MEDIA_POLICY', 'too many media signatures');
  }
  for (const signature of signatures) {
    if (
      typeof signature !== 'object' ||
      signature === null ||
      typeof signature.hex !== 'string' ||
      signature.hex.length > 128 ||
      !Number.isSafeInteger(signature.offset) ||
      signature.offset < 0 ||
      typeof signature.label !== 'string' ||
      signature.label.trim().length === 0 ||
      signature.label.length > 128
    ) {
      return failed('media', 'MALFORMED_MEDIA_POLICY', 'invalid bounded media signature');
    }
    const required = signatureBytes(signature.hex);
    if (required === undefined) {
      return failed('media', 'MALFORMED_MEDIA_POLICY', `signature '${signature.hex}' is not hex`);
    }
    if (signature.offset + required.length > input.bytes.length) {
      return failed(
        'media',
        'MEDIA_STRUCTURE_MISSING',
        `required media structure '${signature.label}' at offset ${String(signature.offset)} is beyond the acquired bytes`,
      );
    }
    for (let index = 0; index < required.length; index += 1) {
      if (input.bytes[signature.offset + index] !== required[index]) {
        return failed(
          'media',
          'MEDIA_STRUCTURE_MISSING',
          `required media structure '${signature.label}' missing at offset ${String(signature.offset)}`,
        );
      }
    }
  }
  return { layer: 'media', passed: true };
}

function signatureBytes(hex: string): number[] | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return undefined;
  }
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

function failed(
  layer: 'transfer' | 'format' | 'target' | 'media',
  code: string,
  failure: string,
): ValidationLayerOutcome {
  return { layer, passed: false, failure, code };
}
