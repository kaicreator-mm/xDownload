/**
 * Transfer-level counterexample oracles required by the T008 TEST_MATRIX:
 * C09, C12, C13, C27, C28 and C29, each proven against the controlled
 * localhost fixture server on the direct HTTP/file adapter seam.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoDuplicateAllocation,
  assertValidatesRequiredLayer,
  evidenceRecord,
  unwrapOrThrow,
} from '@xdownload/domain-contracts';
import { DirectHttpAdapter } from '../src/index.ts';
import { ControlledHttpFixture } from './helpers/fixture-server.ts';
import { InMemoryAuthoritativeLedger } from './helpers/ledger.ts';
import {
  directRequest,
  effectIdOf,
  evidenceIdOf,
  payload,
  sha256,
  targetIdOf,
  transferProfile,
} from './helpers/fixtures.ts';

const FULL = payload(100);
const THUMBNAIL = payload(100, 42);

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

describe('T008 transfer-level counterexample oracles', () => {
  it('C09: technically valid wrong-variant bytes fail Target Validation — no semantic PASS without typed independent target evidence', async () => {
    fixture.serveFile('/c09-thumbnail.bin', { body: THUMBNAIL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/c09-thumbnail.bin', FULL, {
          effectId: 'effect-c09',
          expectedSha256: sha256(FULL),
          expectedTotalBytes: 100,
        }),
      ),
    );

    // Transfer and format layers pass: the bytes are technically valid.
    expect(outcome.validations.find((check) => check.layer === 'transfer')?.passed).toBe(true);
    expect(outcome.validations.find((check) => check.layer === 'format')?.passed).toBe(true);
    // …yet the Target claim fails: validity alone is not the Target/Quality claim.
    expect(outcome.validations.find((check) => check.layer === 'target')?.passed).toBe(false);
    expect(outcome.terminalResult.selectionAcquisition === 'COMPLETE').toBe(false);
    // No independent target evidence was produced for the wrong variant.
    expect(
      outcome.evidence.some(
        (record) =>
          record.sourceType === 'INDEPENDENT_VALIDATOR' && record.claimType === 'RESOURCE_IDENTITY',
      ),
    ).toBe(false);
  });

  it('C12: retry domain is the original failed target/effect identities only — replacements rejected', async () => {
    fixture.serveFile('/c12.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, maxRetryTransferRequests: 5 }),
    );
    const adapter = new DirectHttpAdapter(ledger);

    const rejected = await adapter.acquire(
      directRequest(baseUri, '/c12.bin', FULL, {
        effectId: 'effect-c12',
        attempt: 1,
        retryLineage: {
          effectId: effectIdOf('effect-c12'),
          targetId: targetIdOf('target-new-member'),
        },
      }),
    );

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe('MEMBERSHIP_DRIFT');
      expect(rejected.diagnostics[0]?.invariant).toBe('C12');
    }
    expect(fixture.requests.length).toBe(0);
  });

  it('C13: restart/repair inherits remaining budgets and stable effect lineage; duplicate allocation rejected', async () => {
    fixture.serveFile('/c13.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 1000 }));
    ledger.preConsume({ transfer: { bytes: 40 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire({
        ...directRequest(baseUri, '/c13.bin', FULL, { effectId: 'effect-c13', attempt: 1 }),
        resumeFrom: {
          bytes: FULL.subarray(0, 40),
          receivedBytes: 40,
          identity: {},
          effectId: effectIdOf('effect-c13'),
          targetId: targetIdOf('target-file-001'),
        },
      }),
    );

    expect(outcome.effectId).toBe('effect-c13');
    expect(outcome.reason).toBe('COMPLETED');
    expect(ledger.remaining().transfer.perLimit['bytes']).toBe(1000 - 140);
    const effect = effectIdOf('effect-c13');
    expect(assertNoDuplicateAllocation([effect], effect).ok).toBe(false);
  });

  it('C27: truncated transfer of a confirmed candidate can never be COMPLETE — confirmation waives nothing', async () => {
    fixture.serveTruncated('/c27.bin', { body: FULL.subarray(0, 40), declaredLength: 100 });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/c27.bin', FULL, {
          effectId: 'effect-c27',
          expectedTotalBytes: 100,
        }),
      ),
    );

    expect(outcome.reason).toBe('TRUNCATED');
    expect(outcome.terminalResult.selectionAcquisition === 'COMPLETE').toBe(false);
    const confirmation = evidenceRecord({
      evidenceId: evidenceIdOf('evidence-c27-confirmation'),
      claimType: 'RESOURCE_IDENTITY',
      claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-file-001' },
      sourceType: 'USER_CONFIRMATION',
      provenance: { sourceIdentity: 'user/confirmed-before-transfer' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
      certaintyClass: 'DECISIVE',
    });
    for (const layer of ['transfer', 'format', 'media'] as const) {
      expect(assertValidatesRequiredLayer(confirmation, layer).ok).toBe(false);
    }
  });

  it('C28: exhausted DiscoveryBudget does not block the frozen target; transfer requests count TransferBudget', async () => {
    fixture.serveFile('/c28.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(
      transferProfile({ maxBytes: 100_000, discoveryMaxGeneratedRequests: 1 }),
    );
    ledger.preConsume({ discovery: { generatedRequests: 1 } });
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(directRequest(baseUri, '/c28.bin', FULL, { effectId: 'effect-c28' })),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(ledger.transferRequestsReported).toBe(1);
    expect(ledger.remaining().discovery.exhausted).toBe(true);
    expect(ledger.remaining().transfer.exhausted).toBe(false);
  });

  it('C29: provenance-bound declared-CDN redirect preserves the logical target and validates final bytes; unrelated redirect rejected', async () => {
    const cdn = new ControlledHttpFixture();
    const cdnBase = await cdn.start();
    try {
      fixture.redirect('/c29.bin', `${cdnBase}/c29-cdn.bin`);
      cdn.serveFile('/c29-cdn.bin', { body: FULL, etag: '"c29"' });
      const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
      const adapter = new DirectHttpAdapter(ledger);

      const bound = unwrapOrThrow(
        await adapter.acquire(
          directRequest(baseUri, '/c29.bin', FULL, {
            effectId: 'effect-c29',
            allowedRedirectHosts: [new URL(cdnBase).host],
          }),
        ),
      );
      expect(bound.reason).toBe('COMPLETED');
      expect(bound.locatorChain.every((binding) => binding.identity === 'target-file-001')).toBe(
        true,
      );
      expect(bound.bytes).toEqual(FULL);

      fixture.redirect('/c29-unrelated.bin', 'https://unrelated-c29.example/evil.bin');
      const rejected = unwrapOrThrow(
        await adapter.acquire(
          directRequest(baseUri, '/c29-unrelated.bin', FULL, {
            effectId: 'effect-c29b',
            allowedRedirectHosts: [new URL(cdnBase).host],
          }),
        ),
      );
      expect(rejected.reason).toBe('LOCATOR_SUBSTITUTION');
      expect(rejected.terminalResult.selectionAcquisition).toBe('FAILED');
    } finally {
      await cdn.stop();
    }
  });
});
