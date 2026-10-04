/**
 * T004 versioned command/query envelope (frozen L2 §6.3 command transaction
 * facts at the wire boundary; §6.1 Local Command/Query Port).
 *
 * Every framed message carries an explicit seam schema identity/version.
 * Unsupported or incompatible versions fail closed and are never silently
 * reinterpreted — the same supported-major-version fail-closed pattern as
 * `@xdownload/domain-contracts`, with an independent version space.
 *
 * The v1 command vocabulary is closed: unknown command discriminants reject.
 * Commands carry command/idempotency identity (`requestId`), the expected
 * aggregate revision, the command type/payload and provenance/audit
 * correlation (contract/snapshot/effect lineage references, issue time).
 */

import { parseSemVer } from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type SeamDiagnostic,
  type SeamResult,
} from './diagnostics.ts';
import { makeCommandRequestId, makeSeamRevision, type CommandRequestId } from './ids.ts';
import { decodePeerIdentity, type PeerIdentity } from './peer.ts';

/** Seam wire schema identity — independent of the domain-contracts version space. */
export const CORE_SEAM_SCHEMA_ID = 'xdownload.core-seam' as const;
export const CORE_SEAM_SCHEMA_VERSION = '1.0.0' as const;
export const SUPPORTED_SEAM_MAJOR_VERSIONS: readonly number[] = [1];

/** Seam-owned wire schema identity; independent of the domain version space. */
export interface SeamSchemaIdentity {
  readonly schema: typeof CORE_SEAM_SCHEMA_ID;
  readonly version: string;
}

export type SeamMessageKind = 'command' | 'query' | 'response';

/**
 * Closed v1 authority-affecting command vocabulary. There is deliberately no
 * budget-ledger or result-state mutation command: budget/result state is
 * Core-owned (T005/T006/T007 lanes) and no surface command can touch it.
 */
export const COMMAND_TYPES = [
  'SUBMIT_CONTRACT',
  'CONFIRM_SNAPSHOT',
  'CANCEL_LINEAGE',
  'RETRY_FAILED_MEMBERS',
  'PROJECT_TERMINAL_RESULT',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

/** Closed v1 read vocabulary: the only surface query is the projection read. */
export const QUERY_TYPES = ['READ_PROJECTION'] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

/** Provenance/audit lineage references carried on every command (L2 §6.3 item 6). */
export interface SeamCorrelation {
  readonly contractId?: string;
  readonly snapshotId?: string;
  readonly effectId?: string;
}

export interface CommandEnvelope {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'command';
  readonly commandType: CommandType;
  /** Presenting peer; authorization is re-decided per command, never inherited. */
  readonly peer: PeerIdentity;
  /** Idempotent command identity: duplicates converge, conflicts reject. */
  readonly requestId: CommandRequestId;
  /** Domain aggregate the command targets (the contract identity in v1). */
  readonly aggregateId: string;
  /** Expected current revision; 0 asserts the aggregate does not exist yet. */
  readonly expectedRevision: number;
  readonly correlation: SeamCorrelation;
  /** ISO-8601 issue time; provenance/audit fact only, never an ordering authority. */
  readonly issuedAt: string;
  /** Raw payload; becomes canonical only via `@xdownload/domain-contracts` decoders. */
  readonly payload: unknown;
}

export interface QueryEnvelope {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'query';
  readonly queryType: QueryType;
  /** Presenting peer; authorization is re-decided per query. */
  readonly peer: PeerIdentity;
  /** Response correlation only; queries are read-only and never authoritative. */
  readonly requestId: CommandRequestId;
  readonly aggregateId: string;
  readonly issuedAt: string;
}

export type SeamEnvelope = CommandEnvelope | QueryEnvelope;

export type SeamOutcome = 'ACCEPTED' | 'REJECTED' | 'PROJECTION';

export interface SeamAcceptance {
  readonly requestId: CommandRequestId;
  readonly aggregateId: string;
  /** Aggregate revision after this command was accepted (the accepted revision). */
  readonly revision: number;
  /** True when this response replays the original acceptance of a duplicate submit. */
  readonly converged: boolean;
}

export interface SeamResponse {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'response';
  readonly inReplyTo: CommandRequestId;
  readonly outcome: SeamOutcome;
  readonly acceptance?: SeamAcceptance;
  /** Current aggregate revision for revision-mismatch rejections and acceptances. */
  readonly currentRevision?: number;
  /** Read-only projection value for accepted READ_PROJECTION queries. */
  readonly projection?: unknown;
  readonly diagnostics?: readonly SeamDiagnostic[];
}

const CORRELATION_KEYS: readonly string[] = ['contractId', 'snapshotId', 'effectId'];
const COMMAND_KEYS: readonly string[] = [
  'schemaIdentity',
  'kind',
  'commandType',
  'peer',
  'requestId',
  'aggregateId',
  'expectedRevision',
  'correlation',
  'issuedAt',
  'payload',
];
const QUERY_KEYS: readonly string[] = [
  'schemaIdentity',
  'kind',
  'queryType',
  'peer',
  'requestId',
  'aggregateId',
  'issuedAt',
];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  known: readonly string[],
  path: string,
): SeamResult<void> {
  const knownSet = new Set(known);
  const unknown = Object.keys(record).filter((key) => !knownSet.has(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `${path}.${key}`,
          'unknown field on a seam envelope; fail closed',
        ),
      ),
    );
  }
  return seamOk(undefined);
}

function collectCorrelation(value: unknown): SeamResult<SeamCorrelation> {
  if (value === undefined) {
    return seamOk({});
  }
  if (!isPlainObject(value)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'correlation', 'correlation must be an object'),
    ]);
  }
  const shape = rejectUnknownKeys(value, CORRELATION_KEYS, 'correlation');
  if (!shape.ok) {
    return shape;
  }
  const failures: SeamDiagnostic[] = [];
  const correlation: { contractId?: string; snapshotId?: string; effectId?: string } = {};
  for (const key of CORRELATION_KEYS) {
    const raw = value[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) {
      failures.push(
        seamDiagnostic('ENVELOPE_MALFORMED', `correlation.${key}`, 'expected a 1..128 char id'),
      );
      continue;
    }
    if (key === 'contractId') {
      correlation.contractId = raw;
    } else if (key === 'snapshotId') {
      correlation.snapshotId = raw;
    } else {
      correlation.effectId = raw;
    }
  }
  if (failures.length > 0) {
    return seamFail(failures);
  }
  return seamOk(correlation);
}

const SEAM_IDENTITY_KEYS: readonly string[] = ['schema', 'version'];

/**
 * Decode the seam envelope schema identity. Missing, malformed, unknown-schema
 * or unsupported-major versions fail closed and are never silently
 * reinterpreted (mirrors the domain supported-major-version gate; the two
 * version spaces are independent but both fail closed).
 */
export function decodeSeamSchemaIdentity(value: unknown): SeamResult<SeamSchemaIdentity> {
  if (!isPlainObject(value)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'schemaIdentity', 'schema identity must be an object'),
    ]);
  }
  const unknown = Object.keys(value).filter((key) => !SEAM_IDENTITY_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `schemaIdentity.${key}`, 'unknown field'),
      ),
    );
  }
  const failures: SeamDiagnostic[] = [];
  const schema = value['schema'];
  if (schema !== CORE_SEAM_SCHEMA_ID) {
    failures.push(
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'schemaIdentity.schema',
        `expected schema '${CORE_SEAM_SCHEMA_ID}'`,
      ),
    );
  }
  const rawVersion = value['version'];
  let version: string | undefined;
  if (typeof rawVersion !== 'string') {
    failures.push(
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'schemaIdentity.version',
        'version must be a semver string',
      ),
    );
  } else {
    const parsed = parseSemVer(rawVersion);
    if (parsed === undefined) {
      failures.push(
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'schemaIdentity.version',
          `version '${rawVersion}' is not a valid semver`,
        ),
      );
    } else if (!SUPPORTED_SEAM_MAJOR_VERSIONS.includes(parsed.major)) {
      return seamFail([
        seamDiagnostic(
          'UNSUPPORTED_ENVELOPE_VERSION',
          'schemaIdentity.version',
          `unsupported seam envelope major version ${String(parsed.major)}; fail closed`,
          'L2-inv1',
        ),
      ]);
    } else {
      version = rawVersion;
    }
  }
  if (failures.length > 0) {
    return seamFail(failures);
  }
  return seamOk({ schema: CORE_SEAM_SCHEMA_ID, version: version! });
}

function decodeRequestId(value: unknown): SeamResult<CommandRequestId> {
  if (typeof value !== 'string') {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'requestId', 'requestId must be a string'),
    ]);
  }
  return makeCommandRequestId(value);
}

function decodeIssuedAt(value: unknown): SeamResult<string> {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'issuedAt', 'expected an ISO-8601 timestamp'),
    ]);
  }
  return seamOk(value);
}

function decodeAggregateId(value: unknown): SeamResult<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'aggregateId', 'expected a 1..128 char id'),
    ]);
  }
  return seamOk(value);
}

/** Decode a command or query envelope from untrusted decoded-JSON input. */
export function decodeSeamEnvelope(value: unknown): SeamResult<SeamEnvelope> {
  if (!isPlainObject(value)) {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', '$', 'envelope must be an object')]);
  }
  const kind = value['kind'];
  if (kind === 'command') {
    return decodeCommandEnvelope(value);
  }
  if (kind === 'query') {
    return decodeQueryEnvelope(value);
  }
  return seamFail([
    seamDiagnostic('ENVELOPE_MALFORMED', 'kind', `unknown seam message kind '${String(kind)}'`),
  ]);
}

function decodeCommandEnvelope(record: Record<string, unknown>): SeamResult<CommandEnvelope> {
  const shape = rejectUnknownKeys(record, COMMAND_KEYS, '$');
  if (!shape.ok) {
    return shape;
  }
  const schemaIdentity = decodeSeamSchemaIdentity(record['schemaIdentity']);
  if (!schemaIdentity.ok) {
    return schemaIdentity;
  }
  const peer = decodePeerIdentity(record['peer']);
  if (!peer.ok) {
    return peer;
  }
  const commandType = record['commandType'];
  if (typeof commandType !== 'string' || !COMMAND_TYPES.includes(commandType as CommandType)) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        `unknown command discriminant '${String(commandType)}'; the command vocabulary is closed`,
      ),
    ]);
  }
  const requestId = decodeRequestId(record['requestId']);
  if (!requestId.ok) {
    return requestId;
  }
  const aggregateId = decodeAggregateId(record['aggregateId']);
  if (!aggregateId.ok) {
    return aggregateId;
  }
  const expectedRevision = makeSeamRevision(record['expectedRevision'] as number);
  if (!expectedRevision.ok) {
    return expectedRevision;
  }
  const issuedAt = decodeIssuedAt(record['issuedAt']);
  if (!issuedAt.ok) {
    return issuedAt;
  }
  const correlation = collectCorrelation(record['correlation']);
  if (!correlation.ok) {
    return correlation;
  }
  if (!('payload' in record)) {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'payload is required')]);
  }
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'command',
    commandType: commandType as CommandType,
    peer: peer.value,
    requestId: requestId.value,
    aggregateId: aggregateId.value,
    expectedRevision: expectedRevision.value,
    correlation: correlation.value,
    issuedAt: issuedAt.value,
    payload: record['payload'],
  });
}

function decodeQueryEnvelope(record: Record<string, unknown>): SeamResult<QueryEnvelope> {
  const shape = rejectUnknownKeys(record, QUERY_KEYS, '$');
  if (!shape.ok) {
    return shape;
  }
  const schemaIdentity = decodeSeamSchemaIdentity(record['schemaIdentity']);
  if (!schemaIdentity.ok) {
    return schemaIdentity;
  }
  const peer = decodePeerIdentity(record['peer']);
  if (!peer.ok) {
    return peer;
  }
  const queryType = record['queryType'];
  if (typeof queryType !== 'string' || !QUERY_TYPES.includes(queryType as QueryType)) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_QUERY_TYPE',
        'queryType',
        `unknown query discriminant '${String(queryType)}'; the query vocabulary is closed`,
      ),
    ]);
  }
  const requestId = decodeRequestId(record['requestId']);
  if (!requestId.ok) {
    return requestId;
  }
  const aggregateId = decodeAggregateId(record['aggregateId']);
  if (!aggregateId.ok) {
    return aggregateId;
  }
  const issuedAt = decodeIssuedAt(record['issuedAt']);
  if (!issuedAt.ok) {
    return issuedAt;
  }
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'query',
    queryType: queryType as QueryType,
    peer: peer.value,
    requestId: requestId.value,
    aggregateId: aggregateId.value,
    issuedAt: issuedAt.value,
  });
}

export function currentSeamSchemaIdentity(): SeamSchemaIdentity {
  return { schema: CORE_SEAM_SCHEMA_ID, version: CORE_SEAM_SCHEMA_VERSION };
}

/** Serialize an envelope to its canonical wire JSON form. */
export function encodeSeamEnvelope(envelope: SeamEnvelope): string {
  return JSON.stringify(envelope, null, 0);
}

/** Decode a seam response from untrusted decoded-JSON input (client side). */
export function decodeSeamResponse(value: unknown): SeamResult<SeamResponse> {
  if (!isPlainObject(value)) {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', '$', 'response must be an object')]);
  }
  if (value['kind'] !== 'response') {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'kind', "expected kind 'response'")]);
  }
  const schemaIdentity = decodeSeamSchemaIdentity(value['schemaIdentity']);
  if (!schemaIdentity.ok) {
    return schemaIdentity;
  }
  const inReplyTo = decodeRequestId(value['inReplyTo']);
  if (!inReplyTo.ok) {
    return inReplyTo;
  }
  const outcome = value['outcome'];
  if (outcome !== 'ACCEPTED' && outcome !== 'REJECTED' && outcome !== 'PROJECTION') {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'outcome', 'unknown response outcome')]);
  }
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'response',
    inReplyTo: inReplyTo.value,
    outcome,
    acceptance: decodeAcceptance(value['acceptance']),
    currentRevision:
      typeof value['currentRevision'] === 'number' ? value['currentRevision'] : undefined,
    projection: value['projection'],
    diagnostics: Array.isArray(value['diagnostics'])
      ? (value['diagnostics'] as readonly SeamDiagnostic[])
      : undefined,
  });
}

function decodeAcceptance(value: unknown): SeamAcceptance | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const requestId = value['requestId'];
  const aggregateId = value['aggregateId'];
  const revision = value['revision'];
  const converged = value['converged'];
  if (
    typeof requestId !== 'string' ||
    typeof aggregateId !== 'string' ||
    typeof revision !== 'number' ||
    typeof converged !== 'boolean'
  ) {
    return undefined;
  }
  return {
    requestId: requestId as CommandRequestId,
    aggregateId,
    revision,
    converged,
  };
}
