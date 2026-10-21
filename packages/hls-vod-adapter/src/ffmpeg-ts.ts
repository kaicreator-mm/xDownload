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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// Each tool invocation is bounded; also cap the number of invoked programs.
const MAX_REAL_TS_SEGMENTS = 32;
/** Bounded conservative CFR-ish media subset. Sparse/VFR must return INSUFFICIENT_EVIDENCE. */
const MAX_MEDIA_FRAME_GAP_SECONDS = 0.25;
const MAX_PROBED_FRAMES_PER_SEGMENT = 8192;

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
  /** Host-only test seam. A failed cleanup always disqualifies Media evidence. */
  readonly removeTemporaryDirectory?: (directory: string) => void;
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
  readonly start_time?: unknown;
  readonly duration?: unknown;
  readonly nb_read_frames?: unknown;
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
    entries.length > MAX_REAL_TS_SEGMENTS ||
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

/** A probe cannot prove media by file byte count or whole-file duration alone. */
function observedStreamTypes(streams: readonly ProbeStream[]): readonly string[] | undefined {
  const codecs: string[] = [];
  for (const stream of streams) {
    if (stream.codec_type !== 'audio' && stream.codec_type !== 'video') return undefined;
    if (typeof stream.codec_name !== 'string') return undefined;
    codecs.push(stream.codec_name);
  }
  return codecs;
}

function matchesFrozenRendition(
  request: MediaAssemblyRequest,
  streams: readonly ProbeStream[],
): boolean {
  const expected = request.binding.declared.codecs.map(codecFamily);
  const actual = observedStreamTypes(streams);
  if (
    actual === undefined ||
    expected.length === 0 ||
    expected.includes(undefined) ||
    actual.length !== expected.length ||
    [...expected].sort().join('|') !== [...actual].sort().join('|')
  )
    return false;
  const resolution = request.binding.declared.resolution;
  if (resolution === undefined) return true;
  const videos = streams.filter((item) => item.codec_type === 'video');
  return (
    videos.length === 1 &&
    videos[0]?.width === resolution.width &&
    videos[0]?.height === resolution.height
  );
}

function durationTolerance(seconds: number): number {
  // Allow normal EXTINF rounding and packetized transport timing, but
  // never let a missing multi-second segment hide under whole-file duration.
  return Math.max(0.25, seconds * 0.05);
}

function probeArgs(filepath: string): string[] {
  return [
    '-v',
    'error',
    '-count_frames',
    '-show_frames',
    '-show_entries',
    'format=format_name,duration:stream=index,codec_type,codec_name,width,height,start_time,duration,nb_read_frames:frame=media_type,stream_index,best_effort_timestamp_time',
    '-of',
    'json',
    filepath,
  ];
}

function decodeArgs(filepath: string): string[] {
  return [
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
  ];
}

/**
 * Actual per-stream presentation timestamp coverage, not container duration or
 * total frame count. A sparse two-frame TS segment can advertise a two-second
 * duration and decode successfully; the missing interior must still fail.
 *
 * v0.1 admits only dense, temporally verifiable streams. Lower-FPS/sparse VFR
 * clips are conservatively INSUFFICIENT_EVIDENCE until a reviewed profile exists.
 */
function hasDenseTimestampCoverage(
  json: string,
  streams: readonly ProbeStream[],
  plannedSeconds: number,
): boolean {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const frames: unknown = (parsed as Record<string, unknown>)['frames'];
    if (!Array.isArray(frames) || frames.length < 2 ||
        frames.length > MAX_PROBED_FRAMES_PER_SEGMENT) return false;
    const indices = streams.map((s, index) => {
      const declaredIndex = (s as ProbeStream & { readonly index?: unknown }).index;
      return typeof declaredIndex === 'number' && Number.isSafeInteger(declaredIndex)
        ? declaredIndex : index;
    });
    if (new Set(indices).size !== indices.length) return false;
    const times = new Map<number, number[]>(indices.map((index) => [index, []]));
    for (const item of frames as unknown[]) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
      const frame = item as Record<string, unknown>;
      const index = frame['stream_index'];
      const type = frame['media_type'];
      const streamPosition = indices.indexOf(index as number);
      if (streamPosition < 0 || type !== streams[streamPosition]?.codec_type) return false;
      const raw = frame['best_effort_timestamp_time'];
      if (typeof raw !== 'string' || !/^\\d+(?:\\.\\d+)?$/u.test(raw)) return false;
      const pts = Number(raw);
      if (!Number.isFinite(pts) || pts < 0) return false;
      times.get(index as number)!.push(pts);
    }
    const firsts: number[] = [];
    for (const [position, index] of indices.entries()) {
      const stamps = times.get(index);
      if (stamps === undefined || stamps.length < 2 ||
          stamps.length !== Number(streams[position]?.nb_read_frames)) return false;
      const first = stamps[0]!;
      const last = stamps[stamps.length - 1]!;
      // Real tracks may have small encoder offset; larger unobserved head/tail
      // regions cannot be promoted to Media evidence.
      const declaredStart = Number(streams[position]?.start_time);
      if (!Number.isFinite(declaredStart) ||
          Math.abs(first - declaredStart) > MAX_MEDIA_FRAME_GAP_SECONDS) return false;
      firsts.push(first);
      for (let i = 1; i < stamps.length; i++) {
        const delta = stamps[i]! - stamps[i - 1]!;
        if (!(delta > 0 && delta <= MAX_MEDIA_FRAME_GAP_SECONDS + 1e-6)) return false;
      }
      const finalCadence = stamps[stamps.length - 1]! - stamps[stamps.length - 2]!;
      // Last presentation timestamp plus one observed cadence must cover the
      // declared segment time, but no missing interior can hide in duration.
      const observedCoverage = last + finalCadence - first;
      if (Math.abs(observedCoverage - plannedSeconds) >
          MAX_MEDIA_FRAME_GAP_SECONDS) return false;
    }
    return Math.max(...firsts) - Math.min(...firsts) <= MAX_MEDIA_FRAME_GAP_SECONDS;
  } catch {
    return false;
  }
}

function runRealVerification(
  request: MediaAssemblyRequest,
  verified: { readonly bytes: Uint8Array; readonly plannedDuration: number },
  directory: string,
  runner: LocalMediaToolRunner,
  ffprobe: string,
  ffmpeg: string,
): DomainValidationResult<MediaAssemblyProbeOutcome> {
  const entries = request.plan.entries;
  const byId = new Map(request.transferred.map((item) => [item.entry.identity, item]));
  let previousStart: number | undefined;
  let previousDuration = 0;
  let expectedFrameCounts: number[] | undefined;

  for (const [index, entry] of entries.entries()) {
    const filepath = join(directory, `part-${index}.ts`);
    writeFileSync(filepath, byId.get(entry.identity)!.bytes, { flag: 'wx', mode: 0o600 });
    const scanned = runner.run(ffprobe, probeArgs(filepath));
    if (scanned.status !== 0 || scanned.stdout.length > TOOL_MAX_OUTPUT_BYTES) {
      return insufficient('per-segment media probe failed');
    }
    const observed = parseProbe(scanned.stdout);
    if (observed === undefined || !matchesFrozenRendition(request, observed.streams)) {
      return insufficient('per-segment container or declared media did not match');
    }
    if (!hasDenseTimestampCoverage(scanned.stdout, observed.streams, entry.durationSeconds)) {
      return insufficient('segment has sparse, missing or unverifiable per-stream media timeline');
    }
    // Each *individual* planned piece must be independently decodable and
    // provide actual frames; a null-only TS piece yields no stream evidence.
    const counts: number[] = [];
    const starts: number[] = [];
    for (const stream of observed.streams) {
      const count = Number(stream.nb_read_frames);
      const start = Number(stream.start_time);
      if (!Number.isSafeInteger(count) || count <= 0 || !Number.isFinite(start) || start < 0) {
        return insufficient('segment had no positively counted decodable media frames');
      }
      counts.push(count);
      starts.push(start);
    }
    // Enforce each EXTINF duration instead of using only the assembled
    // container duration (which may span absent material).
    if (
      Math.abs(observed.duration - entry.durationSeconds) > durationTolerance(entry.durationSeconds)
    ) {
      return insufficient('per-segment duration differs from the frozen playlist');
    }
    const segmentStart = Math.min(...starts);
    if (
      previousStart !== undefined &&
      Math.abs(segmentStart - (previousStart + previousDuration)) >
        durationTolerance(previousDuration)
    ) {
      return insufficient('missing, repeated or discontinuous segment timeline');
    }
    previousStart = segmentStart;
    previousDuration = entry.durationSeconds;
    if (expectedFrameCounts === undefined) expectedFrameCounts = counts;
    else {
      if (expectedFrameCounts.length !== counts.length)
        return insufficient('segment stream count changed');
      expectedFrameCounts = expectedFrameCounts.map((old, i) => old + counts[i]!);
    }
    const decoded = runner.run(ffmpeg, decodeArgs(filepath));
    if (decoded.status !== 0) return insufficient('segment failed full independent media decoding');
  }

  const filepath = join(directory, 'selected.ts');
  writeFileSync(filepath, verified.bytes, { flag: 'wx', mode: 0o600 });
  const scanned = runner.run(ffprobe, probeArgs(filepath));
  if (scanned.status !== 0 || scanned.stdout.length > TOOL_MAX_OUTPUT_BYTES)
    return insufficient('whole-file media probe failed');
  const observed = parseProbe(scanned.stdout);
  if (observed === undefined || !matchesFrozenRendition(request, observed.streams))
    return insufficient('whole-file container or frozen rendition mismatch');
  const decoded = runner.run(ffmpeg, decodeArgs(filepath));
  if (decoded.status !== 0) return insufficient('whole-file media decode failed');
  // The entire file cannot contain fewer frames than the individually
  // validated parts, or a different stream topology.
  const wholeCounts = observed.streams.map((stream) => Number(stream.nb_read_frames));
  const frameCorrespondence =
    expectedFrameCounts !== undefined &&
    expectedFrameCounts.length === wholeCounts.length &&
    wholeCounts.every(
      (count, i) => Number.isSafeInteger(count) && count === expectedFrameCounts?.[i],
    );
  if (!frameCorrespondence)
    return insufficient('assembled media frame coverage differs from its parts');
  const durationMatches =
    Math.abs(observed.duration - verified.plannedDuration) <=
    durationTolerance(verified.plannedDuration);
  const checks: ProbeCheck[] = [
    'IDENTITY_SET_MATCHES_PLAN',
    'ALL_SEGMENTS_VALID',
    durationMatches ? 'DURATION_CONSISTENT' : 'DURATION_MISMATCH',
    'MATCHES_DECLARED_RENDITION',
    'CONTAINER_MARKERS_PRESENT',
  ];
  const report: MediaProbeReport = {
    observedIdentitySetMatchesPlan: true,
    allSegmentsValid: true,
    durationConsistent: durationMatches,
    matchesDeclaredRendition: true,
    containerMarkersPresent: true,
    checks,
    observedDurationSeconds: observed.duration,
    plannedDurationSeconds: verified.plannedDuration,
    observedCodecClass: observedStreamTypes(observed.streams)?.join(','),
    assembledByteCount: verified.bytes.length,
  };
  return { ok: true, value: deepFreeze({ kind: 'EVIDENCE' as const, report }) };
}

export function createFfmpegTsMediaAssemblyPort(
  options: FfmpegTsPortOptions = {},
): MediaAssemblyPort {
  const limit = options.maxAssembledBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit < TS_PACKET_BYTES || limit > DEFAULT_MAX_BYTES)
    throw new Error('invalid ffmpeg TS media byte bound');
  const runner = options.runner ?? systemRunner;
  const ffprobe = options.ffprobeBinary ?? 'ffprobe';
  const ffmpeg = options.ffmpegBinary ?? 'ffmpeg';
  if (!ffprobe || !ffmpeg) throw new Error('media tool path must be nonempty');
  const cleanup =
    options.removeTemporaryDirectory ??
    ((directory: string) => rmSync(directory, { recursive: true, force: true }));

  return {
    toolId: 'xdownload/ffmpeg-ts-media/1',
    assembleAndProbe(request) {
      const verified = validateTransferred(request, limit);
      if (verified === undefined)
        return insufficient('incomplete, unordered, oversized or non-MPEG-TS segment set');
      let directory: string | undefined;
      let outcome: DomainValidationResult<MediaAssemblyProbeOutcome> = insufficient(
        'media tooling did not complete',
      );
      let cleanupPassed = false;
      try {
        directory = mkdtempSync(join(tmpdir(), 'xdownload-s4-probe-'));
        outcome = runRealVerification(request, verified, directory, runner, ffprobe, ffmpeg);
      } catch {
        outcome = insufficient('local media tooling or temporary staging unavailable');
      } finally {
        if (directory !== undefined) {
          try {
            cleanup(directory);
            cleanupPassed = !existsSync(directory);
          } catch {
            // Even if a best-effort fallback deletes the files, the tool
            // cleanup failed; no Media evidence may be accepted.
            try {
              rmSync(directory, { recursive: true, force: true });
            } catch {
              // Cannot remediate here. Never return private path in diagnosis.
            }
          }
        }
      }
      return cleanupPassed
        ? outcome
        : insufficient('private media staging cleanup could not be verified');
    },
  };
}
