/**
 * TEST_MATRIX suites `strong-and-no-validators` and
 * `validator-change-and-range-support` (frozen L2 U5): validated resume via
 * strong validator/If-Range, safe restart without usable validators, never
 * appending across a validator change, and budget-aware ranged resume.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeEvidenceRecord, unwrapOrThrow } from '@xdownload/domain-contracts';
import { assertValidatesRequiredLayer } from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import type { PartialTransferState } from '../src/index.ts';
import type { EvidenceRecord } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import {
  directRequest,
  effectIdOf,
  payload,
  targetIdOf,
  transferProfile,
} from './helpers/fixtures.ts';

let fixture: ControlledHttpFixture;
let baseUri: string;

beforeAll(async () => {
  fixture = new ControlledHttpFixture();
  baseUri = await fixture.start();
});

beforeEach(() => {
  fixture.clearRequests();
});

afterAll(async () => {
  await fixture.stop();
});

const FULL = payload(100);
const PREFIX = FULL.subarray(0, 40);

function carriedPartial(
  identity: PartialTransferState['identity'],
  bytes: Uint8Array,
): PartialTransferState {
  return {
    bytes,
    receivedBytes: bytes.byteLength,
    identity,
    effectId: effectIdOf('effect-001'),
    targetId: targetIdOf('target-file-001'),
  };
}

describe('strong-and-no-validators: validated resume via If-Range (U5)', () => {
  it('strong validator present enables validated resume: ranged If-Range request, append at offset, same lineage', async () => {
    fixture.serveFile('/strong.bin', { body: FULL, etag: '"v1"' });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, maxRetryTransferRequests: 5 }),
    );
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/strong.bin', FULL, {
        effectId: 'effect-001',
        attempt: 1,
        expectedTotalBytes: 100,
      }),
      resumeFrom: carriedPartial({ strongETag: '"v1"' }, PREFIX),
    };
    const resumed = unwrapOrThrow(await adapter.acquire(request));

    expect(resumed.resumeDecision).toEqual({
      kind: 'VALIDATED_RESUME',
      offsetBytes: 40,
      strongETag: '"v1"',
    });
    const ranged = fixture.requests.at(-1);
    expect(ranged?.range).toBe('bytes=40-');
    expect(ranged?.ifRange).toBe('"v1"');
    expect(resumed.bytes).toEqual(FULL);
    expect(resumed.receivedBytes).toBe(100);
    expect(resumed.reason).toBe('COMPLETED');
    expect(resumed.allApplicableValidationPassed).toBe(true);
    expect(resumed.terminalResult.requestFulfillment).toBe('COMPLETE');
    expect(resumed.terminalResult.selectionAcquisition).toBe('COMPLETE');
    expect(resumed.terminalResult.stopReason).toBe('NONE');
    expect(resumed.terminalResult.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 3,
      failedCount: 0,
    });
    // Canonical evidence: decodable records with a layer-validating transfer oracle.
    for (const record of resumed.evidence) {
      const decoded: EvidenceRecord = unwrapOrThrow(decodeEvidenceRecord({ ...record }));
      expect(decoded.evidenceId.length).toBeGreaterThan(0);
    }
    const transferRecord = resumed.evidence.find((record) => record.claimType === 'TRANSFER');
    expect(transferRecord).toBeDefined();
    if (transferRecord !== undefined) {
      expect(assertValidatesRequiredLayer(transferRecord, 'transfer').ok).toBe(true);
    }
    // Retry request budget consumed through the authoritative seam, not a private ledger.
    expect(ledger.transferRequestsReported).toBe(0);
    expect(ledger.remaining().transfer.perLimit['retryTransferRequests']).toBe(4);
  });
});

describe('strong-and-no-validators: no usable validator forbids append', () => {
  it('no validator at all: safe restart from zero on the same lineage, never append', async () => {
    fixture.serveFile('/no-validator.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/no-validator.bin', FULL, {
        effectId: 'effect-001',
        attempt: 1,
      }),
      resumeFrom: carriedPartial({}, PREFIX),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(outcome.resumeDecision).toEqual({ kind: 'SAFE_RESTART', reason: 'NO_STRONG_VALIDATOR' });
    const only = fixture.requests.at(-1);
    expect(only?.range).toBeUndefined();
    expect(only?.ifRange).toBeUndefined();
    // Fresh 100 bytes replace the carried 40 — no 140-byte unsafe append.
    expect(outcome.bytes).toEqual(FULL);
    expect(outcome.bytes?.byteLength).toBe(100);
    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.effectId).toBe('effect-001');
  });

  it('weak-only validator is not sufficient representation identity for append', async () => {
    fixture.serveFile('/weak.bin', { body: FULL, etag: 'W/"v1"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/weak.bin', FULL, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: carriedPartial({ weakETag: 'W/"v1"' }, PREFIX),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(outcome.resumeDecision).toEqual({ kind: 'SAFE_RESTART', reason: 'NO_STRONG_VALIDATOR' });
    expect(fixture.requests.at(-1)?.range).toBeUndefined();
    expect(outcome.bytes).toEqual(FULL);
  });
});

describe('strong-and-no-validators: ambiguous identity fails closed', () => {
  it('unsolicited 206 with no validator is ambiguous and fails closed instead of guessing', async () => {
    fixture.serveUnsolicited206('/ambiguous.bin', FULL);
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/ambiguous.bin', FULL, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('UNSUPPORTED_RESPONSE');
    expect(outcome.bytes).toBeUndefined();
    expect(outcome.allApplicableValidationPassed).toBe(false);
    const transfer = outcome.validations.find((check) => check.layer === 'transfer');
    expect(transfer?.passed).toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('UNSATISFIED');
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
    expect(outcome.terminalResult.validationSummary.status).toBe('FAILED');
  });

  it('malformed identity anchor rejects the request before any transfer', async () => {
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);
    const before = fixture.requests.length;

    const rejected = await adapter.acquire({
      ...directRequest(baseUri, '/never.bin', FULL),
      expectedSha256: 'not-a-digest',
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe('MALFORMED_REQUIRED_FIELD');
    }
    expect(fixture.requests.length).toBe(before);
  });
});

describe('validator-change-and-range-support: change detection and range handling', () => {
  it('validator change between attempts is detected and never appended across', async () => {
    const v2 = payload(100, 7);
    fixture.serveFile('/changed.bin', { body: v2, etag: '"v2"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/changed.bin', v2, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: carriedPartial({ strongETag: '"v1"' }, payload(40, 7)),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    // Range + If-Range were sent; the server answered 200 (representation changed).
    expect(fixture.requests.at(-1)?.range).toBe('bytes=40-');
    expect(fixture.requests.at(-1)?.ifRange).toBe('"v1"');
    expect(outcome.resumeDecision).toEqual({ kind: 'SAFE_RESTART', reason: 'IDENTITY_CHANGED' });
    expect(outcome.bytes).toEqual(v2);
    expect(outcome.bytes?.byteLength).toBe(100);
    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.observedIdentity.strongETag).toBe('"v2"');
  });

  it('range support change: server without ranges forces restart with the full representation', async () => {
    fixture.serveFile('/no-ranges.bin', { body: FULL, etag: '"v1"', acceptRanges: false });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/no-ranges.bin', FULL, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: carriedPartial({ strongETag: '"v1"' }, PREFIX),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(fixture.requests.at(-1)?.range).toBe('bytes=40-');
    expect(outcome.resumeDecision).toEqual({ kind: 'SAFE_RESTART', reason: 'IDENTITY_CHANGED' });
    expect(outcome.bytes).toEqual(FULL);
    expect(outcome.reason).toBe('COMPLETED');
  });

  it('range-aware resume consumes remaining transfer budget, not a fresh one', async () => {
    fixture.serveFile('/budgeted.bin', { body: FULL, etag: '"v1"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    ledger.preConsume({ transfer: { bytes: 40 } });
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/budgeted.bin', FULL, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: carriedPartial({ strongETag: '"v1"' }, PREFIX),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(outcome.reason).toBe('COMPLETED');
    // Only the 60 appended bytes were charged this attempt; the carried 40
    // remain accounted from the earlier attempt — remaining budget shrank.
    const remaining = ledger.remaining().transfer.perLimit;
    expect(remaining['bytes']).toBe(1000 - 100);
  });
});

describe('safe-restart: restart stays in lineage without budget replenishment', () => {
  it('restart keeps the same effect/target lineage and inherits remaining budgets', async () => {
    fixture.serveFile('/restart.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    ledger.preConsume({ transfer: { bytes: 40 } });
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/restart.bin', FULL, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: carriedPartial({}, PREFIX),
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(outcome.resumeDecision.kind).toBe('SAFE_RESTART');
    expect(outcome.effectId).toBe('effect-001');
    expect(outcome.targetId).toBe('target-file-001');
    expect(outcome.reason).toBe('COMPLETED');
    // 40 (prior attempt) + 100 (restart) consumed; nothing replenished.
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(1000 - 140);
  });

  it('resume state from a different effect lineage is rejected before transfer (no unsafe append)', async () => {
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);
    const before = fixture.requests.length;

    const rejected = await adapter.acquire({
      ...directRequest(baseUri, '/other-lineage.bin', FULL, { effectId: 'effect-001', attempt: 1 }),
      resumeFrom: {
        bytes: PREFIX,
        receivedBytes: 40,
        identity: { strongETag: '"v1"' },
        effectId: effectIdOf('effect-OTHER'),
        targetId: targetIdOf('target-file-001'),
      },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe('MEMBERSHIP_DRIFT');
      expect(rejected.diagnostics[0]?.invariant).toBe('L2-inv8');
    }
    expect(fixture.requests.length).toBe(before);
  });
});
