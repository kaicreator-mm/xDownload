/**
 * T013 CLI process entry — a thin shell over the adapter: bind real process
 * ports (loopback seam transport, fs/stdin payload sources, real clock),
 * parse argv, run, write exactly one JSON document to stdout and exit with
 * the documented code. All behavior lives in `adapter.ts` and is tested
 * there; this file adds no semantics.
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
  // S3 cannot borrow loopback TCP's caller-presented peer identity.
  // A requested Windows verified Core pipe never degrades into TCP on error.
  let clientTransport: SeamClientTransport;
  try {
    if (input.target.pipeName !== undefined) {
      if (process.platform !== 'win32') {
        throw new Error('Windows Core named-pipe transport is supported only on Windows');
      }
      clientTransport = createWindowsPipeClientTransport();
    } else {
      clientTransport = createLoopbackClientTransport();
    }
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
