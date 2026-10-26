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
  /** Checked Core named-pipe endpoint, never an arbitrary IPC namespace. */
  readonly pipeName?: string;
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
  | {
      readonly kind: 'download';
      readonly target: TargetOptions;
      readonly url: string;
      readonly expectedSha256: string | undefined;
      readonly expectedContentTypePrefix: string | undefined;
      readonly expectedTotalBytes: number | undefined;
      readonly redirectHosts: readonly string[];
      readonly wait: WaitOptions;
      readonly requestId: string | undefined;
    }
  | {
      readonly kind: 'media';
      readonly target: TargetOptions;
      readonly url: string;
      readonly variantKey: string;
      readonly mediaProfileId: string;
      readonly byteConstraintSha256: string | undefined;
      readonly expectedContentTypePrefix: string | undefined;
      readonly expectedTotalBytes: number | undefined;
      readonly redirectHosts: readonly string[];
      readonly wait: WaitOptions;
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
  download S1 direct file download: Core-executed HTTP transfer with
           declared-target validation (bounded --wait for terminal truth)
  media    S3 selected media: interactive selection confirmation over the
           OS-verified Windows Core pipe, then a Core-executed public media
           download with Media validation (requires --pipe-name and an
           attached interactive terminal; there is no non-interactive mode)
  status   Read the machine-readable status projection for one contract
  wait     Poll READ_PROJECTION until a terminal result is projected (bounded)
  cancel   Cancel a lineage (CANCEL_LINEAGE through the seam)
  retry    Retry explicitly named failed members (RETRY_FAILED_MEMBERS; no retry-all)
  confirm  Confirm a selection snapshot (CONFIRM_SNAPSHOT; JSON payload)
  batch    Submit multiple contracts from a JSONL file/stdin, per-item results
  help     Show this help

Common options:
  --host <h>          Seam host (default 127.0.0.1; loopback only)
  --port <n>          Seam port (legacy TCP only; not with --pipe-name)
  --pipe-name <path>  Local Windows Core named pipe (exclusive with --host/--port)
  --install-id <id>   Peer install identity (required)
  --user-id <id>      Peer user identity (required)
  --request-id <id>   Explicit idempotent command identity (generated when omitted)

Payload options (submit/confirm/batch):
  --file <path>       Read the JSON/JSONL payload from a file
  --stdin             Read the payload from stdin

Command options:
  submit:   --expected-revision <n> (default 0 = assert creation)
            --wait --timeout-ms <n> --poll-ms <n>
  download: --url <http(s)://...> [--sha256 <hex>]
            --sha256: an independently published digest, when one exists;
            supplied, a mismatch fails the download (C09). Omitted, the
            Target claim rests on the declared delivery graph (the --url
            host + --redirect-host entries); the artifact digest is still
            computed and durably recorded for later corruption detection
            (C34 — it is never promoted to a post-hoc identity oracle).
            [--content-type-prefix <p>] [--total-bytes <n>]
            [--redirect-host <host> ...] [--timeout-ms <n>] [--poll-ms <n>]
  media:    --url <https://host/media/<id>.<mp4|m4a|mp3|webm>> --variant <key>
            [--profile <id>] [--sha256 <hex>] [--content-type-prefix <p>]
            [--total-bytes <n>] [--redirect-host <host> ...]
            [--timeout-ms <n>] [--poll-ms <n>]
            --pipe-name is REQUIRED (the S3 lane runs only over the
            OS-verified Windows Core named pipe). The exact selected tuple
            (contract, member, variant, locator, media profile) is displayed
            and an explicit interactive confirmation is required; a
            non-interactive terminal stops before any Core effect. --sha256
            here is a user-known byte constraint (mismatch fails the
            download) and never a publisher-identity oracle (C34).
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
  'pipe-name': { type: 'string' },
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
  url: { type: 'string' },
  sha256: { type: 'string' },
  'content-type-prefix': { type: 'string' },
  'total-bytes': { type: 'string' },
  'redirect-host': { type: 'string', multiple: true },
  variant: { type: 'string' },
  profile: { type: 'string' },
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
  const installId = parseIdentifier(str(values, 'install-id'), 'install-id', 'peer.installId');
  const userId = parseIdentifier(str(values, 'user-id'), 'user-id', 'peer.userId');
  const pipeName = str(values, 'pipe-name');
  if (pipeName !== undefined) {
    if (str(values, 'host') !== undefined || str(values, 'port') !== undefined) {
      fail('--pipe-name cannot be combined with --host or --port (no TCP fallback)');
    }
    // No arbitrary named-pipe path, UNC/remote host, or traversal suffix.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(installId)) {
      fail('--install-id must be a safe local Core pipe suffix');
    }
    const expected = String.raw`\\.\pipe\xdownload-core-${installId}`;
    if (pipeName !== expected) {
      fail('--pipe-name must exactly match the local Core install-id namespace');
    }
    return { host: '127.0.0.1', port: 0, installId, userId, pipeName: expected };
  }
  const port = parseInteger(str(values, 'port'), 'port', 1);
  if (port > 65535) {
    fail('--port must be <= 65535');
  }
  return {
    host: str(values, 'host') ?? '127.0.0.1',
    port,
    installId,
    userId,
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

const DEFAULT_WAIT: WaitOptions = { timeoutMs: 30_000, pollMs: 200 };

/** download always bounds its terminal wait; the flags tune the bound. */
function parseWaitWithDefault(values: ArgValues): WaitOptions {
  return {
    timeoutMs:
      str(values, 'timeout-ms') === undefined
        ? DEFAULT_WAIT.timeoutMs
        : parseInteger(str(values, 'timeout-ms'), 'timeout-ms', 1),
    pollMs:
      str(values, 'poll-ms') === undefined
        ? DEFAULT_WAIT.pollMs
        : parseInteger(str(values, 'poll-ms'), 'poll-ms', 1),
  };
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * #150 S3 public media locator shape (client-side fast-fail mirror of the
 * closed Core wire grammar): credential-free HTTPS with no query/fragment/
 * userinfo and the /media/<id>.<container> path. The Core re-validates the
 * full grammar authoritatively; this only stops an obvious misuse before
 * any Core round trip.
 */
const S3_MEDIA_URL_PATTERN =
  /^https:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::[0-9]{1,5})?\/media\/[A-Za-z0-9_-]{1,64}\.(?:mp4|m4a|mp3|webm)$/u;

const S3_DEFAULT_MEDIA_PROFILE: Readonly<Record<string, string>> = {
  mp4: 's3-media-mp4-v1',
  m4a: 's3-media-m4a-v1',
  mp3: 's3-media-mp3-v1',
  webm: 's3-media-webm-v1',
};

function parseS3MediaUrl(values: ArgValues): { url: string; extension: string } {
  const raw = requireString(str(values, 'url'), 'url');
  if (!S3_MEDIA_URL_PATTERN.test(raw)) {
    throw new CliInputError(
      'USAGE',
      '--url must be a credential-free https /media/<id>.<mp4|m4a|mp3|webm> locator',
      [
        {
          code: 'ENVELOPE_MALFORMED',
          path: 'payload.locatorUri',
          message: 'S3 media accepts only the closed public media locator grammar',
        },
      ],
    );
  }
  try {
    const parsed = new URL(raw);
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error('credentials/query/fragment');
    }
    return { url: raw, extension: /\.([a-z0-9]+)$/u.exec(parsed.pathname)?.[1] ?? '' };
  } catch {
    throw new CliInputError(
      'USAGE',
      '--url must be a credential-free https media locator (no query/fragment/userinfo)',
      [
        {
          code: 'ENVELOPE_MALFORMED',
          path: 'payload.locatorUri',
          message: 'S3 media locator carries credentials, a query or a fragment',
        },
      ],
    );
  }
}

/**
 * Declared redirect hosts for the S3 lane are bare public hostnames (the
 * closed 1.2 payload grammar admits no port/userinfo); the selected
 * locator's own hostname is always admissible.
 */
function parseS3RedirectHosts(values: ArgValues, urlHostname: string): readonly string[] {
  const raw = values['redirect-host'];
  const hosts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const declared: string[] = [];
  for (const host of hosts) {
    if (
      typeof host !== 'string' ||
      host.length === 0 ||
      host.length > 255 ||
      /[/\\:]/.test(host) ||
      !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/iu.test(host)
    ) {
      throw new CliInputError(
        'USAGE',
        '--redirect-host entries must be bare public DNS hostnames',
        [
          {
            code: 'ENVELOPE_MALFORMED',
            path: 'payload.declaredRedirectHosts',
            message: `'${String(host)}' is not a bare public DNS hostname`,
          },
        ],
      );
    }
    const lowered = host.toLowerCase();
    if (!declared.includes(lowered)) {
      declared.push(lowered);
    }
  }
  if (!declared.includes(urlHostname)) {
    declared.unshift(urlHostname);
  }
  if (declared.length > 8) {
    fail('at most 8 redirect hosts are admissible (including the locator host)');
  }
  return declared;
}

/**
 * The independently published digest is OPTIONAL (#101 R1/F01): an ordinary
 * S1 download never requires the user to know a digest first. When supplied
 * it is enforced (a mismatch fails the download, C09); when omitted the
 * Target claim uses the conservative declared-delivery-graph provenance
 * basis (C34).
 */
function parseSha256(values: ArgValues): string | undefined {
  const raw = str(values, 'sha256');
  if (raw === undefined) {
    return undefined;
  }
  if (raw.length === 0 || !SHA256_HEX_PATTERN.test(raw)) {
    throw new CliInputError('USAGE', '--sha256 must be a lowercase hex SHA-256 digest', [
      {
        code: 'ENVELOPE_MALFORMED',
        path: 'delivery.expectedSha256',
        message: 'expected 64 lowercase hex characters',
      },
    ]);
  }
  return raw;
}

function parseHttpUrl(values: ArgValues): string {
  const raw = requireString(str(values, 'url'), 'url');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail('--url must be an absolute http(s) URL');
  }
  if (parsed!.protocol !== 'http:' && parsed!.protocol !== 'https:') {
    fail('--url must be an absolute http(s) URL');
  }
  return raw;
}

function parseRedirectHosts(values: ArgValues, urlHost: string): readonly string[] {
  const raw = values['redirect-host'];
  const hosts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const declared: string[] = [];
  for (const host of hosts) {
    if (typeof host !== 'string' || host.length === 0 || host.length > 255 || /[/\\]/.test(host)) {
      throw new CliInputError('USAGE', '--redirect-host entries must be plain host strings', [
        {
          code: 'ENVELOPE_MALFORMED',
          path: 'delivery.declaredRedirectHosts',
          message: `'${String(host)}' is not a plain host string`,
        },
      ]);
    }
    if (!declared.includes(host)) {
      declared.push(host);
    }
  }
  // The locator's own host is always an admissible delivery hop (C29 scope
  // is the selected resource itself); explicit flags only ADD hosts.
  if (!declared.includes(urlHost)) {
    declared.unshift(urlHost);
  }
  if (declared.length > 8) {
    fail('at most 8 redirect hosts are admissible (including the locator host)');
  }
  return declared;
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
    case 'download': {
      const url = parseHttpUrl(values);
      const totalBytesRaw = str(values, 'total-bytes');
      return {
        kind: 'download',
        target,
        url,
        expectedSha256: parseSha256(values),
        expectedContentTypePrefix: str(values, 'content-type-prefix'),
        expectedTotalBytes:
          totalBytesRaw === undefined ? undefined : parseInteger(totalBytesRaw, 'total-bytes', 0),
        redirectHosts: parseRedirectHosts(values, new URL(url).host),
        wait: parseWaitWithDefault(values),
        requestId: parseRequestId(values),
      };
    }
    case 'media': {
      // The S3 lane's sole authorized peer is the installed CLI over the
      // OS-verified Windows Core pipe: fail closed at parse time instead of
      // bouncing off the transport gate later.
      if (target.pipeName === undefined) {
        fail(
          'media requires --pipe-name (the S3 lane runs only over the OS-verified Windows Core named pipe)',
        );
      }
      const { url, extension } = parseS3MediaUrl(values);
      const variantKey = parseIdentifier(str(values, 'variant'), 'variant', 'payload.variantKey');
      const profile = str(values, 'profile');
      const mediaProfileId =
        profile === undefined
          ? (S3_DEFAULT_MEDIA_PROFILE[extension] ??
            fail(`--profile is required for extension '.${extension}'`))
          : parseIdentifier(profile, 'profile', 'payload.mediaProfileId');
      const totalBytesRaw = str(values, 'total-bytes');
      return {
        kind: 'media',
        target,
        url,
        variantKey,
        mediaProfileId,
        byteConstraintSha256: parseSha256(values),
        expectedContentTypePrefix: str(values, 'content-type-prefix'),
        expectedTotalBytes:
          totalBytesRaw === undefined ? undefined : parseInteger(totalBytesRaw, 'total-bytes', 0),
        redirectHosts: parseS3RedirectHosts(values, new URL(url).hostname),
        wait: parseWaitWithDefault(values),
        requestId: parseRequestId(values),
      };
    }
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
