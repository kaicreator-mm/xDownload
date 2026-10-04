/**
 * T013 CLI argument grammar (frozen task pack "Owned boundary": CLI
 * parsing/presentation/client behavior). Typed, fail-closed parsing with
 * Node built-ins only (`node:util` `parseArgs`) — no new runtime dependency
 * (IMPLEMENTATION_MAP "Dependency decision seam").
 *
 * Defaults never enlarge requested scope, add continuation authority or
 * alter budget/authorization semantics: contract/snapshot payloads pass
 * through the canonical `@xdownload/domain-contracts` decoders unchanged and
 * the CLI invents no contract fields (FAILURE_MATRIX "scope-broadening-defaults").
 */

import { parseArgs } from 'node:util';

/** Same identifier shape the seam layer validates (documented early typed error). */
export const CLI_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

/** CLI diagnostic shape — structurally identical to SeamDiagnostic/ValidationDiagnostic. */
export interface CliDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly invariant?: string;
}

/** Typed local input error raised before any envelope is built. */
export class CliInputError extends Error {
  readonly kind: 'USAGE' | 'PAYLOAD_TOO_LARGE';
  readonly diagnostics?: readonly CliDiagnostic[];

  constructor(
    kind: 'USAGE' | 'PAYLOAD_TOO_LARGE',
    message: string,
    diagnostics?: readonly CliDiagnostic[],
  ) {
    super(message);
    this.name = 'CliInputError';
    this.kind = kind;
    this.diagnostics = diagnostics;
  }
}

/** Where a payload document is read from. */
export type PayloadSource =
  | { readonly stdin: true; readonly file: undefined }
  | { readonly stdin: false; readonly file: string };

export interface TargetOptions {
  readonly host: string;
  readonly port: number;
  readonly installId: string;
  readonly userId: string;
}

export interface WaitOptions {
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export type ParsedInput =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'submit';
      readonly target: TargetOptions;
      readonly source: PayloadSource;
      readonly expectedRevision: number;
      readonly wait: WaitOptions | null;
      readonly requestId: string | undefined;
    }
  | { readonly kind: 'status'; readonly target: TargetOptions; readonly contractId: string }
  | {
      readonly kind: 'wait';
      readonly target: TargetOptions;
      readonly contractId: string;
      readonly wait: WaitOptions;
    }
  | {
      readonly kind: 'cancel';
      readonly target: TargetOptions;
      readonly contractId: string;
      readonly expectedRevision: number;
      readonly requestId: string | undefined;
    }
  | {
      readonly kind: 'retry';
      readonly target: TargetOptions;
      readonly contractId: string;
      readonly expectedRevision: number;
      readonly memberIds: readonly string[];
      readonly requestId: string | undefined;
    }
  | {
      readonly kind: 'confirm';
      readonly target: TargetOptions;
      readonly contractId: string;
      readonly expectedRevision: number;
      readonly source: PayloadSource;
      readonly requestId: string | undefined;
    }
  | {
      readonly kind: 'batch';
      readonly target: TargetOptions;
      readonly source: PayloadSource;
      readonly requestId: string | undefined;
    };

export const CLI_USAGE = `xdownload — thin CLI adapter over the core seam (PRD §27)

Usage: xdownload <command> [options]

Commands:
  submit   Submit one acquisition contract (JSON payload; acceptance only unless --wait)
  status   Read the machine-readable status projection for one contract
  wait     Poll READ_PROJECTION until a terminal result is projected (bounded)
  cancel   Cancel a lineage (CANCEL_LINEAGE through the seam)
  retry    Retry explicitly named failed members (RETRY_FAILED_MEMBERS; no retry-all)
  confirm  Confirm a selection snapshot (CONFIRM_SNAPSHOT; JSON payload)
  batch    Submit multiple contracts from a JSONL file/stdin, per-item results
  help     Show this help

Common options:
  --host <h>          Seam host (default 127.0.0.1; loopback only)
  --port <n>          Seam port (required)
  --install-id <id>   Peer install identity (required)
  --user-id <id>      Peer user identity (required)
  --request-id <id>   Explicit idempotent command identity (generated when omitted)

Payload options (submit/confirm/batch):
  --file <path>       Read the JSON/JSONL payload from a file
  --stdin             Read the payload from stdin

Command options:
  submit:   --expected-revision <n> (default 0 = assert creation)
            --wait --timeout-ms <n> --poll-ms <n>
  status:   --contract <id>
  wait:     --contract <id> --timeout-ms <n> --poll-ms <n>
  cancel:   --contract <id> --expected-revision <n> (required)
  retry:    --contract <id> --expected-revision <n> (required) --members <m1,m2,...>
  confirm:  --contract <id> --expected-revision <n> (required) + payload source

Output: exactly one machine-readable JSON document on stdout (PRD §27 field
set for status; stable exit codes; diagnostics projected verbatim). Human
notes go to stderr. Submit acceptance is never final task success.
`;

type ArgValues = Record<string, string | boolean | undefined>;

const OPTIONS = {
  host: { type: 'string' },
  port: { type: 'string' },
  'install-id': { type: 'string' },
  'user-id': { type: 'string' },
  'request-id': { type: 'string' },
  file: { type: 'string' },
  stdin: { type: 'boolean' },
  'expected-revision': { type: 'string' },
  wait: { type: 'boolean' },
  'timeout-ms': { type: 'string' },
  'poll-ms': { type: 'string' },
  contract: { type: 'string' },
  members: { type: 'string' },
} as const;

function str(values: ArgValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function flag(values: ArgValues, name: string): boolean {
  return values[name] === true;
}

function fail(message: string): never {
  throw new CliInputError('USAGE', message);
}

function requireString(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    fail(`missing required option --${name}`);
  }
  return value;
}

function parseInteger(value: string | undefined, name: string, minimum: number): number {
  if (value === undefined) {
    fail(`missing required option --${name}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    fail(`--${name} must be an integer >= ${String(minimum)}`);
  }
  return parsed;
}

function parseIdentifier(value: string | undefined, option: string, path: string): string {
  const raw = requireString(value, option);
  if (!CLI_ID_PATTERN.test(raw)) {
    throw new CliInputError('USAGE', `--${option} is not a valid identifier`, [
      {
        code: 'ENVELOPE_MALFORMED',
        path,
        message: `expected an identifier matching ${String(CLI_ID_PATTERN)}`,
      },
    ]);
  }
  return raw;
}

function parseTarget(values: ArgValues): TargetOptions {
  const port = parseInteger(str(values, 'port'), 'port', 1);
  if (port > 65535) {
    fail('--port must be <= 65535');
  }
  return {
    host: str(values, 'host') ?? '127.0.0.1',
    port,
    installId: parseIdentifier(str(values, 'install-id'), 'install-id', 'peer.installId'),
    userId: parseIdentifier(str(values, 'user-id'), 'user-id', 'peer.userId'),
  };
}

function parseRequestId(values: ArgValues): string | undefined {
  const raw = str(values, 'request-id');
  if (raw === undefined) {
    return undefined;
  }
  return parseIdentifier(raw, 'request-id', 'requestId');
}

function parseWait(values: ArgValues): WaitOptions {
  return {
    timeoutMs: parseInteger(str(values, 'timeout-ms'), 'timeout-ms', 1),
    pollMs: parseInteger(str(values, 'poll-ms'), 'poll-ms', 1),
  };
}

function parsePayloadSource(values: ArgValues): PayloadSource {
  const file = str(values, 'file');
  if (flag(values, 'stdin')) {
    if (file !== undefined) {
      fail('--file and --stdin are mutually exclusive');
    }
    return { stdin: true, file: undefined };
  }
  if (file === undefined || file.length === 0) {
    fail('a payload source is required: pass --file <path> or --stdin');
  }
  return { stdin: false, file };
}

function parseExpectedRevision(values: ArgValues, required: boolean): number {
  const raw = str(values, 'expected-revision');
  if (raw === undefined) {
    if (required) {
      fail('missing required option --expected-revision');
    }
    return 0;
  }
  return parseInteger(raw, 'expected-revision', 0);
}

function parseMemberIds(values: ArgValues): readonly string[] {
  const raw = requireString(str(values, 'members'), 'members');
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!CLI_ID_PATTERN.test(id)) {
      throw new CliInputError('USAGE', '--members contains an invalid member identity', [
        {
          code: 'ENVELOPE_MALFORMED',
          path: 'payload.memberIds',
          message: `'${id}' is not a valid member identity`,
        },
      ]);
    }
    if (ids.includes(id)) {
      throw new CliInputError('USAGE', '--members contains a duplicate member identity', [
        { code: 'DUPLICATE_IDENTITY', path: 'payload.memberIds', message: `duplicate '${id}'` },
      ]);
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Parse process argv (without the node/script prefix) into a typed input
 * value. Unknown commands/flags and malformed values raise typed
 * `CliInputError`s before any envelope is built.
 */
export function parseArgv(argv: readonly string[]): ParsedInput {
  const command = argv[0];
  const rest = argv.slice(1);
  if (command === undefined || command === 'help') {
    return { kind: 'help' };
  }
  let values: ArgValues;
  try {
    const parsed = parseArgs({ args: rest, options: OPTIONS, strict: true, tokens: false });
    values = parsed.values as ArgValues;
  } catch (error) {
    fail(
      error instanceof Error
        ? `invalid arguments: ${error.message}`
        : 'invalid arguments for the given command',
    );
  }
  const target = parseTarget(values);
  const contractId = (): string => requireString(str(values, 'contract'), 'contract');
  switch (command) {
    case 'submit':
      return {
        kind: 'submit',
        target,
        source: parsePayloadSource(values),
        expectedRevision: parseExpectedRevision(values, false),
        wait: flag(values, 'wait') ? parseWait(values) : null,
        requestId: parseRequestId(values),
      };
    case 'status':
      return { kind: 'status', target, contractId: contractId() };
    case 'wait':
      return { kind: 'wait', target, contractId: contractId(), wait: parseWait(values) };
    case 'cancel':
      return {
        kind: 'cancel',
        target,
        contractId: contractId(),
        expectedRevision: parseExpectedRevision(values, true),
        requestId: parseRequestId(values),
      };
    case 'retry':
      return {
        kind: 'retry',
        target,
        contractId: contractId(),
        expectedRevision: parseExpectedRevision(values, true),
        memberIds: parseMemberIds(values),
        requestId: parseRequestId(values),
      };
    case 'confirm':
      return {
        kind: 'confirm',
        target,
        contractId: contractId(),
        expectedRevision: parseExpectedRevision(values, true),
        source: parsePayloadSource(values),
        requestId: parseRequestId(values),
      };
    case 'batch':
      return {
        kind: 'batch',
        target,
        source: parsePayloadSource(values),
        requestId: parseRequestId(values),
      };
    default:
      fail(`unknown command '${String(command)}'; run 'xdownload help'`);
  }
}
