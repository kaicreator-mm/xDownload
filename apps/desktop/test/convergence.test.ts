/**
 * T017 desktop-side convergence evidence (TEST_MATRIX cross-surface +
 * hitl-parity placement at the app's established test location).
 *
 * Proves, through the REAL T014 desktop adapter over the REAL loopback seam:
 * - the desktop's Core-confirmed aggregate renders the SAME projection a
 *   CLI-bound client reads (one authority; UI renders, never derives);
 * - a duplicate allocation arriving from another surface is the canonical
 *   typed rejection and does not perturb the desktop display;
 * - the composed AI-suggestion lane renders ASK_USER as an explicit pending
 *   user decision — never auto-resolved, never a success.
 */

import { describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import {
  bindSurfaceToCore,
  createAiSuggestionLane,
  renderProjectionBytes,
} from '@xdownload/converged-runtime';
import { desktopSuggestionView } from '../src/convergence.ts';
import {
  confirmSingleResourceTask,
  coreProjection,
  desktopAdapter,
  sectionLines,
  startCore,
  type CoreHandle,
} from './helpers.ts';

describe('T017 desktop convergence wiring', () => {
  it('the desktop-confirmed aggregate renders the same projection a CLI-bound client reads', async () => {
    const core: CoreHandle = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    expect(contractId).not.toBe('');
    expect(sectionLines(outcome.display, 'Selection / progress')).toContain(
      'lineage status: ACTIVE',
    );
    // A CLI-bound client's verbatim render of the SAME aggregate matches the
    // Core projection the desktop just displayed its state from.
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-001',
      userId: 'user-001',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => `req-cli-${contractId}-read`,
      now: () => '2026-10-04T09:00:00Z',
    });
    const cliView = await cli.readProjection(contractId);
    expect(cliView.outcome).toBe('PROJECTION');
    const coreView = coreProjection(core, contractId);
    expect(coreView).toBeDefined();
    expect(renderProjectionBytes(cliView.projection)).toBe(renderProjectionBytes(coreView));
    // The desktop's own view of the aggregate stays bound to the same truth.
    expect(sectionLines(outcome.display, 'Selection / progress')).toContain(
      'lineage status: ACTIVE',
    );
    await cli.close();
    await adapter.close();
    await core.stop();
  });

  it('a duplicate allocation from another surface is the canonical rejection; the desktop display never diverges', async () => {
    const core: CoreHandle = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    // Another surface tries to re-allocate the SAME aggregate identity.
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-001',
      userId: 'user-001',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => 'req-cli-dup-000001',
      now: () => '2026-10-04T09:00:00Z',
    });
    const projection = coreProjection(core, contractId);
    expect(projection).toBeDefined();
    const duplicate = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: contractId,
      payload: {
        schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
        contractId: contractId,
        status: projection?.contract.status,
        intentType: projection?.contract.intentType,
        requestedTarget: 'target-file-001',
        requestedScope: { kind: 'single_resource', targetId: 'target-file-001' },
        continuationScope: { kind: 'NONE' },
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
        automationMode: 'ASSISTED',
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
            maxBytes: 1_000_000_000,
            maxSegments: 5000,
            maxActiveTransferMs: 3_600_000,
          },
          globalSafety: {
            domain: 'global_safety',
            maxTotalGeneratedRequests: 500,
            maxActiveElapsedMs: 7_200_000,
          },
        },
        authorizationContextRef: 'authctx/local-001',
        validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
        stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
        resultPolicy: { requireMultidimensionalResult: true },
        confirmedAt: '2026-10-04T09:00:00Z',
      },
      expectedRevision: projection?.contract.revision ?? 1,
      requestId: 'req-cli-dup-000001',
    });
    expect(duplicate.outcome).toBe('REJECTED');
    expect(duplicate.diagnostics?.[0]?.code).toBe('DUPLICATE_ALLOCATION');
    // The desktop display follows the unchanged Core projection only.
    const refreshed = await adapter.refresh();
    expect(sectionLines(refreshed.display, 'Selection / progress')).toContain(
      'lineage status: ACTIVE',
    );
    await cli.close();
    await adapter.close();
    await core.stop();
  });

  it('the composed AI-suggestion lane renders ASK_USER as an explicit pending decision on the desktop', async () => {
    const lane = createAiSuggestionLane({
      budgetFacts: () => ({ modelCallsRemaining: 2, activeElapsedMsRemaining: 30_000 }),
    });
    const outcome = await lane.propose({
      gapEnvelope: {
        gap: {
          gapId: 'gap/desktop-001',
          gapKind: 'CONTINUATION_UNCLOSABLE',
          description: 'pagination control not identified',
          fallbackPreference: 'ASK_USER',
        },
        observations: { pageKind: 'playlist' },
        capabilityFacts: ['observe_current_page'],
        contractContext: {
          contractRef: 'contract-desktop-001',
          scopeSummary: 'entire_supported_collection collection/playlist-001',
        },
      },
      expectedGapRef: 'gap/desktop-001',
      expectedContractRef: 'contract-desktop-001',
      contract: {
        status: 'CONFIRMED',
        continuationScope: { kind: 'NONE' },
        explorationPermission: 'NONE',
      },
      confirmation: {
        automationMode: 'ASSISTED',
        selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
        ambiguousMaterialMemberIds: [],
        candidateCount: 1,
        autoEvidenceSufficient: true,
      },
    });
    expect(outcome.kind).toBe('MODEL_UNAVAILABLE');
    if (outcome.kind !== 'MODEL_UNAVAILABLE') throw new Error('unreachable');
    const view = desktopSuggestionView(outcome);
    expect(view).toMatchObject({ view: 'PENDING_USER_DECISION', fallbackKind: 'ASK_USER' });
    // No success was fabricated and nothing was auto-resolved.
    expect(JSON.stringify(view)).not.toContain('SUGGESTION_PRESENTED');
  });
});
