/**
 * #95 pure boundary helpers of the shipped S2 service-worker path.
 *
 * No chrome/DOM access at module scope: these are the exact wire/boundary
 * shapes the installed journey depends on, unit-testable in Node and
 * consumed verbatim by `service-worker.ts`.
 */

/** v0.1.0 declared bound for one delivered attachment (see service worker). */
export const MAX_S2_ATTACHMENT_BYTES = 512 * 1024;

/** base64 chunk size: every seam string must stay within the 4096-char bound. */
export const S2_BASE64_CHUNK_SIZE = 3072;

export interface S2Selection {
  readonly kind: 'S2_SELECT_ATTACHMENT';
  readonly tabId: number;
  readonly linkUrl: string;
  readonly linkText: string;
  readonly expectedSha256: string;
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
      !['kind', 'tabId', 'linkUrl', 'linkText', 'expectedSha256', 'contentTypePrefix'].includes(
        key,
      ),
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
  if (typeof record['linkUrl'] !== 'string' || !isHttpUrl(record['linkUrl'])) {
    return { ok: false, detail: 'linkUrl must be an http(s) URL' };
  }
  if (typeof record['linkText'] !== 'string' || record['linkText'].length > 512) {
    return { ok: false, detail: 'linkText must be a bounded string' };
  }
  if (
    typeof record['expectedSha256'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(record['expectedSha256'])
  ) {
    return {
      ok: false,
      detail: 'expectedSha256 must be a declared hex SHA-256 (frozen validation contract)',
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

/** One Native Messaging frame: 4-byte little-endian length prefix + JSON. */
export function encodeNativeFrame(message: unknown): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(4 + encoded.length);
  new DataView(frame.buffer).setUint32(0, encoded.length, true);
  frame.set(encoded, 4);
  return frame.buffer;
}
