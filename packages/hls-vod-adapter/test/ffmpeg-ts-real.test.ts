/**
 * Real FFmpeg regression for review F01, not a fake-runner oracle.
 * A TS null-packet substitution must never be accepted just because the
 * concatenated container still reports the playlist duration.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFfmpegTsMediaAssemblyPort } from '../src/ffmpeg-ts.ts';
import { bindingFixture, planFixture } from './fixtures.ts';

const ffmpegInstalled = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0;
const ffprobeInstalled = spawnSync('ffprobe', ['-version'], { timeout: 5000 }).status === 0;

function syncNullPacket(): Uint8Array {
  const data = new Uint8Array(188).fill(0xff);
  data.set([0x47, 0x1f, 0xff, 0x10], 0);
  return data;
}

/** Real HLS TS segments, deliberately independent per the supported S4 profile. */
describe.skipIf(!ffmpegInstalled || !ffprobeInstalled)(
  'S4 real-FFmpeg adversarial TS coverage',
  () => {
    it('accepts three independently decodable segments, rejects missing middle media', () => {
      const dir = mkdtempSync(join(tmpdir(), 'xd-s4-real-regression-'));
      try {
        const result = spawnSync(
          'ffmpeg',
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=128x72:rate=10',
            '-t',
            '6',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-g',
            '20',
            '-keyint_min',
            '20',
            '-sc_threshold',
            '0',
            '-f',
            'hls',
            '-hls_time',
            '2',
            '-hls_list_size',
            '0',
            '-hls_flags',
            'independent_segments',
            '-hls_segment_filename',
            join(dir, 'seg-%d.ts'),
            join(dir, 'list.m3u8'),
          ],
          { timeout: 30000, maxBuffer: 32768, windowsHide: true },
        );
        expect(result.status).toBe(0);
        const names = readdirSync(dir)
          .filter((name) => /^seg-[0-9]+\.ts$/u.test(name))
          .sort();
        expect(names).toHaveLength(3);
        const parts = names.map((name) => new Uint8Array(readFileSync(join(dir, name))));
        const source = bindingFixture();
        const binding = {
          ...source,
          declared: {
            ...source.declared,
            codecs: ['avc1.42e01e'],
            resolution: { width: 128, height: 72 },
          },
        };
        const original = planFixture();
        const plan = {
          ...original,
          binding,
          entries: original.entries.map((entry) => ({ ...entry, durationSeconds: 2 })),
        };
        const selected = plan.entries.map((entry, index) => ({
          entry,
          bytes: parts[index]!,
        }));
        const port = createFfmpegTsMediaAssemblyPort();
        const valid = port.assembleAndProbe({ binding, plan, transferred: selected });
        expect(valid).toMatchObject({
          ok: true,
          value: {
            kind: 'EVIDENCE',
            report: {
              allSegmentsValid: true,
              durationConsistent: true,
              matchesDeclaredRendition: true,
              observedIdentitySetMatchesPlan: true,
            },
          },
        });
        const emptyMiddle = [
          selected[0]!,
          { ...selected[1]!, bytes: syncNullPacket() },
          selected[2]!,
        ];
        const missing = port.assembleAndProbe({ binding, plan, transferred: emptyMiddle });
        expect(missing).toMatchObject({
          ok: true,
          value: { kind: 'INSUFFICIENT_EVIDENCE' },
        });
        // R2/F03 actual media repro: keep original frames 0 and 19 only,
        // preserving the roughly two-second advertised TS timeline.
        // The file decodes and has valid H264, but interior coverage is lost.
        const sparsePath = join(dir, 'sparse-middle.ts');
        const sparseBuild = spawnSync('ffmpeg', [
          '-nostdin', '-hide_banner', '-loglevel', 'error',
          '-copyts', '-i', join(dir, 'seg-1.ts'),
          '-vf', "select='eq(n,0)+eq(n,19)'",
          '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-g', '1', '-muxdelay', '0', '-muxpreload', '0',
          '-f', 'mpegts', sparsePath,
        ], { timeout: 30000, maxBuffer: 32768, windowsHide: true });
        expect(sparseBuild.status).toBe(0);
        const sparseMiddle = [
          selected[0]!,
          { ...selected[1]!, bytes: new Uint8Array(readFileSync(sparsePath)) },
          selected[2]!,
        ];
        const sparse = port.assembleAndProbe({
          binding, plan, transferred: sparseMiddle,
        });
        expect(sparse).toMatchObject({
          ok: true,
          value: { kind: 'INSUFFICIENT_EVIDENCE' },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 45000);
  },
);
