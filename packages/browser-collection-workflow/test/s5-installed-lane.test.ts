/**
 * #151 installed S5 lane — closed decode discipline, deterministic journey
 * identity, and the fail-closed Core-unreachable path (the full
 * pipe-transported loop is proven by the Windows installed canary; CI here
 * proves every typed rejection and the identity derivation).
 */
import { describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { createInstalledS5Lane, s5IdentityFor } from '../src/s5-installed-lane.ts';

const PIPE = String.raw`\\.\pipe\xdownload-core-canary-s5`;

describe('s5IdentityFor', () => {
  it('derives one identity per observed page tuple, order-insensitively over members', () => {
    const a = s5IdentityFor({
      pageUrl: 'http://127.0.0.1:9/p',
      hrefs: ['http://127.0.0.1:9/a', 'http://127.0.0.1:9/b'],
    });
    const b = s5IdentityFor({
      pageUrl: 'http://127.0.0.1:9/p',
      hrefs: ['http://127.0.0.1:9/b', 'http://127.0.0.1:9/a'],
    });
    const c = s5IdentityFor({ pageUrl: 'http://127.0.0.1:9/p', hrefs: ['http://127.0.0.1:9/a'] });
    expect(a).toEqual(b);
    expect(a.contractId).not.toBe(c.contractId);
    expect(a.contractId).toMatch(/^contract-s5-[0-9a-f]{24}$/u);
    expect(a.snapshotId).toMatch(/^snapshot-s5-[0-9a-f]{24}$/u);
    expect(a.collectionIdentity).toBe(`collection/s5-${a.contractId.slice('contract-s5-'.length)}`);
  });
});

describe('createInstalledS5Lane lane decode (fail closed)', () => {
  const lane = createInstalledS5Lane({
    broker: createAuthBroker(),
    core: { pipeName: PIPE, installId: 'install-s5', userId: 'user-s5' },
  });

  async function rejectionOf(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await lane.handle({
      kind: 'S5_GROUP_PREPARE',
      requestId: 'req-lane-001',
      payload,
    })) as unknown as Record<string, unknown>;
  }

  it('rejects unknown fields, bad tab ids, non-canonical page URIs and malformed members', async () => {
    for (const payload of [
      {
        tabId: 7,
        pageUrl: 'http://127.0.0.1:9/p',
        members: [{ href: 'http://127.0.0.1:9/a', text: 'a' }],
        extra: 1,
      },
      {
        tabId: -1,
        pageUrl: 'http://127.0.0.1:9/p',
        members: [{ href: 'http://127.0.0.1:9/a', text: 'a' }],
      },
      { tabId: 7, pageUrl: 'not-a-url', members: [{ href: 'http://127.0.0.1:9/a', text: 'a' }] },
      {
        tabId: 7,
        pageUrl: 'http://127.0.0.1:9/p',
        members: [{ href: 'http://127.0.0.1:9/a?q=1', text: 'a' }],
      },
      { tabId: 7, pageUrl: 'http://127.0.0.1:9/p', members: [] },
      {
        tabId: 7,
        pageUrl: 'http://127.0.0.1:9/p',
        members: [
          { href: 'http://127.0.0.1:9/a', text: 'a' },
          { href: 'http://127.0.0.1:9/a', text: 'b' },
        ],
      },
    ]) {
      const response = await rejectionOf(payload);
      expect(response['kind']).toBe('S5_REJECTED');
      expect(response['stage']).toBe('LANE_DECODE');
    }
  });

  it('rejects confirm without an explicit user-confirm decision token', async () => {
    const response = (await lane.handle({
      kind: 'S5_GROUP_CONFIRM',
      requestId: 'req-lane-002',
      payload: {
        contractId: 'contract-s5-x',
        prepareId: 's5prepare:contract-s5-x:snap',
        snapshotId: 'snap',
        selectedMemberIds: ['s5m-1'],
        decisionToken: 'auto:yes',
      },
    })) as unknown as Record<string, unknown>;
    expect(response['kind']).toBe('S5_REJECTED');
    expect(response['stage']).toBe('LANE_DECODE');
  });

  it('fails closed CORE_TRANSPORT when the OS-verified pipe is unreachable', async () => {
    const response = (await lane.handle({
      kind: 'S5_GROUP_STATUS',
      requestId: 'req-lane-003',
      payload: { contractId: 'contract-s5-x' },
    })) as unknown as Record<string, unknown>;
    // On non-Windows/CI the pipe client refuses construction; on Windows an
    // absent listener refuses connection. Both are the same typed outcome.
    if (process.platform === 'win32') {
      expect(response['kind']).toBe('S5_REJECTED');
      expect(response['stage']).toBe('CORE_PROJECTION');
    } else {
      expect(response['kind']).toBe('S5_REJECTED');
      expect(response['stage']).toBe('CORE_TRANSPORT');
    }
  });
});
