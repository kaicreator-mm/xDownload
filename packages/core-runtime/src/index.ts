/**
 * @xdownload/core-runtime — T015 authoritative Core Runtime integration.
 *
 * The single composition root converging command/query (T004 core-seam),
 * control (T006 core-scheduler), persistence/recovery (T005
 * persistence-ledger), typed evidence/result projection (T002/T007
 * domain-contracts) and the S1/S3/S4 execution adapters (T008/T009) into one
 * authoritative Core Control Runtime (frozen L2 §6.1 Alternative C).
 *
 * Composition glue only: lifecycle (create/reopen/close), canonical budget
 * bridges to the adapters, and canonical flow wiring. No domain semantics
 * live here — every decision remains owned by the consumed packages.
 */

export {
  durableLayout,
  DurableStoreCorruptError,
  FileBackedControlFactLog,
  FileBackedSeamJournal,
  type DurableLayout,
} from './durable-stores.ts';
export {
  closeCoreRuntime,
  CoreRuntimeCompositionError,
  createCoreRuntime,
  reopenCoreRuntime,
  type CoreRuntime,
  type CoreRuntimeOptions,
} from './runtime.ts';
export {
  CoreRuntimeBudgetBridge,
  schedulerHlsTransferLedger,
  schedulerTransferBudgetPort,
} from './budget-bridge.ts';
export {
  cancelLineage,
  CoreRuntimeFlowError,
  effectIdFor,
  executeDirectAcquisition,
  executeHlsAcquisition,
  projectLineageResult,
  registerLineage,
  resumeLineage,
  type DirectFlowInput,
  type DirectFlowOutcome,
  type HlsFlowInput,
  type HlsFlowOutcome,
  type LineageProjectionInput,
  type LineageSeed,
} from './flow.ts';
