/**
 * #150 independent R1 P1 closure: Core deliberately has NO positive S3
 * transfer authority until it owns both an immutable installed source/selection
 * AND DNS/TLS actual connected-address enforcement for each HTTPS hop.
 * The earlier callable positive-effect function was unsafe and is removed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import type { DirectTransferRequest } from '@xdownload/direct-acquisition';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  removeTempDir,
} from './helpers.ts';
import * as CoreRuntimePublicApi from '../src/index.ts';
import {
  CoreRuntimeFlowError,
  executeDirectAcquisition,
  type DirectFlowInput,
} from '../src/index.ts';

const dirs: string[] = [];
const URI = 'https://media.example.org/media/clip01.mp4';

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

function s3Input(uri = URI, overrides: Partial<DirectTransferRequest> = {}): DirectFlowInput {
  const targetId = unwrapOrThrow(makeLogicalTargetId('target-file-001'));
  return {
    contractId: 'contract-single-001',
    snapshotId: 'snapshot-001',
    targetId: 'target-file-001',
    memberId: 'member-file-001',
    artifactId: 'artifact:s3-media-001',
    commandId: 'command:s3-media-001',
    authorizationContextRef: 'authctx/local-001',
    budgetProfile: rawSingleResourceContract()['budgetProfile'],
    transfer: {
      effectId: unwrapOrThrow(
        makeEffectId('effect:contract-single-001:snapshot-001:target-file-001'),
      ),
      contractId: 'contract-single-001',
      slice: 'S3',
      selectedMemberId: unwrapOrThrow(makeMemberId('member-file-001')),
      binding: unwrapOrThrow(
        bindLocator({ kind: 'direct', uri }, targetId, {
          binding: 'SELECTED_RESOURCE_PROVENANCE',
          originLocatorUri: uri,
        }),
      ),
      allowedRedirectHosts: ['media.example.org', 'cdn.example.org'],
      expectedContentTypePrefix: 'video/mp4',
      mediaPolicy: { signatures: [{ hex: '66747970', offset: 4, label: 'MP4 ftyp box' }] },
      attempt: 0,
      ...overrides,
    },
  };
}

describe('#150 deny unsafe public S3 Core effects until installed pinning exists', () => {
  it('does not expose the former arbitrary caller-supplied source policy entrypoint', () => {
    expect(Object.hasOwn(CoreRuntimePublicApi, 'executePinnedPublicS3Acquisition')).toBe(false);
  });

  it('rejects even a valid-looking S3 public-media source before SQLite, fetch and scheduler', async () => {
    const dir = makeTempDir('xd-s3-no-transport');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(executeDirectAcquisition(runtime, s3Input())).rejects.toThrow(
        'S3_REQUIRES_CORE_PINNED_MEDIA_SOURCE',
      );
      expect(runtime.writer.reader.workItems()).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('blocks a commandId getter that flips S1 into S3 before the real adapter call', async () => {
    const dir = makeTempDir('xd-s3-flip-getter');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const input = s3Input();
    input.transfer.slice = 'S1';
    let getterReads = 0;
    Object.defineProperty(input, 'commandId', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        input.transfer.slice = 'S3';
        return 'command:s3-getter-flip';
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(executeDirectAcquisition(runtime, input)).rejects.toThrow(
        'S1_UNSTABLE_PUBLIC_INPUT',
      );
      expect(getterReads).toBe(0);
      expect(runtime.writer.reader.workItems()).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('blocks an unstable transfer.slice getter and revoked transfer proxy without Core effects', async () => {
    const dir = makeTempDir('xd-s3-transfer-getter');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const withGetter = s3Input();
    let sliceReads = 0;
    Object.defineProperty(withGetter.transfer, 'slice', {
      enumerable: true,
      get: () => (++sliceReads === 1 ? 'S1' : 'S3'),
    });
    const withProxy = s3Input();
    const revoked = Proxy.revocable(withProxy.transfer, {});
    revoked.revoke();
    Object.defineProperty(withProxy, 'transfer', {
      value: revoked.proxy,
      enumerable: true,
    });
    try {
      for (const hostile of [withGetter, withProxy]) {
        await expect(executeDirectAcquisition(runtime, hostile)).rejects.toThrow(
          'S1_UNSTABLE_PUBLIC_INPUT',
        );
        expect(runtime.writer.reader.workItems()).toHaveLength(0);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
      expect(sliceReads).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('refuses every forged policy-like or malformed S3 request without positive fallback', async () => {
    const dir = makeTempDir('xd-s3-forged-policy');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const forgedPolicy = {
      profileId: 'forged-installed-policy',
      revision: '1',
      digest: 'a'.repeat(64),
      admitInitial: () => ({ ok: true }),
      admitRedirect: () => ({ ok: true }),
    };
    const requests = [
      s3Input(),
      s3Input('https://media.example.org/media/clip01.mp4?token=secret'),
      s3Input('http://127.0.0.1/media/clip01.mp4'),
      s3Input('https://other.example.org/media/clip01.mp4'),
      s3Input(URI, { expectedSha256: 'a'.repeat(64) }),
      s3Input(URI, { selectedMemberId: unwrapOrThrow(makeMemberId('other-member')) }),
      s3Input(URI, { mediaPolicy: { signatures: [] } }),
    ];
    try {
      expect(forgedPolicy.admitInitial().ok).toBe(true);
      for (const request of requests) {
        await expect(executeDirectAcquisition(runtime, request)).rejects.toBeInstanceOf(
          CoreRuntimeFlowError,
        );
        expect(runtime.writer.reader.workItems()).toHaveLength(0);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    } finally {
      closeRuntime(runtime);
    }
  });
});
