/**
 * S6 shipped-popup collection gesture wire preflight, NOT a Core command.
 *
 * This shape is explicitly untrusted browser observation. Only an installed,
 * independently reviewed Core S6 carrier may mint the collection admission,
 * page records, selection snapshot, confirmation, coverage, or any
 * acquisition effect. Until the carrier is integrated the privileged worker
 * refuses every valid S6 intent, without a Native Messaging call or network
 * request.
 */
export interface S6CollectionGesture {
  readonly kind: 'S6_PREPARE_COLLECTION';
  readonly tabId: number;
  readonly pageUrl: string;
  readonly collectionIdentity: string;
  readonly collectionKind: 'playlist' | 'gallery';
  readonly fromPage: number;
  readonly toPage: number;
}

export type S6GestureDecodeResult =
  | { readonly ok: true; readonly value: S6CollectionGesture }
  | { readonly ok: false; readonly detail: string };

const MAX_PAGE_NUMBER = 10_000;
const IDENTITY_PATTERN = /^[A-Za-z0-9_./:-]{1,256}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

/** Web URLs may be observed, not trusted. Reject credentials or signed query secrets. */
function canonicalObservedUri(raw: unknown): raw is string {
  if (
    typeof raw !== 'string' ||
    raw.length < 8 ||
    raw.length > 2048 ||
    Array.from(raw).some(
      (character) =>
        character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.href === raw &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

/** A CollectionIdentity is a bounded identity path (one slash-separated namespace). */
function canonicalCollectionIdentity(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length >= 1 &&
    IDENTITY_PATTERN.test(raw) &&
    !raw.includes('//') &&
    !raw.startsWith('/') &&
    !raw.endsWith('/')
  );
}

export function isS6CollectionGesture(value: unknown): boolean {
  const raw = record(value);
  try {
    return (
      raw !== undefined &&
      Object.prototype.hasOwnProperty.call(raw, 'kind') &&
      raw['kind'] === 'S6_PREPARE_COLLECTION'
    );
  } catch {
    return false;
  }
}

export function decodeS6CollectionGesture(input: unknown): S6GestureDecodeResult {
  const raw = record(input);
  try {
    if (
      raw === undefined ||
      !exactKeys(raw, [
        'kind',
        'tabId',
        'pageUrl',
        'collectionIdentity',
        'collectionKind',
        'fromPage',
        'toPage',
      ]) ||
      raw['kind'] !== 'S6_PREPARE_COLLECTION' ||
      !Number.isSafeInteger(raw['tabId']) ||
      (raw['tabId'] as number) < 0 ||
      !canonicalObservedUri(raw['pageUrl']) ||
      !canonicalCollectionIdentity(raw['collectionIdentity']) ||
      (raw['collectionKind'] !== 'playlist' && raw['collectionKind'] !== 'gallery') ||
      !Number.isSafeInteger(raw['fromPage']) ||
      (raw['fromPage'] as number) < 1 ||
      (raw['fromPage'] as number) > MAX_PAGE_NUMBER ||
      !Number.isSafeInteger(raw['toPage']) ||
      (raw['toPage'] as number) < 1 ||
      (raw['toPage'] as number) > MAX_PAGE_NUMBER ||
      (raw['fromPage'] as number) > (raw['toPage'] as number)
    ) {
      return { ok: false, detail: 'S6_INVALID_COLLECTION_GESTURE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S6_PREPARE_COLLECTION',
        tabId: raw['tabId'] as number,
        pageUrl: raw['pageUrl'],
        collectionIdentity: raw['collectionIdentity'],
        collectionKind: raw['collectionKind'] as 'playlist' | 'gallery',
        fromPage: raw['fromPage'] as number,
        toPage: raw['toPage'] as number,
      },
    };
  } catch {
    return { ok: false, detail: 'S6_INVALID_COLLECTION_GESTURE' };
  }
}
