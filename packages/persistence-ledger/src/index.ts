/**
 * @xdownload/persistence-ledger — T005 SQLite persistence, durable ledger
 * and recovery.
 *
 * Authoritative persistence for the T002 canonical domain: production
 * schema/migrations with an explicit version identity, stable
 * command/work/effect/artifact/attempt lineage, staged/materialized/
 * finalized/accepted lifecycle distinctions, transactional lifecycle-budget
 * facts, a filesystem artifact store bound by digest/provenance, a single
 * authoritative writer path and deterministic DB-first/FS-first recovery.
 *
 * Durability truth is bounded to the process-death/reopen tuple actually
 * exercised by the suites (see DURABILITY_CLAIM); execution semantics are
 * recoverable at-least-once with idempotent acceptance/reconciliation.
 */

export {
  PersistenceError,
  isPersistenceError,
  type PersistenceErrorCode,
  type PersistenceErrorDetail,
} from './errors.ts';
export {
  CURRENT_SCHEMA_VERSION,
  DURABILITY_CLAIM,
  PERSISTENCE_SCHEMA_FAMILY_ID,
  SUPPORTED_SCHEMA_VERSIONS,
  exercisedHostTuple,
  isSupportedSchemaVersion,
} from './version.ts';
export { MIGRATION_STEPS, type SchemaMigrationStep } from './migrations.ts';
export {
  LedgerConnection,
  LedgerDatabase,
  type LedgerDatabaseOptions,
  type Row,
  type SqlParam,
} from './connection.ts';
export {
  ARTIFACT_ID_PATTERN,
  FilesystemArtifactStore,
  assertArtifactId,
  fileSafeName,
  sha256Hex,
  type FilesystemArtifactObservation,
  type FilesystemArtifactPhase,
} from './artifact-store.ts';
export {
  FACT_KINDS,
  LIFECYCLE_STATE_RANK,
  LIFECYCLE_STATES,
  decodeFactKind,
  decodeLifecycleState,
  type ArtifactRow,
  type BudgetEntryRow,
  type BudgetEntryKind,
  type EffectRow,
  type FactKind,
  type LifecycleState,
  type TransitionFact,
  type WorkItemRow,
} from './rows.ts';
export { LedgerReader, isKnownBudgetLimitKey } from './reader.ts';
export {
  AuthoritativeLedgerWriter,
  type AcceptArtifactInput,
  type AcceptArtifactOutcome,
  type AcceptanceValidation,
  type BudgetContribution,
  type DispatchInput,
  type LifecycleWriterOutcome,
  type StageArtifactInput,
  type StageArtifactOutcome,
  type SubmitAcquisitionInput,
  type SubmitAcquisitionOutcome,
} from './writer.ts';
export {
  RecoveryService,
  type FilesystemTruthPhase,
  type LifecycleProjection,
  type RecoveryClass,
  type RecoveryClassification,
  type RecoveryServiceDeps,
} from './recovery.ts';
