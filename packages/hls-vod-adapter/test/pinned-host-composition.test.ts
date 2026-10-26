/** #149 Core-private composition: one selected plan, no ambient HTTP or tool authority. */
import { describe, expect, it } from 'vitest';
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
function alteredPlan(plan: SegmentPlan, replacements: Partial<SegmentPlan> = {}): SegmentPlan {
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

  it('R1 P1 rejects shallow-frozen mutable Range before any segment request', () => {
    const plan = planFixture({ withByterange: true });
    const original = plan.entries[0]!;
    const mutableRange = {
      offset: original.byterange!.offset,
      length: original.byterange!.length,
    };
    const shallowFrozen = Object.freeze({ ...original, byterange: mutableRange });
    const malicious = alteredPlan(plan, {
      entries: Object.freeze([shallowFrozen, ...plan.entries.slice(1)]),
    });
    const host = createPinnedHlsHostPorts(options());
    expect(Object.isFrozen(shallowFrozen)).toBe(true);
    expect(Object.isFrozen(mutableRange)).toBe(false);
    expect(() => host.bindSelectedPlan(malicious)).toThrow('trusted host admission');
    mutableRange.offset += 1000;
    // The forged range never received an HTTP-capable selected-plan fetcher.
    expect(mutableRange.offset).not.toBe(original.byterange!.offset);
    expect(Object.isFrozen(original.byterange)).toBe(true);
    expect(host.bindSelectedPlan(plan).maxResponseBytes).toBe(4096);
  });

  it('rejects mutable provenance under an otherwise frozen segment entry', () => {
    const plan = planFixture();
    const first = plan.entries[0]!;
    const loose = Object.freeze({
      ...first,
      locator: Object.freeze({
        ...first.locator,
        provenance: { ...first.locator.provenance },
      }),
    });
    const injected = alteredPlan(plan, {
      entries: Object.freeze([loose, ...plan.entries.slice(1)]),
    });
    expect(() => createPinnedHlsHostPorts(options()).bindSelectedPlan(injected)).toThrow(
      'trusted host admission',
    );
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
    const mutated = alteredPlan(plan, {
      entries: Object.freeze([first, ...plan.entries.slice(1)]),
    });
    expect(() => host.bindSelectedPlan(mutated)).toThrow('trusted host admission');
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

  it('does not mint a Core effect, task or terminal result from port construction', () => {
    const host = createPinnedHlsHostPorts(options());
    const fetcher = host.bindSelectedPlan(planFixture());
    expect(host.mediaAssemblyPort.assembleAndProbe).toBeTypeOf('function');
    expect(fetcher.fetch).toBeTypeOf('function');
    expect(Object.keys(host).sort()).toEqual([
      'bindSelectedPlan',
      'manifestPort',
      'mediaAssemblyPort',
    ]);
  });
});
