/**
 * #151/#152 S5 seam-1.2 closed payload codec. Pure, non-authoritative
 * command decoding only; DOES NOT mint confirmation challenges, verify an OS
 * transport/session, freeze a page group, create a contract/snapshot or
 * mutate the Core ledger.
 *
 * The browser-origin S5 journey reuses the #157 frozen current-page gesture
 * vocabulary semantics: members are plain http(s) page-observed anchors —
 * canonical credential-free URIs without query secrets or fragments — and
 * the ONLY sanctioned authority source for a confirmed current-page BATCH is
 * the separately gated Core CONFIRM handler (#151), never this codec.
 */
import { createHash } from 'node:crypto';
import { parseSemVer } from '@xdownload/domain-contracts';
import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

export const S5_SEAM12_COMMAND_TYPES = [
  'PREPARE_S5_PAGE_GROUP',
  'CONFIRM_S5_PAGE_GROUP',
  'EXECUTE_S5_COLLECTION',
] as const;

export type S5Seam12CommandType = (typeof S5_SEAM12_COMMAND_TYPES)[number];

/** Upper bound mirrors the #157 shipped popup gesture (frozen at 20). */
export const S5_MAX_PAGE_MEMBERS = 20;

/** One page-observed current-page group member (canonical anchor facts). */
export interface S5ObservedMember {
  readonly href: string;
  readonly text: string;
}

export interface S5PreparePayload {
  readonly snapshotId: string;
  /** Canonical http(s) origin of the observed page (privileged-zone fact). */
  readonly pageOrigin: string;
  /** Bounded observation provenance key (tab identity of the scan). */
  readonly provenanceKey: string;
  readonly members: readonly S5ObservedMember[];
}

export interface S5ConfirmBeginPayload {
  readonly phase: 'BEGIN';
  readonly snapshotId: string;
  readonly prepareId: string;
  /** The exact user-chosen subset of the frozen observed members. */
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
}

export interface S5ConfirmCommitPayload {
  readonly phase: 'COMMIT';
  readonly snapshotId: string;
  readonly prepareId: string;
  readonly selectedMemberIds: readonly string[];
  readonly displayedTupleDigest: string;
  readonly confirmationChallenge: string;
}

export interface S5ExecutePayload {
  readonly snapshotId: string;
  readonly confirmedGroupId: string;
}

/**
 * #151 canonical digest of the frozen observed page-group tuple. Computed by
 * Core when freezing the PREPARE record and pinned into it; the installed
 * lane re-computes the SAME digest from the Core-projected prepare facts and
 * aborts on a mismatch. Fixed-order canonical JSON; the member order is the
 * observed order (duplicates are structurally rejected below).
 */
export function s5GroupTupleDigest(input: {
  readonly pageOrigin: string;
  readonly provenanceKey: string;
  readonly hrefs: readonly string[];
}): string {
  const canonical = `{"pageOrigin":${JSON.stringify(input.pageOrigin)},"provenanceKey":${JSON.stringify(
    input.provenanceKey,
  )},"hrefs":[${input.hrefs.map((href) => JSON.stringify(href)).join(',')}]}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * #151 canonical digest of the exact displayed selection tuple (the frozen
 * prepare joined with the user-chosen member subset). Core mints the BEGIN
 * challenge bound to this digest and verifies it at COMMIT; the lane computes
 * it independently over the SAME Core-projected prepare facts.
 */
export function s5SelectionTupleDigest(input: {
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

export type S5Seam12Decoded =
  | { readonly commandType: 'PREPARE_S5_PAGE_GROUP'; readonly payload: S5PreparePayload }
  | {
      readonly commandType: 'CONFIRM_S5_PAGE_GROUP';
      readonly payload: S5ConfirmBeginPayload | S5ConfirmCommitPayload;
    }
  | { readonly commandType: 'EXECUTE_S5_COLLECTION'; readonly payload: S5ExecutePayload };

const PREPARE_KEYS = ['snapshotId', 'pageOrigin', 'provenanceKey', 'members'] as const;
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
    return malformed('payload', 'S5 payload must be a closed object');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return malformed('payload', 'S5 payload must be a plain data object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        return malformed('payload', 'symbol fields are not allowed');
      }
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return malformed(`payload.${key}`, 'S5 payload must use enumerable data fields');
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
    return malformed('payload', 'S5 payload cannot be inspected safely');
  }
}

function malformed(path: string, message: string): SeamResult<never> {
  return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', path, message)]);
}

function validateKeys(value: Record<string, unknown>, keys: readonly string[]): SeamResult<void> {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return malformed(`payload.${unknown[0]}`, 'unrecognized S5 authority field');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      return malformed(`payload.${key}`, 'required S5 field missing');
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

/**
 * Canonical credential-free page-observed http(s) URI — the #157 frozen
 * gesture rule verbatim (no query secrets, no fragments, no control bytes,
 * no non-canonical spellings; the parsed href must round-trip exactly).
 */
export function canonicalObservedPageUri(raw: unknown): raw is string {
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

/** Canonical http(s) origin string (scheme + host + optional port). */
function canonicalPageOrigin(raw: unknown): raw is string {
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
function compatibleS5Minor(version: unknown): boolean {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    return false;
  const parsed = parseSemVer(version);
  return parsed !== undefined && parsed.major === 1 && parsed.minor >= 2;
}

/**
 * Decode ONLY the S5 v1.2 payload data structure. Returned objects are
 * frozen *syntactic candidates*, NOT accepted Core commands, confirmed
 * snapshots or session/selection authorization.
 */
export function decodeS5Seam12Payload(
  commandType: unknown,
  schemaVersion: unknown,
  raw: unknown,
): SeamResult<S5Seam12Decoded> {
  if (!compatibleS5Minor(schemaVersion)) {
    return seamFail([
      seamDiagnostic(
        'UNSUPPORTED_ENVELOPE_VERSION',
        'schemaIdentity.version',
        'S5 commands require a final core-seam 1.2.0-or-newer minor of major 1',
      ),
    ]);
  }
  if (
    typeof commandType !== 'string' ||
    !S5_SEAM12_COMMAND_TYPES.includes(commandType as S5Seam12CommandType)
  ) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        'S5 command is not in the closed 1.2 vocabulary',
      ),
    ]);
  }
  const stable = stablePayload(raw);
  if (!stable.ok) return stable;
  const payload = stable.value;

  if (commandType === 'PREPARE_S5_PAGE_GROUP') {
    const keys = validateKeys(payload, PREPARE_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId'])) {
      return malformed('payload.snapshotId', 'expected a bounded 1..128 character identifier');
    }
    if (!canonicalPageOrigin(payload['pageOrigin'])) {
      return malformed('payload.pageOrigin', 'expected a canonical http(s) origin');
    }
    if (
      typeof payload['provenanceKey'] !== 'string' ||
      payload['provenanceKey'].length === 0 ||
      payload['provenanceKey'].length > 512
    ) {
      return malformed('payload.provenanceKey', 'expected a bounded provenance key');
    }
    const members = payload['members'];
    if (!Array.isArray(members) || members.length < 1 || members.length > S5_MAX_PAGE_MEMBERS) {
      return malformed(
        'payload.members',
        `expected 1..${String(S5_MAX_PAGE_MEMBERS)} observed members`,
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
      Object.freeze({
        commandType,
        payload: Object.freeze({
          snapshotId: payload['snapshotId'],
          pageOrigin: payload['pageOrigin'],
          provenanceKey: payload['provenanceKey'],
          members: Object.freeze(
            members.map((member) =>
              Object.freeze({
                href: (member as Record<string, unknown>)['href'] as string,
                text: (member as Record<string, unknown>)['text'] as string,
              }),
            ),
          ),
        } as unknown as S5PreparePayload),
      }),
    );
  }

  if (commandType === 'EXECUTE_S5_COLLECTION') {
    const keys = validateKeys(payload, EXECUTE_KEYS);
    if (!keys.ok) return keys;
    if (!boundedId(payload['snapshotId']) || !boundedId(payload['confirmedGroupId'])) {
      return malformed('payload', 'expected bounded 1..128 character identifiers');
    }
    return seamOk(
      Object.freeze({
        commandType,
        payload: Object.freeze({ ...payload } as unknown as S5ExecutePayload),
      }),
    );
  }

  // CONFIRM_S5_SELECTION phases BEGIN / COMMIT.
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
    selected.length > S5_MAX_PAGE_MEMBERS ||
    selected.some((id) => !boundedId(id)) ||
    new Set(selected).size !== selected.length
  ) {
    return malformed(
      'payload.selectedMemberIds',
      `expected 1..${String(S5_MAX_PAGE_MEMBERS)} unique bounded member identifiers`,
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
      commandType: 'CONFIRM_S5_PAGE_GROUP',
      payload: Object.freeze({ ...payload } as unknown as
        | S5ConfirmBeginPayload
        | S5ConfirmCommitPayload),
    }),
  );
}
