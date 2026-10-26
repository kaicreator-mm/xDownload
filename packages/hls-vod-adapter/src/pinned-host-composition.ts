/**
 * #149 S4 production-host composition of already reviewed pinned HTTPS and
 * real FFmpeg TS ports. A Core MUST first commit the accepted effect, pin the
 * selected rendition and install its transfer ledger. Constructing this
 * object has no wire authority, hidden scheduler, network or process effect.
 *
 * The selected plan is a deep-frozen T009 output; a member fetch is permitted
 * only for that same entry object, at that same position and exact locator.
 * This prevents a generic origin allowlist from becoming an unscoped downloader
 * when the port is passed to the asynchronous segment executor.
 */
import type { MediaAssemblyPort } from './assemble.ts';
import type { AsyncSegmentFetcherPort, HttpSegmentSourceAuthority } from './http-segment.ts';
import type { AuthorizedHlsManifestPort, HlsManifestAuthority } from './manifest-http.ts';
import { createPinnedPublicHlsManifestPort } from './pinned-https-manifest.ts';
import { createPinnedPublicHlsSegmentFetcher } from './pinned-https-segment.ts';
import { createFfmpegTsMediaAssemblyPort, type FfmpegTsPortOptions } from './ffmpeg-ts.ts';
import { parsePublicHlsUriCandidate } from './public-uri-candidate.ts';
import type { SegmentPlan, SegmentPlanEntry } from './plan.ts';

const MAX_FFMPEG_TS_SEGMENTS = 32;

export interface PinnedHlsHostOptions {
  /** Trusted installation profile, not client or playlist-controlled input. */
  readonly manifests: HlsManifestAuthority;
  readonly segments: HttpSegmentSourceAuthority;
  /** The host resolves binary paths; a web page never supplies tool paths. */
  readonly mediaTools?: FfmpegTsPortOptions;
}

export interface PinnedHlsHostPorts {
  readonly manifestPort: AuthorizedHlsManifestPort;
  readonly mediaAssemblyPort: MediaAssemblyPort;
  /**
   * Call only with the canonical, frozen preflight plan for the currently
   * Core-accepted effect. Throws before any segment effect on a foreign plan.
   */
  bindSelectedPlan(plan: SegmentPlan): AsyncSegmentFetcherPort;
}

function planRefused(): never {
  throw new Error('S4 selected segment plan does not match trusted host admission');
}

/**
 * This is a packaging/composition port, not an acquisition entry point:
 * effect journaling, Core selection, budgets and terminal truth stay upstream.
 * Both HTTPS readers retain their own per-request DNS/TLS/peer checks.
 */
export function createPinnedHlsHostPorts(options: PinnedHlsHostOptions): PinnedHlsHostPorts {
  const manifestOrigins = [...options.manifests.allowedOrigins];
  const segmentOrigins = [...options.segments.allowedOrigins];
  const manifestPort = createPinnedPublicHlsManifestPort({
    allowedOrigins: manifestOrigins,
    maxBytes: options.manifests.maxBytes,
    timeoutMs: options.manifests.timeoutMs,
    allowLoopbackHttpFixture: false,
  });
  const transport = createPinnedPublicHlsSegmentFetcher({
    allowedOrigins: segmentOrigins,
    maxBytes: options.segments.maxBytes,
    timeoutMs: options.segments.timeoutMs,
    allowLoopbackHttpFixture: false,
  });
  const mediaAssemblyPort = createFfmpegTsMediaAssemblyPort(options.mediaTools);
  const permittedManifests = new Set(manifestOrigins);
  const permittedSegments = new Set(segmentOrigins);

  function selectedManifest(uri: string): boolean {
    const candidate = parsePublicHlsUriCandidate(uri, 'manifest');
    return candidate !== undefined && permittedManifests.has(candidate.origin);
  }

  function bindSelectedPlan(plan: SegmentPlan): AsyncSegmentFetcherPort {
    if (
      plan.kind !== 'hls-segment-plan' ||
      !Object.isFrozen(plan) ||
      !Object.isFrozen(plan.entries) ||
      plan.entries.length < 1 ||
      plan.entries.length > MAX_FFMPEG_TS_SEGMENTS ||
      plan.binding.kind !== 'hls-rendition-binding' ||
      plan.binding.logicalTargetId !== plan.mediaPlaylistLocator.identity ||
      plan.binding.renditionId !== plan.binding.renditionLocator.locator.uri ||
      !selectedManifest(plan.binding.manifestLocator.locator.uri) ||
      !selectedManifest(plan.binding.renditionLocator.locator.uri) ||
      !selectedManifest(plan.mediaPlaylistLocator.locator.uri)
    ) {
      return planRefused();
    }
    const entries = new Map<SegmentPlanEntry, Readonly<{ uri: string; range: Readonly<{ offset: number; length: number }> | undefined }>>();
    const seenPositions = new Set<number>();
    for (const entry of plan.entries) {
      const candidate = parsePublicHlsUriCandidate(entry.locator.locator.uri, 'mpegts-segment');
      if (
        !Object.isFrozen(entry) ||
        !Object.isFrozen(entry.locator) ||
        !Object.isFrozen(entry.locator.locator) ||
        !Object.isFrozen(entry.locator.provenance) ||
        candidate === undefined ||
        !permittedSegments.has(candidate.origin) ||
        entry.locator.identity !== plan.binding.logicalTargetId ||
        entry.locator.provenance.originLocatorUri !== plan.mediaPlaylistLocator.locator.uri ||
        !Number.isSafeInteger(entry.position) ||
        entry.position < 0 ||
        seenPositions.has(entry.position) ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 0 ||
        !Number.isFinite(entry.durationSeconds) ||
        entry.durationSeconds <= 0 ||
        typeof entry.identity !== 'string' ||
        entry.identity.length === 0
      ) {
        return planRefused();
      }
      if (
        entry.byterange !== undefined &&
        (!Object.isFrozen(entry.byterange) ||
          !Number.isSafeInteger(entry.byterange.offset) ||
          entry.byterange.offset < 0 ||
          !Number.isSafeInteger(entry.byterange.length) ||
          entry.byterange.length < 1 ||
          entry.byterange.length > transport.maxResponseBytes)
      ) {
        return planRefused();
      }
      seenPositions.add(entry.position);
      entries.set(entry, Object.freeze({
        uri: entry.locator.locator.uri,
        range: entry.byterange === undefined
          ? undefined
          : Object.freeze({ offset: entry.byterange.offset, length: entry.byterange.length }),
      }));
    }

    return Object.freeze({
      fetcherId: 's4-selected-plan-pinned-https-ts-v1',
      maxResponseBytes: transport.maxResponseBytes,
      async fetch(entry: SegmentPlanEntry) {
        // Referential identity is intentional: no reconstructed request with
        // copied identity/URI may switch the authorized segment or byte range.
        // Freeze is rechecked to prevent runtime tampering via JS callers.
        const bound = entries.get(entry);
        if (
          bound === undefined ||
          !Object.isFrozen(entry) ||
          !Object.isFrozen(entry.locator) ||
          !Object.isFrozen(entry.locator.locator) ||
          !Object.isFrozen(entry.locator.provenance) ||
          entry.locator.locator.uri !== bound.uri ||
          (bound.range === undefined) !== (entry.byterange === undefined) ||
          (bound.range !== undefined &&
            (entry.byterange === undefined ||
              !Object.isFrozen(entry.byterange) ||
              entry.byterange.offset !== bound.range.offset ||
              entry.byterange.length !== bound.range.length))
        ) {
          return { ok: false as const, failure: 'FAILED' as const };
        }
        // Forward a private immutable snapshot, not a JS caller's mutable
        // view, so the HTTP Range can never drift after Core plan admission.
        const pinnedEntry = Object.freeze({
          ...entry,
          byterange: bound.range,
        });
        return transport.fetch(pinnedEntry);
      },
    });
  }

  return Object.freeze({ manifestPort, mediaAssemblyPort, bindSelectedPlan });
}
