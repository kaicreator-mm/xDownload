/**
 * T009 — bounded deterministic HLS playlist decoding (RFC 8216 subset).
 *
 * S4 "HLS VOD Basic" is a specialized adapter (frozen L2 U6/ADR-006): HLS is
 * playlist/segment/rendition structured and is never treated as one opaque
 * file. This decoder is deliberately bounded and stricter than the RFC: it
 * recognizes only the tag set a basic non-DRM VOD topology may contain and
 * fails closed on malformed required fields, unknown authoritative tags,
 * unknown attributes, duplicate segment/variant identities and unsupported
 * playlist versions. Unrecognized input is never reinterpreted into
 * "probably fine" transfer behavior.
 *
 * F1 record: no runtime dependency is introduced; playlists are consumed as
 * text and decoded in-repo with this bounded parser.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

/** Highest EXT-X-VERSION this basic adapter supports; higher versions fail closed. */
export const SUPPORTED_PLAYLIST_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

export interface VariantStream {
  /** Ordinal position of the variant in the master playlist. */
  readonly index: number;
  /** Variant URI resolved against the master playlist base URI. */
  readonly uri: string;
  readonly bandwidth: number;
  readonly codecs: readonly string[];
  readonly resolution?: Resolution;
}

export interface MasterPlaylist {
  readonly kind: 'master';
  readonly version: number;
  /** Declared separate media renditions (EXT-X-MEDIA); basic S4 never supports these. */
  readonly mediaRenditionCount: number;
  readonly variants: readonly VariantStream[];
}

export interface KeyDeclaration {
  /** RFC 8216 KEYMETHOD; anything other than NONE makes the topology unsupported. */
  readonly method: 'NONE' | 'AES-128' | 'SAMPLE-AES';
  readonly index: number;
  /** Whether a key URI was declared; raw key material is never decoded or stored. */
  readonly hasKeyUri: boolean;
}

export interface Byterange {
  readonly length: number;
  readonly offset: number;
}

export interface MediaSegment {
  readonly position: number;
  /** Media sequence number (EXT-X-MEDIA-SEQUENCE + position). */
  readonly sequence: number;
  readonly durationSeconds: number;
  readonly title?: string;
  /** Segment URI resolved against the media playlist base URI. */
  readonly uri: string;
  readonly byterange?: Byterange;
}

export interface MediaPlaylist {
  readonly kind: 'media';
  readonly version: number;
  readonly targetDurationSeconds: number;
  readonly mediaSequence: number;
  readonly playlistType?: 'VOD' | 'EVENT';
  /** True when EXT-X-ENDLIST was present; an unclosed playlist is a live/unbounded topology. */
  readonly closed: boolean;
  readonly keys: readonly KeyDeclaration[];
  readonly hasInitializationSection: boolean;
  readonly hasDiscontinuity: boolean;
  readonly segments: readonly MediaSegment[];
}

const MASTER_TAGS: ReadonlySet<string> = new Set([
  '#EXTM3U',
  '#EXT-X-VERSION',
  '#EXT-X-STREAM-INF',
  '#EXT-X-MEDIA',
]);

const MEDIA_TAGS: ReadonlySet<string> = new Set([
  '#EXTM3U',
  '#EXT-X-VERSION',
  '#EXT-X-TARGETDURATION',
  '#EXT-X-MEDIA-SEQUENCE',
  '#EXT-X-DISCONTINUITY-SEQUENCE',
  '#EXT-X-PLAYLIST-TYPE',
  '#EXT-X-KEY',
  '#EXT-X-MAP',
  '#EXT-X-PROGRAM-DATE-TIME',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-BYTERANGE',
  '#EXTINF',
  '#EXT-X-ENDLIST',
]);

const STREAM_INF_ATTRIBUTES: ReadonlySet<string> = new Set([
  'BANDWIDTH',
  'AVERAGE-BANDWIDTH',
  'CODECS',
  'RESOLUTION',
  'FRAME-RATE',
]);

function splitLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line.trim().length > 0);
}

function isInteger(raw: string): number | undefined {
  if (!/^-?\d+$/u.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function extractTagName(line: string): string | undefined {
  const colon = line.indexOf(':');
  return (colon === -1 ? line : line.slice(0, colon)).trim();
}

/** Shared prologue: EXTM3U header, explicit supported version, no unknown authoritative tag. */
function decodePlaylistPrologue(
  text: unknown,
  knownTags: ReadonlySet<string>,
  path: string,
): DomainValidationResult<{ readonly lines: readonly string[]; readonly version: number }> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', path, 'playlist must be non-empty text')]);
  }
  const lines = splitLines(text);
  const first = lines[0];
  if (first === undefined || first.trim() !== '#EXTM3U') {
    return fail([
      diagnostic('MISSING_REQUIRED_FIELD', `${path}.#EXTM3U`, 'playlist must begin with #EXTM3U'),
    ]);
  }
  for (const line of lines) {
    if (!line.startsWith('#EXT')) {
      continue;
    }
    const tag = extractTagName(line);
    if (tag === undefined || !knownTags.has(tag)) {
      return fail([
        diagnostic(
          'UNKNOWN_ENUM_VALUE',
          `${path}.tag`,
          `unknown authoritative playlist tag '${line.slice(0, 48)}'; the basic S4 decoder fails closed`,
          'RFC8216',
        ),
      ]);
    }
  }
  let versionCount = 0;
  let version: number | undefined;
  for (const line of lines) {
    if (extractTagName(line) !== '#EXT-X-VERSION') {
      continue;
    }
    versionCount += 1;
    const parsed = isInteger(line.slice('#EXT-X-VERSION:'.length).trim());
    if (parsed === undefined || !SUPPORTED_PLAYLIST_VERSIONS.includes(parsed)) {
      return fail([
        diagnostic(
          'UNSUPPORTED_SCHEMA_VERSION',
          `${path}.EXT-X-VERSION`,
          `unsupported playlist version '${line.slice('#EXT-X-VERSION:'.length).trim()}'; supported versions are ${SUPPORTED_PLAYLIST_VERSIONS.join(', ')}`,
          'RFC8216',
        ),
      ]);
    }
    version = parsed;
  }
  if (versionCount === 0 || version === undefined) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        `${path}.EXT-X-VERSION`,
        'explicit EXT-X-VERSION is required by the bounded basic-S4 decoder',
      ),
    ]);
  }
  if (versionCount > 1) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        `${path}.EXT-X-VERSION`,
        'conflicting duplicate EXT-X-VERSION declarations',
      ),
    ]);
  }
  return ok({ lines, version });
}

function resolveUri(uri: string, baseUri: string, path: string): DomainValidationResult<string> {
  try {
    return ok(new URL(uri, baseUri).toString());
  } catch {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        path,
        `URI '${uri}' is not resolvable against the playlist base URI`,
      ),
    ]);
  }
}

function parseStreamInfAttributes(
  line: string,
  path: string,
): DomainValidationResult<{
  readonly bandwidth: number;
  readonly codecs: readonly string[];
  readonly resolution?: Resolution;
}> {
  const raw = line.slice('#EXT-X-STREAM-INF:'.length).trim();
  const diagnostics: ValidationDiagnostic[] = [];
  const attrs = parseAttributeList(raw);
  let bandwidth: number | undefined;
  let codecs: readonly string[] = [];
  let resolution: Resolution | undefined;
  for (const attr of attrs) {
    if (!STREAM_INF_ATTRIBUTES.has(attr.name)) {
      diagnostics.push(
        diagnostic(
          'UNKNOWN_FIELD',
          `${path}.${attr.name}`,
          `unknown EXT-X-STREAM-INF attribute '${attr.name}'; the bounded basic-S4 decoder fails closed`,
        ),
      );
      continue;
    }
    if (attr.name === 'BANDWIDTH') {
      const parsed = isInteger(attr.value);
      if (parsed === undefined || parsed <= 0) {
        diagnostics.push(
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.BANDWIDTH`,
            'BANDWIDTH must be a positive integer',
          ),
        );
      } else {
        bandwidth = parsed;
      }
    }
    if (attr.name === 'CODECS') {
      codecs = attr.value
        .split(',')
        .map((codec) => codec.trim())
        .filter((codec) => codec.length > 0);
    }
    if (attr.name === 'RESOLUTION') {
      const match = /^(\d+)x(\d+)$/u.exec(attr.value);
      if (match === null) {
        diagnostics.push(
          diagnostic('MALFORMED_REQUIRED_FIELD', `${path}.RESOLUTION`, 'RESOLUTION must be WxH'),
        );
      } else {
        resolution = { width: Number(match[1]), height: Number(match[2]) };
      }
    }
  }
  if (bandwidth === undefined) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        `${path}.BANDWIDTH`,
        'EXT-X-STREAM-INF requires BANDWIDTH',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok({ bandwidth: bandwidth!, codecs, resolution });
}

function parseAttributeList(
  raw: string,
): readonly { readonly name: string; readonly value: string }[] {
  const attributes: { name: string; value: string }[] = [];
  let current = '';
  let inQuotes = false;
  const parts: string[] = [];
  for (const char of raw) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    parts.push(current);
  }
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/u, '$1');
    attributes.push({ name, value });
  }
  return attributes;
}

/** Decode a master playlist (variant/rendition manifest) from untrusted text. */
export function decodeMasterPlaylist(
  text: unknown,
  baseUri: string,
): DomainValidationResult<MasterPlaylist> {
  const prologue = decodePlaylistPrologue(text, MASTER_TAGS, 'masterPlaylist');
  if (!prologue.ok) {
    return prologue;
  }
  const { lines, version } = prologue.value;
  try {
    void new URL(baseUri);
  } catch {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'masterPlaylist.baseUri',
        'base URI is not a valid absolute URL',
      ),
    ]);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  const variants: VariantStream[] = [];
  const seenVariantUris = new Set<string>();
  let mediaRenditionCount = 0;
  let pendingStreamInf: string | undefined;
  for (const line of lines) {
    if (line.startsWith('#')) {
      if (extractTagName(line) === '#EXT-X-STREAM-INF') {
        if (pendingStreamInf !== undefined) {
          diagnostics.push(
            diagnostic(
              'MALFORMED_REQUIRED_FIELD',
              'masterPlaylist.EXT-X-STREAM-INF',
              'EXT-X-STREAM-INF must be followed by a variant URI line',
            ),
          );
        }
        pendingStreamInf = line;
        continue;
      }
      if (extractTagName(line) === '#EXT-X-MEDIA') {
        mediaRenditionCount += 1;
      }
      continue;
    }
    // URI line.
    if (pendingStreamInf === undefined) {
      continue;
    }
    const parsed = parseStreamInfAttributes(
      pendingStreamInf,
      `masterPlaylist.variants[${variants.length}]`,
    );
    if (!parsed.ok) {
      diagnostics.push(...parsed.diagnostics);
      pendingStreamInf = undefined;
      continue;
    }
    const resolved = resolveUri(
      line.trim(),
      baseUri,
      `masterPlaylist.variants[${variants.length}].uri`,
    );
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      pendingStreamInf = undefined;
      continue;
    }
    if (seenVariantUris.has(resolved.value)) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          `masterPlaylist.variants[${variants.length}].uri`,
          `duplicate variant rendition identity '${resolved.value}'`,
        ),
      );
      pendingStreamInf = undefined;
      continue;
    }
    seenVariantUris.add(resolved.value);
    variants.push(
      deepFreeze({
        index: variants.length,
        uri: resolved.value,
        bandwidth: parsed.value.bandwidth,
        codecs: parsed.value.codecs,
        resolution: parsed.value.resolution,
      }),
    );
    pendingStreamInf = undefined;
  }
  if (pendingStreamInf !== undefined) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'masterPlaylist.EXT-X-STREAM-INF',
        'EXT-X-STREAM-INF must be followed by a variant URI line',
      ),
    );
  }
  if (variants.length === 0 && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'masterPlaylist.variants',
        'master playlist without variants',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(
    deepFreeze({
      kind: 'master' as const,
      version,
      mediaRenditionCount,
      variants,
    }),
  );
}

interface PendingSegment {
  durationSeconds: number | undefined;
  title: string | undefined;
  byterange: Byterange | undefined;
}

/** Decode a media playlist (rendition segment list) from untrusted text. */
export function decodeMediaPlaylist(
  text: unknown,
  baseUri: string,
): DomainValidationResult<MediaPlaylist> {
  const prologue = decodePlaylistPrologue(text, MEDIA_TAGS, 'mediaPlaylist');
  if (!prologue.ok) {
    return prologue;
  }
  const { lines, version } = prologue.value;
  try {
    void new URL(baseUri);
  } catch {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'mediaPlaylist.baseUri',
        'base URI is not a valid absolute URL',
      ),
    ]);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let playlistType: 'VOD' | 'EVENT' | undefined;
  let closed = false;
  let hasInitializationSection = false;
  let hasDiscontinuity = false;
  const keys: KeyDeclaration[] = [];
  const segments: MediaSegment[] = [];
  const seenIdentities = new Set<string>();
  let pending: PendingSegment | undefined;
  let previousByterangeEnd: number | undefined;
  for (const line of lines) {
    if (line.startsWith('#')) {
      const tag = extractTagName(line);
      switch (tag) {
        case '#EXT-X-TARGETDURATION': {
          const parsed = isInteger(line.slice('#EXT-X-TARGETDURATION:'.length).trim());
          if (parsed === undefined || parsed <= 0) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXT-X-TARGETDURATION',
                'EXT-X-TARGETDURATION must be a positive integer',
              ),
            );
          } else if (targetDuration !== undefined && targetDuration !== parsed) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXT-X-TARGETDURATION',
                'conflicting duplicate EXT-X-TARGETDURATION declarations',
              ),
            );
          } else {
            targetDuration = parsed;
          }
          break;
        }
        case '#EXT-X-MEDIA-SEQUENCE': {
          const parsed = isInteger(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length).trim());
          if (parsed === undefined || parsed < 0) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXT-X-MEDIA-SEQUENCE',
                'EXT-X-MEDIA-SEQUENCE must be a non-negative integer',
              ),
            );
          } else {
            mediaSequence = parsed;
          }
          break;
        }
        case '#EXT-X-PLAYLIST-TYPE': {
          const value = line.slice('#EXT-X-PLAYLIST-TYPE:'.length).trim();
          if (value !== 'VOD' && value !== 'EVENT') {
            diagnostics.push(
              diagnostic(
                'UNKNOWN_ENUM_VALUE',
                'mediaPlaylist.EXT-X-PLAYLIST-TYPE',
                `unknown playlist type '${value}'`,
              ),
            );
          } else {
            playlistType = value;
          }
          break;
        }
        case '#EXT-X-KEY': {
          const attrs = parseAttributeList(line.slice('#EXT-X-KEY:'.length).trim());
          const method = attrs.find((attr) => attr.name === 'METHOD')?.value;
          if (method !== 'NONE' && method !== 'AES-128' && method !== 'SAMPLE-AES') {
            diagnostics.push(
              diagnostic(
                'UNKNOWN_ENUM_VALUE',
                'mediaPlaylist.EXT-X-KEY.METHOD',
                `unknown KEYMETHOD '${String(method)}'`,
              ),
            );
          } else {
            keys.push(
              deepFreeze({
                method,
                index: keys.length,
                hasKeyUri: attrs.some((attr) => attr.name === 'URI'),
              }),
            );
          }
          break;
        }
        case '#EXT-X-MAP':
          hasInitializationSection = true;
          break;
        case '#EXT-X-DISCONTINUITY':
          hasDiscontinuity = true;
          break;
        case '#EXT-X-BYTERANGE': {
          const raw = line.slice('#EXT-X-BYTERANGE:'.length).trim();
          const match = /^(\d+)(?:@(\d+))?$/u.exec(raw);
          if (match === null) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXT-X-BYTERANGE',
                `malformed byterange '${raw}'`,
              ),
            );
            break;
          }
          const length = Number(match[1]);
          if (match[2] === undefined) {
            if (previousByterangeEnd === undefined) {
              diagnostics.push(
                diagnostic(
                  'MALFORMED_REQUIRED_FIELD',
                  'mediaPlaylist.EXT-X-BYTERANGE',
                  'byterange without explicit offset requires a preceding byteranged segment',
                ),
              );
              break;
            }
            pending = withByterange(pending, { length, offset: previousByterangeEnd });
          } else {
            pending = withByterange(pending, { length, offset: Number(match[2]) });
          }
          break;
        }
        case '#EXTINF': {
          const raw = line.slice('#EXTINF:'.length).trim();
          const comma = raw.indexOf(',');
          const durationRaw = comma === -1 ? raw : raw.slice(0, comma);
          const title = comma === -1 ? undefined : raw.slice(comma + 1);
          const duration = Number(durationRaw);
          if (!Number.isFinite(duration) || duration < 0) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXTINF',
                `EXTINF duration must be a non-negative number, got '${durationRaw}'`,
              ),
            );
            break;
          }
          if (pending !== undefined && pending.durationSeconds !== undefined) {
            diagnostics.push(
              diagnostic(
                'MALFORMED_REQUIRED_FIELD',
                'mediaPlaylist.EXTINF',
                'EXTINF must be followed by a segment URI before the next EXTINF',
              ),
            );
          }
          pending = {
            durationSeconds: duration,
            title,
            byterange: pending?.byterange,
          };
          break;
        }
        case '#EXT-X-ENDLIST':
          closed = true;
          break;
        default:
          break;
      }
      continue;
    }
    // URI line.
    if (pending === undefined || pending.durationSeconds === undefined) {
      continue;
    }
    const position = segments.length;
    const resolved = resolveUri(line.trim(), baseUri, `mediaPlaylist.segments[${position}].uri`);
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      pending = undefined;
      continue;
    }
    const byterange = pending.byterange;
    const identity =
      byterange === undefined
        ? resolved.value
        : `${resolved.value}|${byterange.offset}:${byterange.length}`;
    if (seenIdentities.has(identity)) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_IDENTITY',
          `mediaPlaylist.segments[${position}]`,
          'duplicate segment identity; duplicate or conflicting segment semantics are rejected',
        ),
      );
      pending = undefined;
      continue;
    }
    seenIdentities.add(identity);
    if (byterange !== undefined) {
      previousByterangeEnd = byterange.offset + byterange.length;
    }
    segments.push(
      deepFreeze({
        position,
        sequence: mediaSequence + position,
        durationSeconds: pending.durationSeconds,
        title: pending.title,
        uri: resolved.value,
        byterange,
      }),
    );
    pending = undefined;
  }
  if (pending !== undefined && pending.durationSeconds !== undefined) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'mediaPlaylist.segments',
        'EXTINF must be followed by a segment URI line',
      ),
    );
  }
  if (targetDuration === undefined) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'mediaPlaylist.EXT-X-TARGETDURATION',
        'EXT-X-TARGETDURATION is required',
      ),
    );
  }
  if (segments.length === 0 && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'mediaPlaylist.segments',
        'media playlist without segments',
      ),
    );
  }
  if (targetDuration !== undefined) {
    for (const segment of segments) {
      if (Math.round(segment.durationSeconds) > targetDuration) {
        diagnostics.push(
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `mediaPlaylist.segments[${segment.position}].durationSeconds`,
            'segment duration exceeds EXT-X-TARGETDURATION',
            'RFC8216',
          ),
        );
      }
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(
    deepFreeze({
      kind: 'media' as const,
      version,
      targetDurationSeconds: targetDuration!,
      mediaSequence,
      playlistType,
      closed,
      keys,
      hasInitializationSection,
      hasDiscontinuity,
      segments,
    }),
  );
}

function withByterange(pending: PendingSegment | undefined, byterange: Byterange): PendingSegment {
  return {
    durationSeconds: pending?.durationSeconds,
    title: pending?.title,
    byterange,
  };
}
