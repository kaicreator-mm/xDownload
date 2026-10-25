import { describe, expect, it } from 'vitest';
import type { SeamClientTransport, SeamListenTarget } from '@xdownload/core-seam';
import { CliInputError, parseArgv } from '../src/args.ts';
import { runAdapter, type AdapterPorts } from '../src/adapter.ts';

const base = [
  'status',
  '--contract',
  'contract-001',
  '--install-id',
  'myinstall',
  '--user-id',
  'operator',
];
const pipe = String.raw`\\.\pipe\xdownload-core-myinstall`;

function fakePorts(seen: SeamListenTarget[]): AdapterPorts {
  const clientTransport: SeamClientTransport = {
    async connect(target) {
      seen.push(target);
      throw new Error('synthetic disconnected transport');
    },
  };
  return {
    clientTransport,
    readSource: async () => '',
    now: () => '2026-10-26T00:00:00Z',
    epochMs: () => 0,
    sleep: async () => {},
    makeRequestId: () => 'req-123',
  };
}

describe('#150 CLI Windows same-install pipe target, no TCP fallback', () => {
  it('accepts only the canonical local Core namespace for its claimed install id', () => {
    const parsed = parseArgv([...base, '--pipe-name', pipe]);
    expect(parsed.kind).toBe('status');
    if (parsed.kind !== 'status') return;
    expect(parsed.target).toEqual({
      host: '127.0.0.1',
      port: 0,
      installId: 'myinstall',
      userId: 'operator',
      pipeName: pipe,
    });
  });

  it('rejects mismatched/remote/conflicting namespace before Core interaction', () => {
    const invalid = [
    [...base, '--pipe-name', String.raw`\\otherhost\pipe\xdownload-core-myinstall`],
    [...base, '--pipe-name', String.raw`\\.\pipe\arbitrary`],
    [...base, '--pipe-name', String.raw`\\.\pipe\xdownload-core-otherinstall`],
    [...base, '--pipe-name', pipe, '--port', '1234'],
    [...base, '--pipe-name', pipe, '--host', '127.0.0.1'],
    [
      'status',
      '--contract',
      'contract-001',
      '--install-id',
      'myinstall/../other',
      '--user-id',
      'operator',
      '--pipe-name',
      pipe,
    ],
    ];
    for (const argv of invalid) {
      expect(() => parseArgv(argv)).toThrow(CliInputError);
    }
  });

  it('forwards checked named pipe only as listen target; no unverified S3 command or TCP invocation', async () => {
    const input = parseArgv([...base, '--pipe-name', pipe]);
    const seen: SeamListenTarget[] = [];
    const result = await runAdapter(input, fakePorts(seen));
    expect(result.exitCode).not.toBe(0);
    expect(seen).toEqual([{ host: '127.0.0.1', port: 0, pipeName: pipe }]);
  });

  it('retains legacy S1 loopback args and does not invent a verified peer', async () => {
    const input = parseArgv([...base, '--port', '28123']);
    const seen: SeamListenTarget[] = [];
    await runAdapter(input, fakePorts(seen));
    expect(seen).toEqual([{ host: '127.0.0.1', port: 28123 }]);
  });
});
