/**
 * v0.2 T04 — the explicit `--route v0.2` Domain App command runner.
 *
 * CF-1 chain: `main.ts` argv (parsed by `args.ts` into `DomainAppRouteInput`)
 * reaches this runner, which maps each command onto the frozen public facade
 * calls in `domain-app-commands.ts` (`executeDomainAppCommand`), binds the
 * REAL facade from `domain-app-seam-facade.ts` (the existing Core seam), and
 * finishes at the admitted K composition inside the installed Core process
 * (whose v0.2 route drives `submitConfirmedDownload`). Nothing here composes,
 * starts or stops a Core; no transport ever falls back silently.
 *
 * CLI usability contract (T04): exactly one parseable JSON document on
 * stdout; explicit human-readable mode/progress notes on stderr; stable exit
 * codes (`render.ts` EXIT table); typed refusals projected verbatim with
 * actionable transport/Host/destination context.
 */

import {
  makePeerInstallId,
  makePeerUserId,
  type PeerIdentity,
  type SeamClientTransport,
  type SeamListenTarget,
} from '@xdownload/core-seam';
import {
  CLI_ID_PATTERN,
  CliInputError,
  type DomainAppRouteInput,
  type PayloadSource,
} from './args.ts';
import {
  domainAppExitCode,
  executeDomainAppCommand,
  type DomainAppCancelCommand,
  type DomainAppOutcome,
  type DomainAppStatusCommand,
  type DomainAppSubmitCommand,
} from './domain-app-commands.ts';
import { createSeamDomainAppFacade, type SeamDomainAppFacade } from './domain-app-seam-facade.ts';
import { CLI_OUTPUT_SCHEMA, EXIT, renderErrorDocument, toJson } from './render.ts';

/** The result of one v0.2 CLI invocation (same shape as the legacy adapter's). */
export interface DomainAppCliResult {
  /** Documented exit code (see render.ts EXIT table). */
  readonly exitCode: number;
  /** Exactly one machine-readable JSON document (stdout). */
  readonly document: string;
  /** Non-normative human mode/progress notes (stderr). */
  readonly stderr: string;
}

/** Injectable process ports of the v0.2 runner (subset of AdapterPorts). */
export interface DomainAppCliPorts {
  readonly clientTransport: SeamClientTransport;
  readonly readSource: (source: PayloadSource) => Promise<string>;
  readonly now: () => string;
  readonly makeRequestId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly epochMs: () => number;
}

function cliPeer(target: DomainAppRouteInput['target']): PeerIdentity {
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

function seamTarget(target: DomainAppRouteInput['target']): SeamListenTarget {
  return {
    host: target.host,
    port: target.port,
    ...(target.pipeName === undefined ? {} : { pipeName: target.pipeName }),
  };
}

function modeNote(input: DomainAppRouteInput): string {
  const endpoint =
    input.target.pipeName !== undefined
      ? `windows-pipe ${input.target.pipeName}`
      : `loopback ${input.target.host}:${String(input.target.port)}`;
  return `mode: v0.2 domain-app ${input.command} via core seam (${endpoint})\n`;
}

/** Actionable local-runtime context for an untyped transport failure. */
function transportNote(target: DomainAppRouteInput['target']): string {
  const endpoint =
    target.pipeName !== undefined
      ? `the local Core named pipe '${target.pipeName}'`
      : `the local Core seam at ${target.host}:${String(target.port)}`;
  return `the Core is unreachable or the request failed in transport — check that the installed Core is running and reachable at ${endpoint} (no fallback transport exists)\n`;
}

function inputErrorResult(error: CliInputError, notes: readonly string[]): DomainAppCliResult {
  const doc = renderErrorDocument({
    error: error.kind,
    message: error.message,
    usage: error.kind === 'USAGE',
    diagnostics: error.diagnostics,
  });
  return {
    exitCode: EXIT.USAGE,
    document: toJson(doc),
    stderr: `${notes.join('')}input error (exit ${String(EXIT.USAGE)})\n`,
  };
}

function transportErrorResult(
  error: unknown,
  input: DomainAppRouteInput,
  notes: readonly string[],
): DomainAppCliResult {
  const doc = renderErrorDocument({
    error: 'TRANSPORT',
    message: error instanceof Error ? error.message : 'seam connection failed',
  });
  return {
    exitCode: EXIT.TRANSPORT,
    document: toJson(doc),
    stderr: `${notes.join('')}${transportNote(input.target)}transport failure (exit ${String(EXIT.TRANSPORT)})\n`,
  };
}

function outcomeResult(
  outcome: DomainAppOutcome,
  commandLabel: string,
  notes: readonly string[],
  target: DomainAppRouteInput['target'],
): DomainAppCliResult {
  const exit = domainAppExitCode(outcome);
  let finalNote: string;
  if (outcome.kind !== 'error') {
    finalNote = `${commandLabel}: projected (exit ${String(exit)})\n`;
  } else if (outcome.document.coded) {
    finalNote = `${commandLabel}: refused (${outcome.document.code}, exit ${String(exit)})\n`;
  } else {
    // Untyped = transport-level: keep the actionable local-runtime context.
    finalNote = `${commandLabel}: transport failure (${outcome.document.message}) (exit ${String(exit)})\n${transportNote(target)}`;
  }
  return {
    exitCode: exit,
    document: toJson(outcome.document),
    stderr: `${notes.join('')}${finalNote}`,
  };
}

/** Read one JSON payload document; malformed JSON is a typed USAGE error. */
async function readJsonObject(
  ports: DomainAppCliPorts,
  source: PayloadSource,
): Promise<Record<string, unknown>> {
  const text = await ports.readSource(source);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CliInputError('USAGE', 'the payload is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliInputError('USAGE', 'the payload must be one plain JSON object');
  }
  return parsed as Record<string, unknown>;
}

function requireStringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliInputError('USAGE', `the confirmed intent requires string field '${field}'`, [
      {
        code: 'ENVELOPE_MALFORMED',
        path: `payload.${field}`,
        message: `a non-empty string '${field}' is required`,
      },
    ]);
  }
  if (!CLI_ID_PATTERN.test(value)) {
    throw new CliInputError(
      'USAGE',
      `the confirmed intent field '${field}' is not a valid identifier`,
      [
        {
          code: 'ENVELOPE_MALFORMED',
          path: `payload.${field}`,
          message: `expected an identifier matching ${String(CLI_ID_PATTERN)}`,
        },
      ],
    );
  }
  return value;
}

/**
 * Map one confirmed intent payload onto the submit command. The three
 * identity fields come FROM the payload (never invented by the CLI); the
 * whole record rides as the intent input and is re-validated authoritatively
 * by the Core (exact-key no-widening).
 */
function submitCommandOf(payload: Record<string, unknown>): DomainAppSubmitCommand {
  const operation = requireStringField(payload, 'allowedOperation');
  return {
    kind: 'submit',
    operation: operation as DomainAppSubmitCommand['operation'],
    instanceKey: requireStringField(payload, 'lineageId'),
    messageId: requireStringField(payload, 'requestId'),
    input: payload,
  };
}

function statusCommandOf(input: DomainAppRouteInput): DomainAppStatusCommand {
  // The v0.2 seam route is lineage-scoped: the query is addressed to the
  // lineage identity, which is also the displayed workflow scope.
  const lineage = input.lineage ?? '';
  return { kind: 'status', workflowId: lineage, instanceKey: lineage };
}

/** Run one explicit `--route v0.2` CLI invocation. */
export async function runDomainAppInput(
  input: DomainAppRouteInput,
  ports: DomainAppCliPorts,
): Promise<DomainAppCliResult> {
  const notes: string[] = [modeNote(input)];
  let facade: SeamDomainAppFacade | null = null;
  try {
    facade = createSeamDomainAppFacade({
      transport: ports.clientTransport,
      target: seamTarget(input.target),
      peer: cliPeer(input.target),
      now: ports.now,
    });
    switch (input.command) {
      case 'submit': {
        if (input.source === null) {
          throw new CliInputError(
            'USAGE',
            'a payload source is required: pass --file <path> or --stdin',
          );
        }
        const payload = await readJsonObject(ports, input.source);
        const outcome = await executeDomainAppCommand(facade, submitCommandOf(payload));
        return outcomeResult(outcome, 'submit --route v0.2', notes, input.target);
      }
      case 'status': {
        const outcome = await executeDomainAppCommand(facade, statusCommandOf(input));
        return outcomeResult(outcome, 'status --route v0.2', notes, input.target);
      }
      case 'wait':
        return await runV02Wait(input, ports, facade, notes);
      case 'cancel': {
        const command: DomainAppCancelCommand = {
          kind: 'cancel',
          instanceKey: input.lineage ?? '',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.requestId === undefined ? {} : { messageId: input.requestId }),
        };
        const outcome = await executeDomainAppCommand(facade, command);
        return outcomeResult(outcome, 'cancel --route v0.2', notes, input.target);
      }
      case 'batch':
        return await runV02Batch(input, ports, facade, notes);
      default: {
        // Unreachable: DomainAppRouteInput['command'] is a closed vocabulary.
        const unreachable: never = input.command;
        throw new CliInputError('USAGE', `unsupported v0.2 command '${String(unreachable)}'`);
      }
    }
  } catch (error) {
    if (error instanceof CliInputError) {
      return inputErrorResult(error, notes);
    }
    return transportErrorResult(error, input, notes);
  } finally {
    // Client close only; never a Core start/stop authority.
    facade?.stop();
  }
}

/** Bounded poll of the v0.2 job projection until a terminal status. */
async function runV02Wait(
  input: DomainAppRouteInput,
  ports: DomainAppCliPorts,
  facade: SeamDomainAppFacade,
  notes: string[],
): Promise<DomainAppCliResult> {
  const lineage = input.lineage ?? '';
  const wait = input.wait ?? { timeoutMs: 30_000, pollMs: 200 };
  const deadline = ports.epochMs() + wait.timeoutMs;
  let polls = 0;
  while (true) {
    polls += 1;
    const outcome = await executeDomainAppCommand(facade, statusCommandOf(input));
    if (outcome.kind === 'status') {
      notes.push(`wait: lineage ${lineage} ${outcome.document.status} (poll ${String(polls)})\n`);
      if (outcome.document.terminal) {
        return outcomeResult(outcome, 'wait --route v0.2', notes, input.target);
      }
    } else {
      // Any error outcome surfaces immediately: a typed refusal will not
      // heal by polling (unknown lineage, denied peer), and a transport
      // failure has already exhausted the seam client's reconnect budget —
      // neither silently burns the wait budget.
      notes.push(
        outcome.kind === 'error' && outcome.document.coded
          ? `wait: lineage ${lineage} refused\n`
          : `wait: lineage ${lineage} transport failure (poll ${String(polls)})\n`,
      );
      return outcomeResult(outcome, 'wait --route v0.2', notes, input.target);
    }
    if (ports.epochMs() + wait.pollMs >= deadline) {
      const doc = {
        document: 'xdownload.cli.domain-app.wait-timeout',
        schema: CLI_OUTPUT_SCHEMA,
        state: 'BOUNDED_WAIT_TIMEOUT',
        lineage_id: lineage,
        timeout_ms: wait.timeoutMs,
        poll_ms: wait.pollMs,
        note: 'bounded wait elapsed without a terminal v0.2 job projection; no status was invented',
      } as const;
      const exit = EXIT.WAIT_TIMEOUT;
      notes.push(`wait: bounded wait elapsed (exit ${String(exit)})\n`);
      return { exitCode: exit, document: toJson(doc), stderr: notes.join('') };
    }
    await ports.sleep(wait.pollMs);
  }
}

/** Worst-severity exit across one v0.2 batch (per-item results never merge). */
function batchExitCode(
  results: readonly {
    readonly exitCode: number;
    readonly usage: boolean;
    readonly coded: boolean;
  }[],
): number {
  if (results.some((item) => item.usage)) return EXIT.USAGE;
  if (results.some((item) => item.coded)) return EXIT.REJECTED;
  if (results.some((item) => item.exitCode === EXIT.TRANSPORT)) return EXIT.TRANSPORT;
  if (results.some((item) => item.exitCode === EXIT.TERMINAL_NON_SUCCESS)) {
    return EXIT.TERMINAL_NON_SUCCESS;
  }
  return EXIT.SUCCESS;
}

/** JSONL batch of confirmed intents; per-item results, never merged truth. */
async function runV02Batch(
  input: DomainAppRouteInput,
  ports: DomainAppCliPorts,
  facade: SeamDomainAppFacade,
  notes: string[],
): Promise<DomainAppCliResult> {
  if (input.source === null) {
    throw new CliInputError('USAGE', 'a payload source is required: pass --file <path> or --stdin');
  }
  const text = await ports.readSource(input.source);
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new CliInputError('USAGE', 'the batch payload contains no intent lines');
  }
  const items: Record<string, unknown>[] = [];
  const exits: { exitCode: number; usage: boolean; coded: boolean }[] = [];
  for (const [index, line] of lines.entries()) {
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new CliInputError(
          'USAGE',
          `batch line ${String(index + 1)} must be one plain JSON object`,
        );
      }
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof CliInputError) {
        items.push({
          line: index + 1,
          outcome: 'INPUT_ERROR',
          error: { kind: 'USAGE', message: error.message },
        });
        exits.push({ exitCode: EXIT.USAGE, usage: true, coded: false });
        continue;
      }
      items.push({
        line: index + 1,
        outcome: 'INPUT_ERROR',
        error: { kind: 'USAGE', message: `batch line ${String(index + 1)} is not valid JSON` },
      });
      exits.push({ exitCode: EXIT.USAGE, usage: true, coded: false });
      continue;
    }
    try {
      const outcome = await executeDomainAppCommand(facade, submitCommandOf(payload));
      const exit = domainAppExitCode(outcome);
      items.push({
        line: index + 1,
        outcome: exit === EXIT.USAGE ? 'INPUT_ERROR' : 'PROJECTED',
        document: outcome.document,
      });
      exits.push({
        exitCode: exit,
        usage: exit === EXIT.USAGE,
        coded: outcome.kind === 'error' && outcome.document.coded,
      });
    } catch (error) {
      // Input mapping failures (typed, pre-facade) are per-item input errors.
      const message = error instanceof Error ? error.message : 'invalid intent';
      items.push({ line: index + 1, outcome: 'INPUT_ERROR', error: { kind: 'USAGE', message } });
      exits.push({ exitCode: EXIT.USAGE, usage: true, coded: false });
    }
  }
  const accepted = exits.filter(
    (item) => !item.usage && !item.coded && item.exitCode === EXIT.SUCCESS,
  ).length;
  const exit = batchExitCode(exits);
  notes.push(`batch: ${String(accepted)} accepted (exit ${String(exit)})\n`);
  return {
    exitCode: exit,
    document: toJson({
      document: 'xdownload.cli.domain-app.batch',
      schema: CLI_OUTPUT_SCHEMA,
      accepted_count: accepted,
      item_count: lines.length,
      items,
      note: 'per-item results are never merged; one refusal never masks another line',
    }),
    stderr: notes.join(''),
  };
}
