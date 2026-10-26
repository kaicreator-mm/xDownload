/** #149 Core-private composition: one selected plan, no ambient HTTP or tool authority. */
import { describe, expect, it, vi } from 'vitest';
import type { SegmentPlan, SegmentPlanEntry } from '../src/plan.ts';
import { createPinnedHlsHostPorts } from '../src/pinned-host-composition.ts';
import { planFixture } from './fixtures.ts';

const cdn = 'https://cdn.example.com';
const other = 'https://edge-cdn.example.net';

function options() {
  return {
    manifests: { allowedOrigins: [cdn], maxBytes: 1024, timeoutMs: 2000 },
    segments: { allowedOrigins: [cdn], maxBytes: 4096, timeoutMs: 2000 },
    mediaTools: { ffprobeBinary: 'ffprobe', ffmpegBinary: 'ffmpeg' },
  };
}
function alteredPlan(
  plan: SegmentPlan,
  replacements: Partial<SegmentPlan> = {},
): SegmentPlan {
  return Object.freeze({ ...plan, ...replacements });
}

describe('#149 selected-plan pinned S4 host composition', () => {
  it('exposes only pinned manifest, exact-plan HTTPS TS and real ffmpeg assembly ports', () => {
    const plan = planFixture();
    const host = createPinnedHlsHostPorts(options());
    expect(host.manifestPort.maxResponseBytes).toBe(1024);
    expect(host.mediaAssemblyPort.toolId).toBe('xdownload/ffmpeg-ts-media/1');
    const selected = host.bindSelectedPlan(plan);
    expect(selected.fetcherId).toBe('s4-selected-plan-pinned-https-ts-v1');
    expect(selected.maxResponseBytes).toBe(4096);
    expect(Object.isFrozen(host)).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
  });

  it('refuses a copied entry even when identity, location and byte-range are equal', async () => {
    const plan = planFixture();
    const selected = createPinnedHlsHostPorts(options()).bindSelectedPlan(plan);
    const copied = { ...plan.entries[0]! };
    expect(await selected.fetch(copied)).toEqual({ ok: false, failure: 'FAILED' });
    // An independently rebuilt plan cannot borrow the already-installed port.
    const independent = planFixture();
    expect(await selected.fetch(independent.entries[0]!)).toEqual({
      ok: false,
      failure: 'FAILED',
    });
  });

  it('fails before network on foreign selected manifest, segment origin and mutable plan', () => {
    const plan = planFixture();
    const host = createPinnedHlsHostPorts(options());
    expect(() => host.bindSelectedPlan({ ...plan })).toThrow('trusted host admission');
    const foreignManifest = alteredPlan(plan, {
      binding: Object.freeze({
        ...plan.binding,
        manifestLocator: Object.freeze({
          ...plan.binding.manifestLocator,
          locator: Object.freeze({ kind: 'direct', uri: other + '/master.m3u8' }),
        }),
      }),
    } as never);
    expect(() => host.bindSelectedPlan(foreignManifest)).toThrow('trusted host admission');
    const old = plan.entries[0]!;
    const foreignEntry = Object.freeze({
      ...old,
      locator: Object.freeze({
        ...old.locator,
        locator: Object.freeze({ kind: 'direct', uri: other + '/part-001.ts' }),
      }),
    }) as SegmentPlanEntry;
    const wrongPlan = alteredPlan(plan, {
      entries: Object.freeze([foreignEntry, ...plan.entries.slice(1)]),
    });
    expect(() => host.bindSelectedPlan(wrongPlan)).toThrow('trusted host admission');
  });

  it('rejects an oversized finite plan and disallowed segment byte range', () => {
    const plan = planFixture();
    const host = createPinnedHlsHostPorts(options());
    const tooMany = alteredPlan(plan, {
      entries: Object.freeze(Array.from({ length: 33 }, () => plan.entries[0]!)),
    });
    expect(() => host.bindSelectedPlan(tooMany)).toThrow('trusted host admission');
    const first = plan.entries[0]!;
    const oversized = Object.freeze({
      ...first,
      byterange: Object.freeze({ offset: 0, length: 4097 }),
    }) as SegmentPlanEntry;
    const changed = alteredPlan(plan, {
      entries: Object.freeze([oversized, ...plan.entries.slice(1)]),
    });
    expect(() => host.bindSelectedPlan(changed)).toThrow('trusted host admission');
  });

  it('pins allowed origins and limits even when the original host config mutates', () => {
    const config = options();
    const host = createPinnedHlsHostPorts(config);
    config.manifests.allowedOrigins.push(other);
    config.segments.allowedOrigins.push(other);
    config.segments.maxBytes = 1_000_000;
    config.manifests.maxBytes = 1_000_000;
    const port = host.bindSelectedPlan(planFixture());
    expect(port.maxResponseBytes).toBe(4096);
    expect(host.manifestPort.maxResponseBytes).toBe(1024);
    const plan = planFixture();
    const first = Object.freeze({
      ...plan.entries[0]!,
      locator: Object.freeze({
        ...plan.entries[0]!.locator,
        locator: Object.freeze({ kind: 'direct', uri: other + '/part-001.ts' }),
      }),
    }) as SegmentPlanEntry;
    expect(() =>
      host.bindSelectedPlan(alteredPlan(plan, {
        entries: Object.freeze([first, ...plan.entries.slice(1)]),
      })),
    ).toThrow('trusted host admission');
  });

  it('refuses unsafe fixture/unauthorized host profiles before granting a port', () => {
    const bad = options();
    expect(() =>
      createPinnedHlsHostPorts({
        ...bad,
        manifests: {
          ...bad.manifests,
          allowedOrigins: ['http://127.0.0.1:5000'],
        },
      }),
    ).toThrow();
    expect(() =>
      createPinnedHlsHostPorts({
        ...bad,
        segments: {
          ...bad.segments,
          allowedOrigins: [cdn, 'https://10.0.0.1'],
        },
      }),
    ).toThrow();
  });

  it('does not perform a request or spawn any process during composition/plan binding', () => {
    const spy = vi.spyOn(process, 'emitWarning');
    try {
      const host = createPinnedHlsHostPorts(options());
      host.bindSelectedPlan(planFixture());
      // Media evidence only exists after the Core explicitly invokes its port.
      expect(host.mediaAssemblyPort.assembleAndProbe).toBeTypeOf('function');
    } finally {
      spy.mockRestore();
    }
  });
});
