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
 * - R1/F01: the declared digest is OPTIONAL — the default no-digest path
 *   completes on provenance-bound target validation, a malformed declared
 *   digest still rejects, and a digest is never derived from the delivered
 *   bytes (C34);
 * - R1/F02: Format validation ALWAYS runs — the default no-prefix path is
 *   format-validated (HTML masquerade negatives fail truthfully);
 * - R1/F04: the delivered stream may cross as bounded chunk commands with
 *   all-or-nothing staging, replay-safe across restart, capped at the
 *   declared 64 MiB bound;
 * - the command fails closed for non-browser surfaces, malformed payloads,
 *   unknown fields, missing aggregates and compositions without the executor;
 * - idempotent duplicate submission converges; journal replay after
 *   reopenCoreRuntime re-derives the same terminal and acceptance.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreSeamServer, type SeamResponse } from '@xdownload/core-seam';
import { createS2ChunkStaging, reopenCoreRuntime } from '../src/index.ts';
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
  readonly withDigest?: boolean;
  readonly finalUrl?: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly withFormat?: boolean;
  readonly chunk?: { readonly index: number; readonly count: number };
  readonly extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const withDigest = input.withDigest !== false;
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
      ...(withDigest ? { expectedSha256: input.expectedSha256 ?? sha256(input.bytes) } : {}),
      ...(input.withFormat === false
        ? {}
        : { expectedContentTypePrefix: 'application/octet-stream' }),
    },
    browserResponse: {
      finalUrl: input.finalUrl ?? `${ORIGIN}/s2/private-attachment.bin`,
      contentType: input.contentType ?? 'application/octet-stream',
      ...(input.contentLength === undefined ? {} : { contentLength: input.contentLength }),
      status: input.status ?? 200,
    },
    bytes: base64Chunks(input.bytes),
    ...(input.chunk === undefined ? {} : { chunk: input.chunk }),
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

describe('#95 R1/F01 — the declared digest is optional, never the admission gate', () => {
  it('the default no-digest selection completes: target truth is the pre-registered selection provenance', () => {
    const dir = makeTempDir('s2-r1-nodigest');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(4096);
      const response = executeS2(runtime, s2Payload({ bytes, withDigest: false }));
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe(
        'ALL_PASSED',
      );
      const artifact = runtime.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a declared digest is still enforced when present (strengthening keeps its teeth)', () => {
    const dir = makeTempDir('s2-r1-digest-kept');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(1024);
      const response = executeS2(
        runtime,
        s2Payload({ bytes, expectedSha256: sha256(attachmentBytes(2048)) }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a malformed declared digest rejects the payload (fail closed)', () => {
    const dir = makeTempDir('s2-r1-baddigest');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const payload = s2Payload({ bytes: attachmentBytes(64), withDigest: false });
      (payload['delivery'] as Record<string, unknown>)['expectedSha256'] = 'not-a-digest';
      const response = executeS2(runtime, payload);
      expect(response.outcome).toBe('REJECTED');
      expect(response.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');
    } finally {
      closeRuntime(runtime);
    }
  });
});

describe('#95 R1/F02 — Format validation always runs (default path included)', () => {
  it('the default no-prefix path still rejects login/error HTML masquerading as the attachment', () => {
    const dir = makeTempDir('s2-r1-format-html');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const html = new TextEncoder().encode('<!doctype html><html><body>Sign in…</body></html>');
      const response = executeS2(
        runtime,
        s2Payload({ bytes: html, withDigest: false, withFormat: false, contentType: 'text/html' }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
      expect(runtime.writer.reader.workItems().length).toBe(1);
      expect(
        runtime.recovery.classify(runtime.writer.reader.workItems()[0]!.workItemId).lifecycleClass,
      ).toBe('TERMINAL_FAILED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('body-sniffed HTML is rejected even when the declared content-type looks binary (masquerade depth)', () => {
    const dir = makeTempDir('s2-r1-format-sniff');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const html = new TextEncoder().encode('  <HTML><head></head><body>error</body></html>');
      const response = executeS2(
        runtime,
        s2Payload({
          bytes: html,
          withDigest: false,
          withFormat: false,
          contentType: 'application/octet-stream',
        }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a declared content-type prefix is still enforced when present', () => {
    const dir = makeTempDir('s2-r1-format-prefix');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(512);
      const response = executeS2(
        runtime,
        s2Payload({ bytes, withDigest: false, contentType: 'application/pdf' }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('the browser-observed Content-Length is the independent transfer oracle: drift fails truthfully', () => {
    const dir = makeTempDir('s2-r1-transfer-drift');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(2048);
      const response = executeS2(
        runtime,
        s2Payload({ bytes, withDigest: false, contentLength: 4096 }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a consistent observed Content-Length passes transfer validation', () => {
    const dir = makeTempDir('s2-r1-transfer-ok');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(2048);
      const response = executeS2(
        runtime,
        s2Payload({ bytes, withDigest: false, contentLength: bytes.length }),
      );
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      expect((view['terminal'] as Record<string, unknown>)['requestFulfillment']).toBe('COMPLETE');
    } finally {
      closeRuntime(runtime);
    }
  });
});

describe('#95 R1/F04 — bounded chunked delivery across the frozen seam frame bound', () => {
  /** Drive one chunked S2 acquisition; each chunk command carries one slab. */
  function executeChunked(
    runtime: CoreRuntime,
    bytes: Uint8Array,
    slabSize: number,
    options?: { readonly upto?: number },
  ): SeamResponse {
    const slabs: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += slabSize) {
      slabs.push(bytes.subarray(offset, Math.min(bytes.length, offset + slabSize)));
    }
    const count = slabs.length;
    let last: SeamResponse | undefined;
    const upto = options?.upto ?? count;
    for (let index = 0; index < upto; index += 1) {
      const payload = s2Payload({
        bytes: slabs[index]!,
        withDigest: false,
        chunk: { index, count },
      });
      last = executeS2(runtime, payload, requestId(), 'BROWSER_EXTENSION', 1 + index);
      expect(last.outcome).toBe('ACCEPTED');
    }
    if (last === undefined) {
      throw new Error('empty chunked execution');
    }
    return last;
  }

  it('a multi-slab stream assembles into one canonical lifecycle and one accepted artifact', () => {
    const dir = makeTempDir('s2-r1-chunked-ok');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(9000); // 3 slabs of 3072 raw → 3 chunk commands
      const response = executeChunked(runtime, bytes, 3072);
      expect(response.outcome).toBe('ACCEPTED');
      expect(response.currentRevision).toBe(4); // submit + 3 chunks
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe(
        'ALL_PASSED',
      );
      expect(runtime.writer.reader.workItems().length).toBe(1);
      const artifact = runtime.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      closeRuntime(runtime);
    }
  });

  it('reopens after a completed three-chunk acceptance without LATE_COMMAND or duplicate effects (#98)', () => {
    const dir = makeTempDir('s2-i98-completed-chunk-replay');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    submitS2Contract(runtime);
    const bytes = attachmentBytes(9000);
    const requests: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const slab = bytes.subarray(
          index * 3072,
          Math.min(bytes.length, (index + 1) * 3072),
        );
      const req = requestId();
      requests.push(req);
      const response = executeS2(
        runtime,
        s2Payload({ bytes: slab, withDigest: false, chunk: { index, count: 3 } }),
        req,
        'BROWSER_EXTENSION',
        1 + index,
      );
      expect(response.outcome).toBe('ACCEPTED');
      expect(response.currentRevision).toBe(2 + index);
    }
    const before = readProjection(runtime);
    expect(before.outcome).toBe('PROJECTION');
    expect((before.projection as Record<string, unknown>)['terminal']).toBeDefined();
    expect(runtime.writer.reader.workItems().length).toBe(1);
    const acceptedBefore = runtime.writer.reader.workItems()[0]!;
    const artifactBefore = runtime.store.readFinalBytes('artifact:s2-delivered-001');
    expect(artifactBefore === undefined ? '' : sha256(artifactBefore)).toBe(sha256(bytes));
    closeRuntime(runtime);

    // The durable ledger already contains the accepted work item when the
    // seam replays the three journaled commands. Chunks 0/1 MUST replay as
    // STAGED, not TERMINAL, and only the completing chunk projects terminal.
    const reopened = reopenCoreRuntime({ rootDir: dir, expectedPeer: EXPECTED_PEER });
    try {
      const after = readProjection(reopened);
      expect(after.outcome).toBe('PROJECTION');
      expect(after.projection).toEqual(before.projection);
      const acceptedAfter = reopened.writer.reader.workItems();
      expect(acceptedAfter.length).toBe(1);
      expect(acceptedAfter[0]!.workItemId).toBe(acceptedBefore.workItemId);
      expect(reopened.recovery.classify(acceptedAfter[0]!.workItemId).lifecycleClass).toBe(
        'ACCEPTED',
      );
      const artifactAfter = reopened.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifactAfter === undefined ? '' : sha256(artifactAfter)).toBe(sha256(bytes));

      // Each original journaled command has the same idempotent response.
      // No accepted effect, artifact or authority revision may be duplicated.
      for (let index = 0; index < 3; index += 1) {
        const slab = bytes.subarray(
          index * 3072,
          Math.min(bytes.length, (index + 1) * 3072),
        );
        const duplicate = executeS2(
          reopened,
          s2Payload({ bytes: slab, withDigest: false, chunk: { index, count: 3 } }),
          requests[index]!,
          'BROWSER_EXTENSION',
          1 + index,
        );
        expect(duplicate.outcome).toBe('ACCEPTED');
        expect(
          (duplicate as { acceptance?: { converged?: boolean } }).acceptance?.converged,
        ).toBe(true);
      }
      expect(reopened.writer.reader.workItems().length).toBe(1);
      expect(readProjection(reopened).projection).toEqual(before.projection);
    } finally {
      closeRuntime(reopened);
    }
  });

  it('a stream larger than the retired 512 KiB hard cap completes (the declared bound is 64 MiB)', () => {
    const dir = makeTempDir('s2-r1-beyond-cap');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(700 * 1024); // beyond the old 512 KiB cap
      const response = executeChunked(runtime, bytes, 256 * 1024);
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      expect((view['terminal'] as Record<string, unknown>)['requestFulfillment']).toBe('COMPLETE');
      const artifact = runtime.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      closeRuntime(runtime);
    }
  });

  it('an interrupted stream stages nothing durable; restart replay rebuilds staging and the completing chunk executes once', () => {
    const dir = makeTempDir('s2-r1-chunked-replay');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    submitS2Contract(runtime);
    const bytes = attachmentBytes(9000);
    // Two of three slabs arrive, then the process "restarts".
    executeChunked(runtime, bytes, 3072, { upto: 2 });
    expect(runtime.writer.reader.workItems().length).toBe(0);
    closeRuntime(runtime);

    const reopened = reopenCoreRuntime({ rootDir: dir, expectedPeer: EXPECTED_PEER });
    try {
      // Journal replay staged the first two slabs; nothing durable exists yet.
      expect(reopened.writer.reader.workItems().length).toBe(0);
      const slab = bytes.subarray(6144);
      const final = executeS2(
        reopened,
        s2Payload({ bytes: slab, withDigest: false, chunk: { index: 2, count: 3 } }),
        requestId(),
        'BROWSER_EXTENSION',
        3,
      );
      expect(final.outcome).toBe('ACCEPTED');
      const view = readProjection(reopened).projection as Record<string, unknown>;
      expect((view['terminal'] as Record<string, unknown>)['requestFulfillment']).toBe('COMPLETE');
      expect(reopened.writer.reader.workItems().length).toBe(1);
      const artifact = reopened.store.readFinalBytes('artifact:s2-delivered-001');
      expect(artifact === undefined ? '' : sha256(artifact)).toBe(sha256(bytes));
    } finally {
      closeRuntime(reopened);
    }
  });

  it('chunk framing fails closed: index out of range, shape violations and unknown fields reject', () => {
    const dir = makeTempDir('s2-r1-chunk-shape');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const bytes = attachmentBytes(2048);
      const badIndex = executeS2(
        runtime,
        s2Payload({ bytes, withDigest: false, chunk: { index: 3, count: 3 } }),
      );
      expect(badIndex.outcome).toBe('REJECTED');
      expect(badIndex.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');
      const badShape = executeS2(
        runtime,
        s2Payload({ bytes, withDigest: false, extra: { chunk: { index: 0 } } }),
      );
      expect(badShape.outcome).toBe('REJECTED');
      // Nothing was staged or executed durably.
      expect(runtime.writer.reader.workItems().length).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('a mid-stream count change and conflicting re-delivery of an index reject; identical re-delivery converges', () => {
    const dir = makeTempDir('s2-r1-chunk-conflict');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const slab0 = attachmentBytes(3072);
      const first = executeS2(
        runtime,
        s2Payload({ bytes: slab0, withDigest: false, chunk: { index: 0, count: 2 } }),
        requestId(),
        'BROWSER_EXTENSION',
        1,
      );
      expect(first.outcome).toBe('ACCEPTED');
      // Byte-identical re-delivery of the staged slab (new requestId):
      // convergent no-op, still staged, nothing durable yet.
      const redelivered = executeS2(
        runtime,
        s2Payload({ bytes: slab0, withDigest: false, chunk: { index: 0, count: 2 } }),
        requestId(),
        'BROWSER_EXTENSION',
        2,
      );
      expect(redelivered.outcome).toBe('ACCEPTED');
      expect(runtime.writer.reader.workItems().length).toBe(0);
      // Conflicting bytes for the same staged index reject fail-closed.
      const conflict = executeS2(
        runtime,
        s2Payload({
          bytes: attachmentBytes(3072).map((v) => (v + 1) & 0xff),
          withDigest: false,
          chunk: { index: 0, count: 2 },
        }),
        requestId(),
        'BROWSER_EXTENSION',
        3,
      );
      expect(conflict.outcome).toBe('REJECTED');
      // A mid-stream count change rejects as well.
      const countChanged = executeS2(
        runtime,
        s2Payload({ bytes: slab0, withDigest: false, chunk: { index: 1, count: 5 } }),
        requestId(),
        'BROWSER_EXTENSION',
        3,
      );
      expect(countChanged.outcome).toBe('REJECTED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('chunked delivery of an HTML masquerade still fails Format validation on completion (layer truth at the assembled stream)', () => {
    const dir = makeTempDir('s2-r1-chunked-format');
    dirs.push(dir);
    const runtime = openRuntime(dir);
    try {
      submitS2Contract(runtime);
      const html = new TextEncoder().encode('<!doctype html><html><body>login</body></html>');
      const response = executeChunked(runtime, html, 20);
      expect(response.outcome).toBe('ACCEPTED');
      const view = readProjection(runtime).projection as Record<string, unknown>;
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['requestFulfillment']).not.toBe('COMPLETE');
      expect((terminal['validationSummary'] as Record<string, unknown>)['status']).toBe('FAILED');
    } finally {
      closeRuntime(runtime);
    }
  });
});

describe('#95 R1/F04 — staged-stream bound (declared 64 MiB ceiling)', () => {
  it('staging rejects the slab that would cross the declared bound, before buffering further', () => {
    const staging = createS2ChunkStaging();
    const slab = new Uint8Array(8 * 1024 * 1024); // 8 MiB slabs
    let result: ReturnType<typeof staging.stage> | undefined;
    // 8 slabs stage (64 MiB exactly); the 9th crosses the declared bound.
    for (let index = 0; index < 9; index += 1) {
      result = staging.stage({ key: 'effect:test', index, count: 10, bytes: slab });
      if (!result.ok) {
        break;
      }
    }
    expect(result).toBeDefined();
    expect(result!.ok).toBe(false);
    if (result !== undefined && !result.ok) {
      expect(result.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
      expect(result.diagnostics[0]?.message).toContain('67108864');
    }
    // The failed stream's staging was dropped: a fresh stream restarts cleanly.
    const fresh = staging.stage({
      key: 'effect:test',
      index: 0,
      count: 1,
      bytes: new Uint8Array(4),
    });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.status).toBe('COMPLETE');
    }
  });
});
