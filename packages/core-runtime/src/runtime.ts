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
import type { AcquisitionContract } from '@xdownload/domain-contracts';
import { createS2ChunkStaging, executeS2DeliveredAcquisition } from './s2-delivered.ts';
import { cancelLineage, type FlowRuntime } from './flow.ts';
import {
  durableLayout,
  DurableStoreCorruptError,
  FileBackedControlFactLog,
  FileBackedSeamJournal,
  type DurableLayout,
} from './durable-stores.ts';
import { driveS1DirectExecution, decodeS1DirectPayload, s1EffectIdentity } from './s1-direct.ts';
import {
  driveS3SelectedMediaExecution,
  s3EffectIdentity,
  type S3DriveRuntime,
} from './s3-selected-media.ts';
import {
  digestSupportedMediaProfiles,
  lookupSupportedMediaProfile,
} from '@xdownload/direct-acquisition';
import {
  createS1DriveSupervisor,
  type S1DriveHealthEntry,
  type S1DriveSupervisor,
} from './s1-drive-supervisor.ts';
import { createS1TransferAbortHub, type S1TransferAbortHub } from './s1-transfer-abort.ts';

export { durableLayout, DurableStoreCorruptError, FileBackedControlFactLog, FileBackedSeamJournal };
export type { DurableLayout };
export { createS1DriveSupervisor, createS1TransferAbortHub };
export type { S1DriveHealthEntry, S1DriveSupervisor, S1TransferAbortHub };

/** Options for composing/reopening one authoritative Core Runtime. */
export interface CoreRuntimeOptions {
  /** Durable root directory: fact log, seam journal, SQLite ledger, artifacts. */
  readonly rootDir: string;
  /** The only same-install/same-user peer scope the seam admits. */
  readonly expectedPeer: ExpectedPeerScope;
  /**
   * Optional observer for Core-internal S1 drive health transitions (#101
   * R1/F03): a rejected/thrown drive is bounded-retried and its truthful
   * degraded/exhausted state surfaced here (the core host relays it to
   * stderr) instead of being silently swallowed. Diagnostics only — never
   * terminal truth.
   */
  readonly onS1DriveHealth?: (entry: S1DriveHealthEntry) => void;
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
  /**
   * Bounded observable S1 drive-health ledger (#101 R1/F03): the latest
   * supervised-drive state per aggregate (degraded retries, drained
   * recoveries, exhausted give-ups). Diagnostics only — lineage/terminal
   * truth stays with the durable stores; a listed aggregate's intent stays
   * registered and continues to reconcile (restart or future re-drive).
   */
  readonly s1DriveHealth: () => readonly S1DriveHealthEntry[];
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

function bindSeam(
  expectedPeer: ExpectedPeerScope,
  journal: SeamJournal,
  flowRuntime: FlowRuntime,
  supervisor: S1DriveSupervisor,
  transferAbort: S1TransferAbortHub,
): CoreSeamServer {
  // #95 R1/F04: chunked delivered streams stage inside the composition so
  // journal replay during seam construction rebuilds staged truth through
  // the same store before the completing chunk re-executes.
  const s2ChunkStaging = createS2ChunkStaging();
  // #101: the seam hands the S1 driver the seam completion ports once
  // constructed (chicken-and-egg resolved with a holder populated before
  // any frame or reconcile can run).
  const seamHolder: { current?: CoreSeamServer } = {};
  // #101 R1/F03: a rejected/thrown drive is a supervised bounded-retry
  // episode with an observable health record — never a silent swallow. The
  // verbatim seam rejection becomes the episode's diagnostic message.
  const drive = (
    seam: CoreSeamServer,
    input: { aggregateId: string; contract: AcquisitionContract; payload: unknown },
  ): void => {
    void supervisor.drive(input.aggregateId, async () => {
      const result = await driveS1DirectExecution(
        { ...flowRuntime, seam, s1TransferAbort: transferAbort },
        input,
      );
      if (!result.ok) {
        throw new Error(
          `s1 drive rejected: ${result.diagnostics.map((d) => `${d.code}:${d.path}`).join(', ')}`,
        );
      }
    });
  };
  const result = createCoreSeamServer({
    expectedPeer,
    journal,
    // #150: install the private S3 selected-media authority behind the
    // OS-verified session gate — the Core-owned supported-media profile
    // registry (closed, digest-pinned) plus the post-commit execution driver
    // over this same authoritative composition.
    s3MediaProfiles: {
      supportedProfile: (profileId) => lookupSupportedMediaProfile(profileId) !== undefined,
      profileContainerOf: (profileId) => lookupSupportedMediaProfile(profileId)?.container,
      profileProbeRevisionOf: (profileId) => lookupSupportedMediaProfile(profileId)?.probeRevision,
      registryDigest: () => digestSupportedMediaProfiles(),
    },
    s3SelectedMedia: {
      begin: (input) => {
        const seam = seamHolder.current;
        if (seam !== undefined) {
          void supervisor.drive(input.aggregateId, async () => {
            const result = await driveS3SelectedMediaExecution(
              { ...flowRuntime, seam, s1TransferAbort: transferAbort } satisfies S3DriveRuntime,
              input,
            );
            if (!result.ok) {
              throw new Error(
                `s3 drive rejected: ${result.diagnostics.map((d) => `${d.code}:${d.path}`).join(', ')}`,
              );
            }
          });
        }
      },
    },
    // #95: the one narrowly typed execution command is served by the Core
    // runtime's own delivered-bytes flow over this same authoritative
    // composition (writer/scheduler/store) — a second authority never
    // exists. The executor runs over the durable pieces directly so journal
    // replay during seam construction can re-apply accepted S2 commands.
    s2DeliveredAcquisition: {
      execute: (input) =>
        executeS2DeliveredAcquisition(
          flowRuntime,
          {
            aggregateId: input.aggregateId,
            contract: input.contract,
            payload: input.payload,
          },
          s2ChunkStaging,
        ),
    },
    // #101 first slice: the CLI-surface S1 direct execution command only
    // registers a durable intent at apply; the real HTTP transfer begins
    // strictly after the accepted-command journal commit and completes via
    // recordExecutedTerminal (Core-derived projector terminal).
    s1DirectAcquisition: {
      begin: (input) => {
        const seam = seamHolder.current;
        if (seam !== undefined) {
          drive(seam, input);
        }
      },
    },
    // #101 P2-1: the durably committed user cancel order connects to the
    // canonical stores and the in-flight transfer abort checkpoint. The
    // bridge self-filters aggregates without a registered S1 execution, so
    // other lanes (e.g. synchronous S2 delivery) are unaffected.
    s1LineageCancel: {
      cancelled: ({ aggregateId, source }) => {
        // Tear the in-flight transfer down at once (no lingering socket).
        transferAbort.abort(aggregateId);
        const seam = seamHolder.current;
        if (seam === undefined) {
          return;
        }
        const pending = seam
          .pendingS1Executions()
          .find((entry) => entry.aggregateId === aggregateId);
        if (pending !== undefined) {
          // Commit the cancel into BOTH canonical stores when the durable
          // execution already exists; when it does not (the drive has not
          // registered yet), the supervised re-drive below registers the
          // lineage with its cancellation and closes truthfully instead.
          const decoded = decodeS1DirectPayload(pending.payload);
          if (decoded.ok) {
            const identity = s1EffectIdentity({
              contractId: pending.contract.contractId,
              snapshotId: decoded.value.snapshotId,
              targetId: pending.contract.requestedTarget,
            });
            if (identity.ok) {
              const existing = flowRuntime.writer.reader
                .workItems()
                .find((workItem) => workItem.effectId === identity.value.effectId);
              if (existing !== undefined) {
                cancelLineage(flowRuntime, identity.value.lineageKey, source, existing.workItemId);
              }
            }
          }
          // Ensure the cancelled lineage reaches its truthful closure even
          // when no drive is live; an in-flight episode coalesces and its own
          // post-transfer checkpoint performs the closure.
          drive(seam, pending);
          return;
        }
        // #150: the same durably committed cancel closes an S3 selected-media
        // lineage: commit the cancel into BOTH canonical stores when the
        // durable execution exists, then re-drive the truthful closure.
        const pendingS3 = seam
          .pendingS3Executions()
          .find((entry) => entry.aggregateId === aggregateId);
        if (pendingS3 === undefined) {
          return;
        }
        const s3Identity = s3EffectIdentity({
          contractId: pendingS3.contract.contractId,
          snapshotId: pendingS3.candidate.snapshotId,
          targetId: pendingS3.contract.requestedTarget,
          memberId: pendingS3.candidate.memberId,
        });
        if (s3Identity.ok) {
          const existingS3 = flowRuntime.writer.reader
            .workItems()
            .find((workItem) => workItem.effectId === s3Identity.value.effectId);
          if (existingS3 !== undefined) {
            cancelLineage(flowRuntime, s3Identity.value.lineageKey, source, existingS3.workItemId);
          }
        }
        void supervisor.drive(pendingS3.aggregateId, async () => {
          const result = await driveS3SelectedMediaExecution(
            { ...flowRuntime, seam, s1TransferAbort: transferAbort } satisfies S3DriveRuntime,
            {
              aggregateId: pendingS3.aggregateId,
              contract: pendingS3.contract,
              candidate: pendingS3.candidate,
            },
          );
          if (!result.ok) {
            throw new Error(
              `s3 drive rejected: ${result.diagnostics.map((d) => `${d.code}:${d.path}`).join(', ')}`,
            );
          }
        });
      },
    },
  });
  if (!result.ok) {
    // Journal replay failed: durable seam truth is corrupt → fail closed.
    throw new CoreRuntimeCompositionError(
      `seam journal replay failed closed: ${result.diagnostics
        .map((d) => `${d.code}:${d.path}`)
        .join(', ')}`,
    );
  }
  seamHolder.current = result.value;
  return result.value;
}

/**
 * Reconcile registered S1 direct execution intents against durable truth.
 * Restart replay re-registers every journaled intent but never restores the
 * (unjournaled) in-memory terminal, so every non-terminal intent is
 * re-driven: the driver reconciles from the durable work item (no
 * re-download of an accepted artifact) and re-derives the identical
 * terminal through the projector. A replayed durably committed cancel is
 * re-driven too (#101 P2-1): the driver records the canonical cancel facts
 * (idempotent) and closes the lineage with the truthful projector output.
 * Drives run under the same supervisor as command-initiated drives (#101
 * R1/F03): failures are bounded-retried and surfaced in the runtime's
 * health ledger, never swallowed.
 */
function reconcileS1Executions(
  runtime: CoreRuntime,
  supervisor: S1DriveSupervisor,
  transferAbort: S1TransferAbortHub,
): void {
  for (const pending of runtime.seam.pendingS1Executions()) {
    const view = runtime.seam.inspectProjection(pending.aggregateId);
    if (view === undefined || view.lineage.status === 'TERMINAL') {
      continue;
    }
    void supervisor.drive(pending.aggregateId, async () => {
      const result = await driveS1DirectExecution(
        { ...runtime, s1TransferAbort: transferAbort },
        pending,
      );
      if (!result.ok) {
        throw new Error(
          `s1 drive rejected: ${result.diagnostics.map((d) => `${d.code}:${d.path}`).join(', ')}`,
        );
      }
    });
  }
}

/**
 * #150: reconcile registered S3 selected-media execution intents against
 * durable truth (identical discipline to S1): replay re-registered every
 * journaled intent; non-terminal intents re-drive from the durable work item
 * without re-downloading an accepted artifact.
 */
function reconcileS3Executions(
  runtime: CoreRuntime,
  supervisor: S1DriveSupervisor,
  transferAbort: S1TransferAbortHub,
): void {
  for (const pending of runtime.seam.pendingS3Executions()) {
    const view = runtime.seam.inspectProjection(pending.aggregateId);
    if (view === undefined || view.lineage.status === 'TERMINAL') {
      continue;
    }
    void supervisor.drive(pending.aggregateId, async () => {
      const result = await driveS3SelectedMediaExecution(
        { ...runtime, s1TransferAbort: transferAbort } satisfies S3DriveRuntime,
        {
          aggregateId: pending.aggregateId,
          contract: pending.contract,
          candidate: pending.candidate,
        },
      );
      if (!result.ok) {
        throw new Error(
          `s3 drive rejected: ${result.diagnostics.map((d) => `${d.code}:${d.path}`).join(', ')}`,
        );
      }
    });
  }
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
  const scheduler = new CoreScheduler(factLog);
  const terminalStore = createTerminalResultStore();
  const supervisor = createS1DriveSupervisor({ onHealth: options.onS1DriveHealth });
  const transferAbort = createS1TransferAbortHub();
  const runtime: CoreRuntime = Object.freeze({
    seam: bindSeam(
      options.expectedPeer,
      journal,
      {
        scheduler,
        writer,
        store,
        recovery,
        terminalStore,
      },
      supervisor,
      transferAbort,
    ),
    scheduler,
    writer,
    store,
    recovery,
    terminalStore,
    layout,
    expectedPeer: options.expectedPeer,
    recoveryAtComposition: Object.freeze([]),
    s1DriveHealth: supervisor.health,
  });
  reconcileS1Executions(runtime, supervisor, transferAbort);
  reconcileS3Executions(runtime, supervisor, transferAbort);
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
  const scheduler = new CoreScheduler(factLog);
  const terminalStore = createTerminalResultStore();
  const supervisor = createS1DriveSupervisor({ onHealth: options.onS1DriveHealth });
  const transferAbort = createS1TransferAbortHub();
  const runtime: CoreRuntime = Object.freeze({
    seam: bindSeam(
      options.expectedPeer,
      journal,
      {
        scheduler,
        writer,
        store,
        recovery,
        terminalStore,
      },
      supervisor,
      transferAbort,
    ),
    scheduler,
    writer,
    store,
    recovery,
    terminalStore,
    layout,
    expectedPeer: options.expectedPeer,
    recoveryAtComposition: Object.freeze(classifications),
    s1DriveHealth: supervisor.health,
  });
  // Restart reconcile: replay re-registered every S1 intent but never the
  // unjournaled terminal — re-drive non-terminal intents from durable truth.
  reconcileS1Executions(runtime, supervisor, transferAbort);
  reconcileS3Executions(runtime, supervisor, transferAbort);
  return runtime;
}

/** Release the runtime's durable handles (closes the authoritative writer). */
export function closeCoreRuntime(runtime: CoreRuntime): void {
  runtime.writer.close();
}
