/**
 * T005 production schema — ordered explicit versioned DDL.
 *
 * Design (F1 choice): explicit ordered DDL steps with `PRAGMA user_version`
 * as the durable version marker. Forward steps only ever ADD tables/columns
 * so authoritative rows and durable identities are preserved verbatim. A
 * designed backward path exists per version and is reachable only through
 * the explicit rollback entry point; it drops only the added tables and
 * never mutates historical identity (FAILURE_MATRIX `unsafe-migration`).
 *
 * Lifecycle states REGISTERED → STAGED → MATERIALIZED → FINALIZED → ACCEPTED
 * stay explicitly distinct (frozen L2 ADR-004, §6.2 promoted rules); the
 * CHECK constraint rejects unknown authoritative state enum values.
 */

import { PersistenceError } from './errors.ts';
import { CURRENT_SCHEMA_VERSION, PERSISTENCE_SCHEMA_FAMILY_ID } from './version.ts';

export interface SchemaMigrationStep {
  readonly version: number;
  readonly forwardStatements: readonly string[];
  /**
   * Designed backward path from this version to `version - 1`. Empty for
   * versions without an explicit rollback design (opening such a version
   * from below is a typed rejection, never an improvised downgrade).
   */
  readonly backwardStatements: readonly string[];
}

const SCHEMA_V1: SchemaMigrationStep = {
  version: 1,
  forwardStatements: [
    `CREATE TABLE ledger_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `INSERT INTO ledger_meta (key, value) VALUES ('schema_family', '${PERSISTENCE_SCHEMA_FAMILY_ID}')`,
    `CREATE TABLE work_items (
      work_item_id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL CHECK (
        lifecycle_state IN ('REGISTERED', 'STAGED', 'MATERIALIZED', 'FINALIZED', 'ACCEPTED')
      ),
      authorization_context_ref TEXT NOT NULL,
      budget_profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (snapshot_id, member_id),
      UNIQUE (effect_id)
    )`,
    `CREATE TABLE commands (
      command_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id),
      command_kind TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    )`,
    `CREATE TABLE effects (
      effect_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL UNIQUE REFERENCES work_items(work_item_id),
      intent_recorded_at TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('OBSERVED', 'ABSENT_UNKNOWN')),
      observed_at TEXT
    )`,
    `CREATE TABLE attempts (
      attempt_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id),
      attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
      started_at TEXT NOT NULL,
      UNIQUE (work_item_id, attempt_no)
    )`,
    `CREATE TABLE transition_facts (
      work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id),
      fact_seq INTEGER NOT NULL CHECK (fact_seq >= 1),
      fact_kind TEXT NOT NULL CHECK (
        fact_kind IN (
          'DISPATCH_INTENT',
          'EXTERNAL_EFFECT_OBSERVED',
          'FS_STAGED',
          'FS_MATERIALIZED',
          'FS_FINALIZED',
          'VALIDATION_PASSED',
          'ACCEPTED',
          'USER_CANCELLED',
          'EXPLICIT_RETRY_RESUME',
          'TERMINAL_FAILURE'
        )
      ),
      fact_payload_json TEXT,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (work_item_id, fact_seq)
    )`,
  ],
  backwardStatements: [],
};

const SCHEMA_V2: SchemaMigrationStep = {
  version: 2,
  forwardStatements: [
    `CREATE TABLE artifacts (
      artifact_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id),
      relative_path TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      byte_size INTEGER,
      digest_sha256 TEXT,
      recorded_at TEXT NOT NULL,
      UNIQUE (work_item_id, artifact_id)
    )`,
    `CREATE TABLE budget_entries (
      entry_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id),
      domain TEXT NOT NULL CHECK (domain IN ('discovery', 'transfer', 'global_safety')),
      limit_key TEXT NOT NULL,
      entry_kind TEXT NOT NULL CHECK (entry_kind IN ('RESERVATION', 'CONSUMPTION', 'RESERVATION_RELEASE')),
      amount INTEGER NOT NULL CHECK (amount >= 0),
      convergence_key TEXT UNIQUE,
      recorded_at TEXT NOT NULL
    )`,
    `CREATE INDEX budget_entries_by_work_item ON budget_entries (work_item_id, domain, limit_key)`,
  ],
  // Designed rollback v2 -> v1: drop only the v2 additions; v1 tables, rows
  // and identities are left untouched (never rewritten by migration).
  backwardStatements: ['DROP TABLE budget_entries', 'DROP TABLE artifacts'],
};

export const MIGRATION_STEPS: readonly SchemaMigrationStep[] = [SCHEMA_V1, SCHEMA_V2];

export function migrationStepFor(version: number): SchemaMigrationStep {
  const step = MIGRATION_STEPS.find((candidate) => candidate.version === version);
  if (step === undefined) {
    throw new PersistenceError(
      'MIGRATION_SAFETY_VIOLATION',
      `no migration step is defined for schema version ${version}`,
      { invariant: 'schema-versioning' },
    );
  }
  return step;
}

export interface MigrationOutcome {
  readonly from: number;
  readonly to: number;
  readonly appliedVersions: readonly number[];
}

export { CURRENT_SCHEMA_VERSION };
