/**
 * T004 Core command/query authority server — the transport-neutral seam port.
 *
 * Pipeline per inbound frame (fail closed at every arrow; never begin an
 * authority transition before authorization, bounds, version and decode all
 * pass — EXECUTION_CONTRACT flow / REFERENCE_PACK §3.1):
 *
 *   raw frame bytes
 *   → JSON framing integrity (corrupt framing rejects)
 *   → declared structural bounds (depth/fields/strings/arrays; pre-decode)
 *   → envelope version/shape decode (closed vocabularies, explicit version gate)
 *   → peer identity verification + same-install/same-user authorization (per frame)
 *   → declared payload byte bound (before any parse into authority state)
 *   → idempotency gate (duplicate converges / conflicting duplicate rejects)
 *   → revision gate (stale expected revision rejects)
 *   → payload decode via @xdownload/domain-contracts (canonical value or typed rejection)
 *   → Core-owned authority transition / projection read
 *   → response envelope (acceptance, typed rejection, or read-only projection)
 *
 * This server owns ALL authority transitions representable at the seam.
 * Surfaces (CLI/Desktop/Browser-shaped clients) submit commands and read
 * projections; they never own Core lifetime and never gain a second writer
 * path (frozen L2 invariant 1/2, ADR-001/010/012).
 */

import {
  assertContractTransition,
  createDomainGateway,
  makeMemberId,
  type AcquisitionContract,
  type DomainGateway,
  type DomainValidationResult,
  type MemberId,
  type TerminalResultContext,
} from '@xdownload/domain-contracts';
import {
  checkStructureBounds,
  payloadByteLength,
  stableStringify,
  SEAM_MESSAGE_LIMITS,
} from './bounds.ts';
import {
  domainDiagnosticsToSeam,
  seamDiagnostic,
  seamFail,
  seamOk,
  type SeamDiagnostic,
  type SeamResult,
} from './diagnostics.ts';
import {
  currentSeamSchemaIdentity,
  decodeSeamEnvelope,
  type CommandEnvelope,
  type QueryEnvelope,
  type SeamAcceptance,
  type SeamResponse,
} from './envelope.ts';
import type { CommandRequestId } from './ids.ts';
import { authorizePeer, type ExpectedPeerScope } from './peer.ts';
import { projectAggregate, type SeamProjectionView } from './projection.ts';
import {
  createLineageState,
  createSeamAuthorityState,
  type AcceptedCommand,
  type LineageState,
  type SeamAuthorityState,
  type SeamJournal,
  type SeamJournalEntry,
} from './state.ts';

export interface CoreSeamServerOptions {
  /** The only same-install/same-user peer scope this seam admits. */
  readonly expectedPeer: ExpectedPeerScope;
  /** Accepted-command journal; enables restart replay. Production port is T005. */
  readonly journal?: SeamJournal;
}

export interface CoreSeamServer {
  /**
   * Transport-neutral port: one framed seam message in, one response out.
   * Transports adapt bytes/framing to this port; socket types never leak
   * into command semantics (ADR-012 replaceability).
   */
  handleFrame(frame: string): SeamResponse;
  /**
   * Core-internal runtime fact recording (NOT a wire command): the transfer/
   * scheduler runtime reports the original failed-member identity domain for
   * a lineage. Surface commands can never write this — retry authority is
   * Core-owned (C12).
   */
  recordFailedMembers(aggregateId: string, memberIds: readonly string[]): SeamResult<void>;
  /** Read-only projection view; the same value a READ_PROJECTION query returns. */
  inspectProjection(aggregateId: string): SeamProjectionView | undefined;
  /** Accepted-command count (concern-test observation; not a wire surface). */
  readonly acceptedCommandCount: number;
}

export type CoreSeamServerFactoryResult =
  | { readonly ok: true; readonly value: CoreSeamServer }
  | { readonly ok: false; readonly diagnostics: readonly SeamDiagnostic[] };

/** Reply id used for rejections of frames too malformed to carry one. */
const UNKNOWN_REPLY_ID = 'unknown' as CommandRequestId;

/** Create the Core-owned command/query seam server over restored state. */
export function createCoreSeamServer(options: CoreSeamServerOptions): CoreSeamServerFactoryResult {
  const state: SeamAuthorityState = createSeamAuthorityState();
  const journal = options.journal;
  const gateway: DomainGateway = createDomainGateway();

  // Restart replay: re-apply every durably accepted command through the same
  // deterministic authority path, gate-bypassed (they were gated at
  // acceptance). Any replay failure is journal corruption → fail closed.
  if (journal !== undefined) {
    for (const entry of journal.replayAll()) {
      const restored = restoreAcceptedCommand(state, gateway, entry);
      if (!restored.ok) {
        return {
          ok: false,
          diagnostics: [
            seamDiagnostic(
              'ENVELOPE_MALFORMED',
              'journal',
              `journal replay failed for request '${entry.envelope.requestId}'; failing closed`,
            ),
            ...restored.diagnostics,
          ],
        };
      }
    }
  }

  function rejected(
    inReplyTo: CommandRequestId,
    diagnostics: readonly SeamDiagnostic[],
    currentRevision?: number,
  ): SeamResponse {
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo,
      outcome: 'REJECTED',
      diagnostics,
      currentRevision,
    };
  }

  function rejectedUnknown(diagnostics: readonly SeamDiagnostic[]): SeamResponse {
    return rejected(UNKNOWN_REPLY_ID, diagnostics);
  }

  function handleFrame(frame: string): SeamResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame) as unknown;
    } catch {
      return rejectedUnknown([
        seamDiagnostic('ENVELOPE_MALFORMED', '$', 'corrupt framing: frame is not valid JSON'),
      ]);
    }
    // Declared structural bounds before any decode into authority state.
    const bounded = checkStructureBounds(parsed, SEAM_MESSAGE_LIMITS);
    if (!bounded.ok) {
      return rejectedUnknown(bounded.diagnostics);
    }
    const decoded = decodeSeamEnvelope(parsed);
    if (!decoded.ok) {
      // Pre-decode failure: the request identity (if any) is not trustworthy,
      // so the rejection cannot be correlated to a request id.
      return rejectedUnknown(decoded.diagnostics);
    }
    const envelope = decoded.value;
    // Per-frame peer authorization: never inherited from an earlier frame.
    const authorized = authorizePeer(envelope.peer, options.expectedPeer);
    if (!authorized.ok) {
      // The envelope decoded, so the rejection is correlated to its request.
      return rejected(envelope.requestId, authorized.diagnostics);
    }
    if (envelope.kind === 'query') {
      return handleQuery(envelope);
    }
    return handleCommand(envelope);
  }

  function handleQuery(envelope: QueryEnvelope): SeamResponse {
    if (envelope.queryType !== 'READ_PROJECTION') {
      return rejected(envelope.requestId, [
        seamDiagnostic('UNKNOWN_QUERY_TYPE', 'queryType', 'unknown query discriminant'),
      ]);
    }
    const view = projectAggregate(state, envelope.aggregateId);
    if (view === undefined) {
      return rejected(envelope.requestId, [
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
      ]);
    }
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'PROJECTION',
      projection: view,
    };
  }

  function handleCommand(envelope: CommandEnvelope): SeamResponse {
    // Declared payload byte bound before any parse into authority state.
    const payloadBytes = payloadByteLength(envelope.payload);
    if (payloadBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      return rejected(envelope.requestId, [
        seamDiagnostic(
          'PAYLOAD_TOO_LARGE',
          'payload',
          `serialized payload of ${String(payloadBytes)} bytes exceeds declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)}`,
        ),
      ]);
    }
    // Idempotency gate before revision/decode/effect (frozen L2 §6.8/ADR-010).
    const prior = state.accepted.get(envelope.requestId);
    const digest = stableStringify(envelope.payload);
    if (prior !== undefined) {
      if (prior.payloadDigest !== digest) {
        return rejected(envelope.requestId, [
          seamDiagnostic(
            'IDEMPOTENCY_CONFLICT',
            'requestId',
            'same idempotent command identity was accepted with a different payload; conflicting duplicate rejects',
            'L2-§6.8',
          ),
        ]);
      }
      return {
        ...prior.response,
        acceptance: prior.response.acceptance && {
          ...prior.response.acceptance,
          converged: true,
        },
      };
    }
    // Revision gate.
    const aggregate = state.aggregates.get(envelope.aggregateId);
    const currentRevision = aggregate?.revision ?? 0;
    if (envelope.expectedRevision !== currentRevision) {
      return rejected(
        envelope.requestId,
        [
          seamDiagnostic(
            'REVISION_MISMATCH',
            'expectedRevision',
            `expected revision ${String(envelope.expectedRevision)} but current aggregate revision is ${String(currentRevision)}`,
            'L2-§10',
          ),
        ],
        currentRevision,
      );
    }
    // Authority-affecting path: domain decode + semantic gates + state apply.
    const outcome = applyCommand(state, gateway, envelope);
    if (!outcome.ok) {
      return rejected(envelope.requestId, outcome.diagnostics, currentRevision);
    }
    const response = acceptedResponse(envelope, outcome.value.revision);
    const record: AcceptedCommand = { envelope, response, payloadDigest: digest };
    state.accepted.set(envelope.requestId, record);
    journal?.append({ envelope, response, payloadDigest: digest });
    return response;
  }

  function acceptedResponse(envelope: CommandEnvelope, revision: number): SeamResponse {
    const acceptance: SeamAcceptance = {
      requestId: envelope.requestId,
      aggregateId: envelope.aggregateId,
      revision,
      converged: false,
    };
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'ACCEPTED',
      acceptance,
      currentRevision: revision,
    };
  }

  function recordFailedMembers(
    aggregateId: string,
    memberIds: readonly string[],
  ): SeamResult<void> {
    const lineage = state.lineages.get(aggregateId);
    if (lineage === undefined) {
      return seamFail([
        seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no lineage exists for this id'),
      ]);
    }
    const decoded: MemberId[] = [];
    for (const raw of memberIds) {
      const memberId = makeMemberId(raw);
      if (!memberId.ok) {
        return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
      }
      decoded.push(memberId.value);
    }
    for (const memberId of decoded) {
      if (!lineage.failedMembers.includes(memberId)) {
        lineage.failedMembers.push(memberId);
      }
    }
    return seamOk(undefined);
  }

  const server: CoreSeamServer = {
    handleFrame,
    recordFailedMembers,
    inspectProjection(aggregateId: string) {
      return projectAggregate(state, aggregateId);
    },
    get acceptedCommandCount() {
      return state.accepted.size;
    },
  };
  return { ok: true, value: server };
}

interface AppliedCommand {
  readonly revision: number;
}

/**
 * Deterministic authority application shared by the live path and restart
 * replay: domain decode → semantic gates → Core-owned state mutation.
 * Gates (authorization/bounds/idempotency/revision) run in the caller.
 */
function applyCommand(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  switch (envelope.commandType) {
    case 'SUBMIT_CONTRACT':
      return applySubmitContract(state, gateway, envelope);
    case 'CONFIRM_SNAPSHOT':
      return applyConfirmSnapshot(state, gateway, envelope);
    case 'CANCEL_LINEAGE':
      return applyCancelLineage(state, envelope);
    case 'RETRY_FAILED_MEMBERS':
      return applyRetryFailedMembers(state, envelope);
    case 'PROJECT_TERMINAL_RESULT':
      return applyProjectTerminalResult(state, gateway, envelope);
  }
}

function bindCorrelation(envelope: CommandEnvelope): SeamResult<void> {
  const referenced = envelope.correlation.contractId;
  if (referenced !== undefined && referenced !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'correlation.contractId',
        'command correlation references a different aggregate than the command targets; cross-task/cross-aggregate replay rejects',
        'L2-§12',
      ),
    ]);
  }
  return seamOk(undefined);
}

function domainFailure<T>(result: DomainValidationResult<T>): SeamResult<T> {
  return result.ok ? seamOk(result.value) : seamFail(domainDiagnosticsToSeam(result.diagnostics));
}

function requireLineage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<RequiredLineage> {
  const aggregate = state.aggregates.get(envelope.aggregateId);
  const lineage = state.lineages.get(envelope.aggregateId);
  if (aggregate === undefined || lineage === undefined) {
    return seamFail([
      seamDiagnostic('AGGREGATE_NOT_FOUND', 'aggregateId', 'no aggregate exists for this id'),
    ]);
  }
  return seamOk({ aggregate, lineage });
}

interface RequiredLineage {
  readonly aggregate: { readonly contract: AcquisitionContract; revision: number };
  readonly lineage: LineageState;
}

function rejectLate(lineageStatus: string, what: string): SeamResult<never> {
  return seamFail([
    seamDiagnostic(
      'LATE_COMMAND',
      'lineage.status',
      `lineage is ${lineageStatus}; late ${what} is recorded and rejected, terminal truth unchanged`,
      'L2-§11',
    ),
  ]);
}

function applySubmitContract(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const decoded = gateway.submitContract(envelope.payload);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  const contract = decoded.value;
  if (contract.contractId !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'aggregateId',
        'decoded contract identity does not bind the addressed aggregate',
      ),
    ]);
  }
  const existing = state.aggregates.get(envelope.aggregateId);
  if (existing !== undefined) {
    // Same identity: any semantic change requires successor identity (PRD §8).
    const transition = assertContractTransition(existing.contract, contract);
    if (!transition.ok) {
      return domainFailure(transition);
    }
    return seamFail([
      seamDiagnostic(
        'DUPLICATE_ALLOCATION',
        'aggregateId',
        'aggregate identity already exists; re-creation or mutation requires a successor contract identity',
        'L2-§6.8',
      ),
    ]);
  }
  // Successor path: a new identity may supersede an existing aggregate.
  const supersedes = contract.supersedesContractId;
  if (supersedes !== undefined) {
    const predecessor = state.aggregates.get(supersedes);
    if (predecessor === undefined) {
      return seamFail([
        seamDiagnostic(
          'AGGREGATE_NOT_FOUND',
          'contract.supersedesContractId',
          'successor references an unknown predecessor aggregate',
        ),
      ]);
    }
    const transition = assertContractTransition(predecessor.contract, contract);
    if (!transition.ok) {
      return domainFailure(transition);
    }
  }
  state.aggregates.set(envelope.aggregateId, { contract, revision: 1 });
  state.lineages.set(envelope.aggregateId, createLineageState());
  return seamOk({ revision: 1 });
}

function applyConfirmSnapshot(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status !== 'ACTIVE') {
    return rejectLate(lineage.status, 'snapshot confirmation');
  }
  if (lineage.snapshot !== undefined) {
    return seamFail([
      seamDiagnostic(
        'SNAPSHOT_MUTATION',
        'lineage.snapshot',
        'selection snapshot already confirmed for this lineage; refresh/re-enumeration requires successor contract/snapshot identity',
        'C11',
      ),
    ]);
  }
  const decoded = gateway.confirmSnapshot(envelope.payload, aggregate.contract);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  const snapshot = decoded.value;
  if (snapshot.contractId !== envelope.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'aggregateId',
        'decoded snapshot binds a different contract than the addressed aggregate; cross-task replay rejects',
        'C31',
      ),
    ]);
  }
  lineage.snapshot = snapshot;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

function applyCancelLineage(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return rejectLate(lineage.status, 'cancel command');
  }
  if (lineage.status === 'CANCELLED') {
    // A second cancel resolves through the same Core order: no new
    // precedence, no revision bump (single authority across surfaces,
    // L2 §11.1 rule 7).
    return seamOk({ revision: aggregate.revision });
  }
  lineage.status = 'CANCELLED';
  state.cancelOrderCounter += 1;
  lineage.cancelOrder = state.cancelOrderCounter;
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

function applyRetryFailedMembers(
  state: SeamAuthorityState,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return rejectLate(lineage.status, 'retry command');
  }
  const payloadResult = decodeRetryPayload(envelope.payload);
  if (!payloadResult.ok) {
    return payloadResult;
  }
  const requested = payloadResult.value;
  if (lineage.failedMembers.length === 0) {
    return seamFail([
      seamDiagnostic(
        'RETRY_AUTHORITY_DOMAIN_REJECTED',
        'payload.memberIds',
        'no failed-member authority domain is recorded for this lineage; retry cannot invent one',
        'C12',
      ),
    ]);
  }
  const outside = requested.filter((memberId) => !lineage.failedMembers.includes(memberId));
  if (outside.length > 0) {
    return seamFail([
      seamDiagnostic(
        'RETRY_AUTHORITY_DOMAIN_REJECTED',
        'payload.memberIds',
        `retry authority domain is the original failed member identities; ${String(outside.length)} requested member(s) are outside that domain`,
        'C12',
      ),
    ]);
  }
  for (const memberId of requested) {
    if (!lineage.retriedMembers.includes(memberId)) {
      lineage.retriedMembers.push(memberId);
    }
  }
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

const RETRY_PAYLOAD_KEYS: readonly string[] = ['memberIds'];

function decodeRetryPayload(payload: unknown): SeamResult<readonly MemberId[]> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'retry payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !RETRY_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `payload.${key}`, 'unknown field on retry payload'),
      ),
    );
  }
  const raw = record['memberIds'];
  if (!Array.isArray(raw) || raw.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.memberIds',
        'memberIds must be a non-empty array',
      ),
    ]);
  }
  const memberIds: MemberId[] = [];
  for (const item of raw) {
    const memberId = makeMemberId(typeof item === 'string' ? item : '');
    if (!memberId.ok) {
      return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
    }
    if (memberIds.includes(memberId.value)) {
      return seamFail([
        seamDiagnostic(
          'DUPLICATE_IDENTITY',
          'payload.memberIds',
          `duplicate member identity '${memberId.value}' in one command`,
        ),
      ]);
    }
    memberIds.push(memberId.value);
  }
  return seamOk(memberIds);
}

function applyProjectTerminalResult(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  envelope: CommandEnvelope,
): SeamResult<AppliedCommand> {
  const binding = bindCorrelation(envelope);
  if (!binding.ok) {
    return binding;
  }
  const required = requireLineage(state, envelope);
  if (!required.ok) {
    return required;
  }
  const { aggregate, lineage } = required.value;
  if (lineage.status === 'TERMINAL') {
    return seamFail([
      seamDiagnostic(
        'LATE_COMMAND',
        'lineage.status',
        'lineage is already terminal; terminal truth is never rewritten',
        'L2-§11',
      ),
    ]);
  }
  // Seam-owned context derivation: Core canonical state supplies the subject
  // facts; the command may carry the projector's evidence context (closed
  // fields, shape-checked here, semantics validated by the domain layer).
  const selectedMemberCount =
    lineage.snapshot !== undefined
      ? lineage.snapshot.selectedMemberIds.length
      : aggregate.contract.intentType === 'SINGLE_RESOURCE'
        ? 1
        : 0;
  const command = decodeTerminalCommand(envelope.payload);
  if (!command.ok) {
    return command;
  }
  const context: TerminalResultContext = {
    intentType: aggregate.contract.intentType,
    scopeKind: aggregate.contract.requestedScope.kind,
    selectedMemberCount,
    ...command.value.context,
  };
  const decoded = gateway.projectTerminalResult(command.value.result, context);
  if (!decoded.ok) {
    return domainFailure(decoded);
  }
  lineage.terminal = decoded.value;
  lineage.status = 'TERMINAL';
  const revision = aggregate.revision + 1;
  aggregate.revision = revision;
  return seamOk({ revision });
}

const TERMINAL_PAYLOAD_KEYS: readonly string[] = [
  'result',
  'selectedValidationOutcomes',
  'coverageEvidence',
  'knownAuthInaccessibleRequestedCount',
];

interface TerminalCommand {
  readonly result: unknown;
  readonly context: Omit<TerminalResultContext, 'intentType' | 'scopeKind' | 'selectedMemberCount'>;
}

function decodeTerminalCommand(payload: unknown): SeamResult<TerminalCommand> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'terminal-result payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !TERMINAL_PAYLOAD_KEYS.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic('ENVELOPE_MALFORMED', `payload.${key}`, 'unknown field on terminal command'),
      ),
    );
  }
  if (!('result' in record)) {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', 'payload.result', 'result is required')]);
  }
  let outcomes: { memberId: MemberId; requiredValidationPassed: boolean }[] | undefined;
  let coverageEvidence: TerminalResultContext['coverageEvidence'];
  let knownAuthInaccessibleRequestedCount: number | undefined;
  const rawOutcomes = record['selectedValidationOutcomes'];
  if (rawOutcomes !== undefined) {
    if (!Array.isArray(rawOutcomes)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.selectedValidationOutcomes',
          'expected an array',
        ),
      ]);
    }
    outcomes = [];
    for (const item of rawOutcomes) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'each outcome must be an object',
          ),
        ]);
      }
      const outcomeRecord = item as Record<string, unknown>;
      const keys = Object.keys(outcomeRecord);
      if (
        keys.length !== 2 ||
        !keys.includes('memberId') ||
        !keys.includes('requiredValidationPassed')
      ) {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'outcome fields are exactly { memberId, requiredValidationPassed }',
          ),
        ]);
      }
      const memberId = makeMemberId(
        typeof outcomeRecord['memberId'] === 'string' ? outcomeRecord['memberId'] : '',
      );
      if (!memberId.ok) {
        return seamFail(domainDiagnosticsToSeam(memberId.diagnostics));
      }
      if (typeof outcomeRecord['requiredValidationPassed'] !== 'boolean') {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.selectedValidationOutcomes',
            'requiredValidationPassed must be a boolean',
          ),
        ]);
      }
      outcomes.push({
        memberId: memberId.value,
        requiredValidationPassed: outcomeRecord['requiredValidationPassed'] as boolean,
      });
    }
  }
  const rawCoverage = record['coverageEvidence'];
  if (rawCoverage !== undefined) {
    if (typeof rawCoverage !== 'object' || rawCoverage === null || Array.isArray(rawCoverage)) {
      return seamFail([
        seamDiagnostic('ENVELOPE_MALFORMED', 'payload.coverageEvidence', 'expected an object'),
      ]);
    }
    const coverageRecord = rawCoverage as Record<string, unknown>;
    if (
      (coverageRecord['kind'] !== 'SUFFICIENT' && coverageRecord['kind'] !== 'INSUFFICIENT') ||
      !('basis' in coverageRecord)
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.coverageEvidence',
          "coverage evidence is { kind: 'SUFFICIENT' | 'INSUFFICIENT', basis }",
        ),
      ]);
    }
    coverageEvidence = rawCoverage as TerminalResultContext['coverageEvidence'];
  }
  const rawInaccessible = record['knownAuthInaccessibleRequestedCount'];
  if (rawInaccessible !== undefined) {
    if (
      typeof rawInaccessible !== 'number' ||
      !Number.isInteger(rawInaccessible) ||
      rawInaccessible < 0
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.knownAuthInaccessibleRequestedCount',
          'expected a non-negative integer',
        ),
      ]);
    }
    knownAuthInaccessibleRequestedCount = rawInaccessible;
  }
  return seamOk({
    result: record['result'],
    context: {
      selectedValidationOutcomes: outcomes,
      coverageEvidence,
      knownAuthInaccessibleRequestedCount,
    },
  });
}

/**
 * Restart replay of one accepted journal entry: re-run the deterministic
 * authority application (gate-bypassed), then restore the idempotency
 * record so re-submission converges instead of re-executing (ADR-010).
 */
function restoreAcceptedCommand(
  state: SeamAuthorityState,
  gateway: DomainGateway,
  entry: SeamJournalEntry,
): SeamResult<void> {
  const applied = applyCommand(state, gateway, entry.envelope);
  if (!applied.ok) {
    return applied;
  }
  state.accepted.set(entry.envelope.requestId, {
    envelope: entry.envelope,
    response: entry.response,
    payloadDigest: entry.payloadDigest,
  });
  return seamOk(undefined);
}
