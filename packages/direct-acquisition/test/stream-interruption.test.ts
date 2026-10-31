/** T03 regression: a body read error is not normal EOF when length is unknown. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import { directRequest, payload, transferProfile } from './helpers/fixtures.ts';

describe('stream interruption without declared length', () => {
  const full = payload(100);
  let fixture: ControlledHttpFixture;
  let baseUri: string;

  beforeAll(async () => {
    fixture = new ControlledHttpFixture();
    baseUri = await fixture.start();
  });

  afterAll(async () => {
    await fixture.stop();
  });

  it('keeps a reset after partial bytes incomplete without a length or digest anchor', async () => {
    fixture.on('/reset-without-length.bin', (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      response.write(Buffer.from(full.subarray(0, 40)), () => {
        response.socket?.destroy();
      });
    });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/reset-without-length.bin', full, {
          omitExpectedSha256: true,
        }),
      ),
    );

    expect(outcome.reason).toBe('TRUNCATED');
    expect(outcome.receivedBytes).toBe(40);
    expect(outcome.validations.find((check) => check.layer === 'transfer')).toMatchObject({
      passed: false,
      code: 'STREAM_INTERRUPTED',
    });
    expect(outcome.terminalResult.requestFulfillment).toBe('PARTIAL');
    expect(outcome.terminalResult.selectionAcquisition).not.toBe('COMPLETE');
  });
});
