/**
 * T005 persistence schema identity and version compatibility.
 *
 * The durable schema-version marker is SQLite `PRAGMA user_version`, backed
 * by a schema-family marker row so a foreign database declaring a matching
 * version still fails closed. Unsupported/incompatible versions are never
 * silently reinterpreted (frozen L2 invariant 1 analogue for the store).
 *
 * The schema-family id is a persistence-layer identity. It deliberately does
 * not restate or redefine the T002 contract schema identity
 * (`xdownload.domain-contracts`), which is stamped on canonical domain values.
 */

export const PERSISTENCE_SCHEMA_FAMILY_ID = 'xdownload.persistence-ledger' as const;

/** Current production schema version (durable marker: `PRAGMA user_version`). */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/** Schema versions this store can open deterministically. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];

export function isSupportedSchemaVersion(version: number): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}

/**
 * Bounded durability claim for this store (frozen Task Pack forbidden scope;
 * FAILURE_MATRIX `durability-overclaim`).
 *
 * Execution semantics are recoverable at-least-once with idempotent
 * acceptance/reconciliation. The only durability tuple claimed is
 * process-death/reopen on the host OS actually exercised by the tests. No
 * exactly-once execution and no host-power-loss durability are claimed.
 */
export const DURABILITY_CLAIM = Object.freeze({
  executionSemantics: 'RECOVERABLE_AT_LEAST_ONCE_IDEMPOTENT_ACCEPTANCE',
  durabilityTuple: 'PROCESS_DEATH_AND_REOPEN_ONLY',
  hostPowerLossClaimed: false,
  exactlyOnceClaimed: false,
} as const);

/** The exercised host OS tuple actually proven by the crash/restart suites. */
export function exercisedHostTuple(): {
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly kill: string;
  readonly recovery: string;
} {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    kill: 'SIGKILL-class hard process kill',
    recovery: 'reopen from durable SQLite file + filesystem bytes',
  };
}
