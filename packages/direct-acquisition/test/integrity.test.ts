/**
 * TEST_MATRIX suite `truncation` and `wrong-target-and-integrity` (frozen PRD
 * §22): truncated/corrupt/wrong-target bytes are detected and never projected
 * as accepted/COMPLETE, login/error HTML cannot masquerade as target content,
 * S3 media structure gates acceptance (C27), and transfer alone never
 * completes an artifact.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidatesRequiredLayer,
  decodeEvidenceRecord,
  decodeTerminalResult,
  evidenceRecord,
  unwrapOrThrow,
  whatConfirmationProves,
} from '@xdownload/domain-contracts';
import { DirectHttpAdapter, validateMedia } from '../src/index.ts';
import { ControlledHttpFixture, mp4WithoutTrackBox } from './helpers/fixture-server.ts';
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
import type { MediaPolicy } from '../src/index.ts';

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

describe('truncation: detected, never accepted, truthful vocabulary', () => {
  it('truncated body (declared length vs received bytes) fails Transfer Validation and cannot be COMPLETE', async () => {
    fixture.serveTruncated('/truncated.bin', { body: FULL.subarray(0, 40), declaredLength: 100 });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/truncated.bin', FULL, {
          effectId: 'effect-001',
          expectedTotalBytes: 100,
        }),
      ),
    );

    expect(outcome.reason).toBe('TRUNCATED');
    expect(outcome.bytes?.byteLength).toBe(40);
    expect(outcome.allApplicableValidationPassed).toBe(false);
    const transfer = outcome.validations.find((check) => check.layer === 'transfer');
    expect(transfer?.passed).toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('PARTIAL');
    expect(outcome.terminalResult.selectionAcquisition).toBe('PARTIAL');
    expect(outcome.terminalResult.stopReason).toBe('VALIDATION_FAILED');
    expect(outcome.terminalResult.coverage).toBe('NOT_APPLICABLE');
    // Truthful summary: format passed on the partial bytes, but transfer and
    // target validation both fail for a truncated body.
    expect(outcome.terminalResult.validationSummary).toEqual({
      status: 'FAILED',
      passedCount: 1,
      failedCount: 2,
    });
    // The canonical projection still decodes: truthful vocabulary, no COMPLETE.
    expect(decodeTerminalResult({ ...outcome.terminalResult }).ok).toBe(true);
    expect(outcome.terminalResult.selectionAcquisition === 'COMPLETE').toBe(false);
  });

  it('resume past a truncated origin length is never accepted (ranged math catches it)', async () => {
    fixture.serveTruncated('/truncated-resume.bin', {
      body: FULL.subarray(40, 70),
      declaredLength: 60,
      etag: '"v1"',
    });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const request = {
      ...directRequest(baseUri, '/truncated-resume.bin', FULL, {
        effectId: 'effect-001',
        attempt: 1,
      }),
      resumeFrom: {
        bytes: FULL.subarray(0, 40),
        receivedBytes: 40,
        identity: { strongETag: '"v1"' },
        effectId: effectIdOf('effect-001'),
        targetId: targetIdOf('target-file-001'),
      },
    };
    const outcome = unwrapOrThrow(await adapter.acquire(request));

    expect(outcome.reason).toBe('TRUNCATED');
    expect(outcome.allApplicableValidationPassed).toBe(false);
    expect(outcome.terminalResult.selectionAcquisition).not.toBe('COMPLETE');
  });
});

describe('wrong-target-and-integrity: corruption and wrong variant never succeed (C09)', () => {
  it('corrupt bytes (digest mismatch) fail closed with typed evidence, never COMPLETE', async () => {
    const corrupt = payload(100, 3);
    fixture.serveFile('/corrupt.bin', { body: corrupt });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/corrupt.bin', FULL, { effectId: 'effect-001' }),
      ),
    );

    expect(outcome.reason).toBe('WRONG_TARGET');
    const target = outcome.validations.find((check) => check.layer === 'target');
    expect(target?.passed).toBe(false);
    expect(outcome.allApplicableValidationPassed).toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('UNSATISFIED');
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
    expect(outcome.terminalResult.stopReason).toBe('VALIDATION_FAILED');
    // No target-validation evidence exists for the failed target layer; the
    // transfer observation remains truthful.
    expect(outcome.evidence.some((record) => record.claimType === 'TRANSFER')).toBe(true);
    expect(
      outcome.evidence.some(
        (record) =>
          record.claimType === 'RESOURCE_IDENTITY' && record.sourceType === 'INDEPENDENT_VALIDATOR',
      ),
    ).toBe(false);
  });

  it('technically valid bytes of a different variant still fail Target Validation (C09)', async () => {
    const thumbnail = payload(100, 9);
    fixture.serveFile('/variant.bin', { body: thumbnail });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/variant.bin', FULL, {
          effectId: 'effect-001',
          expectedSha256: sha256(FULL),
          expectedTotalBytes: 100,
        }),
      ),
    );

    expect(outcome.reason).toBe('WRONG_TARGET');
    expect(outcome.validations.every((check) => check.layer !== 'format' || check.passed)).toBe(
      true,
    );
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
    expect(outcome.targetId).toBe('target-file-001');
  });
});

describe('wrong-target-and-integrity: HTML masquerading as target content', () => {
  it('login/error HTML content-type is rejected by Format Validation', async () => {
    fixture.serveHtml('/login.html');
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/login.html', FULL, {
          effectId: 'effect-001',
          expectedSha256: sha256(FULL),
        }),
      ),
    );

    expect(outcome.reason).toBe('FORMAT_REJECTED');
    const format = outcome.validations.find((check) => check.layer === 'format');
    expect(format?.passed).toBe(false);
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
  });

  it('HTML bytes with a lying content-type are rejected by content sniffing', async () => {
    const htmlBytes = new TextEncoder().encode(
      '<!DOCTYPE html><html><body>error page</body></html>',
    );
    fixture.on('/sniff.bin', (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(htmlBytes.byteLength),
      });
      response.end(Buffer.from(htmlBytes));
    });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/sniff.bin', FULL, {
          effectId: 'effect-001',
          expectedSha256: sha256(FULL),
        }),
      ),
    );

    expect(outcome.reason).toBe('FORMAT_REJECTED');
    expect(outcome.validations.find((check) => check.layer === 'format')?.passed).toBe(false);
  });
});

describe('wrong-target-and-integrity: S3 media validation gates acceptance (C27)', () => {
  const MP4_WITH_TRACK: MediaPolicy = {
    signatures: [
      { hex: '66747970', offset: 4, label: 'ftyp container box' },
      { hex: '6d6f6f76', offset: 32, label: 'moov track container' },
    ],
  };

  function mp4WithTrack(): Uint8Array {
    const bytes = payload(64, 5);
    bytes.set(Buffer.from('ftyp', 'ascii'), 4);
    bytes.set(Buffer.from('moov', 'ascii'), 32);
    return bytes;
  }

  it('S3 transfer with required media structure present completes with all four layers', async () => {
    const media = mp4WithTrack();
    fixture.serveFile('/media.mp4', { body: media, etag: '"m1"', contentType: 'video/mp4' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/media.mp4', media, {
          effectId: 'effect-001',
          slice: 'S3',
          mediaPolicy: MP4_WITH_TRACK,
        }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.allApplicableValidationPassed).toBe(true);
    expect(outcome.terminalResult.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 4,
      failedCount: 0,
    });
    const mediaEvidence = outcome.evidence.find((record) => record.claimType === 'MEDIA');
    expect(mediaEvidence).toBeDefined();
    if (mediaEvidence !== undefined) {
      expect(assertValidatesRequiredLayer(mediaEvidence, 'media').ok).toBe(true);
    }
    for (const record of outcome.evidence) {
      expect(decodeEvidenceRecord({ ...record }).ok).toBe(true);
    }
  });

  it('confirmed candidate with a missing required track is never COMPLETE (C27)', async () => {
    fixture.serveMediaMissingTrack('/missing-track.mp4', { etag: '"m2"' });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);
    // Served bytes carry the container box but lack the declared track box;
    // the digest anchor matches so only Media Validation fails.
    const served = mp4WithoutTrackBox();

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/missing-track.mp4', served, {
          effectId: 'effect-001',
          slice: 'S3',
          expectedSha256: sha256(served),
          mediaPolicy: MP4_WITH_TRACK,
        }),
      ),
    );

    expect(outcome.reason).toBe('MEDIA_INVALID');
    const media = outcome.validations.find((check) => check.layer === 'media');
    expect(media?.passed).toBe(false);
    expect(outcome.validations.find((check) => check.layer === 'target')?.passed).toBe(true);
    expect(outcome.terminalResult.selectionAcquisition === 'COMPLETE').toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('UNSATISFIED');
  });

  it('user confirmation cannot waive transfer/format/media validation (C27 at the seam)', () => {
    const confirmation = evidenceRecord({
      evidenceId: evidenceIdOf('evidence-confirmation-001'),
      claimType: 'RESOURCE_IDENTITY',
      claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-file-001' },
      sourceType: 'USER_CONFIRMATION',
      provenance: { sourceIdentity: 'user/confirmation-run-001' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
      certaintyClass: 'DECISIVE',
    });
    for (const layer of ['transfer', 'format', 'media'] as const) {
      const gate = assertValidatesRequiredLayer(confirmation, layer);
      expect(gate.ok).toBe(false);
      if (!gate.ok) {
        expect(gate.diagnostics[0]?.code).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
      }
    }
    expect(whatConfirmationProves('CONFIRM_RESOURCE_IDENTITY').doesNotProve).toContain('FORMAT');
    // Direct hook check: a signature beyond the acquired bytes fails closed.
    const probe = validateMedia({
      bytes: payload(8),
      policy: { signatures: [{ hex: '66747970', offset: 4, label: 'ftyp' }] },
    });
    expect(probe.passed).toBe(false);
  });
});
