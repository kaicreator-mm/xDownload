/**
 * T009 — media assembly/probe behind the replaceable tooling port.
 *
 * Frozen L2 invariant 19 + HLS VOD candidate rules: assembly and probing of
 * downloaded segments stay behind a replaceable port. The port consumes
 * canonical effect identity (bound rendition + planned segments) and returns
 * typed probe facts — it NEVER mints canonical EvidenceRecords or success
 * verdicts; evidence minting is the validation chain's canonical job.
 *
 * F1 record: the concrete tooling shipped here is a deterministic in-repo
 * synthetic assembly/probe implementation (`@xdownload/synthetic-media-probe`)
 * so tests stay local and deterministic; no external media CLI is invoked and
 * no license-bearing tool is introduced. Real tooling can replace the port
 * without changing the adapter or validation chain.
 *
 * Synthetic segment container format (fixture-level, deterministic):
 *   bytes 0..3   magic 'XDS4' (0x58 0x44 0x53 0x34)
 *   byte  4      codec class code (1 = xdv1-video, 2 = xdv1-audio)
 *   bytes 5..8   big-endian uint32 duration in centiseconds
 *   bytes 9..    deterministic payload filler
 */

import {
  deepFreeze,
  identitySetEquals,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import type { HlsRenditionBinding } from './bind.ts';
import type { SegmentPlan } from './plan.ts';
import type { SegmentAcquisitionOutcome } from './acquire.ts';

export const SYNTHETIC_MAGIC = 'XDS4';

export const CODEC_CLASS_CODES: Readonly<Record<string, number>> = deepFreeze({
  'xdv1-video': 1,
  'xdv1-audio': 2,
});

export interface TransferredSegment {
  readonly entry: SegmentAcquisitionOutcome['entry'];
  readonly bytes: Uint8Array;
}

export interface MediaAssemblyRequest {
  readonly binding: HlsRenditionBinding;
  readonly plan: SegmentPlan;
  readonly transferred: readonly TransferredSegment[];
}

export type ProbeCheck =
  | 'IDENTITY_SET_MATCHES_PLAN'
  | 'IDENTITY_MISMATCH'
  | 'ALL_SEGMENTS_VALID'
  | 'SEGMENT_CORRUPT_OR_TRUNCATED'
  | 'DURATION_CONSISTENT'
  | 'DURATION_MISMATCH'
  | 'MATCHES_DECLARED_RENDITION'
  | 'DIFFERS_FROM_DECLARED_RENDITION'
  | 'CONTAINER_MARKERS_PRESENT'
  | 'CONTAINER_MARKERS_ABSENT';

export interface MediaProbeReport {
  readonly observedIdentitySetMatchesPlan: boolean;
  readonly allSegmentsValid: boolean;
  readonly durationConsistent: boolean;
  readonly matchesDeclaredRendition: boolean;
  readonly containerMarkersPresent: boolean;
  readonly checks: readonly ProbeCheck[];
  readonly observedDurationSeconds: number;
  readonly plannedDurationSeconds: number;
  readonly observedCodecClass: string | undefined;
  readonly assembledByteCount: number;
}

/** What a probe run concluded; INSUFFICIENT_EVIDENCE can never become evidence later (C22). */
export type MediaAssemblyProbeOutcome =
  | { readonly kind: 'EVIDENCE'; readonly report: MediaProbeReport }
  | { readonly kind: 'INSUFFICIENT_EVIDENCE'; readonly detail: string };

export interface MediaAssemblyPort {
  readonly toolId: string;
  assembleAndProbe(
    request: MediaAssemblyRequest,
  ): DomainValidationResult<MediaAssemblyProbeOutcome>;
}

/** Deterministic default tooling: synthetic assembly + probe over fixture segment bytes. */
export function createSyntheticMediaAssemblyPort(): MediaAssemblyPort {
  return {
    toolId: '@xdownload/synthetic-media-probe/1',
    assembleAndProbe(request) {
      const checks: ProbeCheck[] = [];
      const transferredIdentities = request.transferred.map((segment) => segment.entry.identity);
      const plannedIdentities = request.plan.entries.map((entry) => entry.identity);
      // Identity-set correspondence (PRD §11): membership semantics, never counts.
      const identityMatch = identitySetEquals(transferredIdentities, plannedIdentities);
      checks.push(identityMatch ? 'IDENTITY_SET_MATCHES_PLAN' : 'IDENTITY_MISMATCH');
      let allValid = request.transferred.length > 0;
      let observedDurationCentis = 0;
      let observedCodecClass: string | undefined;
      let assembledBytes = 0;
      for (const segment of request.transferred) {
        const header = readSyntheticHeader(segment.bytes);
        if (header === undefined) {
          allValid = false;
          continue;
        }
        if (
          segment.entry.byterange !== undefined &&
          segment.bytes.length !== segment.entry.byterange.length
        ) {
          allValid = false;
          continue;
        }
        const expectedCentis = Math.round(segment.entry.durationSeconds * 100);
        if (header.durationCentis !== expectedCentis) {
          allValid = false;
          continue;
        }
        const codecName = codecNameForCode(header.codecClassCode);
        if (codecName === undefined) {
          allValid = false;
          continue;
        }
        if (observedCodecClass === undefined) {
          observedCodecClass = codecName;
        } else if (observedCodecClass !== codecName) {
          allValid = false;
          continue;
        }
        observedDurationCentis += header.durationCentis;
        assembledBytes += segment.bytes.length;
      }
      checks.push(allValid ? 'ALL_SEGMENTS_VALID' : 'SEGMENT_CORRUPT_OR_TRUNCATED');
      const plannedDurationSeconds = request.plan.entries.reduce(
        (total, entry) => total + entry.durationSeconds,
        0,
      );
      const durationConsistent =
        identityMatch && Math.abs(observedDurationCentis / 100 - plannedDurationSeconds) < 1e-9;
      checks.push(durationConsistent ? 'DURATION_CONSISTENT' : 'DURATION_MISMATCH');
      const declaredCodec = request.binding.declared.codecs[0];
      const renditionMatch =
        declaredCodec !== undefined &&
        observedCodecClass !== undefined &&
        observedCodecClass === declaredCodec;
      checks.push(
        renditionMatch ? 'MATCHES_DECLARED_RENDITION' : 'DIFFERS_FROM_DECLARED_RENDITION',
      );
      const containerMarkersPresent = request.transferred.every((segment) =>
        hasSyntheticMagic(segment.bytes),
      );
      checks.push(
        containerMarkersPresent ? 'CONTAINER_MARKERS_PRESENT' : 'CONTAINER_MARKERS_ABSENT',
      );
      return {
        ok: true,
        value: deepFreeze({
          kind: 'EVIDENCE' as const,
          report: deepFreeze({
            observedIdentitySetMatchesPlan: identityMatch,
            allSegmentsValid: allValid,
            durationConsistent,
            matchesDeclaredRendition: renditionMatch,
            containerMarkersPresent,
            checks,
            observedDurationSeconds: observedDurationCentis / 100,
            plannedDurationSeconds,
            observedCodecClass,
            assembledByteCount: assembledBytes,
          }),
        }),
      };
    },
  };
}

/** A probe tool that cannot produce evidence; the chain must stay INSUFFICIENT_EVIDENCE (C22). */
export function createEvidencelessMediaAssemblyPort(
  toolId: string,
  detail: string,
): MediaAssemblyPort {
  return {
    toolId,
    assembleAndProbe() {
      return deepFreeze({
        ok: true as const,
        value: deepFreeze({ kind: 'INSUFFICIENT_EVIDENCE' as const, detail }),
      });
    },
  };
}

interface SyntheticHeader {
  readonly codecClassCode: number;
  readonly durationCentis: number;
}

function hasSyntheticMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  const magic = SYNTHETIC_MAGIC;
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function readSyntheticHeader(bytes: Uint8Array): SyntheticHeader | undefined {
  if (!hasSyntheticMagic(bytes) || bytes.length < 9) {
    return undefined;
  }
  const codecClassCode = bytes[4]!;
  const durationCentis =
    ((bytes[5] ?? 0) << 24) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 8) | (bytes[8] ?? 0);
  if (!Number.isFinite(durationCentis) || durationCentis < 0) {
    return undefined;
  }
  return { codecClassCode, durationCentis };
}

function codecNameForCode(code: number): string | undefined {
  for (const [name, nameCode] of Object.entries(CODEC_CLASS_CODES)) {
    if (nameCode === code) {
      return name;
    }
  }
  return undefined;
}

/** Deterministic synthetic segment bytes used by local fixtures and probe tests. */
export function createSyntheticSegmentBytes(input: {
  readonly durationSeconds: number;
  readonly codecClass?: 'xdv1-video' | 'xdv1-audio';
  readonly payloadFillByte?: number;
  readonly declaredLength?: number;
}): Uint8Array {
  const codecClass = input.codecClass ?? 'xdv1-video';
  const code = CODEC_CLASS_CODES[codecClass]!;
  const durationCentis = Math.round(input.durationSeconds * 100);
  const fill = input.payloadFillByte ?? 0xa5;
  const declared = input.declaredLength;
  const length = declared === undefined ? 9 + 7 : declared;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < 4; index += 1) {
    bytes[index] = SYNTHETIC_MAGIC.charCodeAt(index);
  }
  bytes[4] = code;
  bytes[5] = (durationCentis >>> 24) & 0xff;
  bytes[6] = (durationCentis >>> 16) & 0xff;
  bytes[7] = (durationCentis >>> 8) & 0xff;
  bytes[8] = durationCentis & 0xff;
  for (let index = 9; index < length; index += 1) {
    bytes[index] = fill;
  }
  return bytes;
}
