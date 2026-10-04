/**
 * @xdownload/cli — T013 first-class CLI adapter: direct/batch submission and
 * machine-readable status as a thin surface over the shared command/query/
 * result contracts (`@xdownload/core-seam` + `@xdownload/domain-contracts`).
 *
 * The CLI submits commands and renders Core-owned projections; it never owns
 * lifecycle truth (no private store/scheduler/budget/selection/result state,
 * no Core start/stop authority, no Desktop dependency).
 */

export {
  CLI_ID_PATTERN,
  CLI_USAGE,
  CliInputError,
  parseArgv,
  type ParsedInput,
  type PayloadSource,
  type TargetOptions,
  type WaitOptions,
} from './args.ts';
export {
  ACCEPTANCE_NOTE,
  CLI_OUTPUT_SCHEMA,
  EXIT,
  NO_MATCH_VERIFIED,
  needsUserActionFromTerminal,
  renderAcceptanceDocument,
  renderBatchDocument,
  renderErrorDocument,
  renderNeedsUserActionDocument,
  renderRejectionDocument,
  renderStatusDocument,
  renderWaitTimeoutDocument,
  renderPresentation,
  terminalExitCode,
  toJson,
  type AcceptanceDocument,
  type BatchDocument,
  type BatchItem,
  type ErrorDocument,
  type NeedsUserActionDocument,
  type Presentation,
  type RejectionDocument,
  type StatusDocument,
  type WaitTimeoutDocument,
} from './render.ts';
export {
  DEFAULT_WAIT,
  runAdapter,
  runArgv,
  type AdapterPorts,
  type AdapterResult,
  type SourceRequest,
} from './adapter.ts';
