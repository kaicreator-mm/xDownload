/**
 * Host-only S4 MPEG-TS structural/media oracle. It does not admit a Core
 * command, authenticate a browser, or publish an artifact. The existing
 * Core-owned pipeline consumes only the returned probe facts.
 *
 * Only complete, bounded, ordered MPEG-TS segments are supported. ffprobe
 * supplies actual stream/duration facts and ffmpeg must decode the entire
 * assembled stream without an error. This is deliberately separate from the
 * synthetic test oracle and is never enabled by default on an unqualified host.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deepFreeze,
  identitySetEquals,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import type {
  MediaAssemblyPort,
  MediaAssemblyProbeOutcome,
  MediaAssemblyRequest,
  MediaProbeReport,
  ProbeCheck,
} from './assemble.ts';

const TS_PACKET_BYTES = 188;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 20_000;
const TOOL_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LocalMediaToolResult {
  readonly status: number | null;
  readonly stdout: string;
}

/** Invoked only with fixed argument arrays; no shell or page-provided options. */
export interface LocalMediaToolRunner {
  run(binary: string, args: readonly string[]): LocalMediaToolResult;
}

export interface FfmpegTsPortOptions {
  /** Trusted host-selected executable paths; never taken from a web page or Recipe. */
  readonly ffprobeBinary?: string;
  readonly ffmpegBinary?: string;
  readonly maxAssembledBytes?: number;
  /** Test seam; production uses the bounded OS process runner below. */
  readonly runner?: LocalMediaToolRunner;
}

const systemRunner: LocalMediaToolRunner = {
  run(binary, args) {
    const result = spawnSync(binary, [...args], {
      encoding: 'utf8',
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: TOOL_MAX_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
    });
    return {
      status: result.error === undefined ? result.status : null,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
    };
  },
};

function insufficient(detail: string): DomainValidationResult<MediaAssemblyProbeOutcome> {
  return { ok: true, value: deepFreeze({ kind: 'INSUFFICIENT_EVIDENCE' as const, detail }) };
}

interface ProbeStream {
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
}

function codecFamily(declared: string): string | undefined {
  if (/^avc1\.[A-Za-z0-9.]+$/u.test(declared)) return 'h264';
  if (/^(?:hvc1|hev1)\.[A-Za-z0-9.]+$/u.test(declared)) return 'hevc';
  if (/^av01\.[A-Za-z0-9.]+$/u.test(declared)) return 'av1';
  if (/^mp4a\.[A-Za-z0-9.]+$/u.test(declared)) return 'aac';
  if (declared === 'mp3') return 'mp3';
  // A new profile must be reviewed before other codec families can PASS.
  return undefined;
}

function parseProbe(value: string):
  | {
      readonly duration: number;
      readonly streams: readonly ProbeStream[];
    }
  | undefined {
  try {
    const data: unknown = JSON.parse(value);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
    const record = data as Record<string, unknown>;
    if (
      typeof record['format'] !== 'object' ||
      record['format'] === null ||
      Array.isArray(record['format']) ||
      !Array.isArray(record['streams'])
    )
      return undefined;
    const format = record['format'] as Record<string, unknown>;
    // Reject an unrecognized or surprising container rather than assuming TS.
    if (
      typeof format['format_name'] !== 'string' ||
      !format['format_name'].split(',').includes('mpegts')
    )
      return undefined;
    const durationValue = format['duration'];
    if (typeof durationValue !== 'string' && typeof durationValue !== 'number') return undefined;
    const duration = Number(durationValue);
    if (!Number.isFinite(duration) || duration <= 0) return undefined;
    if (
      record['streams'].length < 1 ||
      record['streams'].length > 8 ||
      !record['streams'].every(
        (s: unknown) => typeof s === 'object' && s !== null && !Array.isArray(s),
      )
    )
      return undefined;
    return { duration, streams: record['streams'] as ProbeStream[] };
  } catch {
    return undefined;
  }
}

function validateTransferred(
  request: MediaAssemblyRequest,
  maxBytes: number,
):
  | {
      readonly bytes: Uint8Array;
      readonly identityMatches: boolean;
      readonly plannedDuration: number;
    }
  | undefined {
  const entries = request.plan.entries;
  const frozen = request.plan.binding.declared;
  const selected = request.binding.declared;
  const sameCodecs =
    frozen.codecs.length === selected.codecs.length &&
    frozen.codecs.every((codec, index) => codec === selected.codecs[index]);
  if (
    !sameCodecs ||
    frozen.bandwidth !== selected.bandwidth ||
    frozen.resolution?.width !== selected.resolution?.width ||
    frozen.resolution?.height !== selected.resolution?.height ||
    entries.length < 1 ||
    entries.length > 128 ||
    request.transferred.length !== entries.length ||
    request.plan.binding.logicalTargetId !== request.binding.logicalTargetId ||
    request.plan.binding.renditionId !== request.binding.renditionId
  )
    return undefined;
  const transferredIds = request.transferred.map((s) => s.entry.identity);
  const plannedIds = entries.map((s) => s.identity);
  if (
    new Set(transferredIds).size !== transferredIds.length ||
    !identitySetEquals(transferredIds, plannedIds)
  )
    return undefined;
  const byId = new Map(request.transferred.map((item) => [item.entry.identity, item]));
  let total = 0;
  let plannedDuration = 0;
  for (const entry of entries) {
    const item = byId.get(entry.identity);
    if (
      item === undefined ||
      item.entry.position !== entry.position ||
      item.entry.sequence !== entry.sequence ||
      item.bytes.length === 0 ||
      item.bytes.length % TS_PACKET_BYTES !== 0 ||
      (entry.byterange !== undefined && item.bytes.length !== entry.byterange.length) ||
      !Number.isFinite(entry.durationSeconds) ||
      entry.durationSeconds <= 0
    )
      return undefined;
    for (let offset = 0; offset < item.bytes.length; offset += TS_PACKET_BYTES) {
      if (item.bytes[offset] !== 0x47) return undefined;
    }
    total += item.bytes.length;
    plannedDuration += entry.durationSeconds;
    if (!Number.isSafeInteger(total) || total > maxBytes) return undefined;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const entry of entries) {
    const part = byId.get(entry.identity)!.bytes;
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, identityMatches: true, plannedDuration };
}

export function createFfmpegTsMediaAssemblyPort(
  options: FfmpegTsPortOptions = {},
): MediaAssemblyPort {
  const limit = options.maxAssembledBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit < TS_PACKET_BYTES || limit > DEFAULT_MAX_BYTES) {
    throw new Error('invalid ffmpeg TS media byte bound');
  }
  const runner = options.runner ?? systemRunner;
  const ffprobe = options.ffprobeBinary ?? 'ffprobe';
  const ffmpeg = options.ffmpegBinary ?? 'ffmpeg';
  if (!ffprobe || !ffmpeg) throw new Error('media tool path must be nonempty');

  return {
    toolId: 'xdownload/ffmpeg-ts-media/1',
    assembleAndProbe(request) {
      const verified = validateTransferred(request, limit);
      if (verified === undefined)
        return insufficient('incomplete, unordered, oversized or non-MPEG-TS segment set');
      let directory: string | undefined;
      try {
        directory = mkdtempSync(join(tmpdir(), 'xdownload-s4-probe-'));
        const filepath = join(directory, 'selected.ts');
        writeFileSync(filepath, verified.bytes, { flag: 'wx', mode: 0o600 });
        const scanned = runner.run(ffprobe, [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration:stream=codec_type,codec_name,width,height',
          '-of',
          'json',
          filepath,
        ]);
        if (scanned.status !== 0 || scanned.stdout.length > TOOL_MAX_OUTPUT_BYTES) {
          return insufficient('bounded ffprobe failed or exceeded output bound');
        }
        const observed = parseProbe(scanned.stdout);
        if (observed === undefined)
          return insufficient('ffprobe did not provide a valid MPEG-TS stream/duration report');
        // Metadata alone is NOT Media evidence: decode the entire input.
        const decoded = runner.run(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-xerror',
          '-err_detect',
          'explode',
          '-i',
          filepath,
          '-map',
          '0:v?',
          '-map',
          '0:a?',
          '-f',
          'null',
          '-',
        ]);
        if (decoded.status !== 0) return insufficient('full media decode did not pass');
        const expected = request.binding.declared.codecs.map(codecFamily);
        const actual = observed.streams.map((s) =>
          (s.codec_type === 'video' || s.codec_type === 'audio') && typeof s.codec_name === 'string'
            ? s.codec_name
            : undefined,
        );
        const codecMatch =
          expected.length > 0 &&
          !expected.includes(undefined) &&
          expected.length === actual.length &&
          !actual.includes(undefined) &&
          [...expected].sort().join('|') === [...actual].sort().join('|');
        const resolution = request.binding.declared.resolution;
        const videos = observed.streams.filter((s) => s.codec_type === 'video');
        const resolutionMatch =
          resolution === undefined ||
          (videos.length === 1 &&
            videos[0]?.width === resolution.width &&
            videos[0]?.height === resolution.height);
        const renditionMatches = codecMatch && resolutionMatch;
        const durationMatches =
          Math.abs(observed.duration - verified.plannedDuration) <=
          Math.max(1, verified.plannedDuration * 0.05);
        const checks: ProbeCheck[] = [
          verified.identityMatches ? 'IDENTITY_SET_MATCHES_PLAN' : 'IDENTITY_MISMATCH',
          'ALL_SEGMENTS_VALID',
          durationMatches ? 'DURATION_CONSISTENT' : 'DURATION_MISMATCH',
          renditionMatches ? 'MATCHES_DECLARED_RENDITION' : 'DIFFERS_FROM_DECLARED_RENDITION',
          'CONTAINER_MARKERS_PRESENT',
        ];
        const report: MediaProbeReport = {
          observedIdentitySetMatchesPlan: verified.identityMatches,
          allSegmentsValid: true,
          durationConsistent: durationMatches,
          matchesDeclaredRendition: renditionMatches,
          containerMarkersPresent: true,
          checks,
          observedDurationSeconds: observed.duration,
          plannedDurationSeconds: verified.plannedDuration,
          observedCodecClass: actual.join(','),
          assembledByteCount: verified.bytes.length,
        };
        return { ok: true, value: deepFreeze({ kind: 'EVIDENCE' as const, report }) };
      } catch {
        // Do not expose executable stderr, arbitrary local paths, or media bytes.
        return insufficient('local media tooling or temporary staging unavailable');
      } finally {
        if (directory !== undefined) {
          try {
            rmSync(directory, { recursive: true, force: true });
          } catch {
            /* fail closed above */
          }
        }
      }
    },
  };
}
