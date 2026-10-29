/**
 * TEST_MATRIX suite `typed-evidence-validation` — claim model, provenance,
 * independence, confirmation limits and knowledge/baseline identity rules.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateConfirmationOutcomes,
  applyKnowledgeToContract,
  assertBaselineIdentityUnchanged,
  assertEvidenceScopeNotPromoted,
  assertNoDiscoverySelfCertification,
  assertValidatesRequiredLayer,
  canServeAsIndependentValidationOracle,
  decodeEvidenceRecord,
  decodeKnowledgeRef,
  evidenceRecord,
  whatConfirmationProves,
} from '../src/index.ts';
import { decodeOk, eid, expectCode } from './helpers.ts';

const discoveryClaim = () =>
  evidenceRecord({
    evidenceId: eid('evidence-discovery-001'),
    claimType: 'RESOURCE_IDENTITY',
    claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-file-001' },
    sourceType: 'DISCOVERY_INFERENCE',
    provenance: { sourceIdentity: 'discovery/session-001' },
    independenceFromDiscovery: 'DISCOVERY_DERIVED',
    scope: { domain: 'BATCH_DOWNLOAD', contractRef: 'contract-single-001' },
    certaintyClass: 'PROBATIVE',
  });

const independentValidation = () =>
  evidenceRecord({
    evidenceId: eid('evidence-validator-001'),
    claimType: 'RESOURCE_IDENTITY',
    claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-file-001' },
    sourceType: 'INDEPENDENT_VALIDATOR',
    provenance: { sourceIdentity: 'validator/target-check-001' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'SINGLE_RESOURCE_TRANSFER', contractRef: 'contract-single-001' },
    certaintyClass: 'DECISIVE',
  });

const userConfirmation = () =>
  evidenceRecord({
    evidenceId: eid('evidence-confirm-001'),
    claimType: 'SELECTION',
    claimSubject: { kind: 'MEMBER', ref: 'member-001' },
    sourceType: 'USER_CONFIRMATION',
    provenance: { sourceIdentity: 'user/desktop-session-001' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'BATCH_DOWNLOAD', contractRef: 'contract-single-001' },
    certaintyClass: 'DECISIVE',
  });

describe('typed-evidence-validation: material claim model', () => {
  it('material evidence declares claim type, subject, provenance, scope and independence', () => {
    const decoded = decodeOk(decodeEvidenceRecord(JSON.parse(JSON.stringify(discoveryClaim()))));
    expect(decoded.claimType).toBe('RESOURCE_IDENTITY');
    expect(decoded.claimSubject).toEqual({ kind: 'LOGICAL_TARGET', ref: 'target-file-001' });
    expect(decoded.provenance.sourceIdentity).toBe('discovery/session-001');
    expect(decoded.independenceFromDiscovery).toBe('DISCOVERY_DERIVED');
    expect(decoded.scope.domain).toBe('BATCH_DOWNLOAD');
    expect(decoded.certaintyClass).toBe('PROBATIVE');
  });

  it('preserves Tools/Auth/Budget/Context identity on provenance (C19)', () => {
    const withContext = evidenceRecord({
      evidenceId: eid('evidence-context-001'),
      claimType: 'TRANSFER',
      claimSubject: { kind: 'EFFECT', ref: 'effect-001' },
      sourceType: 'TRANSFER_OBSERVATION',
      provenance: {
        sourceIdentity: 'adapter/http-001',
        executionContext: {
          toolsUsed: ['http-direct'],
          authorizationContextRef: 'authctx/local-001',
          budgetRefs: ['budget/transfer-001'],
        },
      },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
      certaintyClass: 'DECISIVE',
    });
    const decoded = decodeOk(decodeEvidenceRecord(JSON.parse(JSON.stringify(withContext))));
    expect(decoded.provenance.executionContext).toEqual({
      toolsUsed: ['http-direct'],
      authorizationContextRef: 'authctx/local-001',
      budgetRefs: ['budget/transfer-001'],
    });
  });

  it('rejects malformed evidence and unknown claim vocabulary', () => {
    expectCode(
      decodeEvidenceRecord({ ...JSON.parse(JSON.stringify(discoveryClaim())), claimType: 'VIBES' }),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(decodeEvidenceRecord({ evidenceId: 'evidence-1' }), 'UNKNOWN_ENUM_VALUE');
  });
});

describe('typed-evidence-validation: discovery cannot self-certify (L2-inv6)', () => {
  it('discovery/UI suggestion provenance can never declare itself independent (C34)', () => {
    expectCode(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify({ ...discoveryClaim(), independenceFromDiscovery: 'INDEPENDENT' }),
        ),
      ),
      'SELF_CERTIFICATION',
      'C34',
    );
    expectCode(
      decodeEvidenceRecord(
        JSON.parse(
          JSON.stringify({
            ...discoveryClaim(),
            sourceType: 'UI_SUGGESTION',
            independenceFromDiscovery: 'INDEPENDENT',
          }),
        ),
      ),
      'SELF_CERTIFICATION',
      'C34',
    );
  });

  it('discovery-derived evidence cannot validate the same claim it produced', () => {
    expectCode(
      assertNoDiscoverySelfCertification(discoveryClaim(), discoveryClaim()),
      'SELF_CERTIFICATION',
      'L2-inv6',
    );
    expect(
      decodeOk(assertNoDiscoverySelfCertification(discoveryClaim(), independentValidation())),
    ).toBeUndefined();
    expect(canServeAsIndependentValidationOracle(discoveryClaim())).toBe(false);
    expect(canServeAsIndependentValidationOracle(independentValidation())).toBe(true);
  });

  it('insufficient-certainty evidence never converts into a PASS (C22)', () => {
    const insufficient = evidenceRecord({
      evidenceId: eid('evidence-thin-001'),
      claimType: 'COVERAGE',
      claimSubject: { kind: 'COVERAGE_TARGET', ref: 'coverage-target-001' },
      sourceType: 'INDEPENDENT_VALIDATOR',
      provenance: { sourceIdentity: 'validator/coverage-001' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'COVERAGE' },
      certaintyClass: 'INSUFFICIENT_EVIDENCE',
    });
    expect(canServeAsIndependentValidationOracle(insufficient)).toBe(false);
    expectCode(
      assertValidatesRequiredLayer(insufficient, 'coverage'),
      'INSUFFICIENT_EVIDENCE',
      'C22',
    );
  });
});

describe('typed-evidence-validation: confirmation proves only the shown claim (PRD §21)', () => {
  it('confirmation cannot waive Transfer/Format/Media validation (C26/C27)', () => {
    expectCode(
      assertValidatesRequiredLayer(userConfirmation(), 'transfer'),
      'CONFIRMATION_CANNOT_WAIVE_VALIDATION',
      'PRD-§21',
    );
    expectCode(
      assertValidatesRequiredLayer(userConfirmation(), 'format'),
      'CONFIRMATION_CANNOT_WAIVE_VALIDATION',
    );
    expectCode(
      assertValidatesRequiredLayer(userConfirmation(), 'media'),
      'CONFIRMATION_CANNOT_WAIVE_VALIDATION',
    );
    expect(
      decodeOk(assertValidatesRequiredLayer(userConfirmation(), 'membership')),
    ).toBeUndefined();
    expect(
      decodeOk(assertValidatesRequiredLayer(independentValidation(), 'transfer')),
    ).toBeUndefined();
  });

  it('CONFIRM_QUALITY_CHOICE proves selection only; the quality claim stays unverified (C26)', () => {
    const proves = whatConfirmationProves('CONFIRM_QUALITY_CHOICE');
    expect(proves.proves).toBe('SELECTION');
    expect(proves.doesNotProve).toContain('QUALITY');
  });

  it('batch evidence cannot be re-labeled as continuation/navigation evidence (C17)', () => {
    expectCode(
      assertEvidenceScopeNotPromoted(discoveryClaim(), 'CONTINUATION_NAVIGATION'),
      'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
      'C17',
    );
    expect(
      decodeOk(assertEvidenceScopeNotPromoted(discoveryClaim(), 'BATCH_DOWNLOAD')),
    ).toBeUndefined();
  });
});

describe('typed-evidence-validation: confirmation outcomes, baselines and reusable knowledge', () => {
  it('confirmation sets keep distinct non-success classifications (C32)', () => {
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'CONFIRMED'])).toBe('CONFIRMED');
    expect(
      aggregateConfirmationOutcomes([
        'CONFIRMED',
        'FAILED',
        'ABANDONED',
        'UNKNOWN',
        'OUT_OF_SCOPE',
      ]),
    ).toBe('FAILED');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'ABANDONED'])).toBe('ABANDONED');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'OUT_OF_SCOPE'])).toBe('OUT_OF_SCOPE');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(aggregateConfirmationOutcomes([])).toBe('UNKNOWN');
  });

  it('baseline identity change invalidates prior runs (C33)', () => {
    expect(
      decodeOk(
        assertBaselineIdentityUnchanged(
          { baselineId: 'g0-2026-a', version: 3 },
          { baselineId: 'g0-2026-a', version: 3 },
        ),
      ),
    ).toBeUndefined();
    expectCode(
      assertBaselineIdentityUnchanged(
        { baselineId: 'g0-2026-a', version: 3 },
        { baselineId: 'g0-2026-a', version: 4 },
      ),
      'BASELINE_IDENTITY_CHANGED',
      'C33',
    );
    expectCode(
      assertBaselineIdentityUnchanged(
        { baselineId: 'g0-2026-a', version: 3 },
        { baselineId: 'g0-2026-b', version: 3 },
      ),
      'BASELINE_IDENTITY_CHANGED',
    );
  });

  it('task-local selection never becomes reusable membership authority (C31)', () => {
    const taskLocal = decodeOk(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/task-001-selection',
        kind: 'TASK_LOCAL_SELECTION',
        applicableScopeKey: 'collection/playlist-001',
        requiresCurrentValidation: true,
      }),
    );
    expectCode(
      applyKnowledgeToContract(taskLocal, independentValidation()),
      'KNOWLEDGE_NOT_REUSABLE',
      'C31',
    );
  });

  it('promoted knowledge requires current validation evidence before replay (C20)', () => {
    const promoted = decodeOk(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/recipe-gallery-v1',
        kind: 'PROMOTED_LOCAL_VERIFIED',
        applicableScopeKey: 'collection/playlist-001',
        requiresCurrentValidation: true,
      }),
    );
    expectCode(applyKnowledgeToContract(promoted, undefined), 'CURRENT_VALIDATION_REQUIRED', 'C20');
    const thin = evidenceRecord({ ...independentValidation(), certaintyClass: 'SUGGESTIVE' });
    expectCode(applyKnowledgeToContract(promoted, thin), 'CURRENT_VALIDATION_REQUIRED');
    expect(decodeOk(applyKnowledgeToContract(promoted, independentValidation()))).toBeUndefined();
  });

  it('reusable knowledge must declare current-validation requirement to decode at all', () => {
    expectCode(
      decodeKnowledgeRef({
        knowledgeId: 'knowledge/recipe-x',
        kind: 'PROMOTED_LOCAL_VERIFIED',
        applicableScopeKey: 'scope-x',
        requiresCurrentValidation: false,
      }),
      'CURRENT_VALIDATION_REQUIRED',
      'C20',
    );
  });
});
