/**
 * #151/#152 S5 batch journey internal message decoders — the closed shapes
 * the shipped popup may send to the privileged worker (extension-internal
 * boundary; `sender.id === chrome.runtime.id` is enforced by the worker).
 *
 * These are browser-observed gestures ONLY: the worker never treats any of
 * them as a Core-confirmed snapshot, coverage or terminal; every authority
 * object comes back verbatim from the Core projection through the installed
 * S5 Native Messaging lane.
 */

export interface S5ConfirmGroupMessage {
  readonly kind: 'S5_CONFIRM_GROUP';
  readonly contractId: string;
  readonly prepareId: string;
  readonly snapshotId: string;
  readonly selectedMemberIds: readonly string[];
}

export interface S5ExecuteGroupMessage {
  readonly kind: 'S5_EXECUTE_GROUP';
  readonly contractId: string;
  readonly confirmedGroupId: string;
  readonly snapshotId: string;
}

export interface S5JourneyStatusMessage {
  readonly kind: 'S5_GROUP_JOURNEY_STATUS';
  readonly contractId: string;
}

export type S5BatchMessage = S5ConfirmGroupMessage | S5ExecuteGroupMessage | S5JourneyStatusMessage;

export type S5BatchDecodeResult =
  | { readonly ok: true; readonly value: S5BatchMessage }
  | { readonly ok: false; readonly detail: string };

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

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

function boundedIdList(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !ID_PATTERN.test(item) || seen.has(item)) return undefined;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

export function isS5BatchMessageKind(value: unknown): boolean {
  const raw = record(value);
  const kind = raw?.['kind'];
  return (
    kind === 'S5_CONFIRM_GROUP' || kind === 'S5_EXECUTE_GROUP' || kind === 'S5_GROUP_JOURNEY_STATUS'
  );
}

export function decodeS5BatchMessage(input: unknown): S5BatchDecodeResult {
  const raw = record(input);
  if (raw === undefined) {
    return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
  }
  if (raw['kind'] === 'S5_GROUP_JOURNEY_STATUS') {
    if (!exactKeys(raw, ['kind', 'contractId']) || typeof raw['contractId'] !== 'string' || !ID_PATTERN.test(raw['contractId'])) {
      return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
    }
    return { ok: true, value: { kind: 'S5_GROUP_JOURNEY_STATUS', contractId: raw['contractId'] } };
  }
  if (raw['kind'] === 'S5_CONFIRM_GROUP') {
    if (!exactKeys(raw, ['kind', 'contractId', 'prepareId', 'snapshotId', 'selectedMemberIds'])) {
      return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
    }
    const ids = boundedIdList(raw['selectedMemberIds'], 20);
    if (
      ids === undefined ||
      typeof raw['contractId'] !== 'string' ||
      !ID_PATTERN.test(raw['contractId']) ||
      typeof raw['prepareId'] !== 'string' ||
      !ID_PATTERN.test(raw['prepareId']) ||
      typeof raw['snapshotId'] !== 'string' ||
      !ID_PATTERN.test(raw['snapshotId'])
    ) {
      return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S5_CONFIRM_GROUP',
        contractId: raw['contractId'],
        prepareId: raw['prepareId'],
        snapshotId: raw['snapshotId'],
        selectedMemberIds: ids,
      },
    };
  }
  if (raw['kind'] === 'S5_EXECUTE_GROUP') {
    if (!exactKeys(raw, ['kind', 'contractId', 'confirmedGroupId', 'snapshotId'])) {
      return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
    }
    if (
      typeof raw['contractId'] !== 'string' ||
      !ID_PATTERN.test(raw['contractId']) ||
      typeof raw['confirmedGroupId'] !== 'string' ||
      !ID_PATTERN.test(raw['confirmedGroupId']) ||
      typeof raw['snapshotId'] !== 'string' ||
      !ID_PATTERN.test(raw['snapshotId'])
    ) {
      return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
    }
    return {
      ok: true,
      value: {
        kind: 'S5_EXECUTE_GROUP',
        contractId: raw['contractId'],
        confirmedGroupId: raw['confirmedGroupId'],
        snapshotId: raw['snapshotId'],
      },
    };
  }
  return { ok: false, detail: 'S5_INVALID_BATCH_MESSAGE' };
}
