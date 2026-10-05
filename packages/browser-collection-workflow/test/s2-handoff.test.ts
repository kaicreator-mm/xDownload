/**
 * TEST_MATRIX suite `s2-explicit-attachment-handoff` (+ C29 accept shape).
 *
 * Must prove (fixture/observation-feed level; real-browser tuple execution is
 * T021-owned and recorded NOT_EXECUTED):
 * - a fixture S2 flow carries an explicit current-page attachment from a gated
 *   observation (recordObservation/buildObservationHandoff,
 *   EVIDENCE_INPUT_ONLY) through the scoped-authorization broker to an
 *   authoritative Core acquisition;
 * - the acquisition executes through the core-runtime lineage flow with
 *   canonical budget ports; the browser lane never owns transfer lifecycle or
 *   terminal truth;
 * - observation/handoff records remain evidence-input-only through the
 *   composed flow and cannot self-certify validation claims;
 * - exit-sink redaction and the untrusted-input gate hold at every boundary
 *   crossing (raw-secret negative).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import {
  clearSinkScrubSentinels,
  networkObservationEvidenceCandidate,
  registerSinkScrubSentinel,
} from '@xdownload/browser-observation';
import { canServeAsIndependentValidationOracle, evidenceRecord } from '@xdownload/domain-contracts';
import { selectionAcquisitionComplete } from '@xdownload/discovery-recipe';
import { assertOriginAllowed, resolveCallerOrigin } from '@xdownload/browser-auth-broker';
import type { TerminalResult } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  payload,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import {
  locatorProvenanceFacts,
  projectS2Flow,
  revokeScopedCapability,
  runS2AttachmentFlow,
} from '../src/index.ts';
import {
  eid,
  networkObservation,
  pageContextObservation,
  payload as fixturePayload,
  sha256,
  singleResourceContract,
} from './fixtures.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = singleResourceContract();
const SNAPSHOT = 'snapshot-for-contract-s2-attachment';
const MEMBER = 'member-s2-file-001';

describe('T016 s2-explicit-attachment-handoff', () => {
  it('carries an explicit attachment from gated observation through the broker to an authoritative Core acquisition', async () => {
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(2048, 3);
    fixture.serveFile('/file.bin', { body: bytes, etag: 's2-etag' });

    const rootDir = makeTempDir('t016-s2-ok');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const broker = createAuthBroker();
      const outcome = await runS2AttachmentFlow({
        runtime,
        broker,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:s2-001',
        commandId: 'cmd-s2-001',
        observation: {
          raw: pageContextObservation({
            origin: baseUri,
            pageUrl: `${baseUri}/watch/42`,
            title: 'Fixture page with an explicit attachment',
          }),
          observationId: 'obs-s2-001',
          capturedAtMs: 1_000,
        },
        authorization: {
          origin: baseUri,
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:s2-attachment-42',
        },
        delivery: {
          locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${baseUri}/file.bin`,
          },
          declaredRedirectHosts: [new URL(baseUri).host],
          expectedSha256: sha256(bytes),
          expectedContentTypePrefix: 'application/octet-stream',
        },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // The observation lane stays evidence-input-only at every point.
      expect(outcome.observation.authority).toBe('EVIDENCE_INPUT_ONLY');
      expect(outcome.handoff.authority).toBe('EVIDENCE_INPUT_ONLY');
      // Only the opaque ref crossed the authorization boundary.
      expect(outcome.authorizationContextRef.startsWith('authctx/')).toBe(true);
      expect(outcome.capabilityStatus).toBe('ACTIVE');

      // The acquisition executed through the core-runtime lineage flow with
      // canonical budget ports; transfer lifecycle is Core-owned.
      expect(outcome.flow.transfer?.reason).toBe('COMPLETED');
      expect(outcome.flow.transfer?.allApplicableValidationPassed).toBe(true);
      expect(outcome.flow.acceptance).toBeDefined();
      expect(outcome.flow.schedulerAcceptance?.ok).toBe(true);
      const budgetFacts = runtime.scheduler
        .log()
        .readAll()
        .map((fact) => fact.kind);
      expect(budgetFacts.filter((kind) => kind === 'budgetConsumed').length).toBeGreaterThan(0);

      // Terminal truth comes only from the T007 projector.
      const projected = projectS2Flow({
        runtime,
        flow: outcome.flow,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        recordedAt: '2026-10-04T03:00:00Z',
      });
      expect(projected.ok).toBe(true);
      const terminal: TerminalResult = projected.ok ? projected.value.result : (undefined as never);
      expect(terminal.requestFulfillment).toBe('COMPLETE');
      expect(terminal.targetResolution).toBe('RESOLVED');
      expect(terminal.selectionAcquisition).toBe('COMPLETE');
      expect(terminal.coverage).toBe('NOT_APPLICABLE');
      expect(terminal.stopReason).toBe('NONE');
      expect(terminal.validationSummary.status).toBe('ALL_PASSED');

      // Locator hops are recorded as provenance facts with identity preserved.
      const provenance = locatorProvenanceFacts(outcome.flow);
      expect(provenance?.identityPreservedAcrossHops).toBe(true);
      expect(provenance?.hops.length).toBe(1);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('keeps observation evidence-input-only: it can never self-certify validation or change terminal truth', async () => {
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(1024, 4);
    fixture.serveFile('/file.bin', { body: bytes, etag: 's2-etag-2' });

    const rootDir = makeTempDir('t016-s2-evidence');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const broker = createAuthBroker();
      const outcome = await runS2AttachmentFlow({
        runtime,
        broker,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:s2-002',
        commandId: 'cmd-s2-002',
        observation: {
          raw: networkObservation({
            origin: baseUri,
            requestUrl: `${baseUri}/file.bin`,
            requestRef: 'req-s2-002',
          }),
          observationId: 'obs-s2-002',
          capturedAtMs: 1_100,
        },
        authorization: { origin: baseUri, ttlMs: 60_000, issueDecisionToken: 'user-confirm:s2-2' },
        delivery: {
          locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${baseUri}/file.bin`,
          },
          declaredRedirectHosts: [new URL(baseUri).host],
          expectedSha256: sha256(bytes),
        },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');

      // The observation's canonical evidence candidate is SUGGESTIVE — it can
      // never serve as an independent validation oracle.
      const candidate = networkObservationEvidenceCandidate(outcome.observation);
      expect(candidate.ok).toBe(true);
      if (candidate.ok) {
        expect(candidate.value.certaintyClass).toBe('SUGGESTIVE');
        expect(canServeAsIndependentValidationOracle(candidate.value)).toBe(false);
        // Even a DECISIVE user confirmation can never waive the required
        // transfer/format layers (C27): the canonical rule refuses.
        const confirmationOnly = selectionAcquisitionComplete({
          requiredLayers: ['transfer', 'format'],
          evidenceByLayer: {
            transfer: [
              evidenceRecord({
                evidenceId: eid('evidence-confirmation-waive-attempt'),
                claimType: 'SELECTION',
                claimSubject: { kind: 'LOGICAL_TARGET', ref: 'target-s2-file-001' },
                sourceType: 'USER_CONFIRMATION',
                provenance: { sourceIdentity: 'user-confirmation:CONFIRM_QUALITY_CHOICE' },
                independenceFromDiscovery: 'INDEPENDENT',
                scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
                certaintyClass: 'DECISIVE',
              }),
            ],
            format: [],
          },
          anyValidationFailed: false,
        });
        expect(confirmationOnly.decision).toBe('NOT_COMPLETE');
        if (confirmationOnly.decision === 'NOT_COMPLETE') {
          expect(confirmationOnly.reason).toBe('CONFIRMATION_CANNOT_WAIVE_VALIDATION');
        }
      }

      // Terminal truth is durable Core projection, not browser-owned: even
      // after the capability is revoked post-acquisition, the projected tuple
      // is unchanged and re-projection yields the identical truth.
      const before = projectS2Flow({
        runtime,
        flow: outcome.flow,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        recordedAt: '2026-10-04T03:00:00Z',
      });
      const revoked = revokeScopedCapability(broker, outcome.authorizationContextRef);
      expect(revoked.ok).toBe(true);
      const after = projectS2Flow({
        runtime,
        flow: outcome.flow,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        recordedAt: '2026-10-04T03:00:00Z',
      });
      expect(after.ok).toBe(true);
      expect(before.ok && after.ok && after.value.result).toEqual(
        before.ok ? before.value.result : undefined,
      );
      expect(after.ok ? after.value.result.validationSummary.status : undefined).toBe('ALL_PASSED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('fails closed at the untrusted gate on raw secret material and never lets it cross the flow (negative)', async () => {
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = fixturePayload(256, 1);
    fixture.serveFile('/file.bin', { body: bytes, etag: 's2-etag-3' });

    const rootDir = makeTempDir('t016-s2-secret');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const broker = createAuthBroker();
      const rejected = await runS2AttachmentFlow({
        runtime,
        broker,
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:s2-003',
        commandId: 'cmd-s2-003',
        observation: {
          raw: {
            boundary: 'CONTENT_SCRIPT',
            kind: 'PAGE_CONTEXT',
            provenance: { tabId: 7, frameId: 0, origin: baseUri },
            payload: { pageUrl: `${baseUri}/watch/42`, password: 'hunter2' },
          },
          observationId: 'obs-s2-003',
          capturedAtMs: 1_200,
        },
        authorization: { origin: baseUri, ttlMs: 60_000, issueDecisionToken: 'user-confirm:s2-3' },
        delivery: {
          locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${baseUri}/file.bin`,
          },
          declaredRedirectHosts: [new URL(baseUri).host],
          expectedSha256: sha256(bytes),
        },
      });
      // Raw secret material is rejected at the gate before any privilege.
      expect(rejected.ok).toBe(false);
      if (!rejected.ok && rejected.rejection.stage === 'OBSERVATION_GATE') {
        expect(rejected.rejection.diagnostics.some((d) => d.code === 'RAW_SECRET_FIELD')).toBe(
          true,
        );
      } else {
        throw new Error('expected an OBSERVATION_GATE rejection');
      }
      // No durable acquisition happened: the boundary held.
      expect(runtime.writer.reader.workItems().length).toBe(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it('redacts secret material at the composed handoff boundary (exit-sink discipline)', async () => {
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(512, 6);
    fixture.serveFile('/file.bin', { body: bytes, etag: 's2-etag-4' });

    // The T010 sentinel audit mechanics: register the leaked session secret
    // and prove the composed handoff replaces it wholesale at the sink.
    const leaked = 'session-token-abc123-leak';
    registerSinkScrubSentinel(leaked);

    const rootDir = makeTempDir('t016-s2-redact');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const outcome = await runS2AttachmentFlow({
        runtime,
        broker: createAuthBroker(),
        contract: CONTRACT,
        snapshotId: SNAPSHOT,
        memberId: MEMBER,
        artifactId: 'artifact:s2-004',
        commandId: 'cmd-s2-004',
        observation: {
          raw: pageContextObservation({
            origin: baseUri,
            pageUrl: `${baseUri}/watch/43`,
            title: `page title with ${leaked} inside`,
          }),
          observationId: 'obs-s2-004',
          capturedAtMs: 1_300,
        },
        authorization: { origin: baseUri, ttlMs: 60_000, issueDecisionToken: 'user-confirm:s2-4' },
        delivery: {
          locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${baseUri}/file.bin`,
          },
          declaredRedirectHosts: [new URL(baseUri).host],
          expectedSha256: sha256(bytes),
        },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      // The secret never appears unredacted in the composed flow state; the
      // handoff payload carries the redaction marker instead.
      // Sentinel-bearing values are replaced wholesale at the sink: the
      // handoff envelope that crosses toward Core carries only the marker.
      expect(outcome.handoff.payload['title']).toBe('[REDACTED]');
      // Nothing on the Core side of the composed flow carries the secret.
      const coreSide = JSON.stringify([outcome.handoff, outcome.flow]);
      expect(coreSide).not.toContain(leaked);
    } finally {
      clearSinkScrubSentinels();
      closeRuntime(runtime);
    }
  });

  it('preserves strict allowed_origins with no fallback transport at the composed boundary (negative)', () => {
    const good = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
    // Empty allow list rejects every caller (no empty-match fallback).
    expect(assertOriginAllowed(good, []).ok).toBe(false);
    // A wildcard entry is malformed: the whole list fails closed.
    expect(assertOriginAllowed(good, ['*']).ok).toBe(false);
    // A non-extension origin (page origin) is never a valid caller origin.
    expect(assertOriginAllowed('http://127.0.0.1:1234/', [good]).ok).toBe(false);
    // A host started without an extension-origin argument fails closed.
    expect(resolveCallerOrigin(['node', 'host.js']).ok).toBe(false);
  });
});
