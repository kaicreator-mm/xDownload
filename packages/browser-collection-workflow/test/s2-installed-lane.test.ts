/**
 * #95 installed S2 lane — the native-host composition that carries one
 * explicit attachment journey to the ONE Core authority.
 *
 * Proves against REAL components (real broker, real loopback seam transport,
 * real Core runtime with SQLite/artifact dirs — no mocks):
 * - the positive journey: S2_ACQUIRE → scoped capability issue/use →
 *   SUBMIT_CONTRACT → EXECUTE_S2_ACQUISITION → S2_RESULT carrying the
 *   verbatim Core terminal projection; the artifact bytes are durably
 *   accepted in Core; the capability is revoked after the journey;
 * - the negative battery: no decision token, non-confirmation token,
 *   raw-secret fields, non-EVIDENCE_INPUT_ONLY handoff, TTL bounds, chunk
 *   bounds, unknown fields (structural), lane not configured, unreachable
 *   Core (fail closed, no fallback), and Core-side rejection propagation.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker, establishNativeHostSession } from '@xdownload/browser-auth-broker';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
  bindLoopbackSeam,
  seamCommand,
  peer,
  rawSingleResourceContract,
  profileWith,
} from '../../core-runtime/test/helpers.ts';
import type { CoreRuntime } from '@xdownload/core-runtime';
import {
  createInstalledS2Lane,
  isS2LaneResponse,
  selectInstalledS2CoreTransport,
  s2IdentityFor,
} from '../src/s2-installed-lane.ts';

const dirs: string[] = [];
const runtimes: CoreRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    closeRuntime(runtime);
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function attachmentBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) & 0xff;
  }
  return bytes;
}

function chunksOf(bytes: Uint8Array): string[] {
  const whole = Buffer.from(bytes).toString('base64');
  const chunks: string[] = [];
  for (let index = 0; index < whole.length; index += 3072) {
    chunks.push(whole.slice(index, index + 3072));
  }
  return chunks;
}

const ORIGIN = 'http://127.0.0.1:43181';

function s2Acquire(input: {
  readonly bytes: Uint8Array;
  readonly overrides?: Record<string, unknown>;
  readonly handoffOverrides?: Record<string, unknown>;
  readonly decisionToken?: string;
  readonly ttlMs?: number;
}): Record<string, unknown> {
  return {
    kind: 'S2_ACQUIRE',
    requestId: 's2-nm-0001',
    s2: {
      handoff: {
        kind: 'NETWORK_OBSERVATION',
        provenanceKey: `t42|f0|${ORIGIN}|obs-s2-0001`,
        origin: ORIGIN,
        payload: { requestUrl: `${ORIGIN}/s2/private-attachment.bin`, requestMethod: 'GET' },
        capturedAtMs: 1_700_000_000_000,
        authority: 'EVIDENCE_INPUT_ONLY',
        ...(input.handoffOverrides ?? {}),
      },
      decisionToken: input.decisionToken ?? 'user-confirm:s2:obs-s2-0001',
      ttlMs: input.ttlMs ?? 60_000,
      delivery: {
        locatorUri: `${ORIGIN}/s2/private-attachment.bin`,
        originLocatorUri: `${ORIGIN}/s2/private-attachment.bin`,
        provenanceBinding: 'SELECTED_RESOURCE_PROVENANCE',
        declaredRedirectHosts: ['127.0.0.1:43181'],
        expectedSha256: sha256(input.bytes),
        expectedContentTypePrefix: 'application/octet-stream',
        expectedTotalBytes: input.bytes.length,
      },
      browserResponse: {
        finalUrl: `${ORIGIN}/s2/private-attachment.bin`,
        contentType: 'application/octet-stream',
        status: 200,
      },
      bytes: chunksOf(input.bytes),
      ...(input.overrides ?? {}),
    },
  };
}

async function startedCore(): Promise<{
  readonly runtime: CoreRuntime;
  readonly host: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}> {
  const dir = makeTempDir('s2-lane-core');
  dirs.push(dir);
  const runtime = openRuntime(dir);
  runtimes.push(runtime);
  const loopback = await bindLoopbackSeam(runtime);
  return { runtime, host: loopback.target.host, port: loopback.target.port, stop: loopback.stop };
}

describe('#178 S2 Core selection', () => {
  const identity = { installId: 'install-001', userId: 'user-001' };
  const pipeName = 'named-pipe';

  it('routes pipe-only S2 to the verified transport', () => {
    const chosen = selectInstalledS2CoreTransport({ ...identity, pipeName });
    expect(chosen.kind).toBe('WINDOWS_PIPE');
    expect(chosen.target).toEqual({
      host: '127.0.0.1',
      port: 0,
      pipeName,
    });
  });

  it('prefers the pipe when both endpoints are configured', () => {
    const chosen = selectInstalledS2CoreTransport({
      ...identity,
      pipeName,
      host: '127.0.0.1',
      port: 18888,
    });
    expect(chosen.kind).toBe('WINDOWS_PIPE');
    expect(chosen.target).toHaveProperty('port', 0);
  });

  it('keeps the explicit legacy loopback tuple', () => {
    const chosen = selectInstalledS2CoreTransport({
      ...identity,
      host: '127.0.0.1',
      port: 18888,
    });
    expect(chosen.kind).toBe('LOOPBACK');
    expect(chosen.target).toHaveProperty('port', 18888);
  });

  it('refuses when no endpoint is configured', () => {
    expect(() => selectInstalledS2CoreTransport(identity)).toThrow();
  });
});

describe('#95 installed S2 lane (native host composition)', () => {
  it('carries the journey to the one Core authority and returns the verbatim terminal projection', async () => {
    const core = await startedCore();
    try {
      const broker = createAuthBroker();
      const lane = createInstalledS2Lane({
        broker,
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const bytes = attachmentBytes(8192);
      const response = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 's2-nm-0001',
        payload: s2Acquire({ bytes })['s2'] as Record<string, unknown>,
      });
      expect(isS2LaneResponse(response)).toBe(true);
      expect(response.kind).toBe('S2_RESULT');
      if (response.kind !== 'S2_RESULT') throw new Error('unreachable');
      const terminal = response.terminal as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect(terminal['validationSummary']).toMatchObject({ status: 'ALL_PASSED' });
      // Durable truth in Core, independent of the lane's claim:
      const workItems = core.runtime.writer.reader.workItems();
      expect(workItems.length).toBe(1);
      expect(core.runtime.recovery.classify(workItems[0]!.workItemId).lifecycleClass).toBe(
        'ACCEPTED',
      );
      const artifact = core.runtime.store.readFinalBytes(
        `artifact:s2:${createHash('sha256').update(`t42|f0|${ORIGIN}|obs-s2-0001\n${ORIGIN}/s2/private-attachment.bin`).digest('hex').slice(0, 24)}`,
      );
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
      // Least authority: the journey's capability is revoked afterwards.
      const inspected = broker.inspect(response.authorizationContextRef);
      expect(inspected.ok ? inspected.value.status : 'REVOKED').toBe('REVOKED');
    } finally {
      await core.stop();
    }
  });

  it('rejects without an explicit user-confirmation decision token (no automatic issue)', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const noToken = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: {
          ...(s2Acquire({ bytes: attachmentBytes(16) })['s2'] as Record<string, unknown>),
          decisionToken: undefined,
        },
      });
      expect(noToken.kind).toBe('S2_REJECTED');
      if (noToken.kind !== 'S2_REJECTED') throw new Error('unreachable');
      expect(noToken.stage).toBe('LANE_DECODE');
      expect(noToken.reasons[0]?.code).toBe('ISSUE_DECISION_REQUIRED');

      const internalToken = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: {
          ...(s2Acquire({ bytes: attachmentBytes(16) })['s2'] as Record<string, unknown>),
          decisionToken: 'internal-recovery:silent',
        },
      });
      expect(internalToken.kind).toBe('S2_REJECTED');
    } finally {
      await core.stop();
    }
  });

  it('rejects raw-secret material, forged authority labels and TTL/chunk bound violations', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const base = s2Acquire({ bytes: attachmentBytes(16) })['s2'] as Record<string, unknown>;

      const secret = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: { ...base, delivery: { ...(base['delivery'] as object), password: 'hunter2' } },
      });
      expect(secret.kind).toBe('S2_REJECTED');
      if (secret.kind !== 'S2_REJECTED') throw new Error('unreachable');
      expect(JSON.stringify(secret.reasons)).toContain('RAW_SECRET');

      const forged = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: {
          ...base,
          handoff: { ...(base['handoff'] as object), authority: 'AUTHORITATIVE_TRUTH' },
        },
      });
      expect(forged.kind).toBe('S2_REJECTED');

      const zeroTtl = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: { ...base, ttlMs: 0 },
      });
      expect(zeroTtl.kind).toBe('S2_REJECTED');

      const bigChunk = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'r',
        payload: { ...base, bytes: ['x'.repeat(4097)] },
      });
      expect(bigChunk.kind).toBe('S2_REJECTED');
    } finally {
      await core.stop();
    }
  });

  it('fails closed with a typed CORE_TRANSPORT rejection when the one Core authority is unreachable', async () => {
    const lane = createInstalledS2Lane({
      broker: createAuthBroker(),
      core: { host: '127.0.0.1', port: 9, installId: 'install-001', userId: 'user-001' },
      projectionWaitMs: 500,
    });
    const response = await lane.handle({
      kind: 'S2_ACQUIRE',
      requestId: 's2-nm-unreachable',
      payload: s2Acquire({ bytes: attachmentBytes(64) })['s2'] as Record<string, unknown>,
    });
    expect(response.kind).toBe('S2_REJECTED');
    if (response.kind !== 'S2_REJECTED') throw new Error('unreachable');
    expect(response.stage).toBe('CORE_TRANSPORT');
    expect(response.reasons[0]?.code).toBe('CORE_UNREACHABLE');
  });

  it('#176: a new user gesture converges to the SAME durable S2 terminal without duplicate work', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const bytes = attachmentBytes(32);
      const payload = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const first = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-1', payload });
      expect(first.kind).toBe('S2_RESULT');
      if (first.kind !== 'S2_RESULT') throw new Error('first terminal not projected');
      const acceptedBefore = core.runtime.writer.reader.workItems().length;

      // A different Native Messaging request id with the identical frozen
      // browser observation must read Core's terminal, not try revision 0.
      const second = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-2', payload });
      expect(second.kind).toBe('S2_RESULT');
      if (second.kind !== 'S2_RESULT') throw new Error('existing terminal not returned');
      expect(second.terminal).toEqual(first.terminal);
      expect(second.contractId).toBe(first.contractId);
      expect(core.runtime.writer.reader.workItems()).toHaveLength(acceptedBefore);
      const durableWork = core.runtime.writer.reader.workItems()[0]!;
      expect(core.runtime.recovery.classify(durableWork.workItemId).lifecycleClass).toBe(
        'ACCEPTED',
      );
    } finally {
      await core.stop();
    }
  });

  it('#176: resumes a journaled S2 chunk prefix through byte-identical Core staging', async () => {
    const core = await startedCore();
    try {
      const bytes = attachmentBytes(1_500_000);
      const payload = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const handoff = payload['handoff'] as Record<string, unknown>;
      const delivery = payload['delivery'] as Record<string, unknown>;
      const browserResponse = payload['browserResponse'] as Record<string, unknown>;
      const slabs = payload['bytes'] as string[];
      const ids = s2IdentityFor({
        provenanceKey: String(handoff['provenanceKey']),
        locatorUri: String(delivery['locatorUri']),
      });
      const identity = ids.contractId.slice('contract-s2-'.length);
      const snapshotId = `snapshot-s2-${identity}`;
      const submitted = seamCommand(core.runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: ids.contractId,
        correlation: { contractId: ids.contractId },
        asPeer: peer('BROWSER_EXTENSION'),
        payload: rawSingleResourceContract({
          contractId: ids.contractId,
          requestedTarget: ids.targetId,
          budgetProfile: profileWith({ maxBytes: 67_108_864 }),
        }),
      });
      expect(submitted.outcome).toBe('ACCEPTED');
      const count = Math.ceil(slabs.length / 224);
      expect(count).toBeGreaterThan(1);
      const first = seamCommand(core.runtime, {
        commandType: 'EXECUTE_S2_ACQUISITION',
        aggregateId: ids.contractId,
        expectedRevision: 1,
        correlation: { contractId: ids.contractId, snapshotId },
        asPeer: peer('BROWSER_EXTENSION'),
        payload: {
          snapshotId,
          memberId: `member-s2-${identity}`,
          artifactId: `artifact:s2:${identity}`,
          authorizationContextRef: 'authctx/installed-s2-lane',
          delivery,
          browserResponse,
          bytes: slabs.slice(0, 224),
          chunk: { index: 0, count },
        },
      });
      expect(first.outcome).toBe('ACCEPTED');
      expect(core.runtime.writer.reader.workItems()).toHaveLength(0);
      // The next fresh broker connection cannot submit a NEW contract at
      // revision 0; it must read current revision 2 and replay index 0.
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const result = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 's2-resume-new-gesture',
        payload,
      });
      expect(result.kind).toBe('S2_RESULT');
      if (result.kind !== 'S2_RESULT') throw new Error(JSON.stringify(result));
      expect((result.terminal as Record<string, unknown>)['requestFulfillment']).toBe('COMPLETE');
      expect(core.runtime.writer.reader.workItems()).toHaveLength(1);
      const durableWork = core.runtime.writer.reader.workItems()[0]!;
      expect(core.runtime.recovery.classify(durableWork.workItemId).bytesVerified).toBe(true);
    } finally {
      await core.stop();
    }
  });

  it('#176: changed S2 prefix bytes cannot splice into a durable staged stream', async () => {
    const core = await startedCore();
    try {
      const bytes = attachmentBytes(1_500_000);
      const original = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const handoff = original['handoff'] as Record<string, unknown>;
      const delivery = original['delivery'] as Record<string, unknown>;
      const response = original['browserResponse'] as Record<string, unknown>;
      const slabs = original['bytes'] as string[];
      const ids = s2IdentityFor({
        provenanceKey: String(handoff['provenanceKey']),
        locatorUri: String(delivery['locatorUri']),
      });
      const identity = ids.contractId.slice('contract-s2-'.length);
      const snapshotId = `snapshot-s2-${identity}`;
      const submit = seamCommand(core.runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: ids.contractId,
        correlation: { contractId: ids.contractId },
        asPeer: peer('BROWSER_EXTENSION'),
        payload: rawSingleResourceContract({
          contractId: ids.contractId,
          requestedTarget: ids.targetId,
          budgetProfile: profileWith({ maxBytes: 67_108_864 }),
        }),
      });
      expect(submit.outcome).toBe('ACCEPTED');
      const staged = seamCommand(core.runtime, {
        commandType: 'EXECUTE_S2_ACQUISITION',
        aggregateId: ids.contractId,
        expectedRevision: 1,
        correlation: { contractId: ids.contractId, snapshotId },
        asPeer: peer('BROWSER_EXTENSION'),
        payload: {
          snapshotId,
          memberId: `member-s2-${identity}`,
          artifactId: `artifact:s2:${identity}`,
          authorizationContextRef: 'authctx/installed-s2-lane',
          delivery,
          browserResponse: response,
          bytes: slabs.slice(0, 224),
          chunk: { index: 0, count: Math.ceil(slabs.length / 224) },
        },
      });
      expect(staged.outcome).toBe('ACCEPTED');
      const changed = Uint8Array.from(bytes);
      changed[0] = changed[0]! ^ 0xff;
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const again = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 's2-mismatch-gesture',
        payload: s2Acquire({ bytes: changed })['s2'] as Record<string, unknown>,
      });
      expect(again.kind).toBe('S2_REJECTED');
      if (again.kind !== 'S2_REJECTED') throw new Error('expected refusal');
      expect(again.stage).toBe('CORE_EXECUTE');
      expect(core.runtime.writer.reader.workItems()).toHaveLength(0);
    } finally {
      await core.stop();
    }
  });

  it('the broker session fails S2_ACQUIRE closed when no lane is configured; unknown s2 fields reject', async () => {
    const session = establishNativeHostSession({
      argv: ['node', 'host', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
      allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
      broker: createAuthBroker(),
    });
    expect(session.ok).toBe(true);
    if (!session.ok) throw new Error('unreachable');
    // R1/F04 wire shape: metadata frame without inline bytes (bytes cross as
    // bounded chunk frames); the lane is simply not configured here.
    const wireMeta = s2Acquire({ bytes: attachmentBytes(8) })['s2'] as Record<string, unknown>;
    delete wireMeta['bytes'];
    const response = await session.value.handleMessage({
      kind: 'S2_ACQUIRE',
      requestId: 's2-nm-0001',
      s2: { ...wireMeta, byteCount: 8 },
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('unreachable');
    // Deployment-level typed rejection: the lane is simply not configured.
    expect(response.value.kind).toBe('REJECTED');
    if (response.value.kind !== 'REJECTED') throw new Error('unreachable');
    expect(response.value.reasons[0]?.code).toBe('S2_LANE_UNAVAILABLE');

    const unknownField = await session.value.handleMessage({
      kind: 'S2_ACQUIRE',
      requestId: 'r',
      s2: { ...wireMeta, shell: 'exec' },
    });
    expect(unknownField.ok).toBe(false);
    if (unknownField.ok) throw new Error('unreachable');
    expect(unknownField.diagnostics[0]?.code).toBe('UNKNOWN_FIELD');
  });

  it('a content-script attempt to invoke the S2 lane directly stays impossible: the session is the only NM door', async () => {
    // Structural: the S2 command crosses ONLY via the decoded broker session
    // (origin-allow-listed). A raw forged frame without a session cannot be
    // processed; this documents that the content boundary has no lane path —
    // its messages never reach decodeBrokerCommand as commands because the
    // extension service worker only submits S2_ACQUIRE after its own
    // observation gate + explicit user decision.
    const session = establishNativeHostSession({
      argv: ['node', 'host'],
      allowedOrigins: [],
      broker: createAuthBroker(),
    });
    expect(session.ok).toBe(false);
  });

  it('revokes the capability when Core converges to an existing terminal (least authority)', async () => {
    const core = await startedCore();
    try {
      const broker = createAuthBroker();
      const lane = createInstalledS2Lane({
        broker,
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const bytes = attachmentBytes(32);
      const payload = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const first = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-a', payload });
      expect(first.kind).toBe('S2_RESULT');
      const before = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-b', payload });
      expect(before.kind).toBe('S2_RESULT');
      // Every capability the journeys issued is now dead (revoked), never
      // left ACTIVE in the broker after the journey ended.
      const refs = [first, before]
        .map((response) =>
          response.kind === 'S2_RESULT' ? response.authorizationContextRef : undefined,
        )
        .filter((ref): ref is string => ref !== undefined);
      for (const ref of refs) {
        const view = broker.inspect(ref);
        expect(view.ok ? view.value.status : 'REVOKED').toBe('REVOKED');
      }
      const journaled = broker.inspect('authctx/local/1@0');
      expect(journaled.ok ? journaled.value.status : 'REVOKED').toBe('REVOKED');
    } finally {
      await core.stop();
    }
  });

  it('a truthful execution failure (digest mismatch) returns the Core FAILED terminal to the extension', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const payload = s2Acquire({ bytes: attachmentBytes(999) })['s2'] as Record<string, unknown>;
      // Declare the digest of DIFFERENT bytes than delivered → Core truthfully
      // fails transfer validation (CORRUPT_BYTES terminal).
      (payload['delivery'] as Record<string, unknown>)['expectedSha256'] = sha256(
        attachmentBytes(128),
      );
      const response = await lane.handle({
        kind: 'S2_ACQUIRE',
        requestId: 'journey-fail',
        payload,
      });
      expect(response.kind).toBe('S2_RESULT');
      if (response.kind !== 'S2_RESULT') throw new Error('unreachable');
      const terminal = response.terminal as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
    } finally {
      await core.stop();
    }
  });

  it('R1/F01: the default journey declares no digest and still completes (selection provenance is the target anchor)', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const bytes = attachmentBytes(2048);
      const payload = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const delivery = payload['delivery'] as Record<string, unknown>;
      delete delivery['expectedSha256'];
      delete delivery['expectedContentTypePrefix'];
      delete delivery['expectedTotalBytes'];
      const response = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-r1', payload });
      expect(response.kind).toBe('S2_RESULT');
      if (response.kind !== 'S2_RESULT') throw new Error('unreachable');
      const terminal = response.terminal as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe(
        'ALL_PASSED',
      );
    } finally {
      await core.stop();
    }
  });

  it('R1/F04: a 1.5 MiB attachment crosses as bounded chunk commands and completes (the retired 512 KiB / single-frame bound is gone)', async () => {
    const core = await startedCore();
    try {
      const lane = createInstalledS2Lane({
        broker: createAuthBroker(),
        core: { host: core.host, port: core.port, installId: 'install-001', userId: 'user-001' },
      });
      const bytes = attachmentBytes(1_500_000);
      const payload = s2Acquire({ bytes })['s2'] as Record<string, unknown>;
      const delivery = payload['delivery'] as Record<string, unknown>;
      delete delivery['expectedSha256'];
      delete delivery['expectedTotalBytes'];
      const response = await lane.handle({ kind: 'S2_ACQUIRE', requestId: 'journey-big', payload });
      expect(response.kind).toBe('S2_RESULT');
      if (response.kind !== 'S2_RESULT') throw new Error('unreachable');
      const terminal = response.terminal as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      // Durable truth: exactly one accepted artifact with byte-identical content.
      const workItems = core.runtime.writer.reader.workItems();
      expect(workItems.length).toBe(1);
      const artifact = core.runtime.store.readFinalBytes(
        `artifact:s2:${createHash('sha256').update(`t42|f0|${ORIGIN}|obs-s2-0001\n${ORIGIN}/s2/private-attachment.bin`).digest('hex').slice(0, 24)}`,
      );
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      await core.stop();
    }
  });
});

// Silence unused import when helpers change shape (peer/seamCommand kept for
// future journey-level assertions).
void peer;
void seamCommand;
