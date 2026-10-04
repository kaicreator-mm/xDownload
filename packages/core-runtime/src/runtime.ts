/**
 * T015 authoritative Core Runtime — the single composition root.
 *
 * This package composes the already-merged T002/T004/T005/T006/T007/T008/T009
 * packages through their public APIs as-is into ONE authoritative Core
 * Control Runtime (frozen L2 §6.1 Alternative C). It is lifecycle + wiring +
 * nothing else: every domain decision (acceptance, cancellation cutoff,
 * budget truth, terminal status, validation verdicts) remains owned by the
 * upstream package that already implements it.
 *
 * Composition (one instance each, no second authority):
 *
 *   CoreSeamServer(expectedPeer, journal ← FileBackedSeamJournal)
 *   CoreScheduler(DurableControlFactLog ← FileBackedControlFactLog)
 *   AuthoritativeLedgerWriter(LedgerConnection.openWriter ← one SQLite file,
 *                             FilesystemArtifactStore ← one root)
 *   RecoveryService({writer, store})
 *   DirectHttpAdapter(TransferBudgetLedgerPort ← scheduler BudgetLedger bridge)
 *   HLS VOD pipeline (TransferLedger ← the same canonical BudgetLedger bridge)
 *
 * Restart (`reopenCoreRuntime`) re-derives state only from durable truth:
 * the durable fact log (decoded fail-closed through the scheduler's own
 * reopen gate), the seam journal (replayed by `createCoreSeamServer`), the
 * SQLite ledger and the artifact store — classified by `RecoveryService`.
 * Restart never replenishes budgets, never re-enumerates membership and
 * never mints successor identity.
 */

import { mkdirSync } from 'node:fs';
import {
  createCoreSeamServer,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type SeamJournal,
} from '@xdownload/core-seam';
import { CoreScheduler, serializeFacts } from '@xdownload/core-scheduler';
import {
  AuthoritativeLedgerWriter,
  FilesystemArtifactStore,
  LedgerConnection,
  RecoveryService,
  type RecoveryClassification,
} from '@xdownload/persistence-ledger';
import { createTerminalResultStore, type TerminalResultStore } from '@xdownload/domain-contracts';
import {
  durableLayout,
  DurableStoreCorruptError,
  FileBackedControlFactLog,
  FileBackedSeamJournal,
  type DurableLayout,
} from './durable-stores.ts';

export { durableLayout, DurableStoreCorruptError, FileBackedControlFactLog, FileBackedSeamJournal };
export type { DurableLayout };

/** Options for composing/reopening one authoritative Core Runtime. */
export interface CoreRuntimeOptions {
  /** Durable root directory: fact log, seam journal, SQLite ledger, artifacts. */
  readonly rootDir: string;
  /** The only same-install/same-user peer scope the seam admits. */
  readonly expectedPeer: ExpectedPeerScope;
}

/** The composed authoritative Core Runtime (one instance per install). */
export interface CoreRuntime {
  /** Command/query authority boundary (transport-neutral seam port). */
  readonly seam: CoreSeamServer;
  /** Control layer over the durable control fact log. */
  readonly scheduler: CoreScheduler;
  /** The single authoritative lifecycle writer (one per database file). */
  readonly writer: AuthoritativeLedgerWriter;
  /** Digest/provenance-bound filesystem artifact store. */
  readonly store: FilesystemArtifactStore;
  /** DB-first/FS-first recovery classification service. */
  readonly recovery: RecoveryService;
  /** Terminal-result store over the domain-contracts result projector. */
  readonly terminalStore: TerminalResultStore;
  /** Durable file layout this runtime was composed/reopened over. */
  readonly layout: DurableLayout;
  /** Expected seam peer scope. */
  readonly expectedPeer: ExpectedPeerScope;
  /** Recovery classification captured at composition/reopen time. */
  readonly recoveryAtComposition: readonly RecoveryClassification[];
}

export class CoreRuntimeCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreRuntimeCompositionError';
  }
}

function composePersistence(layout: DurableLayout): {
  writer: AuthoritativeLedgerWriter;
  store: FilesystemArtifactStore;
  recovery: RecoveryService;
} {
  // Single-writer discipline is enforced upstream: a second writable handle
  // for the same database file is a typed violation (L2 §10).
  const store = new FilesystemArtifactStore(layout.artifactRoot);
  const connection = LedgerConnection.openWriter(layout.dbPath);
  const writer = new AuthoritativeLedgerWriter(connection, store);
  const recovery = new RecoveryService({ writer, store });
  return { writer, store, recovery };
}

function bindSeam(expectedPeer: ExpectedPeerScope, journal: SeamJournal): CoreSeamServer {
  const result = createCoreSeamServer({ expectedPeer, journal });
  if (!result.ok) {
    // Journal replay failed: durable seam truth is corrupt → fail closed.
    throw new CoreRuntimeCompositionError(
      `seam journal replay failed closed: ${result.diagnostics
        .map((d) => `${d.code}:${d.path}`)
        .join(', ')}`,
    );
  }
  return result.value;
}

/**
 * Compose a FRESH authoritative Core Runtime over an empty durable root.
 * Refuses to clobber existing durable truth (use `reopenCoreRuntime`).
 */
export function createCoreRuntime(options: CoreRuntimeOptions): CoreRuntime {
  mkdirSync(options.rootDir, { recursive: true });
  const layout = durableLayout(options.rootDir);
  const factLog = FileBackedControlFactLog.createFresh(layout.factLogPath);
  const journal = FileBackedSeamJournal.createFresh(layout.journalPath);
  const { writer, store, recovery } = composePersistence(layout);
  const runtime: CoreRuntime = Object.freeze({
    seam: bindSeam(options.expectedPeer, journal),
    scheduler: new CoreScheduler(factLog),
    writer,
    store,
    recovery,
    terminalStore: createTerminalResultStore(),
    layout,
    expectedPeer: options.expectedPeer,
    recoveryAtComposition: Object.freeze([]),
  });
  return runtime;
}

/**
 * Restart composition: reopen the runtime from durable truth only.
 *
 * Order (REFERENCE_PACK §3.4 — reopen, never migration):
 * 1. decode the durable control fact log fail-closed and re-derive every
 *    scheduler view through the scheduler's own `reopenFromJson` gate;
 * 2. reopen the persistence ledger (single writer) + artifact store and
 *    classify every durable work item through `RecoveryService`;
 * 3. replay the seam journal into a fresh seam server (idempotent
 *    acceptance is restored so duplicates still converge after restart).
 */
export function reopenCoreRuntime(options: CoreRuntimeOptions): CoreRuntime {
  const layout = durableLayout(options.rootDir);
  const factLog = FileBackedControlFactLog.openExisting(layout.factLogPath);
  // The scheduler's documented reopen gate re-validates the same durable
  // facts end-to-end; its rejection means corrupt durable truth.
  const schedulerReopen = CoreScheduler.reopenFromJson(serializeFacts(factLog.readAll()));
  if (!schedulerReopen.ok) {
    throw new DurableStoreCorruptError(
      layout.factLogPath,
      `scheduler reopen rejected the durable fact log: ${schedulerReopen.rejection.code}`,
    );
  }
  const journal = FileBackedSeamJournal.openExisting(layout.journalPath);
  const { writer, store, recovery } = composePersistence(layout);
  // Read-only recovery classification of every durable work item: the
  // DB-first/FS-first truth the reopened runtime inherits.
  const classifications = writer.reader
    .workItems()
    .map((workItem) => recovery.classify(workItem.workItemId));
  const runtime: CoreRuntime = Object.freeze({
    seam: bindSeam(options.expectedPeer, journal),
    scheduler: new CoreScheduler(factLog),
    writer,
    store,
    recovery,
    terminalStore: createTerminalResultStore(),
    layout,
    expectedPeer: options.expectedPeer,
    recoveryAtComposition: Object.freeze(classifications),
  });
  return runtime;
}

/** Release the runtime's durable handles (closes the authoritative writer). */
export function closeCoreRuntime(runtime: CoreRuntime): void {
  runtime.writer.close();
}
