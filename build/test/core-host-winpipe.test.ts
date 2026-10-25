/**
 * #150 Core-host + shipped CLI exact namespace symmetry.
 * These are transport-selection / fail-closed platform checks, NOT real pipe proof.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NonLoopbackTransportRefusedError,
  WindowsIpcUnsupportedError,
  WindowsPipeTransportUnsupportedError,
} from '@xdownload/core-seam';
import { parseArgv as parseCliArgv } from '../../apps/cli/src/args.ts';
import { coreHostTransportStartRefused, parseCoreHostArgv, startCoreHost, type CoreHostOptions } from '../core-host.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const pathFor = (id: string) => String.raw`\\.\pipe\xdownload-core-` + id;
const base = (root: string, id: string) => [
  '--root',
  root,
  '--install-id',
  id,
  '--user-id',
  'operator',
];

describe('#150 packaged Windows native bridge bind failure exit classification', () => {
  it('classifies native first-instance collision and missing bridge as transport refusal', () => {
    expect(coreHostTransportStartRefused(
      new WindowsIpcUnsupportedError('CreateNamedPipeW failed (GetLastError=231)'),
    )).toBe(true);
    expect(coreHostTransportStartRefused(
      new WindowsIpcUnsupportedError('native koffi module not installed'),
    )).toBe(true);
    expect(coreHostTransportStartRefused(
      new WindowsPipeTransportUnsupportedError('linux'),
    )).toBe(true);
    expect(coreHostTransportStartRefused(new NonLoopbackTransportRefusedError('0.0.0.0'))).toBe(true);
  });

  it('never relabels general Core composition errors as network refusals', () => {
    expect(coreHostTransportStartRefused(new Error('SQLite file corrupt'))).toBe(false);
    expect(coreHostTransportStartRefused(new Error('another Core failed'))).toBe(false);
    expect(coreHostTransportStartRefused(undefined)).toBe(false);
  });
});

describe('#150 Core-host Windows pipe, exact CLI namespace, no downgrade', () => {
  it('accepts one exact listener and CLI target without TCP side channel', () => {
    const pipe = pathFor('myinstall');
    const parsed = parseCoreHostArgv([
      ...base('C:/xdownload-core', 'myinstall'),
      '--pipe-name',
      pipe,
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.options).toMatchObject({
      rootDir: 'C:/xdownload-core',
      host: '127.0.0.1',
      port: 0,
      installId: 'myinstall',
      userId: 'operator',
      pipeName: pipe,
    });
    const cli = parseCliArgv([
      'status',
      '--contract',
      'contract-001',
      '--install-id',
      'myinstall',
      '--user-id',
      'operator',
      '--pipe-name',
      pipe,
    ]);
    expect(cli.kind).toBe('status');
    if (cli.kind !== 'status') return;
    expect(cli.target.pipeName).toBe(parsed.options.pipeName);
  });

  it('refuses remote, arbitrary or wrong-install pipe and TCP ambiguity', () => {
    const baseArgs = base('C:/xdownload-core', 'myinstall');
    const unsafe = [
      [...baseArgs, '--pipe-name', String.raw`\\remote\pipe\xdownload-core-myinstall`],
      [...baseArgs, '--pipe-name', String.raw`\\.\pipe\unrelated`],
      [...baseArgs, '--pipe-name', pathFor('otherinstall')],
      [...baseArgs, '--pipe-name', pathFor('myinstall'), '--port', '0'],
      [...baseArgs, '--pipe-name', pathFor('myinstall'), '--host', '127.0.0.1'],
      [
        ...base('C:/xdownload-core', 'myinstall/../../other'),
        '--pipe-name',
        pathFor('myinstall/../../other'),
      ],
    ];
    for (const argv of unsafe) expect(parseCoreHostArgv(argv).ok).toBe(false);
    const legacy = parseCoreHostArgv(baseArgs);
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.options).toMatchObject({ port: 0, host: '127.0.0.1' });
  });

  it('denies direct programmatic host API with forged pipe namespace or TCP coexistence', async () => {
    const root = path.join(os.tmpdir(), 'xd-core-invalid-pipe-' + Date.now());
    roots.push(root);
    const baseOptions: CoreHostOptions = {
      rootDir: root,
      installId: 'myinstall',
      userId: 'operator',
      host: '127.0.0.1',
      port: 0,
      pipeName: pathFor('myinstall'),
    };
    for (const hostile of [
      { ...baseOptions, pipeName: pathFor('someone-else') },
      { ...baseOptions, pipeName: String.raw`\\remote\pipe\xdownload-core-myinstall` },
      { ...baseOptions, port: 39999 },
      { ...baseOptions, host: '0.0.0.0' },
      { ...baseOptions, installId: 'myinstall/../other' },
    ]) {
      await expect(startCoreHost(hostile)).rejects.toThrow();
      expect(fs.existsSync(root)).toBe(false);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'rejects Windows pipe before touching SQLite on unsupported platforms',
    async () => {
      const root = path.join(os.tmpdir(), 'xd-core-winpipe-not-created-' + Date.now());
      roots.push(root);
      const opts: CoreHostOptions = {
        rootDir: root,
        installId: 'myinstall',
        userId: 'operator',
        host: '127.0.0.1',
        port: 0,
        pipeName: pathFor('myinstall'),
      };
      await expect(startCoreHost(opts)).rejects.toThrow('requires win32');
      expect(fs.existsSync(root)).toBe(false);
    },
  );
});
