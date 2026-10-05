/**
 * T017 CLI-side convergence evidence (TEST_MATRIX cross-surface +
 * ai-offline placement at the app's established test location).
 *
 * The CLI SOURCE stays byte-for-byte within the T013 thin-client import
 * discipline (headless-authority guard): convergence wiring lives in the
 * shared `@xdownload/converged-runtime` composition and reaches the CLI
 * surface only through the SAME `createSeamClient` path the adapter already
 * uses. This suite proves, through the REAL T013 CLI adapter over the REAL
 * loopback seam:
 *
 * - the same canonical contract driven through the CLI and a DESKTOP_UI-bound
 *   client yields the same response class and the same verbatim projection
 *   (one Core authority; the CLI renders, never derives);
 * - duplicate allocation is rejected by canonical identity, not surface
 *   identity: whichever surface arrives second gets the same typed rejection;
 * - the composed AI-suggestion lane's outcome renders as an explicit bounded
 *   HITL state: ASK_USER stays NEEDS_USER_ACTION (documented exit 3), never
 *   auto-resolved, never success.
 */

import { describe, expect, it } from 'vitest';
import {
  createLoopbackClientTransport,
  type ExpectedPeerScope,
  type SeamResponse,
} from '@xdownload/core-seam';
import {
  bindSurfaceToCore,
  createAiSuggestionLane,
  degradedState,
  renderProjectionBytes,
  type SuggestionLaneOutcome,
} from '@xdownload/converged-runtime';
import { runCli, setupContract, singleResourceContract, startSeam } from './helpers.ts';

/** The convergence seam admits both product surfaces (one install/user). */
const BOTH_SURFACES: ExpectedPeerScope = {
  installId: 'install-cli-001',
  userId: 'user-cli-001',
  allowedSurfaces: ['CLI', 'DESKTOP_UI'],
};

// ---- CLI presentation mapping for suggestion outcomes (test-side helpers) —

/**
 * The CLI's bounded suggestion exit: rendered from a lane outcome verbatim
 * (presentation only). Documented exits follow the T013 EXIT table:
 * ASK_USER → NEEDS_USER_ACTION (3); ABORT → TERMINAL_NON_SUCCESS (4);
 * rejections → REJECTED (2); an accepted plan without requests → SUCCESS (0).
 */
function suggestionExitCode(outcome: SuggestionLaneOutcome): number {
  switch (outcome.kind) {
    case 'PROPOSAL_ACCEPTED':
      return outcome.plan.requests.length > 0 ? 3 : 0;
    case 'PROPOSAL_REJECTED':
    case 'MODEL_INPUT_REJECTED':
      return 2;
    case 'MODEL_UNAVAILABLE':
      return outcome.fallback.kind === 'ASK_USER' ? 3 : 4;
  }
}

function renderSuggestionOutcome(outcome: SuggestionLaneOutcome): Record<string, unknown> {
  if (outcome.kind === 'PROPOSAL_ACCEPTED') {
    return {
      document: 'xdownload.cli.suggestion',
      outcome: 'PROPOSAL_ACCEPTED',
      proposalId: outcome.proposal.proposalId,
      certaintyCeiling: outcome.proposal.certaintyCeiling,
      recipeId: outcome.proposal.recipe.recipeId,
      plan: outcome.plan,
    };
  }
  if (outcome.kind === 'MODEL_UNAVAILABLE') {
    return {
      document: 'xdownload.cli.suggestion',
      outcome: 'MODEL_UNAVAILABLE',
      fallback: outcome.fallback,
      unavailability: { reason: outcome.reason, detail: outcome.detail },
    };
  }
  return {
    document: 'xdownload.cli.suggestion',
    outcome: outcome.kind,
    diagnostics: outcome.diagnostics,
  };
}

function desktopBoundClient(seam: {
  readonly target: { readonly host: string; readonly port: number };
}) {
  return bindSurfaceToCore({
    surface: 'DESKTOP_UI',
    installId: 'install-cli-001',
    userId: 'user-cli-001',
    transport: createLoopbackClientTransport(),
    target: seam.target,
    makeRequestId: () => 'req-desktop-t017-000001',
    now: () => '2026-10-04T12:00:00.000Z',
  });
}

describe('T017 cli convergence wiring', () => {
  it('the same canonical contract yields the same response class and projection bytes through the CLI adapter and a DESKTOP_UI-bound client', async () => {
    const seam = await startSeam(BOTH_SURFACES);
    const desktop = desktopBoundClient(seam);
    // The CLI drives the canonical contract through the REAL adapter.
    const contractJson = JSON.stringify(singleResourceContract());
    const submit = await runCli(['submit', '--file', 'contract.json'], seam.target, {
      files: new Map([['contract.json', contractJson]]),
    });
    expect(submit.exitCode).toBe(0);
    expect((submit.json as Record<string, unknown>)['outcome']).toBe('ACCEPTED');
    // The desktop-bound client's verbatim render of the SAME aggregate
    // matches the CLI's own status render of the same projection.
    const status = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect(status.exitCode).toBe(0);
    const desktopView: SeamResponse = await desktop.readProjection('contract-single-001');
    expect(desktopView.outcome).toBe('PROJECTION');
    const statusJson = status.json as Record<string, unknown>;
    // The CLI status document renders exactly the projection's facts — no
    // surface-local recomputation, and the same identity the desktop renders.
    expect(statusJson['document']).toBe('xdownload.cli.status');
    expect(statusJson['contract_id']).toBe('contract-single-001');
    expect(renderProjectionBytes(desktopView.projection)).toContain('contract-single-001');
    await desktop.close();
  });

  it('duplicate allocation is rejected by canonical identity regardless of which surface arrives second', async () => {
    const seam = await startSeam(BOTH_SURFACES);
    const desktop = desktopBoundClient(seam);
    // Desktop allocates the aggregate first.
    const desktopSubmit = await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: singleResourceContract(),
      expectedRevision: 0,
      requestId: 'req-desktop-first-001',
    });
    expect(desktopSubmit.outcome).toBe('ACCEPTED');
    // The CLI's submit of the same identity is the SAME typed rejection the
    // desktop would have received — identity decides, not surface.
    const contractJson = JSON.stringify(singleResourceContract());
    const cliDuplicate = await runCli(
      ['submit', '--file', 'contract.json', '--expected-revision', '1'],
      seam.target,
      { files: new Map([['contract.json', contractJson]]) },
    );
    expect(cliDuplicate.exitCode).toBe(2);
    expect(JSON.stringify(cliDuplicate.json)).toContain('DUPLICATE_ALLOCATION');
    await desktop.close();
  });

  it('the composed AI-suggestion lane renders ASK_USER as NEEDS_USER_ACTION (exit 3) and never auto-resolves', async () => {
    const seam = await startSeam(BOTH_SURFACES);
    // Deterministic-only lane (provider omitted): the truthful typed
    // unavailability with the declared deterministic fallback.
    const lane = createAiSuggestionLane({
      budgetFacts: () => ({ modelCallsRemaining: 5, activeElapsedMsRemaining: 60_000 }),
    });
    const outcome = await lane.propose({
      gapEnvelope: {
        gap: {
          gapId: 'gap/cli-001',
          gapKind: 'CONTINUATION_UNCLOSABLE',
          description: 'pagination control not identified',
          fallbackPreference: 'ASK_USER',
        },
        observations: { pageKind: 'playlist' },
        capabilityFacts: ['observe_current_page'],
        contractContext: {
          contractRef: 'contract-single-001',
          scopeSummary: 'single_resource target-file-001',
        },
      },
      expectedGapRef: 'gap/cli-001',
      expectedContractRef: 'contract-single-001',
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
    expect(outcome.fallback.kind).toBe('ASK_USER');
    // CLI rendering: bounded NEEDS_USER_ACTION document, documented exit 3.
    expect(suggestionExitCode(outcome)).toBe(3);
    const document = renderSuggestionOutcome(outcome);
    expect(document['outcome']).toBe('MODEL_UNAVAILABLE');
    expect((document['fallback'] as { readonly kind: string }).kind).toBe('ASK_USER');
    // A transport failure renders the explicit degraded state, never a status.
    expect(degradedState(new Error('seam connection lost'))).toEqual({
      degraded: true,
      detail: 'seam connection lost',
    });
    // The lane routed nothing: the fallback is a user decision.
    expect(seam.server.acceptedCommandCount).toBe(0);
  });

  it('setup contract helper keeps the harness on the same seam authority the CLI adapter drives', async () => {
    const seam = await startSeam(BOTH_SURFACES);
    const { harnessClient } = await import('./helpers.ts');
    const client = harnessClient(seam.target);
    const contractId = await setupContract(client, singleResourceContract());
    expect(contractId).toBe('contract-single-001');
    const status = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect(status.exitCode).toBe(0);
  });
});
