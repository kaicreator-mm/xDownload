/**
 * TEST_MATRIX suite `evidence-ledger-semantics` (T007): the ledger is
 * append-oriented; accepted records cannot be rewritten, reordered-as-rewrite
 * or deleted; corrections are new records; admission fails closed on
 * malformed/unknown records; queries return exactly the bound records without
 * promoting scope (PRD §20, L2 §6.7).
 */
import { describe, expect, it } from 'vitest';
import { createEvidenceLedger, unwrapOrThrow } from '../src/index.ts';
import { appendEvidenceOk, evidenceRaw } from './t007-helpers.ts';

describe('T007 EvidenceLedger semantics', () => {
  it('admits canonical evidence through the fail-closed decode path and keeps it queryable', () => {
    const ledger = createEvidenceLedger();
    const record = appendEvidenceOk(ledger, evidenceRaw());
    expect(record.claimType).toBe('TRANSFER');
    expect(record.evidenceId).toBe('evidence-t007-001');
    expect(ledger.size()).toBe(1);
    expect(ledger.findByEvidenceId(record.evidenceId)).toBeDefined();
  });

  it('every accepted record carries the PRD §20 fields', () => {
    const ledger = createEvidenceLedger();
    const record = appendEvidenceOk(ledger, evidenceRaw());
    expect(record.claimType).toBeDefined();
    expect(record.claimSubject).toBeDefined();
    expect(record.sourceType).toBeDefined();
    expect(record.provenance.sourceIdentity).toBeDefined();
    expect(record.independenceFromDiscovery).toBeDefined();
    expect(record.scope).toBeDefined();
    expect(record.certaintyClass).toBeDefined();
  });

  it('rejects a rewrite attempt: re-appending an accepted evidence id fails and changes nothing', () => {
    const ledger = createEvidenceLedger();
    appendEvidenceOk(ledger, evidenceRaw());
    const rewrite = ledger.append(
      evidenceRaw({ claimType: 'COVERAGE', provenance: { sourceIdentity: 'validator/other' } }),
    );
    expect(rewrite.ok).toBe(false);
    if (!rewrite.ok) {
      expect(rewrite.diagnostics.some((d) => d.code === 'LEDGER_MUTATION_REJECTED')).toBe(true);
    }
    expect(ledger.size()).toBe(1);
    expect(ledger.records()[0]?.claimType).toBe('TRANSFER');
  });

  it('has no deletion or rewrite capability at all (append-oriented by structure)', () => {
    const ledger = createEvidenceLedger();
    const shape = ledger as unknown as Record<string, unknown>;
    expect(shape['delete']).toBeUndefined();
    expect(shape['remove']).toBeUndefined();
    expect(shape['rewrite']).toBeUndefined();
    expect(shape['replace']).toBeUndefined();
  });

  it('corrections are new records with an explicit supersession edge; the superseded record remains', () => {
    const ledger = createEvidenceLedger();
    const original = appendEvidenceOk(ledger, evidenceRaw({ certaintyClass: 'SUGGESTIVE' }));
    const correction = unwrapOrThrow(
      ledger.appendCorrection(
        evidenceRaw({
          evidenceId: 'evidence-t007-002',
          certaintyClass: 'DECISIVE',
          provenance: { sourceIdentity: 'validator/t007-correction' },
        }),
        original.evidenceId,
      ),
    );
    expect(ledger.size()).toBe(2);
    expect(ledger.findByEvidenceId(original.evidenceId)?.certaintyClass).toBe('SUGGESTIVE');
    expect(ledger.supersessions()).toEqual([
      { supersedesEvidenceId: original.evidenceId, supersededByEvidenceId: correction.evidenceId },
    ]);
  });

  it('rejects a correction naming an unknown accepted record', () => {
    const ledger = createEvidenceLedger();
    const rejected = ledger.appendCorrection(
      evidenceRaw({ evidenceId: 'evidence-t007-003' }),
      'evidence-t007-unknown' as never,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
    }
    expect(ledger.size()).toBe(0);
  });

  it('fails closed on malformed and unknown-schema records at admission', () => {
    const ledger = createEvidenceLedger();
    expect(ledger.append({ completely: 'wrong' }).ok).toBe(false);
    expect(ledger.append(evidenceRaw({ claimType: 'NOT_A_REAL_CLAIM_TYPE' })).ok).toBe(false);
    expect(ledger.append(evidenceRaw({ extraField: 1 })).ok).toBe(false);
    expect(ledger.append(evidenceRaw({ certaintyClass: 'OMNISCIENT' })).ok).toBe(false);
    expect(ledger.size()).toBe(0);
  });

  it('fails closed on raw-secret fields at admission (C21)', () => {
    const ledger = createEvidenceLedger();
    const rejected = ledger.append(evidenceRaw({ cookie: 'session=steal-me' }));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((d) => d.code === 'RAW_SECRET_FIELD')).toBe(true);
    }
    expect(ledger.size()).toBe(0);
  });

  it('queries by claim type, subject and scope return exactly the bound records', () => {
    const ledger = createEvidenceLedger();
    const a = appendEvidenceOk(
      ledger,
      evidenceRaw({
        claimType: 'TRANSFER',
        claimSubject: { kind: 'MEMBER', ref: 'member-t007-001' },
      }),
    );
    appendEvidenceOk(
      ledger,
      evidenceRaw({
        evidenceId: 'evidence-t007-002',
        claimType: 'MEMBERSHIP',
        claimSubject: { kind: 'MEMBER', ref: 'member-t007-002' },
      }),
    );
    expect(ledger.query({ claimType: 'TRANSFER' })).toEqual([a]);
    expect(
      ledger
        .query({ subject: { kind: 'MEMBER', ref: 'member-t007-002' } })
        .map((r) => r.evidenceId),
    ).toEqual(['evidence-t007-002']);
    expect(ledger.query({ scope: { domain: 'BATCH_DOWNLOAD' } })).toHaveLength(2);
    expect(ledger.query({ claimType: 'QUALITY' })).toEqual([]);
  });

  it('scope queries never promote: broader or narrower bindings do not match exactly', () => {
    const ledger = createEvidenceLedger();
    appendEvidenceOk(
      ledger,
      evidenceRaw({
        scope: { domain: 'BATCH_DOWNLOAD', contractRef: 'contract-t007-001' },
      }),
    );
    // domain-only query must not pull the more tightly bound record
    expect(ledger.query({ scope: { domain: 'BATCH_DOWNLOAD' } })).toHaveLength(0);
    // exact binding matches
    expect(
      ledger.query({
        scope: { domain: 'BATCH_DOWNLOAD', contractRef: 'contract-t007-001' },
      }),
    ).toHaveLength(1);
    // differently bound scope does not match
    expect(
      ledger.query({
        scope: {
          domain: 'BATCH_DOWNLOAD',
          contractRef: 'contract-t007-001',
          snapshotRef: 'snapshot-x',
        },
      }),
    ).toHaveLength(0);
  });

  it('append order is preserved and returned records are frozen against external mutation', () => {
    const ledger = createEvidenceLedger();
    appendEvidenceOk(ledger, evidenceRaw({ evidenceId: 'evidence-t007-a1' }));
    appendEvidenceOk(
      ledger,
      evidenceRaw({ evidenceId: 'evidence-t007-a2', claimType: 'MEMBERSHIP' }),
    );
    const records = ledger.records();
    expect(records.map((record) => record.evidenceId)).toEqual([
      'evidence-t007-a1',
      'evidence-t007-a2',
    ]);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
  });
});
