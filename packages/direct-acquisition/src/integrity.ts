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
    const expectedTotal = range.total ?? input.resumeOffsetBytes + (declared ?? 0);
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
  const totalRaw = match[3];
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: totalRaw === '*' || totalRaw === undefined ? undefined : Number(totalRaw),
  };
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
  readonly expectedSha256: string;
  readonly expectedTotalBytes?: number;
}

/**
 * Target Validation (PRD §22): the acquired resource matches the
 * requested/confirmed frozen identity. Technically valid bytes of a
 * different variant are rejected — validity alone is not the Target claim
 * (counterexample C09).
 */
export function validateTarget(input: TargetValidationInput): ValidationLayerOutcome {
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256)) {
    return failed(
      'target',
      'MALFORMED_IDENTITY_ANCHOR',
      'expectedSha256 must be lowercase hex sha-256',
    );
  }
  if (input.expectedTotalBytes !== undefined && input.bytes.length !== input.expectedTotalBytes) {
    return failed(
      'target',
      'SIZE_MISMATCH',
      `acquired ${String(input.bytes.length)} bytes but the frozen target declares ${String(input.expectedTotalBytes)}`,
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
  for (const signature of input.policy.signatures) {
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
