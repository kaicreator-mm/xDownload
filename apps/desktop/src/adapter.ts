/**
 * T014 desktop UI adapter — the thin presentation/interaction surface over
 * the Core seam.
 *
 * Authority rules implemented here (fail closed; frozen L2 D10/invariant 2,
 * PRD §13/§21, L2 §6.7/§7):
 *
 * - Everything displayed is a verified Core projection or a Core-accepted
 *   command echo bound to a live projection. Interaction state (drafts,
 *   plan answers, pending selections) is non-authoritative and never merges
 *   into confirmed displays.
 * - Confirmed scope/continuation/coverage-target render immutable. Every
 *   expansion/refresh/auth-change routes a successor-identity command; the
 *   original display never mutates in place.
 * - Confirmation plans are produced by the canonical `planConfirmationWorkflow`
 *   and rendered verbatim; answers route as idempotent Core commands. The
 *   surface never invents per-item interrogation beyond the plan and never
 *   collapses a batch ambiguity into per-item prompts.
 * - Cancellation/retry route as Core control transitions; outcomes display
 *   only from resulting projections. No local timeout-cancel, no local
 *   precedence, no "recovery wins" rule.
 * - Terminal results render all six dimensions verbatim; there is no
 *   success boolean and no UI-derived completion.
 * - Core-disconnect is an explicit degraded state with no fabricated
 *   status/progress; reconnect re-syncs from projections only. The adapter
 *   holds no UI-local durable truth.
 * - Auth/action prompts originate from Core statuses; authorization context
 *   stays an opaque reference — raw reusable secrets are refused at the
 *   interaction boundary.
 */

import {
  type CommandEnvelope,
  type PeerIdentity,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamProjectionView,
  type SeamResponse,
  createSeamClient,
} from '@xdownload/core-seam';
import type { SeamDiagnostic } from '@xdownload/core-seam';
import {
  confirmContract,
  deriveSuccessorContract,
  makeAuthorizationContextRef,
  type AcquisitionContract,
  type SuccessorJustification,
  type SuccessorPatch,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import { scopeIdentityKey } from '@xdownload/domain-contracts';
import { planConfirmationWorkflow, type ConfirmationPlan } from '@xdownload/discovery-recipe';
import {
  createDesktopPeer,
  DesktopIdentitySequence,
  desktopCommand,
  desktopProjectionQuery,
} from './commands.ts';
import {
  bannerLine,
  buildSurface,
  line,
  section,
  surfaceToText,
  type DisplaySection,
  type SurfaceView,
} from './display.ts';
import {
  buildConfirmedContractPayload,
  buildSnapshotPayload,
  selectionClaimsFor,
  type DesktopIntentInput,
} from './payloads.ts';
import { verifyProjectionPayload } from './projection-decode.ts';
import {
  authPromptFromProjection,
  confirmationPlanView,
  connectionBanner,
  deriveRetryDomain,
  peerDisplay,
  resultExplanation,
  scopeDisplay,
  type ConfirmationPlanView,
  type DesktopConnectionState,
  type ScopeDisplayModel,
} from './view-model.ts';

/** Workflow facts for the confirmation plan — sourced from Core-side state. */
export interface ConfirmationWorkflowFacts {
  readonly ambiguousMaterialMemberIds: readonly string[];
  readonly candidateCount: number;
  readonly autoEvidenceSufficient: boolean;
  readonly userRequestsManualSelection?: boolean;
}

export interface TypedRejection {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface RoutedCommand {
  readonly commandType: string;
  readonly aggregateId: string;
  readonly requestId: string;
}

export interface InteractionOutcome {
  readonly display: SurfaceView;
  readonly routed: readonly RoutedCommand[];
  /** Core-typed rejections surfaced verbatim. */
  readonly rejections: readonly TypedRejection[];
  /** Adapter-level fail-closed refusals (no command routed). */
  readonly refusals: readonly string[];
}

interface AggregateRecord {
  /**
   * The exact payload Core accepted for a contract this surface submitted
   * (echo/provenance, not authority). Null when the aggregate was created
   * by another surface: no scope facts are fabricated for it.
   */
  readonly contractEcho: AcquisitionContract | null;
  snapshotEcho: {
    readonly snapshotId: string;
    readonly selectedMemberIds: readonly string[];
  } | null;
  projection: SeamProjectionView | null;
}

interface DraftState {
  readonly intent: DesktopIntentInput;
  readonly contractId: string;
  readonly plan: ConfirmationPlan;
  readonly materialDecisions: Map<string, 'CONFIRMED' | 'REJECTED'>;
}

export interface DesktopUiAdapterOptions {
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  readonly installId: string;
  readonly userId: string;
  /** ISO-8601 clock; injectable for deterministic tests. */
  readonly now?: () => string;
}

export function createDesktopUiAdapter(options: DesktopUiAdapterOptions): DesktopUiAdapter {
  return new DesktopUiAdapter(options);
}

export class DesktopUiAdapter {
  private client: SeamClient;
  private readonly transport: SeamClientTransport;
  private readonly peer: PeerIdentity;
  private readonly ids = new DesktopIdentitySequence();
  private readonly now: () => string;
  private target: SeamListenTarget;

  private connection: DesktopConnectionState = 'CONNECTED';
  private readonly aggregates = new Map<string, AggregateRecord>();
  private currentAggregateId: string | null = null;
  private draft: DraftState | null = null;
  private lastRejections: readonly TypedRejection[] = [];
  private lastRefusals: readonly string[] = [];
  private readonly sentEnvelopes: CommandEnvelope[] = [];

  constructor(options: DesktopUiAdapterOptions) {
    this.peer = createDesktopPeer({ installId: options.installId, userId: options.userId });
    this.transport = options.transport;
    this.client = createSeamClient({
      transport: options.transport,
      target: options.target,
      peer: this.peer,
    });
    this.now = options.now ?? (() => new Date().toISOString());
    this.target = options.target;
  }

  // ---- surface wiring ----------------------------------------------------

  /**
   * Re-bind to a (re)started Core endpoint (ADR-012 replaceable endpoint
   * wiring). The seam client is recreated against the new endpoint; display
   * state is rebuilt from projections only.
   */
  rebindTarget(target: SeamListenTarget): void {
    this.target = target;
    const oldClient = this.client;
    this.client = createSeamClient({
      transport: this.transport,
      target,
      peer: this.peer,
    });
    void oldClient.close();
  }

  currentTarget(): SeamListenTarget {
    return this.target;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  getDesktopPeer(): { installId: string; userId: string; surface: 'DESKTOP_UI' } {
    return { installId: this.peer.installId, userId: this.peer.userId, surface: 'DESKTOP_UI' };
  }

  currentDisplayText(): string {
    return surfaceToText(this.render());
  }

  /** The current frozen display tree (presentation only). */
  currentDisplay(): SurfaceView {
    return this.render();
  }

  lastRouted(): readonly RoutedCommand[] {
    return this.sentEnvelopes.map((envelope) => ({
      commandType: envelope.commandType,
      aggregateId: envelope.aggregateId,
      requestId: envelope.requestId,
    }));
  }

  /**
   * Observation of the exact routed envelopes (test/debug ergonomics).
   * Re-submitting one of these unchanged converges through seam idempotency.
   */
  sentCommandEnvelopes(): readonly CommandEnvelope[] {
    return [...this.sentEnvelopes];
  }

  /**
   * Presentation-only task switcher: shows another aggregate this surface
   * knows. It never changes Core state and never mutates any aggregate
   * record (the confirmed displays of all aggregates stay frozen).
   */
  viewAggregate(contractId: string): InteractionOutcome {
    this.beginInteraction();
    if (!this.aggregates.has(contractId)) {
      return this.refusalOutcome([`unknown aggregate '${contractId}'`]);
    }
    this.currentAggregateId = contractId;
    return this.outcome([]);
  }

  /**
   * Attach to an aggregate the app shell knows about (e.g. from a task list
   * or another surface's hand-off) and read its projection. The adapter
   * fabricates no scope facts for aggregates it never submitted.
   */
  async attachAggregate(contractId: string): Promise<InteractionOutcome> {
    this.beginInteraction();
    this.currentAggregateId = contractId;
    await this.readProjection(contractId);
    return this.outcome([]);
  }

  // ---- intent entry + confirmation flow ----------------------------------

  /**
   * Collect the user's structured intent and produce the scope preview plus
   * the canonical confirmation plan. No command is routed yet: the draft is
   * non-authoritative interaction state until the user's confirmation
   * interaction routes it as an idempotent command.
   */
  enterIntent(input: {
    readonly intent: DesktopIntentInput;
    readonly workflowFacts: ConfirmationWorkflowFacts;
  }): InteractionOutcome {
    this.beginInteraction();
    const shape = checkIntentShape(input.intent);
    if (!shape.ok) {
      return this.refusalOutcome([shape.message]);
    }
    const contractId = this.ids.contractId();
    const plan = planConfirmationWorkflow({
      contract: {
        automationMode: input.intent.automationMode,
        selectionPolicy: {
          basis:
            input.intent.automationMode === 'MANUAL_SELECTION'
              ? 'EXPLICIT_USER_SELECTION'
              : 'ENTIRE_REQUESTED_SCOPE',
        },
      },
      scopeScopeKey: scopeKeyOf(input.intent),
      ambiguousMaterialMemberIds: input.workflowFacts.ambiguousMaterialMemberIds,
      candidateCount: input.workflowFacts.candidateCount,
      autoEvidenceSufficient: input.workflowFacts.autoEvidenceSufficient,
      userRequestsManualSelection: input.workflowFacts.userRequestsManualSelection,
    });
    this.draft = {
      intent: input.intent,
      contractId,
      plan,
      materialDecisions: new Map(),
    };
    return this.outcome([]);
  }

  /** Answer the plan's single SCOPE_LEVEL request: submit the confirmed contract. */
  async confirmScope(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const guard = this.requireDraftRequest('SCOPE_LEVEL');
    if (guard !== null) {
      return guard;
    }
    const routed = await this.submitIntentContract();
    return this.outcome(routed);
  }

  /** AUTO with sufficient Core evidence: no confirmation prompts exist; submit directly. */
  async proceedAuto(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const draft = this.draft;
    if (draft === null) {
      return this.refusalOutcome(['no draft intent is pending']);
    }
    if (draft.plan.requests.length > 0) {
      return this.refusalOutcome([
        'AUTO plan still has confirmation requests; they must be answered before submission',
      ]);
    }
    const routed = await this.submitIntentContract();
    return this.outcome(routed);
  }

  /**
   * Answer the plan's single BATCH_GROUP request: the one batch surface
   * selects exactly the Core-presented batch set. Per-item prompts are not
   * offered for a batch-resolvable ambiguity (C30).
   */
  async confirmBatchSelection(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const guard = this.requireDraftRequest('BATCH_GROUP');
    if (guard !== null) {
      return guard;
    }
    const memberRefs = this.batchMemberRefs();
    const routed = await this.submitIntentWithSnapshot({
      level: 'BATCH_GROUP',
      requestedMemberIds: memberRefs,
      selectedMemberIds: memberRefs,
    });
    return this.outcome(routed);
  }

  /** Answer one MATERIAL_ITEM request within the canonical bound (≤3). */
  answerMaterialItem(memberRef: string, decision: 'CONFIRMED' | 'REJECTED'): InteractionOutcome {
    this.beginInteraction();
    const draft = this.draft;
    if (draft === null) {
      return this.refusalOutcome(['no draft intent is pending']);
    }
    const itemRefs = materialItemRefs(draft.plan);
    if (!itemRefs.includes(memberRef)) {
      return this.refusalOutcome([
        `member '${memberRef}' is not part of the Core-produced material-item plan; per-item interrogation beyond the plan is refused`,
      ]);
    }
    draft.materialDecisions.set(memberRef, decision);
    return this.outcome([]);
  }

  /** Route the selection after every planned material item has been answered. */
  async submitMaterialSelection(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const guard = this.requireDraftRequest('MATERIAL_ITEM');
    if (guard !== null) {
      return guard;
    }
    const draft = this.draft!;
    const itemRefs = materialItemRefs(draft.plan);
    const unanswered = itemRefs.filter((ref) => !draft.materialDecisions.has(ref));
    if (unanswered.length > 0) {
      return this.refusalOutcome([
        `material-item plan has unanswered prompts: ${unanswered.join(', ')}`,
      ]);
    }
    const selected = itemRefs.filter((ref) => draft.materialDecisions.get(ref) === 'CONFIRMED');
    if (selected.length === 0) {
      return this.refusalOutcome([
        'no material item was confirmed; empty selections are not routable',
      ]);
    }
    const routed = await this.submitIntentWithSnapshot({
      level: 'MATERIAL_ITEM',
      requestedMemberIds: itemRefs,
      selectedMemberIds: selected,
    });
    return this.outcome(routed);
  }

  /**
   * Answer the plan's MANUAL_SELECTION_UI request with a subset of the
   * Core-presented candidates. Members outside the candidate set are
   * refused — the surface never invents candidates (C30/C31).
   */
  async chooseManualSelection(selectedRefs: readonly string[]): Promise<InteractionOutcome> {
    this.beginInteraction();
    const guard = this.requireDraftRequest('MANUAL_SELECTION_UI');
    if (guard !== null) {
      return guard;
    }
    const candidates = this.manualCandidateRefs();
    const outside = selectedRefs.filter((ref) => !candidates.includes(ref));
    if (outside.length > 0) {
      return this.refusalOutcome([
        `selection contains members outside the Core-presented candidate set: ${outside.join(', ')}`,
      ]);
    }
    if (selectedRefs.length === 0) {
      return this.refusalOutcome(['empty manual selection is not routable']);
    }
    const routed = await this.submitIntentWithSnapshot({
      level: 'MANUAL_SELECTION_UI',
      requestedMemberIds: candidates,
      selectedMemberIds: [...selectedRefs],
    });
    return this.outcome(routed);
  }

  // ---- successor transitions (never in-place mutation) -------------------

  /**
   * Route any scope/continuation expansion or re-enumeration as a
   * successor-identity command. The original confirmed display is never
   * mutated; the successor is a new Core-owned aggregate.
   */
  async requestSuccessor(input: {
    readonly patch: SuccessorPatch;
    readonly justification: SuccessorJustification;
  }): Promise<InteractionOutcome> {
    this.beginInteraction();
    const record = this.requireConfirmedRecord();
    if (record === null || record.contractEcho === null) {
      return this.refusalOutcome([
        'no confirmed contract submitted by this surface is held; expansion requires a confirmed task (and successors are never derived for aggregates created by other surfaces)',
      ]);
    }
    const derived = deriveSuccessorContract(record.contractEcho, input.patch, input.justification);
    if (!derived.ok) {
      return this.coreRejectionOutcome(derived.diagnostics.map(toTypedRejection));
    }
    const confirmed = confirmContract(derived.value, this.now());
    if (!confirmed.ok) {
      return this.coreRejectionOutcome(confirmed.diagnostics.map(toTypedRejection));
    }
    // The canonical successor derivation mints the successor contract
    // identity; the command addresses exactly that identity (the decoded
    // payload must bind the addressed aggregate).
    const aggregateId = confirmed.value.contractId;
    const response = await this.submitOrDisconnect(
      desktopCommand({
        facts: {
          peer: this.peer,
          aggregateId,
          expectedRevision: 0,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
        },
        commandType: 'SUBMIT_CONTRACT',
        payload: confirmed.value,
      }),
    );
    if (response === null) {
      return this.outcome(this.lastRouted());
    }
    if (response.outcome === 'REJECTED') {
      return this.rejectedOutcome(response);
    }
    this.openAggregate(aggregateId, confirmed.value);
    await this.refresh();
    return this.outcome(this.lastRouted());
  }

  /** Route a new opaque authorization context as an authorization successor. */
  async provideAuthorizationContext(rawAuthorizationContext: unknown): Promise<InteractionOutcome> {
    this.beginInteraction();
    if (typeof rawAuthorizationContext !== 'string' || rawAuthorizationContext.length === 0) {
      return this.refusalOutcome([
        'authorization context must be an opaque reference string; raw secret material is refused at the interaction boundary',
      ]);
    }
    const decoded = makeAuthorizationContextRef(rawAuthorizationContext);
    if (!decoded.ok) {
      return this.coreRejectionOutcome(decoded.diagnostics.map(toDomainTypedRejection));
    }
    return this.requestSuccessor({
      patch: { authorizationContextRef: decoded.value },
      justification: 'AUTHORIZATION_MATERIALLY_CHANGED',
    });
  }

  // ---- control transitions -----------------------------------------------

  /** Route cancellation as a Core control transition; display follows projections. */
  async cancel(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const record = this.requireConfirmedRecord();
    if (record === null || record.projection === null) {
      return this.refusalOutcome([
        'no live Core projection is held; cancellation cannot be routed',
      ]);
    }
    const aggregateId = record.projection.contract.contractId;
    const response = await this.submitOrDisconnect(
      desktopCommand({
        facts: {
          peer: this.peer,
          aggregateId,
          expectedRevision: record.projection.contract.revision,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
          correlation: { contractId: aggregateId },
        },
        commandType: 'CANCEL_LINEAGE',
        payload: {},
      }),
    );
    if (response === null) {
      return this.outcome(this.lastRouted());
    }
    if (response.outcome === 'REJECTED') {
      // Re-sync so the display reflects Core state, then surface the rejection.
      await this.refresh();
      return this.rejectedOutcome(response);
    }
    await this.refresh();
    return this.outcome(this.lastRouted());
  }

  /**
   * Route retry on the original failed-member identity domain only. The
   * domain is derived from projected facts; when the projection does not
   * expose it the retry is refused (never guessed).
   */
  async retryFailed(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const record = this.requireConfirmedRecord();
    if (record === null || record.projection === null) {
      return this.refusalOutcome(['no live Core projection is held; retry cannot be routed']);
    }
    const projection = record.projection;
    const domain = deriveRetryDomain({
      selectedMemberIds: projection.snapshot?.selectedMemberIds ?? [],
      retriedMemberIds: projection.lineage.retriedMemberIds,
      failedMemberCount: projection.lineage.failedMemberCount,
    });
    if (domain.kind === 'UNAVAILABLE') {
      return this.refusalOutcome([`retry unavailable: ${domain.reason}`]);
    }
    const aggregateId = projection.contract.contractId;
    const response = await this.submitOrDisconnect(
      desktopCommand({
        facts: {
          peer: this.peer,
          aggregateId,
          expectedRevision: projection.contract.revision,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
          correlation: { contractId: aggregateId },
        },
        commandType: 'RETRY_FAILED_MEMBERS',
        payload: { memberIds: [...domain.memberIds] },
      }),
    );
    if (response === null) {
      return this.outcome(this.lastRouted());
    }
    if (response.outcome === 'REJECTED') {
      await this.refresh();
      return this.rejectedOutcome(response);
    }
    await this.refresh();
    return this.outcome(this.lastRouted());
  }

  // ---- projection re-sync -------------------------------------------------

  /** Re-read the current aggregate's projection and rebuild the display from it. */
  async refresh(): Promise<InteractionOutcome> {
    this.beginInteraction();
    if (this.currentAggregateId !== null) {
      await this.readProjection(this.currentAggregateId);
    }
    return this.outcome([]);
  }

  private async readProjection(aggregateId: string): Promise<
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly reason: 'DISCONNECTED' | 'STALE_PROJECTION' | 'UNPARSEABLE_PROJECTION';
      }
  > {
    let response: SeamResponse;
    try {
      response = await this.client.submitQuery(
        desktopProjectionQuery({
          peer: this.peer,
          aggregateId,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
        }),
      );
    } catch {
      this.connection = 'DISCONNECTED';
      return { ok: false, reason: 'DISCONNECTED' };
    }
    if (response.outcome === 'REJECTED') {
      this.recordRejections(response);
      this.connection = 'STALE_PROJECTION';
      return { ok: false, reason: 'STALE_PROJECTION' };
    }
    const verified = verifyProjectionPayload(response.projection, aggregateId);
    if (!verified.ok) {
      this.connection = 'UNPARSEABLE_PROJECTION';
      this.lastRefusals = [`projection verification failed: ${verified.detail}`];
      return { ok: false, reason: 'UNPARSEABLE_PROJECTION' };
    }
    const record = this.aggregates.get(aggregateId);
    if (record !== undefined) {
      record.projection = verified.view;
    } else {
      // Aggregate created by another surface (C13 concurrency): render from
      // the projection alone; no scope echo exists and none is fabricated.
      this.aggregates.set(aggregateId, {
        contractEcho: null,
        snapshotEcho: null,
        projection: verified.view,
      });
    }
    this.connection = 'CONNECTED';
    this.currentAggregateId = aggregateId;
    return { ok: true };
  }

  // ---- submission helpers -------------------------------------------------

  private async submitIntentContract(): Promise<readonly RoutedCommand[]> {
    const draft = this.draft!;
    const contract = buildConfirmedContractPayload({
      intent: draft.intent,
      contractId: draft.contractId,
      confirmedAt: this.now(),
    });
    if (!contract.ok) {
      return this.coreRejectionOutcome(contract.diagnostics.map(toDomainTypedRejection)).routed;
    }
    const response = await this.submitOrDisconnect(
      desktopCommand({
        facts: {
          peer: this.peer,
          aggregateId: draft.contractId,
          expectedRevision: 0,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
        },
        commandType: 'SUBMIT_CONTRACT',
        payload: contract.value,
      }),
    );
    if (response === null) {
      return this.lastRouted();
    }
    if (response.outcome === 'REJECTED') {
      this.recordRejections(response);
      return this.lastRouted();
    }
    this.openAggregate(draft.contractId, contract.value);
    this.draft = null;
    await this.refresh();
    return this.lastRouted();
  }

  private async submitIntentWithSnapshot(input: {
    readonly level: 'BATCH_GROUP' | 'MATERIAL_ITEM' | 'MANUAL_SELECTION_UI';
    readonly requestedMemberIds: readonly string[];
    readonly selectedMemberIds: readonly string[];
  }): Promise<readonly RoutedCommand[]> {
    await this.submitIntentContract();
    const record = this.requireConfirmedRecord();
    if (record === null || record.projection === null || record.contractEcho === null) {
      // Contract was not accepted (or Core is unreachable): no snapshot routes.
      return this.lastRouted();
    }
    const aggregateId = record.contractEcho.contractId;
    const snapshotId = this.ids.snapshotId();
    const claims = selectionClaimsFor({
      level: input.level,
      memberIds: input.selectedMemberIds,
    });
    if (!claims.ok) {
      return this.coreRejectionOutcome(claims.diagnostics.map(toDomainTypedRejection)).routed;
    }
    const response = await this.submitOrDisconnect(
      desktopCommand({
        facts: {
          peer: this.peer,
          aggregateId,
          expectedRevision: record.projection.contract.revision,
          requestId: this.ids.requestId(),
          issuedAt: this.now(),
          correlation: { contractId: aggregateId },
        },
        commandType: 'CONFIRM_SNAPSHOT',
        payload: buildSnapshotPayload({
          contract: record.contractEcho,
          snapshotId,
          requestedMemberIds: input.requestedMemberIds,
          selectedMemberIds: input.selectedMemberIds,
          claims: claims.value,
          createdAt: this.now(),
        }),
      }),
    );
    if (response === null) {
      return this.lastRouted();
    }
    if (response.outcome === 'REJECTED') {
      await this.refresh();
      this.recordRejections(response);
      return this.lastRouted();
    }
    record.snapshotEcho = {
      snapshotId,
      selectedMemberIds: [...input.selectedMemberIds],
    };
    await this.refresh();
    return this.lastRouted();
  }

  private async submitOrDisconnect(envelope: CommandEnvelope): Promise<SeamResponse | null> {
    this.sentEnvelopes.push(envelope);
    try {
      return await this.client.submitCommand(envelope);
    } catch {
      this.connection = 'DISCONNECTED';
      return null;
    }
  }

  private openAggregate(aggregateId: string, contractEcho: AcquisitionContract): void {
    this.aggregates.set(aggregateId, {
      contractEcho,
      snapshotEcho: null,
      projection: null,
    });
    this.currentAggregateId = aggregateId;
  }

  private recordRejections(response: SeamResponse): void {
    this.lastRejections = (response.diagnostics ?? []).map(toTypedRejection);
  }

  private rejectedOutcome(response: SeamResponse): InteractionOutcome {
    this.recordRejections(response);
    return this.outcome([]);
  }

  private coreRejectionOutcome(rejections: readonly TypedRejection[]): InteractionOutcome {
    this.lastRejections = rejections;
    return this.outcome([]);
  }

  private refusalOutcome(messages: readonly string[]): InteractionOutcome {
    this.lastRefusals = [...messages];
    return this.outcome([]);
  }

  // ---- draft guards --------------------------------------------------------

  private requireDraftRequest(
    level: 'SCOPE_LEVEL' | 'BATCH_GROUP' | 'MATERIAL_ITEM' | 'MANUAL_SELECTION_UI',
  ): InteractionOutcome | null {
    const draft = this.draft;
    if (draft === null) {
      return this.refusalOutcome(['no draft intent is pending']);
    }
    const present = draft.plan.requests.some((request) => request.level === level);
    if (!present) {
      return this.refusalOutcome([
        `the Core-produced confirmation plan has no ${level} request; inventing one is refused`,
      ]);
    }
    return null;
  }

  private batchMemberRefs(): readonly string[] {
    const draft = this.draft!;
    for (const request of draft.plan.requests) {
      if (request.level === 'BATCH_GROUP') {
        return [...request.memberRefs];
      }
    }
    return [];
  }

  private manualCandidateRefs(): readonly string[] {
    const draft = this.draft!;
    for (const request of draft.plan.requests) {
      if (request.level === 'MANUAL_SELECTION_UI') {
        return [...request.candidateRefs];
      }
    }
    return [];
  }

  private requireConfirmedRecord(): AggregateRecord | null {
    if (this.currentAggregateId === null) {
      return null;
    }
    return this.aggregates.get(this.currentAggregateId) ?? null;
  }

  // ---- rendering -----------------------------------------------------------

  /**
   * Rejections/refusals belong to the interaction that produced them: each
   * new user interaction starts with a clean slate (the display shows the
   * latest interaction's surfaced diagnostics, never stale ones).
   */
  private beginInteraction(): void {
    this.lastRejections = [];
    this.lastRefusals = [];
  }

  private outcome(routed: readonly RoutedCommand[]): InteractionOutcome {
    return {
      display: this.render(),
      routed,
      rejections: this.lastRejections,
      refusals: this.lastRefusals,
    };
  }

  private render(): SurfaceView {
    const sections: DisplaySection[] = [];
    const banner = connectionBanner(this.connection);
    if (banner !== null) {
      sections.push(section('Connection', [bannerLine(banner)]));
    }
    const draft = this.draft;
    if (draft !== null) {
      sections.push(...renderDraftSections(draft));
      return buildSurface({ screen: 'intent-preview', connection: this.connection, sections });
    }
    const record = this.requireConfirmedRecord();
    if (record === null) {
      sections.push(section('Task', [line('state', 'no active task — enter an intent to begin')]));
      return buildSurface({ screen: 'idle', connection: this.connection, sections });
    }
    sections.push(
      ...renderAggregateSections(record, this.peer, this.lastRejections, this.lastRefusals),
    );
    return buildSurface({ screen: 'task-status', connection: this.connection, sections });
  }
}

function materialItemRefs(plan: ConfirmationPlan): readonly string[] {
  return plan.requests.flatMap((request) =>
    request.level === 'MATERIAL_ITEM' ? [request.memberRef] : [],
  );
}

function toTypedRejection(diagnostic: SeamDiagnostic): TypedRejection {
  return { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message };
}

function toDomainTypedRejection(diagnostic: {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}): TypedRejection {
  return { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message };
}

function describeRequest(request: ConfirmationPlan['requests'][number]): string {
  switch (request.level) {
    case 'SCOPE_LEVEL':
      return `SCOPE_LEVEL (${request.scopeKey})`;
    case 'BATCH_GROUP':
      return `BATCH_GROUP (${String(request.memberRefs.length)} member(s))`;
    case 'MATERIAL_ITEM':
      return `MATERIAL_ITEM (${request.memberRef})`;
    case 'MANUAL_SELECTION_UI':
      return `MANUAL_SELECTION_UI (${String(request.candidateRefs.length)} candidate(s))`;
  }
}

function scopeKeyOf(intent: DesktopIntentInput): string {
  const scope = intent.requestedScope;
  const collection = 'collectionIdentity' in scope ? (scope.collectionIdentity ?? '') : '';
  return `${scope.kind}:${collection}`;
}

function checkIntentShape(
  intent: DesktopIntentInput,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (intent.intentType === 'SINGLE_RESOURCE' && intent.requestedScope.kind !== 'single_resource') {
    return { ok: false, message: 'SINGLE_RESOURCE intent requires a single_resource scope' };
  }
  if (intent.intentType === 'COLLECTION' && intent.requestedScope.kind === 'single_resource') {
    return { ok: false, message: 'COLLECTION intent cannot use a single_resource scope' };
  }
  if (
    typeof intent.authorizationContextRef !== 'string' ||
    intent.authorizationContextRef.length === 0
  ) {
    return { ok: false, message: 'authorization context must be an opaque reference string' };
  }
  return { ok: true };
}

function renderDraftSections(draft: DraftState): readonly DisplaySection[] {
  const sections: DisplaySection[] = [
    section('Intent (DRAFT — not confirmed, not authoritative)', [
      line('target', draft.intent.targetRef),
      line('intent type', draft.intent.intentType),
      line('requested scope', JSON.stringify(draft.intent.requestedScope)),
      line('continuation scope', JSON.stringify(draft.intent.continuationScope)),
      line('authorization context', draft.intent.authorizationContextRef, 'opaque reference'),
    ]),
  ];
  const planView: ConfirmationPlanView = confirmationPlanView(draft.plan);
  const planLines = [
    line('automation mode', planView.automationMode),
    line('selection-only proof', planView.selectionOnlyNote),
  ];
  for (const request of planView.requests) {
    planLines.push(
      line(
        'confirmation request',
        describeRequest(request.request),
        `proves ${request.proofNote.proves}`,
      ),
    );
  }
  if (planView.requests.length === 0) {
    planLines.push(line('confirmation requests', 'none — AUTO with sufficient Core evidence'));
  }
  if (planView.escalationReason !== null) {
    planLines.push(line('escalation', planView.escalationReason));
  }
  for (const request of draft.plan.requests) {
    if (request.level === 'MATERIAL_ITEM') {
      const decision = draft.materialDecisions.get(request.memberRef);
      planLines.push(
        line(
          'material item',
          request.memberRef,
          decision === undefined ? 'awaiting answer' : `answered ${decision}`,
        ),
      );
    }
  }
  sections.push(section('Confirmation plan (Core-produced)', planLines));
  return sections;
}

function renderAggregateSections(
  record: AggregateRecord,
  peer: PeerIdentity,
  rejections: readonly TypedRejection[],
  refusals: readonly string[],
) {
  const sections: DisplaySection[] = [];
  const projection = record.projection;
  const echo = record.contractEcho;
  if (echo === null) {
    // Aggregate created by another surface: only projection facts are shown.
    sections.push(
      section('Contract (created by another surface — projection only)', [
        line('contract id', projection?.contract.contractId ?? 'unknown'),
        line(
          'projection',
          projection === null
            ? 'not yet read from Core'
            : `revision ${String(projection.contract.revision)} — ${projection.contract.status}`,
        ),
        line(
          'scope payload',
          'not held by this surface; Core projection is the only display source',
        ),
      ]),
    );
    if (projection !== null) {
      sections.push(...renderProjectionSections(projection));
    }
    sections.push(...renderDiagnosticsSections(rejections, refusals));
    sections.push(section('Surface identity', [line('peer', peerDisplay(peer))]));
    return sections;
  }
  sections.push(
    section('Contract', [
      line('contract id', echo.contractId, 'Core-accepted'),
      line(
        'projection',
        projection === null
          ? 'not yet read from Core'
          : `revision ${String(projection.contract.revision)} — ${projection.contract.status}`,
      ),
    ]),
  );
  const revision = projection?.contract.revision ?? 0;
  const scopeModel: ScopeDisplayModel = scopeDisplay({
    contractId: echo.contractId,
    contractRevision: revision,
    requestedScope: echo.requestedScope,
    continuationScope: echo.continuationScope,
    snapshotCoverage:
      record.snapshotEcho === null
        ? null
        : {
            collectionIdentity: echo.collectionIdentity ?? null,
            scopeKind: echo.requestedScope.kind,
            scopeIdentityKey: scopeIdentityKey(echo.requestedScope),
            snapshotVersion: 1,
            confirmed: true,
          },
  });
  sections.push(
    section('Confirmed scope (immutable — changes require a successor command)', [
      line('requested scope', JSON.stringify(scopeModel.requestedScope), scopeModel.provenance),
      line('continuation scope', JSON.stringify(scopeModel.continuationScope)),
      line(
        'coverage target',
        scopeModel.coverageTarget === null
          ? 'not yet frozen (no confirmed selection snapshot)'
          : `${scopeModel.coverageTarget.scopeKind} @ snapshot ${record.snapshotEcho?.snapshotId ?? 'unknown'}`,
      ),
      line('immutability', 'display is read-only; expansion routes a successor identity'),
    ]),
  );
  if (projection !== null) {
    sections.push(...renderProjectionSections(projection, echo));
  }
  sections.push(...renderDiagnosticsSections(rejections, refusals));
  sections.push(section('Surface identity', [line('peer', peerDisplay(peer))]));
  return sections;
}

/** Surfaced Core-typed rejections and adapter fail-closed refusals. */
function renderDiagnosticsSections(
  rejections: readonly TypedRejection[],
  refusals: readonly string[],
): DisplaySection[] {
  const sections: DisplaySection[] = [];
  if (rejections.length > 0) {
    sections.push(
      section('Core rejections (surfaced verbatim)', [
        ...rejections.map((rejection) =>
          line(rejection.code, `${rejection.path}: ${rejection.message}`),
        ),
      ]),
    );
  }
  if (refusals.length > 0) {
    sections.push(
      section(
        'Surface refusals (fail-closed)',
        refusals.map((refusal) => line('refused', refusal)),
      ),
    );
  }
  return sections;
}

function renderProjectionSections(
  projection: SeamProjectionView,
  echo?: AcquisitionContract,
): DisplaySection[] {
  const sections: DisplaySection[] = [
    section('Selection / progress (Core projection)', [
      line(
        'selected members',
        projection.snapshot === undefined
          ? 'no confirmed selection snapshot'
          : `${String(projection.snapshot.selectedMemberIds.length)} member(s) bound to snapshot ${projection.snapshot.snapshotId}`,
      ),
      line('lineage status', projection.lineage.status),
      line('failed members', String(projection.lineage.failedMemberCount)),
      line('retried members', projection.lineage.retriedMemberIds.join(', ') || 'none'),
    ]),
  ];
  const terminal = projection.terminal;
  if (terminal === undefined) {
    return sections;
  }
  const explanation = resultExplanation(terminal);
  sections.push(
    section('Result explanation (rendered verbatim from the Core projection)', [
      line('request fulfillment', explanation.requestFulfillment),
      line('target resolution', explanation.targetResolution),
      line('selection acquisition', explanation.selectionAcquisition),
      line('coverage', explanation.coverage),
      line('stop reason', explanation.stopReason),
      line(
        'validation summary',
        `${explanation.validationSummary.status} (passed ${String(explanation.validationSummary.passedCount)}, failed ${String(explanation.validationSummary.failedCount)})`,
      ),
      ...explanation.visibilityNotes.map((note) => line('visibility', note)),
    ]),
  );
  const authPrompt = authPromptFromProjection({
    authorizationContextRef: echo?.authorizationContextRef ?? terminal.contractId,
    terminal,
    lineageStatus: projection.lineage.status,
  });
  if (authPrompt !== null) {
    sections.push(
      section('Authorization / action prompt (Core-sourced)', [
        line('prompt', authPrompt.kind),
        line('detail', authPrompt.detail),
        line(
          'authorization context',
          authPrompt.authorizationContextRef,
          'opaque reference — provide a new context to route a successor command',
        ),
        line('partial truth', 'the underlying projected result is shown above'),
      ]),
    );
  }
  return sections;
}

// Re-export for app-shell ergonomics; no additional semantics.
export type { ConfirmationPlanView, ScopeDisplayModel, SurfaceView, TerminalResult };
export { surfaceToText };
