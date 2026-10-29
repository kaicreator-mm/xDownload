/**
 * T011 counterexample oracle fixtures — every applicable C01–C34 collection
 * oracle from TEST_MATRIX.yaml (`t011_oracle` column), executable on the
 * engine. Oracle boundary: C02/C09/C13/C15-C19/C21/C22/C24/C32/C33 are owned
 * at other concern layers; where T011 consumes/produces their inputs it
 * preserves the canonical identities and truthful values (C32/C34 boundary
 * assertions included below).
 */
import { describe, expect, it } from 'vitest';
import {
  assertSnapshotImmutable,
  canServeAsIndependentValidationOracle,
  createDomainGateway,
  decodeContinuationScope,
  decodeEvidenceRecord,
  decodeRequestedScope,
  deriveSuccessorSnapshot,
  makeSnapshotId,
  scopeIdentityKey,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  accountRequestedScope,
  admitContinuationRequest,
  assertSelectionKnowledgeReusable,
  classifyDiscoveryOutcome,
  coverageEvidenceForAccounting,
  decodeCapabilityList,
  decodePlannedCapabilities,
  detectFrozenMembershipDrift,
  initiateDiscovery,
  planConfirmationWorkflow,
  planFailedMemberRetry,
  planRecipeExecution,
  recordConfirmation,
  resolveMemberDeliveryHop,
  selectionAcquisitionComplete,
  stepDiscovery,
} from '../src/index.ts';
import {
  GALLERY_OBSERVATIONS,
  asMembers,
  budgetsDiscoveryExhausted,
  budgetsOpen,
  confirmedCurrentPageContract,
  confirmedFiniteSetContract,
  confirmedPageRangeContract,
  confirmedPlaylistContract,
  galleryRecipe,
  independentEvidence,
  snapshotFor,
} from './fixtures.ts';
import { bindLocator } from '@xdownload/domain-contracts';

describe('T011 collection oracles (TEST_MATRIX t011_oracle)', () => {
  it('C01 — duplicate-replaces-missing with equal count: accounting rejects VERIFIED_COMPLETE; identity correspondence required', () => {
    const accounting = accountRequestedScope({
      requestedMemberIds: ['member-1', 'member-2', 'member-3'],
      acquiredValidatedIds: ['member-1', 'member-2', 'member-2'],
    });
    expect(accounting.duplicateReplacesMissingDetected).toBe(true);
    const evidence = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: { kind: 'USER_DECLARED_FINITE_SET' },
    });
    expect(evidence.kind).toBe('INSUFFICIENT');
  });

  it('C03 — next page fails / control missing / pagination loops: not natural end; truthful stop and UNKNOWN-or-TRUNCATED', () => {
    const contract = confirmedPageRangeContract(1, 4);
    const snapshot = snapshotFor(contract, ['member-p1']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const failedPage = stepDiscovery(contract, session, { kind: 'PAGE_FAILED' }, budgetsOpen);
    expect(failedPage.state.stop?.kind).toBe('CONTINUATION_UNCLOSABLE');
    const missingControl = stepDiscovery(
      contract,
      session,
      { kind: 'NEXT_CONTROL_MISSING' },
      budgetsOpen,
    );
    expect(missingControl.state.stop?.kind).toBe('CONTINUATION_UNCLOSABLE');
    const looped = stepDiscovery(
      contract,
      session,
      { kind: 'PAGE_OBSERVED', logicalPage: 2, pageIdentity: 'dup-sig' },
      budgetsOpen,
    );
    const loopClosed = stepDiscovery(
      contract,
      looped.state,
      { kind: 'PAGE_OBSERVED', logicalPage: 3, pageIdentity: 'dup-sig' },
      budgetsOpen,
    );
    expect(loopClosed.state.stop).toEqual({
      kind: 'CONTINUATION_UNCLOSABLE',
      cause: 'PAGINATION_LOOP',
    });
    for (const stopped of [failedPage.state, missingControl.state, loopClosed.state]) {
      const outcome = classifyDiscoveryOutcome(stopped, {
        allFrozenSelectedSucceeded: true,
        requestedScopeFullyAccounted: false,
      });
      expect(outcome.coverage === 'TRUNCATED' || outcome.coverage === 'UNKNOWN').toBe(true);
      expect(outcome.stopReason).not.toBe('NATURAL_COLLECTION_END');
    }
  });

  it('C04 — supported finite collection reaches validated natural end: admission path exists; VERIFIED_COMPLETE requires closure evidence', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_NATURAL_END' });
    const snapshot = snapshotFor(contract, ['member-01']);
    const session = initiateDiscovery({
      contract: contract,
      snapshot: snapshot,
      naturalEndRelation: { declaredByTemplate: true, templateRef: 'template/playlist-v1' },
    });
    expect(session.ok).toBe(true);
    const accounting = accountRequestedScope({
      requestedMemberIds: ['member-01', 'member-02'],
      acquiredValidatedIds: ['member-01', 'member-02'],
    });
    const withClosure = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: {
        kind: 'DECLARED_TOTAL_WITH_CLOSURE',
        declaredTotal: 2,
        closure: 'NATURAL_END_VALIDATED',
      },
    });
    expect(withClosure.kind).toBe('SUFFICIENT');
    const withoutClosure = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: { kind: 'NO_CLOSURE', reason: 'NO_MORE_FOUND_WITHOUT_CLOSURE' },
    });
    expect(withoutClosure.kind).toBe('INSUFFICIENT');
  });

  it('C05 — user selects 5 of a larger collection, all succeed: exact C05 tuple, no parent-collection claim', () => {
    const five = ['pick-1', 'pick-2', 'pick-3', 'pick-4', 'pick-5'];
    const contract = confirmedFiniteSetContract(five);
    expect(contract.selectionPolicy.basis).toBe('EXPLICIT_USER_SELECTION');
    const snapshot = snapshotFor(contract, five);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    let state = session;
    for (const id of five) {
      state = stepDiscovery(
        contract,
        state,
        { kind: 'MEMBER_OBSERVED', memberId: id, basis: 'FROZEN_BASIS' },
        budgetsOpen,
      ).state;
    }
    expect(state.status).toBe('STOPPED');
    const accounting = accountRequestedScope({
      requestedMemberIds: five,
      acquiredValidatedIds: five,
    });
    const evidence = coverageEvidenceForAccounting({
      accounting: accounting,
      closure: { kind: 'USER_DECLARED_FINITE_SET' },
    });
    expect(evidence.kind).toBe('SUFFICIENT');
    const outcome = classifyDiscoveryOutcome(state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    expect(outcome).toEqual({
      requestFulfillment: 'COMPLETE',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SELECTION_COMPLETE',
    });
  });

  it('C06 — first-1000-pages-under-domain-all-PDFs: rejected as arbitrary frontier before any discovery action', () => {
    const scope = decodeRequestedScope({
      kind: 'crawl_domain',
      domain: 'example.com',
      maxPages: 1000,
      filter: 'pdf',
    });
    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.diagnostics[0]?.invariant).toBe('PRD-§9');
    }
    const gateway = createDomainGateway();
    const submitted = gateway.submitContract({
      ...(confirmedPlaylistContract() as unknown as Record<string, unknown>),
      requestedScope: { kind: 'crawl_domain', domain: 'example.com' },
    });
    expect(submitted.ok).toBe(false);
  });

  it('C07 — confirmed member requires detail page/CDN: only traceable paths followed; provenance retained; identity stable', () => {
    const memberPage = unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: 'https://x.test/item/7' }, 'member-7', {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://x.test/gallery',
      }),
    );
    const cdn = resolveMemberDeliveryHop({
      memberLocator: memberPage,
      nextLocator: { kind: 'cdn', uri: 'https://cdn.x.test/item/7.bin' },
      nextProvenance: {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://x.test/item/7',
      },
    });
    expect(cdn.ok).toBe(true);
    if (cdn.ok) expect(cdn.value.identity).toBe('member-7');
    const unrelated = resolveMemberDeliveryHop({
      memberLocator: memberPage,
      nextLocator: { kind: 'redirect', uri: 'https://ads.example/x' },
      nextProvenance: {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://ads.example/y',
      },
    });
    expect(unrelated.ok).toBe(false);
  });

  it('C08 — page-range 1..3 with iframe/load-more/detail, no continuation permission: scope exact; load-more needs successor', () => {
    const contract = confirmedPageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, ['m-p1-a', 'm-p2-a', 'm-p3-a']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const detail = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_DETAIL_PAGE_OBSERVED', memberId: 'm-p1-a' },
      budgetsOpen,
    );
    const iframe = stepDiscovery(
      contract,
      detail.state,
      { kind: 'IFRAME_CONTENT_OBSERVED', frameIdentity: 'frame-1' },
      budgetsOpen,
    );
    const loadMore = stepDiscovery(
      contract,
      iframe.state,
      { kind: 'LOAD_MORE_CONTROL_OBSERVED' },
      budgetsOpen,
    );
    expect(loadMore.state.pagesVisited).toEqual([]);
    const edgeMember = stepDiscovery(
      contract,
      loadMore.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'm-p4-edge', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(edgeMember.rejections[0]?.kind).toBe('CONTINUATION_NOT_AUTHORIZED');
    expect(
      admitContinuationRequest({
        contract: contract,
        requestKind: 'LOAD_MORE',
        declaredBoundConsumed: false,
      }),
    ).toEqual({ decision: 'SUCCESSOR_REQUIRED', reason: 'CONTINUATION_SCOPE_NONE' });
  });

  it('C10 — whole collection 18, auth acquires 16, two known inaccessible: 16+2 accounted, scope remains 18, §17.2 tuple', () => {
    const eighteen = Array.from(
      { length: 18 },
      (_, i) => `coll-member-${String(i + 1).padStart(2, '0')}`,
    );
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, eighteen);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    let state = session;
    for (const id of eighteen.slice(0, 16)) {
      state = stepDiscovery(
        contract,
        state,
        { kind: 'MEMBER_OBSERVED', memberId: id, basis: 'FROZEN_BASIS' },
        budgetsOpen,
      ).state;
    }
    state = stepDiscovery(
      contract,
      state,
      { kind: 'MEMBER_AUTH_INACCESSIBLE', memberId: eighteen[16]! },
      budgetsOpen,
    ).state;
    state = stepDiscovery(
      contract,
      state,
      { kind: 'MEMBER_AUTH_INACCESSIBLE', memberId: eighteen[17]! },
      budgetsOpen,
    ).state;
    state = stepDiscovery(
      contract,
      state,
      { kind: 'COLLECTION_ENUMERATION_CLOSED' },
      budgetsOpen,
    ).state;
    const accounting = accountRequestedScope({
      requestedMemberIds: eighteen,
      acquiredValidatedIds: eighteen.slice(0, 16),
      inaccessibleMembers: [
        {
          memberId: eighteen[16]!,
          evidence: independentEvidence(
            'evidence-inaccessible-16',
            {
              kind: 'MEMBER',
              ref: eighteen[16]!,
            },
            'AUTHORIZATION',
          ),
        },
        {
          memberId: eighteen[17]!,
          evidence: independentEvidence(
            'evidence-inaccessible-17',
            {
              kind: 'MEMBER',
              ref: eighteen[17]!,
            },
            'AUTHORIZATION',
          ),
        },
      ],
    });
    expect(accounting.requestedAccountedCount).toBe(18);
    expect(accounting.acquiredValidatedIds).toHaveLength(16);
    expect(accounting.knownInaccessibleIds).toHaveLength(2);
    const outcome = classifyDiscoveryOutcome(state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    // Exact §17.2 tuple: PARTIAL / RESOLVED / COMPLETE / VERIFIED_COMPLETE / AUTH_REQUIRED.
    expect(outcome).toEqual({
      requestFulfillment: 'PARTIAL',
      targetResolution: 'RESOLVED',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'AUTH_REQUIRED',
    });
  });

  it('C11 — collection changes after preview: snapshot cannot silently drift; refresh creates successor snapshot', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['member-1', 'member-2', 'member-3']);
    const drift = detectFrozenMembershipDrift({
      snapshot: snapshot,
      currentlyObservedMemberIds: ['member-1', 'member-2', 'member-9'],
    });
    expect(drift.ok).toBe(false);
    const successor = unwrapOrThrow(
      deriveSuccessorSnapshot(snapshot, 'COLLECTION_CHANGED', {
        newSnapshotId: unwrapOrThrow(makeSnapshotId('snapshot-refresh-c11')),
        selectedMemberIds: asMembers(['member-1', 'member-2', 'member-9']),
        selectionClaims: [
          {
            kind: 'BATCH',
            confirmationType: 'CONFIRM_SELECTION',
            memberRefs: asMembers(['member-1', 'member-2', 'member-9']),
          },
        ],
      }),
    );
    expect(successor.supersedesSnapshotId).toBe(snapshot.snapshotId);
    // Same-identity mutation remains forbidden.
    const mutated = {
      ...snapshot,
      selectedMemberIds: asMembers(['member-1', 'member-2', 'member-9']),
    };
    expect(assertSnapshotImmutable(snapshot, mutated as typeof snapshot).ok).toBe(false);
  });

  it('C12 — retry failed items: retry domain is original failed identities only; no new/replacement members', () => {
    const contract = confirmedFiniteSetContract(['r-1', 'r-2', 'r-3']);
    const snapshot = snapshotFor(contract, ['r-1', 'r-2', 'r-3']);
    const retry = planFailedMemberRetry({ snapshot: snapshot, failedMemberIds: ['r-2'] });
    expect(retry.ok).toBe(true);
    const replacement = planFailedMemberRetry({ snapshot: snapshot, failedMemberIds: ['r-new'] });
    expect(replacement.ok).toBe(false);
  });

  it('C14 — discovered targets succeed but enumeration unfinished: selection COMPLETE, request PARTIAL, coverage not VERIFIED_COMPLETE', () => {
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, ['frozen-1', 'frozen-2']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const discovered = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_OBSERVED', memberId: 'frozen-1', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    const stopped = stepDiscovery(
      contract,
      discovered.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'never-resolved', basis: 'FROZEN_BASIS' },
      budgetsDiscoveryExhausted,
    );
    const outcome = classifyDiscoveryOutcome(stopped.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: false,
    });
    expect(outcome.selectionAcquisition).toBe('COMPLETE');
    expect(outcome.requestFulfillment).toBe('PARTIAL');
    expect(outcome.coverage).not.toBe('VERIFIED_COMPLETE');
    expect(outcome.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
  });

  it('C20 — local recipe replay on changed page/session/layout revalidates; cached membership cannot overwrite the contract', () => {
    const recipe = galleryRecipe();
    const contract = confirmedPlaylistContract();
    const stalePlan = planRecipeExecution(recipe, contract, GALLERY_OBSERVATIONS, {
      scopeIdentityKey: 'entire_supported_collection:collection/playlist-042',
      frozenMemberIds: ['cached-member'],
    });
    expect(stalePlan.matched).toBe(true);
    const changedLayout = planRecipeExecution(
      recipe,
      contract,
      { pageKind: 'gallery', galleryTemplate: 'v2-redesign' },
      {
        scopeIdentityKey: 'entire_supported_collection:collection/playlist-042',
        frozenMemberIds: ['cached-member'],
      },
    );
    expect(changedLayout.matched).toBe(false);
    expect(changedLayout.steps).toEqual([]);
    expect(changedLayout.fallback?.kind).toBe('ASK_USER');
  });

  it('C23 — whole collection, pages 1–2 targets succeed, page 3 undiscovered due budget: exact tuple, never natural end/user scope', () => {
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, ['page1-a', 'page2-a']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const resolved1 = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_OBSERVED', memberId: 'page1-a', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    const stopped = stepDiscovery(
      contract,
      resolved1.state,
      { kind: 'MEMBER_OBSERVED', memberId: 'page3-undiscovered', basis: 'FROZEN_BASIS' },
      budgetsDiscoveryExhausted,
    );
    expect(stopped.state.stop).toEqual({ kind: 'DISCOVERY_BUDGET_EXHAUSTED' });
    const outcome = classifyDiscoveryOutcome(stopped.state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    expect(outcome).toEqual({
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'TRUNCATED',
      stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
    });
  });

  it('C25 — parent 10 pages, user requests 1–3, all requested succeed: CoverageTarget binds pages 1–3 only', () => {
    const contract = confirmedPageRangeContract(1, 3);
    const snapshot = snapshotFor(contract, ['pp-1', 'pp-2', 'pp-3']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    expect(scopeIdentityKey(contract.requestedScope)).toBe(
      'collection_page_range:collection/gallery-007:1..3',
    );
    let state = session;
    for (const page of [1, 2, 3]) {
      state = stepDiscovery(
        contract,
        state,
        { kind: 'PAGE_OBSERVED', logicalPage: page, pageIdentity: `sig-p${String(page)}` },
        budgetsOpen,
      ).state;
    }
    expect(state.stop).toEqual({ kind: 'USER_SCOPE_REACHED' });
    const outcome = classifyDiscoveryOutcome(state, {
      allFrozenSelectedSucceeded: true,
      requestedScopeFullyAccounted: true,
    });
    expect(outcome.coverage).toBe('VERIFIED_COMPLETE');
    expect(outcome.stopReason).toBe('USER_SCOPE_REACHED');
  });

  it('C26 — user confirms a system-labeled original without enough information: selection claim only, no quality evidence', () => {
    const record = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'SINGLE',
        confirmationType: 'CONFIRM_QUALITY_CHOICE',
        memberRefs: asMembers(['candidate-original']),
        outcomes: ['CONFIRMED'],
      }),
    );
    expect(record.proves).toBe('SELECTION');
    expect(record.doesNotProve).toContain('QUALITY');
  });

  it('C27 — confirmed candidate transfer truncated/track missing: confirmation does not waive validation layers', () => {
    const confirmation = unwrapOrThrow(
      recordConfirmation({
        claimKind: 'SINGLE',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: asMembers(['member-a']),
        outcomes: ['CONFIRMED'],
      }),
    );
    expect(confirmation.proves).toBe('SELECTION');
    const decision = selectionAcquisitionComplete({
      requiredLayers: ['transfer', 'media'],
      evidenceByLayer: {
        // Only confirmation-shaped records exist: they cannot satisfy the layers.
        transfer: [],
        media: [],
      },
      anyValidationFailed: true,
    });
    expect(decision.decision).toBe('NOT_COMPLETE');
  });

  it('C28 — discovery budget exhausted, frozen target still needs work: frozen targets stay eligible downstream', () => {
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, ['hls-target']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const stopped = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_OBSERVED', memberId: 'hls-new', basis: 'FROZEN_BASIS' },
      budgetsDiscoveryExhausted,
    );
    expect(stopped.state.stop).toEqual({ kind: 'DISCOVERY_BUDGET_EXHAUSTED' });
    // Frozen selected target remains: downstream transfer eligibility is
    // decided by TransferBudget/GlobalSafetyBudget precedence only.
    expect(stopped.state.frozenMemberIds).toContain('hls-target');
  });

  it('C29 — current-page attachment redirects to declared CDN: provenance-bound delivery followed; unrelated redirect rejected', () => {
    const attachment = unwrapOrThrow(
      bindLocator({ kind: 'direct', uri: 'https://x.test/page/file-a' }, 'member-a', {
        binding: 'MEMBER_DELIVERY_EDGE',
        originLocatorUri: 'https://x.test/page',
      }),
    );
    const declared = resolveMemberDeliveryHop({
      memberLocator: attachment,
      nextLocator: { kind: 'cdn', uri: 'https://cdn.x.test/file-a' },
      nextProvenance: {
        binding: 'DECLARED_DELIVERY_EDGE',
        originLocatorUri: 'https://x.test/page/file-a',
      },
    });
    expect(declared.ok).toBe(true);
    if (declared.ok) expect(declared.value.identity).toBe('member-a');
    const unrelated = resolveMemberDeliveryHop({
      memberLocator: attachment,
      nextLocator: { kind: 'redirect', uri: 'https://elsewhere.example/file' },
      nextProvenance: {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: 'https://elsewhere.example/origin',
      },
    });
    expect(unrelated.ok).toBe(false);
  });

  it('C30 — 50 candidates vs batch/manual selection: one surface resolves; per-item burden is not the default', () => {
    const candidates = Array.from(
      { length: 50 },
      (_, i) => `cand-${String(i + 1).padStart(2, '0')}`,
    );
    const contract = confirmedFiniteSetContract(candidates, { automationMode: 'ASSISTED' });
    const plan = planConfirmationWorkflow({
      contract: contract,
      ambiguousMaterialMemberIds: candidates,
      candidateCount: 50,
      autoEvidenceSufficient: false,
    });
    expect(plan.requests).toHaveLength(1);
    expect(plan.perItemInterrogationUsed).toBe(false);
  });

  it('C31 — prior 12-of-18 selection reused on a different page: not membership authority without distinct validated provenance', () => {
    // Task-local selection replayed as membership authority fails closed...
    const taskLocal = {
      knowledgeId: 'knowledge/task-selection-12-of-18',
      kind: 'TASK_LOCAL_SELECTION',
      applicableScopeKey: 'current_page:collection/similar-page-002',
      requiresCurrentValidation: true,
    } as const;
    const currentEvidence = independentEvidence(
      'evidence-current-page-002-coverage',
      { kind: 'COVERAGE_TARGET', ref: 'coverage/similar-page-002' },
      'COVERAGE',
    );
    const replayed = assertSelectionKnowledgeReusable({
      knowledge: taskLocal,
      currentValidationEvidence: currentEvidence,
    });
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.diagnostics[0]?.invariant).toBe('C31');
    }
    // The confirmation workflow never seeds selections from prior task
    // knowledge either: an AUTO contract without sufficient current evidence
    // escalates instead of reusing the prior selection.
    const decision = planConfirmationWorkflow({
      contract: confirmedFiniteSetContract(['x-1'], { automationMode: 'AUTO' }),
      ambiguousMaterialMemberIds: [],
      candidateCount: 1,
      autoEvidenceSufficient: false,
    });
    expect(decision.escalationReason).toBe('INSUFFICIENT_AUTO_EVIDENCE');
  });

  it('C34 — UI discovery suggestion used as ground truth: DISCOVERY_DERIVED only, never an independent oracle', () => {
    const contract = confirmedPlaylistContract();
    const snapshot = snapshotFor(contract, ['sg-1']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const step = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_OBSERVED', memberId: 'sg-1', basis: 'FROZEN_BASIS' },
      budgetsOpen,
    );
    expect(step.admittedMemberId).toBe('sg-1');
    // Membership admission by discovery is DISCOVERY_DERIVED evidence; it can
    // never be typed as independent validation truth for the same claim.
    const doctored = decodeEvidenceRecord({
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      evidenceId: 'evidence-doctored-1',
      claimType: 'MEMBERSHIP',
      claimSubject: { kind: 'MEMBER', ref: 'sg-1' },
      sourceType: 'DISCOVERY_INFERENCE',
      provenance: { sourceIdentity: 'discovery:t011-engine' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'MEMBERSHIP', contractRef: 'contract-s6-playlist' },
      certaintyClass: 'DECISIVE',
    });
    expect(doctored.ok).toBe(false);
    const suggestionShaped = {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      evidenceId: 'evidence-suggestion-1',
      claimType: 'MEMBERSHIP',
      claimSubject: { kind: 'MEMBER', ref: 'sg-1' },
      sourceType: 'UI_SUGGESTION',
      provenance: { sourceIdentity: 'ui:suggestion' },
      independenceFromDiscovery: 'DISCOVERY_DERIVED',
      scope: { domain: 'MEMBERSHIP' },
      certaintyClass: 'SUGGESTIVE',
    };
    const decoded = decodeEvidenceRecord(suggestionShaped);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(canServeAsIndependentValidationOracle(decoded.value)).toBe(false);
    }
  });
});

describe('T011 negative coverage (TEST_MATRIX negative_coverage)', () => {
  it('frontier/crawl scope through recipe capability or continuation is rejected', () => {
    expect(decodeCapabilityList(['crawl_site'], 'x').ok).toBe(false);
    expect(decodeContinuationScope({ kind: 'CRAWL_FRONTIER' }).ok).toBe(false);
  });

  it('continuation width is never derived from discovery budget', () => {
    const contract = confirmedPlaylistContract({}, { kind: 'DECLARED_BATCH_COUNT', count: 2 });
    const snapshot = snapshotFor(contract, ['b-0']);
    // Wide-open budget cannot extend the bound beyond count=2...
    let state = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    state = stepDiscovery(
      contract,
      state,
      { kind: 'MEMBER_OBSERVED', memberId: 'b-1', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    ).state;
    state = stepDiscovery(
      contract,
      state,
      { kind: 'MEMBER_OBSERVED', memberId: 'b-2', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    ).state;
    const third = stepDiscovery(
      contract,
      state,
      { kind: 'MEMBER_OBSERVED', memberId: 'b-3', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(third.rejections[0]?.kind).toBe('DECLARED_BOUND_REACHED');
  });

  it('member added to continuation_scope=NONE contract without successor is rejected', () => {
    const contract = confirmedCurrentPageContract();
    const snapshot = snapshotFor(contract, ['n-1']);
    const session = unwrapOrThrow(initiateDiscovery({ contract: contract, snapshot: snapshot }));
    const step = stepDiscovery(
      contract,
      session,
      { kind: 'MEMBER_OBSERVED', memberId: 'n-2', basis: 'CONTINUATION_EDGE' },
      budgetsOpen,
    );
    expect(step.admittedMemberId).toBeUndefined();
  });

  it('unknown/undeclared capability and imperative recipe body fail closed', () => {
    expect(decodeCapabilityList(['run_arbitrary_shell'], 'x').ok).toBe(false);
    expect(
      decodePlannedCapabilities([{ kind: 'open_confirmed_member_detail', memberId: 'ghost' }], [])
        .ok,
    ).toBe(false);
  });

  it('unsupported scope primitive or continuation form is rejected at admission', () => {
    expect(decodeRequestedScope({ kind: 'host_scan' }).ok).toBe(false);
    expect(decodeContinuationScope({ kind: 'UNTIL_BUDGET_OUT' }).ok).toBe(false);
  });
});
