/**
 * T010 untrusted-input gate (frozen L2 §6.4 / invariant 11, PRD §29).
 *
 * ALL page/content-script messages are schema- and size-bounded here before
 * any privilege. The content-script boundary is untrusted input only: it can
 * submit observation records. Any message that attempts to invoke privileged
 * native/auth actions from this boundary is rejected outright, and there is
 * no path by which gate output grants authority — the gate only produces
 * validated observation records for the privileged extension context to
 * consider as provenance-bound evidence inputs.
 */

import { asRecord, rejectRawSecretFields, requireLiteral } from '@xdownload/domain-contracts';
import { bDiagnostic, bFail, bOk, type BrowserDiagnostic, type BrowserResult } from './result.ts';
import {
  containsRawSecretKey,
  decodeObservationProvenance,
  type ObservationProvenance,
} from './provenance.ts';

/** Explicit byte bound for untrusted content-script messages. */
export const DEFAULT_MAX_CONTENT_MESSAGE_BYTES = 64 * 1024;

/** Observation kinds a content script may submit (observation only). */
export type ObservationKind = 'PAGE_CONTEXT' | 'NETWORK_OBSERVATION' | 'MEDIA_CONTEXT';

const OBSERVATION_KINDS: readonly ObservationKind[] = [
  'PAGE_CONTEXT',
  'NETWORK_OBSERVATION',
  'MEDIA_CONTEXT',
];

const CONTENT_MESSAGE_KEYS: readonly string[] = ['boundary', 'kind', 'provenance', 'payload'];

/**
 * The ONLY authoritative boundary label accepted from a content script.
 * Anything else (including forged privileged labels) is a privilege
 * escalation attempt and fails closed.
 */
const CONTENT_BOUNDARY = 'CONTENT_SCRIPT';

/** Payload fields a content script may carry, per observation kind. */
const PAYLOAD_FIELDS_BY_KIND: Readonly<Record<ObservationKind, readonly string[]>> = {
  PAGE_CONTEXT: ['pageUrl', 'title'],
  NETWORK_OBSERVATION: ['requestUrl', 'requestMethod'],
  MEDIA_CONTEXT: ['pageUrl', 'mediaKind'],
};

export interface ObservationMessage {
  readonly boundary: 'CONTENT_SCRIPT';
  readonly kind: ObservationKind;
  readonly provenance: ObservationProvenance;
  readonly payload: Readonly<Record<string, string>>;
}

export interface MessageGateOptions {
  readonly maxBytes?: number;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Gate one untrusted content-script message; fail closed before any privilege. */
export function decodeUntrustedContentMessage(
  raw: unknown,
  options: MessageGateOptions = {},
): BrowserResult<ObservationMessage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTENT_MESSAGE_BYTES;
  const serialized = safeSerialize(raw);
  if (serialized !== undefined && utf8ByteLength(serialized) > maxBytes) {
    return bFail([
      bDiagnostic(
        'OBSERVATION_OVERSIZED',
        'message',
        `untrusted message exceeds the ${maxBytes}-byte boundary bound and is rejected before privilege`,
        'L2-inv11',
      ),
    ]);
  }
  const record = asRecord(raw, 'message');
  if (!record.ok) {
    return bFail([
      bDiagnostic(
        'OBSERVATION_MALFORMED',
        'message',
        'untrusted message must be a JSON object',
        'L2-inv11',
      ),
    ]);
  }
  const diagnostics: BrowserDiagnostic[] = [];
  const unknown = Object.keys(record.value).filter((key) => !CONTENT_MESSAGE_KEYS.includes(key));
  for (const key of unknown) {
    diagnostics.push(
      bDiagnostic(
        'UNKNOWN_FIELD',
        `message.${key}`,
        'unknown field at the untrusted content boundary; fail closed',
        'L2-inv11',
      ),
    );
  }
  const rawSecret = rejectRawSecretFields(record.value, 'message');
  if (!rawSecret.ok) {
    for (const d of rawSecret.diagnostics) {
      diagnostics.push(
        bDiagnostic(
          d.code,
          d.path,
          'raw secret fields can never cross the untrusted content boundary',
          'PRD-§29',
        ),
      );
    }
  }
  if (containsRawSecretKey(record.value['payload'])) {
    diagnostics.push(
      bDiagnostic(
        'RAW_SECRET_FIELD',
        'message.payload',
        'raw secret material nested in the untrusted payload is rejected',
        'PRD-§29',
      ),
    );
  }
  const boundary = record.value['boundary'];
  if (boundary !== CONTENT_BOUNDARY) {
    diagnostics.push(
      bDiagnostic(
        'PRIVILEGE_ESCALATION_REJECTED',
        'message.boundary',
        `content-script input may only declare boundary '${CONTENT_BOUNDARY}'; privileged boundaries cannot be claimed from untrusted input`,
        'L2-inv11',
      ),
    );
  }
  const kind = requireLiteral(record.value, 'kind', OBSERVATION_KINDS, 'message');
  if (!kind.ok) {
    diagnostics.push(
      bDiagnostic(
        'PRIVILEGE_ESCALATION_REJECTED',
        'message.kind',
        `untrusted content messages may only submit observation kinds (${OBSERVATION_KINDS.join(', ')}); native/auth actions cannot be invoked from this boundary`,
        'L2-inv11',
      ),
    );
    return bFail(diagnostics);
  }
  if (diagnostics.length > 0) {
    return bFail(diagnostics);
  }
  const provenance = decodeObservationProvenance(record.value['provenance'], 'message.provenance');
  if (!provenance.ok) {
    return bFail(
      provenance.diagnostics.map((d) => ({ ...d, invariant: d.invariant ?? 'L2-inv11' })),
    );
  }
  if (provenance.value.requestRef !== undefined && kind.value !== 'NETWORK_OBSERVATION') {
    return bFail([
      bDiagnostic(
        'OBSERVATION_MALFORMED',
        'message.provenance.requestRef',
        'request provenance is only meaningful for NETWORK_OBSERVATION',
      ),
    ]);
  }
  const payload = decodePayload(record.value['payload'], kind.value);
  if (!payload.ok) {
    return bFail(payload.diagnostics.map((d) => ({ ...d, invariant: d.invariant ?? 'L2-inv11' })));
  }
  const message: ObservationMessage = {
    boundary: CONTENT_BOUNDARY,
    kind: kind.value,
    provenance: provenance.value,
    payload: payload.value,
  };
  return bOk(Object.freeze(message));
}

/** Payload fields must be strings, allowed for the kind, and secret-free by key and by value shape. */
function decodePayload(
  value: unknown,
  kind: ObservationKind,
): BrowserResult<Readonly<Record<string, string>>> {
  const diagnostics: BrowserDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bFail([
      bDiagnostic('OBSERVATION_MALFORMED', 'message.payload', 'payload must be an object'),
    ]);
  }
  const record = value as Record<string, unknown>;
  const allowed = PAYLOAD_FIELDS_BY_KIND[kind];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      diagnostics.push(
        bDiagnostic(
          'UNKNOWN_FIELD',
          `message.payload.${key}`,
          `payload field is not allowed for observation kind '${kind}'`,
          'L2-inv11',
        ),
      );
      continue;
    }
    const fieldValue = record[key];
    if (typeof fieldValue !== 'string') {
      diagnostics.push(
        bDiagnostic(
          'OBSERVATION_MALFORMED',
          `message.payload.${key}`,
          'payload fields must be strings',
        ),
      );
    }
  }
  if (containsRawSecretKey(record)) {
    diagnostics.push(
      bDiagnostic(
        'RAW_SECRET_FIELD',
        'message.payload',
        'raw secret material nested in the payload is rejected',
        'PRD-§29',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return bFail(diagnostics);
  }
  const entries: Array<[string, string]> = [];
  for (const key of Object.keys(record)) {
    entries.push([key, record[key] as string]);
  }
  return bOk(Object.freeze(Object.fromEntries(entries)));
}

function safeSerialize(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return undefined;
  }
}
