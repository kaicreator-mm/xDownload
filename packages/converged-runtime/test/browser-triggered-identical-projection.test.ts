/**
 * TEST_MATRIX suite `browser-triggered-identical-projection` (T017).
 *
 * Must prove:
 * - a browser-triggered flow (T016 S2 attachment → scoped capability →
 *   authoritative Core acquisition) projects identically to every observing
 *   surface;
 * - the extension lane contributes evidence and intent only; it never owns
 *   transfer lifecycle, progress authority or terminal truth through the
 *   composed path;
 * - browser-triggered outcomes render through the same T007 projection as
 *   any other surface's view of the same lineage.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { runS2AttachmentFlow } from '@xdownload/browser-collection-workflow';
import { projectLineageResult } from '@xdownload/core-runtime';
import { decodeAcquisitionContract, unwrapOrThrow } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import { payload } from '../../core-runtime/test/helpers.ts';
import { boundSurface, composeCore, type ComposedCore } from './fixtures.ts';
import { renderProjectionBytes } from '../src/index.ts';

const cores: ComposedCore[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const core of cores.splice(0)) {
    await core.stop();
  }
});

// The confirmed S2 contract, decoded through the canonical domain decoder
// (same discipline as the T016 suites; no glue-local contract vocabulary).
function s2Contract(_baseUri: string) {
  return unwrapOrThrow(
    decodeAcquisitionContract({
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId: 'contract-t017-s2',
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      requestedTarget: 'target-s2-file-001',
      requestedScope: { kind: 'single_resource', targetId: 'target-s2-file-001' },
      continuationScope: { kind: 'NONE' },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
      automationMode: 'AUTO',
      explorationPermission: 'NONE',
      budgetProfile: {
        discovery: {
          domain: 'discovery',
          maxGeneratedRequests: 50,
          maxNavigationActions: 20,
          maxModelCalls: 5,
        },
        transfer: {
          domain: 'transfer',
          maxBytes: 1_000_000,
          maxSegments: 50,
          maxActiveTransferMs: 3_600_000,
          maxRetryTransferRequests: 5,
        },
        globalSafety: {
          domain: 'global_safety',
          maxTotalGeneratedRequests: 500,
          maxActiveElapsedMs: 7_200_000,
        },
      },
      authorizationContextRef: 'authctx/local-t017-s2',
      validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
      stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
      resultPolicy: { requireMultidimensionalResult: true },
      confirmedAt: '2026-10-04T02:00:00Z',
    }),
  );
}

// Untrusted browser message (raw shape — the lane gates it).
function s2Observation(baseUri: string): Record<string, unknown> {
  return {
    boundary: 'CONTENT_SCRIPT',
    kind: 'PAGE_CONTEXT',
    provenance: { tabId: 7, frameId: 0, origin: baseUri },
    payload: {
      pageUrl: `${baseUri}/watch/42`,
      title: 'Fixture page with an explicit attachment',
    },
  };
}

describe('T017 browser-triggered-identical-projection', () => {
  it('a browser-triggered S2 flow projects identically to every observing surface through the same T007 projection', async () => {
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();
    const bytes = payload(2048, 3);
    fixture.serveFile('/file.bin', { body: bytes, etag: 't017-s2-etag' });

    const core = await composeCore('t017-browser-triggered');
    cores.push(core);
    const broker = createAuthBroker();

    // The canonical S2 contract enters through the seam first (the same
    // authority path any surface uses); the observed lineage reads below are
    // then views of THIS aggregate.
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const extension = boundSurface('BROWSER_EXTENSION', core);
    const contract = s2Contract(baseUri);
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-s2',
      payload: JSON.parse(JSON.stringify(contract)) as Record<string, unknown>,
      expectedRevision: 0,
      requestId: 'req-t017-s2-submit',
      correlation: { contractId: 'contract-t017-s2' },
    });
    expect(submit.outcome).toBe('ACCEPTED');

    // The browser-triggered flow: T016 S2 attachment lane → scoped capability
    // → authoritative Core acquisition. Evidence and intent only.
    const outcome = await runS2AttachmentFlow({
      runtime: core.runtime,
      broker,
      contract: contract,
      snapshotId: 'snapshot-t017-s2',
      memberId: 'member-s2-file-001',
      artifactId: 'artifact:t017-s2-001',
      commandId: 'cmd-t017-s2-001',
      observation: {
        raw: s2Observation(baseUri),
        observationId: 'obs-t017-s2-001',
        capturedAtMs: 1_000,
      },
      authorization: { ttlMs: 60_000, issueDecisionToken: 'user-confirm:t017-s2-42' },
      delivery: {
        locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
        provenance: {
          binding: 'SELECTED_RESOURCE_PROVENANCE',
          originLocatorUri: `${baseUri}/file.bin`,
        },
        declaredRedirectHosts: [new URL(baseUri).host],
        expectedSha256: createHash('sha256').update(bytes).digest('hex'),
        expectedContentTypePrefix: 'application/octet-stream',
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    // The browser lane contributed evidence and intent only: the observation
    // stays EVIDENCE_INPUT_ONLY and can never self-certify validation.
    expect(outcome.observation.authority).toBe('EVIDENCE_INPUT_ONLY');
    expect(outcome.handoff.authority).toBe('EVIDENCE_INPUT_ONLY');
    // Transfer lifecycle and acceptance stayed Core-owned end-to-end.
    expect(outcome.flow.transfer?.reason).toBe('COMPLETED');
    expect(outcome.flow.transfer?.allApplicableValidationPassed).toBe(true);
    expect(outcome.flow.schedulerAcceptance?.ok).toBe(true);
    // Only the opaque capability ref crossed the authorization boundary.
    expect(outcome.authorizationContextRef.startsWith('authctx/')).toBe(true);

    // The projector lane (the same authority command any Core flow uses)
    // projects the browser-triggered outcome's terminal truth.
    const projected = await desktop.submitCanonicalCommand({
      commandType: 'PROJECT_TERMINAL_RESULT',
      aggregateId: 'contract-t017-s2',
      payload: {
        result: {
          schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
          contractId: 'contract-t017-s2',
          requestFulfillment: 'COMPLETE',
          targetResolution: 'RESOLVED',
          selectionAcquisition: 'COMPLETE',
          coverage: 'NOT_APPLICABLE',
          stopReason: 'NONE',
          validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
          recordedAt: '2026-10-04T02:30:00Z',
        },
        selectedValidationOutcomes: [
          { memberId: 'member-s2-file-001', requiredValidationPassed: true },
        ],
      },
      expectedRevision: 1,
      requestId: 'req-t017-s2-terminal',
      correlation: { contractId: 'contract-t017-s2' },
    });
    expect(projected.outcome).toBe('ACCEPTED');

    // The SAME projection of the SAME lineage, observed by CLI, DESKTOP_UI
    // and the extension consumer: identical verbatim bytes.
    const views = await Promise.all([
      cli.readProjection('contract-t017-s2'),
      desktop.readProjection('contract-t017-s2'),
      extension.readProjection('contract-t017-s2'),
    ]);
    const rendered: string[] = [];
    for (const view of views) {
      expect(view.outcome).toBe('PROJECTION');
      rendered.push(renderProjectionBytes(view.projection));
    }
    expect(new Set(rendered).size).toBe(1);
    const seamView = JSON.parse(rendered[0]!) as {
      readonly lineage: { readonly status: string };
      readonly terminal?: Record<string, unknown>;
    };
    expect(seamView.lineage.status).toBeDefined();
    expect(seamView.terminal?.['requestFulfillment']).toBe('COMPLETE');
    // The Core-side T007 projection of the composed flow agrees with the
    // lineage truth every surface just rendered.
    const coreProjection = projectLineageResult(core.runtime, {
      lineageKey: outcome.flow.lineageKey,
      contractId: 'contract-t017-s2',
      snapshotId: 'snapshot-t017-s2',
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      requestedMemberIds: ['member-s2-file-001'],
      recordedAt: '2026-10-04T02:30:00Z',
      enumeration: { kind: 'NOT_APPLICABLE' },
    });
    expect(coreProjection.ok).toBe(true);
    if (coreProjection.ok) {
      expect(coreProjection.value.result.contractId).toBe('contract-t017-s2');
      expect(coreProjection.value.result.requestFulfillment).toBe('COMPLETE');
    }
    await cli.close();
    await desktop.close();
    await extension.close();
  });
});
