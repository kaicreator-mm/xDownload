/**
 * The frozen C01–C34 oracle records as raw decodable data (frozen PRD §35;
 * TEST_MATRIX `counterexample_oracles`).
 *
 * Records are deliberately plain (untrusted-shaped) objects so every load
 * exercises the fail-closed decode path. `requiredBehavior` is the verbatim
 * frozen PRD §35 row text. Expected tuples/rules bind canonical status
 * literals validated against `@xdownload/domain-contracts` at load time.
 */

import { deepFreeze } from '@xdownload/domain-contracts';

const PRD = 'docs/product/PRD-v0.4.2-review-candidate.md';

function truth(ref: string): unknown {
  return { kind: 'PRE_REGISTERED_EXPECTATION_REGISTRY', ref };
}

function rule(
  field: string,
  value: string,
  polarity: 'MUST' | 'MAY' | 'MUST_NOT',
  canonicalRuleRef: string,
): unknown {
  return { field, value, polarity, prdRef: 'PRD-§35', canonicalRuleRef };
}

function tuple(
  requestFulfillment: string,
  targetResolution: string,
  selectionAcquisition: string,
  coverage: string,
  stopReason: string,
  validationSummary: {
    readonly status: string;
    readonly passedCount: number;
    readonly failedCount: number;
  },
): unknown {
  return {
    requestFulfillment,
    targetResolution,
    selectionAcquisition,
    coverage,
    stopReason,
    validationSummary,
  };
}

const RECORDS: readonly unknown[] = deepFreeze([
  {
    oracleId: 'C01',
    scenario: 'duplicate-replaces-missing-member-count-equal',
    prdRef: 'PRD-§35#C01',
    requiredBehavior: 'No `VERIFIED_COMPLETE`; identity correspondence required.',
    target: 'requested-scope coverage accounting under member substitution',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/explicit-gallery' },
    truthSource: truth(`${PRD}#35/C01`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C01)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C02',
    scenario: 'requested-150-safety-cap-stops-100',
    prdRef: 'PRD-§35#C02',
    requiredBehavior: 'Request PARTIAL; Resolution PARTIAL; Coverage TRUNCATED; never complete.',
    target: 'global safety cap exhaustion on a 150-member explicit set',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/large-member-set' },
    truthSource: truth(`${PRD}#35/C02`),
    expectedTuples: [
      tuple('PARTIAL', 'PARTIAL', 'COMPLETE', 'TRUNCATED', 'GLOBAL_SAFETY_LIMIT', {
        status: 'ALL_PASSED',
        passedCount: 100,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [
      rule(
        'requestFulfillment',
        'COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C02/PRD-§15.4)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C03',
    scenario: 'next-page-fails-missing-control-or-loop',
    prdRef: 'PRD-§35#C03',
    requiredBehavior: 'Not natural end; Coverage UNKNOWN/TRUNCATED with truthful StopReason.',
    target: 'declared continuation that fails, is missing its control, or loops',
    scopeRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    truthSource: truth(`${PRD}#35/C03`),
    expectedTuples: [],
    ruleAssertions: [
      rule('coverage', 'UNKNOWN', 'MAY', 'domain-contracts#CoverageEvidence(FAILED_NEXT_PAGE)'),
      rule('coverage', 'TRUNCATED', 'MAY', 'domain-contracts#CoverageEvidence(PAGINATION_LOOP)'),
      rule(
        'stopReason',
        'NATURAL_COLLECTION_END',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(PRD-§19)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C04',
    scenario: 'finite-collection-valid-natural-end',
    prdRef: 'PRD-§35#C04',
    requiredBehavior: '`VERIFIED_COMPLETE` only with identity/membership closure evidence.',
    target: 'supported finite collection reaching an independently validated natural end',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s6-playlist' },
    truthSource: truth(`${PRD}#35/C04`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST',
        'domain-contracts#CoverageEvidence(DECLARED_TOTAL_WITH_CLOSURE)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C05',
    scenario: 'user-selects-five-before-confirmation-all-five-succeed',
    prdRef: 'PRD-§35#C05',
    requiredBehavior:
      'Exact tuple: Request COMPLETE; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop USER_SELECTION_COMPLETE. Parent collection completeness is not implied.',
    target: 'explicit 5-of-larger selection confirmed before acquisition',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/current-page-attachments' },
    truthSource: truth(`${PRD}#35/C05`),
    expectedTuples: [
      tuple('COMPLETE', 'RESOLVED', 'COMPLETE', 'VERIFIED_COMPLETE', 'USER_SELECTION_COMPLETE', {
        status: 'ALL_PASSED',
        passedCount: 5,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [],
    gateRefs: [],
  },
  {
    oracleId: 'C06',
    scenario: 'first-1000-pages-under-domain-all-pdfs',
    prdRef: 'PRD-§35#C06',
    requiredBehavior: 'Reject Collection admission as arbitrary frontier.',
    target: 'collection admission boundary for domain-crawl scopes',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/admission-frontier-probe' },
    truthSource: truth(`${PRD}#35/C06`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'NOT_STARTED',
        'MUST',
        'domain-contracts#admitCollectionContract(PRD-§9)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C07',
    scenario: 'member-needs-detail-page-or-cdn',
    prdRef: 'PRD-§35#C07',
    requiredBehavior: 'Allow only traceable member/detail/CDN path; retain provenance.',
    target: 'member delivery through detail-page/CDN edges',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/explicit-gallery' },
    truthSource: truth(`${PRD}#35/C07`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'targetResolution',
        'RESOLVED',
        'MUST',
        'domain-contracts#assertLocatorTransitionPreservesTarget(L2-inv4)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C08',
    scenario: 'page-range-1-3-iframe-loadmore-no-continuation',
    prdRef: 'PRD-§35#C08',
    requiredBehavior:
      'Only logical root pages 1–3 and members bound by the supported membership basis are in scope. iframe/load-more/detail do not add pages or members. If those requested members close successfully: Request COMPLETE; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop USER_SCOPE_REACHED. Any later load-more requires successor contract/snapshot.',
    target: 'page-range 1..3 scope with continuation_scope NONE',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s5-current-page-collection' },
    truthSource: truth(`${PRD}#35/C08`),
    expectedTuples: [
      tuple('COMPLETE', 'RESOLVED', 'COMPLETE', 'VERIFIED_COMPLETE', 'USER_SCOPE_REACHED', {
        status: 'ALL_PASSED',
        passedCount: 4,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST',
        'domain-contracts#scopeIdentityKey(collection_page_range:1..3)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C09',
    scenario: 'original-vs-thumbnail-main-video-vs-ad',
    prdRef: 'PRD-§35#C09',
    requiredBehavior:
      'No semantic PASS without typed independent Target/Quality evidence or sufficiently informed user claim.',
    target: 'semantic target/quality discrimination between valid files',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s3-current-page-media' },
    truthSource: truth(`${PRD}#35/C09`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MUST_NOT',
        'domain-contracts#assertValidatesRequiredLayer(SELF_CERTIFICATION)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C10',
    scenario: 'whole-collection-18-auth-acquires-16-two-inaccessible',
    prdRef: 'PRD-§35#C10',
    requiredBehavior:
      'Exact §17.2 tuple: Request PARTIAL; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop AUTH_REQUIRED; explain 16/18 acquired, requested scope remains 18.',
    target: 'authorization-limited whole-collection accounting (18 requested / 16 accessible)',
    scopeRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    truthSource: truth(`${PRD}#35/C10`),
    expectedTuples: [
      tuple('PARTIAL', 'RESOLVED', 'COMPLETE', 'VERIFIED_COMPLETE', 'AUTH_REQUIRED', {
        status: 'ALL_PASSED',
        passedCount: 16,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [
      rule(
        'requestFulfillment',
        'COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C10/PRD-§18.7)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C11',
    scenario: 'collection-changes-after-preview',
    prdRef: 'PRD-§35#C11',
    requiredBehavior: 'Snapshot cannot silently drift; refresh creates successor snapshot.',
    target: 'collection membership stability between preview and confirmation',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/current-page-attachments' },
    truthSource: truth(`${PRD}#35/C11`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST_NOT',
        'domain-contracts#assertSnapshotImmutable(MEMBERSHIP_DRIFT)',
      ),
      rule(
        'targetResolution',
        'RESOLVED',
        'MAY',
        'domain-contracts#deriveSuccessorSnapshot(COLLECTION_CHANGED)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C12',
    scenario: 'retry-failed-items',
    prdRef: 'PRD-§35#C12',
    requiredBehavior: 'Retry only original failed members; no new/replacement members.',
    target: 'retry domain restricted to original failed member identities',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/retry-failed-members' },
    truthSource: truth(`${PRD}#35/C12`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'COMPLETE',
        'MAY',
        'domain-contracts#planRetryOfFailedMembers(C12)',
      ),
      rule(
        'targetResolution',
        'PARTIAL',
        'MUST_NOT',
        'domain-contracts#planRetryOfFailedMembers(C12)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C13',
    scenario: 'restart-repair-ui-cli-concurrency',
    prdRef: 'PRD-§35#C13',
    requiredBehavior: 'Budgets inherit remaining values; no duplicate allocation.',
    target: 'restart/repair/concurrency budget inheritance',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/restart-repair-concurrency' },
    truthSource: truth(`${PRD}#35/C13`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'COMPLETE',
        'MAY',
        'domain-contracts#budgetRemaining(inheritance)',
      ),
      rule(
        'selectionAcquisition',
        'FAILED',
        'MAY',
        'domain-contracts#assertNoDuplicateAllocation(DUPLICATE_ALLOCATION)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C14',
    scenario: 'discovered-targets-succeed-enumeration-unfinished',
    prdRef: 'PRD-§35#C14',
    requiredBehavior:
      'Selection may COMPLETE; Request PARTIAL/UNKNOWN; Coverage not VERIFIED_COMPLETE.',
    target: 'discovery truncated after frozen targets succeed',
    scopeRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    truthSource: truth(`${PRD}#35/C14`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'COMPLETE',
        'MUST',
        'domain-contracts#validateTerminalResult(PRD-§16.3)',
      ),
      rule(
        'requestFulfillment',
        'PARTIAL',
        'MAY',
        'domain-contracts#validateTerminalResult(PRD-§18.3)',
      ),
      rule(
        'requestFulfillment',
        'UNKNOWN',
        'MAY',
        'domain-contracts#validateTerminalResult(PRD-§18.3)',
      ),
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(PRD-§19)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C15',
    scenario: 'unsupported-dash-separate-av-needs-mux',
    prdRef: 'PRD-§35#C15',
    requiredBehavior: 'UNSUPPORTED/FAILED; never silent video-only success.',
    target: 'unsupported DASH/separate-A/V topology requiring mux',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/dash-separate-av' },
    truthSource: truth(`${PRD}#35/C15`),
    expectedTuples: [
      tuple('UNSATISFIED', 'RESOLVED', 'FAILED', 'NOT_APPLICABLE', 'UNSUPPORTED', {
        status: 'FAILED',
        passedCount: 0,
        failedCount: 1,
      }),
    ],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C15)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C16',
    scenario: 'simple-task-forced-through-unnecessary-preview',
    prdRef: 'PRD-§35#C16',
    requiredBehavior:
      'Product value fails the task if avoidable interaction regresses without correctness benefit.',
    target: 'avoidable-interaction cost accounting on a simple direct task',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s1-direct-file' },
    truthSource: truth(`${PRD}#35/C16`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'requestFulfillment',
        'COMPLETE',
        'MAY',
        'version-validation#G0(active-user-effort-metric)',
      ),
    ],
    gateRefs: ['G0'],
    g0PlanRef: 'g0-plan/v0.1.0-primary',
  },
  {
    oracleId: 'C17',
    scenario: 'batch-succeeds-pagination-untested',
    prdRef: 'PRD-§35#C17',
    requiredBehavior: 'Credit G1a only; G1b remains unproven.',
    target: 'capability attribution between batch and navigation increments',
    scopeRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    truthSource: truth(`${PRD}#35/C17`),
    expectedTuples: [],
    ruleAssertions: [
      rule('coverage', 'UNKNOWN', 'MAY', 'version-validation#G1b(navigation-increment-unproven)'),
    ],
    gateRefs: ['G1a', 'G1b'],
  },
  {
    oracleId: 'C18',
    scenario: 'same-bytes-two-chapters-or-same-name-different-content',
    prdRef: 'PRD-§35#C18',
    requiredBehavior: 'Preserve member/source mapping; no semantic collapse.',
    target: 'member/source identity preservation under identical bytes or names',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/explicit-gallery' },
    truthSource: truth(`${PRD}#35/C18`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'targetResolution',
        'RESOLVED',
        'MUST',
        'domain-contracts#makeMemberId(distinct-identities)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C19',
    scenario: 'ai-vs-non-ai-comparison',
    prdRef: 'PRD-§35#C19',
    requiredBehavior: 'Same Tools/Auth/Budget/Context and independent truth required.',
    target: 'AI vs non-AI parity under identical execution context',
    scopeRef: { corpusId: 'corpus.holdout', taskCaseId: 'holdout/ai-parity-comparison' },
    truthSource: truth(`${PRD}#35/C19`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'INSUFFICIENT_EVIDENCE',
        'MAY',
        'domain-contracts#ExecutionContextIdentity(parity)',
      ),
    ],
    gateRefs: ['G2'],
  },
  {
    oracleId: 'C20',
    scenario: 'local-recipe-replay-on-changed-page-session-layout',
    prdRef: 'PRD-§35#C20',
    requiredBehavior: 'Revalidate scope/correctness; cache/output controlled.',
    target: 'promoted knowledge replay against a changed page/session/layout',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/site-template-mismatch' },
    truthSource: truth(`${PRD}#35/C20`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MUST_NOT',
        'domain-contracts#applyKnowledgeToContract(CURRENT_VALIDATION_REQUIRED)',
      ),
    ],
    gateRefs: ['G3'],
  },
  {
    oracleId: 'C21',
    scenario: 'shared-knowledge-independent-user-account',
    prdRef: 'PRD-§35#C21',
    requiredBehavior:
      'Not v0.1.0 release gate; if tested, no credential/private-data leakage and fail closed.',
    target: 'shared-knowledge isolation on an independent user account',
    scopeRef: { corpusId: 'corpus.holdout', taskCaseId: 'holdout/shared-knowledge-account' },
    truthSource: truth(`${PRD}#35/C21`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MUST_NOT',
        'domain-contracts#rejectRawSecretFields(PRD-§29)',
      ),
    ],
    gateRefs: ['G4'],
  },
  {
    oracleId: 'C22',
    scenario: 'insufficient-evidence',
    prdRef: 'PRD-§35#C22',
    requiredBehavior: '`INSUFFICIENT_EVIDENCE`; no post-hoc threshold conversion to PASS.',
    target: 'truth availability boundary for confirmation outcomes',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/insufficient-evidence' },
    truthSource: truth(`${PRD}#35/C22`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'INSUFFICIENT_EVIDENCE',
        'MUST',
        'domain-contracts#assertValidatesRequiredLayer(C22)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C23',
    scenario: 'whole-collection-page3-undiscovered-due-discovery-budget',
    prdRef: 'PRD-§35#C23',
    requiredBehavior:
      'Request PARTIAL; Resolution PARTIAL; Selection COMPLETE; Coverage TRUNCATED; Stop DISCOVERY_BUDGET_EXHAUSTED.',
    target: 'discovery budget exhaustion after pages 1–2 succeed',
    scopeRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    truthSource: truth(`${PRD}#35/C23`),
    expectedTuples: [
      tuple('PARTIAL', 'PARTIAL', 'COMPLETE', 'TRUNCATED', 'DISCOVERY_BUDGET_EXHAUSTED', {
        status: 'ALL_PASSED',
        passedCount: 2,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [
      rule(
        'requestFulfillment',
        'COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C02/PRD-§15.4)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C24',
    scenario: 'auth-failure-yields-no-targets',
    prdRef: 'PRD-§35#C24',
    requiredBehavior:
      'Request UNSATISFIED; Resolution BLOCKED; Selection NOT_STARTED; Coverage UNKNOWN; Stop AUTH_REQUIRED/AUTH_FAILED according to §16.5.',
    target: 'authorization failure before any target resolution',
    scopeRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/auth-limited-collection' },
    truthSource: truth(`${PRD}#35/C24`),
    expectedTuples: [
      tuple('UNSATISFIED', 'BLOCKED', 'NOT_STARTED', 'UNKNOWN', 'AUTH_REQUIRED', {
        status: 'NOT_PERFORMED',
        passedCount: 0,
        failedCount: 0,
      }),
      tuple('UNSATISFIED', 'BLOCKED', 'NOT_STARTED', 'UNKNOWN', 'AUTH_FAILED', {
        status: 'NOT_PERFORMED',
        passedCount: 0,
        failedCount: 0,
      }),
    ],
    ruleAssertions: [],
    gateRefs: [],
  },
  {
    oracleId: 'C25',
    scenario: 'parent-ten-pages-user-requests-1-3-all-succeed',
    prdRef: 'PRD-§35#C25',
    requiredBehavior:
      'CoverageTarget is pages 1–3; Coverage VERIFIED_COMPLETE for requested scope only; no whole-parent claim.',
    target: 'requested-scope coverage binding on a page-range of a larger parent',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s5-current-page-collection' },
    truthSource: truth(`${PRD}#35/C25`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST',
        'domain-contracts#scopeIdentityKey(collection_page_range:1..3)',
      ),
      rule(
        'coverage',
        'UNKNOWN',
        'MAY',
        'domain-contracts#scopeIdentityKey(entire_supported_collection:parent)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C26',
    scenario: 'user-confirms-system-labeled-original-without-enough-information',
    prdRef: 'PRD-§35#C26',
    requiredBehavior:
      'User click proves selection only; QUALITY/original claim remains unverified.',
    target: 'confirmation proof scope for a system-labeled quality choice',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s3-current-page-media' },
    truthSource: truth(`${PRD}#35/C26`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MUST_NOT',
        'domain-contracts#whatConfirmationProves(CONFIRM_QUALITY_CHOICE)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C27',
    scenario: 'confirmed-candidate-transfer-truncated-or-track-missing',
    prdRef: 'PRD-§35#C27',
    requiredBehavior: 'Confirmation does not waive validation; SelectionAcquisition not COMPLETE.',
    target: 'confirmed candidate with truncated transfer / missing required track',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s2-attachment' },
    truthSource: truth(`${PRD}#35/C27`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'selectionAcquisition',
        'COMPLETE',
        'MUST_NOT',
        'domain-contracts#validateTerminalResult(C27)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C28',
    scenario: 'discovery-budget-exhausted-hls-target-needs-segments',
    prdRef: 'PRD-§35#C28',
    requiredBehavior:
      'Continue only if TransferBudget + GlobalSafetyBudget remain; HLS requests count TransferBudget.',
    target: 'separate budget-domain continuation for a frozen HLS target',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s4-hls-vod' },
    truthSource: truth(`${PRD}#35/C28`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'stopReason',
        'TRANSFER_BUDGET_EXHAUSTED',
        'MAY',
        'domain-contracts#canTransferAfterDiscoveryExhaustion(C28)',
      ),
      rule(
        'stopReason',
        'NATURAL_COLLECTION_END',
        'MAY',
        'domain-contracts#canTransferAfterDiscoveryExhaustion(C28)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C29',
    scenario: 'current-page-attachment-redirects-to-declared-cdn',
    prdRef: 'PRD-§35#C29',
    requiredBehavior:
      'S2 provenance accepts; validate final target; unrelated redirect rejected/fails.',
    target: 'provenance-bound CDN transition for a current-page attachment',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s2-attachment' },
    truthSource: truth(`${PRD}#35/C29`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'targetResolution',
        'RESOLVED',
        'MUST',
        'domain-contracts#assertLocatorTransitionPreservesTarget(L2-inv4)',
      ),
      rule(
        'targetResolution',
        'BLOCKED',
        'MAY',
        'domain-contracts#assertLocatorTransitionPreservesTarget(LOCATOR_SUBSTITUTION_REJECTED)',
      ),
    ],
    gateRefs: [],
  },
  {
    oracleId: 'C30',
    scenario: 'fifty-item-confirmations-vs-batch-selection',
    prdRef: 'PRD-§35#C30',
    requiredBehavior: 'Batch/manual selection required; per-item burden counts against G0/G1c.',
    target: 'confirmation burden accounting across 50 candidates',
    scopeRef: { corpusId: 'corpus.collection', taskCaseId: 'collection/current-page-attachments' },
    truthSource: truth(`${PRD}#35/C30`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MAY',
        'version-validation#G0/G1c(confirmation-burden-metric)',
      ),
    ],
    gateRefs: ['G0', 'G1c'],
    g0PlanRef: 'g0-plan/v0.1.0-primary',
  },
  {
    oracleId: 'C31',
    scenario: 'prior-12-of-18-selection-reused-on-different-page',
    prdRef: 'PRD-§35#C31',
    requiredBehavior:
      'Task selection is not reusable membership knowledge without cross-task validation/promotion.',
    target: 'task-local selection reuse across a different page',
    scopeRef: { corpusId: 'corpus.holdout', taskCaseId: 'holdout/new-session-generalization' },
    truthSource: truth(`${PRD}#35/C31`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'coverage',
        'VERIFIED_COMPLETE',
        'MUST_NOT',
        'domain-contracts#applyKnowledgeToContract(KNOWLEDGE_NOT_REUSABLE)',
      ),
    ],
    gateRefs: ['G3'],
  },
  {
    oracleId: 'C32',
    scenario: 'gate-set-includes-failure-abandonment-unknown-out-of-scope',
    prdRef: 'PRD-§35#C32',
    requiredBehavior: 'Apply common denominator rules exactly.',
    target: 'common-denominator accounting across non-success classes',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/g0-confirmation-set' },
    truthSource: { kind: 'PRE_REGISTERED_AUTHORITATIVE_METADATA', ref: `${PRD}#32.1` },
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'requestFulfillment',
        'COMPLETE',
        'MUST_NOT',
        'version-validation#computeDenominator(PRD-§32.1)',
      ),
      rule(
        'requestFulfillment',
        'UNKNOWN',
        'MAY',
        'version-validation#computeDenominator(PRD-§32.1)',
      ),
    ],
    gateRefs: ['G0'],
    g0PlanRef: 'g0-plan/v0.1.0-primary',
  },
  {
    oracleId: 'C33',
    scenario: 'phase-b-opened-then-protocol-or-baseline-changed',
    prdRef: 'PRD-§35#C33',
    requiredBehavior: 'Prior confirmation run is invalid; create a new independent run.',
    target: 'post-exposure protocol/baseline change invalidation',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/g0-confirmation-set' },
    truthSource: { kind: 'PRE_REGISTERED_AUTHORITATIVE_METADATA', ref: `${PRD}#32.2` },
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'INSUFFICIENT_EVIDENCE',
        'MUST',
        'domain-contracts#assertBaselineIdentityUnchanged(C33)',
      ),
    ],
    gateRefs: ['G0'],
    g0PlanRef: 'g0-plan/v0.1.0-primary',
  },
  {
    oracleId: 'C34',
    scenario: 'ui-suggestion-used-as-ground-truth',
    prdRef: 'PRD-§35#C34',
    requiredBehavior:
      'Invalid; truth must be pre-registered/independent and cannot be rewritten by confirmation.',
    target: 'truth-source independence for semantic claims',
    scopeRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s3-current-page-media' },
    truthSource: truth(`${PRD}#35/C34`),
    expectedTuples: [],
    ruleAssertions: [
      rule(
        'validationSummary.status',
        'ALL_PASSED',
        'MUST_NOT',
        'domain-contracts#decodeEvidenceRecord(SELF_CERTIFICATION)',
      ),
    ],
    gateRefs: [],
  },
]);

/**
 * The pre-registered oracle records for C01–C34, in canonical id order.
 */
export function oracleCorpusRecords(): readonly unknown[] {
  return RECORDS;
}
