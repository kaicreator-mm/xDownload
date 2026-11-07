/**
 * CLI process entry (T04) — bind real process ports, parse argv and route:
 *
 * - explicit `--route v0.2` inputs go through `domain-app-cli.ts` →
 *   `domain-app-commands.ts` (the frozen public facade calls) → the
 *   seam-bound public DomainApp facade (`domain-app-seam-facade.ts`) → the
 *   admitted K composition inside the installed Core process (CF-1 chain);
 * - everything else keeps the legacy v1 adapter (`adapter.ts`) verbatim.
 *
 * Both paths write exactly one machine-readable JSON document to stdout,
 * human-readable mode/progress notes to stderr and exit with the documented
 * code. The CLI never owns Core lifecycle truth and never falls back to a
 * second transport.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import * as readline from 'node:readline/promises';
import {
  createLoopbackClientTransport,
  createWindowsPipeClientTransport,
  type SeamClientTransport,
} from '@xdownload/core-seam';
import { parseArgv } from './args.ts';
import {
  runAdapter,
  type AdapterPorts,
  type RenditionSelection,
  type SelectionGesture,
  type SourceRequest,
} from './adapter.ts';
import { runDomainAppInput } from './domain-app-cli.ts';
import { CLI_USAGE } from './args.ts';
import { renderErrorDocument, toJson } from './render.ts';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', (error: Error) => reject(error));
  });
}

async function readSource(source: SourceRequest): Promise<string> {
  if (source.stdin) {
    return readStdin();
  }
  if (source.file === undefined) {
    throw new Error('no payload source given');
  }
  return readFile(source.file, 'utf8');
}

/**
 * The checked Core endpoint transport. A requested Windows verified Core
 * pipe never degrades into TCP on error (no silent transport fallback).
 */
function selectClientTransport(pipeName: string | undefined): SeamClientTransport {
  if (pipeName !== undefined) {
    if (process.platform !== 'win32') {
      throw new Error('Windows Core named-pipe transport is supported only on Windows');
    }
    return createWindowsPipeClientTransport();
  }
  return createLoopbackClientTransport();
}

async function main(): Promise<void> {
  let input;
  try {
    input = parseArgv(process.argv.slice(2));
  } catch (error) {
    const usage = error instanceof Error ? error.message : 'invalid arguments';
    process.stdout.write(
      `${toJson(renderErrorDocument({ error: 'USAGE', message: usage, usage: true }))}\n`,
    );
    process.stderr.write(`input error\n`);
    process.exitCode = 1;
    return;
  }
  if (input.kind === 'help') {
    process.stdout.write(`${CLI_USAGE}\n`);
    return;
  }
  // CF-1 (T04): explicit --route v0.2 argv reaches the Domain App command
  // layer with the REAL seam-bound facade (one Core-owned K composition).
  if (input.kind === 'domain-app') {
    let clientTransport: SeamClientTransport;
    try {
      clientTransport = selectClientTransport(input.target.pipeName);
    } catch {
      process.stdout.write(
        `${toJson(
          renderErrorDocument({
            error: 'USAGE',
            message:
              'requested Core named-pipe transport is unavailable; TCP fallback is forbidden',
            usage: true,
          }),
        )}\n`,
      );
      process.stderr.write('Core transport unavailable\n');
      process.exitCode = 1;
      return;
    }
    const result = await runDomainAppInput(input, {
      clientTransport,
      readSource,
      now: () => new Date().toISOString(),
      makeRequestId: () => `req-${randomUUID()}`,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      epochMs: () => Date.now(),
    });
    process.stdout.write(`${result.document}\n`);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
    return;
  }
  let clientTransport: SeamClientTransport;
  try {
    clientTransport = selectClientTransport(input.target.pipeName);
  } catch {
    process.stdout.write(
      `${toJson(
        renderErrorDocument({
          error: 'USAGE',
          message: 'requested Core named-pipe transport is unavailable; TCP fallback is forbidden',
          usage: true,
        }),
      )}\n`,
    );
    process.stderr.write('Core transport unavailable\n');
    process.exitCode = 1;
    return;
  }
  const ports: AdapterPorts = {
    clientTransport,
    readSource,
    now: () => new Date().toISOString(),
    makeRequestId: () => `req-${randomUUID()}`,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    epochMs: () => Date.now(),
    // #150: the S3 selection gesture requires an ATTACHED interactive
    // terminal — piped/redirected stdin or a non-TTY stderr never confirms
    // (no --yes flag exists; a page/Recipe cannot answer for the user).
    confirmSelection: async (prompt: string): Promise<SelectionGesture> => {
      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        return 'unavailable';
      }
      process.stderr.write(prompt);
      const rl = readline.createInterface({ input: process.stdin });
      try {
        const answer = await rl.question('');
        const normalized = answer.trim().toLowerCase();
        return normalized === 'y' || normalized === 'yes' ? 'confirmed' : 'declined';
      } finally {
        rl.close();
      }
    },
    // #153: the S4 rendition (quality) choice also requires an ATTACHED
    // interactive terminal — piped/redirected stdin never selects (a page,
    // Recipe or script cannot answer for the user). One raw answer line is
    // returned verbatim; the adapter maps it onto the Core-observed variants
    // and stops on anything that does not name one.
    selectRendition: async (prompt: string): Promise<RenditionSelection> => {
      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        return { choice: 'unavailable' };
      }
      process.stderr.write(prompt);
      const rl = readline.createInterface({ input: process.stdin });
      try {
        const answer = (await rl.question('')).trim();
        if (answer.length === 0) {
          return { choice: 'declined' };
        }
        return { choice: 'confirmed', renditionKey: answer };
      } finally {
        rl.close();
      }
    },
  };
  const result = await runAdapter(input, ports);
  process.stdout.write(`${result.document}\n`);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

await main();
