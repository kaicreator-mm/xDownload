/**
 * #154 S6 seam-1.2 closed payload codec. Pure, non-authoritative command
 * decoding only; DOES NOT admit collection scope, admit a page navigation,
 * freeze page members, mint confirmation challenges, verify an OS
 * transport/session, create a contract/snapshot or mutate the Core ledger.
 *
 * The S6 explicit finite playlist/gallery journey reuses the #157 frozen
 * canonical-URI anchor vocabulary: collection members are plain http(s)
 * page-observed anchors — canonical credential-free URIs without query
 * secrets or fragments — and the ONLY sanctioned authority source for a
 * confirmed collection BATCH is the separately gated Core CONFIRM handler
 * (#154), never this codec. The declared page range on the DRAFT contract is
 * the sole navigation bound (validateScopeContinuationPair requires
 * continuationScope NONE for collection_page_range); no command here can
 * widen it.
 */
import { createHash } from 'node:crypto';
import { parseSemVer } from '@xdownload/domain-contracts';
import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';
import { canonicalObservedPageUri } from './s5-seam12-payload.ts';

export const S6_SEAM12_COMMAND_TYPES = [
  'PREPARE_S6_COLLECTION',
  'ADMIT_S6_COLLECTION_PAGE',
  'RECORD_S6_COLLECTION_PAGE',
  'CONFIRM_S6_COLLECTION',
  'EXECUTE_S6_COLLECTION',
] as const;

export type S6Seam12CommandType = (typeof S6_SEAM12_COMMAND_TYPES)[number];

/** Upper bound mirrors the #157 shipped popup gesture (frozen at 20). */
export const S6_MAX_PAGE_MEMBERS = 20;

/** Bounded 1-based page numbers (the declared range itself is Core-validated). */
export const S6_MAX_PAGE_NUMBER = 10_000;

/** One page-observed collection member (canonical anchor facts). */
export interface S6ObservedMember {
  readonly href: string;
  readonly text: string;
}

export interface S6PreparePayload {
  readonly snapshotId: string;
  /** Canonical http(s) origin of the observed collection page. */
  readonly collectionOrigin: string;
  /** Bounded observation provenance key (tab identity of the scan). */
  readonly provenanceKey: string;
  /** The user-selected explicit CollectionIdentity (bounded identity string). */
  readonly collectionIdentity: string;
  /** The user-confirmed finite page range (1-based, inclusive). */
  readonly fromPage: number;
  readonly toPage: number;
}

export interface S6AdmitPagePayload {
  readonly snapshotId: string;
  readonly prepareId: string;
  readonly pageNumber: number;
}

export interface S6RecordPagePayload {
  readonly snapshotId: string;
  readonly prepareId: string;
  readonly pageNumber: number;
  readonly members: readonly S6ObservedMember[];
}

export interface S6ConfirmBeginPayload {
  readonly phase: 'BEGIN';
  readonly snapshotId: string;
  readonly prepareId: string;
  /** The exact user-chosen subset of the frozen page members. */
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
}

export interface S6ConfirmCommitPayload {
  readonly phase: 'COMMIT';
  readonly snapshotId: string;
  readonly prepareId: string;
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
  readonly confirmationChallenge: string;
}

export interface S6ExecutePayload {
  readonly snapshotId: string;
  readonly confirmedGroupId: string;
}

/**
 * #154 canonical digest of the frozen collection admission tuple. Computed by
 * Core when freezing the PREPARE record and pinned into it; the installed
 * lane re-computes the SAME digest from the Core-projected prepare facts and
 * aborts on a mismatch. Fixed-order canonical JSON.
 */
export function s6CollectionTupleDigest(input: {
  readonly collectionOrigin: string;
  readonly provenanceKey: string;
  readonly collectionIdentity: string;
  readonly fromPage: number;
  readonly toPage: number;
}): string {
  const canonical = `{"collectionOrigin":${JSON.stringify(input.collectionOrigin)},"provenanceKey":${JSON.stringify(
    input.provenanceKey,
  )},"collectionIdentity":${JSON.stringify(input.collectionIdentity)},"fromPage":${String(
    input.fromPage,
  )},"toPage":${String(input.toPage)}}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * #154 canonical digest of one frozen page's observed member tuple (pinned
 * into the durable page record; the execution driver re-derives member
 * deliveries from these frozen facts only).
 */
export function s6PageTupleDigest(input: {
  readonly pageNumber: number;
  readonly hrefs: readonly string[];
}): string {
  const canonical = `{"pageNumber":${String(input.pageNumber)},"hrefs":[${input.hrefs
    .map((href) => JSON.stringify(href))
    .join(',')}]}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * #154 canonical digest of the exact displayed selection tuple (the frozen
 * prepare joined with the user-chosen member subset). Core mints the BEGIN
 * challenge bound to this digest and verifies it at COMMIT; the lane computes
 * it independently over the SAME Core-projected frozen facts.
 */
export function s6SelectionTupleDigest(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly prepareId: string;
  readonly selectedMemberIds: readonly string[];
}): string {
  const canonical = `{"contractId":${JSON.stringify(input.contractId)},"snapshotId":${JSON.stringify(
    input.snapshotId,
  )},"prepareId":${JSON.stringify(input.prepareId)},"selectedMemberIds":[${input.selectedMemberIds
    .map((id) => JSON.stringify(id))
    .join(',')}]}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type S6Seam12Decoded =
  | { readonly commandType: 'PREPARE_S6_COLLECTION'; readonly payload: S6PreparePayload }
  | { readonly commandType: 'ADMIT_S6_COLLECTION_PAGE'; readonly payload: S6AdmitPagePayload }
  | { readonly commandType: 'RECORD_S6_COLLECTION_PAGE'; readonly payload: S6RecordPagePayload }
  | {
      readonly commandType: 'CONFIRM_S6_COLLECTION';
      readonly payload: S6ConfirmBeginPayload | S6ConfirmCommitPayload;
    }
  | { readonly commandType: 'EXECUTE_S6_COLLECTION'; readonly payload: S6ExecutePayload };

const PREPARE_KEYS = [
  'snapshotId',
  'collectionOrigin',
  'provenanceKey',
  'collectionIdentity',
  'fromPage',
  'toPage',
] as const;
const ADMIT_KEYS = ['snapshotId', 'prepareId', 'pageNumber'] as const;
const RECORD_KEYS = ['snapshotId', 'prepareId', 'pageNumber', 'members'] as const;
const BEGIN_KEYS = [
  'phase',
  'snapshotId',
  'prepareId',
  'selectedMemberIds',
  'displayedTupleDigest',
] as const;
const COMMIT_KEYS = [...BEGIN_KEYS, 'confirmationChallenge'] as const;
const EXECUTE_KEYS = ['snapshotId', 'confirmedGroupId'] as const;

/**
 * Materialize exactly one stable set of own DATA fields before validation
 * (getters/proxies must never change validated fields while copying).
 */
function stablePayload(value: unknown): SeamResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return malformed('payload', 'S6 payload must be a closed object');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return malformed('payload', 'S6 payload must be a plain data object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        return malformed('payload', 'symbol fields are not allowed');
      }
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return malformed(`payload.${key}`, 'S6 payload must use enumerable data fields');
      }
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return seamOk(snapshot);
  } catch {
    return malformed('payload', 'S6 payload cannot be inspected safely');
  }
}

function malformed(path: string, message: string): SeamResult<never> {
  return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', path, message)]);
}

function validateKeys(value: Record<string, unknown>, keys: readonly string[]): SeamResult<void> {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return malformed(`payload.${unknown[0]}`, 'unrecognized S6 authority field');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      return malformed(`payload.${key}`, 'required S6 field missing');
    }
  }
  return seamOk(undefined);
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.:-]+$/u.test(value)
  );
}

/** A CollectionIdentity is a bounded identity path (one slash-separated namespace). */
function boundedCollectionIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_./:-]+$/u.test(value) &&
    !value.includes('//') &&
    value !== '' &&
    !value.startsWith('/') &&
    !value.endsWith('/')
  );
}

/** Bounded 1-based page number. */
function boundedPageNumber(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= S6_MAX_PAGE_NUMBER
  );
}

/** Canonical http(s) origin string (scheme + host + optional port). */
function canonicalCollectionOrigin(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 256) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.origin === raw && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

/** Explicitly refuse prereleases, major != 1, and minors < 2. */
function compatibleS6Minor(version: unknown): boolean {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    return false;
  const parsed = parseSemVer(version);
  return parsed !== undefined && parsed.major === 1 && parsed.minor >= 2;
}

function validateMembers(value: unknown): SeamResult<readonly S6ObservedMember[]> {
  const members = value;
  if (!Array.isArray(members) || members.length < 1 || members.length > S6_MAX_PAGE_MEMBERS) {
    return malformed(
      'payload.members',
      `expected 1..${String(S6_MAX_PAGE_MEMBERS)} observed members`,
    );
  }
  const seen = new Set<string>();
  for (const member of members) {
    if (typeof member !== 'object' || member === null || Array.isArray(member)) {
      return malformed('payload.members', 'each member must be a closed object');
    }
    const record = member as Record<string, unknown>;
    const unknown = Object.keys(record).filter((key) => key !== 'href' && key !== 'text');
    if (unknown.length > 0 || !Object.hasOwn(record, 'href') || !Object.hasOwn(record, 'text')) {
      return malformed('payload.members', 'each member must have exactly href and text');
    }
    if (!canonicalObservedPageUri(record['href'])) {
      return malformed(
        'payload.members.href',
        'expected a canonical credential-free http(s) page-observed URI without query or fragment',
      );
    }
    if (typeof record['text'] !== 'string' || record['text'].length > 256) {
      return malformed('payload.members.text', 'expected anchor text of at most 256 chars');
    }
    if (seen.has(record['href'])) {
      return malformed('payload.members', 'duplicate member href; every member must be unique');
    }
    seen.add(record['href']);
  }
  return seamOk(
    Object.freeze(
      members.map((member) =>
        Object.freeze({
          href: (member as Record<string, unknown>)['href'] as string,
          text: (member as Record<string, unknown>)['text'] as string,
        }),
      ),
    ),
  );
}

/**
 * Decode ONLY the S6 v1.2 payload data structure. Returned objects are
 * frozen *syntactic candidates*, NOT accepted Core commands, confirmed
 * snapshots or session/selection authorization.
 */
export function decodeS6Seam12Payload(
  commandType: unknown,
  schemaVersion: unknown,
  raw: unknown,
): SeamResult<S6Seam12Decoded> {
  if (!compatibleS6Minor(schemaVersion)) {
    return seamFail([
      seamDiagnostic(
        'UNSUPPORTED_ENVELOPE_VERSION',
        'schemaIdentity.version',
        'S6 commands require a final core-seam 1.2.0-or-newer minor of major 1',
      ),
    ]);
  }
  if (
    typeof commandType !== 'string' ||
    !S6_SEAM12_COMMAND_TYPES.includes(commandType as S6Seam12CommandType)
  ) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        'S6 command is not in the closed 1.2 vocabulary',
      ),
    ]);
  }
  const stable = stablePayload(raw);
  if (!stable.ok) return stable;
  const payload = stable.value;

  if (commandType === 'PREPARE_S6_COLLECTION') {
    const keys = validateKeys(payload, PREPARE_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId'])) {
      return malformed('payload.snapshotId', 'expected a bounded 1..128 character identifier');
    }
    if (!canonicalCollectionOrigin(payload['collectionOrigin'])) {
      return malformed('payload.collectionOrigin', 'expected a canonical http(s) origin');
    }
    if (
      typeof payload['provenanceKey'] !== 'string' ||
      payload['provenanceKey'].length === 0 ||
      payload['provenanceKey'].length > 512
    ) {
      return malformed('payload.provenanceKey', 'expected a bounded provenance key');
    }
    if (!boundedCollectionIdentity(payload['collectionIdentity'])) {
      return malformed(
        'payload.collectionIdentity',
        'expected a bounded explicit CollectionIdentity path',
      );
    }
    if (!boundedPageNumber(payload['fromPage']) || !boundedPageNumber(payload['toPage'])) {
      return malformed(
        'payload.fromPage',
        `expected 1-based page numbers within ${String(S6_MAX_PAGE_NUMBER)}`,
      );
    }
    if ((payload['fromPage'] as number) > (payload['toPage'] as number)) {
      return malformed('payload.fromPage', 'fromPage must not exceed toPage');
    }
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze({ ...payload } as unknown as S6PreparePayload),
      }),
    );
  }

  if (commandType === 'ADMIT_S6_COLLECTION_PAGE') {
    const keys = validateKeys(payload, ADMIT_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId']) || !boundedId(payload['prepareId'])) {
      return malformed('payload', 'expected bounded 1..128 character identifiers');
    }
    if (!boundedPageNumber(payload['pageNumber'])) {
      return malformed(
        'payload.pageNumber',
        `expected a 1-based page number within ${String(S6_MAX_PAGE_NUMBER)}`,
      );
    }
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze({ ...payload } as unknown as S6AdmitPagePayload),
      }),
    );
  }

  if (commandType === 'RECORD_S6_COLLECTION_PAGE') {
    const keys = validateKeys(payload, RECORD_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId']) || !boundedId(payload['prepareId'])) {
      return malformed('payload', 'expected bounded 1..128 character identifiers');
    }
    if (!boundedPageNumber(payload['pageNumber'])) {
      return malformed(
        'payload.pageNumber',
        `expected a 1-based page number within ${String(S6_MAX_PAGE_NUMBER)}`,
      );
    }
    const members = validateMembers(payload['members']);
    if (!members.ok) return members;
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze({
          snapshotId: payload['snapshotId'],
          prepareId: payload['prepareId'],
          pageNumber: payload['pageNumber'],
          members: members.value,
        } as unknown as S6RecordPagePayload),
      }),
    );
  }

  if (commandType === 'EXECUTE_S6_COLLECTION') {
    const keys = validateKeys(payload, EXECUTE_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId']) || !boundedId(payload['confirmedGroupId'])) {
      return malformed('payload', 'expected bounded 1..128 character identifiers');
    }
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze({ ...payload } as unknown as S6ExecutePayload),
      }),
    );
  }

  // CONFIRM_S6_COLLECTION phases BEGIN / COMMIT.
  if (payload['phase'] !== 'BEGIN' && payload['phase'] !== 'COMMIT') {
    return malformed('payload.phase', 'expected closed BEGIN or COMMIT phase');
  }
  const allowed = payload['phase'] === 'BEGIN' ? BEGIN_KEYS : COMMIT_KEYS;
  const keys = validateKeys(payload, allowed);
  if (!keys.ok) return keys;
  if (!boundedId(payload['snapshotId']) || !boundedId(payload['prepareId'])) {
    return malformed('payload', 'expected bounded 1..128 character identifiers');
  }
  const selected = payload['selectedMemberIds'];
  if (
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > S6_MAX_PAGE_MEMBERS * 4 ||
    selected.some((id) => !boundedId(id)) ||
    new Set(selected).size !== selected.length
  ) {
    return malformed(
      'payload.selectedMemberIds',
      `expected 1..${String(S6_MAX_PAGE_MEMBERS * 4)} unique bounded member identifiers`,
    );
  }
  if (
    typeof payload['displayedTupleDigest'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(payload['displayedTupleDigest'])
  ) {
    return malformed('payload.displayedTupleDigest', 'expected a lowercase 64-hex tuple digest');
  }
  if (
    payload['phase'] === 'COMMIT' &&
    (typeof payload['confirmationChallenge'] !== 'string' ||
      !/^[A-Za-z0-9_-]{22,128}$/u.test(payload['confirmationChallenge']))
  ) {
    return malformed(
      'payload.confirmationChallenge',
      'expected a bounded opaque base64url challenge',
    );
  }
  return seamOk(
    Object.freeze({
      commandType: 'CONFIRM_S6_COLLECTION',
      payload: Object.freeze({ ...payload } as unknown as
        S6ConfirmBeginPayload | S6ConfirmCommitPayload),
    }),
  );
}
