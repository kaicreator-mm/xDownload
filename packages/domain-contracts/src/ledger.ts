/**
 * T007 Core-owned EvidenceLedger — append-oriented typed claim store
 * (frozen L2 §6.7 / ADR-009, PRD §20).
 *
 * Accepted records are never rewritten, reordered-as-rewrite or deleted;
 * corrections are new records linked by an explicit supersession edge while
 * the superseded record stays queryable. Admission is fail-closed: only
 * records that pass the canonical `decodeEvidenceRecord` path enter the
 * authoritative ledger. Queries are pure reads that never promote scope.
 * Durable storage belongs to the T003/T015 lanes; this is the semantics.
 */

import { deepFreeze, diagnostic, fail, ok, type DomainValidationResult } from './diagnostics.ts';
import { type EvidenceId } from './ids.ts';
import {
  decodeEvidenceRecord,
  type ClaimSubject,
  type ClaimType,
  type EvidenceRecord,
  type EvidenceScope,
} from './evidence.ts';

/** Exact-match query bounds. A query never promotes scope in either direction. */
export interface EvidenceLedgerQuery {
  readonly claimType?: ClaimType;
  readonly subject?: ClaimSubject;
  readonly scope?: EvidenceScope;
}

/** Explicit correction link: the superseded record remains in the ledger. */
export interface EvidenceSupersession {
  readonly supersedesEvidenceId: EvidenceId;
  readonly supersededByEvidenceId: EvidenceId;
}

export interface EvidenceLedger {
  /** Decode + admit one evidence record. Duplicate ids reject as rewrite attempts. */
  readonly append: (raw: unknown) => DomainValidationResult<EvidenceRecord>;
  /**
   * Admit a correction record that explicitly supersedes an existing record.
   * The superseded record is never removed or altered.
   */
  readonly appendCorrection: (
    raw: unknown,
    supersedesEvidenceId: EvidenceId,
  ) => DomainValidationResult<EvidenceRecord>;
  /** Accepted records in immutable append order (frozen copy). */
  readonly records: () => readonly EvidenceRecord[];
  readonly findByEvidenceId: (evidenceId: EvidenceId) => EvidenceRecord | undefined;
  /** Conjunctive exact-match query over claim type, subject and scope. */
  readonly query: (query: EvidenceLedgerQuery) => readonly EvidenceRecord[];
  readonly supersessions: () => readonly EvidenceSupersession[];
  readonly size: () => number;
}

function subjectEquals(a: ClaimSubject, b: ClaimSubject): boolean {
  return a.kind === b.kind && a.ref === b.ref;
}

function scopeEquals(a: EvidenceScope, b: EvidenceScope): boolean {
  return (
    a.domain === b.domain && a.contractRef === b.contractRef && a.snapshotRef === b.snapshotRef
  );
}

export function createEvidenceLedger(): EvidenceLedger {
  const accepted: EvidenceRecord[] = [];
  const byId = new Map<string, EvidenceRecord>();
  const supersessionEdges: EvidenceSupersession[] = [];

  const admit = (raw: unknown): DomainValidationResult<EvidenceRecord> => {
    const decoded = decodeEvidenceRecord(raw);
    if (!decoded.ok) {
      return decoded;
    }
    const record = decoded.value;
    if (byId.has(record.evidenceId)) {
      return fail([
        diagnostic(
          'LEDGER_MUTATION_REJECTED',
          'evidence.evidenceId',
          `evidence '${record.evidenceId}' is already accepted; append is not a rewrite — corrections are new records`,
          'L2-§6.7',
        ),
      ]);
    }
    accepted.push(record);
    byId.set(record.evidenceId, record);
    return ok(record);
  };

  return deepFreeze({
    append(raw) {
      return admit(raw);
    },
    appendCorrection(raw, supersedesEvidenceId) {
      const superseded = byId.get(supersedesEvidenceId);
      if (superseded === undefined) {
        return fail([
          diagnostic(
            'ADMISSION_REJECTED',
            'evidence.supersedesEvidenceId',
            `correction names unknown evidence '${supersedesEvidenceId}'; corrections must reference an accepted record`,
          ),
        ]);
      }
      const decoded = admit(raw);
      if (!decoded.ok) {
        return decoded;
      }
      supersessionEdges.push(
        deepFreeze({
          supersedesEvidenceId,
          supersededByEvidenceId: decoded.value.evidenceId,
        }),
      );
      return decoded;
    },
    records() {
      return deepFreeze([...accepted]);
    },
    findByEvidenceId(evidenceId) {
      return byId.get(evidenceId);
    },
    query(query) {
      return deepFreeze(
        accepted.filter(
          (record) =>
            (query.claimType === undefined || record.claimType === query.claimType) &&
            (query.subject === undefined || subjectEquals(record.claimSubject, query.subject)) &&
            (query.scope === undefined || scopeEquals(record.scope, query.scope)),
        ),
      );
    },
    supersessions() {
      return deepFreeze([...supersessionEdges]);
    },
    size() {
      return accepted.length;
    },
  });
}
