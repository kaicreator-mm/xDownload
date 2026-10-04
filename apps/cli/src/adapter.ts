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
  SEAM_MESSAGE_LIMITS,
  type CommandEnvelope,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamProjectionView,
  type SeamResponse,
} from '@xdownload/core-seam';
import {
  decodeAcquisitionContract,
  decodeSelectionSnapshot,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import {
  CliInputError,
  parseArgv,
  type ParsedInput,
  type TargetOptions,
  type WaitOptions,
} from './args.ts';
import {
  EXIT,
  renderAcceptanceDocument,
  renderBatchDocument,
  renderErrorDocument,
  renderNeedsUserActionDocument,
  renderRejectionDocument,
  renderStatusDocument,
  renderWaitTimeoutDocument,
  terminalExitCode,
  toJson,
  type BatchItem,
} from './render.ts';

/** Payload source shape passed to the port (mirrors args PayloadSource, unbranded). */
export interface SourceRequest {
  readonly stdin: boolean;
  readonly file: string | undefined;
}

/** Injectable process ports; the process entry binds real ones. */
export interface AdapterPorts {
  readonly clientTransport: SeamClientTransport;
  readonly readSource: (source: SourceRequest) => Promise<string>;
  readonly now: () => string;
  readonly makeRequestId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly epochMs: () => number;
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
  const target: SeamListenTarget = { host: input.target.host, port: input.target.port };
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
  req: string;
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
 */
export async function runArgv(
  argv: readonly string[],
  ports: AdapterPorts,
): Promise<AdapterResult> {
  try {
    return await runAdapter(parseArgv(argv), ports);
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
