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

import { decodeDownloadJobProjection, parseSemVer } from '@xdownload/domain-contracts';
import {
  seamDiagnostic,
  seamFail,
  seamFromDomainFailure,
  seamOk,
  type SeamDiagnostic,
  type SeamResult,
} from './diagnostics.ts';
import { makeCommandRequestId, makeSeamRevision, type CommandRequestId } from './ids.ts';
import { decodePeerIdentity, type PeerIdentity } from './peer.ts';
import {
  decodeS3Seam12Payload,
  S3_SEAM12_COMMAND_TYPES,
  type S3Seam12CommandType,
} from './s3-seam12-payload.ts';
import {
  decodeS4Seam12Payload,
  S4_SEAM12_COMMAND_TYPES,
  type S4Seam12CommandType,
} from './s4-seam12-payload.ts';
import {
  decodeS5Seam12Payload,
  S5_SEAM12_COMMAND_TYPES,
  type S5Seam12CommandType,
} from './s5-seam12-payload.ts';
import {
  decodeS6Seam12Payload,
  S6_SEAM12_COMMAND_TYPES,
  type S6Seam12CommandType,
} from './s6-seam12-payload.ts';

/** Seam wire schema identity — independent of the domain-contracts version space. */
export const CORE_SEAM_SCHEMA_ID = 'xdownload.core-seam' as const;
/**
 * 1.2.0 (#150): the installed S3 selected-media carrier — Core-issued
 * selection challenges plus CONFIRM_S3_CANDIDATE / EXECUTE_S3_SELECTED_MEDIA
 * behind OS-verified same-user/same-logon-session transport admission.
 * 1.0/1.1 commands and peers remain accepted unchanged under their existing
 * gates; S3 commands demand a 1.2+ frame.
 */
export const CORE_SEAM_SCHEMA_VERSION = '1.3.0' as const;
export const SUPPORTED_SEAM_MAJOR_VERSIONS: readonly number[] = [1];

/**
 * The Core-minted one-time selection challenge (#150, L2 S3 §2.1 R2 F01):
 * cryptographically random, short-lived, single-use, bound to the OS-verified
 * transport session, the current aggregate revision and the canonical
 * displayed selection tuple digest. Carried on the response of
 * REQUEST_S3_SELECTION_CHALLENGE only; the CLI echoes the challenge value as
 * the attestation's interactionId and Core consumes it atomically with the
 * candidate journal commit.
 */
export interface S3SelectionChallenge {
  readonly challenge: string;
  readonly tupleDigest: string;
  readonly coreRevision: number;
  readonly expiresAt: string;
  /** Registry digest of the Core's closed supported-media profiles. */
  readonly mediaProfilesDigest: string;
}

/** Seam-owned wire schema identity; independent of the domain version space. */
export interface SeamSchemaIdentity {
  readonly schema: typeof CORE_SEAM_SCHEMA_ID;
  readonly version: string;
}

/**
 * #153 Core-minted one-use S4 selection challenge (L2 SEAM12 §4): carried on
 * the direct command response of `CONFIRM_S4_SELECTION` phase BEGIN only, and
 * ONLY on the live OS-verified pipe connection that requested it. Never part
 * of the ordinary READ_PROJECTION aggregate, never journaled, never replayed
 * from durable state — a duplicate BEGIN converges to the secret-free prior
 * acceptance without re-emitting the raw value.
 */
export interface S4PrivateChallenge {
  readonly previewId: string;
  readonly renditionKey: string;
  /** 64-hex CSPRNG value; single-use, consumed atomically with the COMMIT journal commit. */
  readonly value: string;
  readonly expiresAt: string;
}

/**
 * #151 connection-private S5 selection challenge (CONFIRM_S5_PAGE_GROUP
 * phase BEGIN only); mirrors the S4 discipline — never serialized to legacy
 * sessions or projections.
 */
export interface S5PrivateChallenge {
  readonly prepareId: string;
  readonly confirmedGroupId: string;
  /** 64-hex CSPRNG value; single-use, consumed atomically with the COMMIT journal commit. */
  readonly value: string;
  readonly expiresAt: string;
}

/**
 * #154 connection-private S6 selection challenge (CONFIRM_S6_COLLECTION
 * phase BEGIN only); never serialized to legacy sessions or projections.
 * Shape-identical to the S5 challenge (same mint discipline, different
 * command namespace).
 */
export interface S6PrivateChallenge {
  readonly prepareId: string;
  readonly confirmedGroupId: string;
  /** 64-hex CSPRNG value; single-use, consumed atomically with the COMMIT journal commit. */
  readonly value: string;
  readonly expiresAt: string;
}

export type SeamMessageKind = 'command' | 'query' | 'response';

/**
 * Closed v1 authority-affecting command vocabulary. There is deliberately no
 * budget-ledger or result-state mutation command: budget/result state is
 * Core-owned (T005/T006/T007 lanes) and no surface command can touch it.
 *
 * `EXECUTE_S2_ACQUISITION` (#95) carries one browser-delivered single-
 * resource S2 acquisition (bytes acquired under the page's authorized
 * browser context; raw session material never crosses).
 *
 * `EXECUTE_S1_DIRECT_ACQUISITION` (#101 first slice) carries the delivery
 * facts (locator, declared redirect hosts, optional independently published
 * digest) for one ALREADY-ACCEPTED single-resource direct contract; the Core
 * itself performs the HTTP transfer behind the frozen acquisition port. Like
 * S2, execution, validation, acceptance and terminal truth stay Core-owned
 * and the terminal projection passes the same projector gate as
 * `PROJECT_TERMINAL_RESULT`, never asserted by the submitting surface.
 */
export const COMMAND_TYPES = [
  'SUBMIT_CONTRACT',
  'CONFIRM_SNAPSHOT',
  'CANCEL_LINEAGE',
  'RETRY_FAILED_MEMBERS',
  'PROJECT_TERMINAL_RESULT',
  'EXECUTE_S2_ACQUISITION',
  'EXECUTE_S1_DIRECT_ACQUISITION',
] as const;

/** The 1.2 S4/S5 authority vocabulary is distinct from legacy 1.0/1.1. */
export type CommandType =
  | (typeof COMMAND_TYPES)[number]
  | S4Seam12CommandType
  | S3Seam12CommandType
  | S5Seam12CommandType
  | S6Seam12CommandType;

/** Closed v1 read vocabulary: the only surface query is the projection read. */
export const QUERY_TYPES = ['READ_PROJECTION'] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

/** Explicit Domain App v0.2 route vocabularies; kept separate from legacy v1 commands/queries. */
export const V02_COMMAND_TYPES = ['DOMAIN_APP_SEND'] as const;
export type V02CommandType = (typeof V02_COMMAND_TYPES)[number];
export const V02_QUERY_TYPES = ['READ_JOB_PROJECTION'] as const;
export type V02QueryType = (typeof V02_QUERY_TYPES)[number];

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

/** Explicit v0.2 Domain App command; its intent is validated before any send boundary. */
export interface V02CommandEnvelope {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'command';
  readonly route: 'v0.2';
  readonly commandType: V02CommandType;
  readonly peer: PeerIdentity;
  readonly requestId: CommandRequestId;
  /** Binds the command to the confirmed intent's lineageId. */
  readonly aggregateId: string;
  readonly issuedAt: string;
  readonly payload: { readonly intent: unknown };
}

export interface LegacyQueryEnvelope {
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

/** Explicit v0.2 read route. aggregateId is the requested lineageId. */
export interface V02JobQueryEnvelope {
  readonly schemaIdentity: SeamSchemaIdentity;
  readonly kind: 'query';
  readonly route: 'v0.2';
  readonly queryType: V02QueryType;
  readonly peer: PeerIdentity;
  readonly requestId: CommandRequestId;
  readonly aggregateId: string;
  readonly issuedAt: string;
}

export type QueryEnvelope = LegacyQueryEnvelope | V02JobQueryEnvelope;

export type SeamEnvelope = CommandEnvelope | V02CommandEnvelope | QueryEnvelope;

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
  /** Present only for responses to the explicit Domain App v0.2 route. */
  readonly route?: 'v0.2';
  readonly inReplyTo: CommandRequestId;
  readonly outcome: SeamOutcome;
  readonly acceptance?: SeamAcceptance;
  /** Current aggregate revision for revision-mismatch rejections and acceptances. */
  readonly currentRevision?: number;
  /** Read-only projection value for accepted READ_PROJECTION queries. */
  readonly projection?: unknown;
  /** Core-minted selection challenge (REQUEST_S3_SELECTION_CHALLENGE only). */
  readonly challenge?: S3SelectionChallenge;
  /**
   * #153 connection-private S4 selection challenge (CONFIRM_S4_SELECTION
   * phase BEGIN only); never serialized to legacy sessions or projections.
   */
  readonly s4PrivateChallenge?: S4PrivateChallenge;
  readonly s5PrivateChallenge?: S5PrivateChallenge;
  readonly s6PrivateChallenge?: S6PrivateChallenge;
  readonly diagnostics?: readonly SeamDiagnostic[];
}

const CORRELATION_KEYS: readonly string[] = ['contractId', 'snapshotId', 'effectId'];
const COMMAND_KEYS: readonly string[] = [
  'schemaIdentity',
  'kind',
  'route',
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
  'route',
  'queryType',
  'peer',
  'requestId',
  'aggregateId',
  'issuedAt',
];

const V02_COMMAND_KEYS: readonly string[] = [
  'schemaIdentity',
  'kind',
  'route',
  'commandType',
  'peer',
  'requestId',
  'aggregateId',
  'issuedAt',
  'payload',
];

const V02_QUERY_KEYS: readonly string[] = [
  'schemaIdentity',
  'kind',
  'route',
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

function requireV02RouteVersion(identity: SeamSchemaIdentity): SeamResult<void> {
  const version = parseSemVer(identity.version);
  if (version === undefined || version.major !== 1 || version.minor < 3) {
    return seamFail([
      seamDiagnostic(
        'UNSUPPORTED_ENVELOPE_VERSION',
        'schemaIdentity.version',
        'the explicit v0.2 route requires core-seam schema 1.3.0 or newer',
      ),
    ]);
  }
  return seamOk(undefined);
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

function decodeCommandEnvelope(
  record: Record<string, unknown>,
): SeamResult<CommandEnvelope | V02CommandEnvelope> {
  const route = record['route'];
  if (route === 'v0.2') return decodeV02CommandEnvelope(record);
  if (route !== undefined) {
    return seamFail([
      seamDiagnostic('UNSUPPORTED_ROUTE', 'route', 'unknown command route; fail closed'),
    ]);
  }
  if (record['commandType'] === 'DOMAIN_APP_SEND') {
    return seamFail([
      seamDiagnostic('ROUTE_REQUIRED', 'route', 'DOMAIN_APP_SEND requires the explicit v0.2 route'),
    ]);
  }
  return decodeLegacyCommandEnvelope(record);
}

function decodeV02CommandEnvelope(record: Record<string, unknown>): SeamResult<V02CommandEnvelope> {
  const shape = rejectUnknownKeys(record, V02_COMMAND_KEYS, '$');
  if (!shape.ok) return shape;
  if (record['route'] !== 'v0.2') {
    return seamFail([seamDiagnostic('UNSUPPORTED_ROUTE', 'route', 'expected route v0.2')]);
  }
  if (!V02_COMMAND_TYPES.includes(record['commandType'] as V02CommandType)) {
    return seamFail([
      seamDiagnostic(
        'ROUTE_COMMAND_MISMATCH',
        'commandType',
        'the v0.2 command route accepts only DOMAIN_APP_SEND',
      ),
    ]);
  }
  const schemaIdentity = decodeSeamSchemaIdentity(record['schemaIdentity']);
  if (!schemaIdentity.ok) return schemaIdentity;
  const routeVersion = requireV02RouteVersion(schemaIdentity.value);
  if (!routeVersion.ok) return routeVersion;
  const peer = decodePeerIdentity(record['peer']);
  if (!peer.ok) return peer;
  const requestId = decodeRequestId(record['requestId']);
  if (!requestId.ok) return requestId;
  const aggregateId = decodeAggregateId(record['aggregateId']);
  if (!aggregateId.ok) return aggregateId;
  const issuedAt = decodeIssuedAt(record['issuedAt']);
  if (!issuedAt.ok) return issuedAt;
  const payload = record['payload'];
  if (!isPlainObject(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'v0.2 command payload must be an object'),
    ]);
  }
  const payloadShape = rejectUnknownKeys(payload, ['intent'], 'payload');
  if (!payloadShape.ok) return payloadShape;
  if (!('intent' in payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.intent', 'confirmed intent is required'),
    ]);
  }
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: peer.value,
    requestId: requestId.value,
    aggregateId: aggregateId.value,
    issuedAt: issuedAt.value,
    payload: { intent: payload['intent'] },
  });
}

function decodeLegacyCommandEnvelope(record: Record<string, unknown>): SeamResult<CommandEnvelope> {
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
  const s3Command =
    typeof commandType === 'string' &&
    S3_SEAM12_COMMAND_TYPES.includes(commandType as S3Seam12CommandType);
  const s4Command =
    typeof commandType === 'string' &&
    S4_SEAM12_COMMAND_TYPES.includes(commandType as S4Seam12CommandType);
  const s5Command =
    typeof commandType === 'string' &&
    S5_SEAM12_COMMAND_TYPES.includes(commandType as S5Seam12CommandType);
  const s6Command =
    typeof commandType === 'string' &&
    S6_SEAM12_COMMAND_TYPES.includes(commandType as S6Seam12CommandType);
  if (
    typeof commandType !== 'string' ||
    (!COMMAND_TYPES.includes(commandType as (typeof COMMAND_TYPES)[number]) &&
      !s4Command &&
      !s3Command &&
      !s5Command &&
      !s6Command)
  ) {
    return seamFail([
      seamDiagnostic(
        'UNKNOWN_COMMAND_TYPE',
        'commandType',
        `unknown command discriminant '${String(commandType)}'; the command vocabulary is closed`,
      ),
    ]);
  }
  // S4 1.2 has an independently reviewed closed payload shape and final
  // 1.2-only version gate. Decoding is NOT Core authority or a permission to
  // preview/confirm/execute; server.ts refuses prior to replay/journal/effect
  // until installed trusted-session admission and private command handling.
  const s4Payload = s4Command
    ? decodeS4Seam12Payload(commandType, schemaIdentity.value.version, record['payload'])
    : undefined;
  if (s4Payload !== undefined && !s4Payload.ok) return s4Payload;
  // S3's two-phase source-selected media syntax is not a user gesture,
  // Core challenge, install policy or trusted OS connection. No effect grant.
  const s3Payload = s3Command
    ? decodeS3Seam12Payload(commandType, schemaIdentity.value.version, record['payload'])
    : undefined;
  if (s3Payload !== undefined && !s3Payload.ok) return s3Payload;
  // S5's current-page group syntax is browser-observed candidates only —
  // never a confirmed snapshot, a user gesture, a Core challenge or a
  // trusted OS connection. No effect grant until the #151 private handlers.
  const s5Payload = s5Command
    ? decodeS5Seam12Payload(commandType, schemaIdentity.value.version, record['payload'])
    : undefined;
  if (s5Payload !== undefined && !s5Payload.ok) return s5Payload;
  // S6's explicit finite collection syntax is browser-observed candidates
  // only — never a confirmed snapshot, a user gesture, a Core challenge or a
  // trusted OS connection. No effect grant until the #154 private handlers.
  const s6Payload = s6Command
    ? decodeS6Seam12Payload(commandType, schemaIdentity.value.version, record['payload'])
    : undefined;
  if (s6Payload !== undefined && !s6Payload.ok) return s6Payload;
  // EXECUTE_S1_DIRECT_ACQUISITION is introduced only in seam 1.1.
  // Major-1 backwards decoding remains valid for the old closed vocabulary,
  // but a 1.0 frame can never gain the new network-effect authority.
  if (commandType === 'EXECUTE_S1_DIRECT_ACQUISITION') {
    const version = parseSemVer(schemaIdentity.value.version);
    if (version === undefined || version.major !== 1 || version.minor < 1) {
      return seamFail([
        seamDiagnostic(
          'UNSUPPORTED_ENVELOPE_VERSION',
          'schemaIdentity.version',
          'S1 direct acquisition execution requires core-seam version 1.1.0 or newer',
          'L2-#103-F06',
        ),
      ]);
    }
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
    payload: s5Payload?.ok
      ? s5Payload.value.payload
      : s4Payload?.ok
        ? s4Payload.value.payload
        : s3Payload?.ok
          ? s3Payload.value.payload
          : record['payload'],
  });
}

function decodeQueryEnvelope(record: Record<string, unknown>): SeamResult<QueryEnvelope> {
  const route = record['route'];
  if (route === 'v0.2') return decodeV02QueryEnvelope(record);
  if (route !== undefined) {
    return seamFail([
      seamDiagnostic('UNSUPPORTED_ROUTE', 'route', 'unknown query route; fail closed'),
    ]);
  }
  if (record['queryType'] === 'READ_JOB_PROJECTION') {
    return seamFail([
      seamDiagnostic(
        'ROUTE_REQUIRED',
        'route',
        'READ_JOB_PROJECTION requires the explicit v0.2 route',
      ),
    ]);
  }
  return decodeLegacyQueryEnvelope(record);
}

function decodeV02QueryEnvelope(record: Record<string, unknown>): SeamResult<V02JobQueryEnvelope> {
  const shape = rejectUnknownKeys(record, V02_QUERY_KEYS, '$');
  if (!shape.ok) return shape;
  if (record['route'] !== 'v0.2') {
    return seamFail([seamDiagnostic('UNSUPPORTED_ROUTE', 'route', 'expected route v0.2')]);
  }
  if (!V02_QUERY_TYPES.includes(record['queryType'] as V02QueryType)) {
    return seamFail([
      seamDiagnostic(
        'ROUTE_QUERY_MISMATCH',
        'queryType',
        'the v0.2 query route accepts only READ_JOB_PROJECTION',
      ),
    ]);
  }
  const schemaIdentity = decodeSeamSchemaIdentity(record['schemaIdentity']);
  if (!schemaIdentity.ok) return schemaIdentity;
  const routeVersion = requireV02RouteVersion(schemaIdentity.value);
  if (!routeVersion.ok) return routeVersion;
  const peer = decodePeerIdentity(record['peer']);
  if (!peer.ok) return peer;
  const requestId = decodeRequestId(record['requestId']);
  if (!requestId.ok) return requestId;
  const aggregateId = decodeAggregateId(record['aggregateId']);
  if (!aggregateId.ok) return aggregateId;
  const issuedAt = decodeIssuedAt(record['issuedAt']);
  if (!issuedAt.ok) return issuedAt;
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'query',
    route: 'v0.2',
    queryType: 'READ_JOB_PROJECTION',
    peer: peer.value,
    requestId: requestId.value,
    aggregateId: aggregateId.value,
    issuedAt: issuedAt.value,
  });
}

function decodeLegacyQueryEnvelope(
  record: Record<string, unknown>,
): SeamResult<LegacyQueryEnvelope> {
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
  const route = value['route'];
  if (route !== undefined && route !== 'v0.2') {
    return seamFail([
      seamDiagnostic('UNSUPPORTED_ROUTE', 'route', 'unknown response route; fail closed'),
    ]);
  }
  if (route === 'v0.2') {
    const routeVersion = requireV02RouteVersion(schemaIdentity.value);
    if (!routeVersion.ok) return routeVersion;
  }
  const outcome = value['outcome'];
  if (outcome !== 'ACCEPTED' && outcome !== 'REJECTED' && outcome !== 'PROJECTION') {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'outcome', 'unknown response outcome')]);
  }
  let projection: unknown = value['projection'];
  if (route === 'v0.2' && outcome === 'PROJECTION') {
    const decodedProjection = decodeDownloadJobProjection(value['projection']);
    if (!decodedProjection.ok) {
      return seamFromDomainFailure(decodedProjection);
    }
    projection = decodedProjection.value;
  }
  return seamOk({
    schemaIdentity: schemaIdentity.value,
    kind: 'response',
    ...(route === 'v0.2' ? { route } : {}),
    inReplyTo: inReplyTo.value,
    outcome,
    acceptance: decodeAcceptance(value['acceptance']),
    currentRevision:
      typeof value['currentRevision'] === 'number' ? value['currentRevision'] : undefined,
    projection,
    challenge: decodeS3SelectionChallenge(value['challenge']),
    s4PrivateChallenge: decodeS4PrivateChallenge(value['s4PrivateChallenge']),
    s5PrivateChallenge: decodeS5PrivateChallenge(value['s5PrivateChallenge']),
    s6PrivateChallenge: decodeS6PrivateChallenge(value['s6PrivateChallenge']),
    diagnostics: Array.isArray(value['diagnostics'])
      ? (value['diagnostics'] as readonly SeamDiagnostic[])
      : undefined,
  });
}

const S4_PRIVATE_CHALLENGE_KEYS: readonly string[] = [
  'previewId',
  'renditionKey',
  'value',
  'expiresAt',
];

const S5_PRIVATE_CHALLENGE_KEYS: readonly string[] = [
  'prepareId',
  'confirmedGroupId',
  'value',
  'expiresAt',
];

/** Strict decode of the Core-minted S5 private challenge on the client side (#151). */
function decodeS5PrivateChallenge(value: unknown): S5PrivateChallenge | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !S5_PRIVATE_CHALLENGE_KEYS.includes(key));
  if (unknown.length > 0) {
    return undefined;
  }
  const prepareId = value['prepareId'];
  const confirmedGroupId = value['confirmedGroupId'];
  const challenge = value['value'];
  const expiresAt = value['expiresAt'];
  if (
    typeof prepareId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(prepareId) ||
    typeof confirmedGroupId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(confirmedGroupId) ||
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(challenge) ||
    typeof expiresAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(expiresAt)
  ) {
    return undefined;
  }
  return { prepareId, confirmedGroupId, value: challenge, expiresAt };
}

const S6_PRIVATE_CHALLENGE_KEYS: readonly string[] = [
  'prepareId',
  'confirmedGroupId',
  'value',
  'expiresAt',
];

/** Strict decode of the Core-minted S6 private challenge on the client side (#154). */
function decodeS6PrivateChallenge(value: unknown): S6PrivateChallenge | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !S6_PRIVATE_CHALLENGE_KEYS.includes(key));
  if (unknown.length > 0) {
    return undefined;
  }
  const prepareId = value['prepareId'];
  const confirmedGroupId = value['confirmedGroupId'];
  const challenge = value['value'];
  const expiresAt = value['expiresAt'];
  if (
    typeof prepareId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(prepareId) ||
    typeof confirmedGroupId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(confirmedGroupId) ||
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(challenge) ||
    typeof expiresAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(expiresAt)
  ) {
    return undefined;
  }
  return { prepareId, confirmedGroupId, value: challenge, expiresAt };
}

/** Strict decode of the Core-minted S4 private challenge on the client side (#153). */
function decodeS4PrivateChallenge(value: unknown): S4PrivateChallenge | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !S4_PRIVATE_CHALLENGE_KEYS.includes(key));
  if (unknown.length > 0) {
    return undefined;
  }
  const previewId = value['previewId'];
  const renditionKey = value['renditionKey'];
  const challenge = value['value'];
  const expiresAt = value['expiresAt'];
  if (
    typeof previewId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(previewId) ||
    typeof renditionKey !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(renditionKey) ||
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(challenge) ||
    typeof expiresAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(expiresAt)
  ) {
    return undefined;
  }
  return { previewId, renditionKey, value: challenge, expiresAt };
}

const CHALLENGE_KEYS: readonly string[] = [
  'challenge',
  'tupleDigest',
  'coreRevision',
  'expiresAt',
  'mediaProfilesDigest',
];

/** Strict decode of the Core-minted challenge on the client side (#150). */
function decodeS3SelectionChallenge(value: unknown): S3SelectionChallenge | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !CHALLENGE_KEYS.includes(key));
  if (unknown.length > 0) {
    return undefined;
  }
  const challenge = value['challenge'];
  const tupleDigest = value['tupleDigest'];
  const coreRevision = value['coreRevision'];
  const expiresAt = value['expiresAt'];
  const mediaProfilesDigest = value['mediaProfilesDigest'];
  if (
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(challenge) ||
    typeof tupleDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(tupleDigest) ||
    !Number.isSafeInteger(coreRevision) ||
    (coreRevision as number) < 0 ||
    typeof expiresAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(expiresAt) ||
    typeof mediaProfilesDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(mediaProfilesDigest)
  ) {
    return undefined;
  }
  return {
    challenge,
    tupleDigest,
    coreRevision: coreRevision as number,
    expiresAt,
    mediaProfilesDigest,
  };
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
