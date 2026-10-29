/**
 * TEST_MATRIX suite `independent-validator-claim-binding` (T007): discovery
 * evidence can never be the sole validation oracle for the same semantic
 * claim; validation records bind exact subject/layer/snapshot identity and
 * use against a non-matching subject/layer rejects; user confirmation proves
 * only the shown claim and can never waive Transfer/Format/Media validation
 * (L2 invariants 5–6, PRD §20–§22, C26/C27/C34).
 */
import { describe, expect, it } from 'vitest';
import {
  createEvidenceLedger,
  createValidationRegistry,
  requiredValidationOutcomes,
  unwrapOrThrow,
} from '../src/index.ts';
import { appendMemberEvidence, evidenceRaw } from './t007-helpers.ts';
import { expectCode, mid } from './helpers.ts';

function stack() {
  const ledger = createEvidenceLedger();
  const registry = createValidationRegistry(ledger);
  return { ledger, registry };
}

function validationRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    validationId: 'validation-t007-001',
    layer: 'transfer',
    subject: { kind: 'MEMBER', ref: 'member-t007-001' },
    outcome: 'PASS',
    evidenceRefs: ['evidence-t007-001'],
    validatorIdentity: 'validator/t007-transfer',
    recordedAt: '2026-10-04T02:00:00Z',
    ...overrides,
  };
}

describe('T007 ValidationRecord binding', () => {
  it('a PASS record over oracle-grade evidence registers and satisfies exactly its claim', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(registry.register(validationRaw()));
    const satisfied = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
    });
    expect(satisfied.ok).toBe(true);
  });

  it('a record proves exactly its subject: use against another member rejects', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(registry.register(validationRaw()));
    const other = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-002' },
    });
    expectCode(other, 'INSUFFICIENT_EVIDENCE');
  });

  it('a record proves exactly its layer: transfer PASS never satisfies format', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(registry.register(validationRaw()));
    const wrongLayer = registry.satisfies({
      layer: 'format',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
    });
    expectCode(wrongLayer, 'INSUFFICIENT_EVIDENCE');
  });

  it('a snapshot-bound record used against another snapshot rejects (no cross-snapshot promotion)', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
      snapshotRef: 'snapshot-t007-1',
    });
    unwrapOrThrow(registry.register(validationRaw({ snapshotRef: 'snapshot-t007-1' })));
    const mismatch = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
      snapshotRef: 'snapshot-t007-2',
    });
    expectCode(mismatch, 'VALIDATION_CLAIM_BINDING_MISMATCH');
  });

  it('discovery-derived evidence can never be the PASS oracle for the same claim (L2 invariant 6)', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-disc-1',
      claimType: 'RESOURCE_IDENTITY',
      memberRef: 'member-t007-001',
      sourceType: 'DISCOVERY_INFERENCE',
      independence: 'DISCOVERY_DERIVED',
      certaintyClass: 'DECISIVE',
    });
    const rejected = registry.register(
      validationRaw({
        layer: 'target',
        claimType: 'RESOURCE_IDENTITY',
        evidenceRefs: ['evidence-t007-disc-1'],
      }),
    );
    expectCode(rejected, 'SELF_CERTIFICATION');
  });

  it('UI suggestion cannot be typed as independent truth for the same claim (C34)', () => {
    const { ledger, registry } = stack();
    // typing a suggestion as independent fails at ledger admission already
    expect(
      ledger.append(
        evidenceRaw({
          sourceType: 'UI_SUGGESTION',
          independenceFromDiscovery: 'INDEPENDENT',
          claimType: 'RESOURCE_IDENTITY',
        }),
      ).ok,
    ).toBe(false);
    // and a suggestion can never satisfy a required validation layer
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-ui-1',
      claimType: 'RESOURCE_IDENTITY',
      memberRef: 'member-t007-001',
      sourceType: 'UI_SUGGESTION',
      independence: 'DISCOVERY_DERIVED',
    });
    const rejected = registry.register(
      validationRaw({
        layer: 'target',
        claimType: 'RESOURCE_IDENTITY',
        evidenceRefs: ['evidence-t007-ui-1'],
      }),
    );
    expect(rejected.ok).toBe(false);
  });

  it('a PASS record referencing unknown ledger evidence rejects at the binding gate', () => {
    const { registry } = stack();
    const rejected = registry.register(
      validationRaw({ evidenceRefs: ['evidence-never-appended'] }),
    );
    expectCode(rejected, 'ADMISSION_REJECTED');
  });

  it('a FAIL outcome registers but satisfies() only ever returns PASS records', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(
      registry.register(validationRaw({ outcome: 'FAIL', validatorIdentity: 'validator/fail' })),
    );
    const satisfied = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
    });
    expectCode(satisfied, 'INSUFFICIENT_EVIDENCE');
  });

  it('claim/layer cross-promotion rejects: layer transfer cannot claim COVERAGE', () => {
    const { registry } = stack();
    const rejected = registry.register(validationRaw({ claimType: 'COVERAGE', layer: 'transfer' }));
    expectCode(rejected, 'VALIDATION_CLAIM_BINDING_MISMATCH', 'PRD-§22');
  });

  it('C26: user confirmation proves only the shown claim — quality choice never proves QUALITY', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-conf-1',
      claimType: 'SELECTION',
      memberRef: 'member-t007-001',
      sourceType: 'USER_CONFIRMATION',
      certaintyClass: 'PROBATIVE',
    });
    const rejected = registry.register(
      validationRaw({
        validationId: 'validation-t007-c26',
        layer: 'media',
        claimType: 'QUALITY',
        confirmationType: 'CONFIRM_QUALITY_CHOICE',
        evidenceRefs: ['evidence-t007-conf-1'],
      }),
    );
    // confirmation cannot waive media validation, and it cannot prove QUALITY
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(
        rejected.diagnostics.some(
          (d) =>
            d.code === 'CONFIRMATION_CANNOT_WAIVE_VALIDATION' ||
            d.code === 'VALIDATION_CLAIM_BINDING_MISMATCH',
        ),
      ).toBe(true);
    }
  });

  it('C27: confirmation can never satisfy the transfer layer — required validation stays mandatory', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-conf-2',
      claimType: 'SELECTION',
      memberRef: 'member-t007-001',
      sourceType: 'USER_CONFIRMATION',
      certaintyClass: 'PROBATIVE',
    });
    const rejected = registry.register(
      validationRaw({
        validationId: 'validation-t007-c27',
        layer: 'transfer',
        evidenceRefs: ['evidence-t007-conf-2'],
      }),
    );
    expectCode(rejected, 'CONFIRMATION_CANNOT_WAIVE_VALIDATION', 'PRD-§21');
  });

  it('C33: a baseline-bound record used under a changed baseline rejects', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({ baselineRef: { baselineId: 'baseline-t007', version: 1 } }),
      ),
    );
    const changed = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
      baselineRef: { baselineId: 'baseline-t007', version: 2 },
    });
    expectCode(changed, 'BASELINE_IDENTITY_CHANGED', 'C33');
    const same = registry.satisfies({
      layer: 'transfer',
      subject: { kind: 'MEMBER', ref: 'member-t007-001' },
      baselineRef: { baselineId: 'baseline-t007', version: 1 },
    });
    expect(same.ok).toBe(true);
  });

  it('requiredValidationOutcomes: every required layer must have a satisfying PASS record', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-t1',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({ validationId: 'validation-t007-t1', evidenceRefs: ['evidence-t007-t1'] }),
      ),
    );
    // format missing -> NOT_VALIDATED
    let outcomes = requiredValidationOutcomes([mid('member-t007-001')], registry, [
      'transfer',
      'format',
    ]);
    expect(outcomes[0]?.result).toBe('NOT_VALIDATED');
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-f1',
      claimType: 'FORMAT',
      memberRef: 'member-t007-001',
      sourceIdentity: 'validator/format-1',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-t007-f1',
          layer: 'format',
          evidenceRefs: ['evidence-t007-f1'],
          validatorIdentity: 'validator/t007-format',
        }),
      ),
    );
    outcomes = requiredValidationOutcomes([mid('member-t007-001')], registry, [
      'transfer',
      'format',
    ]);
    expect(outcomes[0]?.result).toBe('VALIDATED');
    // a FAIL for format flips the member to VALIDATION_FAILED (never silently passes)
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-f2',
      claimType: 'FORMAT',
      memberRef: 'member-t007-002',
      sourceIdentity: 'validator/format-2',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-t007-f2',
          layer: 'format',
          outcome: 'FAIL',
          subject: { kind: 'MEMBER', ref: 'member-t007-002' },
          evidenceRefs: ['evidence-t007-f2'],
          validatorIdentity: 'validator/t007-format',
        }),
      ),
    );
    const failed = requiredValidationOutcomes([mid('member-t007-002')], registry, ['format']);
    expect(failed[0]?.result).toBe('VALIDATION_FAILED');
  });

  it('malformed validation records fail closed at registration', () => {
    const { ledger, registry } = stack();
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-t007-001',
      claimType: 'TRANSFER',
      memberRef: 'member-t007-001',
    });
    expect(registry.register(validationRaw({ validatorIdentity: '' })).ok).toBe(false);
    expect(registry.register(validationRaw({ layer: 'psychic' })).ok).toBe(false);
    expect(registry.register(validationRaw({ evidenceRefs: [] })).ok).toBe(false);
    expect(registry.register(validationRaw({ extraField: true })).ok).toBe(false);
  });
});
