/**
 * PR #164 R1 P1 regression: OS listener FIRST, no eager S1 recovery before
 * confirmed bind. Mock ONLY the Windows native listener, retain real host
 * ordering code. Synthetic pending-root marker is not an accepted journal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  mode: 'bind-fail' as 'bind-fail' | 'runtime-fail' | 'success',
  events: [] as string[],
  framesSent: 0,
  framesClosed: 0,
}));

vi.mock('@xdownload/core-seam', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xdownload/core-seam')>();
  return {
    ...original,
    createWindowsPipeServerTransport: (options: { pipeName: string }) => ({
      async start(handler: {
        onFrame(connection: { close(): void; send(frame: string): void }, frame: string): void;
      }) {
        probe.events.push('listener-start');
        if (probe.mode === 'bind-fail') throw Error('synthetic Windows first-pipe collision');
        // A client may arrive immediately after native first bind, while
        // the Core journal/SQLite runtime is still initializing.
        handler.onFrame({
          close: () => { probe.framesClosed += 1; },
          send: () => { probe.framesSent += 1; },
        }, '{"kind":"command"}');
        probe.events.push('listener-bound');
        return { host: 'WINDOWS_NAMED_PIPE', port: 0, pipeName: options.pipeName };
      },
      async stop() { probe.events.push('listener-stop'); },
    }),
  };
});

vi.mock('@xdownload/core-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xdownload/core-runtime')>();
  return {
    ...original,
    createCoreRuntime: (...args: Parameters<typeof original.createCoreRuntime>) => {
      probe.events.push('runtime-create');
      if (probe.mode === 'runtime-fail') throw Error('synthetic Core composition failure');
      return original.createCoreRuntime(...args);
    },
    reopenCoreRuntime: (...args: Parameters<typeof original.reopenCoreRuntime>) => {
      probe.events.push('runtime-reopen-start');
      // A failed bind must never start this eager S1 recovery path.
      return original.reopenCoreRuntime(...args);
    },
  };
});

import { startCoreHost } from '../core-host.ts';

const roots: string[] = [];
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  probe.mode = 'bind-fail';
  probe.events.length = 0;
  probe.framesClosed = 0;
  probe.framesSent = 0;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function opts(root: string) {
  const installId = 'collision-test-001';
  return {
    rootDir: root,
    installId,
    userId: 'operator',
    host: '127.0.0.1',
    port: 0,
    pipeName: String.raw`\\.\pipe\xdownload-core-` + installId,
  };
}

describe('#164 listener admission before Core recovery and side effects', () => {
  it('rejected first bind never reopens existing pending work or modifies durable root', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-pipe-collision-'));
    roots.push(root);
    const journal = path.join(root, 'seam-journal.jsonl');
    const marker = '{"pendingS1":"existing durable journal retained exactly"}\n';
    fs.writeFileSync(journal, marker);
    await expect(startCoreHost(opts(root))).rejects.toThrow('synthetic Windows first-pipe collision');
    expect(probe.events).toEqual(['listener-start']);
    expect(probe.framesSent).toBe(0);
    expect(fs.readFileSync(journal, 'utf8')).toBe(marker);
    expect(fs.readdirSync(root)).toEqual(['seam-journal.jsonl']);
  });

  it('fresh failed bind creates no Core data root or background transfer', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const root = path.join(os.tmpdir(), 'xd-pipe-collision-no-create-' + Date.now());
    roots.push(root);
    await expect(startCoreHost(opts(root))).rejects.toThrow('synthetic Windows first-pipe collision');
    expect(probe.events).toEqual(['listener-start']);
    expect(fs.existsSync(root)).toBe(false);
  });

  it('bound listener refuses early frames and stops if Core initialization fails', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const root = path.join(os.tmpdir(), 'xd-pipe-bind-runtime-reject-' + Date.now());
    roots.push(root);
    probe.mode = 'runtime-fail';
    await expect(startCoreHost(opts(root))).rejects.toThrow('synthetic Core composition failure');
    expect(probe.events).toEqual([
      'listener-start', 'listener-bound', 'runtime-create', 'listener-stop',
    ]);
    expect(probe.framesClosed).toBe(1);
    expect(probe.framesSent).toBe(0);
    expect(fs.existsSync(root)).toBe(false);
  });
});
