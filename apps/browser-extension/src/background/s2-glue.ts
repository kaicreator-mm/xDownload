/**
 * #95 pure boundary helpers of the shipped S2 service-worker path.
 *
 * No chrome/DOM access at module scope: these are the exact wire/boundary
 * shapes the installed journey depends on, unit-testable in Node and
 * consumed verbatim by `service-worker.ts`.
 *
 * R1 (PR #96 review F01/F04):
 * - the declared SHA-256 is OPTIONAL: it strengthens target validation when
 *   the page/publisher made a digest known at selection time, but it never
 *   gates an ordinary explicit selection (PRD §28 S2 / §31 CJ-02; C34);
 * - delivered bytes cross Native Messaging as bounded chunk frames of
 *   S2_NM_CHUNK_BYTES raw bytes each (streamed from the fetch body — the
 *   whole attachment is never buffered in the service worker), bounded in
 *   total by MAX_S2_ATTACHMENT_BYTES.
 */

/**
 * Declared v0.1.0 S2 delivered-acquisition bound: one explicit attachment
 * of at most 64 MiB. Derived from the actual native/Core budgets (native
 * host assembly, lane transfer budget, Core staging) and recorded in
 * docs/implementation/v0.1.0/S2_DELIVERED_ACQUISITION_LIMITS.md; it must
 * equal Core's MAX_S2_DELIVERED_BYTES (packages/core-runtime/src/s2-delivered.ts).
 * Enforced BEFORE unconsumed body buffering (Content-Length pre-check, then
 * while streaming).
 */
export const MAX_S2_ATTACHMENT_BYTES = 64 * 1024 * 1024;

/** base64 chunk size: every seam string must stay within the 4096-char bound. */
export const S2_BASE64_CHUNK_SIZE = 3072;

/**
 * Native Messaging chunk frame payload: 768 KiB of raw bytes per frame,
 * exactly 1,048,576 base64 chars (a multiple of 3, so every non-final frame
 * is quantum-aligned). Each NM message stays near 1 MiB — far below the
 * host's 64 MiB inbound frame bound — so the service worker streams instead
 * of buffering the whole attachment.
 */
export const S2_NM_CHUNK_BYTES = 786_432;

export interface S2Selection {
  readonly kind: 'S2_SELECT_ATTACHMENT';
  readonly tabId: number;
  /**
   * The exact page URL the selection was observed on. The service worker
   * re-reads the tab's URL at journey start and fails closed on divergence —
   * the selection's provenance is grounded in the observed page, never in a
   * later navigated state.
   */
  readonly pageUrl: string;
  readonly linkUrl: string;
  readonly linkText: string;
  /** Optional known SHA-256 (strengthens Target validation; never required). */
  readonly expectedSha256?: string;
  readonly contentTypePrefix?: string;
}

export interface S2StatusQuery {
  readonly kind: 'S2_JOURNEY_STATUS';
  readonly observationId: string;
}

export type InternalS2Message = S2Selection | S2StatusQuery;

export type InternalS2Decode =
  | { readonly ok: true; readonly value: InternalS2Message }
  | { readonly ok: false; readonly detail: string };

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Strict decode of the extension-internal popup message (fail closed). */
export function decodeInternalS2Message(raw: unknown): InternalS2Decode {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'message must be an object' };
  }
  const record = raw as Record<string, unknown>;
  if (record['kind'] === 'S2_JOURNEY_STATUS') {
    const unknownKeys = Object.keys(record).filter(
      (key) => key !== 'kind' && key !== 'observationId',
    );
    if (unknownKeys.length > 0) {
      return { ok: false, detail: `unknown field '${unknownKeys[0]}'` };
    }
    if (typeof record['observationId'] !== 'string' || record['observationId'].length === 0) {
      return { ok: false, detail: 'observationId must be a non-empty string' };
    }
    return { ok: true, value: record as unknown as S2StatusQuery };
  }
  const unknownKeys = Object.keys(record).filter(
    (key) =>
      ![
        'kind',
        'tabId',
        'pageUrl',
        'linkUrl',
        'linkText',
        'expectedSha256',
        'contentTypePrefix',
      ].includes(key),
  );
  if (unknownKeys.length > 0) {
    return { ok: false, detail: `unknown field '${unknownKeys[0]}'` };
  }
  if (record['kind'] !== 'S2_SELECT_ATTACHMENT') {
    return { ok: false, detail: 'unknown internal message kind' };
  }
  if (typeof record['tabId'] !== 'number' || !Number.isInteger(record['tabId'])) {
    return { ok: false, detail: 'tabId must be an integer' };
  }
  if (typeof record['pageUrl'] !== 'string' || !isHttpUrl(record['pageUrl'])) {
    return { ok: false, detail: 'pageUrl must be the observed http(s) page URL' };
  }
  if (typeof record['linkUrl'] !== 'string' || !isHttpUrl(record['linkUrl'])) {
    return { ok: false, detail: 'linkUrl must be an http(s) URL' };
  }
  if (typeof record['linkText'] !== 'string' || record['linkText'].length > 512) {
    return { ok: false, detail: 'linkText must be a bounded string' };
  }
  // F01: a declared digest is OPTIONAL — when present it must be a canonical
  // lowercase hex SHA-256, but its absence never gates the selection.
  if (
    record['expectedSha256'] !== undefined &&
    (typeof record['expectedSha256'] !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(record['expectedSha256']))
  ) {
    return {
      ok: false,
      detail: 'expectedSha256, when declared, must be 64 lowercase hex chars',
    };
  }
  if (
    record['contentTypePrefix'] !== undefined &&
    (typeof record['contentTypePrefix'] !== 'string' || record['contentTypePrefix'].length > 128)
  ) {
    return { ok: false, detail: 'contentTypePrefix must be a bounded string when present' };
  }
  return { ok: true, value: record as unknown as S2Selection };
}

declare function btoa(raw: string): string;

/** Split bytes into seam-bounded base64 chunks (≤4096 chars each). */
export function toBase64Chunks(bytes: Uint8Array): string[] {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  const whole = btoa(binary);
  const chunks: string[] = [];
  for (let index = 0; index < whole.length; index += S2_BASE64_CHUNK_SIZE) {
    chunks.push(whole.slice(index, index + S2_BASE64_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Streaming slab encoder (F04): accepts fetch-body chunks of any size and
 * emits base64 slabs of exactly S2_NM_CHUNK_BYTES raw bytes (quantum-aligned,
 * no padding) as they fill; `flush()` emits the final padded slab. The
 * service worker's live memory stays bounded by one slab plus the in-flight
 * read — the whole attachment is never held.
 */
export interface S2SlabEncoder {
  /** Total raw bytes accepted so far. */
  readonly totalBytes: number;
  /** Accept one body chunk; returns the completed slabs (usually 0 or 1). */
  push(chunk: Uint8Array): string[];
  /** Emit the final slab (exactly once, after the body stream ended). */
  flush(): string | undefined;
}

export function createS2SlabEncoder(): S2SlabEncoder {
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let total = 0;
  let flushed = false;
  const encode = (slab: Uint8Array): string => {
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < slab.length; index += step) {
      binary += String.fromCharCode(...slab.subarray(index, index + step));
    }
    return btoa(binary);
  };
  return {
    get totalBytes() {
      return total;
    },
    push(chunk) {
      if (flushed) {
        throw new Error('slab encoder used after flush');
      }
      total += chunk.length;
      pending.push(chunk);
      pendingBytes += chunk.length;
      const slabs: string[] = [];
      while (pendingBytes >= S2_NM_CHUNK_BYTES) {
        const merged = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const part of pending) {
          merged.set(part, offset);
          offset += part.length;
        }
        const slab = merged.subarray(0, S2_NM_CHUNK_BYTES);
        const rest = merged.subarray(S2_NM_CHUNK_BYTES);
        slabs.push(encode(slab as Uint8Array));
        pending = rest.length > 0 ? [rest as Uint8Array] : [];
        pendingBytes = rest.length;
      }
      return slabs;
    },
    flush() {
      if (flushed) {
        throw new Error('slab encoder flushed twice');
      }
      flushed = true;
      if (pendingBytes === 0) {
        return undefined;
      }
      const merged = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const part of pending) {
        merged.set(part, offset);
        offset += part.length;
      }
      pending = [];
      pendingBytes = 0;
      return encode(merged);
    },
  };
}

/** One Native Messaging frame: 4-byte little-endian length prefix + JSON. */
export function encodeNativeFrame(message: unknown): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(4 + encoded.length);
  new DataView(frame.buffer).setUint32(0, encoded.length, true);
  frame.set(encoded, 4);
  return frame.buffer;
}
