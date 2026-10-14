/**
 * #101 P2-1 — the direct adapter's transfer cancellation/abort checkpoint.
 *
 * A fired `AbortSignal` tears down the in-flight request/body stream at once
 * (no lingering socket) and terminates the attempt with a truthful
 * `USER_CANCELLED` outcome: partial bytes stay partial, nothing is ever
 * projected COMPLETED across the checkpoint, and the budget ledger only
 * carries what actually arrived.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import { directRequest, payload, sha256, transferProfile } from './helpers/fixtures.ts';

let fixture: ControlledHttpFixture;
let baseUri: string;

beforeAll(async () => {
  fixture = new ControlledHttpFixture();
  baseUri = await fixture.start();
});

afterAll(async () => {
  await fixture.stop();
});

const FULL = payload(100);

describe('transfer cancellation checkpoint (#101 P2-1)', () => {
  it('a pre-aborted signal never opens a request and reports a truthful USER_CANCELLED stop', async () => {
    let requests = 0;
    fixture.on('/pre-aborted.bin', () => {
      requests += 1;
    });
    const controller = new AbortController();
    controller.abort();
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const value = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(fixture.baseUri ?? baseUri, '/pre-aborted.bin', FULL),
        signal: controller.signal,
      }),
    );
    expect(value.reason).toBe('USER_CANCELLED');
    expect(value.receivedBytes).toBe(0);
    expect(value.allApplicableValidationPassed).toBe(false);
    expect(value.terminalResult.stopReason).toBe('USER_CANCELLED');
    expect(value.terminalResult.selectionAcquisition).toBe('CANCELLED');
    expect(value.terminalResult.requestFulfillment).toBe('UNSATISFIED');
    expect(requests).toBe(0);
  });

  it('aborting mid-body tears the socket down and keeps the arrived bytes partial', async () => {
    let connectionClosed = false;
    fixture.on('/hang.bin', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': '100',
      });
      response.write(FULL.subarray(0, 30));
      response.on('close', () => {
        connectionClosed = true;
      });
      // Never end: the transfer hangs after the first chunk.
    });
    const controller = new AbortController();
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const pending = adapter.acquire({
      ...directRequest(baseUri, '/hang.bin', FULL),
      signal: controller.signal,
    });
    // Wait until the attempt is inside the hung body read, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connectionClosed).toBe(false);
    controller.abort();
    const value = unwrapOrThrow(await pending);

    expect(value.reason).toBe('USER_CANCELLED');
    expect(value.receivedBytes).toBe(30);
    // The arrived prefix is carried as partial bytes — never a completed
    // body, never a fabricated COMPLETED.
    expect(value.bytes?.byteLength).toBe(30);
    expect(value.allApplicableValidationPassed).toBe(false);
    expect(value.terminalResult.stopReason).toBe('USER_CANCELLED');
    expect(value.terminalResult.requestFulfillment).toBe('PARTIAL');
    expect(value.terminalResult.selectionAcquisition).toBe('PARTIAL');
    // No lingering socket: the server observed the client teardown.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectionClosed).toBe(true);
  });

  it('the target evidence basis/certainty pair follows the C34 rule on every outcome', async () => {
    fixture.serveFile('/basis.bin', { body: FULL, etag: '"basis"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const decisive = unwrapOrThrow(
      await adapter.acquire(directRequest(baseUri, '/basis.bin', FULL)),
    );
    expect(decisive.reason).toBe('COMPLETED');
    expect(decisive.targetBasis).toBe('PUBLISHED_SHA256');

    const probative = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(baseUri, '/basis.bin', FULL, { omitExpectedSha256: true }),
      }),
    );
    expect(probative.reason).toBe('COMPLETED');
    expect(probative.targetBasis).toBe('REQUESTED_LOCATOR_PROVENANCE');
    // The typed Target evidence names the basis and keeps the provenance
    // claim probative — never decisive publisher-byte truth (C34).
    const targetEvidence = probative.evidence.filter(
      (record) =>
        record.claimType === 'RESOURCE_IDENTITY' && record.claimSubject.kind === 'LOGICAL_TARGET',
    );
    expect(targetEvidence.length).toBeGreaterThan(0);
    expect(targetEvidence.every((record) => record.certaintyClass === 'PROBATIVE')).toBe(true);
    expect(
      targetEvidence.every((record) =>
        record.provenance.sourceIdentity.includes('REQUESTED_LOCATOR_PROVENANCE'),
      ),
    ).toBe(true);
    expect(sha256(FULL)).toBeDefined();
  });
});
