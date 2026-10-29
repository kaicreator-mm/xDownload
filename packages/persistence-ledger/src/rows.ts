/**
 * T005 typed ledger readers — DB rows are untrusted input.
 *
 * Every row read back from SQLite passes runtime decode/validation through
 * the T002 canonical vocabulary before it may influence any classification
 * (REFERENCE_PACK §2.3: TypeScript types are erased at runtime). Malformed
 * required fields, unknown authoritative state enum values and non-monotonic
 * transition-order facts fail closed; they are never coerced.
 */

import {
  decodeBudgetProfile,
  makeAuthorizationContextRef,
  makeContractId,
  makeEffectId,
  makeMemberId,
  makeSnapshotId,
  type BudgetProfile,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { PersistenceError } from './errors.ts';

/**
 * Unwrap a canonical decode result into its branded value, failing closed
 * with a typed ledger error when the durable row does not decode.
 */
export function unwrapBranded<T>(result: DomainValidationResult<T>, path: string): T {
  if (!result.ok) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `${path} fails canonical decode: ${result.diagnostics
        .map((diagnosticItem) => `${diagnosticItem.code}:${diagnosticItem.path}`)
        .join(', ')}`,
      { path },
    );
  }
  return result.value;
}

export const LIFECYCLE_STATES = [
  'REGISTERED',
  'STAGED',
  'MATERIALIZED',
  'FINALIZED',
  'ACCEPTED',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_STATE_RANK: Readonly<Record<LifecycleState, number>> = Object.freeze({
  REGISTERED: 0,
  STAGED: 1,
  MATERIALIZED: 2,
  FINALIZED: 3,
  ACCEPTED: 4,
});

export const FACT_KINDS = [
  'DISPATCH_INTENT',
  'EXTERNAL_EFFECT_OBSERVED',
  'FS_STAGED',
  'FS_MATERIALIZED',
  'FS_FINALIZED',
  'VALIDATION_PASSED',
  'ACCEPTED',
  'USER_CANCELLED',
  'EXPLICIT_RETRY_RESUME',
  'TERMINAL_FAILURE',
] as const;

export type FactKind = (typeof FACT_KINDS)[number];

export interface TransitionFact {
  readonly workItemId: string;
  readonly seq: number;
  readonly kind: FactKind;
  readonly payloadJson: string | undefined;
  readonly recordedAt: string;
}

export interface WorkItemRow {
  readonly workItemId: string;
  readonly contractId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly effectId: string;
  readonly lifecycleState: LifecycleState;
  readonly authorizationContextRef: string;
  readonly budgetProfile: BudgetProfile;
  readonly createdAt: string;
}

export interface EffectRow {
  readonly effectId: string;
  readonly workItemId: string;
  readonly intentRecordedAt: string;
  readonly outcome: 'OBSERVED' | 'ABSENT_UNKNOWN' | undefined;
  readonly observedAt: string | undefined;
}

export interface ArtifactRow {
  readonly artifactId: string;
  readonly workItemId: string;
  readonly relativePath: string;
  readonly provenanceJson: string;
  readonly byteSize: number | undefined;
  readonly digestSha256: string | undefined;
  readonly recordedAt: string;
}

export type BudgetEntryKind = 'RESERVATION' | 'CONSUMPTION' | 'RESERVATION_RELEASE';

export interface BudgetEntryRow {
  readonly entryId: string;
  readonly workItemId: string;
  readonly domain: 'discovery' | 'transfer' | 'global_safety';
  readonly limitKey: string;
  readonly kind: BudgetEntryKind;
  readonly amount: number;
  readonly convergenceKey: string | undefined;
  readonly recordedAt: string;
}

type SqlValue = string | number | bigint | Uint8Array | null;
type Row = Record<string, SqlValue>;

function requireString(row: Row, column: string, context: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `${context}.${column} must be a string, got ${typeof value}`,
      { path: `${context}.${column}` },
    );
  }
  return value;
}

function optionalString(row: Row, column: string, context: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return requireString(row, column, context);
}

function optionalInteger(row: Row, column: string, context: string): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `${context}.${column} must be an integer when present`,
      { path: `${context}.${column}` },
    );
  }
  return value;
}

/** Decode the authoritative lifecycle state; unknown enum values fail closed. */
export function decodeLifecycleState(raw: string, context: string): LifecycleState {
  if (!(LIFECYCLE_STATES as readonly string[]).includes(raw)) {
    throw new PersistenceError(
      'UNKNOWN_LEDGER_STATE',
      `unknown authoritative lifecycle state '${raw}'`,
      { path: `${context}.lifecycle_state`, invariant: 'fail-closed-decode' },
    );
  }
  return raw as LifecycleState;
}

export function decodeFactKind(raw: string, context: string): FactKind {
  if (!(FACT_KINDS as readonly string[]).includes(raw)) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `unknown authoritative transition-fact kind '${raw}'`,
      { path: `${context}.fact_kind`, invariant: 'fail-closed-decode' },
    );
  }
  return raw as FactKind;
}

export function decodeWorkItemRow(row: Row): WorkItemRow {
  const contractId = unwrapBranded(
    makeContractId(requireString(row, 'contract_id', 'work_items')),
    'work_items.contract_id',
  );
  const snapshotId = unwrapBranded(
    makeSnapshotId(requireString(row, 'snapshot_id', 'work_items')),
    'work_items.snapshot_id',
  );
  const memberId = unwrapBranded(
    makeMemberId(requireString(row, 'member_id', 'work_items')),
    'work_items.member_id',
  );
  const effectId = unwrapBranded(
    makeEffectId(requireString(row, 'effect_id', 'work_items')),
    'work_items.effect_id',
  );
  const authorizationRef = unwrapBranded(
    makeAuthorizationContextRef(requireString(row, 'authorization_context_ref', 'work_items')),
    'work_items.authorization_context_ref',
  );
  const profileJson = requireString(row, 'budget_profile_json', 'work_items');
  let budgetProfileRaw: unknown;
  try {
    budgetProfileRaw = JSON.parse(profileJson) as unknown;
  } catch (error) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      'work_items.budget_profile_json is not valid JSON',
      { path: 'work_items.budget_profile_json' },
      error,
    );
  }
  const budgetProfile = decodeBudgetProfile(budgetProfileRaw);
  if (!budgetProfile.ok) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `work_items.budget_profile_json fails canonical budget decode: ${budgetProfile.diagnostics
        .map((diagnostic) => `${diagnostic.code}:${diagnostic.path}`)
        .join(', ')}`,
      { path: 'work_items.budget_profile_json' },
    );
  }
  return {
    workItemId: requireString(row, 'work_item_id', 'work_items'),
    contractId,
    snapshotId,
    memberId,
    effectId,
    lifecycleState: decodeLifecycleState(
      requireString(row, 'lifecycle_state', 'work_items'),
      'work_items',
    ),
    authorizationContextRef: authorizationRef,
    budgetProfile: budgetProfile.value,
    createdAt: requireString(row, 'created_at', 'work_items'),
  };
}

export function decodeEffectRow(row: Row): EffectRow {
  const outcomeRaw = optionalString(row, 'outcome', 'effects');
  if (outcomeRaw !== undefined && outcomeRaw !== 'OBSERVED' && outcomeRaw !== 'ABSENT_UNKNOWN') {
    throw new PersistenceError('MALFORMED_LEDGER_ROW', `unknown effect outcome '${outcomeRaw}'`, {
      path: 'effects.outcome',
      invariant: 'fail-closed-decode',
    });
  }
  return {
    effectId: unwrapBranded(
      makeEffectId(requireString(row, 'effect_id', 'effects')),
      'effects.effect_id',
    ),
    workItemId: requireString(row, 'work_item_id', 'effects'),
    intentRecordedAt: requireString(row, 'intent_recorded_at', 'effects'),
    outcome: outcomeRaw as EffectRow['outcome'],
    observedAt: optionalString(row, 'observed_at', 'effects'),
  };
}

export function decodeArtifactRow(row: Row): ArtifactRow {
  return {
    artifactId: requireString(row, 'artifact_id', 'artifacts'),
    workItemId: requireString(row, 'work_item_id', 'artifacts'),
    relativePath: requireString(row, 'relative_path', 'artifacts'),
    provenanceJson: requireString(row, 'provenance_json', 'artifacts'),
    byteSize: optionalInteger(row, 'byte_size', 'artifacts'),
    digestSha256: optionalString(row, 'digest_sha256', 'artifacts'),
    recordedAt: requireString(row, 'recorded_at', 'artifacts'),
  };
}

export function decodeBudgetEntryRow(row: Row): BudgetEntryRow {
  const domain = requireString(row, 'domain', 'budget_entries');
  if (domain !== 'discovery' && domain !== 'transfer' && domain !== 'global_safety') {
    throw new PersistenceError('MALFORMED_LEDGER_ROW', `unknown budget domain '${domain}'`, {
      path: 'budget_entries.domain',
    });
  }
  const kind = requireString(row, 'entry_kind', 'budget_entries');
  if (kind !== 'RESERVATION' && kind !== 'CONSUMPTION' && kind !== 'RESERVATION_RELEASE') {
    throw new PersistenceError('MALFORMED_LEDGER_ROW', `unknown budget entry kind '${kind}'`, {
      path: 'budget_entries.entry_kind',
    });
  }
  const amount = optionalInteger(row, 'amount', 'budget_entries');
  if (amount === undefined || amount < 0) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      'budget_entries.amount must be a non-negative integer',
      { path: 'budget_entries.amount' },
    );
  }
  return {
    entryId: requireString(row, 'entry_id', 'budget_entries'),
    workItemId: requireString(row, 'work_item_id', 'budget_entries'),
    domain,
    limitKey: requireString(row, 'limit_key', 'budget_entries'),
    kind,
    amount,
    convergenceKey: optionalString(row, 'convergence_key', 'budget_entries'),
    recordedAt: requireString(row, 'recorded_at', 'budget_entries'),
  };
}

/**
 * Read the durable transition-order fact stream for a lineage. The sequence
 * must be exactly 1..n in order (frozen L2 §11.1: recovery reads this
 * durable order and never reconstructs it from timestamps/arrival); any
 * non-monotonic stream fails closed.
 */
export function decodeFactStream(rows: readonly Row[], context: string): readonly TransitionFact[] {
  const facts: TransitionFact[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const seq = optionalInteger(row, 'fact_seq', 'transition_facts');
    if (seq === undefined || seq !== index + 1) {
      throw new PersistenceError(
        'NON_MONOTONIC_FACT_ORDER',
        `transition fact stream for '${context}' is non-monotonic at position ${index} (seq ${String(
          seq,
        )}); the durable order is unreadable and never guessed`,
        { path: 'transition_facts.fact_seq', invariant: 'L2-§11.1' },
      );
    }
    facts.push({
      workItemId: requireString(row, 'work_item_id', 'transition_facts'),
      seq,
      kind: decodeFactKind(requireString(row, 'fact_kind', 'transition_facts'), context),
      payloadJson: optionalString(row, 'fact_payload_json', 'transition_facts'),
      recordedAt: requireString(row, 'recorded_at', 'transition_facts'),
    });
  }
  return facts;
}
