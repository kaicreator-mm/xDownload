/**
 * T006 Core scheduler — the single authoritative scheduling/control entry
 * point (frozen L2 invariants 1/2/7/8/20, ADR-010/013; PRD §15.4, CJ-06).
 *
 * Surfaces and adapters submit commands here; they never own lifecycle truth.
 * Every decision derives from the committed durable control facts at call
 * time, so duplicate clients (Desktop UI, CLI, restart) serialize through one
 * durable total order and converge by identity — no leases, no distributed
 * claims, no in-memory authority.
 *
 * The durable-control-facts seam (`DurableControlFactLog`) is injectable:
 * T006 proves semantics against the deterministic in-memory log; T005/T015
 * implement the same seam with real storage without semantic reinterpretation.
 */

import {
  decodeBudgetProfile,
  makeAuthorizationContextRef,
  makeContractId,
  makeEvidenceId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  type BudgetProfile,
  type ContractId,
  type MemberId,
} from '@xdownload/domain-contracts';
import {
  canonicalEffectId,
  lineageKeyOf,
  validateLineageKeyFormat,
  type BudgetAmounts,
  type CancelSource,
  type CommitSequence,
  type DurableControlFact,
  type EffectOutcome,
  type LineageBinding,
  type LineageKey,
  type ReconciliationObservationKind,
  type UncommittedControlFact,
} from './facts.ts';
import {
  BudgetLedger,
  type BudgetAction,
  type BudgetStopProjection,
  type ConsumptionRecord,
  type DispatchGrant,
} from './budgets.ts';
import {
  controlTransition,
  cutoffDecisionFor,
  effectiveCancellation,
  reduceOneLineage,
  type ControlEventType,
  type LineageView,
} from './machine.ts';
import type { CutoffDecision } from './cutoff.ts';
import { InMemoryControlFactLog, type DurableControlFactLog } from './store.ts';
import { controlOk, controlReject, type ControlResult } from './rejections.ts';

/** Raw submit input; canonical identities are decoded fail-closed at this seam. */
export interface LineageSubmitInput {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly targetId: string;
  readonly authorizationContextRef: string;
  /** Frozen member identities of the selection snapshot (retry domain). */
  readonly frozenMemberIds?: readonly string[];
  /** Raw budget profile; decoded through the T002 validator. */
  readonly budgetProfile: unknown;
  /** When present, must equal the Core-derived canonical effect id (fork detection). */
  readonly requestedEffectId?: string;
}

export interface LineageSubmission {
  readonly lineageKey: LineageKey;
  readonly binding: LineageBinding;
  readonly effectId: string;
  /** True when a duplicate submit converged onto the already-registered lineage. */
  readonly converged: boolean;
}

export interface CancelOutcome {
  readonly lineageKey: LineageKey;
  readonly sequence: CommitSequence;
  /** True when cancellation authority already existed (duplicate cancel is idempotent). */
  readonly alreadyAuthoritative: boolean;
  readonly resultingState: 'CANCELLED_SUPPRESSED' | 'ACCEPTED';
}

export interface AcceptanceOutcome {
  readonly lineageKey: LineageKey;
  readonly effectId: string;
  readonly sequence: CommitSequence;
  /** True when the lineage was already durably accepted (duplicate accept converges). */
  readonly previouslyAccepted: boolean;
}

export interface AttemptRecord {
  readonly lineageKey: LineageKey;
  readonly attemptId: string;
  readonly sequence: CommitSequence;
  /** True when this attempt id was already recorded (at-least-once replay reconciles). */
  readonly replayed: boolean;
}

export interface OutcomeRecord {
  readonly lineageKey: LineageKey;
  readonly attemptId: string;
  readonly outcome: EffectOutcome;
  readonly sequence: CommitSequence;
  /** True when the first recording for this attempt already existed and matched. */
  readonly reconciled: boolean;
}

export interface ResumeRequest {
  /** Authorizing identity: only an explicit authorized control transition resumes. */
  readonly authorizedBy: string;
  readonly reason: 'RETRY' | 'RESUME';
  /** Optional member subset to retry; must be a subset of the frozen member identities. */
  readonly memberScope?: readonly string[];
  /** Staged-byte reuse requires ordinary validation evidence (never reused unvalidated). */
  readonly reuseStagedBytes?: {
    readonly stagedByteRef: string;
    readonly validationEvidenceId: string;
  };
}

export interface ResumeOutcome {
  readonly lineageKey: LineageKey;
  readonly sequence: CommitSequence;
  /** Remaining budgets inherited unchanged — never reset or replenished. */
  readonly inheritedRemaining: ReturnType<BudgetLedger['remaining']>;
  readonly reusedStagedBytes: boolean;
}

export interface ReconciliationOutcome {
  readonly lineageKey: LineageKey;
  readonly sequence: CommitSequence;
  /** Reconciliation never changes the control state and never reopens acceptance. */
  readonly stateAfter: LineageView['state'];
  readonly cutoff: CutoffDecision;
}

function idOrReject<T>(
  raw: string | undefined,
  make: (
    value: string,
  ) =>
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly diagnostics: readonly unknown[] },
): ControlResult<T> {
  if (raw === undefined) {
    return controlReject('MALFORMED_CONTROL_FACT', 'required canonical identity is missing');
  }
  const decoded = make(raw);
  if (!decoded.ok) {
    return controlReject(
      'MALFORMED_CONTROL_FACT',
      'control transition consumes only T002-validated canonical identities (decode failed)',
      JSON.stringify(decoded.diagnostics),
    );
  }
  return controlOk(decoded.value);
}

/**
 * The Core-owned scheduler. Cheap to construct; derive per call or keep one
 * per process — correctness never depends on in-memory state, only on the
 * durable fact log.
 */
export class CoreScheduler {
  readonly #log: DurableControlFactLog;

  constructor(log: DurableControlFactLog) {
    this.#log = log;
  }

  static overEmptyLog(): CoreScheduler {
    return new CoreScheduler(InMemoryControlFactLog.empty());
  }

  /** Reopen after simulated process death from a serialized fact snapshot. */
  static reopenFromJson(json: string): ControlResult<CoreScheduler> {
    const reopened = InMemoryControlFactLog.reopenFromJson(json);
    if (!reopened.ok) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'reopening from a serialized fact log failed T002-grade validation',
        JSON.stringify(reopened.diagnostics),
      );
    }
    return controlOk(new CoreScheduler(reopened.value));
  }

  log(): DurableControlFactLog {
    return this.#log;
  }

  // ---------------------------------------------------------------- lineage

  submitLineage(input: LineageSubmitInput): ControlResult<LineageSubmission> {
    const contractId = idOrReject(input.contractId, makeContractId);
    if (!contractId.ok) return contractId;
    const snapshotId = idOrReject(input.snapshotId, makeSnapshotId);
    if (!snapshotId.ok) return snapshotId;
    const targetId = idOrReject(input.targetId, makeLogicalTargetId);
    if (!targetId.ok) return targetId;
    const authRef = idOrReject(input.authorizationContextRef, makeAuthorizationContextRef);
    if (!authRef.ok) return authRef;
    const profile = decodeProfileOrReject(input.budgetProfile);
    if (!profile.ok) return profile;
    const members: MemberId[] = [];
    for (const raw of input.frozenMemberIds ?? []) {
      const member = idOrReject(raw, makeMemberId);
      if (!member.ok) return member;
      members.push(member.value);
    }
    if (new Set(members).size !== members.length) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'frozen member identity set contains duplicates',
      );
    }
    const effect = canonicalEffectId(contractId.value, snapshotId.value, targetId.value);
    if (!effect.ok) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'canonical effect identity derivation failed',
        JSON.stringify(effect.diagnostics),
      );
    }
    if (input.requestedEffectId !== undefined && input.requestedEffectId !== effect.value) {
      return controlReject(
        'LINEAGE_FORK_REJECTED',
        'submitting the same logical work with a different effect identity would fork a second acquisition; duplicates converge by derived identity',
        `requested=${input.requestedEffectId} canonical=${effect.value}`,
      );
    }
    const binding: LineageBinding = {
      contractId: contractId.value,
      snapshotId: snapshotId.value,
      targetId: targetId.value,
      effectId: effect.value,
      authorizationContextRef: authRef.value,
    };
    const lineageKey = lineageKeyOf(binding);
    // The contract budget profile is durable and singular: a divergent
    // profile implies replenishment and is rejected before any convergence.
    const profileGuard = this.#assertContractProfile(binding.contractId, profile.value);
    if (!profileGuard.ok) return profileGuard;
    const existing = this.#view(lineageKey);
    if (existing !== undefined) {
      // Duplicate submit converges onto the durable lineage and its durable
      // budget profile — it never creates a second acquisition.
      return controlOk({
        lineageKey,
        binding: bindingOf(existing),
        effectId: binding.effectId,
        converged: true,
      });
    }
    const appended = this.#append({
      kind: 'lineageSubmitted',
      lineageKey,
      binding,
      frozenMemberIds: members,
      budgetProfile: profile.value,
    });
    if (!appended.ok) return appended;
    return controlOk({ lineageKey, binding, effectId: binding.effectId, converged: false });
  }

  // ----------------------------------------------------------- cancellation

  cancel(lineageKey: LineageKey, source: CancelSource): ControlResult<CancelOutcome> {
    const format = validateLineageKeyFormat(lineageKey);
    if (!format.ok) return format;
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    // Duplicate cancel converges whenever cancellation is the current
    // authority (a resume supersedes it, after which a new cancel commits).
    if (effectiveCancellation(view) !== undefined) {
      return controlOk({
        lineageKey,
        sequence: view.cancelledAt!,
        alreadyAuthoritative: true,
        resultingState: view.state === 'ACCEPTED' ? 'ACCEPTED' : 'CANCELLED_SUPPRESSED',
      });
    }
    const transition = requireTransition(view.state, 'CANCEL');
    if (!transition.ok) return transition;
    const appended = this.#append({
      kind: 'cancelAuthorityCommitted',
      lineageKey,
      stopReason: 'USER_CANCELLED',
      source,
    });
    if (!appended.ok) return appended;
    const after = this.#view(lineageKey)!;
    return controlOk({
      lineageKey,
      sequence: appended.value.sequence,
      alreadyAuthoritative: false,
      resultingState: after.state === 'ACCEPTED' ? 'ACCEPTED' : 'CANCELLED_SUPPRESSED',
    });
  }

  // ----------------------------------------------------------------- budget

  /**
   * Reserve budget for one generated action through the single authoritative
   * mutation path. Dispatch (including new discovery, transfer and retry
   * work) is gated by suppression state first, then by budget truth.
   */
  requestDispatch(lineageKey: LineageKey, action: BudgetAction): ControlResult<DispatchGrant> {
    const format = validateLineageKeyFormat(lineageKey);
    if (!format.ok) return format;
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const transition = requireTransition(view.state, 'DISPATCH');
    if (!transition.ok) return transition;
    const ledger = this.#ledger(bindingOf(view).contractId);
    if (!ledger.ok) return ledger;
    return ledger.value.reserve(lineageKey, action);
  }

  /** Record actual consumption for a reservation (single-use, serialized). */
  consume(grant: DispatchGrant, actual?: BudgetAmounts): ControlResult<ConsumptionRecord> {
    const contractId = idOrReject(grant.contractId, makeContractId);
    if (!contractId.ok) return contractId;
    const ledger = this.#ledger(contractId.value);
    if (!ledger.ok) return ledger;
    return ledger.value.consume(grant, actual);
  }

  /** Budget-truthful stop projection for the lineage's contract lifecycle. */
  projectBudgetStop(lineageKey: LineageKey): ControlResult<BudgetStopProjection> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const ledger = this.#ledger(bindingOf(view).contractId);
    if (!ledger.ok) return ledger;
    return controlOk(ledger.value.projectBudgetStop());
  }

  /** Remaining budgets for the lineage's contract lifecycle (inherited truth). */
  remainingBudgets(lineageKey: LineageKey): ControlResult<ReturnType<BudgetLedger['remaining']>> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const ledger = this.#ledger(bindingOf(view).contractId);
    if (!ledger.ok) return ledger;
    return controlOk(ledger.value.remaining());
  }

  /**
   * Restart guard: a candidate budget profile must equal the durably
   * registered profile (no replenishment on retry/restart/resume/repair).
   */
  assertCompatibleBudgetProfile(lineageKey: LineageKey, candidate: unknown): ControlResult<void> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const decoded = decodeProfileOrReject(candidate);
    if (!decoded.ok) return decoded;
    const ledger = this.#ledger(bindingOf(view).contractId);
    if (!ledger.ok) return ledger;
    return ledger.value.assertCompatibleProfile(decoded.value);
  }

  // ------------------------------------------------------ effects / lineage

  /** Start a durable effect attempt (at-least-once; replays reconcile by id). */
  startEffectAttempt(lineageKey: LineageKey, attemptId: string): ControlResult<AttemptRecord> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    if (view.attemptIds.includes(attemptId)) {
      return controlOk({
        lineageKey,
        attemptId,
        sequence: this.#sequenceOf(lineageKey, 'effectAttemptStarted', attemptId),
        replayed: true,
      });
    }
    const transition = requireTransition(view.state, 'START_ATTEMPT');
    if (!transition.ok) return transition;
    const appended = this.#append({
      kind: 'effectAttemptStarted',
      lineageKey,
      effectId: bindingOf(view).effectId,
      attemptId,
    });
    if (!appended.ok) return appended;
    return controlOk({ lineageKey, attemptId, sequence: appended.value.sequence, replayed: false });
  }

  /**
   * Record a truthful attempt outcome. The first recording wins and is never
   * rewritten; at-least-once replays with the same outcome reconcile to the
   * same durable fact.
   */
  recordEffectOutcome(
    lineageKey: LineageKey,
    attempt: {
      readonly attemptId: string;
      readonly outcome: EffectOutcome;
      readonly failureCategory?: string;
    },
  ): ControlResult<OutcomeRecord> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    if (!view.attemptIds.includes(attempt.attemptId)) {
      return controlReject(
        'MALFORMED_CONTROL_FACT',
        'outcome references an attempt that was never durably started; attempts are durable identities',
        attempt.attemptId,
      );
    }
    const recorded = view.outcomes.get(attempt.attemptId);
    if (recorded !== undefined) {
      if (recorded.outcome !== attempt.outcome) {
        return controlReject(
          'RESULT_FALSIFICATION_REJECTED',
          'a recorded effect outcome is durable truth and cannot be rewritten into a different outcome',
          `attempt=${attempt.attemptId} recorded=${recorded.outcome} proposed=${attempt.outcome}`,
        );
      }
      return controlOk({
        lineageKey,
        attemptId: attempt.attemptId,
        outcome: attempt.outcome,
        sequence: recorded.sequence,
        reconciled: true,
      });
    }
    const transition = requireTransition(view.state, 'RECORD_OUTCOME');
    if (!transition.ok) return transition;
    const appended = this.#append({
      kind: 'effectOutcomeRecorded',
      lineageKey,
      effectId: bindingOf(view).effectId,
      attemptId: attempt.attemptId,
      outcome: attempt.outcome,
      ...(attempt.failureCategory === undefined
        ? {}
        : { failureCategory: attempt.failureCategory }),
    });
    if (!appended.ok) return appended;
    return controlOk({
      lineageKey,
      attemptId: attempt.attemptId,
      outcome: attempt.outcome,
      sequence: appended.value.sequence,
      reconciled: false,
    });
  }

  /**
   * Attempt durable acceptance — the cutoff decision point.
   *
   * Order of gates (each fail-closed):
   * 1. state/cutoff legality (a lineage under authoritative cancellation
   *    rejects with `CANCELLATION_CUTOFF_VIOLATION` — automatic acceptance is
   *    blocked no matter how successful the bytes look);
   * 2. truthful-outcome guard: acceptance requires a recorded SUCCEEDED
   *    effect outcome; uncertain/failed work is never rewritten into success;
   * 3. duplicate acceptance converges to the same accepted identity.
   */
  tryAccept(lineageKey: LineageKey): ControlResult<AcceptanceOutcome> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    if (view.acceptedAt !== undefined) {
      return controlOk({
        lineageKey,
        effectId: bindingOf(view).effectId,
        sequence: view.acceptedAt,
        previouslyAccepted: true,
      });
    }
    const transition = requireTransition(view.state, 'ACCEPT');
    if (!transition.ok) return transition;
    if (view.succeededAt === undefined) {
      return controlReject(
        'RESULT_FALSIFICATION_REJECTED',
        'acceptance requires a durably recorded SUCCEEDED effect outcome; uncertain or failed work is never rewritten into success',
        lineageKey,
      );
    }
    const appended = this.#append({
      kind: 'acceptanceCommitted',
      lineageKey,
      effectId: bindingOf(view).effectId,
    });
    if (!appended.ok) return appended;
    return controlOk({
      lineageKey,
      effectId: bindingOf(view).effectId,
      sequence: appended.value.sequence,
      previouslyAccepted: false,
    });
  }

  /**
   * Explicit authorized retry/resume: the only transition that reopens
   * processing on a suppressed lineage. It operates on the same frozen
   * Contract/SelectionSnapshot/target/effect lineage (the key is structural),
   * may scope only to frozen member identities, inherits remaining budgets
   * untouched, and may reuse staged bytes only with ordinary validation
   * evidence.
   */
  resumeLineage(lineageKey: LineageKey, request: ResumeRequest): ControlResult<ResumeOutcome> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const transition = requireTransition(view.state, 'RESUME');
    if (!transition.ok) return transition;
    if (typeof request.authorizedBy !== 'string' || request.authorizedBy.trim().length === 0) {
      return controlReject(
        'UNAUTHORIZED_TRANSITION_REJECTED',
        'retry/resume requires an explicit authorizing identity; reconciliation alone never reopens processing',
        lineageKey,
      );
    }
    if (request.memberScope !== undefined) {
      for (const raw of request.memberScope) {
        const member = idOrReject(raw, makeMemberId);
        if (!member.ok) return member;
        if (!view.frozenMemberIds.includes(member.value)) {
          return controlReject(
            'SNAPSHOT_DRIFT_REJECTED',
            'retry/resume operates on the original frozen member/target identities only (CJ-06); introducing a new member is snapshot drift',
            `member=${member.value}`,
          );
        }
      }
    }
    let reusedStagedBytes = false;
    if (request.reuseStagedBytes !== undefined) {
      const evidence = idOrReject(request.reuseStagedBytes.validationEvidenceId, makeEvidenceId);
      if (!evidence.ok) {
        return controlReject(
          'STAGED_REUSE_VALIDATION_REQUIRED',
          'already-staged bytes may be reused only after ordinary identity/provenance/validation rules succeed; a validation evidence identity is required',
          request.reuseStagedBytes.stagedByteRef,
        );
      }
      reusedStagedBytes = true;
    }
    const ledger = this.#ledger(bindingOf(view).contractId);
    if (!ledger.ok) return ledger;
    const inheritedRemaining = ledger.value.remaining();
    const appended = this.#append({
      kind: 'resumeAuthorized',
      lineageKey,
      authorizedBy: request.authorizedBy,
      reason: request.reason,
    });
    if (!appended.ok) return appended;
    return controlOk({
      lineageKey,
      sequence: appended.value.sequence,
      inheritedRemaining,
      reusedStagedBytes,
    });
  }

  // --------------------------------------------------------- reconciliation

  /**
   * Bounded reconciliation: permitted in every state (including suppression)
   * to establish truthful pre-existing durable/external facts. It never
   * changes the control state, never crosses the acceptance cutoff, and never
   * reopens acceptance processing.
   */
  reconcile(
    lineageKey: LineageKey,
    observation: ReconciliationObservationKind,
    detail?: string,
  ): ControlResult<ReconciliationOutcome> {
    const view = this.#view(lineageKey);
    if (view === undefined) return unknownLineage(lineageKey);
    const transition = requireTransition(view.state, 'RECONCILE');
    if (!transition.ok) return transition;
    const appended = this.#append({
      kind: 'reconciliationObserved',
      lineageKey,
      observation,
      ...(detail === undefined ? {} : { detail }),
    });
    if (!appended.ok) return appended;
    const after = this.#view(lineageKey)!;
    return controlOk({
      lineageKey,
      sequence: appended.value.sequence,
      stateAfter: after.state,
      cutoff: cutoffDecisionFor(after),
    });
  }

  // -------------------------------------------------------------- read side

  lineageView(lineageKey: LineageKey): LineageView | undefined {
    return this.#view(lineageKey);
  }

  // --------------------------------------------------------------- internal

  #facts(): readonly DurableControlFact[] {
    return this.#log.readAll();
  }

  #view(lineageKey: LineageKey): LineageView | undefined {
    const view = reduceOneLineage(lineageKey, this.#facts());
    return view.submittedAt === 0 ? undefined : view;
  }

  #append(fact: UncommittedControlFact): ControlResult<DurableControlFact> {
    return this.#log.append(fact);
  }

  #ledger(contractId: ContractId): ControlResult<BudgetLedger> {
    const profile = this.#contractProfile(contractId);
    if (profile === undefined) {
      return unknownLineage(`contract ${contractId} has no durable budget profile`);
    }
    const append = (
      fact: UncommittedControlFact,
      token: Parameters<DurableControlFactLog['append']>[1],
    ) => this.#log.append(fact, token);
    return controlOk(BudgetLedger.open(profile, contractId, this.#facts(), append));
  }

  #contractProfile(contractId: ContractId): BudgetProfile | undefined {
    for (const fact of this.#facts()) {
      if (fact.kind === 'lineageSubmitted' && fact.binding.contractId === contractId) {
        return fact.budgetProfile;
      }
    }
    return undefined;
  }

  #assertContractProfile(contractId: ContractId, candidate: BudgetProfile): ControlResult<void> {
    const registered = this.#contractProfile(contractId);
    if (registered !== undefined && JSON.stringify(registered) !== JSON.stringify(candidate)) {
      return controlReject(
        'BUDGET_REPLENISHMENT_REJECTED',
        'the acquisition contract budget profile is durable and singular; a divergent profile implies replenishment or reset',
        `registered=${JSON.stringify(registered)} candidate=${JSON.stringify(candidate)}`,
      );
    }
    return controlOk(undefined);
  }

  #sequenceOf(
    lineageKey: LineageKey,
    kind: 'effectAttemptStarted',
    attemptId: string,
  ): CommitSequence {
    for (const fact of this.#facts()) {
      if (fact.kind === kind && fact.lineageKey === lineageKey && fact.attemptId === attemptId) {
        return fact.sequence;
      }
    }
    return 0;
  }
}

function bindingOf(view: LineageView): LineageBinding {
  if (view.binding === undefined) {
    throw new Error(`internal: lineage ${view.lineageKey} has no durable binding`);
  }
  return view.binding;
}

function unknownLineage(detail: string): ControlResult<never> {
  return controlReject(
    'UNKNOWN_LINEAGE',
    'control transition against an unregistered lineage',
    detail,
  );
}

function requireTransition(
  state: LineageView['state'],
  event: ControlEventType,
): ControlResult<LineageView['state']> {
  return controlTransition(state, event);
}

/** Budget profiles arrive raw at the seam and are decoded once, fail closed. */
function decodeProfileOrReject(raw: unknown): ControlResult<BudgetProfile> {
  const decoded = decodeBudgetProfile(raw);
  if (!decoded.ok) {
    return controlReject(
      'MALFORMED_CONTROL_FACT',
      'budget profile rejected by the T002 validator at the control seam',
      JSON.stringify(decoded.diagnostics),
    );
  }
  return controlOk(decoded.value);
}
