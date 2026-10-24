/**
 * S5 shipped-popup group gesture wire preflight, NOT a Core command.
 *
 * This shape is explicitly untrusted browser observation. Only an installed,
 * independently reviewed Core S5 carrier may mint selection snapshot,
 * confirmation, accepted contract, coverage, or any acquisition effect.
 * Until #151 is integrated the privileged worker refuses every valid S5
 * intent, without a Native Messaging call or network request.
 */
export interface S5PageGroupGesture {
  readonly kind: 'S5_PREPARE_CURRENT_PAGE_GROUP';
  readonly tabId: number;
  readonly pageUrl: string;
  readonly observedMemberCount: number;
  readonly members: readonly {
    readonly href: string;
    readonly text: string;
  }[];
}

export type S5GestureDecodeResult =
  | { readonly ok: true; readonly value: S5PageGroupGesture }
  | { readonly ok: false; readonly detail: string };

const MAX_MEMBERS = 20;

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
    Array.from(raw).some((character) =>
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

export function isS5PageGroupGesture(value: unknown): boolean {
  const raw = record(value);
  try {
    return (
      raw !== undefined &&
      Object.prototype.hasOwnProperty.call(raw, 'kind') &&
      raw['kind'] === 'S5_PREPARE_CURRENT_PAGE_GROUP'
    );
  } catch {
    return false;
  }
}

export function decodeS5PageGroupGesture(input: unknown): S5GestureDecodeResult {
  const raw = record(input);
  try {
    if (
      raw === undefined ||
      !exactKeys(raw, ['kind', 'tabId', 'pageUrl', 'observedMemberCount', 'members']) ||
      raw['kind'] !== 'S5_PREPARE_CURRENT_PAGE_GROUP' ||
      !Number.isSafeInteger(raw['tabId']) ||
      (raw['tabId'] as number) < 0 ||
      !canonicalObservedUri(raw['pageUrl']) ||
      !Array.isArray(raw['members']) ||
      !Number.isSafeInteger(raw['observedMemberCount']) ||
      (raw['observedMemberCount'] as number) !== raw['members'].length ||
      raw['members'].length < 1 ||
      raw['members'].length > MAX_MEMBERS
    ) {
      return { ok: false, detail: 'S5_INVALID_PAGE_GROUP_GESTURE' };
    }
    const members: { href: string; text: string }[] = [];
    const unique = new Set<string>();
    for (const unknownMember of raw['members']) {
      const item = record(unknownMember);
      if (
        item === undefined ||
        !exactKeys(item, ['href', 'text']) ||
        !canonicalObservedUri(item['href']) ||
        typeof item['text'] !== 'string' ||
        item['text'].length > 256 ||
        unique.has(item['href'])
      ) {
        return { ok: false, detail: 'S5_INVALID_PAGE_GROUP_GESTURE' };
      }
      unique.add(item['href']);
      members.push({ href: item['href'], text: item['text'] });
    }
    return {
      ok: true,
      value: {
        kind: 'S5_PREPARE_CURRENT_PAGE_GROUP',
        tabId: raw['tabId'] as number,
        pageUrl: raw['pageUrl'],
        observedMemberCount: members.length,
        members,
      },
    };
  } catch {
    return { ok: false, detail: 'S5_INVALID_PAGE_GROUP_GESTURE' };
  }
}
