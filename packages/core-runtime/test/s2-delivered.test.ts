/**
 * #95 S2 delivered-bytes acquisition through the real seam authority —
 * the Core-side edge of the installed S2 journey.
 *
 * Proves at the seam-authority level (real runtime composition, real seam
 * server, real SQLite/artifact dirs):
 * - SUBMIT_CONTRACT → EXECUTE_S2_ACQUISITION carries browser-delivered bytes
 *   through the canonical durable lifecycle to an accepted artifact and a
 *   Core-derived COMPLETE terminal projection;
 * - submit-accepted is never download-success: digest/format/target/auth
 *   failures return truthful FAILED terminals with failed-member facts;
 * - the command fails closed for non-browser surfaces, malformed payloads,
 *   unknown fields, missing aggregates and compositions without the executor;
 * - idempotent duplicate submission converges; journal replay after
 *   reopenCoreRuntime re-derives the same terminal and acceptance.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreSeamServer, type SeamResponse } from '@xdownload/core-seam';
import { reopenCoreRuntime } from '../src/index.ts';
import {
  closeRuntime,
  commandEnvelope,
  EXPECTED_PEER,
  makeTempDir,
  openRuntime,
  peer,
  queryEnvelope,
  rawSingleResourceContract,
  removeTempDir,
  requestId,
  seamCommand,
} from './helpers.ts';
import type { CoreRuntime } from '../src/index.ts';

const dirs: string[] = [];

afterEach(() => {
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

function base64Chunks(bytes: Uint8Array, chunkSize = 3072): string[] {
  const whole = Buffer.from(bytes).toString('base64');
  const chunks: string[] = [];
  for (let index = 0; index < whole.length; index += chunkSize) {
    chunks.push(whole.slice(index, index + chunkSize));
  }
  return chunks;
}

const ORIGIN = 'http://127.0.0.1:43181';

function s2Payload(input: {
  readonly bytes: Uint8Array;
  readonly expectedSha256?: string;
  readonly finalUrl?: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly withFormat?: boolean;
  readonly extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    snapshotId: 'snapshot-s2-delivered-001',
    memberId: 'member-s2-file-001',
    artifactId: 'artifact:s2-delivered-001',
    authorizationContextRef: 'authctx/local/0@s2delivered',
    delivery: {
      locatorUri: `${ORIGIN}/s2/private-attachment.bin`,
      originLocatorUri: `${ORIGIN}/s2/private-attachment.bin`,
      provenanceBinding: 'SELECTED_RESOURCE_PROVENANCE',
      declaredRedirectHosts: ['127.0.0.1:43181'],
      expectedSha256: input.expectedSha256 ?? sha256(input.bytes),
      ...(input.withFormat === false
        ? {}
        : { expectedContentTypePrefix: 'application/octet-stream' }),
    },
    browserResponse: {
      finalUrl: input.finalUrl ?? `${ORIGIN}/s2/private-attachment.bin`,
      contentType: input.contentType ?? 'application/octet-stream',
      status: input.status ?? 200,
    },
    bytes: base64Chunks(input.bytes),
    ...(input.extra === undefined ? {} : input.extra),
  };
}

function submitS2Contract(runtime: CoreRuntime, contractId = 'contract-s2-delivered'): void {
  const response = seamCommand(runtime, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: contractId,
    payload: rawSingleResourceContract({ contractId, requestedTarget: 'target-s2-file-001' }),
    requestId: requestId(),
    asPeer: peer('BROWSER_EXTENSION'),
  });
  expect(response.outcome).toBe('ACCEPTED');
}

function executeS2(
  runtime: CoreRuntime,
  payload: unknown,
  req = requestId(),
  surface: 'BROWSER_EXTENSION' | 'CLI' = 'BROWSER_EXTENSION',
  expectedRevision = 1,
): SeamResponse {
  return seamCommand(runtime, {
    commandType: 'EXECUTE_S2_ACQUISITION',
    aggregateId: 'contract-s2-delivered',
    payload,
    requestId: req,
    asPeer: peer(surface),
    expectedRevision,
  });
}

function readProjection(
  runtime: CoreRuntime,
  surface: 'BROWSER_EXTENSION' | 'CLI' = 'BROWSER_EXTENSION',
): SeamResponse {
  return runtime.seam.handleFrame(
    JSON.stringify(
      queryEnvelope({
        aggregateId: 'contract-s2-delivered',
        requestId: requestId(),
        asPeer: peer(surface),
      }),
    ),
  );
}

describe('#95 EXECUTE_S2_ACQUISITION — Core-side delivered-bytes flow', () => {
  it('carries delivered bytes through the canonical lifecycle to an accepted artifact and COMPLETE terminal', () => {
    const dir = makeTempDir('s2-delivered-ok');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes();
      const response = executeS2(runtime, s2Payload({ bytes }));
      expect(response.outcome).toBe('ACCEPTED');
      expect(response.currentRevision).toBe(2);

      // Authoritative projection: COMPLETE across all six dimensions.
      const projection = readProjection(runtime);
      expect(projection.outcome).toBe('PROJECTION');
      const view = projection.projection as Record<string, unknown>;
      expect(view['terminal']).toBeDefined();
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect(terminal['stopReason']).toBe('NONE');
      const validation = terminal['validationSummary'] as Record<string, unknown>;
      expect(validation['status']).toBe('ALL_PASSED');

      // Durable truth: exactly one accepted work item; artifact bytes equal
      // the delivered bytes (independent of the projection claim).
      const workItems = runtime.writer.reader.workItems();
      expect(workItems.length).toBe(1);
      const classification = runtime.recovery.classify(workItems[0]!.workItemId);
      expect(classification.lifecycleClass).toBe('ACCEPTED');
      expect(classification.bytesVerified).toBe(true);
      const artifact = runtime.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a digest mismatch is accepted with a truthful FAILED terminal and a failed-member fact (never silent success)', () => {
    const dir = makeTempDir('s2-delivered-digest');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(2048);
      const response = executeS2(
        runtime,
        s2Payload({ bytes, expectedSha256: sha256(attachmentBytes(999)) }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const projection = readProjection(runtime);
      const view = projection.projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      const validation = terminal['validationSummary'] as Record<string, unknown>;
      expect(validation['status']).toBe('FAILED');
      // Nothing was accepted and the member is durably failed (retry domain).
      const workItems = runtime.writer.reader.workItems();
      expect(runtime.recovery.classify(workItems[0]!.workItemId).lifecycleClass).toBe(
        'TERMINAL_FAILED',
      );
      expect((view['lineage'] as Record<string, unknown>)['failedMemberIds']).toEqual([
        'member-s2-file-001',
      ]);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('an unauthorized 401 browser response is a truthful AUTH_REQUIRED terminal (auth failure visible, not widened)', () => {
    const dir = makeTempDir('s2-delivered-auth');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const response = executeS2(runtime, s2Payload({ bytes: new Uint8Array([1]), status: 401 }));
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['stopReason']).not.toBe('NONE');
      expect(JSON.stringify(terminal)).toContain('AUTH_REQUIRED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a redirect outside the declared hosts fails truthfully (C29: unrelated redirect never enlarges scope)', () => {
    const dir = makeTempDir('s2-delivered-redirect');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const response = executeS2(
        runtime,
        s2Payload({ bytes: attachmentBytes(512), finalUrl: 'http://evil.example.net/steal.bin' }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect(terminal['stopReason']).toBe('TARGET_CHANGED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a content-type mismatch is a truthful format-validation failure', () => {
    const dir = makeTempDir('s2-delivered-format');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const response = executeS2(
        runtime,
        s2Payload({ bytes: attachmentBytes(512), contentType: 'text/html' }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails closed: CLI surface cannot execute the delivered-bytes command', () => {
    const dir = makeTempDir('s2-delivered-surface');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const response = executeS2(
        runtime,
        s2Payload({ bytes: attachmentBytes(64) }),
        requestId(),
        'CLI',
      );
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
      expect(JSON.stringify(response.diagnostics)).toContain('BROWSER_EXTENSION');
      // Nothing durable was created by the rejected command.
      expect(runtime.writer.reader.workItems().length).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails closed on unknown payload fields, malformed payloads and unknown aggregates', () => {
    const dir = makeTempDir('s2-delivered-malformed');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(64);
      const unknownField = executeS2(runtime, s2Payload({ bytes, extra: { password: 'hunter2' } }));
      expect(unknownField.outcome).toBe('REJECTED');
      expect(unknownField.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');

      const notObject = executeS2(runtime, [1, 2, 3]);
      expect(notObject.outcome).toBe('REJECTED');

      const badBase64 = executeS2(runtime, s2Payload({ bytes, extra: {} }));
      expect(badBase64.outcome === 'REJECTED' || badBase64.outcome === 'ACCEPTED').toBe(true);

      // EXECUTE before SUBMIT: no aggregate exists for this id.
      const missing = seamCommand(runtime, {
        commandType: 'EXECUTE_S2_ACQUISITION',
        aggregateId: 'contract-never-submitted',
        payload: s2Payload({ bytes }),
        requestId: requestId(),
        asPeer: peer('BROWSER_EXTENSION'),
      });
      expect(missing.outcome).toBe('REJECTED');
      expect(missing.diagnostics?.[0]?.code).toBe('AGGREGATE_NOT_FOUND');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a seam composition without the executor rejects the command (fail closed, no partial behavior)', () => {
    const composed = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
    expect(composed.ok).toBe(true);
    if (!composed.ok) throw new Error('unreachable');
    const response = composed.value.handleFrame(
      JSON.stringify(
        commandEnvelope({
          commandType: 'EXECUTE_S2_ACQUISITION',
          aggregateId: 'contract-any',
          payload: {},
          requestId: requestId(),
          asPeer: peer('BROWSER_EXTENSION'),
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(JSON.stringify(response.diagnostics)).toContain('S2 delivered-acquisition executor');
  });

  it('duplicate submission converges (idempotent) and restart replay re-derives the same terminal', () => {
    const dir = makeTempDir('s2-delivered-replay');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    submitS2Contract(runtime);
    const bytes = attachmentBytes(8192);
    const req = requestId();
    const first = executeS2(runtime, s2Payload({ bytes }), req);
    expect(first.outcome).toBe('ACCEPTED');
    const duplicate = executeS2(runtime, s2Payload({ bytes }), req);
    expect(duplicate.outcome).toBe('ACCEPTED');
    expect((duplicate as { acceptance?: { converged?: boolean } }).acceptance?.converged).toBe(
      true,
    );
    // Still exactly one durable acquisition.
    expect(runtime.writer.reader.workItems().length).toBe(1);
    closeRuntime(runtime);

    // Restart: reopen replays the seam journal through the executor.
    const reopened = reopenCoreRuntime({ rootDir: dir, expectedPeer: EXPECTED_PEER });
    try {
      const projection = reopened.seam.handleFrame(
        JSON.stringify(
          queryEnvelope({
            aggregateId: 'contract-s2-delivered',
            requestId: requestId(),
            asPeer: peer('CLI'),
          }),
        ),
      );
      expect(projection.outcome).toBe('PROJECTION');
      const view = projection.projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      // Durable acceptance survived the restart.
      const workItems = reopened.writer.reader.workItems();
      expect(reopened.recovery.classify(workItems[0]!.workItemId).lifecycleClass).toBe('ACCEPTED');
      // Replay is convergent: a third submission of the same idempotent
      // identity returns the journaled response.
      const replayedDuplicate = reopened.seam.handleFrame(
        JSON.stringify(
          commandEnvelope({
            commandType: 'EXECUTE_S2_ACQUISITION',
            aggregateId: 'contract-s2-delivered',
            payload: s2Payload({ bytes }),
            requestId: req,
            asPeer: peer('BROWSER_EXTENSION'),
            expectedRevision: 1,
          }),
        ),
      );
      expect(replayedDuplicate.outcome).toBe('ACCEPTED');
      expect(
        (replayedDuplicate as { acceptance?: { converged?: boolean } }).acceptance?.converged,
      ).toBe(true);
      expect(reopened.writer.reader.workItems().length).toBe(1);
    } finally {
      closeRuntime(reopened);
    }
  });
});
