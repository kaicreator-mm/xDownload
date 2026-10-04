/**
 * T005 authoritative lifecycle writer — exactly one writable path.
 *
 * Every lifecycle transition commits state + budget delta + transition-order
 * fact in ONE `BEGIN IMMEDIATE` transaction through this facade (frozen L2
 * §6.3, §10; L2 invariant 7). Surfaces/adapters never open their own write
 * path; the connection-level single-writer registry rejects a second one.
 *
 * Ordering rule for external effects: bytes are written to the filesystem
 * BEFORE the durable record commits, so a DB row never claims bytes that
 * were never written. Death between the two leaves filesystem-first truth,
 * which recovery classifies truthfully (frozen L2 §11: a DB commit proves no
 * external effect and vice versa).
 *
 * Cancellation cutoff (ADR-013 / L2 §11.1 / invariant 20): acceptance is
 * refused when the durable `USER_CANCELLED` fact is later in the order than
 * the last `EXPLICIT_RETRY_RESUME` fact. Acceptance committed before
 * cancellation is never revoked.
 *
 * Durability truth: this writer provides recoverable at-least-once external
 * effects with idempotent acceptance — never exactly-once execution and no
 * host-power-loss durability (see DURABILITY_CLAIM).
 */

import {
  decodeBudgetProfile,
  makeAuthorizationContextRef,
  makeContractId,
  makeEffectId,
  makeMemberId,
  makeSnapshotId,
  rejectRawSecretFields,
} from '@xdownload/domain-contracts';
import {
  sha256Hex,
  type FilesystemArtifactObservation,
  type FilesystemArtifactStore,
} from './artifact-store.ts';
import type { LedgerConnection } from './connection.ts';
import { PersistenceError } from './errors.ts';
import { isKnownBudgetLimitKey, LedgerReader } from './reader.ts';
import {
  LIFECYCLE_STATE_RANK,
  unwrapBranded,
  type LifecycleState,
  type TransitionFact,
} from './rows.ts';

export interface BudgetContribution {
  readonly domain: 'discovery' | 'transfer' | 'global_safety';
  readonly limitKey: string;
  readonly amount: number;
  readonly convergenceKey: string;
}

export interface SubmitAcquisitionInput {
  readonly commandId: string;
  readonly commandKind: string;
  readonly workItemId: string;
  readonly contractId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly effectId: string;
  /** Opaque authorization reference; raw secret material is never accepted. */
  readonly authorizationContextRef: string;
  readonly budgetProfile: unknown;
  /** JSON-serializable provenance object binding the artifact to its source. */
  readonly artifactProvenance: Record<string, unknown>;
}

export interface SubmitAcquisitionOutcome {
  readonly workItemId: string;
  readonly effectId: string;
  readonly created: boolean;
  /** True when a duplicate submit converged onto the existing frozen lineage. */
  readonly converged: boolean;
}

export interface DispatchInput {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly reservations?: readonly BudgetContribution[];
}

export interface StageArtifactInput {
  readonly workItemId: string;
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly provenance: Record<string, unknown>;
  /** Budget consumption committed in the same transaction as the FS fact. */
  readonly consumption?: BudgetContribution;
}

export interface StageArtifactOutcome {
  readonly reused: boolean;
  readonly digest: string;
  readonly byteSize: number;
}

export interface AcceptanceValidation {
  readonly passed: boolean;
  readonly passedCount: number;
  readonly failedCount: number;
}

export interface AcceptArtifactInput {
  readonly workItemId: string;
  readonly artifactId: string;
  readonly validation: AcceptanceValidation;
}

export interface AcceptArtifactOutcome {
  readonly alreadyAccepted: boolean;
  readonly workItemId: string;
  readonly artifactId: string;
}

export interface LifecycleWriterOutcome {
  readonly alreadyApplied: boolean;
}

const PROVENANCE_MAX_BYTES = 4096;

function nowIso(): string {
  // Timestamps are informational provenance only; the durable ORDER among
  // transitions is fact_seq, never wall-clock time (frozen L2 §11.1).
  return new Date().toISOString();
}

function validateProvenancePayload(provenance: Record<string, unknown>, context: string): string {
  const secretCheck = rejectRawSecretFields(provenance, context);
  if (!secretCheck.ok) {
    throw new PersistenceError(
      'RAW_SECRET_REJECTED',
      `raw reusable secret material is rejected as ordinary persisted state: ${secretCheck.diagnostics
        .map((diagnosticItem) => diagnosticItem.path)
        .join(', ')}`,
      { path: context, invariant: 'L2-inv12' },
    );
  }
  let json: string;
  try {
    json = JSON.stringify(provenance) as string;
  } catch (error) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `${context} is not JSON-serializable`,
      { path: context },
      error,
    );
  }
  if (json.length > PROVENANCE_MAX_BYTES) {
    throw new PersistenceError(
      'MALFORMED_LEDGER_ROW',
      `${context} exceeds the ${PROVENANCE_MAX_BYTES}-byte provenance budget`,
      { path: context },
    );
  }
  return json;
}

function validatedBudgetContribution(entry: BudgetContribution): BudgetContribution {
  if (!Number.isInteger(entry.amount) || entry.amount < 0) {
    throw new PersistenceError(
      'BUDGET_LEDGER_VIOLATION',
      `budget amount must be a non-negative integer, got ${String(entry.amount)}`,
      { path: 'budget_entries.amount' },
    );
  }
  if (!isKnownBudgetLimitKey(entry.domain, entry.limitKey)) {
    throw new PersistenceError(
      'BUDGET_LEDGER_VIOLATION',
      `unknown budget limit key '${entry.limitKey}' for domain '${entry.domain}'`,
      { path: 'budget_entries.limit_key' },
    );
  }
  return entry;
}

/**
 * The single authoritative writer. It is the only object in the package
 * that mutates durable state; readers observe, never write.
 */
export class AuthoritativeLedgerWriter {
  readonly reader: LedgerReader;
  private readonly connection: LedgerConnection;
  private readonly store: FilesystemArtifactStore;

  constructor(connection: LedgerConnection, store: FilesystemArtifactStore) {
    this.connection = connection;
    this.store = store;
    this.reader = new LedgerReader(connection.database);
  }

  close(): void {
    this.connection.close();
  }

  /**
   * Register a command/work/effect lineage. Duplicate submits — including
   * from independent duplicate clients — converge onto the one frozen
   * lineage (same snapshot+member+effect identity); a conflicting re-use of
   * any durable identity is a typed rejection, never a second lineage.
   */
  submitAcquisition(input: SubmitAcquisitionInput): SubmitAcquisitionOutcome {
    const contractId = unwrapBranded(makeContractId(input.contractId), 'contractId');
    const snapshotId = unwrapBranded(makeSnapshotId(input.snapshotId), 'snapshotId');
    const memberId = unwrapBranded(makeMemberId(input.memberId), 'memberId');
    const effectId = unwrapBranded(makeEffectId(input.effectId), 'effectId');
    const authorizationRef = unwrapBranded(
      makeAuthorizationContextRef(input.authorizationContextRef),
      'authorizationContextRef',
    );
    const budgetProfile = decodeBudgetProfile(input.budgetProfile);
    if (!budgetProfile.ok) {
      throw new PersistenceError(
        'MALFORMED_LEDGER_ROW',
        `budget profile fails canonical decode: ${budgetProfile.diagnostics
          .map((diagnosticItem) => `${diagnosticItem.code}:${diagnosticItem.path}`)
          .join(', ')}`,
        { path: 'work_items.budget_profile_json' },
      );
    }
    const budgetProfileJson = JSON.stringify(budgetProfile.value) as string;
    // Early raw-secret screening of the intended artifact provenance; the
    // payload is re-validated (and persisted) at staging time.
    validateProvenancePayload(input.artifactProvenance, 'artifactProvenance');

    return this.connection.database.transaction(() => {
      const existingCommand = this.connection.database.queryGet(
        'SELECT work_item_id FROM commands WHERE command_id = ?',
        input.commandId,
      );
      if (existingCommand !== undefined) {
        throw new PersistenceError(
          'DUPLICATE_IDENTITY_CONFLICT',
          `command '${input.commandId}' is already durably recorded`,
          { path: 'commands.command_id' },
        );
      }
      const existingByLineage = this.connection.database.queryGet(
        'SELECT * FROM work_items WHERE snapshot_id = ? AND member_id = ?',
        snapshotId,
        memberId,
      );
      const existingByEffect = this.connection.database.queryGet(
        'SELECT * FROM work_items WHERE effect_id = ?',
        effectId,
      );
      const existing = existingByLineage ?? existingByEffect;
      if (existing !== undefined) {
        const sameLineage =
          existing['snapshot_id'] === snapshotId &&
          existing['member_id'] === memberId &&
          existing['effect_id'] === effectId;
        if (!sameLineage) {
          throw new PersistenceError(
            'DUPLICATE_IDENTITY_CONFLICT',
            `duplicate submit conflicts with the frozen lineage (work item '${String(
              existing['work_item_id'],
            )}')`,
            { invariant: 'duplicate-convergence' },
          );
        }
        // Record the duplicate command against the SAME lineage (multiple
        // clients converge); one effect, one lineage, never a second one.
        this.connection.database.runStmt(
          'INSERT INTO commands (command_id, work_item_id, command_kind, recorded_at) VALUES (?, ?, ?, ?)',
          input.commandId,
          String(existing['work_item_id']),
          input.commandKind,
          nowIso(),
        );
        return {
          workItemId: String(existing['work_item_id']),
          effectId,
          created: false,
          converged: true,
        };
      }

      this.connection.database.runStmt(
        `INSERT INTO work_items
          (work_item_id, contract_id, snapshot_id, member_id, effect_id, lifecycle_state,
           authorization_context_ref, budget_profile_json, created_at)
        VALUES (?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?)`,
        input.workItemId,
        contractId,
        snapshotId,
        memberId,
        effectId,
        authorizationRef,
        budgetProfileJson,
        nowIso(),
      );
      this.connection.database.runStmt(
        'INSERT INTO commands (command_id, work_item_id, command_kind, recorded_at) VALUES (?, ?, ?, ?)',
        input.commandId,
        input.workItemId,
        input.commandKind,
        nowIso(),
      );
      this.connection.database.runStmt(
        'INSERT INTO effects (effect_id, work_item_id, intent_recorded_at) VALUES (?, ?, ?)',
        effectId,
        input.workItemId,
        nowIso(),
      );
      return {
        workItemId: input.workItemId,
        effectId,
        created: true,
        converged: false,
      };
    });
  }

  /**
   * Record the durable dispatch intent (with transactional budget
   * reservations). Idempotent: a re-dispatch of the same lineage is a no-op,
   * never a duplicate external-effect intent. Dispatch is refused while a
   * durable `USER_CANCELLED` fact is authoritative for the lineage
   * (ADR-013: new dispatch is suppressed; only explicit retry/resume may
   * reopen processing).
   */
  dispatch(input: DispatchInput): LifecycleWriterOutcome {
    return this.connection.database.transaction(() => {
      this.reader.requireWorkItem(input.workItemId);
      for (const reservation of input.reservations ?? []) {
        validatedBudgetContribution(reservation);
      }
      if (this.hasFact(input.workItemId, 'DISPATCH_INTENT')) {
        return { alreadyApplied: true };
      }
      if (this.cancellationAuthoritative(input.workItemId)) {
        throw new PersistenceError(
          'CANCELLATION_CUTOFF_BLOCKED',
          'durable USER_CANCELLED is authoritative; new dispatch is suppressed until an explicit retry/resume reopens the lineage (ADR-013)',
          { invariant: 'L2-inv20' },
        );
      }
      this.appendFact(input.workItemId, 'DISPATCH_INTENT');
      const attemptNo = this.nextAttemptNo(input.workItemId);
      this.connection.database.runStmt(
        'INSERT INTO attempts (attempt_id, work_item_id, attempt_no, started_at) VALUES (?, ?, ?, ?)',
        input.attemptId,
        input.workItemId,
        attemptNo,
        nowIso(),
      );
      for (const reservation of input.reservations ?? []) {
        this.insertBudgetEntry(input.workItemId, 'RESERVATION', reservation);
      }
      return { alreadyApplied: false };
    });
  }

  /** Record an observed external-effect outcome (durable fact, idempotent). */
  recordExternalEffectObserved(workItemId: string): LifecycleWriterOutcome {
    return this.connection.database.transaction(() => {
      const effect = this.reader.effect(workItemId);
      if (effect === undefined) {
        throw new PersistenceError(
          'MALFORMED_LEDGER_ROW',
          `no durable effect intent exists for '${workItemId}'`,
          { path: 'effects' },
        );
      }
      if (effect.outcome === 'OBSERVED') {
        return { alreadyApplied: true };
      }
      this.connection.database.runStmt(
        'UPDATE effects SET outcome = ?, observed_at = ? WHERE effect_id = ?',
        'OBSERVED',
        nowIso(),
        effect.effectId,
      );
      this.appendFact(workItemId, 'EXTERNAL_EFFECT_OBSERVED');
      return { alreadyApplied: false };
    });
  }

  /**
   * Stage artifact bytes: filesystem write first, then one transaction
   * committing the artifact record + FS_STAGED fact + optional budget
   * consumption. Identical re-submission reuses the existing staged bytes
   * without a new external effect; conflicting bytes are a typed rejection
   * and never silently re-stage over the record (TEST_MATRIX R07).
   */
  stageArtifact(input: StageArtifactInput): StageArtifactOutcome {
    const existing = this.reader.artifact(input.workItemId, input.artifactId);
    if (existing !== undefined) {
      const digest = sha256Hex(input.bytes);
      const observation = this.store.observe(input.artifactId);
      if (existing.digestSha256 === digest && observation.phase !== 'ABSENT') {
        return { reused: true, digest, byteSize: input.bytes.length };
      }
      throw new PersistenceError(
        'ARTIFACT_CONFLICT',
        `artifact '${input.artifactId}' already exists with different bytes; conflicting bytes are never silently re-staged`,
        { path: 'artifacts.digest_sha256', invariant: 'digest-binding' },
      );
    }
    if (input.consumption !== undefined) {
      validatedBudgetContribution(input.consumption);
      this.assertBudgetHeadroom(input.workItemId, input.consumption);
    }
    // All validation happens BEFORE the external filesystem effect: a raw
    // secret or an over-budget consumption never leaves bytes behind.
    const provenanceJson = validateProvenancePayload(input.provenance, 'provenance');
    const staged = this.store.stageBytes(input.artifactId, input.bytes);
    this.connection.database.transaction(() => {
      this.connection.database.runStmt(
        `INSERT INTO artifacts
          (artifact_id, work_item_id, relative_path, provenance_json, byte_size, digest_sha256, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.artifactId,
        input.workItemId,
        `final/${input.artifactId}.bin`,
        provenanceJson,
        staged.byteSize,
        staged.digest,
        nowIso(),
      );
      if (input.consumption !== undefined) {
        this.insertBudgetEntry(input.workItemId, 'CONSUMPTION', input.consumption);
      }
      this.advanceLifecycleState(input.workItemId, 'STAGED');
      this.appendFact(input.workItemId, 'FS_STAGED', { artifactId: input.artifactId });
    });
    return { reused: false, digest: staged.digest, byteSize: staged.byteSize };
  }

  /** Promote staged bytes to materialized (FS rename, then durable fact). */
  materializeArtifact(workItemId: string, artifactId: string): LifecycleWriterOutcome {
    this.requireArtifact(workItemId, artifactId);
    this.store.materialize(artifactId);
    this.connection.database.transaction(() => {
      this.advanceLifecycleState(workItemId, 'MATERIALIZED');
      this.appendFact(workItemId, 'FS_MATERIALIZED', { artifactId });
    });
    return { alreadyApplied: false };
  }

  /**
   * Finalize materialized bytes: digest verified against the recorded
   * binding before the durable FS_FINALIZED fact commits. A mismatch is a
   * typed rejection; the database stays untouched and the corrupt bytes are
   * preserved for truthful classification (never overwritten, never success).
   */
  finalizeArtifact(workItemId: string, artifactId: string): LifecycleWriterOutcome {
    const artifact = this.requireArtifact(workItemId, artifactId);
    if (artifact.digestSha256 === undefined) {
      throw new PersistenceError(
        'ACCEPTANCE_INVALID',
        'artifact record has no digest binding; finalize is refused',
        { invariant: 'digest-binding' },
      );
    }
    this.store.finalize(artifactId, artifact.digestSha256);
    this.connection.database.transaction(() => {
      this.advanceLifecycleState(workItemId, 'FINALIZED');
      this.appendFact(workItemId, 'FS_FINALIZED', { artifactId });
    });
    return { alreadyApplied: false };
  }

  /**
   * Idempotent acceptance. Requires, in durable order: FINALIZED state, a
   * digest-bound artifact record, bytes physically present at the final
   * location whose recomputed digest matches the binding, passing
   * validation, and no authoritative cancellation after the last explicit
   * retry/resume. Anything else is a typed rejection — missing, corrupt or
   * unmaterialized bytes can never become success (frozen L2 invariants
   * 9/10/18/20).
   */
  acceptArtifact(input: AcceptArtifactInput): AcceptArtifactOutcome {
    return this.connection.database.transaction(() => {
      const workItem = this.reader.requireWorkItem(input.workItemId);
      if (workItem.lifecycleState === 'ACCEPTED') {
        return {
          alreadyAccepted: true,
          workItemId: input.workItemId,
          artifactId: input.artifactId,
        };
      }
      const artifact = this.requireArtifact(input.workItemId, input.artifactId);
      if (workItem.lifecycleState !== 'FINALIZED') {
        throw new PersistenceError(
          'ACCEPTANCE_INVALID',
          `acceptance requires a FINALIZED lineage, got '${workItem.lifecycleState}'`,
          { invariant: 'ADR-004' },
        );
      }
      if (artifact.digestSha256 === undefined || artifact.byteSize === undefined) {
        throw new PersistenceError(
          'ACCEPTANCE_INVALID',
          'accepted state without a digest-bound artifact record is forbidden',
          { invariant: 'L2-inv9' },
        );
      }
      const observation: FilesystemArtifactObservation = this.store.observe(input.artifactId);
      if (observation.phase !== 'FINALIZED') {
        throw new PersistenceError(
          'ACCEPTANCE_INVALID',
          `acceptance requires finalized bytes, filesystem phase is '${observation.phase}'`,
          { invariant: 'L2-inv10' },
        );
      }
      if (observation.observedDigest !== artifact.digestSha256) {
        throw new PersistenceError(
          'PROVENANCE_DIGEST_MISMATCH',
          'bytes at the final location do not match the durable digest binding',
          { invariant: 'digest-binding' },
        );
      }
      if (!input.validation.passed) {
        throw new PersistenceError(
          'ACCEPTANCE_INVALID',
          'validation did not pass; transfer alone never makes an artifact accepted',
          { invariant: 'L2-inv18' },
        );
      }
      if (this.cancellationAuthoritative(input.workItemId)) {
        throw new PersistenceError(
          'CANCELLATION_CUTOFF_BLOCKED',
          'durable USER_CANCELLED precedes durable acceptance; automatic acceptance is forbidden (ADR-013 cutoff)',
          { invariant: 'L2-inv20' },
        );
      }
      this.appendFact(input.workItemId, 'VALIDATION_PASSED', {
        validationSummary: {
          passed: input.validation.passed,
          passedCount: input.validation.passedCount,
          failedCount: input.validation.failedCount,
        },
      });
      this.advanceLifecycleState(input.workItemId, 'ACCEPTED');
      this.appendFact(input.workItemId, 'ACCEPTED', { artifactId: input.artifactId });
      return { alreadyAccepted: false, workItemId: input.workItemId, artifactId: input.artifactId };
    });
  }

  /**
   * Durable `USER_CANCELLED`. Cancellation never revokes an acceptance
   * committed earlier, never replenishes budgets, and — before dispatch —
   * releases still-open reservations according to the durable dispatch
   * facts (L2 §11.1 cancel timing matrix). Idempotent.
   */
  cancel(workItemId: string): LifecycleWriterOutcome {
    return this.connection.database.transaction(() => {
      this.reader.requireWorkItem(workItemId);
      if (this.hasFact(workItemId, 'USER_CANCELLED')) {
        return { alreadyApplied: true };
      }
      this.appendFact(workItemId, 'USER_CANCELLED');
      if (!this.hasFact(workItemId, 'DISPATCH_INTENT')) {
        const entries = this.reader.budgetEntries(workItemId);
        for (const entry of entries) {
          if (entry.kind !== 'RESERVATION') {
            continue;
          }
          const releaseKey = `release:${entry.entryId}`;
          const alreadyReleased = entries.some(
            (candidate) =>
              candidate.kind === 'RESERVATION_RELEASE' && candidate.convergenceKey === releaseKey,
          );
          if (alreadyReleased) {
            continue;
          }
          this.insertBudgetEntry(workItemId, 'RESERVATION_RELEASE', {
            domain: entry.domain,
            limitKey: entry.limitKey,
            amount: entry.amount,
            convergenceKey: releaseKey,
          });
        }
      }
      return { alreadyApplied: false };
    });
  }

  /**
   * Explicit retry/resume (never automatic recovery): reopens processing on
   * the SAME frozen lineage and inherits remaining budgets unchanged. After
   * this durable fact, the acceptance cutoff is recomputed from the order —
   * a cancellation earlier than this fact no longer blocks acceptance.
   */
  explicitRetryResume(workItemId: string, retryCommandId: string): LifecycleWriterOutcome {
    return this.connection.database.transaction(() => {
      this.reader.requireWorkItem(workItemId);
      this.appendFact(workItemId, 'EXPLICIT_RETRY_RESUME', { commandId: retryCommandId });
      const attemptNo = this.nextAttemptNo(workItemId);
      this.connection.database.runStmt(
        'INSERT INTO attempts (attempt_id, work_item_id, attempt_no, started_at) VALUES (?, ?, ?, ?)',
        `retry:${retryCommandId}`,
        workItemId,
        attemptNo,
        nowIso(),
      );
      return { alreadyApplied: false };
    });
  }

  /** Durable explicit terminal failure fact (truthful failure vocabulary). */
  recordTerminalFailure(workItemId: string, reason: string): LifecycleWriterOutcome {
    return this.connection.database.transaction(() => {
      this.reader.requireWorkItem(workItemId);
      if (this.hasFact(workItemId, 'TERMINAL_FAILURE')) {
        return { alreadyApplied: true };
      }
      this.appendFact(workItemId, 'TERMINAL_FAILURE', { reason });
      return { alreadyApplied: false };
    });
  }

  /**
   * Budget consumption with idempotent convergence key. A repeated
   * consumption key never double-charges; exceeding durable remaining is a
   * typed rejection with no charge (no replenishment, no double consumption).
   */
  consumeBudget(input: BudgetContribution & { readonly workItemId: string }): {
    readonly alreadyConsumed: boolean;
  } {
    return this.connection.database.transaction(() => {
      const validated = validatedBudgetContribution(input);
      const existing = this.reader
        .budgetEntries(input.workItemId)
        .find((entry) => entry.convergenceKey === validated.convergenceKey);
      if (existing !== undefined) {
        return { alreadyConsumed: true };
      }
      this.assertBudgetHeadroom(input.workItemId, validated);
      this.insertBudgetEntry(input.workItemId, 'CONSUMPTION', validated);
      return { alreadyConsumed: false };
    });
  }

  reserveBudget(input: BudgetContribution & { readonly workItemId: string }): {
    readonly alreadyReserved: boolean;
  } {
    return this.connection.database.transaction(() => {
      const validated = validatedBudgetContribution(input);
      const existing = this.reader
        .budgetEntries(input.workItemId)
        .find((entry) => entry.convergenceKey === validated.convergenceKey);
      if (existing !== undefined) {
        return { alreadyReserved: true };
      }
      this.insertBudgetEntry(input.workItemId, 'RESERVATION', validated);
      return { alreadyReserved: false };
    });
  }

  /**
   * ADR-013 cutoff query over the durable order: true when the latest
   * `USER_CANCELLED` fact is later than the latest `EXPLICIT_RETRY_RESUME`
   * fact (a cancellation with no retry/resume is authoritative).
   */
  cancellationAuthoritative(workItemId: string): boolean {
    const facts = this.reader.facts(workItemId);
    let lastCancel = -1;
    let lastRetry = -1;
    for (const fact of facts) {
      if (fact.kind === 'USER_CANCELLED') {
        lastCancel = fact.seq;
      }
      if (fact.kind === 'EXPLICIT_RETRY_RESUME') {
        lastRetry = fact.seq;
      }
    }
    return lastCancel > lastRetry;
  }

  private assertBudgetHeadroom(workItemId: string, contribution: BudgetContribution): void {
    const remaining = this.reader.budgetRemaining(workItemId);
    // Canonical budget domains use 'global_safety'; the remaining projection
    // key is 'globalSafety'.
    const remainingKey =
      contribution.domain === 'global_safety' ? 'globalSafety' : contribution.domain;
    const domain = remaining[remainingKey];
    const left = domain.perLimit[contribution.limitKey];
    if (left !== undefined && contribution.amount > left) {
      throw new PersistenceError(
        'BUDGET_LEDGER_VIOLATION',
        `budget '${contribution.domain}.${contribution.limitKey}' has ${String(
          left,
        )} remaining; consuming ${String(contribution.amount)} is refused (no replenishment)`,
        { path: 'budget_entries', invariant: 'PRD-§15.4' },
      );
    }
  }

  private insertBudgetEntry(
    workItemId: string,
    kind: 'RESERVATION' | 'CONSUMPTION' | 'RESERVATION_RELEASE',
    entry: BudgetContribution,
  ): void {
    this.connection.database.runStmt(
      `INSERT INTO budget_entries
        (entry_id, work_item_id, domain, limit_key, entry_kind, amount, convergence_key, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `${kind}:${entry.convergenceKey}`,
      workItemId,
      entry.domain,
      entry.limitKey,
      kind,
      entry.amount,
      entry.convergenceKey,
      nowIso(),
    );
  }

  private requireArtifact(workItemId: string, artifactId: string) {
    const artifact = this.reader.artifact(workItemId, artifactId);
    if (artifact === undefined) {
      throw new PersistenceError(
        'MALFORMED_LEDGER_ROW',
        `artifact '${artifactId}' is not present for work item '${workItemId}'`,
        { path: 'artifacts' },
      );
    }
    return artifact;
  }

  private hasFact(workItemId: string, kind: TransitionFact['kind']): boolean {
    return this.reader.facts(workItemId).some((fact) => fact.kind === kind);
  }

  private nextFactSeq(workItemId: string): number {
    const facts = this.reader.facts(workItemId);
    const last = facts[facts.length - 1];
    return (last?.seq ?? 0) + 1;
  }

  private nextAttemptNo(workItemId: string): number {
    const row = this.connection.database.queryGet(
      'SELECT MAX(attempt_no) AS max_no FROM attempts WHERE work_item_id = ?',
      workItemId,
    );
    const value = row?.['max_no'];
    return typeof value === 'number' ? value + 1 : 1;
  }

  private advanceLifecycleState(workItemId: string, next: LifecycleState): void {
    const workItem = this.reader.requireWorkItem(workItemId);
    const currentRank = LIFECYCLE_STATE_RANK[workItem.lifecycleState];
    const nextRank = LIFECYCLE_STATE_RANK[next];
    if (nextRank <= currentRank) {
      throw new PersistenceError(
        'INVALID_TRANSITION',
        `lifecycle transition '${workItem.lifecycleState}' -> '${next}' is not an advance; states never collapse silently`,
        { invariant: 'ADR-004' },
      );
    }
    this.connection.database.runStmt(
      'UPDATE work_items SET lifecycle_state = ? WHERE work_item_id = ?',
      next,
      workItemId,
    );
  }

  private appendFact(
    workItemId: string,
    kind: TransitionFact['kind'],
    payload?: Record<string, unknown>,
  ): void {
    this.connection.database.runStmt(
      'INSERT INTO transition_facts (work_item_id, fact_seq, fact_kind, fact_payload_json, recorded_at) VALUES (?, ?, ?, ?, ?)',
      workItemId,
      this.nextFactSeq(workItemId),
      kind,
      payload === undefined ? null : (JSON.stringify(payload) as string),
      nowIso(),
    );
  }
}
