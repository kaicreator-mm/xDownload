/**
 * #150: Core-only S3 selected-media path — installation-pinned public source
 * policy is REQUIRED before any durable dispatch, and the same original
 * authority is enforced by the real direct adapter on HTTPS redirects.
 * Network-positive cases use a deterministic fetch stub (NOT physical TLS).
 * Persistence uses the real Core writer, SQLite and filesystem artifact store.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindLocator,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import {
  digestPublicMediaSourceProfile,
  pinPublicMediaSourcePolicy,
  type DirectTransferRequest,
  type PublicMediaSourceProfile,
} from '@xdownload/direct-acquisition';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  removeTempDir,
} from './helpers.ts';
import {
  CoreRuntimeFlowError,
  executeDirectAcquisition,
  executePinnedPublicS3Acquisition,
  type DirectFlowInput,
} from '../src/index.ts';

const dirs: string[] = [];
const URI = 'https://media.example.org/media/clip01.mp4';
const PROFILE: PublicMediaSourceProfile = {
  profileId: 'installed-public-s3',
  revision: '1',
  origins: [{ scheme: 'https', hostname: 'media.example.org', port: 443 }],
  redirectOrigins: [{ scheme: 'https', hostname: 'cdn.example.org', port: 443 }],
};
const policy = pinPublicMediaSourcePolicy(PROFILE, digestPublicMediaSourceProfile(PROFILE));

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

function inputFor(uri = URI, overrides: Partial<DirectTransferRequest> = {}): DirectFlowInput {
  const targetId = unwrapOrThrow(makeLogicalTargetId('target-file-001'));
  const binding = unwrapOrThrow(
    bindLocator({ kind: 'direct', uri }, targetId, {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: uri,
    }),
  );
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
      binding,
      allowedRedirectHosts: ['media.example.org', 'cdn.example.org'],
      expectedContentTypePrefix: 'video/mp4',
      mediaPolicy: {
        signatures: [{ hex: '66747970', offset: 4, label: 'MP4 ftyp box' }],
      },
      attempt: 0,
      ...overrides,
    },
  };
}

describe('#150 installed-policy S3 Core boundary and durable effects', () => {
  it('refuses generic S3 as an unguarded S1 call before fetch, SQLite or scheduler mutation', async () => {
    const dir = makeTempDir('xd-s3-bypass');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(executeDirectAcquisition(runtime, inputFor())).rejects.toBeInstanceOf(
        CoreRuntimeFlowError,
      );
      expect(runtime.writer.reader.workItems()).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      closeRuntime(runtime);
    }
  });

  it('rejects unpinned URLs, media identity drift and missing media checks before durable effects', async () => {
    const dir = makeTempDir('xd-s3-deny');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cases = [
      inputFor('https://other.example.org/media/clip01.mp4'),
      inputFor('https://media.example.org/media/clip01.mp4?token=secret'),
      inputFor('http://127.0.0.1/media/clip01.mp4'),
      inputFor(URI, { expectedSha256: 'a'.repeat(64) }),
      inputFor(URI, { locatorRefresher: async (item) => item }),
      inputFor(URI, { mediaPolicy: { signatures: [] } }),
      inputFor(URI, { expectedContentTypePrefix: 'text/html' }),
      inputFor(URI, { selectedMemberId: unwrapOrThrow(makeMemberId('other-member')) }),
    ];
    try {
      for (const item of cases) {
        await expect(
          executePinnedPublicS3Acquisition(runtime, item, policy),
        ).rejects.toBeInstanceOf(CoreRuntimeFlowError);
        expect(runtime.writer.reader.workItems()).toHaveLength(0);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    } finally {
      closeRuntime(runtime);
    }
  });

  it('routes a pinned HTTPS media candidate through genuine Core budget/SQLite/artifact validation', async () => {
    const dir = makeTempDir('xd-s3-authorized');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    const bytes = new Uint8Array(512);
    bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from(bytes), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(bytes.length),
        },
      }),
    );
    try {
      const result = await executePinnedPublicS3Acquisition(runtime, inputFor(), policy);
      expect(result.attemptReplayed).toBe(false);
      expect(result.transfer?.reason).toBe('COMPLETED');
      expect(
        result.transfer?.validations.map((v) => v.layer + ':' + String(v.passed)).sort(),
      ).toEqual(['format:true', 'media:true', 'target:true', 'transfer:true']);
      expect(result.acceptance).toBeDefined();
      expect(result.schedulerAcceptance?.ok).toBe(true);
      expect(runtime.writer.reader.workItems()).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(URI);
      const artifact = runtime.store.readFinalBytes('artifact:s3-media-001');
      expect(artifact).toBeDefined();
      expect(createHash('sha256').update(artifact!).digest('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    } finally {
      closeRuntime(runtime);
    }
  });
});
