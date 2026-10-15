import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFfmpegTsMediaAssemblyPort, type LocalMediaToolRunner } from '../src/ffmpeg-ts.ts';
import type { MediaAssemblyRequest } from '../src/assemble.ts';
import { bindingFixture, planFixture } from './fixtures.ts';

function packet(id: number): Uint8Array {
  const bytes = new Uint8Array(188).fill(0xff);
  bytes[0] = 0x47;
  bytes[1] = id;
  return bytes;
}

function request(): MediaAssemblyRequest {
  const original = bindingFixture();
  const binding = {
    ...original,
    declared: { ...original.declared, codecs: ['avc1.42e01e'] },
  };
  const plan = { ...planFixture(), binding };
  return {
    binding,
    plan,
    transferred: plan.entries.map((entry) => ({
      entry,
      bytes: packet(entry.position),
    })),
  };
}

function probeOutput(overrides?: { duration?: string; codec?: string; width?: number }): string {
  return JSON.stringify({
    format: { format_name: 'mpegts', duration: overrides?.duration ?? '11.5' },
    streams: [
      {
        codec_type: 'video',
        codec_name: overrides?.codec ?? 'h264',
        width: overrides?.width ?? 1280,
        height: 720,
      },
    ],
  });
}

function runner(
  probe: string,
  decodeStatus = 0,
): {
  readonly port: ReturnType<typeof createFfmpegTsMediaAssemblyPort>;
  readonly calls: string[];
  readonly paths: string[];
  readonly stagedFirstBytes: number[];
} {
  const calls: string[] = [];
  const paths: string[] = [];
  const stagedFirstBytes: number[] = [];
  const toolRunner: LocalMediaToolRunner = {
    run(binary, args) {
      calls.push(binary);
      if (binary === 'ffprobe') {
        const path = args.at(-1)!;
        paths.push(path);
        const staged = readFileSync(path);
        stagedFirstBytes.push(...[staged[1]!, staged[189]!, staged[377]!]);
        return { status: 0, stdout: probe };
      }
      return { status: decodeStatus, stdout: '' };
    },
  };
  const port = createFfmpegTsMediaAssemblyPort({
    ffprobeBinary: 'ffprobe',
    ffmpegBinary: 'ffmpeg',
    runner: toolRunner,
  });
  return { port, calls, paths, stagedFirstBytes };
}

describe('S4 real host-only MPEG-TS media oracle (no synthetic PASS)', () => {
  it('assembles frozen plan order, requires both ffprobe and a full decoder, cleans staging', () => {
    const tools = runner(probeOutput());
    const reversed = { ...request(), transferred: [...request().transferred].reverse() };
    const result = tools.port.assembleAndProbe(reversed);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'EVIDENCE') return;
    expect(result.value.report).toMatchObject({
      observedIdentitySetMatchesPlan: true,
      allSegmentsValid: true,
      durationConsistent: true,
      matchesDeclaredRendition: true,
      containerMarkersPresent: true,
      assembledByteCount: 3 * 188,
    });
    expect(tools.calls).toEqual(['ffprobe', 'ffmpeg']);
    expect(tools.stagedFirstBytes).toEqual([0, 1, 2]);
    expect(tools.paths.every((path) => !existsSync(path))).toBe(true);
  });

  it('refuses to replace the frozen rendition metadata under an unchanged target id', () => {
    const tools = runner(probeOutput());
    const base = request();
    const altered = {
      ...base,
      binding: {
        ...base.binding,
        declared: { ...base.binding.declared, codecs: ['mp4a.40.2'] },
      },
    };
    expect(tools.port.assembleAndProbe(altered)).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
    expect(tools.calls).toEqual([]);
  });

  it('rejects a non-TS byte payload before spawning tools', () => {
    const tools = runner(probeOutput());
    const base = request();
    const malformed = {
      ...base,
      transferred: base.transferred.map((item, i) =>
        i === 1 ? { ...item, bytes: new Uint8Array(188) } : item,
      ),
    };
    const result = tools.port.assembleAndProbe(malformed);
    expect(result.ok && result.value.kind).toBe('INSUFFICIENT_EVIDENCE');
    expect(tools.calls).toEqual([]);
  });

  it('rejects partial or duplicate segment identities before spawning tools', () => {
    const tools = runner(probeOutput());
    const base = request();
    const partial = { ...base, transferred: base.transferred.slice(1) };
    const duplicate = {
      ...base,
      transferred: [base.transferred[0]!, base.transferred[0]!, base.transferred[2]!],
    };
    expect(tools.port.assembleAndProbe(partial)).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
    expect(tools.port.assembleAndProbe(duplicate)).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
    expect(tools.calls).toEqual([]);
  });

  it('does not accept unrecognized codec, unexpected resolution or bad duration', () => {
    for (const value of [
      probeOutput({ codec: 'vp9' }),
      probeOutput({ width: 320 }),
      probeOutput({ duration: '23.0' }),
    ]) {
      const tools = runner(value);
      const result = tools.port.assembleAndProbe(request());
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.kind !== 'EVIDENCE') continue;
      expect(
        result.value.report.matchesDeclaredRendition && result.value.report.durationConsistent,
      ).toBe(false);
    }
  });

  it('a metadata-only ffprobe success cannot substitute for failed media decoding', () => {
    const tools = runner(probeOutput(), 1);
    expect(tools.port.assembleAndProbe(request())).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
    expect(tools.calls).toEqual(['ffprobe', 'ffmpeg']);
  });

  it('missing or malformed real tool output cannot become successful evidence', () => {
    for (const metadata of [
      '{}',
      '{not json',
      JSON.stringify({ format: { format_name: 'matroska', duration: '11.5' }, streams: [] }),
    ]) {
      const tools = runner(metadata);
      expect(tools.port.assembleAndProbe(request())).toMatchObject({
        ok: true,
        value: { kind: 'INSUFFICIENT_EVIDENCE' },
      });
      expect(tools.calls).toEqual(['ffprobe']);
    }
    const unavailable = createFfmpegTsMediaAssemblyPort({
      runner: {
        run() {
          return { status: null, stdout: '' };
        },
      },
    });
    expect(unavailable.assembleAndProbe(request())).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
  });

  it('caps local assembly bytes independent of the fetcher budget', () => {
    const tools = runner(probeOutput());
    const small = createFfmpegTsMediaAssemblyPort({
      maxAssembledBytes: 2 * 188,
      runner: {
        run() {
          throw Error('must not run');
        },
      },
    });
    expect(small.assembleAndProbe(request())).toMatchObject({
      ok: true,
      value: { kind: 'INSUFFICIENT_EVIDENCE' },
    });
    expect(tools.calls).toEqual([]);
  });
});
