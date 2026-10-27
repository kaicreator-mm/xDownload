/**
 * #154 S6 collection journey internal message decoders — the closed shapes
 * the shipped popup may send to the privileged worker (extension-internal
 * boundary; `sender.id === chrome.runtime.id` is enforced by the worker).
 *
 * These are browser-observed gestures ONLY: the worker never treats any of
 * them as a Core-confirmed snapshot, coverage or terminal; every authority
 * object comes back verbatim from the Core projection through the installed
 * S6 Native Messaging lane. The declared page range on the Core-frozen
 * admission is the only navigation bound — a page request outside it is
 * rejected by Core, never widened here.
 */

export interface S6PageAdmitMessage {
  readonly kind: 'S6_PAGE_ADMIT';
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly pageNumber: number;
  /**
   * The EXACT next-page href Core must durably pin as the only approved
   * navigation target (R1 P1-01); RECORD verifies the landing URL against it.
   */
  readonly nextPageUrl: string;
}

export interface S6PageRecordMessage {
  readonly kind: 'S6_PAGE_RECORD';
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly pageNumber: number;
  readonly members: readonly {
    readonly href: string;
    readonly text: string;
  }[];
  /** The actually observed page URL the members were scanned on (R1 P1-01). */
  readonly pageUrl: string;
}

export interface S6ConfirmCollectionMessage {
  readonly kind: 'S6_CONFIRM_COLLECTION';
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
}

export interface S6ExecuteCollectionMessage {
  readonly kind: 'S6_EXECUTE_COLLECTION';
  readonly contractId: string;
  readonly confirmedGroupId: string;
  readonly snapshotId: string;
}

export interface S6JourneyStatusMessage {
  readonly kind: 'S6_COLLECTION_JOURNEY_STATUS';
  readonly contractId: string;
}

/** Query the newest non-terminal S6 journey (R1 P2-02 popup restore). */
export interface S6ActiveJourneyQueryMessage {
  readonly kind: 'S6_ACTIVE_COLLECTION_QUERY';
}

export type S6BatchMessage =
  | S6PageAdmitMessage
  | S6PageRecordMessage
  | S6ConfirmCollectionMessage
  | S6ExecuteCollectionMessage
  | S6JourneyStatusMessage
  | S6ActiveJourneyQueryMessage;

export type S6BatchDecodeResult =
  | { readonly ok: true; readonly value: S6BatchMessage }
  | { readonly ok: false; readonly detail: string };

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const MAX_PAGE_NUMBER = 10_000;
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

function boundedId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return undefined;
  return value;
}

/** Web URLs may be observed, not trusted (the #157 frozen rule). */
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

function boundedPageNumber(value: unknown): number | undefined {
  if (!Number.isSafeInteger(value)) return undefined;
  const page = value as number;
  return page >= 1 && page <= MAX_PAGE_NUMBER ? page : undefined;
}

function boundedIdList(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = boundedId(item);
    if (id === undefined || seen.has(id)) return undefined;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function memberList(value: unknown): { href: string; text: string }[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEMBERS) return undefined;
  const members: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const unknownMember of value) {
    const item = record(unknownMember);
    if (
      item === undefined ||
      !exactKeys(item, ['href', 'text']) ||
      typeof item['href'] !== 'string' ||
      item['href'].length < 8 ||
      item['href'].length > 2048 ||
      typeof item['text'] !== 'string' ||
      item['text'].length > 256 ||
      seen.has(item['href'])
    ) {
      return undefined;
    }
    seen.add(item['href']);
    members.push({ href: item['href'], text: item['text'] });
  }
  return members;
}

export function isS6BatchMessageKind(value: unknown): boolean {
  const raw = record(value);
  const kind = raw?.['kind'];
  return (
    kind === 'S6_PAGE_ADMIT' ||
    kind === 'S6_PAGE_RECORD' ||
    kind === 'S6_CONFIRM_COLLECTION' ||
    kind === 'S6_EXECUTE_COLLECTION' ||
    kind === 'S6_COLLECTION_JOURNEY_STATUS' ||
    kind === 'S6_ACTIVE_COLLECTION_QUERY'
  );
}

export function decodeS6BatchMessage(input: unknown): S6BatchDecodeResult {
  const raw = record(input);
  if (raw === undefined) {
    return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
  }
  if (raw['kind'] === 'S6_COLLECTION_JOURNEY_STATUS') {
    const contractId = boundedId(raw['contractId']);
    if (!exactKeys(raw, ['kind', 'contractId']) || contractId === undefined) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return { ok: true, value: { kind: 'S6_COLLECTION_JOURNEY_STATUS', contractId } };
  }
  if (raw['kind'] === 'S6_ACTIVE_COLLECTION_QUERY') {
    if (!exactKeys(raw, ['kind'])) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return { ok: true, value: { kind: 'S6_ACTIVE_COLLECTION_QUERY' } };
  }
  const contractId = boundedId(raw['contractId']);
  const snapshotId = boundedId(raw['snapshotId']);
  // EXECUTE carries confirmedGroupId (NOT prepareId); every other batch
  // message carries prepareId. Decode per-kind — a common pre-extraction
  // would reject the EXECUTE shape outright.
  if (raw['kind'] === 'S6_EXECUTE_COLLECTION') {
    if (!exactKeys(raw, ['kind', 'contractId', 'confirmedGroupId', 'snapshotId'])) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    const confirmedGroupId = boundedId(raw['confirmedGroupId']);
    if (contractId === undefined || confirmedGroupId === undefined || snapshotId === undefined) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S6_EXECUTE_COLLECTION',
        contractId,
        confirmedGroupId,
        snapshotId,
      },
    };
  }
  const prepareId = boundedId(raw['prepareId']);
  if (
    contractId === undefined ||
    prepareId === undefined ||
    snapshotId === undefined ||
    typeof raw['kind'] !== 'string'
  ) {
    return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
  }
  if (raw['kind'] === 'S6_PAGE_ADMIT') {
    if (
      !exactKeys(raw, [
        'kind',
        'contractId',
        'prepareId',
        'snapshotId',
        'pageNumber',
        'nextPageUrl',
      ])
    ) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    const pageNumber = boundedPageNumber(raw['pageNumber']);
    const nextPageUrl = canonicalObservedUri(raw['nextPageUrl'])
      ? (raw['nextPageUrl'] as string)
      : undefined;
    if (pageNumber === undefined || nextPageUrl === undefined) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S6_PAGE_ADMIT',
        contractId,
        prepareId,
        snapshotId,
        pageNumber,
        nextPageUrl,
      },
    };
  }
  if (raw['kind'] === 'S6_PAGE_RECORD') {
    if (
      !exactKeys(raw, [
        'kind',
        'contractId',
        'prepareId',
        'snapshotId',
        'pageNumber',
        'members',
        'pageUrl',
      ])
    ) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    const pageNumber = boundedPageNumber(raw['pageNumber']);
    const members = memberList(raw['members']);
    const pageUrl = canonicalObservedUri(raw['pageUrl']) ? (raw['pageUrl'] as string) : undefined;
    if (pageNumber === undefined || members === undefined || pageUrl === undefined) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S6_PAGE_RECORD',
        contractId,
        prepareId,
        snapshotId,
        pageNumber,
        members,
        pageUrl,
      },
    };
  }
  if (raw['kind'] === 'S6_CONFIRM_COLLECTION') {
    if (!exactKeys(raw, ['kind', 'contractId', 'prepareId', 'snapshotId', 'selectedMemberIds'])) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    const ids = boundedIdList(raw['selectedMemberIds'], 80);
    if (ids === undefined) {
      return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S6_CONFIRM_COLLECTION',
        contractId,
        prepareId,
        snapshotId,
        selectedMemberIds: ids,
      },
    };
  }
  return { ok: false, detail: 'S6_INVALID_BATCH_MESSAGE' };
}
