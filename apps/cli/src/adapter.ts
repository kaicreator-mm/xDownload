/**
 * T013 CLI adapter — the thin client behavior layer over the T004 seam.
 *
 * Flow (REFERENCE_PACK §3.1, presentation-only at every arrow; no arrow
 * creates domain state locally):
 *
 *   argv/batch input (typed local errors) → canonical payload via
 *   `@xdownload/domain-contracts` decoders (fail closed) → CommandEnvelope
 *   via `createSeamClient` (SurfaceKind 'CLI', idempotent requestId,
 *   correlation) → SeamResponse: ACCEPTED (record acceptance) | REJECTED
 *   (project diagnostics verbatim) | PROJECTION (render) → documented exit.
 *
 * The CLI never owns lifecycle truth: no Core start/stop, no private store,
 * no surface-local status derivation, no retry bookkeeping. Reconnection and
 * idempotency stay inside the T004 client (same requestId on replay).
 */

import {
  createSeamClient,
  currentSeamSchemaIdentity,
  makeCommandRequestId,
  makePeerInstallId,
  makePeerUserId,
  makeSeamRevision,
  payloadByteLength,
  s3SelectionTupleDigest,
  s4SelectionTupleDigest,
  SEAM_MESSAGE_LIMITS,
  S4_PUBLIC_MEDIA_PROFILE_ID,
  type CommandEnvelope,
  type PeerIdentity,
  type QueryEnvelope,
  type S4RenditionFact,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamProjectionView,
  type SeamResponse,
} from '@xdownload/core-seam';
import {
  decodeAcquisitionContract,
  decodeSelectionSnapshot,
  currentSchemaIdentity,
  parseSemVer,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import {
  CliInputError,
  parseArgv,
  type ParsedInput,
  type TargetOptions,
  type WaitOptions,
} from './args.ts';
import { runDomainAppInput } from './domain-app-cli.ts';
import {
  EXIT,
  renderAcceptanceDocument,
  renderBatchDocument,
  renderErrorDocument,
  renderNeedsUserActionDocument,
  renderRejectionDocument,
  renderS3SelectionDocument,
  renderS4SelectionDocument,
  renderStatusDocument,
  renderWaitTimeoutDocument,
  terminalExitCode,
  toJson,
  type BatchItem,
  type S3SelectionTupleDocument,
  type S4SelectionTupleDocument,
} from './render.ts';

/** Payload source shape passed to the port (mirrors args PayloadSource, unbranded). */
export interface SourceRequest {
  readonly stdin: boolean;
  readonly file: string | undefined;
}

/**
 * The outcome of one explicit interactive selection gesture (#150, L2 S3
 * §2.1): 'confirmed' only for an affirmative reply on an attached TTY;
 * 'declined' for any other reply; 'unavailable' when no interactive
 * terminal exists — the S3 lane never auto-confirms and never reads a
 * redirected/piped gesture.
 */
export type SelectionGesture = 'confirmed' | 'declined' | 'unavailable';

/**
 * #153 the outcome of one explicit interactive rendition (quality) choice
 * (L2 SEAM12 §3): 'confirmed' carries the exact chosen Core-observed
 * rendition key; 'declined' for any other answer; 'unavailable' when no
 * interactive terminal exists — the S4 lane never auto-selects and never
 * reads a redirected/piped choice.
 */
export type RenditionSelection =
  | { readonly choice: 'confirmed'; readonly renditionKey: string }
  | { readonly choice: 'declined' }
  | { readonly choice: 'unavailable' };

/** Injectable process ports; the process entry binds real ones. */
export interface AdapterPorts {
  readonly clientTransport: SeamClientTransport;
  readonly readSource: (source: SourceRequest) => Promise<string>;
  readonly now: () => string;
  readonly makeRequestId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly epochMs: () => number;
  /**
   * Interactive selection confirmation port (#150): displays the prompt on
   * the real terminal and captures one explicit user gesture. Absent on
   * non-interactive compositions → the media command stops before any Core
   * effect (NEEDS_USER_ACTION).
   */
  readonly confirmSelection?: (prompt: string) => Promise<SelectionGesture>;
  /**
   * #153 Interactive rendition selection port: displays the Core-projected
   * variant list and captures one explicit choice. Absent on non-interactive
   * compositions → the hls command stops before any selection/confirmation
   * (NEEDS_USER_ACTION).
   */
  readonly selectRendition?: (prompt: string) => Promise<RenditionSelection>;
}

export interface AdapterResult {
  /** Documented exit code (see render.ts EXIT table). */
  readonly exitCode: number;
  /** Exactly one machine-readable JSON document (stdout). */
  readonly document: string;
  /** Non-normative human note (stderr). */
  readonly stderr: string;
}

export const DEFAULT_WAIT: WaitOptions = { timeoutMs: 30_000, pollMs: 200 };

interface Session {
  readonly client: SeamClient;
  readonly peer: PeerIdentity;
}

/** The CLI's presenting peer identity (SurfaceKind 'CLI'; seam re-decides). */
export function buildCliPeer(target: TargetOptions): PeerIdentity {
  return buildPeer(target);
}

function buildPeer(target: TargetOptions): PeerIdentity {
  const installId = makePeerInstallId(target.installId);
  if (!installId.ok) {
    throw new CliInputError('USAGE', '--install-id is not a valid peer identity', [
      {
        code: 'PEER_IDENTITY_REJECTED',
        path: 'peer.installId',
        message: installId.diagnostics[0]?.message ?? 'invalid',
      },
    ]);
  }
  const userId = makePeerUserId(target.userId);
  if (!userId.ok) {
    throw new CliInputError('USAGE', '--user-id is not a valid peer identity', [
      {
        code: 'PEER_IDENTITY_REJECTED',
        path: 'peer.userId',
        message: userId.diagnostics[0]?.message ?? 'invalid',
      },
    ]);
  }
  // The CLI presents SurfaceKind 'CLI'; authorization is re-decided by the
  // seam per frame — the CLI has no local admission path.
  return { installId: installId.value, userId: userId.value, surface: 'CLI' };
}

function openSession(ports: AdapterPorts, input: ParsedInput): Session {
  if (input.kind === 'help') {
    throw new CliInputError('USAGE', 'help is handled by the process entry');
  }
  const peer = buildPeer(input.target);
  const target: SeamListenTarget = {
    host: input.target.host,
    port: input.target.port,
    ...(input.target.pipeName === undefined ? {} : { pipeName: input.target.pipeName }),
  };
  const client = createSeamClient({
    transport: ports.clientTransport,
    target,
    peer,
    maxReconnectAttempts: 3,
  });
  return { client, peer };
}

function requestId(input: string | undefined, ports: AdapterPorts): string {
  const raw = input ?? ports.makeRequestId();
  const branded = makeCommandRequestId(raw);
  if (!branded.ok) {
    throw new CliInputError('USAGE', '--request-id is not a valid command identity', [
      {
        code: 'ENVELOPE_MALFORMED',
        path: 'requestId',
        message: branded.diagnostics[0]?.message ?? 'invalid requestId',
      },
    ]);
  }
  return branded.value;
}

function revision(value: number): number {
  const branded = makeSeamRevision(value);
  if (!branded.ok) {
    throw new CliInputError('USAGE', '--expected-revision must be a non-negative integer', [
      {
        code: 'ENVELOPE_MALFORMED',
        path: 'expectedRevision',
        message: branded.diagnostics[0]?.message ?? 'invalid revision',
      },
    ]);
  }
  return branded.value;
}

function parseJsonDocument(text: string, what: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CliInputError('USAGE', `${what} is not valid JSON`);
  }
  return parsed;
}

/** Decode a contract payload through the canonical domain decoder (fail closed). */
function decodeContractText(text: string): AcquisitionContract {
  const parsed = parseJsonDocument(text, 'contract payload');
  const decoded = decodeAcquisitionContract(parsed);
  if (!decoded.ok) {
    throw new CliInputError('USAGE', 'contract payload is not a canonical AcquisitionContract', [
      ...decoded.diagnostics,
    ]);
  }
  return decoded.value;
}

/**
 * Enforce the declared seam bounds client-side before any submission so an
 * oversized item fails as a typed local error instead of a wire rejection;
 * the declared `SEAM_MESSAGE_LIMITS` constants are the only bounds used.
 */
function enforceDeclaredBounds(payload: unknown, envelope: unknown): void {
  const payloadBytes = payloadByteLength(payload);
  if (payloadBytes > SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
    throw new CliInputError(
      'PAYLOAD_TOO_LARGE',
      `serialized payload of ${String(payloadBytes)} bytes exceeds the declared bound ${String(SEAM_MESSAGE_LIMITS.maxPayloadBytes)} (SEAM_MESSAGE_LIMITS.maxPayloadBytes)`,
    );
  }
  const frameBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (frameBytes > SEAM_MESSAGE_LIMITS.maxFrameBytes) {
    throw new CliInputError(
      'PAYLOAD_TOO_LARGE',
      `serialized envelope of ${String(frameBytes)} bytes exceeds the declared frame bound ${String(SEAM_MESSAGE_LIMITS.maxFrameBytes)} (SEAM_MESSAGE_LIMITS.maxFrameBytes)`,
    );
  }
}

function buildCommandEnvelope(input: {
  commandType: CommandEnvelope['commandType'];
  aggregateId: string;
  req: string | undefined;
  expectedRevision: number;
  correlation: CommandEnvelope['correlation'];
  payload: unknown;
  session: Session;
  ports: AdapterPorts;
}): CommandEnvelope {
  const envelope: CommandEnvelope = {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: input.commandType,
    peer: input.session.peer,
    requestId: requestId(input.req, input.ports) as CommandEnvelope['requestId'],
    aggregateId: input.aggregateId,
    expectedRevision: revision(input.expectedRevision) as CommandEnvelope['expectedRevision'],
    correlation: input.correlation,
    issuedAt: input.ports.now(),
    payload: input.payload,
  };
  enforceDeclaredBounds(input.payload, envelope);
  return envelope;
}

function buildQueryEnvelope(input: {
  aggregateId: string;
  req: string;
  session: Session;
  ports: AdapterPorts;
}): QueryEnvelope {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    queryType: 'READ_PROJECTION',
    peer: input.session.peer,
    requestId: requestId(input.req, input.ports) as QueryEnvelope['requestId'],
    aggregateId: input.aggregateId,
    issuedAt: input.ports.now(),
  };
}

/**
 * Probe the installed Core before creating the first S1 aggregate. The older
 * 1.0 Core understands this read-only legacy query, but cannot execute S1.
 * Its AGGREGATE_NOT_FOUND rejection only becomes a compatibility signal when
 * every response correlation/shape/version condition is satisfied (#114).
 */
async function requireS1CoreCompatibility(
  session: Session,
  ports: AdapterPorts,
  aggregateId: string,
): Promise<void> {
  const query: QueryEnvelope = {
    ...buildQueryEnvelope({ aggregateId, req: ports.makeRequestId(), session, ports }),
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
  };
  const response = await session.client.submitQuery(query);
  const version = parseSemVer(response.schemaIdentity.version);
  const diagnostic = response.diagnostics?.[0];
  const compatible =
    response.schemaIdentity.schema === 'xdownload.core-seam' &&
    version !== undefined &&
    version.major === 1 &&
    version.minor >= 1 &&
    response.kind === 'response' &&
    response.inReplyTo === query.requestId &&
    response.outcome === 'REJECTED' &&
    response.diagnostics?.length === 1 &&
    diagnostic?.code === 'AGGREGATE_NOT_FOUND' &&
    diagnostic.path === 'aggregateId' &&
    response.acceptance === undefined &&
    response.projection === undefined;
  if (!compatible) {
    throw new CliInputError('USAGE', 'S1 requires Core seam 1.1', [
      {
        code: 'UNSUPPORTED_ENVELOPE_VERSION',
        path: 'schemaIdentity.version',
        message: 'S1 preflight did not verify compatible Core on the intended fresh task',
      },
    ]);
  }
}

interface AcceptedOutcome {
  readonly revision: number;
  readonly converged: boolean;
  readonly currentRevision: number;
  readonly requestId: string;
}

/**
 * Contract-selection fact of the payload the operator themselves submitted:
 * an EXPLICIT_USER_SELECTION basis requires a user CONFIRM_SNAPSHOT before
 * acquisition can proceed. This is the operator's own input rendered back,
 * never Core-derived status.
 */
function requiresUserConfirmation(contract: AcquisitionContract): boolean {
  return contract.selectionPolicy.basis === 'EXPLICIT_USER_SELECTION';
}

async function readContractPayload(
  ports: AdapterPorts,
  source: { stdin: boolean; file: string | undefined },
): Promise<AcquisitionContract> {
  let text: string;
  try {
    text = await ports.readSource(source);
  } catch (error) {
    throw new CliInputError(
      'USAGE',
      `cannot read payload source: ${error instanceof Error ? error.message : 'read failed'}`,
    );
  }
  return decodeContractText(text);
}

async function submitContract(
  session: Session,
  ports: AdapterPorts,
  input: {
    contract: AcquisitionContract;
    req: string | undefined;
    expectedRevision: number;
    command: string;
  },
): Promise<{ accepted: AcceptedOutcome; needsUserAction: boolean } | { rejected: SeamResponse }> {
  const envelope = buildCommandEnvelope({
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: input.contract.contractId,
    req: input.req ?? ports.makeRequestId(),
    expectedRevision: input.expectedRevision,
    correlation: { contractId: input.contract.contractId },
    payload: input.contract,
    session,
    ports,
  });
  const response = await session.client.submitCommand(envelope);
  if (response.outcome !== 'ACCEPTED' || response.acceptance === undefined) {
    return { rejected: response };
  }
  return {
    accepted: {
      revision: response.acceptance.revision,
      converged: response.acceptance.converged,
      currentRevision: response.currentRevision ?? response.acceptance.revision,
      requestId: response.acceptance.requestId,
    },
    needsUserAction: requiresUserConfirmation(input.contract),
  };
}

async function readProjection(
  session: Session,
  ports: AdapterPorts,
  aggregateId: string,
): Promise<SeamResponse> {
  return session.client.submitQuery(
    buildQueryEnvelope({ aggregateId, req: ports.makeRequestId(), session, ports }),
  );
}

/**
 * Bounded wait: poll READ_PROJECTION until a terminal result is projected or
 * the declared bound elapses. Non-interactive mode never blocks on
 * confirmation and never invents a status at the bound.
 */
async function waitForTerminalProjection(
  session: Session,
  ports: AdapterPorts,
  input: { contractId: string; wait: WaitOptions },
): Promise<
  | { readonly terminal: true; readonly view: SeamProjectionView }
  | { readonly terminal: false; readonly timedOut: true }
  | { readonly terminal: false; readonly rejected: SeamResponse }
> {
  const deadline = ports.epochMs() + input.wait.timeoutMs;
  for (;;) {
    const response = await readProjection(session, ports, input.contractId);
    if (response.outcome === 'REJECTED') {
      return { terminal: false, rejected: response };
    }
    if (response.outcome === 'PROJECTION') {
      const view = response.projection as SeamProjectionView;
      if (view.terminal !== undefined) {
        return { terminal: true, view };
      }
    }
    const remaining = deadline - ports.epochMs();
    if (remaining <= 0) {
      return { terminal: false, timedOut: true };
    }
    await ports.sleep(Math.min(input.wait.pollMs, remaining));
  }
}

function statusFromView(view: SeamProjectionView): { document: string; exitCode: number } {
  const doc = renderStatusDocument(view);
  // Wait-mode final exit reflects the final request/selection result;
  // plain status reads exit SUCCESS once the read itself succeeded.
  return { document: toJson(doc), exitCode: EXIT.SUCCESS };
}

function rejectionResult(
  command: string,
  response: SeamResponse,
  aggregateId: string | null,
): AdapterResult {
  const doc = renderRejectionDocument({
    command,
    requestId: response.inReplyTo,
    contractId: aggregateId,
    currentRevision: response.currentRevision ?? null,
    diagnostics: response.diagnostics ?? [],
  });
  return {
    exitCode: EXIT.REJECTED,
    document: toJson(doc),
    stderr: `${command}: rejected by the seam (exit ${String(EXIT.REJECTED)})\n`,
  };
}

function transportResult(error: unknown): AdapterResult {
  const doc = renderErrorDocument({
    error: 'TRANSPORT',
    message: error instanceof Error ? error.message : 'seam connection failed',
  });
  return {
    exitCode: EXIT.TRANSPORT,
    document: toJson(doc),
    stderr: `transport failure (exit ${String(EXIT.TRANSPORT)})\n`,
  };
}

function inputResult(error: CliInputError): AdapterResult {
  const doc = renderErrorDocument({
    error: error.kind,
    message: error.message,
    usage: error.kind === 'USAGE',
    diagnostics: error.diagnostics,
  });
  return {
    exitCode: EXIT.USAGE,
    document: toJson(doc),
    stderr: `input error (exit ${String(EXIT.USAGE)})\n`,
  };
}

async function runSubmit(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'submit' }>,
): Promise<AdapterResult> {
  const contract = await readContractPayload(ports, {
    stdin: input.source.stdin,
    file: input.source.file,
  });
  const outcome = await submitContract(session, ports, {
    contract,
    req: input.requestId,
    expectedRevision: input.expectedRevision,
    command: 'submit',
  });
  if ('rejected' in outcome) {
    return rejectionResult('submit', outcome.rejected, contract.contractId);
  }
  if (input.wait !== null) {
    if (outcome.needsUserAction) {
      // Bounded non-interactive behavior: return the NEEDS_USER_ACTION state
      // instead of blocking or polling on a confirmation the user must issue.
      const doc = renderNeedsUserActionDocument({
        contractId: contract.contractId,
        requestId: outcome.accepted.requestId,
      });
      return {
        exitCode: EXIT.NEEDS_USER_ACTION,
        document: toJson(doc),
        stderr: `needs user action (exit ${String(EXIT.NEEDS_USER_ACTION)})\n`,
      };
    }
    const waited = await waitForTerminalProjection(session, ports, {
      contractId: contract.contractId,
      wait: input.wait,
    });
    if (waited.terminal) {
      const view = waited.view;
      const exit = view.terminal === undefined ? EXIT.SUCCESS : terminalExitCode(view.terminal);
      return {
        exitCode: exit,
        document: toJson(renderStatusDocument(view)),
        stderr: `submit --wait: terminal result rendered (exit ${String(exit)})\n`,
      };
    }
    if ('rejected' in waited) {
      return rejectionResult('wait', waited.rejected, contract.contractId);
    }
    const doc = renderWaitTimeoutDocument({
      contractId: contract.contractId,
      timeoutMs: input.wait.timeoutMs,
      pollMs: input.wait.pollMs,
    });
    return {
      exitCode: EXIT.WAIT_TIMEOUT,
      document: toJson(doc),
      stderr: `bounded wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
    };
  }
  const doc = renderAcceptanceDocument({
    command: 'submit',
    contractId: contract.contractId,
    requestId: outcome.accepted.requestId,
    revision: outcome.accepted.revision,
    converged: outcome.accepted.converged,
    currentRevision: outcome.accepted.currentRevision,
    needsUserAction: outcome.needsUserAction,
  });
  const exit = outcome.needsUserAction ? EXIT.NEEDS_USER_ACTION : EXIT.SUCCESS;
  return {
    exitCode: exit,
    document: toJson(doc),
    stderr: `submit accepted (exit ${String(exit)})\n`,
  };
}

/**
 * Bounded S1 transfer budget for one CLI download invocation: generous file
 * headroom, never unbounded; the frozen decode keeps the shape canonical.
 */
const S1_BUDGET_PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 50,
    maxNavigationActions: 20,
    maxModelCalls: 5,
  },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_073_741_824,
    maxSegments: 5000,
    maxActiveTransferMs: 3_600_000,
    maxRetryTransferRequests: 5,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 500,
    maxActiveElapsedMs: 7_200_000,
  },
} as const;

/**
 * Build the canonical S1 single-resource contract from the operator's own
 * download facts (presentation-only: the CLI invents no semantics; the
 * canonical payload still passes the frozen domain decoder fail-closed, and
 * the seam/Core own every authority decision).
 *
 * Each invocation mints one fresh contract identity: a completed or failed
 * download is immutable truth, and re-invocation creates a new acquisition
 * (PRD §8 successor discipline stays with the Core, not with client-side
 * identity reuse).
 */
function buildS1Contract(
  input: Extract<ParsedInput, { kind: 'download' }>,
  ports: AdapterPorts,
): { contract: AcquisitionContract; base: string } {
  // The canonical composite effect identity (effect:<contract>:<snapshot>:
  // <target>) must stay inside the 128-char canonical id bound, so the
  // derived identity base is bounded to 16 chars.
  const base = ports.makeRequestId().replace(/^req-/, '').slice(0, 16);
  const contractId = `contract-s1-${base}`;
  const targetId = `target-s1-${base}`;
  const decoded = decodeAcquisitionContract({
    schemaIdentity: currentSchemaIdentity(),
    contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: targetId,
    requestedScope: { kind: 'single_resource', targetId },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: S1_BUDGET_PROFILE,
    authorizationContextRef: 'authctx/s1-direct-public',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: ports.now(),
  });
  if (!decoded.ok) {
    throw new CliInputError('USAGE', 'download facts do not form a canonical S1 contract', [
      ...decoded.diagnostics,
    ]);
  }
  return { contract: decoded.value, base };
}

async function runDownload(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'download' }>,
): Promise<AdapterResult> {
  const { contract, base } = buildS1Contract(input, ports);
  await requireS1CoreCompatibility(session, ports, contract.contractId);
  const submit = await submitContract(session, ports, {
    contract,
    req: input.requestId,
    expectedRevision: 0,
    command: 'download',
  });
  let currentRevision: number;
  if ('rejected' in submit) {
    // A pre-existing identical contract identity converges into the execute
    // step; any other rejection is projected verbatim (never absorbed).
    const code = submit.rejected.diagnostics?.[0]?.code;
    if (code !== 'DUPLICATE_ALLOCATION') {
      return rejectionResult('download', submit.rejected, contract.contractId);
    }
    currentRevision = submit.rejected.currentRevision ?? 1;
  } else {
    currentRevision = submit.accepted.currentRevision;
  }
  const executePayload = {
    snapshotId: `s1snap-${base}`,
    memberId: `s1member-${base}`,
    artifactId: `s1artifact-${base}`,
    delivery: {
      locatorUri: input.url,
      declaredRedirectHosts: [...input.redirectHosts],
      // An independently published digest is optional (#101 R1/F01): when the
      // operator has one it is enforced (mismatch fails); omitted, the Target
      // claim rests on the declared delivery graph (C34 provenance basis).
      ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
      ...(input.expectedContentTypePrefix === undefined
        ? {}
        : { expectedContentTypePrefix: input.expectedContentTypePrefix }),
      ...(input.expectedTotalBytes === undefined
        ? {}
        : { expectedTotalBytes: input.expectedTotalBytes }),
    },
  };
  const executeEnvelope = buildCommandEnvelope({
    commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
    aggregateId: contract.contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId: contract.contractId },
    payload: executePayload,
    session,
    ports,
  });
  const executed = await session.client.submitCommand(executeEnvelope);
  if (executed.outcome !== 'ACCEPTED' || executed.acceptance === undefined) {
    return rejectionResult('download', executed, contract.contractId);
  }
  // Acceptance of the execution command is not acquisition success: the
  // terminal truth is Core-derived and read back through the projection.
  const waited = await waitForTerminalProjection(session, ports, {
    contractId: contract.contractId,
    wait: input.wait,
  });
  if (waited.terminal) {
    const view = waited.view;
    const exit = view.terminal === undefined ? EXIT.SUCCESS : terminalExitCode(view.terminal);
    return {
      exitCode: exit,
      document: toJson(renderStatusDocument(view)),
      stderr: `download: terminal result rendered (exit ${String(exit)})\n`,
    };
  }
  if ('rejected' in waited) {
    return rejectionResult('download', waited.rejected, contract.contractId);
  }
  const doc = renderWaitTimeoutDocument({
    contractId: contract.contractId,
    timeoutMs: input.wait.timeoutMs,
    pollMs: input.wait.pollMs,
  });
  return {
    exitCode: EXIT.WAIT_TIMEOUT,
    document: toJson(doc),
    stderr: `bounded wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
  };
}

/**
 * #150 — the S3 selected-media user journey over the OS-verified Core pipe:
 *
 *   fresh-task capability probe (Core ≥1.2)
 *   → SUBMIT_CONTRACT (single resource, explicit user selection, 4 layers)
 *   → CONFIRM_SNAPSHOT (freezes the one selected member)
 *   → REQUEST_S3_SELECTION_CHALLENGE (Core mints a single-use challenge
 *     bound to this session/revision/displayed tuple)
 *   → display the EXACT canonical tuple + digest, capture one explicit
 *     interactive gesture (no --yes, no piped stdin, no auto-confirm)
 *   → CONFIRM_S3_CANDIDATE (durable candidate; Core consumes the challenge
 *     atomically with the journal commit)
 *   → EXECUTE_S3_SELECTED_MEDIA (durable intent; the Core performs the real
 *     public HTTPS transfer with Target/Transfer/Format/Media validation)
 *   → bounded wait for the Core-derived terminal (never a synthetic
 *     COMPLETE from any acceptance along the way).
 */
async function runMedia(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'media' }>,
): Promise<AdapterResult> {
  const confirmSelection = ports.confirmSelection;
  // Interactive capability check BEFORE any Core round trip: the S3 lane has
  // no non-interactive mode (L2 S3 §2.1 negatives: headless CLI must stop).
  if (confirmSelection === undefined) {
    const doc = renderErrorDocument({
      error: 'USAGE',
      message: 'media requires an interactive terminal; no confirmation port is available',
    });
    return {
      exitCode: EXIT.NEEDS_USER_ACTION,
      document: toJson(doc),
      stderr: 'interactive confirmation unavailable (exit NEEDS_USER_ACTION)\n',
    };
  }
  const base = ports.makeRequestId().replace(/^req-/, '').slice(0, 16);
  const contractId = `contract-s3-${base}`;
  const targetId = `target-s3-${base}`;
  const snapshotId = `s3snap-${base}`;
  const memberId = `s3member-${base}`;
  const tuple: S3SelectionTupleDocument = {
    contract_id: contractId,
    snapshot_id: snapshotId,
    member_id: memberId,
    variant_key: input.variantKey,
    selected_locator: input.url,
    media_profile_id: input.mediaProfileId,
  };
  await requireS3CoreCompatibility(session, ports, contractId);

  // 1. Single-resource contract under explicit user selection with the
  //    four required validation layers (Target/Transfer/Format/Media).
  const contract = decodeContractText(
    JSON.stringify({
      schemaIdentity: currentSchemaIdentity(),
      contractId,
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      requestedTarget: targetId,
      requestedScope: { kind: 'single_resource', targetId },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
      automationMode: 'MANUAL_SELECTION',
      explorationPermission: 'NONE',
      budgetProfile: S1_BUDGET_PROFILE,
      authorizationContextRef: 'authctx/s3-selected-public-media',
      validationPolicy: { requiredLayers: ['target', 'transfer', 'format', 'media'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: ports.now(),
    }),
  );
  const submit = await submitContract(session, ports, {
    contract,
    req: input.requestId,
    expectedRevision: 0,
    command: 'media',
  });
  if ('rejected' in submit) {
    return rejectionResult('media', submit.rejected, contractId);
  }
  let currentRevision = submit.accepted.currentRevision;

  // 2. Freeze the one selected member in a confirmed snapshot.
  const snapshotPayload = {
    schemaIdentity: currentSchemaIdentity(),
    snapshotId,
    contractId,
    requestedScope: { kind: 'single_resource', targetId },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:${targetId}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    selectedMemberIds: [memberId],
    authorizationContextRef: 'authctx/s3-selected-public-media',
    profileContextRef: 'profile/s3-selected-media-001',
    selectionClaims: [
      { kind: 'SINGLE', confirmationType: 'CONFIRM_RESOURCE_IDENTITY', memberRefs: [memberId] },
    ],
    sourceMarker: { system: 'xdownload-cli', version: 'v0.1.0' },
    createdAt: ports.now(),
  };
  const confirmSnapshotEnvelope = buildCommandEnvelope({
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: snapshotPayload,
    session,
    ports,
  });
  const confirmSnapshot = await session.client.submitCommand(confirmSnapshotEnvelope);
  if (confirmSnapshot.outcome !== 'ACCEPTED' || confirmSnapshot.acceptance === undefined) {
    return rejectionResult('media', confirmSnapshot, contractId);
  }
  currentRevision = confirmSnapshot.currentRevision ?? confirmSnapshot.acceptance.revision;

  // 3. Ask the Core to mint one single-use challenge for THIS displayed tuple.
  const challengeEnvelope = buildCommandEnvelope({
    commandType: 'REQUEST_S3_SELECTION_CHALLENGE',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      snapshotId,
      memberId,
      variantKey: input.variantKey,
      locatorUri: input.url,
      declaredRedirectHosts: [...input.redirectHosts],
      mediaProfileId: input.mediaProfileId,
    },
    session,
    ports,
  });
  const challengeResponse = await session.client.submitCommand(challengeEnvelope);
  if (challengeResponse.outcome !== 'ACCEPTED' || challengeResponse.challenge === undefined) {
    return rejectionResult('media', challengeResponse, contractId);
  }
  const challenge = challengeResponse.challenge;

  // 4. Independently derive the canonical tuple digest and require the
  //    Core's challenge to bind the SAME displayed tuple.
  const localDigest = s3SelectionTupleDigest({
    contractId,
    snapshotId,
    memberId,
    variantKey: input.variantKey,
    selectedLocator: input.url,
    mediaProfileId: input.mediaProfileId,
  });
  if (localDigest !== challenge.tupleDigest) {
    throw new CliInputError(
      'USAGE',
      'the Core-issued challenge binds a different selection tuple than the CLI displayed; stopping before any confirmation',
      [
        {
          code: 'CORRELATION_BINDING_REJECTED',
          path: 'selectionAttestation.displayTupleDigest',
          message: `cli digest ${localDigest} != core digest ${challenge.tupleDigest}`,
        },
      ],
    );
  }

  // 5. Display the exact canonical tuple and capture one explicit gesture.
  const prompt = [
    '',
    '=== xdownload S3 selected media ===',
    `contract       : ${tuple.contract_id}`,
    `snapshot       : ${tuple.snapshot_id}`,
    `member         : ${tuple.member_id}`,
    `variant        : ${tuple.variant_key}`,
    `locator        : ${tuple.selected_locator}`,
    `media profile  : ${tuple.media_profile_id}`,
    `tuple digest   : ${localDigest}`,
    `redirect hosts : ${input.redirectHosts.join(', ')}`,
    ...(input.byteConstraintSha256 === undefined
      ? []
      : [`byte sha256    : ${input.byteConstraintSha256}`]),
    '',
    'Confirm downloading exactly this media variant? [y/N] ',
  ].join('\n');
  const gesture = await confirmSelection(prompt);
  if (gesture !== 'confirmed') {
    const doc = renderS3SelectionDocument({
      tuple,
      tupleDigest: localDigest,
      challengeExpiresAt: challenge.expiresAt,
      state: gesture === 'declined' ? 'DECLINED' : 'TERMINAL_UNAVAILABLE',
      confirmed: false,
      reason: gesture === 'declined' ? 'USER_DECLINED' : 'INTERACTIVE_TERMINAL_UNAVAILABLE',
    });
    return {
      exitCode: EXIT.NEEDS_USER_ACTION,
      document: toJson(doc),
      stderr: `media selection not confirmed; nothing was executed (exit ${String(EXIT.NEEDS_USER_ACTION)})\n`,
    };
  }

  // 6. Durable candidate confirmation: the attestation carries the
  //    CORE-ISSUED challenge (interactionId), the canonical displayed tuple
  //    digest, the confirmation time and the Core revision the challenge
  //    was bound to.
  const confirmEnvelope = buildCommandEnvelope({
    commandType: 'CONFIRM_S3_CANDIDATE',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      snapshotId,
      memberId,
      variantKey: input.variantKey,
      locatorUri: input.url,
      declaredRedirectHosts: [...input.redirectHosts],
      mediaProfileId: input.mediaProfileId,
      selectionAttestation: {
        kind: 'EXPLICIT_CLI_GESTURE',
        interactionId: challenge.challenge,
        displayTupleDigest: localDigest,
        confirmedAt: ports.now(),
        expectedRevision: challenge.coreRevision,
      },
      ...(input.byteConstraintSha256 === undefined
        ? {}
        : { byteConstraintSha256: input.byteConstraintSha256 }),
      ...(input.expectedContentTypePrefix === undefined
        ? {}
        : { expectedContentTypePrefix: input.expectedContentTypePrefix }),
      ...(input.expectedTotalBytes === undefined
        ? {}
        : { expectedTotalBytes: input.expectedTotalBytes }),
    },
    session,
    ports,
  });
  const confirmed = await session.client.submitCommand(confirmEnvelope);
  if (confirmed.outcome !== 'ACCEPTED' || confirmed.acceptance === undefined) {
    return rejectionResult('media', confirmed, contractId);
  }
  currentRevision = confirmed.currentRevision ?? confirmed.acceptance.revision;

  // 7. Execute: the Core derives the single canonical effect and performs
  //    the transfer; ACCEPTED here is still not acquisition success.
  const executeEnvelope = buildCommandEnvelope({
    commandType: 'EXECUTE_S3_SELECTED_MEDIA',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: { snapshotId, memberId },
    session,
    ports,
  });
  const executed = await session.client.submitCommand(executeEnvelope);
  if (executed.outcome !== 'ACCEPTED' || executed.acceptance === undefined) {
    return rejectionResult('media', executed, contractId);
  }

  // 8. Bounded wait for the Core-derived terminal truth.
  const waited = await waitForTerminalProjection(session, ports, {
    contractId,
    wait: input.wait,
  });
  if (waited.terminal) {
    const view = waited.view;
    const exit = view.terminal === undefined ? EXIT.SUCCESS : terminalExitCode(view.terminal);
    return {
      exitCode: exit,
      document: toJson(renderStatusDocument(view)),
      stderr: `media: terminal result rendered (exit ${String(exit)})\n`,
    };
  }
  if ('rejected' in waited) {
    return rejectionResult('media', waited.rejected, contractId);
  }
  const doc = renderWaitTimeoutDocument({
    contractId,
    timeoutMs: input.wait.timeoutMs,
    pollMs: input.wait.pollMs,
  });
  return {
    exitCode: EXIT.WAIT_TIMEOUT,
    document: toJson(doc),
    stderr: `bounded wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
  };
}

/**
 * #153 — the S4 selected-HLS user journey over the OS-verified Core pipe:
 *
 *   fresh-task capability probe (Core ≥1.2)
 *   → SUBMIT_CONTRACT (single resource, explicit user selection, 4 layers)
 *   → CONFIRM_SNAPSHOT (freezes the one selected member)
 *   → PREVIEW_S4_HLS_VOD (Core journals the preview intent, then performs the
 *     bounded master read; the CLI renders ONLY the Core-projected variants)
 *   → explicit interactive rendition (quality) choice (no --rendition auto-
 *     select without a human; --rendition still requires the YES/NO gesture)
 *   → CONFIRM_S4_SELECTION BEGIN (Core mints one single-use connection-bound
 *     private challenge) → explicit YES/NO confirmation of the EXACT tuple
 *   → CONFIRM_S4_SELECTION COMMIT (durable selection; challenge consumed
 *     atomically with the journal commit)
 *   → EXECUTE_S4_SELECTED_HLS_VOD (durable intent; the Core performs the real
 *     bounded segment download + FFmpeg Media validation)
 *   → bounded wait for the Core-derived terminal (never a synthetic
 *     COMPLETE from any acceptance along the way).
 */
async function runHls(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'hls' }>,
): Promise<AdapterResult> {
  const confirmSelection = ports.confirmSelection;
  const selectRendition = ports.selectRendition;
  // Interactive capability check BEFORE any Core round trip: the S4 lane has
  // no non-interactive mode (L2 SEAM12 §3 negatives: headless CLI must stop).
  if (confirmSelection === undefined || selectRendition === undefined) {
    const doc = renderErrorDocument({
      error: 'USAGE',
      message: 'hls requires an interactive terminal; no selection port is available',
    });
    return {
      exitCode: EXIT.NEEDS_USER_ACTION,
      document: toJson(doc),
      stderr: 'interactive selection unavailable (exit NEEDS_USER_ACTION)\n',
    };
  }
  const base = ports.makeRequestId().replace(/^req-/, '').slice(0, 16);
  const contractId = `contract-s4-${base}`;
  const targetId = `target-s4-${base}`;
  const snapshotId = `s4snap-${base}`;
  const memberId = `s4member-${base}`;
  await requireS4CoreCompatibility(session, ports, contractId);

  // 1. Single-resource contract under explicit user selection with the
  //    four required validation layers (Target/Transfer/Format/Media).
  const contract = decodeContractText(
    JSON.stringify({
      schemaIdentity: currentSchemaIdentity(),
      contractId,
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      requestedTarget: targetId,
      requestedScope: { kind: 'single_resource', targetId },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
      automationMode: 'MANUAL_SELECTION',
      explorationPermission: 'NONE',
      budgetProfile: S1_BUDGET_PROFILE,
      authorizationContextRef: 'authctx/s4-selected-public-hls',
      validationPolicy: { requiredLayers: ['target', 'transfer', 'format', 'media'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: ports.now(),
    }),
  );
  const submit = await submitContract(session, ports, {
    contract,
    req: input.requestId,
    expectedRevision: 0,
    command: 'hls',
  });
  if ('rejected' in submit) {
    return rejectionResult('hls', submit.rejected, contractId);
  }
  let currentRevision = submit.accepted.currentRevision;

  // 2. Freeze the one selected member in a confirmed snapshot.
  const snapshotPayload = {
    schemaIdentity: currentSchemaIdentity(),
    snapshotId,
    contractId,
    requestedScope: { kind: 'single_resource', targetId },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:${targetId}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    selectedMemberIds: [memberId],
    authorizationContextRef: 'authctx/s4-selected-public-hls',
    profileContextRef: 'profile/s4-selected-media-001',
    selectionClaims: [
      { kind: 'SINGLE', confirmationType: 'CONFIRM_RESOURCE_IDENTITY', memberRefs: [memberId] },
    ],
    sourceMarker: { system: 'xdownload-cli', version: 'v0.1.0' },
    createdAt: ports.now(),
  };
  const confirmSnapshotEnvelope = buildCommandEnvelope({
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: snapshotPayload,
    session,
    ports,
  });
  const confirmSnapshot = await session.client.submitCommand(confirmSnapshotEnvelope);
  if (confirmSnapshot.outcome !== 'ACCEPTED' || confirmSnapshot.acceptance === undefined) {
    return rejectionResult('hls', confirmSnapshot, contractId);
  }
  currentRevision = confirmSnapshot.currentRevision ?? confirmSnapshot.acceptance.revision;

  // 3. Core-journalled bounded preview of the exact public master playlist.
  const previewEnvelope = buildCommandEnvelope({
    commandType: 'PREVIEW_S4_HLS_VOD',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      snapshotId,
      memberId,
      manifestUri: input.manifestUri,
      mediaProfileId: S4_PUBLIC_MEDIA_PROFILE_ID,
    },
    session,
    ports,
  });
  const previewResponse = await session.client.submitCommand(previewEnvelope);
  if (previewResponse.outcome !== 'ACCEPTED' || previewResponse.acceptance === undefined) {
    return rejectionResult('hls', previewResponse, contractId);
  }
  currentRevision = previewResponse.currentRevision ?? previewResponse.acceptance.revision;

  // 4. Bounded wait for the Core-observed preview facts (projection only).
  const previewed = await waitForS4PreviewResult(session, ports, {
    contractId,
    wait: input.wait,
  });
  if (!previewed.terminal) {
    if ('rejected' in previewed) {
      return rejectionResult('hls', previewed.rejected, contractId);
    }
    const doc = renderWaitTimeoutDocument({
      contractId,
      timeoutMs: input.wait.timeoutMs,
      pollMs: input.wait.pollMs,
    });
    return {
      exitCode: EXIT.WAIT_TIMEOUT,
      document: toJson(doc),
      stderr: `bounded preview wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
    };
  }
  const preview = previewed.preview;
  if (preview.status === 'FAILED') {
    const doc = renderRejectionDocument({
      command: 'hls',
      requestId: previewResponse.inReplyTo,
      contractId,
      currentRevision,
      diagnostics: [
        {
          code: 'ADMISSION_REJECTED',
          path: 's4Preview.failureReason',
          message: `the Core-observed preview failed truthfully: ${preview.failureReason ?? 'UNKNOWN'}`,
        },
      ],
    });
    return {
      exitCode: EXIT.REJECTED,
      document: toJson(doc),
      stderr: `preview failed: ${preview.failureReason ?? 'UNKNOWN'} (exit ${String(EXIT.REJECTED)})\n`,
    };
  }
  const variants = preview.variants ?? [];
  if (variants.length === 0) {
    const doc = renderErrorDocument({
      error: 'USAGE',
      message: 'the Core-observed preview carries no renderable variants',
    });
    return {
      exitCode: EXIT.REJECTED,
      document: toJson(doc),
      stderr: 'preview carried no variants; nothing was selected or executed\n',
    };
  }

  // 5. Explicit rendition (quality) choice from the Core-projected facts.
  let chosen: S4RenditionFact | undefined;
  if (input.renditionKey !== undefined) {
    chosen = variants.find((variant) => variant.key === input.renditionKey);
    if (chosen === undefined) {
      const doc = renderErrorDocument({
        error: 'USAGE',
        message: `--rendition ${input.renditionKey} is not among the Core-observed renditions`,
      });
      return {
        exitCode: EXIT.USAGE,
        document: toJson(doc),
        stderr: 'rendition preselection does not match the preview (exit USAGE)\n',
      };
    }
  } else {
    const list = variants
      .map(
        (variant, index) =>
          `  [${String(index)}] ${variant.key}  ${
            variant.width !== undefined && variant.height !== undefined
              ? `${String(variant.width)}x${String(variant.height)}  `
              : ''
          }${String(variant.bandwidth)} bps${variant.codecs === undefined ? '' : `  ${variant.codecs}`}\n        ${variant.uri}`,
      )
      .join('\n');
    const prompt = [
      '',
      '=== xdownload S4 preview — Core-observed renditions ===',
      `manifest : ${preview.manifestUri}`,
      `preview  : ${preview.previewId} (expires ${preview.expiresAt})`,
      list,
      '',
      'Enter the index or key of the rendition to download: ',
    ].join('\n');
    const selection = await selectRendition(prompt);
    if (selection.choice !== 'confirmed') {
      const doc = renderS4SelectionDocument({
        tuple: tupleOf(preview, variants[0]!, contractId),
        tupleDigest: '',
        challengeExpiresAt: null,
        state: selection.choice === 'declined' ? 'DECLINED' : 'TERMINAL_UNAVAILABLE',
        confirmed: false,
        reason:
          selection.choice === 'declined' ? 'USER_DECLINED' : 'INTERACTIVE_TERMINAL_UNAVAILABLE',
      });
      return {
        exitCode: EXIT.NEEDS_USER_ACTION,
        document: toJson(doc),
        stderr: `rendition not selected; nothing was executed (exit ${String(EXIT.NEEDS_USER_ACTION)})\n`,
      };
    }
    chosen =
      variants.find((variant) => variant.key === selection.renditionKey) ??
      (/^[0-9]+$/.test(selection.renditionKey)
        ? variants[Number(selection.renditionKey)]
        : undefined);
    if (chosen === undefined) {
      const doc = renderErrorDocument({
        error: 'USAGE',
        message: 'the interactive rendition choice did not name a Core-observed variant',
      });
      return {
        exitCode: EXIT.NEEDS_USER_ACTION,
        document: toJson(doc),
        stderr: 'invalid rendition choice; nothing was executed\n',
      };
    }
  }
  const variant = chosen;

  // 6. Independently derive the canonical tuple digest and ask the Core to
  //    mint one single-use private challenge for THIS displayed tuple.
  const tuple: S4SelectionTupleDocument = tupleOf(preview, variant, contractId);
  const localDigest = s4SelectionTupleDigest({
    contractId,
    snapshotId,
    memberId,
    previewId: preview.previewId,
    renditionKey: variant.key,
    renditionUri: variant.uri,
    manifestUri: preview.manifestUri,
    mediaProfileId: preview.mediaProfileId,
    bandwidth: variant.bandwidth,
    ...(variant.width === undefined ? {} : { width: variant.width }),
    ...(variant.height === undefined ? {} : { height: variant.height }),
  });
  const beginEnvelope = buildCommandEnvelope({
    commandType: 'CONFIRM_S4_SELECTION',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      phase: 'BEGIN',
      snapshotId,
      memberId,
      previewId: preview.previewId,
      renditionKey: variant.key,
      displayedTupleDigest: localDigest,
    },
    session,
    ports,
  });
  const beginResponse = await session.client.submitCommand(beginEnvelope);
  if (beginResponse.outcome !== 'ACCEPTED' || beginResponse.s4PrivateChallenge === undefined) {
    return rejectionResult('hls', beginResponse, contractId);
  }
  const challenge = beginResponse.s4PrivateChallenge;
  if (challenge.previewId !== preview.previewId || challenge.renditionKey !== variant.key) {
    return rejectionResult(
      'hls',
      {
        schemaIdentity: currentSeamSchemaIdentity(),
        kind: 'response',
        inReplyTo: beginEnvelope.requestId,
        outcome: 'REJECTED',
        diagnostics: [
          {
            code: 'CORRELATION_BINDING_REJECTED',
            path: 's4PrivateChallenge',
            message:
              'the Core-issued challenge binds a different preview/rendition than the CLI displayed',
          },
        ],
      },
      contractId,
    );
  }

  // 7. Display the exact canonical tuple and capture one explicit gesture.
  const prompt = [
    '',
    '=== xdownload S4 selected HLS ===',
    `contract       : ${tuple.contract_id}`,
    `snapshot       : ${tuple.snapshot_id}`,
    `member         : ${tuple.member_id}`,
    `preview        : ${tuple.preview_id}`,
    `manifest       : ${tuple.manifest_uri}`,
    `rendition      : ${tuple.rendition_key}`,
    `rendition uri  : ${tuple.rendition_uri}`,
    `resolution     : ${tuple.width === null ? '-' : String(tuple.width)}x${tuple.height === null ? '-' : String(tuple.height)}`,
    `bandwidth      : ${String(tuple.bandwidth)}`,
    `media profile  : ${tuple.media_profile_id}`,
    `tuple digest   : ${localDigest}`,
    `challenge ends : ${challenge.expiresAt}`,
    '',
    'Confirm downloading exactly this HLS rendition? [y/N] ',
  ].join('\n');
  const gesture = await confirmSelection(prompt);
  if (gesture !== 'confirmed') {
    const doc = renderS4SelectionDocument({
      tuple,
      tupleDigest: localDigest,
      challengeExpiresAt: challenge.expiresAt,
      state: gesture === 'declined' ? 'DECLINED' : 'TERMINAL_UNAVAILABLE',
      confirmed: false,
      reason: gesture === 'declined' ? 'USER_DECLINED' : 'INTERACTIVE_TERMINAL_UNAVAILABLE',
    });
    return {
      exitCode: EXIT.NEEDS_USER_ACTION,
      document: toJson(doc),
      stderr: `hls selection not confirmed; nothing was executed (exit ${String(EXIT.NEEDS_USER_ACTION)})\n`,
    };
  }

  // 8. Durable confirmed selection: COMMIT carries the Core-issued private
  //    challenge value; the Core consumes it atomically with the commit.
  const commitEnvelope = buildCommandEnvelope({
    commandType: 'CONFIRM_S4_SELECTION',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      phase: 'COMMIT',
      snapshotId,
      memberId,
      previewId: preview.previewId,
      renditionKey: variant.key,
      displayedTupleDigest: localDigest,
      confirmationChallenge: challenge.value,
    },
    session,
    ports,
  });
  const committed = await session.client.submitCommand(commitEnvelope);
  if (committed.outcome !== 'ACCEPTED' || committed.acceptance === undefined) {
    return rejectionResult('hls', committed, contractId);
  }
  currentRevision = committed.currentRevision ?? committed.acceptance.revision;
  const selectionView = await readProjection(session, ports, contractId);
  const confirmedSelection = (selectionView.projection as SeamProjectionView | undefined)
    ?.s4ConfirmedSelection;
  if (
    selectionView.outcome !== 'PROJECTION' ||
    confirmedSelection?.renditionKey !== variant.key ||
    confirmedSelection.snapshotId !== snapshotId
  ) {
    const doc = renderErrorDocument({
      error: 'TRANSPORT',
      message: 'the committed S4 selection was not observable in the Core projection',
    });
    return {
      exitCode: EXIT.TRANSPORT,
      document: toJson(doc),
      stderr: 'selection projection missing after COMMIT (exit TRANSPORT)\n',
    };
  }

  // 9. Execute: the Core derives the single canonical effect and performs
  //    the bounded download + FFmpeg validation; ACCEPTED is still not
  //    acquisition success.
  const executeEnvelope = buildCommandEnvelope({
    commandType: 'EXECUTE_S4_SELECTED_HLS_VOD',
    aggregateId: contractId,
    req: undefined,
    expectedRevision: currentRevision,
    correlation: { contractId, snapshotId },
    payload: {
      snapshotId,
      memberId,
      confirmedSelectionId: confirmedSelection.confirmedSelectionId,
    },
    session,
    ports,
  });
  const executed = await session.client.submitCommand(executeEnvelope);
  if (executed.outcome !== 'ACCEPTED' || executed.acceptance === undefined) {
    return rejectionResult('hls', executed, contractId);
  }

  // 10. Bounded wait for the Core-derived terminal truth.
  const waited = await waitForTerminalProjection(session, ports, {
    contractId,
    wait: input.wait,
  });
  if (waited.terminal) {
    const view = waited.view;
    const exit = view.terminal === undefined ? EXIT.SUCCESS : terminalExitCode(view.terminal);
    return {
      exitCode: exit,
      document: toJson(renderStatusDocument(view)),
      stderr: `hls: terminal result rendered (exit ${String(exit)})\n`,
    };
  }
  if ('rejected' in waited) {
    return rejectionResult('hls', waited.rejected, contractId);
  }
  const doc = renderWaitTimeoutDocument({
    contractId,
    timeoutMs: input.wait.timeoutMs,
    pollMs: input.wait.pollMs,
  });
  return {
    exitCode: EXIT.WAIT_TIMEOUT,
    document: toJson(doc),
    stderr: `bounded wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
  };
}

function tupleOf(
  preview: NonNullable<SeamProjectionView['s4Preview']>,
  variant: S4RenditionFact,
  contractId: string,
): S4SelectionTupleDocument {
  return {
    contract_id: contractId,
    snapshot_id: preview.snapshotId,
    member_id: preview.memberId,
    preview_id: preview.previewId,
    rendition_key: variant.key,
    rendition_uri: variant.uri,
    manifest_uri: preview.manifestUri,
    media_profile_id: preview.mediaProfileId,
    bandwidth: variant.bandwidth,
    width: variant.width ?? null,
    height: variant.height ?? null,
  };
}

/**
 * Bounded wait for the Core-observed preview result (PENDING → AVAILABLE or
 * FAILED). Non-interactive polls never block past the declared bound and
 * never invent a preview.
 */
async function waitForS4PreviewResult(
  session: Session,
  ports: AdapterPorts,
  input: { contractId: string; wait: WaitOptions },
): Promise<
  | {
      readonly terminal: true;
      readonly preview: NonNullable<SeamProjectionView['s4Preview']>;
    }
  | { readonly terminal: false; readonly timedOut: true }
  | { readonly terminal: false; readonly rejected: SeamResponse }
> {
  const deadline = ports.epochMs() + input.wait.timeoutMs;
  for (;;) {
    const response = await readProjection(session, ports, input.contractId);
    if (response.outcome === 'REJECTED') {
      return { terminal: false, rejected: response };
    }
    if (response.outcome === 'PROJECTION') {
      const view = response.projection as SeamProjectionView;
      const preview = view.s4Preview;
      if (preview !== undefined && preview.status !== 'PENDING') {
        return { terminal: true, preview };
      }
    }
    const remaining = deadline - ports.epochMs();
    if (remaining <= 0) {
      return { terminal: false, timedOut: true };
    }
    await ports.sleep(Math.min(input.wait.pollMs, remaining));
  }
}

/**
 * #150 S3 fresh-task capability probe (L2 S3 §5): the legacy 1.0 query must
 * be understood by the older Core, and only the exact AGGREGATE_NOT_FOUND
 * rejection from a Core advertising seam 1.2+ proves an S3-capable installed
 * Core on this fresh task.
 */
async function requireS3CoreCompatibility(
  session: Session,
  ports: AdapterPorts,
  aggregateId: string,
): Promise<void> {
  await requireCoreSeam12(session, ports, aggregateId, 'S3 selected media');
}

/**
 * #153 S4 fresh-task capability probe (same wire shape as the S3 probe): a
 * Core that answers the legacy 1.0 query with the exact fresh-task
 * AGGREGATE_NOT_FOUND rejection while advertising seam 1.2+ is an S4-capable
 * installed Core on this fresh task.
 */
async function requireS4CoreCompatibility(
  session: Session,
  ports: AdapterPorts,
  aggregateId: string,
): Promise<void> {
  await requireCoreSeam12(session, ports, aggregateId, 'S4 selected HLS');
}

async function requireCoreSeam12(
  session: Session,
  ports: AdapterPorts,
  aggregateId: string,
  label: string,
): Promise<void> {
  const query: QueryEnvelope = {
    ...buildQueryEnvelope({ aggregateId, req: ports.makeRequestId(), session, ports }),
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
  };
  const response = await session.client.submitQuery(query);
  const version = parseSemVer(response.schemaIdentity.version);
  const diagnostic = response.diagnostics?.[0];
  const compatible =
    response.schemaIdentity.schema === 'xdownload.core-seam' &&
    version !== undefined &&
    version.major === 1 &&
    version.minor >= 2 &&
    response.kind === 'response' &&
    response.inReplyTo === query.requestId &&
    response.outcome === 'REJECTED' &&
    response.diagnostics?.length === 1 &&
    diagnostic?.code === 'AGGREGATE_NOT_FOUND' &&
    diagnostic.path === 'aggregateId' &&
    response.acceptance === undefined &&
    response.projection === undefined;
  if (!compatible) {
    throw new CliInputError('USAGE', `${label} requires Core seam 1.2`, [
      {
        code: 'UNSUPPORTED_ENVELOPE_VERSION',
        path: 'schemaIdentity.version',
        message: `${label} preflight did not verify a compatible Core on the intended fresh task`,
      },
    ]);
  }
}

async function runStatus(
  session: Session,
  ports: AdapterPorts,
  contractId: string,
): Promise<AdapterResult> {
  const response = await readProjection(session, ports, contractId);
  if (response.outcome !== 'PROJECTION') {
    return rejectionResult('status', response, contractId);
  }
  const { document, exitCode } = statusFromView(response.projection as SeamProjectionView);
  return { exitCode, document, stderr: `status read (exit ${String(exitCode)})\n` };
}

async function runWait(
  session: Session,
  ports: AdapterPorts,
  input: { contractId: string; wait: WaitOptions },
): Promise<AdapterResult> {
  const waited = await waitForTerminalProjection(session, ports, input);
  if (waited.terminal) {
    const view = waited.view;
    const exit = view.terminal === undefined ? EXIT.SUCCESS : terminalExitCode(view.terminal);
    return {
      exitCode: exit,
      document: toJson(renderStatusDocument(view)),
      stderr: `wait: terminal result rendered (exit ${String(exit)})\n`,
    };
  }
  if ('rejected' in waited) {
    return rejectionResult('wait', waited.rejected, input.contractId);
  }
  const doc = renderWaitTimeoutDocument({
    contractId: input.contractId,
    timeoutMs: input.wait.timeoutMs,
    pollMs: input.wait.pollMs,
  });
  return {
    exitCode: EXIT.WAIT_TIMEOUT,
    document: toJson(doc),
    stderr: `bounded wait elapsed (exit ${String(EXIT.WAIT_TIMEOUT)})\n`,
  };
}

async function runSimpleCommand(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'cancel' | 'retry' | 'confirm' }>,
): Promise<AdapterResult> {
  let payload: unknown;
  let commandType: CommandEnvelope['commandType'];
  if (input.kind === 'cancel') {
    commandType = 'CANCEL_LINEAGE';
    payload = {};
  } else if (input.kind === 'retry') {
    commandType = 'RETRY_FAILED_MEMBERS';
    // Membership is exactly the operator's explicit list; the CLI computes
    // no membership and the seam validates the failed-member domain (C12).
    payload = { memberIds: [...input.memberIds] };
  } else {
    commandType = 'CONFIRM_SNAPSHOT';
    let text: string;
    try {
      text = await ports.readSource({ stdin: input.source.stdin, file: input.source.file });
    } catch (error) {
      throw new CliInputError(
        'USAGE',
        `cannot read payload source: ${error instanceof Error ? error.message : 'read failed'}`,
      );
    }
    const parsed = parseJsonDocument(text, 'snapshot payload');
    const decoded = decodeSelectionSnapshot(parsed);
    if (!decoded.ok) {
      throw new CliInputError('USAGE', 'snapshot payload is not a canonical SelectionSnapshot', [
        ...decoded.diagnostics,
      ]);
    }
    payload = decoded.value;
  }
  const envelope = buildCommandEnvelope({
    commandType,
    aggregateId: input.contractId,
    req: input.requestId ?? ports.makeRequestId(),
    expectedRevision: input.expectedRevision,
    correlation: { contractId: input.contractId },
    payload,
    session,
    ports,
  });
  const response = await session.client.submitCommand(envelope);
  if (response.outcome !== 'ACCEPTED' || response.acceptance === undefined) {
    return rejectionResult(input.kind, response, input.contractId);
  }
  const doc = renderAcceptanceDocument({
    command: input.kind,
    contractId: input.contractId,
    requestId: response.acceptance.requestId,
    revision: response.acceptance.revision,
    converged: response.acceptance.converged,
    currentRevision: response.currentRevision ?? response.acceptance.revision,
    needsUserAction: false,
  });
  return {
    exitCode: EXIT.SUCCESS,
    document: toJson(doc),
    stderr: `${input.kind} accepted (exit ${String(EXIT.SUCCESS)})\n`,
  };
}

async function runBatch(
  session: Session,
  ports: AdapterPorts,
  input: Extract<ParsedInput, { kind: 'batch' }>,
): Promise<AdapterResult> {
  let text: string;
  try {
    text = await ports.readSource({ stdin: input.source.stdin, file: input.source.file });
  } catch (error) {
    throw new CliInputError(
      'USAGE',
      `cannot read payload source: ${error instanceof Error ? error.message : 'read failed'}`,
    );
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new CliInputError('USAGE', 'batch input is empty; expected JSONL contract lines');
  }
  const items: BatchItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    // Per-item identity: explicit base ids stay deterministic per position
    // (`<base>-<index>`), so replays converge on the same idempotent identity.
    const perItemRequest =
      input.requestId === undefined ? ports.makeRequestId() : `${input.requestId}-${String(index)}`;
    try {
      const contract = decodeContractText(line);
      const outcome = await submitContract(session, ports, {
        contract,
        req: perItemRequest,
        expectedRevision: 0,
        command: 'batch',
      });
      if ('rejected' in outcome) {
        items.push({
          index,
          contract_id: contract.contractId,
          outcome: 'REJECTED',
          request_id: outcome.rejected.inReplyTo,
          revision: null,
          converged: null,
          needs_user_action: null,
          diagnostics: outcome.rejected.diagnostics ?? [],
          input_error: null,
        });
      } else {
        items.push({
          index,
          contract_id: contract.contractId,
          outcome: 'ACCEPTED',
          request_id: outcome.accepted.requestId,
          revision: outcome.accepted.revision,
          converged: outcome.accepted.converged,
          needs_user_action: outcome.needsUserAction,
          diagnostics: null,
          input_error: null,
        });
      }
    } catch (error) {
      const inputError =
        error instanceof CliInputError
          ? error
          : new CliInputError(
              'USAGE',
              error instanceof Error ? error.message : 'batch item failed',
            );
      items.push({
        index,
        contract_id: null,
        outcome: 'INPUT_ERROR',
        request_id: null,
        revision: null,
        converged: null,
        needs_user_action: null,
        diagnostics: null,
        input_error: { kind: inputError.kind, message: inputError.message },
      });
    }
  }
  const doc = renderBatchDocument(items);
  // Worst severity wins: input errors (1) > seam rejections (2) > pending
  // user action (3) > full acceptance (0). Per-item results are never merged.
  const exit =
    doc.input_error_count > 0
      ? EXIT.USAGE
      : doc.rejected_count > 0
        ? EXIT.REJECTED
        : doc.needs_user_action_count > 0
          ? EXIT.NEEDS_USER_ACTION
          : EXIT.SUCCESS;
  return {
    exitCode: exit,
    document: toJson(doc),
    stderr: `batch: ${String(doc.accepted_count)} accepted (exit ${String(exit)})\n`,
  };
}

/**
 * Parse-and-run entry used by the process shell and the concern tests: argv
 * parse failures map to the same typed error document as adapter failures.
 * Explicit `--route v0.2` inputs go to the Domain App route runner (T04);
 * everything else keeps the legacy v1 adapter verbatim.
 */
export async function runArgv(
  argv: readonly string[],
  ports: AdapterPorts,
): Promise<AdapterResult> {
  let input: ParsedInput;
  try {
    input = parseArgv(argv);
  } catch (error) {
    if (error instanceof CliInputError) {
      return inputResult(error);
    }
    return transportResult(error);
  }
  if (input.kind === 'domain-app') {
    return runDomainAppInput(input, ports);
  }
  try {
    return await runAdapter(input, ports);
  } catch (error) {
    if (error instanceof CliInputError) {
      return inputResult(error);
    }
    return transportResult(error);
  }
}

/**
 * Run one CLI invocation. Exactly one machine-readable JSON document plus a
 * documented exit code is produced; the seam client is closed before
 * returning and never affects Core lifetime.
 */
export async function runAdapter(input: ParsedInput, ports: AdapterPorts): Promise<AdapterResult> {
  if (input.kind === 'help') {
    // The process entry prints help; the adapter never sees it in practice.
    return {
      exitCode: EXIT.SUCCESS,
      document: toJson({ document: 'xdownload.cli.help' }),
      stderr: '',
    };
  }
  let session: Session | null = null;
  try {
    session = openSession(ports, input);
    switch (input.kind) {
      case 'submit':
        return await runSubmit(session, ports, input);
      case 'download':
        return await runDownload(session, ports, input);
      case 'media':
        return await runMedia(session, ports, input);
      case 'hls':
        return await runHls(session, ports, input);
      case 'status':
        return await runStatus(session, ports, input.contractId);
      case 'wait':
        return await runWait(session, ports, { contractId: input.contractId, wait: input.wait });
      case 'cancel':
      case 'retry':
      case 'confirm':
        return await runSimpleCommand(session, ports, input);
      case 'batch':
        return await runBatch(session, ports, input);
      case 'domain-app':
        // Fail closed: v0.2 Domain App inputs route through runArgv /
        // runDomainAppInput (main.ts); the legacy adapter never executes one.
        throw new CliInputError(
          'USAGE',
          'route v0.2 inputs run through the Domain App command layer, not the legacy adapter',
        );
      default: {
        // Unreachable: parseArgv produces only the kinds above (help is
        // handled before the session opens).
        const unreachable: never = input;
        throw new CliInputError('USAGE', `unsupported input kind '${String(unreachable)}'`);
      }
    }
  } catch (error) {
    if (error instanceof CliInputError) {
      return inputResult(error);
    }
    return transportResult(error);
  } finally {
    if (session !== null) {
      await session.client.close();
    }
  }
}
