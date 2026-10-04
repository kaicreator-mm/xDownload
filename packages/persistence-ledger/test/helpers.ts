/**
 * T005 test helpers — real temp directories, real SQLite files, real
 * filesystem stores. No in-memory database and no mocked store appears in
 * any required suite (TEST_MATRIX negative case
 * `in-memory-db-substituted-for-real-file-in-required-suite`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthoritativeLedgerWriter,
  FilesystemArtifactStore,
  LedgerConnection,
  RecoveryService,
  type AcceptanceValidation,
  type SubmitAcquisitionOutcome,
} from '../src/index.ts';

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const BUDGET_PROFILE = {
  discovery: { domain: 'discovery', maxGeneratedRequests: 5 },
  transfer: { domain: 'transfer', maxBytes: 100_000, maxSegments: 10 },
  globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 100 },
} as const;

export const VALIDATION_OK: AcceptanceValidation = {
  passed: true,
  passedCount: 1,
  failedCount: 0,
};

export interface Scenario {
  readonly dir: string;
  readonly dbPath: string;
  readonly storeRoot: string;
  readonly store: FilesystemArtifactStore;
  readonly connection: LedgerConnection;
  readonly writer: AuthoritativeLedgerWriter;
  readonly recovery: RecoveryService;
}

export function openScenario(dir: string, dbFilename = 'ledger.sqlite'): Scenario {
  const dbPath = join(dir, dbFilename);
  const storeRoot = join(dir, 'artifacts');
  const store = new FilesystemArtifactStore(storeRoot);
  const connection = LedgerConnection.openWriter(dbPath);
  const writer = new AuthoritativeLedgerWriter(connection, store);
  const recovery = new RecoveryService({ writer, store });
  return { dir, dbPath, storeRoot, store, connection, writer, recovery };
}

/** Real restart: close the process-local handle, reopen from the same files. */
export function reopenScenario(scenario: Scenario): Scenario {
  scenario.connection.close();
  return openScenario(scenario.dir, scenario.dbPath.split(/[\\/]/).pop() ?? 'ledger.sqlite');
}

export interface SubmitFixtureOverrides {
  readonly workItemId?: string;
  readonly commandId?: string;
  readonly snapshotId?: string;
  readonly memberId?: string;
  readonly effectId?: string;
  readonly bytes?: Uint8Array;
  readonly artifactId?: string;
  readonly authorizationContextRef?: string;
}

export interface FixtureIds {
  readonly workItemId: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly artifactId: string;
  readonly memberId: string;
  readonly snapshotId: string;
}

export function fixtureIds(overrides: SubmitFixtureOverrides = {}): FixtureIds {
  return {
    workItemId: overrides.workItemId ?? 'work:w1',
    commandId: overrides.commandId ?? 'cmd:w1',
    snapshotId: overrides.snapshotId ?? 'snapshot:s1',
    memberId: overrides.memberId ?? 'member:m1',
    effectId: overrides.effectId ?? 'effect:e1',
    artifactId: overrides.artifactId ?? 'artifact:a1',
  };
}

export function submitFixture(
  scenario: Scenario,
  overrides: SubmitFixtureOverrides = {},
): FixtureIds & { readonly outcome: SubmitAcquisitionOutcome } {
  const ids = fixtureIds(overrides);
  const outcome = scenario.writer.submitAcquisition({
    commandId: ids.commandId,
    commandKind: 'ACQUIRE',
    workItemId: ids.workItemId,
    contractId: 'contract:c1',
    snapshotId: ids.snapshotId,
    memberId: ids.memberId,
    effectId: ids.effectId,
    authorizationContextRef: overrides.authorizationContextRef ?? 'authref:test-context',
    budgetProfile: BUDGET_PROFILE,
    artifactProvenance: { sourceRef: 'https://fixture.invalid/source' },
  });
  return { ...ids, outcome };
}

export const FIXTURE_BYTES: Uint8Array = Buffer.from('t005 fixture artifact bytes\n', 'utf8');

/** Drive one lineage through observed effect and finalized bytes. */
export function driveToFinalized(
  scenario: Scenario,
  overrides: SubmitFixtureOverrides = {},
  options: { readonly withDispatch?: boolean } = {},
): FixtureIds {
  const ids = submitFixture(scenario, overrides);
  if (options.withDispatch !== false) {
    scenario.writer.dispatch({
      workItemId: ids.workItemId,
      attemptId: `attempt:${ids.workItemId}`,
      reservations: [
        {
          domain: 'transfer',
          limitKey: 'bytes',
          amount: 40_000,
          convergenceKey: `plan:${ids.workItemId}`,
        },
      ],
    });
    scenario.writer.recordExternalEffectObserved(ids.workItemId);
  }
  const bytes = overrides.bytes ?? FIXTURE_BYTES;
  scenario.writer.stageArtifact({
    workItemId: ids.workItemId,
    artifactId: ids.artifactId,
    bytes,
    provenance: { sourceRef: 'https://fixture.invalid/source' },
    consumption: {
      domain: 'transfer',
      limitKey: 'bytes',
      amount: bytes.length,
      convergenceKey: `consumed:${ids.artifactId}`,
    },
  });
  scenario.writer.materializeArtifact(ids.workItemId, ids.artifactId);
  scenario.writer.finalizeArtifact(ids.workItemId, ids.artifactId);
  return ids;
}
