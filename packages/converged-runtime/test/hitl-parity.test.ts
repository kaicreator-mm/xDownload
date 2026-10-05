/**
 * TEST_MATRIX suite `hitl-parity` (T017).
 *
 * Must prove:
 * - confirmation plans from planConfirmationWorkflow render verbatim and
 *   route answers as idempotent Core commands from every surface; no surface
 *   collapses batch ambiguity into per-item prompts (C30);
 * - AI-suggested candidates enter the same explicit human confirmation flow
 *   as any other candidate; no AI path bypasses confirmation;
 * - ASK_USER fallbacks surface as explicit user decisions and are never
 *   auto-resolved by any surface or by the glue;
 * - HITL choices remain explicit and attributable only through Core records;
 *   confirmation proves selection only, never quality/validation claims
 *   (C05, C26).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { planConfirmationWorkflow } from '@xdownload/discovery-recipe';
import {
  desktopSuggestionView,
  bindDesktopSurface,
} from '../../../apps/desktop/src/convergence.ts';
import { bindSurfaceToCore, createAiSuggestionLane, renderProjectionBytes } from '../src/index.ts';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import {
  boundSurface,
  composeCore,
  nextRequestId,
  rawExplicitSetContract,
  rawSingleResourceContract,
  rawSnapshotPayload,
  terminalTuplePayload,
  type ComposedCore,
} from './fixtures.ts';
import {
  deterministicFakeProvider,
  gapEnvelopeInput,
  GAP_REF,
  CONTRACT_REF,
  CONTINUATION_CONTRACT,
  legalProposalBytes,
  openBudgetFacts,
} from './lane-fixtures.ts';

const cores: ComposedCore[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) {
    await core.stop();
  }
});

const memberIds = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`);

function surfaceBoundLaneLane() {
  return createAiSuggestionLane({
    provider: deterministicFakeProvider({ payload: legalProposalBytes() }),
    budgetFacts: openBudgetFacts,
  });
}

describe('T017 hitl-parity', () => {
  it('C30: batch ambiguity stays one BATCH_GROUP request rendered identically through the CLI and desktop renderers', async () => {
    const ambiguous = memberIds('amb', 50);
    const lane = surfaceBoundLaneLane();
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation: {
        automationMode: 'ASSISTED',
        selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
        ambiguousMaterialMemberIds: ambiguous,
        candidateCount: ambiguous.length,
        autoEvidenceSufficient: false,
      },
    });
    expect(outcome.kind).toBe('PROPOSAL_ACCEPTED');
    if (outcome.kind !== 'PROPOSAL_ACCEPTED') throw new Error('unreachable');
    // The canonical plan: one batch/group confirmation, never per-item.
    expect(outcome.plan.requests).toHaveLength(1);
    expect(outcome.plan.requests[0]?.level).toBe('BATCH_GROUP');
    expect(outcome.plan.perItemInterrogationUsed).toBe(false);
    // The plan equals the unmodified deterministic planner output verbatim.
    const direct = planConfirmationWorkflow({
      contract: {
        automationMode: 'ASSISTED',
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE' },
      },
      ambiguousMaterialMemberIds: ambiguous,
      candidateCount: ambiguous.length,
      autoEvidenceSufficient: false,
    });
    expect(outcome.plan).toEqual(direct);
    // The desktop renderer embeds the SAME canonical plan object verbatim
    // (the CLI document rendering is proven in apps/cli/test/convergence).
    const desktopView = desktopSuggestionView(outcome);
    expect((desktopView as { plan?: unknown }).plan).toEqual(direct);
  });

  it('AI-suggested candidates enter the SAME explicit confirmation flow: the lane mints no Core state and answers route as idempotent seam commands', async () => {
    const core = await composeCore('t017-hitl');
    cores.push(core);
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('cli'),
      now: () => '2026-10-04T01:00:00.000Z',
    });
    const desktop = boundSurface('DESKTOP_UI', core);
    const commandsBefore = core.runtime.seam.acceptedCommandCount;
    const lane = surfaceBoundLaneLane();
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation: {
        automationMode: 'ASSISTED',
        selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
        ambiguousMaterialMemberIds: ['member-001', 'member-002'],
        candidateCount: 2,
        autoEvidenceSufficient: false,
      },
    });
    expect(outcome.kind).toBe('PROPOSAL_ACCEPTED');
    // No AI path bypasses confirmation: the accepted proposal minted zero
    // Core commands — it is data with a plan until a human routes answers.
    expect(core.runtime.seam.acceptedCommandCount).toBe(commandsBefore);

    // The human confirms the candidate selection through BOTH surfaces with
    // the SAME idempotent identity: the answers converge on one Core record.
    const contractPayload = rawExplicitSetContract(['member-001', 'member-002'], {
      contractId: 'contract-t017-hitl',
    });
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-hitl',
      payload: contractPayload,
      expectedRevision: 0,
      requestId: 'req-hitl-submit-001',
    });
    expect(submit.outcome).toBe('ACCEPTED');
    const snapshot = rawSnapshotPayload('contract-t017-hitl', ['member-001', 'member-002']);
    const [fromCli, fromDesktop] = await Promise.all([
      cli.submitCanonicalCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-t017-hitl',
        payload: snapshot,
        expectedRevision: 1,
        requestId: 'req-hitl-confirm-001',
      }),
      desktop.submitCanonicalCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-t017-hitl',
        payload: snapshot,
        expectedRevision: 1,
        requestId: 'req-hitl-confirm-001',
      }),
    ]);
    expect(fromCli.outcome).toBe('ACCEPTED');
    expect(fromDesktop.outcome).toBe('ACCEPTED');
    expect(fromCli.acceptance?.converged !== fromDesktop.acceptance?.converged).toBe(true);
    expect(fromCli.currentRevision).toBe(fromDesktop.currentRevision);
    // One confirmation record, rendered identically from both surfaces.
    const [cliView, desktopView] = await Promise.all([
      cli.readProjection('contract-t017-hitl'),
      desktop.readProjection('contract-t017-hitl'),
    ]);
    expect(renderProjectionBytes(cliView.projection)).toBe(
      renderProjectionBytes(desktopView.projection),
    );
    await cli.close();
    await desktop.close();
  });

  it('ASK_USER fallbacks surface as explicit user decisions and are never auto-resolved by the glue', async () => {
    const core = await composeCore('t017-ask-user');
    cores.push(core);
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('cli'),
      now: () => '2026-10-04T01:00:00.000Z',
    });
    const commandsBefore = core.runtime.seam.acceptedCommandCount;
    const deterministicLane = createAiSuggestionLane({ budgetFacts: openBudgetFacts });
    const outcome = await deterministicLane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
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
    // The desktop renders an explicit PENDING_USER_DECISION — never a
    // synthesized answer, never a per-item prompt explosion. (The CLI's
    // bounded NEEDS_USER_ACTION rendering of the same lane outcome shape is
    // proven in apps/cli/test/convergence.test.ts.)
    const desktopView = desktopSuggestionView(outcome);
    expect(desktopView).toMatchObject({ view: 'PENDING_USER_DECISION', fallbackKind: 'ASK_USER' });
    // Re-running the same request resolves identically: the glue holds no
    // progression that could silently resolve the user's decision.
    const again = await deterministicLane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: CONTINUATION_CONTRACT,
      confirmation: {
        automationMode: 'ASSISTED',
        selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
        ambiguousMaterialMemberIds: [],
        candidateCount: 1,
        autoEvidenceSufficient: true,
      },
    });
    expect(again).toEqual(outcome);
    // Nothing auto-proceeded on the Core: no commands were minted by the
    // fallback renderers.
    expect(core.runtime.seam.acceptedCommandCount).toBe(commandsBefore);
    await cli.close();
  });

  it('C05/C26: confirmation proves selection only — validation truth stays independently unverified and absent until Core projects it, identically on every surface', async () => {
    const core = await composeCore('t017-selection-only');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const requested = memberIds('sel', 5);
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-sel',
      payload: rawSingleResourceContract({
        contractId: 'contract-t017-sel',
        intentType: 'COLLECTION',
        requestedTarget: 'target-sel-root',
        collectionIdentity: 'collection/t017-sel',
        membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/t017-sel',
          memberIds: requested,
        },
        automationMode: 'MANUAL_SELECTION',
        selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
      }),
      expectedRevision: 0,
      requestId: nextRequestId('sel-submit'),
    });
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = await desktop.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-sel',
      payload: rawSnapshotPayload('contract-t017-sel', requested.slice(0, 3), {
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/t017-sel',
          memberIds: requested,
        },
      }),
      expectedRevision: 1,
      requestId: nextRequestId('sel-confirm'),
    });
    expect(confirm.outcome).toBe('ACCEPTED');
    // Before terminal projection: the confirmation is recorded, but QUALITY
    // remains independently unverified — the validatedSuccessCount key is
    // absent (never 0, never true) on EVERY surface's verbatim render.
    const views = await Promise.all([
      cli.readProjection('contract-t017-sel'),
      desktop.readProjection('contract-t017-sel'),
    ]);
    for (const view of views) {
      const bytes = renderProjectionBytes(view.projection);
      expect(bytes).not.toContain('validatedSuccessCount');
      expect(
        (view.projection as { readonly selectedMemberCount?: number }).selectedMemberCount,
      ).toBe(3);
    }
    expect(renderProjectionBytes(views[0]?.projection)).toBe(
      renderProjectionBytes(views[1]?.projection),
    );
    await cli.close();
    await desktop.close();
  });

  it('terminal projection after confirmation renders the exact tuple identically from every surface (C05)', async () => {
    const core = await composeCore('t017-hitl-terminal');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = bindDesktopSurface({
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('desktop'),
      now: () => '2026-10-04T01:00:00.000Z',
    });
    const selected = memberIds('term', 3);
    await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-term',
      payload: rawSingleResourceContract({
        contractId: 'contract-t017-term',
        intentType: 'COLLECTION',
        requestedTarget: 'target-term-root',
        collectionIdentity: 'collection/t017-term',
        membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        requestedScope: {
          kind: 'explicit_member_set',
          memberIds: selected,
        },
        selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
        automationMode: 'ASSISTED',
      }),
      expectedRevision: 0,
      requestId: nextRequestId('term-submit'),
    });
    await cli.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-term',
      payload: rawSnapshotPayload('contract-t017-term', selected, {
        collectionIdentity: 'collection/t017-term',
      }),
      expectedRevision: 1,
      requestId: nextRequestId('term-confirm'),
    });
    const projected = await cli.submitCanonicalCommand({
      commandType: 'PROJECT_TERMINAL_RESULT',
      aggregateId: 'contract-t017-term',
      payload: terminalTuplePayload({
        contractId: 'contract-t017-term',
        snapshotId: 'snapshot-t017-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'USER_SELECTION_COMPLETE',
        passedCount: 3,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: selected.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: [...selected] },
        },
      }),
      expectedRevision: 2,
      requestId: nextRequestId('term-terminal'),
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const [cliView, desktopView] = await Promise.all([
      cli.readProjection('contract-t017-term'),
      desktop.readProjection('contract-t017-term'),
    ]);
    expect(renderProjectionBytes(cliView.projection)).toBe(
      renderProjectionBytes(desktopView.projection),
    );
    const terminal = (cliView.projection as { readonly terminal?: Record<string, unknown> })
      .terminal;
    expect(terminal?.['requestFulfillment']).toBe('COMPLETE');
    expect(
      (cliView.projection as { readonly validatedSuccessCount?: number }).validatedSuccessCount,
    ).toBe(3);
    await cli.close();
    await desktop.close();
  });
});
