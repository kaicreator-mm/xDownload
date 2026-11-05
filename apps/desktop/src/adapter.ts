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
  type QueryEnvelope,
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
  buildS1DirectExecutionPayload,
  deriveS1ExecutionIdentities,
  desktopCommand,
  desktopProjectionQuery,
  desktopS1JobIndexQuery,
  s1CompositeEffectIdentity,
  s1EffectIdentityWithinBound,
  S1_JOB_INDEX_MAX_ITEMS,
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

/**
 * Workflow facts for the confirmation plan — sourced from Core-side state.
 *
 * v1 interface gap 3 of 3 (recorded per review 5980174310, T014-REV-P2-3):
 * the v1 seam exposes no discovery-facts projection, so these facts reach
 * the canonical `planConfirmationWorkflow` as trusted CALLER inputs. The
 * plan producer is Core-side canonical and this surface invents no fact,
 * but a real shell MUST source candidateCount, ambiguousMaterialMemberIds
 * and autoEvidenceSufficient from Core discovery state — never from
 * surface-local guesses — or the canonical plan would be computed over
 * caller-asserted inputs. (Gap 1: failed-member identities are not exposed
 * by the projection, see deriveRetryDomain; gap 2: confirmed-scope display
 * is echo-bound while the live projection still binds the contract, see
 * ScopeDisplayModel.)
 */
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

export type CommandDeliveryStatus = 'NOT_ATTEMPTED' | 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

export interface CommandDelivery {
  readonly status: CommandDeliveryStatus;
  readonly commandType: string | null;
  readonly aggregateId: string | null;
  readonly requestId: string | null;
}

const NOT_ATTEMPTED_DELIVERY: CommandDelivery = {
  status: 'NOT_ATTEMPTED',
  commandType: null,
  aggregateId: null,
  requestId: null,
};

export interface InteractionOutcome {
  readonly display: SurfaceView;
  /** Commands for which this adapter received a Core ACCEPTED response. */
  readonly routed: readonly RoutedCommand[];
  /** Delivery disposition of the current interaction's command, if any. */
  readonly delivery: CommandDelivery;
  /** Core-typed rejections surfaced verbatim. */
  readonly rejections: readonly TypedRejection[];
  /** Adapter-level fail-closed refusals (no command attempted). */
  readonly refusals: readonly string[];
}

/**
 * The typed result of the read-only `LIST_S1_JOB_PROJECTIONS` index query
 * (U05-T02). A rejection or a disconnect is an explicit degraded fact —
 * never an empty successful list (L2 U05 §2/§5).
 */
export type S1JobIndexFailure =
  | { readonly reason: 'DISCONNECTED' }
  | { readonly reason: 'REJECTED' }
  | { readonly reason: 'MALFORMED_INDEX'; readonly detail: string };

export type S1JobIndexResult =
  | {
      readonly ok: true;
      readonly items: readonly SeamProjectionView[];
      readonly totalCount: number;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly failure: S1JobIndexFailure };

interface S1ExecutionRecord {
  /**
   * The exact envelope routed for this logical S1 command. Retries and
   * reconnects re-send this identical envelope — same request identity, same
   * derived snapshot/member/artifact identities — so the seam's idempotency
   * converges them; no second identity and no local durable store is created
   * (L2 U05 §3).
   */
  readonly envelope: CommandEnvelope;
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
  /**
   * The locator this surface submitted for the contract (echo of this
   * surface's own intent input; the canonical contract echo carries only the
   * derived logical target id). Null for aggregates this surface never
   * submitted — delivery facts are never fabricated for them.
   */
  submittedLocatorUri: string | null;
  s1Execution: S1ExecutionRecord | null;
}

interface DraftState {
  readonly intent: DesktopIntentInput;
  readonly contractId: string;
  readonly plan: ConfirmationPlan;
  readonly materialDecisions: Map<string, 'CONFIRMED' | 'REJECTED'>;
  /** Exact contract envelope retained when its delivery is ambiguous. */
  pendingEnvelope: CommandEnvelope | null;
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
  private readonly acknowledgedEnvelopes: CommandEnvelope[] = [];
  private readonly acceptedEnvelopes: CommandEnvelope[] = [];
  private pendingCommandEnvelope: CommandEnvelope | null = null;
  private currentDelivery: CommandDelivery = NOT_ATTEMPTED_DELIVERY;

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
    return this.acceptedEnvelopes.map((envelope) => ({
      commandType: envelope.commandType,
      aggregateId: envelope.aggregateId,
      requestId: envelope.requestId,
    }));
  }

  /** The unresolved command identity, if a prior transport result was ambiguous. */
  pendingCommandInfo(): CommandDelivery | null {
    const envelope = this.pendingCommandEnvelope;
    if (envelope === null) return null;
    return {
      status: 'UNKNOWN',
      commandType: envelope.commandType,
      aggregateId: envelope.aggregateId,
      requestId: envelope.requestId,
    };
  }

  /** Exact command attempts, including retries and ambiguous deliveries (diagnostics only). */
  sentCommandEnvelopes(): readonly CommandEnvelope[] {
    return [...this.sentEnvelopes];
  }

  /** Envelopes for which Core returned either ACCEPTED or REJECTED. */
  acknowledgedCommandEnvelopes(): readonly CommandEnvelope[] {
    return [...this.acknowledgedEnvelopes];
  }

  /**
   * The verified Core projection of the current aggregate, verbatim, or null
   * when none is held (never a synthesized view). Read-only presentation
   * fact for shell surfaces that render structured job rows (T08).
   */
  currentProjectionView(): SeamProjectionView | null {
    const record = this.requireConfirmedRecord();
    return record?.projection ?? null;
  }

  /**
   * Discard the pending draft intent (presentation-only interaction state —
   * no command was routed, so nothing is rolled back on the Core side).
   */
  discardDraft(): InteractionOutcome {
    this.beginInteraction();
    if (this.pendingCommandEnvelope !== null) {
      return this.refusalOutcome([
        'a command is awaiting Core acknowledgement; reconcile the exact request before discarding or starting another action',
      ]);
    }
    this.draft = null;
    return this.outcome([]);
  }

  /** True while a draft intent is pending (the preview step is open). */
  hasDraftIntent(): boolean {
    return this.draft !== null;
  }

  /**
   * The pending draft rendered as a structured view (the non-authoritative
   * add preview): the minted draft contract id plus the Core-produced
   * confirmation plan, verbatim. Null when no draft is pending.
   */
  currentDraftView(): {
    readonly contractId: string;
    readonly automationMode: string;
    readonly targetRef: string;
    readonly requests: readonly {
      readonly level: string;
      readonly description: string;
      readonly proves: string;
    }[];
  } | null {
    const draft = this.draft;
    if (draft === null) {
      return null;
    }
    const planView = confirmationPlanView(draft.plan);
    return {
      contractId: draft.contractId,
      automationMode: planView.automationMode,
      targetRef: draft.intent.targetRef,
      requests: planView.requests.map((request) => ({
        level: request.request.level,
        description: describeRequest(request.request),
        proves: request.proofNote.proves,
      })),
    };
  }

  /**
   * Presentation-only task switcher: shows another aggregate this surface
   * knows. It never changes Core state and never mutates any aggregate
   * record (the confirmed displays of all aggregates stay frozen).
   */
  viewAggregate(contractId: string): InteractionOutcome {
    this.beginInteraction();
    if (
      this.pendingCommandEnvelope !== null &&
      this.pendingCommandEnvelope.aggregateId !== contractId
    ) {
      return this.refusalOutcome([
        'a command is awaiting Core acknowledgement for another aggregate; reconcile it before switching tasks',
      ]);
    }
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
    if (
      this.pendingCommandEnvelope !== null &&
      this.pendingCommandEnvelope.aggregateId !== contractId
    ) {
      return this.refusalOutcome([
        'a command is awaiting Core acknowledgement for another aggregate; reconcile it before switching tasks',
      ]);
    }
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
    if (this.pendingCommandEnvelope !== null) {
      return this.refusalOutcome([
        'a command is awaiting Core acknowledgement; reconcile the exact request before creating another preview',
      ]);
    }
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
      pendingEnvelope: null,
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
    this.openAggregate(aggregateId, confirmed.value, null);
    await this.refreshAfterCommand();
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
    const pending = this.pendingCommandEnvelope;
    const envelope =
      pending?.commandType === 'CANCEL_LINEAGE' && pending.aggregateId === aggregateId
        ? pending
        : desktopCommand({
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
          });
    const response = await this.submitOrDisconnect(envelope);
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
    const pending = this.pendingCommandEnvelope;
    const envelope =
      pending?.commandType === 'RETRY_FAILED_MEMBERS' && pending.aggregateId === aggregateId
        ? pending
        : desktopCommand({
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
          });
    const response = await this.submitOrDisconnect(envelope);
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

  // ---- S1 direct acquisition (U05-T02) ------------------------------------

  /**
   * Route the existing Core `EXECUTE_S1_DIRECT_ACQUISITION` command for the
   * single-resource task this surface just confirmed (frozen L2 U05 §1/§3).
   * The CLI sequence is the mapping reference; the Desktop adds no transfer
   * implementation. The command binds the contract accepted by the same
   * Desktop interaction, carries canonical snapshot/member/artifact
   * identities derived once, and defaults `declaredRedirectHosts` to the
   * submitted URL's own host only (no implicit widening; the optional
   * digest/content-type/total-byte fields stay absent from the U05 form).
   *
   * Command acceptance is admission only — never acquisition success. The
   * display re-reads `READ_PROJECTION` and only Core projection facts update
   * status/terminal truth. A repeat invocation (retry after a disconnect, or
   * a duplicate interaction) re-sends the identical envelope so the seam's
   * idempotency converges on the same logical request identity; no second
   * identity and no local durable store is created.
   */
  async executeS1Direct(): Promise<InteractionOutcome> {
    this.beginInteraction();
    const record = this.requireConfirmedRecord();
    if (record === null || record.contractEcho === null) {
      return this.refusalOutcome([
        'no confirmed contract submitted by this surface is held; S1 direct acquisition requires a task this surface confirmed',
      ]);
    }
    if (record.projection === null) {
      return this.refusalOutcome([
        'no live Core projection is held for this task; refresh from Core before starting an S1 acquisition',
      ]);
    }
    const contract = record.contractEcho;
    if (
      contract.intentType !== 'SINGLE_RESOURCE' ||
      contract.requestedScope.kind !== 'single_resource'
    ) {
      return this.refusalOutcome([
        'the S1 direct-acquisition lane serves SINGLE_RESOURCE single-resource contracts only',
      ]);
    }
    if (record.s1Execution !== null) {
      // Retry/reconnect or duplicate interaction: re-send the identical
      // envelope (same request identity, same derived identities).
      return this.submitS1Execution(record.s1Execution.envelope);
    }
    if (record.submittedLocatorUri === null) {
      return this.refusalOutcome([
        'this surface holds no submitted locator for the task; S1 delivery facts are never fabricated',
      ]);
    }
    const identities = deriveS1ExecutionIdentities(contract.contractId);
    if (!identities.ok) {
      return this.coreRejectionOutcome(identities.diagnostics.map(toDomainTypedRejection));
    }
    const payload = buildS1DirectExecutionPayload({
      identities: identities.value,
      locatorUri: record.submittedLocatorUri,
    });
    if (!payload.ok) {
      return this.coreRejectionOutcome(payload.diagnostics.map(toDomainTypedRejection));
    }
    // The canonical composite effect identity bound is enforced Core-side;
    // an identity that can never execute rejects here, before any routing.
    const effectIdentity = s1CompositeEffectIdentity({
      contractId: contract.contractId,
      snapshotId: payload.value.snapshotId,
      requestedTarget: contract.requestedTarget,
    });
    if (!s1EffectIdentityWithinBound(effectIdentity)) {
      return this.refusalOutcome([
        'the canonical composite effect identity exceeds the 128-character bound; the S1 command can never execute and is not routed',
      ]);
    }
    const envelope = desktopCommand({
      facts: {
        peer: this.peer,
        aggregateId: contract.contractId,
        expectedRevision: record.projection.contract.revision,
        requestId: this.ids.requestId(),
        issuedAt: this.now(),
        correlation: { contractId: contract.contractId },
      },
      commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
      payload: payload.value,
    });
    // The envelope is retained before submission so a disconnect preserves
    // the exact logical command for the idempotent re-send.
    record.s1Execution = { envelope };
    return this.submitS1Execution(envelope);
  }

  /**
   * The typed read-only `LIST_S1_JOB_PROJECTIONS` adapter call (L2 U05 §2/§3).
   * The response payload is validated strictly — closed shape, the 200-entry
   * bound, post-filter `totalCount`, the exact latest-page cardinality
   * `items.length === Math.min(totalCount, 200)`, the exact
   * `truncated === totalCount > items.length` consistency, per-item projection
   * verification with the existing decoder/binding checks and
   * aggregate-identity uniqueness. A typed rejection or a disconnect is
   * returned as an explicit failure — never as an empty successful list.
   */
  async listS1JobProjections(): Promise<S1JobIndexResult> {
    const envelope = desktopS1JobIndexQuery({
      peer: this.peer,
      requestId: this.ids.requestId(),
      issuedAt: this.now(),
    });
    let response: SeamResponse;
    try {
      // Vocabulary bridge: the closed seam query type gains this discriminant
      // with the T01 Core-side index (schema 1.4.0); the adapter's own typed
      // envelope crosses the unchanged client surface at exactly this site.
      response = await this.client.submitQuery(envelope as unknown as QueryEnvelope);
    } catch {
      this.connection = 'DISCONNECTED';
      return { ok: false, failure: { reason: 'DISCONNECTED' } };
    }
    if (response.outcome === 'REJECTED') {
      this.recordRejections(response);
      this.connection = 'CONNECTED';
      return { ok: false, failure: { reason: 'REJECTED' } };
    }
    const verified = verifyS1JobIndexPayload(response.projection);
    if (!verified.ok) {
      return { ok: false, failure: { reason: 'MALFORMED_INDEX', detail: verified.detail } };
    }
    this.connection = 'CONNECTED';
    return { ok: true, ...verified.value };
  }

  private async submitS1Execution(envelope: CommandEnvelope): Promise<InteractionOutcome> {
    const response = await this.submitOrDisconnect(envelope);
    if (response === null) {
      // Disconnected: the retained envelope keeps the logical command alive
      // for the idempotent re-send; nothing is fabricated locally.
      return this.outcome(this.lastRouted());
    }
    if (response.outcome === 'REJECTED') {
      // Core refused admission: surface the typed rejection verbatim and
      // re-sync the display from the projection (no acceptance-as-success).
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
        readonly reason:
          'DISCONNECTED' | 'REJECTED_PROJECTION' | 'STALE_PROJECTION' | 'UNPARSEABLE_PROJECTION';
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
      // Repair note (T014-REV-P2-2, review 5980174310): a rejected read is
      // labeled as exactly that — Core refused to serve a projection — and
      // never as a "stale" projection that could not be refreshed.
      this.recordRejections(response);
      this.connection = 'REJECTED_PROJECTION';
      return { ok: false, reason: 'REJECTED_PROJECTION' };
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
        submittedLocatorUri: null,
        s1Execution: null,
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
    const envelope =
      draft.pendingEnvelope ??
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
      });
    draft.pendingEnvelope = envelope;
    const response = await this.submitOrDisconnect(envelope);
    if (response === null) {
      return this.lastRouted();
    }
    if (response.outcome === 'REJECTED') {
      this.recordRejections(response);
      return this.lastRouted();
    }
    draft.pendingEnvelope = null;
    this.openAggregate(draft.contractId, contract.value, draft.intent.targetRef);
    this.draft = null;
    await this.refreshAfterCommand();
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
    if (this.pendingCommandEnvelope !== null && this.pendingCommandEnvelope !== envelope) {
      this.lastRefusals = [
        ...this.lastRefusals,
        'a prior command is awaiting Core acknowledgement; a different command was not attempted',
      ];
      return null;
    }
    this.sentEnvelopes.push(envelope);
    try {
      const response = await this.client.submitCommand(envelope);
      const delivery: CommandDelivery = {
        status: response.outcome === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
        commandType: envelope.commandType,
        aggregateId: envelope.aggregateId,
        requestId: envelope.requestId,
      };
      this.currentDelivery = delivery;
      this.acknowledgedEnvelopes.push(envelope);
      if (
        response.outcome === 'ACCEPTED' &&
        !this.acceptedEnvelopes.some((item) => item.requestId === envelope.requestId)
      ) {
        this.acceptedEnvelopes.push(envelope);
      }
      if (this.pendingCommandEnvelope === envelope) {
        this.pendingCommandEnvelope = null;
      }
      return response;
    } catch {
      this.connection = 'DISCONNECTED';
      this.pendingCommandEnvelope = envelope;
      this.currentDelivery = {
        status: 'UNKNOWN',
        commandType: envelope.commandType,
        aggregateId: envelope.aggregateId,
        requestId: envelope.requestId,
      };
      return null;
    }
  }

  private openAggregate(
    aggregateId: string,
    contractEcho: AcquisitionContract,
    submittedLocatorUri: string | null,
  ): void {
    this.aggregates.set(aggregateId, {
      contractEcho,
      snapshotEcho: null,
      projection: null,
      submittedLocatorUri,
      s1Execution: null,
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
    this.currentDelivery = NOT_ATTEMPTED_DELIVERY;
  }

  /** Re-read projection after a command without erasing that command's disposition. */
  private async refreshAfterCommand(): Promise<void> {
    if (this.currentAggregateId !== null) {
      await this.readProjection(this.currentAggregateId);
    }
  }

  private outcome(routed: readonly RoutedCommand[]): InteractionOutcome {
    return {
      display: this.render(),
      routed,
      delivery: this.currentDelivery,
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

/**
 * Strict fail-closed verification of the raw `LIST_S1_JOB_PROJECTIONS`
 * response payload (L2 U05 §2): closed `{items, totalCount, truncated}`
 * shape, the 200-entry bound, integer non-negative `totalCount`, the exact
 * latest-page cardinality `items.length === Math.min(totalCount, 200)`, the
 * exact `truncated === totalCount > items.length` consistency, and every item
 * verified as a projection bound to its own aggregate identity, unique across
 * the page. Any violation is a typed degraded fact, never a best-effort
 * partial list.
 */
function verifyS1JobIndexPayload(raw: unknown):
  | {
      readonly ok: true;
      readonly value: { items: SeamProjectionView[]; totalCount: number; truncated: boolean };
    }
  | { readonly ok: false; readonly detail: string } {
  const malformed = (detail: string) => ({ ok: false as const, detail });
  if (!isPlainRecord(raw)) {
    return malformed('S1 job-index payload is not an object');
  }
  const unknownKeys = Object.keys(raw).filter(
    (key) => key !== 'items' && key !== 'totalCount' && key !== 'truncated',
  );
  if (unknownKeys.length > 0) {
    return malformed(`unknown field on S1 job-index payload: ${unknownKeys.join(', ')}`);
  }
  const itemsRaw = raw['items'];
  if (!Array.isArray(itemsRaw)) {
    return malformed('S1 job-index items is not an array');
  }
  if (itemsRaw.length > S1_JOB_INDEX_MAX_ITEMS) {
    return malformed(
      `S1 job-index items exceeds the ${String(S1_JOB_INDEX_MAX_ITEMS)}-entry bound`,
    );
  }
  const totalCount = raw['totalCount'];
  if (typeof totalCount !== 'number' || !Number.isInteger(totalCount) || totalCount < 0) {
    return malformed('S1 job-index totalCount is not a non-negative integer');
  }
  // The server contract returns exactly the latest min(totalCount, 200) rows:
  // a shorter page is an underfilled page and can never be presented as the
  // truthful tail of the index.
  const expectedPageSize = Math.min(totalCount, S1_JOB_INDEX_MAX_ITEMS);
  if (itemsRaw.length !== expectedPageSize) {
    return malformed(
      `S1 job-index items length ${String(itemsRaw.length)} does not equal the latest-page cardinality min(totalCount, ${String(S1_JOB_INDEX_MAX_ITEMS)}) = ${String(expectedPageSize)}`,
    );
  }
  const truncated = raw['truncated'];
  if (typeof truncated !== 'boolean') {
    return malformed('S1 job-index truncated is not a boolean');
  }
  if (truncated !== totalCount > itemsRaw.length) {
    return malformed('S1 job-index truncated does not equal (totalCount > items.length)');
  }
  const seen = new Set<string>();
  const items: SeamProjectionView[] = [];
  for (const itemRaw of itemsRaw) {
    const contractId =
      isPlainRecord(itemRaw) && isPlainRecord(itemRaw['contract'])
        ? itemRaw['contract']['contractId']
        : undefined;
    if (typeof contractId !== 'string' || contractId.length === 0) {
      return malformed('an S1 job-index item is missing its contract identity');
    }
    if (seen.has(contractId)) {
      return malformed(`S1 job-index repeats aggregate identity '${contractId}'`);
    }
    const verified = verifyProjectionPayload(itemRaw, contractId);
    if (!verified.ok) {
      return malformed(
        `S1 job-index item '${contractId}' failed projection verification: ${verified.reason} (${verified.detail})`,
      );
    }
    seen.add(contractId);
    items.push(verified.view);
  }
  return { ok: true, value: { items, totalCount, truncated } };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
