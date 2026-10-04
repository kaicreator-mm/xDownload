/**
 * TEST_MATRIX suite `evidence-exact-subject-binding` (frozen PRD §20–§22;
 * C26/C27/C34).
 */
import { describe, expect, it } from 'vitest';
import { assertValidatesRequiredLayer } from '@xdownload/domain-contracts';
import {
  assertConfirmationProofScope,
  assertEvidenceSubjectExact,
  captureEvidence,
  createEvidenceGate,
  createTruthSourceRegistry,
  formatEvidenceRecord,
  formatHarnessOutput,
} from '../src/index.ts';
import { rawEvidence } from './helpers.ts';
import { unwrapOrThrow } from '@xdownload/domain-contracts';

describe('evidence capture — §20 claim fields are required and bound canonically', () => {
  it('a complete record captures with every claim-model field present', () => {
    const record = unwrapOrThrow(captureEvidence(rawEvidence()));
    expect(record.claimType).toBe('RESOURCE_IDENTITY');
    expect(record.claimSubject).toEqual({ kind: 'LOGICAL_TARGET', ref: 'target-fixture-001' });
    expect(record.sourceType).toBe('INDEPENDENT_VALIDATOR');
    expect(record.provenance.sourceIdentity).toBe('validator/t003-oracle-001');
    expect(record.independenceFromDiscovery).toBe('INDEPENDENT');
    expect(record.scope.domain).toBe('BATCH_DOWNLOAD');
    expect(record.certaintyClass).toBe('DECISIVE');
  });

  it('a record missing any §20 field fails closed', () => {
    for (const field of [
      'claimType',
      'claimSubject',
      'sourceType',
      'provenance',
      'independenceFromDiscovery',
      'scope',
      'certaintyClass',
    ]) {
      const raw = rawEvidence();
      delete raw[field];
      const result = captureEvidence(raw);
      expect(result.ok).toBe(false);
    }
  });

  it('discovery/UI provenance can never be typed as independent truth for the same claim (C34)', () => {
    for (const sourceType of ['UI_SUGGESTION', 'DISCOVERY_INFERENCE']) {
      const result = captureEvidence(
        rawEvidence({
          sourceType,
          independenceFromDiscovery: 'INDEPENDENT',
          provenance: { sourceIdentity: 'ui/label-original' },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]!.code).toBe('SELF_CERTIFICATION');
      }
    }
  });

  it('suggestion-derived records stay discovery-derived and cannot serve as the validation oracle', () => {
    const suggestion = unwrapOrThrow(
      captureEvidence(
        rawEvidence({
          claimType: 'QUALITY',
          sourceType: 'UI_SUGGESTION',
          independenceFromDiscovery: 'DISCOVERY_DERIVED',
          certaintyClass: 'SUGGESTIVE',
          provenance: { sourceIdentity: 'ui/label-original' },
        }),
      ),
    );
    const rejection = assertValidatesRequiredLayer(suggestion, 'media');
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('SELF_CERTIFICATION');
    }
  });
});

describe('evidence capture — exact-subject binding (PRD §20)', () => {
  it('the subject must match the claimed identity exactly', () => {
    const record = unwrapOrThrow(captureEvidence(rawEvidence()));
    expect(assertEvidenceSubjectExact(record, 'target-fixture-001').ok).toBe(true);
    for (const drift of [
      'target-fixture-00*',
      'target-fixture-001/chapter-2',
      'target-fixture-00',
    ]) {
      const rejection = assertEvidenceSubjectExact(record, drift);
      expect(rejection.ok).toBe(false);
      if (!rejection.ok) {
        expect(rejection.diagnostics[0]!.code).toBe('CONTRACT_BINDING_MISMATCH');
        expect(rejection.diagnostics[0]!.invariant).toBe('PRD-§20');
      }
    }
  });

  it('formatting is deterministic and subject-exact across key insertion orders', () => {
    const record = unwrapOrThrow(captureEvidence(rawEvidence()));
    const formattedA = formatEvidenceRecord(record);
    const reordered = rawEvidence();
    const reorderedKeys = Object.fromEntries(Object.entries(reordered).reverse());
    const recordB = unwrapOrThrow(captureEvidence(reorderedKeys));
    const formattedB = formatEvidenceRecord(recordB);
    expect(formattedA).toBe(formattedB);
    expect(formattedA).toContain('"ref":"target-fixture-001"');
  });
});

describe('evidence capture — confirmation proves only the shown claim (PRD §21, C26/C27)', () => {
  const confirmation = (overrides: Record<string, unknown>) =>
    captureEvidence(
      rawEvidence({
        claimType: 'SELECTION',
        claimSubject: { kind: 'MEMBER', ref: 'member-candidate-001' },
        sourceType: 'USER_CONFIRMATION',
        provenance: { sourceIdentity: 'user/session-001' },
        certaintyClass: 'PROBATIVE',
        ...overrides,
      }),
    );

  it('CONFIRM_QUALITY_CHOICE proves selection only; the QUALITY claim stays unverified (C26)', () => {
    const selectionRecord = unwrapOrThrow(confirmation({}));
    expect(assertConfirmationProofScope(selectionRecord, 'CONFIRM_QUALITY_CHOICE').ok).toBe(true);
    const qualityTyped = unwrapOrThrow(confirmation({ claimType: 'QUALITY' }));
    const rejection = assertConfirmationProofScope(qualityTyped, 'CONFIRM_QUALITY_CHOICE');
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
    }
  });

  it('a confirmation record can never be typed as Transfer/Format/Media validation (C27)', () => {
    for (const claimType of ['TRANSFER', 'FORMAT', 'MEDIA']) {
      const typed = unwrapOrThrow(confirmation({ claimType }));
      const rejection = assertConfirmationProofScope(typed, 'CONFIRM_SELECTION');
      expect(rejection.ok).toBe(false);
      if (!rejection.ok) {
        expect(rejection.diagnostics[0]!.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
        expect(rejection.diagnostics[0]!.invariant).toBe('PRD-§21');
      }
    }
  });

  it('user confirmation cannot satisfy the transfer validation layer even when probative', () => {
    const record = unwrapOrThrow(confirmation({ claimType: 'TRANSFER' }));
    const rejection = assertValidatesRequiredLayer(record, 'transfer');
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
    }
  });
});

describe('evidence capture — truth sources must be pre-registered and independent', () => {
  it('an unregistered truth reference fails closed; registered ones pass', () => {
    const gate = createEvidenceGate(['manual-oracle/session-1', 'metadata/site-declaration']);
    expect(gate.assertUsableTruthSource('manual-oracle/session-1').ok).toBe(true);
    const rejection = gate.assertUsableTruthSource('never-registered/oracle');
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.diagnostics[0]!.code).toBe('INSUFFICIENT_EVIDENCE');
      expect(rejection.diagnostics[0]!.invariant).toBe('C34/PRD-§32.1');
    }
  });

  it('UI-suggestion/discovery/model self outputs are invalid truth refs even when registered', () => {
    const gate = createEvidenceGate([
      'ui-suggestion/label',
      'discovery-inference/session-1',
      'model-self/score',
    ]);
    for (const ref of [
      'ui-suggestion/label',
      'discovery-inference/session-1',
      'model-self/score',
    ]) {
      const rejection = gate.assertUsableTruthSource(ref);
      expect(rejection.ok).toBe(false);
      if (!rejection.ok) {
        expect(rejection.diagnostics[0]!.code).toBe('SELF_CERTIFICATION');
        expect(rejection.diagnostics[0]!.invariant).toBe('C34');
      }
    }
  });

  it('the truth-source registry rejects forbidden kinds and duplicate kinds', () => {
    const registry = createTruthSourceRegistry();
    expect(
      registry.register({
        kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE',
        ref: 'manual/oracle-1',
      }).ok,
    ).toBe(true);
    const selfTruth = registry.register({
      kind: 'UI_SUGGESTION' as never,
      ref: 'ui/ground-truth',
    });
    expect(selfTruth.ok).toBe(false);
    const conflicting = registry.register({
      kind: 'PRE_REGISTERED_AUTHORITATIVE_METADATA',
      ref: 'manual/oracle-1',
    });
    expect(conflicting.ok).toBe(false);
    expect(unwrapOrThrow(registry.assertPreRegistered('manual/oracle-1')).kind).toBe(
      'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE',
    );
    const unregistered = registry.assertPreRegistered('never/registered');
    expect(unregistered.ok).toBe(false);
  });
});

describe('evidence capture — harness output formatting is byte-stable', () => {
  it('formatHarnessOutput is identical across repeated invocations', () => {
    const value = { b: 1, a: ['x', { d: 2, c: 3 }], e: undefined };
    expect(formatHarnessOutput(value)).toBe(formatHarnessOutput(value));
    expect(formatHarnessOutput(value)).toBe('{"a":["x",{"c":3,"d":2}],"b":1}');
  });
});
