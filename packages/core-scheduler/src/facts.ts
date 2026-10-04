/**
 * T006 durable control facts — the authority for all scheduling/control
 * decisions (facts decide, machines derive).
 *
 * The fact vocabulary is the injectable durable-control-facts seam that
 * T005/T015 implement with a real store: an append-only, totally ordered log
 * of factual records. T006 defines the semantics and proves them with a
 * deterministic in-memory log; it implements no persistence engine.
 *
 * Facts compose the T002 canonical identities (`ContractId`, `SnapshotId`,
 * `LogicalTargetId`, `MemberId`, `EffectId`, `AuthorizationContextRef`,
 * `BudgetProfile`) and never fork or re-declare them.
 */

import {
  deepFreeze,
  decodeBudgetProfile,
  makeAuthorizationContextRef,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  ok,
  fail,
  type BudgetProfile,
  type ContractId,
  type DomainValidationResult,
  type EffectId,
  type LogicalTargetId,
  type MemberId,
  type SnapshotId,
  type AuthorizationContextRef,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import { controlOk, controlReject, type ControlResult } from './rejections.ts';

/** Commit-order identity: strictly increasing, assigned by the authoritative log. */
export type CommitSequence = number;

/** Canonical lineage key: the frozen Contract/Snapshot/target/effect binding. */
export type LineageKey = string;

/** Where a cancellation command came from; all sources resolve through the same Core transition. */
export type CancelSource = 'DESKTOP_UI' | 'CLI' | 'BROWSER_EXTENSION' | 'CORE_POLICY';

/** At-least-once external effect outcomes; uncertainty is a truthful terminal classification (PRD §30). */
export type EffectOutcome = 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN';

/** Bounded reconciliation observations — truthful facts, never promotion across the cutoff. */
export type ReconciliationObservationKind =
  | 'STAGED_BYTES_PRESENT'
  | 'NO_STAGED_BYTES'
  | 'MATERIALIZATION_ESTABLISHED'
  | 'MATERIALIZATION_NOT_ESTABLISHED';

/** The frozen identity binding of one work lineage. */
export interface LineageBinding {
  readonly contractId: ContractId;
  readonly snapshotId: SnapshotId;
  readonly targetId: LogicalTargetId;
  readonly effectId: EffectId;
  readonly authorizationContextRef: AuthorizationContextRef;
}

/**
 * Flat "what a budgeted action touched" record. The authoritative ledger is
 * the only writer of consumption facts and folds these into the T002
 * `ConsumedBudget` domains (single Core-owned budget mutation path).
 */
export interface BudgetAmounts {
  readonly generatedRequests?: number;
  readonly navigationActions?: number;
  readonly modelCalls?: number;
  readonly modelCostUnits?: number;
  readonly bytes?: number;
  readonly segments?: number;
  readonly activeTransferMs?: number;
  readonly retryTransferRequests?: number;
  readonly activeElapsedMs?: number;
}

export type BudgetActionKind =
  | 'GENERATED_REQUEST'
  | 'NAVIGATION'
  | 'MODEL_CALL'
  | 'TRANSFER_BYTES'
  | 'TRANSFER_SEGMENT'
  | 'TRANSFER_TIME'
  | 'RETRY_TRANSFER_REQUEST'
  | 'ACTIVE_ELAPSED';

export type DurableControlFact =
  | {
      readonly kind: 'lineageSubmitted';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly binding: LineageBinding;
      readonly frozenMemberIds: readonly MemberId[];
      readonly budgetProfile: BudgetProfile;
    }
  | {
      readonly kind: 'budgetReserved';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly contractId: ContractId;
      readonly reservationId: string;
      readonly action: BudgetActionKind;
      readonly amounts: BudgetAmounts;
    }
  | {
      readonly kind: 'budgetConsumed';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly contractId: ContractId;
      readonly reservationId: string;
      readonly amounts: BudgetAmounts;
    }
  | {
      readonly kind: 'cancelAuthorityCommitted';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly stopReason: 'USER_CANCELLED';
      readonly source: CancelSource;
    }
  | {
      readonly kind: 'acceptanceCommitted';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly effectId: EffectId;
    }
  | {
      readonly kind: 'resumeAuthorized';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly authorizedBy: string;
      readonly reason: 'RETRY' | 'RESUME';
    }
  | {
      readonly kind: 'effectAttemptStarted';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly effectId: EffectId;
      readonly attemptId: string;
    }
  | {
      readonly kind: 'effectOutcomeRecorded';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly effectId: EffectId;
      readonly attemptId: string;
      readonly outcome: EffectOutcome;
      readonly failureCategory?: string;
    }
  | {
      readonly kind: 'reconciliationObserved';
      readonly sequence: CommitSequence;
      readonly lineageKey: LineageKey;
      readonly observation: ReconciliationObservationKind;
      readonly detail?: string;
    };

/** A fact as a caller proposes it (commit sequence not yet assigned). */
export type UncommittedControlFact = DistributiveOmit<DurableControlFact, 'sequence'>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const CANCEL_SOURCES: readonly CancelSource[] = [
  'DESKTOP_UI',
  'CLI',
  'BROWSER_EXTENSION',
  'CORE_POLICY',
];

const OUTCOMES: readonly EffectOutcome[] = ['SUCCEEDED', 'FAILED', 'UNCERTAIN'];

const RECONCILIATION_OBSERVATIONS: readonly ReconciliationObservationKind[] = [
  'STAGED_BYTES_PRESENT',
  'NO_STAGED_BYTES',
  'MATERIALIZATION_ESTABLISHED',
  'MATERIALIZATION_NOT_ESTABLISHED',
];

const ACTION_KINDS: readonly BudgetActionKind[] = [
  'GENERATED_REQUEST',
  'NAVIGATION',
  'MODEL_CALL',
  'TRANSFER_BYTES',
  'TRANSFER_SEGMENT',
  'TRANSFER_TIME',
  'RETRY_TRANSFER_REQUEST',
  'ACTIVE_ELAPSED',
];

const AMOUNT_FIELDS = [
  'generatedRequests',
  'navigationActions',
  'modelCalls',
  'modelCostUnits',
  'bytes',
  'segments',
  'activeTransferMs',
  'retryTransferRequests',
  'activeElapsedMs',
] as const;

/**
 * Canonical effect identity derived from the frozen work identity. Duplicate
 * clients submitting the same work derive the same effect id, so convergence
 * happens by identity, never by locking heuristics (PRD C13 tuple).
 */
export function canonicalEffectId(
  contractId: ContractId,
  snapshotId: SnapshotId,
  targetId: LogicalTargetId,
): DomainValidationResult<EffectId> {
  return makeEffectId(`effect:${contractId}:${snapshotId}:${targetId}`);
}

/** Canonical lineage key string for a binding. */
export function lineageKeyOf(binding: {
  readonly contractId: ContractId;
  readonly snapshotId: SnapshotId;
  readonly targetId: LogicalTargetId;
  readonly effectId: EffectId;
}): LineageKey {
  return `${binding.contractId}|${binding.snapshotId}|${binding.targetId}|${binding.effectId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requirePositiveInt(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function pushAll(result: DomainValidationResult<unknown>, sink: ValidationDiagnostic[]): void {
  if (!result.ok) {
    sink.push(...result.diagnostics);
  }
}

function decodeAmounts(raw: unknown, sink: ValidationDiagnostic[]): BudgetAmounts | undefined {
  if (!isPlainObject(raw)) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'amounts',
      message: 'budget amounts must be an object',
    });
    return undefined;
  }
  const amounts: Record<string, number> = {};
  for (const field of AMOUNT_FIELDS) {
    const value = raw[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      sink.push({
        code: 'MALFORMED_REQUIRED_FIELD',
        path: `amounts.${field}`,
        message: 'budget amounts must be non-negative integers',
      });
      return undefined;
    }
    if (value > 0) {
      amounts[field] = value;
    }
  }
  return deepFreeze(amounts) as BudgetAmounts;
}

function decodeBranded<T>(
  raw: unknown,
  key: string,
  make: (value: string) => DomainValidationResult<T>,
  sink: ValidationDiagnostic[],
): T | undefined {
  if (typeof raw !== 'string' || raw.length === 0) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: key,
      message: `${key} must be a valid canonical identity string`,
    });
    return undefined;
  }
  const result = make(raw);
  if (!result.ok) {
    sink.push(...result.diagnostics);
    return undefined;
  }
  return result.value;
}

function decodeBinding(raw: unknown, sink: ValidationDiagnostic[]): LineageBinding | undefined {
  if (!isPlainObject(raw)) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'binding',
      message: 'lineage binding must be an object',
    });
    return undefined;
  }
  const contractId = decodeBranded(raw['contractId'], 'binding.contractId', makeContractId, sink);
  const snapshotId = decodeBranded(raw['snapshotId'], 'binding.snapshotId', makeSnapshotId, sink);
  const targetId = decodeBranded(raw['targetId'], 'binding.targetId', makeLogicalTargetId, sink);
  const effectId = decodeBranded(raw['effectId'], 'binding.effectId', makeEffectId, sink);
  const authorizationContextRef = decodeBranded(
    raw['authorizationContextRef'],
    'binding.authorizationContextRef',
    makeAuthorizationContextRef,
    sink,
  );
  if (
    contractId === undefined ||
    snapshotId === undefined ||
    targetId === undefined ||
    effectId === undefined ||
    authorizationContextRef === undefined
  ) {
    return undefined;
  }
  return deepFreeze({
    contractId,
    snapshotId,
    targetId,
    effectId,
    authorizationContextRef,
  });
}

function decodeMemberIds(raw: unknown, sink: ValidationDiagnostic[]): MemberId[] | undefined {
  if (!Array.isArray(raw)) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'frozenMemberIds',
      message: 'frozen member ids must be an array',
    });
    return undefined;
  }
  const ids: MemberId[] = [];
  for (const entry of raw) {
    const decoded = typeof entry === 'string' ? makeMemberId(entry) : undefined;
    if (decoded === undefined) {
      sink.push({
        code: 'MALFORMED_REQUIRED_FIELD',
        path: 'frozenMemberIds',
        message: 'frozen member ids must be valid MemberId strings',
      });
      return undefined;
    }
    if (!decoded.ok) {
      sink.push(...decoded.diagnostics);
      return undefined;
    }
    ids.push(decoded.value);
  }
  return ids;
}

function decodeOneFact(raw: unknown, sink: ValidationDiagnostic[]): DurableControlFact | undefined {
  if (!isPlainObject(raw)) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'fact',
      message: 'control fact must be an object',
    });
    return undefined;
  }
  const kind = raw['kind'];
  const sequence = requirePositiveInt(raw, 'sequence');
  const lineageKey = requireNonEmptyString(raw, 'lineageKey');
  if (typeof kind !== 'string' || sequence === undefined || lineageKey === undefined) {
    sink.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'fact',
      message: 'control fact requires a known kind, positive sequence and lineageKey',
    });
    return undefined;
  }
  const base = { sequence, lineageKey } as const;
  switch (kind) {
    case 'lineageSubmitted': {
      const binding = decodeBinding(raw['binding'], sink);
      const members =
        raw['frozenMemberIds'] === undefined ? [] : decodeMemberIds(raw['frozenMemberIds'], sink);
      const profile = decodeBudgetProfile(raw['budgetProfile']);
      pushAll(profile, sink);
      if (binding === undefined || members === undefined || !profile.ok) {
        return undefined;
      }
      return deepFreeze({
        kind,
        ...base,
        binding,
        frozenMemberIds: deepFreeze(members),
        budgetProfile: profile.value,
      });
    }
    case 'budgetReserved':
    case 'budgetConsumed': {
      const contractIdRaw = requireNonEmptyString(raw, 'contractId');
      const reservationId = requireNonEmptyString(raw, 'reservationId');
      const amounts = decodeAmounts(raw['amounts'], sink);
      const contractId = contractIdRaw === undefined ? undefined : makeContractId(contractIdRaw);
      if (contractId !== undefined) {
        pushAll(contractId, sink);
      }
      if (
        contractId === undefined ||
        !contractId.ok ||
        amounts === undefined ||
        reservationId === undefined
      ) {
        return undefined;
      }
      const contract = contractId.value;
      if (kind === 'budgetReserved') {
        const actionRaw = raw['action'];
        if (
          typeof actionRaw !== 'string' ||
          !ACTION_KINDS.includes(actionRaw as BudgetActionKind)
        ) {
          sink.push({
            code: 'UNKNOWN_ENUM_VALUE',
            path: 'action',
            message: `unknown budget action kind '${String(actionRaw)}'`,
          });
          return undefined;
        }
        return deepFreeze({
          kind,
          ...base,
          contractId: contract,
          reservationId,
          action: actionRaw as BudgetActionKind,
          amounts,
        });
      }
      return deepFreeze({
        kind,
        ...base,
        contractId: contract,
        reservationId,
        amounts,
      });
    }
    case 'cancelAuthorityCommitted': {
      const source = raw['source'];
      if (typeof source !== 'string' || !CANCEL_SOURCES.includes(source as CancelSource)) {
        sink.push({
          code: 'UNKNOWN_ENUM_VALUE',
          path: 'source',
          message: `unknown cancel source '${String(source)}'`,
        });
        return undefined;
      }
      return deepFreeze({
        kind,
        ...base,
        stopReason: 'USER_CANCELLED' as const,
        source: source as CancelSource,
      });
    }
    case 'acceptanceCommitted': {
      const effectId = makeEffectId(String(requireNonEmptyString(raw, 'effectId') ?? ''));
      pushAll(effectId, sink);
      if (!effectId.ok) {
        return undefined;
      }
      return deepFreeze({ kind, ...base, effectId: effectId.value });
    }
    case 'resumeAuthorized': {
      const authorizedBy = requireNonEmptyString(raw, 'authorizedBy');
      const reason = raw['reason'];
      if (authorizedBy === undefined || (reason !== 'RETRY' && reason !== 'RESUME')) {
        sink.push({
          code: 'MALFORMED_REQUIRED_FIELD',
          path: 'resumeAuthorized',
          message: 'resume fact requires an authorizing identity and reason RETRY|RESUME',
        });
        return undefined;
      }
      return deepFreeze({
        kind,
        ...base,
        authorizedBy,
        reason: reason as 'RETRY' | 'RESUME',
      });
    }
    case 'effectAttemptStarted': {
      const effectId = makeEffectId(String(requireNonEmptyString(raw, 'effectId') ?? ''));
      const attemptId = requireNonEmptyString(raw, 'attemptId');
      pushAll(effectId, sink);
      if (!effectId.ok || attemptId === undefined) {
        return undefined;
      }
      return deepFreeze({ kind, ...base, effectId: effectId.value, attemptId });
    }
    case 'effectOutcomeRecorded': {
      const effectId = makeEffectId(String(requireNonEmptyString(raw, 'effectId') ?? ''));
      const attemptId = requireNonEmptyString(raw, 'attemptId');
      const outcome = raw['outcome'];
      pushAll(effectId, sink);
      if (!effectId.ok || attemptId === undefined) {
        return undefined;
      }
      if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as EffectOutcome)) {
        sink.push({
          code: 'UNKNOWN_ENUM_VALUE',
          path: 'outcome',
          message: `unknown effect outcome '${String(outcome)}'`,
        });
        return undefined;
      }
      const failureCategory = requireNonEmptyString(raw, 'failureCategory');
      return deepFreeze(
        failureCategory === undefined
          ? {
              kind,
              ...base,
              effectId: effectId.value,
              attemptId,
              outcome: outcome as EffectOutcome,
            }
          : {
              kind,
              ...base,
              effectId: effectId.value,
              attemptId,
              outcome: outcome as EffectOutcome,
              failureCategory,
            },
      );
    }
    case 'reconciliationObserved': {
      const observation = raw['observation'];
      const detail = requireNonEmptyString(raw, 'detail');
      if (
        typeof observation !== 'string' ||
        !RECONCILIATION_OBSERVATIONS.includes(observation as ReconciliationObservationKind)
      ) {
        sink.push({
          code: 'UNKNOWN_ENUM_VALUE',
          path: 'observation',
          message: `unknown reconciliation observation '${String(observation)}'`,
        });
        return undefined;
      }
      return deepFreeze(
        detail === undefined
          ? { kind, ...base, observation: observation as ReconciliationObservationKind }
          : { kind, ...base, observation: observation as ReconciliationObservationKind, detail },
      );
    }
    default:
      sink.push({
        code: 'UNKNOWN_ENUM_VALUE',
        path: 'kind',
        message: `unknown control fact kind '${kind}'`,
      });
      return undefined;
  }
}

/**
 * Fail-closed decode of a serialized fact log (restart/reopen path). Facts are
 * re-validated structurally and sequences must be strictly increasing: the
 * durable commit order is the authority and cannot be fabricated.
 */
export function decodeFactLog(raw: unknown): DomainValidationResult<readonly DurableControlFact[]> {
  if (!Array.isArray(raw)) {
    return fail([
      {
        code: 'MALFORMED_REQUIRED_FIELD',
        path: 'factLog',
        message: 'fact log must be an array of control facts',
      },
    ]);
  }
  const sink: ValidationDiagnostic[] = [];
  const facts: DurableControlFact[] = [];
  let previousSequence = 0;
  for (const entry of raw) {
    const fact = decodeOneFact(entry, sink);
    if (fact === undefined) {
      return fail(
        sink.length > 0
          ? sink
          : [
              {
                code: 'MALFORMED_REQUIRED_FIELD',
                path: 'factLog',
                message: 'control fact log rejected',
              },
            ],
      );
    }
    if (fact.sequence <= previousSequence) {
      return fail([
        {
          code: 'MALFORMED_REQUIRED_FIELD',
          path: 'factLog.sequence',
          message: 'commit sequences must be strictly increasing (single durable total order)',
        },
      ]);
    }
    previousSequence = fact.sequence;
    facts.push(fact);
  }
  return ok(deepFreeze(facts));
}

/** JSON-serialize committed facts (process-death simulation / seam contract). */
export function serializeFacts(facts: readonly DurableControlFact[]): string {
  return JSON.stringify(facts);
}

/** Validate a control fact in the scheduler seam (identity decode happens here, never bypassed). */
export function validateLineageKeyFormat(lineageKey: string): ControlResult<void> {
  const parts = lineageKey.split('|');
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
    return controlReject(
      'MALFORMED_CONTROL_FACT',
      'lineageKey must be the canonical contract|snapshot|target|effect binding',
      lineageKey,
    );
  }
  return controlOk(undefined);
}
