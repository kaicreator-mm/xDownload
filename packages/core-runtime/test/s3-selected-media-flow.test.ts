/**
 * #150 S3 selected-media Core flow — the REAL restart-reconcile path: a
 * previous live process durably committed the contract, confirmed snapshot,
 * S3 candidate and execution intent (journal-before-effect), then died
 * before driving. `reopenCoreRuntime` replays the journal, rebuilds the
 * candidates/intents and re-drives the execution against a controlled local
 * HTTP fixture through the Core-owned supported-profile MediaPolicy.
 *
 * The seeded journal entries are exactly the decoded-envelope records
 * `handleCommand` writes (the in-memory seam suite proves the live wire);
 * seeding them simulates the crash-after-commit window honestly — replay
 * re-validates every authority gate on the way in.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { decodeAcquisitionContract, type AcquisitionContract } from '@xdownload/domain-contracts';
import type { S3CandidateRecord } from '@xdownload/core-seam';
import type { TerminalResult } from '@xdownload/domain-contracts';
import { driveS3SelectedMediaExecution } from '../src/s3-selected-media.ts';
import { reopenCoreRuntime } from '../src/runtime.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import type { CoreRuntime } from '../src/index.ts';
import {
  BUDGET_PROFILE,
  closeRuntime,
  EXPECTED_PEER,
  makeTempDir,
  openRuntime,
  removeTempDir,
  seamCommand,
} from './helpers.ts';

/** A minimal honest MP4-signatured container: size32 + 'ftyp' + 'isom' brand. */
function mp4Bytes(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(12 + body.length);
  new DataView(bytes.buffer).setUint32(0, 12 + body.length);
  bytes.set(new TextEncoder().encode('ftypisom'), 4);
  bytes.set(body, 12);
  return bytes;
}

const htmlBytes = new TextEncoder().encode(
  '<!doctype html><html><body>login page masquerading as media</body></html>',
);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function contractPayload(contractId: string): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: `target-${contractId}`,
    requestedScope: { kind: 'single_resource', targetId: `target-${contractId}` },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: false },
    automationMode: 'MANUAL_SELECTION',
    explorationPermission: 'NONE',
    budgetProfile: BUDGET_PROFILE,
    authorizationContextRef: 'authctx/s3-flow-test',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format', 'media'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: '2026-10-26T00:00:00Z',
  };
}

function snapshotPayloadOf(contractId: string, snapshotId: string, memberId: string): unknown {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    snapshotId,
    contractId,
    requestedScope: { kind: 'single_resource', targetId: `target-${contractId}` },
    continuationScope: { kind: 'NONE' },
    coverageTarget: {
      scopeKind: 'single_resource',
      scopeIdentityKey: `single_resource:target-${contractId}`,
      snapshotVersion: 1,
    },
    requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: [memberId] },
    selectedMemberIds: [memberId],
    authorizationContextRef: 'authctx/s3-flow-test',
    profileContextRef: 'profile/s3-flow-test-001',
    selectionClaims: [
      { kind: 'SINGLE', confirmationType: 'CONFIRM_RESOURCE_IDENTITY', memberRefs: [memberId] },
    ],
    sourceMarker: { system: 'xdownload-test', version: 'v0.1.0' },
    createdAt: '2026-10-26T00:00:00Z',
  };
}

/** One accepted-command journal record, exactly as `handleCommand` writes it. */
function acceptedEntry(input: {
  readonly commandType: 'CONFIRM_S3_CANDIDATE' | 'EXECUTE_S3_SELECTED_MEDIA';
  readonly aggregateId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly revision: number;
  readonly payload: unknown;
  readonly correlation: Record<string, string>;
}): string {
  const envelope = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    kind: 'command',
    commandType: input.commandType,
    peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
    requestId: input.requestId,
    aggregateId: input.aggregateId,
    expectedRevision: input.expectedRevision,
    correlation: input.correlation,
    issuedAt: '2026-10-26T00:00:00Z',
    payload: input.payload,
  };
  const response = {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    kind: 'response',
    inReplyTo: input.requestId,
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: input.requestId,
      aggregateId: input.aggregateId,
      revision: input.revision,
      converged: false,
    },
    currentRevision: input.revision,
  };
  return `${JSON.stringify({
    kind: 'COMMAND',
    envelope,
    response,
    payloadDigest: JSON.stringify(input.payload),
  })}\n`;
}

function candidateOf(
  locator: string,
  declaredHosts: readonly string[],
  overrides: Partial<S3CandidateRecord> = {},
): S3CandidateRecord {
  return {
    snapshotId: 's3snap-flow-001',
    memberId: 's3member-flow-001',
    variantKey: 'variant-720p',
    locatorUri: locator,
    declaredRedirectHosts: declaredHosts,
    mediaProfileId: 's3-media-mp4-v1',
    ...overrides,
  };
}

const roots: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

/**
 * Simulate the crash-after-commit predecessor: a live process accepted the
 * contract + snapshot, durably journaled the confirmed candidate and the
 * execution intent, then died before any drive. The reopen below replays
 * and re-drives through the real production reconcile.
 */
async function reopenWithS3Execution(input: {
  readonly contractId: string;
  readonly candidate: S3CandidateRecord;
}): Promise<CoreRuntime> {
  const root = makeTempDir('s3-media-flow');
  roots.push(root);
  const live = openRuntime(root);
  const contract = decodeAcquisitionContract(contractPayload(input.contractId));
  if (!contract.ok) {
    throw new Error(`fixture contract rejected: ${contract.diagnostics[0]?.message}`);
  }
  const submitted = seamCommand(live, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: input.contractId,
    payload: contract.value,
    expectedRevision: 0,
  });
  if (submitted.outcome !== 'ACCEPTED') {
    throw new Error(`submit rejected: ${JSON.stringify(submitted.diagnostics)}`);
  }
  const confirmed = seamCommand(live, {
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: input.contractId,
    payload: snapshotPayloadOf(
      input.contractId,
      input.candidate.snapshotId,
      input.candidate.memberId,
    ),
    expectedRevision: 1,
  });
  if (confirmed.outcome !== 'ACCEPTED') {
    throw new Error(`snapshot rejected: ${JSON.stringify(confirmed.diagnostics)}`);
  }
  closeRuntime(live);
  appendFileSync(
    join(root, 'seam-journal.jsonl'),
    acceptedEntry({
      commandType: 'CONFIRM_S3_CANDIDATE',
      aggregateId: input.contractId,
      requestId: 'seed-s3-confirm',
      expectedRevision: 2,
      revision: 3,
      payload: {
        ...input.candidate,
        selectionAttestation: {
          kind: 'EXPLICIT_CLI_GESTURE',
          interactionId: 'seed-challenge',
          displayTupleDigest: 'seed-digest',
          confirmedAt: '2026-10-26T00:00:30Z',
          expectedRevision: 2,
        },
      },
      correlation: { contractId: input.contractId, snapshotId: input.candidate.snapshotId },
    }),
  );
  appendFileSync(
    join(root, 'seam-journal.jsonl'),
    acceptedEntry({
      commandType: 'EXECUTE_S3_SELECTED_MEDIA',
      aggregateId: input.contractId,
      requestId: 'seed-s3-execute',
      expectedRevision: 3,
      revision: 4,
      payload: { snapshotId: input.candidate.snapshotId, memberId: input.candidate.memberId },
      correlation: { contractId: input.contractId, snapshotId: input.candidate.snapshotId },
    }),
  );
  return reopenCoreRuntime({ rootDir: root, expectedPeer: EXPECTED_PEER });
}

async function awaitTerminal(
  runtime: CoreRuntime,
  contractId: string,
  timeoutMs = 5_000,
): Promise<TerminalResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const terminal = runtime.seam.inspectProjection(contractId)?.terminal as
      TerminalResult | undefined;
    if (terminal !== undefined) {
      return terminal;
    }
    if (Date.now() > deadline) {
      throw new Error(`no terminal projected for ${contractId} within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function fixture(): Promise<ControlledHttpFixture> {
  const server = new ControlledHttpFixture();
  await server.start();
  fixtures.push(server);
  return server;
}

afterEach(async () => {
  for (const server of fixtures.splice(0)) {
    await server.stop();
  }
  for (const dir of roots.splice(0)) {
    removeTempDir(dir);
  }
});

describe('#150 S3 selected-media Core flow (restart reconcile)', () => {
  it('re-drives the durable intent to an accepted COMPLETE terminal', async () => {
    const server = await fixture();
    const bytes = mp4Bytes('s3-flow-happy-path');
    server.serveFile('/media/clip_01.mp4', { body: bytes, contentType: 'video/mp4' });
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-flow-001',
      candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host]),
    });
    try {
      const terminal = await awaitTerminal(runtime, 'contract-s3-flow-001');
      expect(terminal.requestFulfillment).toBe('COMPLETE');
      expect(terminal.validationSummary.status).toBe('ALL_PASSED');
      expect(server.requests).toHaveLength(1);
      const artifactId = `s3artifact:contract-s3-flow-001:s3snap-flow-001:s3member-flow-001`;
      expect(runtime.store.observe(artifactId).observedDigest).toBe(sha256(bytes));
      // The witness resolved through the declared delivery graph on the
      // conservative provenance basis.
      const witness = runtime.seam.targetWitnessFor('contract-s3-flow-001');
      expect(witness?.status).toBe('RESOLVED');
      expect(witness?.certaintyClass).toBe('PROBATIVE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails Media validation truthfully on HTML masquerading as media', async () => {
    const server = await fixture();
    server.serveFile('/media/clip_01.mp4', { body: htmlBytes, contentType: 'video/mp4' });
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-media-001',
      candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host]),
    });
    try {
      const terminal = await awaitTerminal(runtime, 'contract-s3-media-001');
      expect(terminal.requestFulfillment).not.toBe('COMPLETE');
      expect(terminal.stopReason).not.toBe('NONE');
      const artifactId = `s3artifact:contract-s3-media-001:s3snap-flow-001:s3member-flow-001`;
      expect(runtime.store.observe(artifactId).phase).not.toBe('ACCEPTED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('enforces the user byte constraint as a rejection without a DECISIVE basis', async () => {
    const server = await fixture();
    const bytes = mp4Bytes('s3-constraint-bytes');
    server.serveFile('/media/clip_01.mp4', { body: bytes, contentType: 'video/mp4' });
    const wrongConstraint = sha256(mp4Bytes('different-bytes'));
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-constraint-001',
      candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host], {
        byteConstraintSha256: wrongConstraint,
      }),
    });
    try {
      const terminal = await awaitTerminal(runtime, 'contract-s3-constraint-001');
      expect(terminal.requestFulfillment).not.toBe('COMPLETE');
      const artifactId = `s3artifact:contract-s3-constraint-001:s3snap-flow-001:s3member-flow-001`;
      expect(runtime.store.observe(artifactId).phase).not.toBe('ACCEPTED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('rejects an undeclared redirect host before any acceptance', async () => {
    const origin = await fixture();
    const other = new ControlledHttpFixture();
    await other.start();
    fixtures.push(other);
    other.serveFile('/media/clip_01.mp4', {
      body: mp4Bytes('s3-redirect-bytes'),
      contentType: 'video/mp4',
    });
    origin.redirect('/media/clip_01.mp4', other.uri('/media/clip_01.mp4'));
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-redirect-001',
      candidate: candidateOf(origin.uri('/media/clip_01.mp4'), [new URL(origin.baseUri).host]),
    });
    try {
      const terminal = await awaitTerminal(runtime, 'contract-s3-redirect-001');
      expect(terminal.requestFulfillment).not.toBe('COMPLETE');
      const witness = runtime.seam.targetWitnessFor('contract-s3-redirect-001');
      expect(witness?.status).toBe('PROVENANCE_UNPROVEN');
      expect(witness?.unprovenReason).toBe('LOCATOR_SUBSTITUTION');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('follows a redirect inside the declared delivery graph to COMPLETE', async () => {
    const origin = await fixture();
    const cdn = new ControlledHttpFixture();
    await cdn.start();
    fixtures.push(cdn);
    cdn.serveFile('/media/clip_01.mp4', {
      body: mp4Bytes('s3-cdn-bytes'),
      contentType: 'video/mp4',
    });
    origin.redirect('/media/clip_01.mp4', cdn.uri('/media/clip_01.mp4'));
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-cdn-001',
      candidate: candidateOf(origin.uri('/media/clip_01.mp4'), [
        new URL(origin.baseUri).host,
        new URL(cdn.baseUri).host,
      ]),
    });
    try {
      const terminal = await awaitTerminal(runtime, 'contract-s3-cdn-001');
      expect(terminal.requestFulfillment).toBe('COMPLETE');
      const witness = runtime.seam.targetWitnessFor('contract-s3-cdn-001');
      expect(witness?.status).toBe('RESOLVED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('never re-downloads an already-terminal execution (durable truth only)', async () => {
    const server = await fixture();
    const bytes = mp4Bytes('s3-replay-bytes');
    server.serveFile('/media/clip_01.mp4', { body: bytes, contentType: 'video/mp4' });
    const runtime = await reopenWithS3Execution({
      contractId: 'contract-s3-replay-001',
      candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host]),
    });
    try {
      await awaitTerminal(runtime, 'contract-s3-replay-001');
      const requestsAfterFirst = server.requests.length;
      const contract = decodeAcquisitionContract(contractPayload('contract-s3-replay-001'));
      if (!contract.ok) {
        throw new Error('fixture contract rejected');
      }
      const again = await driveS3SelectedMediaExecution(runtime, {
        aggregateId: 'contract-s3-replay-001',
        contract: contract.value as AcquisitionContract,
        candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host]),
      });
      expect(again.ok).toBe(true);
      expect(server.requests.length).toBe(requestsAfterFirst);
      const terminal = runtime.seam.inspectProjection('contract-s3-replay-001')?.terminal as
        TerminalResult | undefined;
      expect(terminal?.requestFulfillment).toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails closed before any transfer when the profile is absent from the registry', async () => {
    const root = makeTempDir('s3-media-flow');
    roots.push(root);
    const runtime = openRuntime(root);
    try {
      const contract = decodeAcquisitionContract(contractPayload('contract-s3-profile-001'));
      if (!contract.ok) {
        throw new Error('fixture contract rejected');
      }
      const submitted = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-s3-profile-001',
        payload: contract.value,
        expectedRevision: 0,
      });
      expect(submitted.outcome).toBe('ACCEPTED');
      const server = await fixture();
      const result = await driveS3SelectedMediaExecution(runtime, {
        aggregateId: 'contract-s3-profile-001',
        contract: contract.value as AcquisitionContract,
        candidate: candidateOf(server.uri('/media/clip_01.mp4'), [new URL(server.baseUri).host], {
          mediaProfileId: 's3-media-mkv-v9',
        }),
      });
      expect(result.ok).toBe(false);
      expect(result.ok === true || result.diagnostics?.[0]?.code).toBe('MEDIA_POLICY_REQUIRED');
      expect(server.requests).toHaveLength(0);
    } finally {
      closeRuntime(runtime);
    }
  });
});
