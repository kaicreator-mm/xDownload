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
import { DirectHttpAdapter, validateMedia, validateTarget } from '../src/index.ts';
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

describe('no-digest Target basis: requested-locator provenance (#101 R1/F01, C34)', () => {
  it('a no-digest download inside the declared delivery graph completes on the provenance basis', async () => {
    fixture.serveFile('/provenance.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/provenance.bin', FULL, {
          effectId: 'effect-001',
          omitExpectedSha256: true,
        }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.allApplicableValidationPassed).toBe(true);
    expect(outcome.terminalResult.requestFulfillment).toBe('COMPLETE');
    expect(outcome.terminalResult.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 3,
      failedCount: 0,
    });
    expect(outcome.targetBasis).toBe('REQUESTED_LOCATOR_PROVENANCE');
    // The Target evidence names its conservative basis explicitly — it can
    // never be mistaken for a publisher-byte-digest identity (C34).
    const targetEvidence = outcome.evidence.find(
      (record) =>
        record.claimType === 'RESOURCE_IDENTITY' && record.sourceType === 'INDEPENDENT_VALIDATOR',
    );
    expect(targetEvidence).toBeDefined();
    expect(targetEvidence?.provenance.sourceIdentity).toContain('REQUESTED_LOCATOR_PROVENANCE');
    expect(targetEvidence?.certaintyClass).toBe('PROBATIVE');
  });

  it('a digest-anchored download names the PUBLISHED_SHA256 basis in its evidence', async () => {
    fixture.serveFile('/published.bin', { body: FULL });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/published.bin', FULL, {
          effectId: 'effect-001',
          expectedSha256: sha256(FULL),
        }),
      ),
    );

    expect(outcome.reason).toBe('COMPLETED');
    expect(outcome.targetBasis).toBe('PUBLISHED_SHA256');
    const targetEvidence = outcome.evidence.find(
      (record) =>
        record.claimType === 'RESOURCE_IDENTITY' && record.sourceType === 'INDEPENDENT_VALIDATOR',
    );
    expect(targetEvidence?.provenance.sourceIdentity).toContain('PUBLISHED_SHA256');
    expect(targetEvidence?.certaintyClass).toBe('DECISIVE');
  });

  it('a redirect to an undeclared host cannot silently pass without a digest (C29/C34)', async () => {
    fixture.redirect('/moved.bin', 'http://undeclared.example/file.bin');
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/moved.bin', FULL, {
          effectId: 'effect-001',
          omitExpectedSha256: true,
        }),
      ),
    );

    expect(outcome.reason).toBe('LOCATOR_SUBSTITUTION');
    expect(outcome.allApplicableValidationPassed).toBe(false);
    expect(outcome.terminalResult.requestFulfillment).toBe('UNSATISFIED');
    expect(outcome.terminalResult.selectionAcquisition).toBe('FAILED');
  });

  it('a changed endpoint (different bytes, same locator) on the provenance basis stays bounded by transfer/format truth and never fabricates a digest identity', async () => {
    // The provenance basis makes a structural claim only; the changed-bytes
    // case without a declared anchor is exactly why evidence names the basis:
    // the transfer/format layers still validate what actually arrived.
    const changed = payload(100, 7);
    fixture.serveFile('/changed.bin', { body: changed });
    const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
    const adapter = new DirectHttpAdapter(ledger);

    const outcome = unwrapOrThrow(
      await adapter.acquire(
        directRequest(baseUri, '/changed.bin', FULL, {
          effectId: 'effect-001',
          omitExpectedSha256: true,
        }),
      ),
    );

    // No publisher anchor exists, so a WRONG_TARGET digest claim is impossible
    // by construction; the completed transfer passes on the declared graph.
    expect(outcome.targetBasis).toBe('REQUESTED_LOCATOR_PROVENANCE');
    expect(outcome.validations.find((check) => check.layer === 'target')?.passed).toBe(true);
  });

  it('validateTarget without provenance facts fails NOT_VALIDATED instead of passing blindly', () => {
    const blind = validateTarget({ bytes: FULL });
    expect(blind.passed).toBe(false);
    if (!blind.passed) {
      expect(blind.code).toBe('TARGET_PROVENANCE_NOT_VALIDATED');
    }
    const undeclaredHost = validateTarget({
      bytes: FULL,
      servedUri: 'http://stranger.example/file.bin',
      originUri: 'http://127.0.0.1/file.bin',
      declaredRedirectHosts: ['127.0.0.1'],
    });
    expect(undeclaredHost.passed).toBe(false);
    if (!undeclaredHost.passed) {
      expect(undeclaredHost.code).toBe('TARGET_PROVENANCE_INVALID');
    }
    const nonHttp = validateTarget({
      bytes: FULL,
      servedUri: 'ftp://127.0.0.1/file.bin',
      originUri: 'http://127.0.0.1/file.bin',
      declaredRedirectHosts: ['127.0.0.1'],
    });
    expect(nonHttp.passed).toBe(false);
    if (!nonHttp.passed) {
      expect(nonHttp.code).toBe('TARGET_PROVENANCE_INVALID');
    }
    const malformedServed = validateTarget({
      bytes: FULL,
      servedUri: 'not a uri',
      originUri: 'http://127.0.0.1/file.bin',
      declaredRedirectHosts: ['127.0.0.1'],
    });
    expect(malformedServed.passed).toBe(false);
  });

  it('declared total bytes still gate the provenance basis (size is evidence, not identity)', () => {
    const sizeGate = validateTarget({
      bytes: FULL.subarray(0, 40),
      expectedTotalBytes: 100,
      servedUri: 'http://127.0.0.1/file.bin',
      originUri: 'http://127.0.0.1/file.bin',
      declaredRedirectHosts: ['127.0.0.1'],
    });
    expect(sizeGate.passed).toBe(false);
    if (!sizeGate.passed) {
      expect(sizeGate.code).toBe('SIZE_MISMATCH');
    }
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

  it('S3 with absent or empty MediaPolicy cannot vacuously pass Media validation', async () => {
    const media = mp4WithTrack();
    fixture.serveFile('/media-no-policy.mp4', {
      body: media,
      etag: '"no-media-policy"',
      contentType: 'video/mp4',
    });
    for (const policy of [undefined, { signatures: [] }] as const) {
      const ledger = new InMemoryAuthoritativeLedger(transferProfile({ maxBytes: 100_000 }));
      const adapter = new DirectHttpAdapter(ledger);
      const outcome = unwrapOrThrow(
        await adapter.acquire(
          directRequest(baseUri, '/media-no-policy.mp4', media, {
            effectId: 'effect-001',
            slice: 'S3',
            ...(policy === undefined ? {} : { mediaPolicy: policy }),
          }),
        ),
      );
      const mediaVerdict = outcome.validations.find((check) => check.layer === 'media');
      expect(mediaVerdict).toMatchObject({
        layer: 'media',
        passed: false,
        code: 'MEDIA_POLICY_REQUIRED',
      });
      expect(outcome.reason).toBe('MEDIA_INVALID');
      expect(outcome.allApplicableValidationPassed).toBe(false);
      expect(outcome.terminalResult.selectionAcquisition).not.toBe('COMPLETE');
      expect(outcome.terminalResult.validationSummary.status).toBe('FAILED');
    }
  });

  it('the pure Media validator rejects an empty signature set without a byte oracle', () => {
    expect(validateMedia({ bytes: mp4WithTrack(), policy: { signatures: [] } })).toMatchObject({
      layer: 'media',
      passed: false,
      code: 'MEDIA_POLICY_REQUIRED',
    });
  });

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
