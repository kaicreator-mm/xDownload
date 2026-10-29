/**
 * TEST_MATRIX counterexample oracles C01–C34 (frozen PRD §35) at the
 * contract-representation layer. Every counterexample maps to at least one
 * executable assertion over the canonical contract vocabulary.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateConfirmationOutcomes,
  admitCollectionContract,
  applyKnowledgeToContract,
  assertBaselineIdentityUnchanged,
  assertContractTransition,
  assertEvidenceScopeNotPromoted,
  assertLocatorTransitionPreservesTarget,
  assertNoDiscoverySelfCertification,
  assertNoDuplicateAllocation,
  assertSnapshotImmutable,
  assertValidatesRequiredLayer,
  bindLocator,
  budgetRemaining,
  canStartNewDiscoveryWork,
  canTransferAfterDiscoveryExhaustion,
  decodeAcquisitionContract,
  decodeBudgetProfile,
  decodeEvidenceRecord,
  decodeKnowledgeRef,
  decodeRequestedScope,
  decodeSelectionSnapshot,
  decodeTerminalResult,
  deriveSuccessorContract,
  deriveSuccessorSnapshot,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  planRetryOfFailedMembers,
  scopeIdentityKey,
  validateTerminalResult,
  whatConfirmationProves,
  type TerminalResultContext,
} from '../src/index.ts';
import {
  confirmedSnapshot,
  decodeOk,
  decodedTerminalResult,
  expectCode,
  eid,
  mid,
  pageRangeScope,
  entireCollectionScope,
  rawCollectionContract,
  rawSingleResourceContract,
  rawSnapshot,
  rawTerminalResult,
} from './helpers.ts';
import type { EvidenceRecord } from '../src/index.ts';

function collectionResult(
  overrides: Record<string, unknown>,
  ctx: Partial<TerminalResultContext> = {},
): void {
  const result = decodeOk(
    decodeTerminalResult(
      rawTerminalResult({ contractId: 'contract-collection-001', ...overrides }),
    ),
  );
  const base: TerminalResultContext = {
    intentType: 'COLLECTION',
    scopeKind: 'entire_supported_collection',
    selectedMemberCount: 3,
    selectedValidationOutcomes: [mid('member-001'), mid('member-002'), mid('member-003')].map(
      (memberId) => ({ memberId, requiredValidationPassed: true }),
    ),
    coverageEvidence: {
      kind: 'SUFFICIENT',
      basis: {
        basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
        identities: ['member-001', 'member-002', 'member-003'],
      },
    },
    ...ctx,
  };
  // the positive baseline is part of every oracle block: the legal tuple must
  // itself validate before the forbidden projection is asserted against it
  expect(decodeOk(validateTerminalResult(result, base))).toBeUndefined();
}

const evidence = (fields: Record<string, unknown>): EvidenceRecord => ({
  schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
  evidenceId: eid('evidence-oracle-001'),
  claimType: 'RESOURCE_IDENTITY',
  claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-file-001' },
  sourceType: 'INDEPENDENT_VALIDATOR',
  provenance: { sourceIdentity: 'validator/oracle-001' },
  independenceFromDiscovery: 'INDEPENDENT',
  scope: { domain: 'BATCH_DOWNLOAD' },
  certaintyClass: 'DECISIVE',
  ...fields,
});

describe('counterexample oracles C01–C34 (contract level)', () => {
  it('C01: duplicate replaces a missing member with count equal — no VERIFIED_COMPLETE; identity correspondence required', () => {
    const original = confirmedSnapshot();
    const swapped = decodeOk(
      decodeSelectionSnapshot(
        rawSnapshot({
          requestedMemberBasis: {
            kind: 'EXPLICIT_IDENTITIES',
            memberIds: [mid('member-001'), mid('member-002'), mid('member-009')],
          },
          selectedMemberIds: ['member-001', 'member-002', 'member-009'],
          selectionClaims: [
            {
              kind: 'BATCH',
              confirmationType: 'CONFIRM_SELECTION',
              memberRefs: ['member-001', 'member-002', 'member-009'],
            },
          ],
        }),
      ),
    );
    expectCode(assertSnapshotImmutable(original, swapped), 'MEMBERSHIP_DRIFT', 'C01/C11');
    expectCode(
      validateTerminalResult(
        decodedTerminalResult({
          contractId: 'contract-collection-001',
          coverage: 'VERIFIED_COMPLETE',
          stopReason: 'USER_SCOPE_REACHED',
        }),
        {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 3,
          selectedValidationOutcomes: [
            { memberId: mid('member-001'), requiredValidationPassed: true },
            { memberId: mid('member-002'), requiredValidationPassed: true },
            { memberId: mid('member-009'), requiredValidationPassed: true },
          ],
          coverageEvidence: {
            kind: 'SUFFICIENT',
            basis: {
              basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
              identities: ['member-001', 'member-002', 'member-003'],
            },
          },
        },
      ),
      'INVALID_RESULT_COMBINATION',
      'C01',
    );
  });

  it('C02: requested 150, safety cap stops after 100 — PARTIAL/PARTIAL/TRUNCATED, never COMPLETE', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({
      memberId: mid(`member-${String(i + 1).padStart(3, '0')}`),
      requiredValidationPassed: true,
    }));
    const legal = {
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'GLOBAL_SAFETY_LIMIT',
    };
    collectionResult(legal, { selectedMemberCount: 100, selectedValidationOutcomes: hundred });
    expectCode(
      validateTerminalResult(
        decodeOk(
          decodeTerminalResult(
            rawTerminalResult({
              contractId: 'contract-collection-001',
              ...legal,
              requestFulfillment: 'COMPLETE',
              coverage: 'VERIFIED_COMPLETE',
            }),
          ),
        ),
        {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 100,
          selectedValidationOutcomes: hundred,
        },
      ),
      'INVALID_RESULT_COMBINATION',
      'C02/PRD-§15.4',
    );
  });

  it('C03: next page fails / control missing / pagination loop — not natural end; truthful UNKNOWN/TRUNCATED stop', () => {
    collectionResult(
      {
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
        stopReason: 'NO_PROGRESS',
      },
      { coverageEvidence: undefined },
    );
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(result, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 3,
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'FAILED_NEXT_PAGE' },
      }),
      'COVERAGE_EVIDENCE_INSUFFICIENT',
      'PRD-§19',
    );
    const loop = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(loop, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 3,
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'PAGINATION_LOOP' },
      }),
      'COVERAGE_EVIDENCE_INSUFFICIENT',
    );
  });

  it('C04: finite collection reaches validated natural end — VERIFIED_COMPLETE only with closure evidence', () => {
    const withClosure = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'NATURAL_COLLECTION_END',
    });
    expect(
      decodeOk(
        validateTerminalResult(withClosure, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 3,
          selectedValidationOutcomes: [
            { memberId: mid('member-001'), requiredValidationPassed: true },
            { memberId: mid('member-002'), requiredValidationPassed: true },
            { memberId: mid('member-003'), requiredValidationPassed: true },
          ],
          coverageEvidence: {
            kind: 'SUFFICIENT',
            basis: {
              basis: 'DECLARED_TOTAL_WITH_CLOSURE',
              declaredTotal: 3,
              accountedIdentityCount: 3,
              closure: 'NATURAL_END_VALIDATED',
            },
          },
        }),
      ),
    ).toBeUndefined();
    const withoutClosure = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'NATURAL_COLLECTION_END',
    });
    expectCode(
      validateTerminalResult(withoutClosure, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 3,
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'NO_MORE_FOUND_WITHOUT_CLOSURE' },
      }),
      'COVERAGE_EVIDENCE_INSUFFICIENT',
    );
  });

  it('C05: user selects 5 of a larger collection, all succeed — exact legal tuple for the selected scope', () => {
    const selectedFive = Array.from(
      { length: 5 },
      (_, i) => `member-${String(i + 1).padStart(3, '0')}`,
    );
    const scope = {
      kind: 'selected_collection_members',
      collectionIdentity: 'collection/large-001',
      memberIds: selectedFive,
    } as const;
    const contract = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          collectionIdentity: 'collection/large-001',
          requestedScope: scope,
          membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        }),
      ),
    );
    expect(decodeOk(admitCollectionContract(contract))).toBeUndefined();
    const result = decodeOk(
      decodeTerminalResult(
        rawTerminalResult({
          contractId: contract.contractId,
          requestFulfillment: 'COMPLETE',
          targetResolution: 'RESOLVED',
          selectionAcquisition: 'COMPLETE',
          coverage: 'VERIFIED_COMPLETE',
          stopReason: 'USER_SELECTION_COMPLETE',
        }),
      ),
    );
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'COLLECTION',
          scopeKind: 'selected_collection_members',
          selectedMemberCount: 5,
          selectedValidationOutcomes: selectedFive.map((raw) => ({
            memberId: mid(raw),
            requiredValidationPassed: true,
          })),
          coverageEvidence: {
            kind: 'SUFFICIENT',
            basis: {
              basis: 'USER_DECLARED_FINITE_SET_FULLY_ACCOUNTED',
              declaredCount: 5,
              accountedIdentityCount: 5,
            },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('C06: "first 1000 pages under domain, all PDFs" — arbitrary frontier is unrepresentable and rejected', () => {
    expectCode(
      decodeRequestedScope({
        kind: 'domain_crawl',
        domain: 'example.com',
        filter: '*.pdf',
        maxPages: 1000,
      }),
      'UNKNOWN_ENUM_VALUE',
      'PRD-§9',
    );
    expectCode(
      decodeAcquisitionContract(
        rawSingleResourceContract({ explorationPermission: 'ARBITRARY_FRONTIER' }),
      ),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('C07: member needs detail page/CDN — traceable locator chain retains logical identity', () => {
    const member = decodeOk(makeMemberId('member-001'));
    const origin = { kind: 'direct' as const, uri: 'https://site.example/list' };
    const detail = { kind: 'redirect' as const, uri: 'https://site.example/member/001' };
    const cdn = { kind: 'signed' as const, uri: 'https://cdn.example/member/001?sig=abc' };
    const first = decodeOk(
      bindLocator(origin, member, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: origin.uri,
      }),
    );
    const second = decodeOk(
      assertLocatorTransitionPreservesTarget(first, detail, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: origin.uri,
      }),
    );
    const third = decodeOk(
      assertLocatorTransitionPreservesTarget(second, cdn, {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: detail.uri,
      }),
    );
    expect(third.identity).toBe(member);
  });

  it('C08: page-range 1..3 with iframe/load-more present and no continuation — frozen scope; later load-more requires successor', () => {
    const scope = {
      kind: 'collection_page_range',
      collectionIdentity: 'collection/paged-001',
      fromPage: 1,
      toPage: 3,
    } as const;
    const contract = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          collectionIdentity: 'collection/paged-001',
          requestedScope: scope,
          continuationScope: { kind: 'NONE' },
        }),
      ),
    );
    expect(contract.continuationScope).toEqual({ kind: 'NONE' });
    // load-more widening the range under the same identity is a forbidden silent expansion
    const expanded = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({
          collectionIdentity: 'collection/paged-001',
          requestedScope: {
            kind: 'collection_page_range',
            collectionIdentity: 'collection/paged-001',
            fromPage: 1,
            toPage: 5,
          },
        }),
      ),
    );
    expectCode(assertContractTransition(contract, expanded), 'SCOPE_MUTATION', 'PRD-§8');
    const successor = decodeOk(
      deriveSuccessorContract(
        contract,
        { requestedScope: pageRangeScope('collection/paged-001', 1, 5) },
        'SCOPE_CHANGE',
      ),
    );
    expect(successor.supersedesContractId).toBe(contract.contractId);
    // coverage target binds pages 1..3 only
    expect(scopeIdentityKey(pageRangeScope('collection/paged-001', 1, 3))).toBe(
      'collection_page_range:collection/paged-001:1..3',
    );
  });

  it('C09: original vs thumbnail / main video vs ad — no semantic PASS without typed independent Target/Quality evidence', () => {
    const suggestion = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              claimType: 'QUALITY',
              sourceType: 'UI_SUGGESTION',
              provenance: { sourceIdentity: 'ui/label-original' },
              independenceFromDiscovery: 'DISCOVERY_DERIVED',
              certaintyClass: 'SUGGESTIVE',
            }),
          ),
        ),
      ),
    );
    expectCode(assertValidatesRequiredLayer(suggestion, 'media'), 'SELF_CERTIFICATION');
    expect(whatConfirmationProves('CONFIRM_QUALITY_CHOICE').doesNotProve).toContain('QUALITY');
  });

  it('C10: 18 requested whole collection, 16 accessible all succeed — exact PARTIAL/RESOLVED/COMPLETE/VERIFIED_COMPLETE/AUTH_REQUIRED', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => ({
      memberId: mid(`member-${String(i + 1).padStart(3, '0')}`),
      requiredValidationPassed: true,
    }));
    const legal = {
      requestFulfillment: 'PARTIAL',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'AUTH_REQUIRED',
    };
    collectionResult(legal, {
      selectedMemberCount: 16,
      selectedValidationOutcomes: sixteen,
      coverageEvidence: {
        kind: 'SUFFICIENT',
        basis: {
          basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
          identities: Array.from(
            { length: 18 },
            (_, i) => `member-${String(i + 1).padStart(3, '0')}`,
          ),
        },
      },
      knownAuthInaccessibleRequestedCount: 2,
    });
    // forbidden projection: COMPLETE fulfillment from the accessible subset alone
    expectCode(
      validateTerminalResult(
        decodeOk(
          decodeTerminalResult(
            rawTerminalResult({
              contractId: 'contract-collection-001',
              ...legal,
              requestFulfillment: 'COMPLETE',
            }),
          ),
        ),
        {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 16,
          selectedValidationOutcomes: sixteen,
          coverageEvidence: {
            kind: 'SUFFICIENT',
            basis: {
              basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
              identities: Array.from(
                { length: 18 },
                (_, i) => `member-${String(i + 1).padStart(3, '0')}`,
              ),
            },
          },
          knownAuthInaccessibleRequestedCount: 2,
        },
      ),
      'INVALID_RESULT_COMBINATION',
      'C10/PRD-§18.7',
    );
  });

  it('C11: collection changes after preview — snapshot cannot drift; refresh creates successor', () => {
    const original = confirmedSnapshot();
    const drifted = decodeOk(
      decodeSelectionSnapshot(
        rawSnapshot({
          selectedMemberIds: ['member-001', 'member-002'],
          selectionClaims: [
            {
              kind: 'BATCH',
              confirmationType: 'CONFIRM_SELECTION',
              memberRefs: ['member-001', 'member-002'],
            },
          ],
          requestedMemberBasis: {
            kind: 'EXPLICIT_IDENTITIES',
            memberIds: [mid('member-001'), mid('member-002')],
          },
        }),
      ),
    );
    expectCode(assertSnapshotImmutable(original, drifted), 'MEMBERSHIP_DRIFT');
    const successor = decodeOk(
      deriveSuccessorSnapshot(original, 'COLLECTION_CHANGED', {
        newSnapshotId: decodeOk(makeSnapshotId('snapshot-refresh-001')),
        selectedMemberIds: [mid('member-001'), mid('member-002')],
        requestedMemberBasis: {
          kind: 'EXPLICIT_IDENTITIES',
          memberIds: [mid('member-001'), mid('member-002')],
        },
        selectionClaims: [
          {
            kind: 'BATCH',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: [mid('member-001'), mid('member-002')],
          },
        ],
      }),
    );
    expect(successor.supersedesSnapshotId).toBe(original.snapshotId);
  });

  it('C12: retry failed items — original failed member identities only', () => {
    const snapshot = confirmedSnapshot();
    const plan = decodeOk(planRetryOfFailedMembers(snapshot, ['member-002', 'member-003']));
    expect(plan).toEqual([mid('member-002'), mid('member-003')]);
    expectCode(
      planRetryOfFailedMembers(snapshot, ['member-002', 'member-new']),
      'MEMBERSHIP_DRIFT',
      'C12',
    );
  });

  it('C13: restart/repair/UI+CLI concurrency — inherited remaining budget, duplicate allocation rejected', () => {
    const profile = decodeOk(
      decodeBudgetProfile({
        discovery: { domain: 'discovery', maxGeneratedRequests: 10 },
        transfer: { domain: 'transfer', maxBytes: 1000 },
        globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 5000 },
      }),
    );
    const remaining = budgetRemaining(profile, {
      discovery: { generatedRequests: 4, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 400, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 1000 },
    });
    expect(remaining.discovery.perLimit['generatedRequests']).toBe(6);
    expect(canTransferAfterDiscoveryExhaustion(remaining)).toBe(true);
    const effect = decodeOk(makeEffectId('effect-ui-001'));
    expectCode(assertNoDuplicateAllocation([effect], effect), 'DUPLICATE_ALLOCATION', 'C13');
  });

  it('C14: discovered targets succeed while enumeration unfinished — Selection COMPLETE, Request PARTIAL, coverage not verified', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'UNKNOWN',
      stopReason: 'NO_PROGRESS',
    });
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 3,
          selectedValidationOutcomes: [
            { memberId: mid('member-001'), requiredValidationPassed: true },
            { memberId: mid('member-002'), requiredValidationPassed: true },
            { memberId: mid('member-003'), requiredValidationPassed: true },
          ],
          coverageEvidence: undefined,
        }),
      ),
    ).toBeUndefined();
  });

  it('C15: unsupported DASH/separate A/V needing mux — UNSUPPORTED/FAILED without false success projection', () => {
    const result = decodedTerminalResult({
      requestFulfillment: 'UNSATISFIED',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'FAILED',
      coverage: 'NOT_APPLICABLE',
      stopReason: 'UNSUPPORTED',
      validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 1 },
    });
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'SINGLE_RESOURCE',
          scopeKind: 'single_resource',
          selectedMemberCount: 1,
          selectedValidationOutcomes: [
            { memberId: mid('member-001'), requiredValidationPassed: false },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it('C16: simple task forced through unnecessary preview — single-resource contracts need no collection/snapshot fields', () => {
    const contract = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
    expect(contract.collectionIdentity).toBeUndefined();
    expect(contract.selectionSnapshotRef).toBeUndefined();
    expect(contract.requestedScope.kind).toBe('single_resource');
  });

  it('C17: batch succeeds but pagination untested — no cross-claim evidence promotion', () => {
    const batchEvidence = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              claimType: 'COVERAGE',
              scope: { domain: 'BATCH_DOWNLOAD' },
            }),
          ),
        ),
      ),
    );
    expectCode(
      assertEvidenceScopeNotPromoted(batchEvidence, 'CONTINUATION_NAVIGATION'),
      'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
      'C17',
    );
  });

  it('C18: same bytes in two chapters / same names different content — content identity never collapses member identity', () => {
    const chapter1 = decodeOk(makeMemberId('member-chapter-1'));
    const chapter2 = decodeOk(makeMemberId('member-chapter-2'));
    // identical blob digest across two members keeps two distinct logical members
    const blobEvidence1 = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              evidenceId: 'evidence-blob-1',
              claimSubject: { kind: 'MEMBER', ref: chapter1 },
              provenance: { sourceIdentity: 'blob/sha256-same-bytes' },
            }),
          ),
        ),
      ),
    );
    const blobEvidence2 = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              evidenceId: 'evidence-blob-2',
              claimSubject: { kind: 'MEMBER', ref: chapter2 },
              provenance: { sourceIdentity: 'blob/sha256-same-bytes' },
            }),
          ),
        ),
      ),
    );
    expect(blobEvidence1.claimSubject.ref).not.toBe(blobEvidence2.claimSubject.ref);
    expect(blobEvidence1.provenance.sourceIdentity).toBe(blobEvidence2.provenance.sourceIdentity);
  });

  it('C19: AI vs non-AI — same Tools/Auth/Budget/Context identity and independent truth required', () => {
    const aiEvidence = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              evidenceId: 'evidence-ai-001',
              provenance: {
                sourceIdentity: 'validator/parity-001',
                executionContext: {
                  toolsUsed: ['model-assisted-adaptation'],
                  authorizationContextRef: 'authctx/local-001',
                  budgetRefs: ['budget/discovery-001'],
                },
              },
            }),
          ),
        ),
      ),
    );
    expect(aiEvidence.provenance.executionContext).toEqual({
      toolsUsed: ['model-assisted-adaptation'],
      authorizationContextRef: 'authctx/local-001',
      budgetRefs: ['budget/discovery-001'],
    });
    // no AI authority special-case: discovery-derived AI output cannot self-certify either
    const aiDiscovery = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              sourceType: 'DISCOVERY_INFERENCE',
              provenance: { sourceIdentity: 'model/session-001' },
              independenceFromDiscovery: 'DISCOVERY_DERIVED',
            }),
          ),
        ),
      ),
    );
    expectCode(assertNoDiscoverySelfCertification(aiDiscovery, aiDiscovery), 'SELF_CERTIFICATION');
  });

  it('C20: local recipe replay on changed page/session/layout — reusable knowledge requires current validation', () => {
    const recipe = decodeOk(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/recipe-local-001',
        kind: 'PROMOTED_LOCAL_VERIFIED',
        applicableScopeKey: 'site/changed.example',
        requiresCurrentValidation: true,
      }),
    );
    expectCode(applyKnowledgeToContract(recipe, undefined), 'CURRENT_VALIDATION_REQUIRED', 'C20');
  });

  it('C21: shared knowledge on independent user account — opaque auth refs only, no raw-secret authority', () => {
    const contract = decodeOk(decodeAcquisitionContract(rawCollectionContract()));
    expect(typeof contract.authorizationContextRef).toBe('string');
    expectCode(
      decodeAcquisitionContract(rawCollectionContract({ password: 'hunter2' })),
      'RAW_SECRET_FIELD',
      'PRD-§29',
    );
    const knowledge = decodeOk(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/shared-001',
        kind: 'PROMOTED_LOCAL_VERIFIED',
        applicableScopeKey: 'scope/shared',
        requiresCurrentValidation: true,
      }),
    );
    expect(JSON.stringify(knowledge)).not.toMatch(/cookie|token|password/i);
  });

  it('C22: insufficient evidence — INSUFFICIENT_EVIDENCE is representable, never converted to PASS', () => {
    const thin = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              certaintyClass: 'INSUFFICIENT_EVIDENCE',
              claimType: 'COVERAGE',
              claimSubject: { kind: 'COVERAGE_TARGET', ref: 'coverage-001' },
              scope: { domain: 'COVERAGE' },
            }),
          ),
        ),
      ),
    );
    expectCode(assertValidatesRequiredLayer(thin, 'coverage'), 'INSUFFICIENT_EVIDENCE', 'C22');
  });

  it('C23: whole collection, pages 1–2 succeed, page 3 undiscovered (discovery budget) — exact legal tuple', () => {
    const two = ['member-001', 'member-002'].map((raw) => ({
      memberId: mid(raw),
      requiredValidationPassed: true,
    }));
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
    });
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 2,
          selectedValidationOutcomes: two,
          coverageEvidence: { kind: 'INSUFFICIENT', basis: 'BUDGET_EXHAUSTED' },
        }),
      ),
    ).toBeUndefined();
  });

  it('C24: auth failure yields no targets — exact UNSATISFIED/BLOCKED/NOT_STARTED/UNKNOWN tuple', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'UNSATISFIED',
      targetResolution: 'BLOCKED',
      selectionAcquisition: 'NOT_STARTED',
      coverage: 'UNKNOWN',
      stopReason: 'AUTH_REQUIRED',
      validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
    });
    expect(
      decodeOk(
        validateTerminalResult(result, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 0,
          selectedValidationOutcomes: [],
          coverageEvidence: undefined,
        }),
      ),
    ).toBeUndefined();
  });

  it('C25: parent 10 pages, user requests 1–3 — CoverageTarget binds 1..3 only', () => {
    const requested = pageRangeScope('collection/parent-010', 1, 3);
    const parent = entireCollectionScope('collection/parent-010');
    expect(scopeIdentityKey(requested)).toBe('collection_page_range:collection/parent-010:1..3');
    expect(scopeIdentityKey(requested)).not.toBe(scopeIdentityKey(parent));
  });

  it('C26: user confirms system-labeled "original" — click proves selection only; QUALITY stays unverified', () => {
    const confirmation = decodeOk(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              evidenceId: 'evidence-confirm-quality-001',
              claimType: 'SELECTION',
              claimSubject: { kind: 'MEMBER', ref: 'member-001' },
              sourceType: 'USER_CONFIRMATION',
              provenance: { sourceIdentity: 'user/session-001' },
            }),
          ),
        ),
      ),
    );
    expectCode(
      assertValidatesRequiredLayer(confirmation, 'media'),
      'CONFIRMATION_CANNOT_WAIVE_VALIDATION',
      'PRD-§21',
    );
    expect(whatConfirmationProves('CONFIRM_QUALITY_CHOICE').proves).toBe('SELECTION');
  });

  it('C27: confirmed candidate transfer truncated / track missing — confirmation does not waive validation', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'PARTIAL',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(result, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 3,
        selectedValidationOutcomes: [
          { memberId: mid('member-001'), requiredValidationPassed: true },
          { memberId: mid('member-002'), requiredValidationPassed: false },
          { memberId: mid('member-003'), requiredValidationPassed: true },
        ],
      }),
      'INVALID_RESULT_COMBINATION',
      'C27',
    );
  });

  it('C28: discovery budget exhausted, frozen HLS target still needs segments — transfer continues if budgets remain', () => {
    const profile = decodeOk(
      decodeBudgetProfile({
        discovery: { domain: 'discovery', maxGeneratedRequests: 1 },
        transfer: { domain: 'transfer', maxSegments: 100 },
        globalSafety: { domain: 'global_safety', maxActiveElapsedMs: 10_000 },
      }),
    );
    const remaining = budgetRemaining(profile, {
      discovery: { generatedRequests: 1, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 10, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 1, modelCostUnits: 0, activeElapsedMs: 100 },
    });
    expect(canStartNewDiscoveryWork(remaining)).toBe(false);
    expect(canTransferAfterDiscoveryExhaustion(remaining)).toBe(true);
  });

  it('C29: current-page attachment redirects to declared CDN — provenance-bound transition keeps target; unrelated one rejects', () => {
    const target = decodeOk(makeLogicalTargetId('target-attachment-001'));
    const pageAttachment = { kind: 'direct' as const, uri: 'https://site.example/page' };
    const cdn = { kind: 'cdn' as const, uri: 'https://cdn.example/attachment' };
    const original = decodeOk(
      bindLocator(pageAttachment, target, {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: pageAttachment.uri,
      }),
    );
    const preserved = decodeOk(
      assertLocatorTransitionPreservesTarget(original, cdn, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: pageAttachment.uri,
      }),
    );
    expect(preserved.identity).toBe(target);
    expectCode(
      assertLocatorTransitionPreservesTarget(original, cdn, {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://elsewhere.example/unrelated',
      }),
      'LOCATOR_SUBSTITUTION_REJECTED',
    );
  });

  it('C30: 50 candidate confirmations vs batch selection — one batch claim set is representable', () => {
    const fifty = Array.from(
      { length: 50 },
      (_, i) => `member-batch-${String(i + 1).padStart(3, '0')}`,
    );
    const snapshot = decodeOk(
      decodeSelectionSnapshot(
        rawSnapshot({
          requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: fifty },
          selectedMemberIds: fifty,
          selectionClaims: [
            { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: fifty },
          ],
        }),
      ),
    );
    expect(snapshot.selectionClaims).toHaveLength(1);
    expect(snapshot.selectionClaims[0]!.memberRefs).toHaveLength(50);
  });

  it('C31: prior 12-of-18 selection reused on a different page — task-local selection is not reusable membership authority', () => {
    const selection = decodeOk(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/task-9-selection-12of18',
        kind: 'TASK_LOCAL_SELECTION',
        applicableScopeKey: 'collection/other-page-001',
        requiresCurrentValidation: true,
      }),
    );
    expectCode(applyKnowledgeToContract(selection, undefined), 'KNOWLEDGE_NOT_REUSABLE', 'C31');
  });

  it('C32: gate set includes failure, abandonment, UNKNOWN, out-of-scope — distinct non-success classes preserved', () => {
    expect(aggregateConfirmationOutcomes(['FAILED', 'ABANDONED', 'UNKNOWN', 'OUT_OF_SCOPE'])).toBe(
      'FAILED',
    );
    expect(aggregateConfirmationOutcomes(['ABANDONED', 'UNKNOWN', 'OUT_OF_SCOPE'])).toBe(
      'ABANDONED',
    );
    expect(aggregateConfirmationOutcomes(['UNKNOWN', 'OUT_OF_SCOPE'])).toBe('OUT_OF_SCOPE');
    expect(aggregateConfirmationOutcomes(['UNKNOWN'])).toBe('UNKNOWN');
    expect(aggregateConfirmationOutcomes(['CONFIRMED'])).toBe('CONFIRMED');
  });

  it('C33: phase B opened, then protocol/baseline changed — prior run invalid, new independent run required', () => {
    expectCode(
      assertBaselineIdentityUnchanged(
        { baselineId: 'g0-baseline-a', version: 1 },
        { baselineId: 'g0-baseline-a', version: 2 },
      ),
      'BASELINE_IDENTITY_CHANGED',
      'C33',
    );
  });

  it('C34: UI suggestion used as ground truth — suggestion provenance can never be independent truth', () => {
    expectCode(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify(
            evidence({
              sourceType: 'UI_SUGGESTION',
              provenance: { sourceIdentity: 'ui/ground-truth-claim' },
              independenceFromDiscovery: 'INDEPENDENT',
            }),
          ),
        ),
      ),
      'SELF_CERTIFICATION',
      'C34',
    );
  });
});
