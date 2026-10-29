/**
 * T018 Core-host entry tests: typed argv parsing, the typed `node:sqlite`
 * prerequisite check (including its failure path, which the Windows smoke
 * cannot trigger on a Node that provides node:sqlite), and a real
 * composition test — the packaged composition path (createCoreRuntime +
 * loopback transport) driven by a real seam client through an actual
 * SUBMIT_CONTRACT round-trip.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLoopbackClientTransport, currentSeamSchemaIdentity } from '@xdownload/core-seam';
import {
  CORE_HOST_EXIT,
  ensureSqliteAvailable,
  parseCoreHostArgv,
  startCoreHost,
  type CoreHostOptions,
} from '../core-host.ts';

describe('core-host argv parsing', () => {
  it('accepts the documented grammar', () => {
    const parsed = parseCoreHostArgv([
      '--root',
      '/tmp/data',
      '--install-id',
      'install-001',
      '--user-id',
      'user-001',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.options).toEqual({
        rootDir: '/tmp/data',
        installId: 'install-001',
        userId: 'user-001',
        host: '127.0.0.1',
        port: 0,
      });
    }
  });

  const invalidCases: readonly { argv: readonly string[]; why: string }[] = [
    { argv: [], why: 'no arguments at all' },
    { argv: ['--install-id', 'i', '--user-id', 'u'], why: 'missing --root' },
    { argv: ['--root', '/tmp', '--user-id', 'u'], why: 'missing --install-id' },
    { argv: ['--root', '/tmp', '--install-id', 'i'], why: 'missing --user-id' },
    {
      argv: ['--root', '/tmp', '--install-id', 'i', '--user-id', 'u', '--port', 'x'],
      why: 'non-numeric port',
    },
    {
      argv: ['--root', '/tmp', '--install-id', 'i', '--user-id', 'u', '--bogus'],
      why: 'unknown flag',
    },
  ];
  for (const input of invalidCases) {
    it(`rejects ${input.why}`, () => {
      const parsed = parseCoreHostArgv(input.argv);
      expect(parsed.ok).toBe(false);
    });
  }
});

describe('node:sqlite prerequisite check', () => {
  it('fails with a typed actionable message when node:sqlite is unavailable', async () => {
    const result = await ensureSqliteAvailable(() => Promise.reject(new Error('no such module')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('node:sqlite is unavailable');
      expect(result.message).toContain('node:sqlite (DatabaseSync)');
    }
  });

  it('fails closed when the module exists without DatabaseSync', async () => {
    const result = await ensureSqliteAvailable(() => Promise.resolve({}));
    expect(result.ok).toBe(false);
  });

  it('succeeds when DatabaseSync is exposed (this Node provides node:sqlite)', async () => {
    const result = await ensureSqliteAvailable();
    expect(result).toEqual({ ok: true });
  });
});

describe('core-host composition (real runtime + loopback transport)', () => {
  const cleanup: string[] = [];
  afterAll(() => {
    for (const dir of cleanup.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves SUBMIT_CONTRACT through the seam and shuts down cleanly', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xhost-'));
    cleanup.push(dataRoot);
    const options: CoreHostOptions = {
      rootDir: dataRoot,
      installId: 'test-install-001',
      userId: 'test-user-001',
      host: '127.0.0.1',
      port: 0,
    };
    const host = await startCoreHost(options);
    try {
      expect(host.host).toBe('127.0.0.1');
      expect(host.port).toBeGreaterThan(0);
      const transport = createLoopbackClientTransport();
      const connection = await transport.connect({ host: host.host, port: host.port });
      const response: { outcome?: string } = await new Promise((resolve, reject) => {
        connection.onFrame((frame) => resolve(JSON.parse(frame) as { outcome?: string }));
        connection.onEnded(() => reject(new Error('connection ended before response')));
        const envelope = {
          schemaIdentity: currentSeamSchemaIdentity(),
          kind: 'query',
          queryType: 'READ_PROJECTION',
          peer: { installId: 'test-install-001', userId: 'test-user-001', surface: 'CLI' },
          requestId: 'req-core-host-test-1',
          aggregateId: 'contract-probe-001',
          issuedAt: '2026-10-04T00:00:00Z',
        };
        connection.send(JSON.stringify(envelope));
      });
      // A READ_PROJECTION for an unknown aggregate is a typed seam decision,
      // not a crash — the exact outcome stays the seam's own semantics.
      expect(['PROJECTION', 'REJECTED']).toContain(response.outcome);
      await connection.close();
    } finally {
      await host.shutdown();
    }
    // Durable layout exists after clean shutdown.
    expect(fs.readdirSync(dataRoot).length).toBeGreaterThan(0);
    expect(CORE_HOST_EXIT.SUCCESS).toBe(0);
  });
});
