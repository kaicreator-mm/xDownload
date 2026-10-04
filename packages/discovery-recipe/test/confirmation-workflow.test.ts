/**
 * T011 TEST_MATRIX suite `selection-confirmation-workflow` — AUTO/ASSISTED/
 * MANUAL_SELECTION interaction priority (PRD §13, C30), confirmation proves
 * selection only (C26/C34), confirmation never waives validation (C27),
 * task-local selection is not reusable membership authority (C31) and
 * confirmation-set aggregation follows the common-denominator rules (C32).
 */
import { describe, expect, it } from 'vitest';
import {
  assertNoDiscoverySelfCertification,
  assertValidatesRequiredLayer,
  canServeAsIndependentValidationOracle,
  decodeEvidenceRecord,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  confirmationEvidenceRecord,
  planConfirmationWorkflow,
  recordConfirmation,
  selectionAcquisitionComplete,
  assertSelectionKnowledgeReusable,
} from '../src/index.ts';
import {
  asMembers,
  confirmedFiniteSetContract,
  discoveryEvidence,
  independentEvidence,
} from './fixtures.ts';

const fiftyCandidates = Array.from(
  { length: 50 },
  (_, i) => `candidate-${String(i + 1).padStart(2, '0')}`,
);

describe('interaction priority (PRD §13)', () => {
  it('AUTO with sufficient evidence asks nothing; AUTO without evidence escalates to ASSISTED', () => {
    const contract = confirmedFiniteSetContract(['member-a', 'member-b'], {
      automationMode: 'AUTO',
    });
    const sufficient = planConfirmationWorkflow({
      contract: contract,
      scopeScopeKey: 'explicit_member_set:collection/declared-001:member-a,member-b',
      ambiguousMaterialMemberIds: [],
      candidateCount: 2,
      autoEvidenceSufficient: true,
    });
    expect(sufficient.automationMode).toBe('AUTO');
    expect(sufficient.requests).toEqual([]);
    const insufficient = planConfirmationWorkflow({
      contract: contract,
      scopeScopeKey: 'explicit_member_set:collection/declared-001:member-a,member-b',
      ambiguousMaterialMemberIds: [],
      candidateCount: 2,
      autoEvidenceSufficient: false,
    });
    expect(insufficient.automationMode).toBe('ASSISTED');
    expect(insufficient.escalationReason).toBe('INSUFFICIENT_AUTO_EVIDENCE');
    expect(insufficient.requests).toHaveLength(1);
    expect(insufficient.requests[0]?.level).toBe('SCOPE_LEVEL');
  });

  it('C30: 50 candidates resolve through one batch/manual surface, never per-item interrogation', () => {
    const contract = confirmedFiniteSetContract(fiftyCandidates, { automationMode: 'ASSISTED' });
    const plan = planConfirmationWorkflow({
      contract: contract,
      ambiguousMaterialMemberIds: fiftyCandidates,
      candidateCount: 50,
      autoEvidenceSufficient: false,
    });
    expect(plan.perItemInterrogationUsed).toBe(false);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.level).toBe('BATCH_GROUP');
    const manual = planConfirmationWorkflow({
      contract: contract,
      ambiguousMaterialMemberIds: fiftyCandidates,
      candidateCount: 50,
      autoEvidenceSufficient: false,
      userRequestsManualSelection: true,
    });
    expect(manual.requests).toHaveLength(1);
    expect(manual.requests[0]?.level).toBe('MANUAL_SELECTION_UI');
    expect(manual.automationMode).toBe('MANUAL_SELECTION');
  });

  it('a small number of material items may confirm item-by-item; MANUAL_SELECTION always exposes the set', () => {
    const contract = confirmedFiniteSetContract(['member-a', 'member-b'], {
      automationMode: 'ASSISTED',
    });
    const twoItems = planConfirmationWorkflow({
      contract: contract,
      ambiguousMaterialMemberIds: ['member-a', 'member-b'],
      candidateCount: 2,
      autoEvidenceSufficient: false,
    });
    expect(twoItems.requests).toEqual([
      { level: 'MATERIAL_ITEM', memberRef: 'member-a' },
      { level: 'MATERIAL_ITEM', memberRef: 'member-b' },
    ]);
    const manual = planConfirmationWorkflow({
      contract: { automationMode: 'MANUAL_SELECTION', selectionPolicy: contract.selectionPolicy },
      ambiguousMaterialMemberIds: ['member-a', 'member-b'],
      candidateCount: 2,
      autoEvidenceSufficient: true,
    });
    expect(manual.requests[0]?.level).toBe('MANUAL_SELECTION_UI');
  });
});

describe('confirmation proves selection only (C26) and never quality (C34 boundary)', () => {
  it('CONFIRM_QUALITY_CHOICE records prove SELECTION with QUALITY explicitly not proven', () => {
    const record = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'SINGLE',
        confirmationType: 'CONFIRM_QUALITY_CHOICE',
        memberRefs: asMembers(['member-a']),
        outcomes: ['CONFIRMED'],
      }),
    );
    expect(record.proves).toBe('SELECTION');
    expect(record.doesNotProve).toContain('QUALITY');
    expect(record.selectionClaim.confirmationType).toBe('CONFIRM_QUALITY_CHOICE');
  });

  it('confirmation evidence can never satisfy Transfer/Format/Media validation layers (C27)', () => {
    const evidence = unwrapOrThrow(
      confirmationEvidenceRecord({
        confirmationType: 'CONFIRM_SELECTION',
        evidenceId: 'evidence-confirm-selection-001',
        claimSubject: { kind: 'MEMBER', ref: 'member-a' },
        contractRef: 'contract-finite-set',
      }),
    );
    expect(evidence.sourceType).toBe('USER_CONFIRMATION');
    expect(evidence.claimType).toBe('SELECTION');
    for (const layer of ['transfer', 'format', 'media'] as const) {
      const verdict = assertValidatesRequiredLayer(evidence, layer);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.diagnostics[0]?.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
      }
    }
  });

  it('selection acquisition cannot be marked COMPLETE from confirmation alone (C27)', () => {
    const confirmationEvidence = unwrapOrThrow(
      confirmationEvidenceRecord({
        confirmationType: 'CONFIRM_MEMBERSHIP',
        evidenceId: 'evidence-confirm-membership-001',
        claimSubject: { kind: 'MEMBER', ref: 'member-a' },
      }),
    );
    const confirmationOnly = selectionAcquisitionComplete({
      requiredLayers: ['membership', 'transfer', 'format'],
      evidenceByLayer: {
        membership: [confirmationEvidence],
        transfer: [confirmationEvidence],
        format: [confirmationEvidence],
      },
      anyValidationFailed: false,
    });
    expect(confirmationOnly.decision).toBe('NOT_COMPLETE');
    if (confirmationOnly.decision === 'NOT_COMPLETE') {
      expect(confirmationOnly.reason).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
    }
    const missing = selectionAcquisitionComplete({
      requiredLayers: ['transfer'],
      evidenceByLayer: {},
      anyValidationFailed: false,
    });
    expect(missing.decision).toBe('NOT_COMPLETE');
    if (missing.decision === 'NOT_COMPLETE') {
      expect(missing.reason).toBe('VALIDATION_MISSING');
    }
    const complete = selectionAcquisitionComplete({
      requiredLayers: ['membership', 'transfer'],
      evidenceByLayer: {
        membership: [
          independentEvidence('evidence-membership-001', { kind: 'MEMBER', ref: 'member-a' }),
        ],
        transfer: [
          independentEvidence(
            'evidence-transfer-001',
            { kind: 'RESOURCE', ref: 'res-a' },
            'TRANSFER',
          ),
        ],
      },
      anyValidationFailed: false,
    });
    expect(complete).toEqual({ decision: 'COMPLETE' });
    const failed = selectionAcquisitionComplete({
      requiredLayers: ['membership'],
      evidenceByLayer: {
        membership: [
          independentEvidence('evidence-membership-001', { kind: 'MEMBER', ref: 'member-a' }),
        ],
      },
      anyValidationFailed: true,
    });
    expect(failed).toEqual({ decision: 'NOT_COMPLETE', reason: 'VALIDATION_FAILED' });
  });

  it('discovery/recipe suggestions can never self-certify the claim they produced (C34)', () => {
    const discoveryMembership = discoveryEvidence('evidence-discovery-001', {
      kind: 'MEMBER',
      ref: 'member-a',
    });
    expect(canServeAsIndependentValidationOracle(discoveryMembership)).toBe(false);
    const verdict = assertNoDiscoverySelfCertification(
      discoveryMembership,
      discoveryEvidence('evidence-discovery-002', { kind: 'MEMBER', ref: 'member-a' }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.diagnostics[0]?.code).toBe('SELF_CERTIFICATION');
    }
    // Even re-labeling the record as INDEPENDENT fails canonical decode.
    const relabeled = decodeEvidenceRecord({
      ...(discoveryMembership as unknown as Record<string, unknown>),
      independenceFromDiscovery: 'INDEPENDENT',
    });
    expect(relabeled.ok).toBe(false);
    if (!relabeled.ok) {
      expect(relabeled.diagnostics[0]?.code).toBe('SELF_CERTIFICATION');
    }
  });
});

describe('C31: task-local selection is not reusable membership authority', () => {
  it('task-local selection fails closed on replay; promotion requires distinct current validation', () => {
    const taskLocal = {
      knowledgeId: 'knowledge/task-selection-1',
      kind: 'TASK_LOCAL_SELECTION',
      applicableScopeKey: 'current_page:collection/similar-page',
      requiresCurrentValidation: true,
    } as const;
    const currentEvidence = independentEvidence(
      'evidence-current-validation-001',
      {
        kind: 'COVERAGE_TARGET',
        ref: 'coverage/similar-page',
      },
      'COVERAGE',
    );
    const replayed = assertSelectionKnowledgeReusable({
      knowledge: taskLocal,
      currentValidationEvidence: currentEvidence,
    });
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.diagnostics[0]?.code).toBe('KNOWLEDGE_NOT_REUSABLE');
      expect(replayed.diagnostics[0]?.invariant).toBe('C31');
    }
    const promoted = {
      knowledgeId: 'knowledge/promoted-1',
      kind: 'PROMOTED_LOCAL_VERIFIED',
      applicableScopeKey: 'current_page:collection/similar-page',
      requiresCurrentValidation: true,
    } as const;
    const withoutEvidence = assertSelectionKnowledgeReusable({
      knowledge: promoted,
      currentValidationEvidence: undefined,
    });
    expect(withoutEvidence.ok).toBe(false);
    const withEvidence = assertSelectionKnowledgeReusable({
      knowledge: promoted,
      currentValidationEvidence: currentEvidence,
    });
    expect(withEvidence.ok).toBe(true);
  });
});

describe('C32: confirmation-set common-denominator rules', () => {
  it('failure dominates, then abandonment, out-of-scope, unknown; never collapses into success', () => {
    const mixed = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a', 'member-b', 'member-c', 'member-d']),
        outcomes: ['CONFIRMED', 'FAILED', 'ABANDONED', 'UNKNOWN'],
      }),
    );
    expect(mixed.outcomesAggregate).toBe('FAILED');
    const abandoned = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a', 'member-b']),
        outcomes: ['CONFIRMED', 'ABANDONED', 'OUT_OF_SCOPE'],
      }),
    );
    expect(abandoned.outcomesAggregate).toBe('ABANDONED');
    const outOfScope = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a']),
        outcomes: ['CONFIRMED', 'OUT_OF_SCOPE', 'UNKNOWN'],
      }),
    );
    expect(outOfScope.outcomesAggregate).toBe('OUT_OF_SCOPE');
    const unknown = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a']),
        outcomes: ['CONFIRMED', 'UNKNOWN'],
      }),
    );
    expect(unknown.outcomesAggregate).toBe('UNKNOWN');
    const allConfirmed = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a', 'member-b']),
        outcomes: ['CONFIRMED', 'CONFIRMED'],
      }),
    );
    expect(allConfirmed.outcomesAggregate).toBe('CONFIRMED');
  });

  it('a confirmation record must reference members', () => {
    const empty = recordConfirmation({
      claimKind: 'BATCH',
      confirmationType: 'CONFIRM_SELECTION',
      memberRefs: [],
      outcomes: ['CONFIRMED'],
    });
    expect(empty.ok).toBe(false);
  });
});
