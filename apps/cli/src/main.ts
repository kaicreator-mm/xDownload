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
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { parseArgv } from './args.ts';
import { runAdapter, type AdapterPorts, type SourceRequest } from './adapter.ts';
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
  const ports: AdapterPorts = {
    clientTransport: createLoopbackClientTransport(),
    readSource,
    now: () => new Date().toISOString(),
    makeRequestId: () => `req-${randomUUID()}`,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    epochMs: () => Date.now(),
  };
  const result = await runAdapter(input, ports);
  process.stdout.write(`${result.document}\n`);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

await main();
