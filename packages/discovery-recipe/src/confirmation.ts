/**
 * T011 selection/confirmation workflow logic (PRD §13/§21, C26/C27/C30/C31/C32/C34).
 *
 * AUTO/ASSISTED/MANUAL_SELECTION interaction priority:
 *
 *   one scope-level confirmation → one batch/group confirmation → a small
 *   number of material item confirmations → manual selection UI
 *
 * Confirmation evidence proves selection only; it cannot self-certify target
 * quality/membership truth, cannot waive required validation layers and is
 * never reusable membership knowledge without distinct validated provenance.
 */

import {
  aggregateConfirmationOutcomes,
  applyKnowledgeToContract,
  deepFreeze,
  diagnostic,
  evidenceRecord,
  fail,
  makeEvidenceId,
  ok,
  whatConfirmationProves,
  type AutomationMode,
  type ClaimSubject,
  type ConfirmationOutcome,
  type ConfirmationType,
  type DomainValidationResult,
  type EvidenceRecord,
  type MemberId,
  type SelectionClaim,
  type ValidationLayer,
} from '@xdownload/domain-contracts';

/**
 * Deterministic bound on "a small number of material item confirmations"
 * (PRD §13). More ambiguous material items than this resolve through one
 * batch/group or manual-selection surface, never per-item interrogation.
 */
export const MAX_MATERIAL_ITEM_CONFIRMATIONS = 3;

export type ConfirmationRequest =
  | { readonly level: 'SCOPE_LEVEL'; readonly scopeKey: string }
  | { readonly level: 'BATCH_GROUP'; readonly memberRefs: readonly string[] }
  | { readonly level: 'MATERIAL_ITEM'; readonly memberRef: string }
  | { readonly level: 'MANUAL_SELECTION_UI'; readonly candidateRefs: readonly string[] };

export interface ConfirmationPlan {
  readonly automationMode: AutomationMode;
  readonly requests: readonly ConfirmationRequest[];
  /** Per-item interrogation is never the default resolution path (C30). */
  readonly perItemInterrogationUsed: boolean;
  readonly escalationReason?: 'INSUFFICIENT_AUTO_EVIDENCE';
}

/**
 * Plan the confirmation workflow deterministically from the contract's
 * automation mode and workflow facts:
 *
 * - AUTO requires sufficient evidence for material target/membership/scope
 *   claims; without it the workflow escalates to ASSISTED (never silently
 *   proceeds);
 * - ASSISTED requests one scope-level confirmation or one batch/group
 *   confirmation for the ambiguous material members;
 * - MANUAL_SELECTION (or a personal/ambiguous choice over many candidates)
 *   exposes the candidate set through one manual-selection surface (C30).
 */
export function planConfirmationWorkflow(input: {
  readonly contract: {
    readonly automationMode: AutomationMode;
    readonly selectionPolicy: { readonly basis: string };
  };
  readonly scopeScopeKey?: string;
  readonly ambiguousMaterialMemberIds: readonly string[];
  readonly candidateCount: number;
  readonly autoEvidenceSufficient: boolean;
  readonly userRequestsManualSelection?: boolean;
}): ConfirmationPlan {
  const ambiguous = [...new Set(input.ambiguousMaterialMemberIds)];
  if (
    input.userRequestsManualSelection === true ||
    input.contract.automationMode === 'MANUAL_SELECTION'
  ) {
    const requests: readonly ConfirmationRequest[] = [
      { level: 'MANUAL_SELECTION_UI', candidateRefs: ambiguous },
    ];
    return {
      automationMode: 'MANUAL_SELECTION',
      requests: deepFreeze(requests),
      perItemInterrogationUsed: false,
    };
  }
  let effectiveMode: AutomationMode = input.contract.automationMode;
  let escalationReason: 'INSUFFICIENT_AUTO_EVIDENCE' | undefined;
  if (input.contract.automationMode === 'AUTO') {
    if (input.autoEvidenceSufficient && ambiguous.length === 0) {
      return {
        automationMode: 'AUTO',
        requests: [],
        perItemInterrogationUsed: false,
      };
    }
    // AUTO without sufficient material evidence escalates; it never guesses.
    effectiveMode = 'ASSISTED';
    escalationReason = 'INSUFFICIENT_AUTO_EVIDENCE';
  }
  // ASSISTED: one scope-level confirmation, else one batch confirmation, else
  // a small number of material item confirmations, else the manual surface.
  if (ambiguous.length === 0 && input.scopeScopeKey !== undefined) {
    const scopeRequest: readonly ConfirmationRequest[] = [
      { level: 'SCOPE_LEVEL', scopeKey: input.scopeScopeKey },
    ];
    return {
      automationMode: effectiveMode,
      requests: deepFreeze(scopeRequest),
      perItemInterrogationUsed: false,
      escalationReason: escalationReason,
    };
  }
  if (ambiguous.length > MAX_MATERIAL_ITEM_CONFIRMATIONS) {
    const batchRequest: readonly ConfirmationRequest[] = [
      { level: 'BATCH_GROUP', memberRefs: ambiguous },
    ];
    return {
      automationMode: effectiveMode,
      requests: deepFreeze(batchRequest),
      perItemInterrogationUsed: false,
      escalationReason: escalationReason,
    };
  }
  const itemRequests: readonly ConfirmationRequest[] = ambiguous.map(
    (memberRef) => ({ level: 'MATERIAL_ITEM', memberRef: memberRef }) as const,
  );
  return {
    automationMode: effectiveMode,
    requests: deepFreeze(itemRequests),
    perItemInterrogationUsed: false,
    escalationReason: escalationReason,
  };
}

/** What a confirmation interaction produced, typed as a selection claim. */
export interface ConfirmationOutcomeRecord {
  readonly selectionClaim: SelectionClaim;
  /** Proves / does-not-prove binding from the canonical confirmation rules. */
  readonly proves: ReturnType<typeof whatConfirmationProves>['proves'];
  readonly doesNotProve: readonly string[];
  readonly outcomesAggregate: ConfirmationOutcome;
}

/**
 * Record one resolved confirmation interaction. The confirmation type is
 * canonical; the recorded claim is a SELECTION-scoped selection claim and
 * its evidence boundary follows `whatConfirmationProves` exactly: a
 * CONFIRM_QUALITY_CHOICE click proves SELECTION and never QUALITY (C26).
 */
export function recordConfirmation(input: {
  readonly claimKind: 'SINGLE' | 'BATCH';
  readonly confirmationType: ConfirmationType;
  readonly memberRefs: readonly MemberId[];
  readonly outcomes: readonly ConfirmationOutcome[];
}): DomainValidationResult<ConfirmationOutcomeRecord> {
  if (input.memberRefs.length === 0) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'confirmation.memberRefs',
        'a confirmation record must reference at least one member',
      ),
    ]);
  }
  const aggregate = aggregateConfirmationOutcomes(input.outcomes);
  const claim: SelectionClaim = {
    kind: input.claimKind,
    confirmationType: input.confirmationType,
    memberRefs: input.memberRefs,
  };
  const selectionClaim: SelectionClaim = deepFreeze(claim);
  const proves = whatConfirmationProves(input.confirmationType);
  return ok(
    deepFreeze({
      selectionClaim: selectionClaim,
      proves: proves.proves,
      doesNotProve: proves.doesNotProve,
      outcomesAggregate: aggregate,
    }),
  );
}

/**
 * Confirmation evidence record (canonical EvidenceRecord shape): sourceType
 * USER_CONFIRMATION. Confirmation is independent of discovery (the user is
 * the authority for the shown claim), but it can never satisfy
 * Transfer/Format/Media validation layers (C27) — see
 * `selectionAcquisitionComplete`.
 */
export function confirmationEvidenceRecord(input: {
  readonly confirmationType: ConfirmationType;
  readonly evidenceId: string;
  readonly claimSubject: ClaimSubject;
  readonly contractRef?: string;
  readonly snapshotRef?: string;
}): DomainValidationResult<EvidenceRecord> {
  const evidenceId = makeEvidenceId(input.evidenceId);
  if (!evidenceId.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'evidence.evidenceId',
        'confirmation evidence id must be a valid evidence identity',
      ),
    ]);
  }
  const proves = whatConfirmationProves(input.confirmationType);
  return ok(
    evidenceRecord({
      evidenceId: evidenceId.value,
      claimType: proves.proves,
      claimSubject: input.claimSubject,
      sourceType: 'USER_CONFIRMATION',
      provenance: { sourceIdentity: `user-confirmation:${input.confirmationType}` },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: {
        domain: 'BATCH_DOWNLOAD',
        contractRef: input.contractRef,
        snapshotRef: input.snapshotRef,
      },
      certaintyClass: 'DECISIVE',
    }),
  );
}

export type SelectionAcquisitionDecision =
  | { readonly decision: 'COMPLETE' }
  | {
      readonly decision: 'NOT_COMPLETE';
      readonly reason:
        'CONFIRMATION_CANNOT_WAIVE_VALIDATION' | 'VALIDATION_MISSING' | 'VALIDATION_FAILED';
      readonly layer?: ValidationLayer;
    };

/**
 * Whether selection acquisition may be marked COMPLETE from the provided
 * per-member validation evidence (C27). Confirmation records never count:
 * for every required layer, oracle-grade evidence from a source allowed for
 * that layer must exist. User confirmation can satisfy only the layers the
 * canonical layer table allows (target/membership), and never
 * transfer/format/media.
 */
export function selectionAcquisitionComplete(input: {
  readonly requiredLayers: readonly ValidationLayer[];
  readonly evidenceByLayer: Readonly<Record<string, readonly EvidenceRecord[]>>;
  readonly anyValidationFailed: boolean;
}): SelectionAcquisitionDecision {
  if (input.anyValidationFailed) {
    return { decision: 'NOT_COMPLETE', reason: 'VALIDATION_FAILED' };
  }
  for (const layer of input.requiredLayers) {
    const candidates = input.evidenceByLayer[layer] ?? [];
    const satisfied = candidates.some(
      (record) =>
        record.sourceType !== 'USER_CONFIRMATION' &&
        record.sourceType !== 'DISCOVERY_INFERENCE' &&
        record.sourceType !== 'UI_SUGGESTION',
    );
    if (!satisfied) {
      const reason: 'CONFIRMATION_CANNOT_WAIVE_VALIDATION' | 'VALIDATION_MISSING' =
        candidates.length > 0 ? 'CONFIRMATION_CANNOT_WAIVE_VALIDATION' : 'VALIDATION_MISSING';
      return { decision: 'NOT_COMPLETE', reason: reason, layer: layer };
    }
  }
  return { decision: 'COMPLETE' };
}

/**
 * Task-local selection replay rule (C31): task-local selection is not
 * reusable membership authority; applying it to a new contract fails closed.
 * Promoted knowledge requires distinct current validation evidence bound to
 * the present page/session/layout.
 */
export function assertSelectionKnowledgeReusable(input: {
  readonly knowledge: {
    readonly knowledgeId: string;
    readonly kind: 'TASK_LOCAL_SELECTION' | 'PROMOTED_LOCAL_VERIFIED';
    readonly applicableScopeKey: string;
    readonly requiresCurrentValidation: true;
  };
  readonly currentValidationEvidence: EvidenceRecord | undefined;
}): DomainValidationResult<void> {
  return applyKnowledgeToContract(input.knowledge, input.currentValidationEvidence);
}
