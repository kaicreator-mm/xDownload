/**
 * T014 desktop view models — the one-way projection → display mapping.
 *
 * Every view model is a pure function of Core-owned facts (verified seam
 * projections, Core-accepted command echoes bound to those projections, and
 * the canonical confirmation workflow). Nothing here decides, derives or
 * re-projects status/completion/scope/membership truth:
 *
 * - the six terminal dimensions render verbatim, never collapsed to a
 *   success boolean (PRD §16; C02/C10/C14/C15/C23/C24);
 * - confirmed scope/continuation/coverage-target display comes only from a
 *   Core-accepted SUBMIT_CONTRACT/CONFIRM_SNAPSHOT echo while the live
 *   projection still binds the same contract identity (display facts are
 *   Core-accepted provenance, never surface authority);
 * - confirmation plans are rendered exactly as produced by the canonical
 *   `planConfirmationWorkflow`; the surface adds no ordering or priority
 *   policy (PRD §13; C30);
 * - disconnect/degraded is a first-class display state, never an error path
 *   that fabricates progress (L2 §10).
 */

import type {
  AutomationMode,
  ContinuationScope,
  RequestedScope,
  TerminalResult,
} from '@xdownload/domain-contracts';
import { whatConfirmationProves } from '@xdownload/domain-contracts';
import {
  MAX_MATERIAL_ITEM_CONFIRMATIONS,
  type ConfirmationPlan,
  type ConfirmationRequest,
} from '@xdownload/discovery-recipe';
import type { PeerIdentity } from '@xdownload/core-seam';

/** Connection/degradation display state (never a status truth claim). */
export type DesktopConnectionState =
  'CONNECTED' | 'DISCONNECTED' | 'STALE_PROJECTION' | 'UNPARSEABLE_PROJECTION';

/** One confirmed immutable scope display (echo bound to a live projection). */
export interface ScopeDisplayModel {
  readonly contractId: string;
  readonly contractRevision: number;
  readonly requestedScope: RequestedScope;
  readonly continuationScope: ContinuationScope;
  readonly coverageTarget: CoverageTargetDisplay | null;
  /** Core provenance of the displayed facts. */
  readonly provenance: 'CORE_ACCEPTED_COMMAND_BOUND_TO_PROJECTION';
  readonly immutable: true;
}

export interface CoverageTargetDisplay {
  readonly collectionIdentity: string | null;
  readonly scopeKind: string;
  readonly scopeIdentityKey: string;
  readonly snapshotVersion: number;
  readonly confirmed: boolean;
}

/**
 * Truthful multi-dimensional result explanation. The model deliberately has
 * NO success/completion boolean: every dimension renders as projected.
 */
export interface ResultExplanationModel {
  readonly contractId: string;
  readonly snapshotId: string | null;
  readonly requestFulfillment: TerminalResult['requestFulfillment'];
  readonly targetResolution: TerminalResult['targetResolution'];
  readonly selectionAcquisition: TerminalResult['selectionAcquisition'];
  readonly coverage: TerminalResult['coverage'];
  readonly stopReason: TerminalResult['stopReason'];
  readonly validationSummary: TerminalResult['validationSummary'];
  readonly recordedAt: string;
  /** Visible unsupported/out-of-scope notes (never silently approximated). */
  readonly visibilityNotes: readonly string[];
}

/** One rendered confirmation request of the Core-produced plan. */
export interface ConfirmationRequestView {
  readonly request: ConfirmationRequest;
  readonly proofNote: {
    readonly proves: string;
    readonly doesNotProve: readonly string[];
  };
  readonly answerable: boolean;
}

export interface ConfirmationPlanView {
  readonly automationMode: AutomationMode;
  readonly requests: readonly ConfirmationRequestView[];
  readonly materialItemBound: number;
  readonly perItemInterrogationUsed: boolean;
  readonly escalationReason: string | null;
  readonly selectionOnlyNote: string;
}

export interface AuthPromptModel {
  readonly kind: 'AUTH_REQUIRED' | 'AUTH_BLOCKED' | 'ACTION_REQUIRED';
  readonly detail: string;
  /** Opaque authorization context reference — never secret material. */
  readonly authorizationContextRef: string;
  /** The underlying partial truth is shown alongside the prompt. */
  readonly showsPartialTruth: true;
}

/** Connection/degradation banner text, derived only from the display state. */
export function connectionBanner(state: DesktopConnectionState): string | null {
  switch (state) {
    case 'CONNECTED':
      return null;
    case 'DISCONNECTED':
      return (
        'DEGRADED: Core is disconnected. Showing last known Core state; ' +
        'no live progress, status or completion is available until reconnection.'
      );
    case 'STALE_PROJECTION':
      return (
        'DEGRADED: the last projection could not be refreshed and is stale. ' +
        'Showing last known Core state; values may be out of date.'
      );
    case 'UNPARSEABLE_PROJECTION':
      return (
        'DEGRADED: the latest projection failed verification and is not displayed. ' +
        'Re-sync from Core is required; no status is shown from unverified data.'
      );
  }
}

/**
 * Build the immutable confirmed-scope display from a Core-accepted contract
 * echo plus the live verified projection that still binds it.
 */
export function scopeDisplay(input: {
  readonly contractId: string;
  readonly contractRevision: number;
  readonly requestedScope: RequestedScope;
  readonly continuationScope: ContinuationScope;
  readonly snapshotCoverage: CoverageTargetDisplay | null;
}): ScopeDisplayModel {
  return {
    contractId: input.contractId,
    contractRevision: input.contractRevision,
    requestedScope: input.requestedScope,
    continuationScope: input.continuationScope,
    coverageTarget: input.snapshotCoverage,
    provenance: 'CORE_ACCEPTED_COMMAND_BOUND_TO_PROJECTION',
    immutable: true,
  };
}

/** Render the six result dimensions verbatim plus visibility notes. */
export function resultExplanation(terminal: TerminalResult): ResultExplanationModel {
  const notes: string[] = [];
  if (terminal.stopReason === 'UNSUPPORTED') {
    notes.push(
      'Unsupported/out-of-scope content is visible and was NOT approximated as supported.',
    );
  }
  if (terminal.stopReason === 'DISCOVERY_BUDGET_EXHAUSTED') {
    notes.push(
      'Discovery stopped at its budget: undiscovered requested content may exist and is not claimed complete.',
    );
  }
  if (terminal.stopReason === 'AUTH_REQUIRED' || terminal.stopReason === 'AUTH_FAILED') {
    notes.push(
      'Authorization is required or failed; inaccessible content is not silently dropped.',
    );
  }
  if (terminal.requestFulfillment === 'PARTIAL' || terminal.requestFulfillment === 'UNKNOWN') {
    notes.push(
      'Request fulfillment is not COMPLETE; unfulfilled requested content remains unfulfilled.',
    );
  }
  if (terminal.coverage !== 'VERIFIED_COMPLETE') {
    notes.push(
      'Coverage is not VERIFIED_COMPLETE; full requested-scope accounting is not claimed.',
    );
  }
  if (terminal.validationSummary.status === 'PARTIAL') {
    notes.push('Required validation has failed or unvalidated members; completion is not claimed.');
  }
  return {
    contractId: terminal.contractId,
    snapshotId: terminal.snapshotId ?? null,
    requestFulfillment: terminal.requestFulfillment,
    targetResolution: terminal.targetResolution,
    selectionAcquisition: terminal.selectionAcquisition,
    coverage: terminal.coverage,
    stopReason: terminal.stopReason,
    validationSummary: terminal.validationSummary,
    recordedAt: terminal.recordedAt,
    visibilityNotes: notes,
  };
}

/**
 * Render the canonical confirmation plan verbatim. Each request carries the
 * canonical proof note from `whatConfirmationProves`: confirmation proves
 * selection only and never target quality/membership truth (C26/C34).
 */
export function confirmationPlanView(plan: ConfirmationPlan): ConfirmationPlanView {
  const requests = plan.requests.map((request) => {
    const confirmationType = confirmationTypeForRequest(request);
    const proves = whatConfirmationProves(confirmationType);
    return {
      request,
      proofNote: { proves: proves.proves, doesNotProve: [...proves.doesNotProve] },
      answerable: true,
    };
  });
  return {
    automationMode: plan.automationMode,
    requests,
    materialItemBound: MAX_MATERIAL_ITEM_CONFIRMATIONS,
    perItemInterrogationUsed: plan.perItemInterrogationUsed,
    escalationReason: plan.escalationReason ?? null,
    selectionOnlyNote:
      'Confirmation resolves SELECTION only. It does not prove target quality, media, ' +
      'format or transfer truth, and it never waives required validation.',
  };
}

/** The canonical confirmation type each plan level is answered with. */
export function confirmationTypeForRequest(request: ConfirmationRequest) {
  switch (request.level) {
    case 'SCOPE_LEVEL':
      return 'CONFIRM_SELECTION' as const;
    case 'BATCH_GROUP':
      return 'CONFIRM_SELECTION' as const;
    case 'MATERIAL_ITEM':
      return 'CONFIRM_MEMBERSHIP' as const;
    case 'MANUAL_SELECTION_UI':
      return 'CONFIRM_SELECTION' as const;
  }
}

/**
 * Derive the auth/action prompt from projected Core facts only. Returns
 * null when no projected fact requires user action.
 */
export function authPromptFromProjection(input: {
  readonly authorizationContextRef: string;
  readonly terminal: TerminalResult | undefined;
  readonly lineageStatus: string | undefined;
}): AuthPromptModel | null {
  const terminal = input.terminal;
  if (terminal !== undefined && terminal.stopReason === 'AUTH_REQUIRED') {
    return {
      kind: 'AUTH_REQUIRED',
      detail: 'Core stopped with AUTH_REQUIRED: authorization is required to continue.',
      authorizationContextRef: input.authorizationContextRef,
      showsPartialTruth: true,
    };
  }
  if (terminal !== undefined && terminal.stopReason === 'AUTH_FAILED') {
    return {
      kind: 'AUTH_BLOCKED',
      detail: 'Core reports AUTH_FAILED; authorization must be provided before any retry.',
      authorizationContextRef: input.authorizationContextRef,
      showsPartialTruth: true,
    };
  }
  if (terminal !== undefined && terminal.targetResolution === 'BLOCKED') {
    return {
      kind: 'ACTION_REQUIRED',
      detail: 'Core reports target resolution BLOCKED; user action is required.',
      authorizationContextRef: input.authorizationContextRef,
      showsPartialTruth: true,
    };
  }
  if (terminal === undefined && input.lineageStatus === 'CANCELLED') {
    return {
      kind: 'ACTION_REQUIRED',
      detail: 'Core reports the lineage cancelled; a successor contract is required to continue.',
      authorizationContextRef: input.authorizationContextRef,
      showsPartialTruth: true,
    };
  }
  return null;
}

/** Retry identity domain derived strictly from Core-projected facts. */
export type RetryDomain =
  | { readonly kind: 'DETERMINED'; readonly memberIds: readonly string[] }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

/**
 * The v1 seam projection exposes the failed-member COUNT but not the failed
 * identities. Because Core guarantees retried ⊆ failed ⊆ selected, the
 * failed identity domain is uniquely determined exactly when
 * |selected \ retried| === failedMemberCount. In that case retry routes on
 * that set; otherwise the adapter refuses to guess and presents retry as
 * unavailable (fail closed, never fabricate a retry domain).
 */
export function deriveRetryDomain(input: {
  readonly selectedMemberIds: readonly string[];
  readonly retriedMemberIds: readonly string[];
  readonly failedMemberCount: number;
}): RetryDomain {
  if (input.failedMemberCount === 0) {
    return { kind: 'UNAVAILABLE', reason: 'NO_FAILED_MEMBERS' };
  }
  const retried = new Set(input.retriedMemberIds);
  const candidates = input.selectedMemberIds.filter((memberId) => !retried.has(memberId));
  if (candidates.length !== input.failedMemberCount) {
    return {
      kind: 'UNAVAILABLE',
      reason: 'FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION',
    };
  }
  return { kind: 'DETERMINED', memberIds: candidates };
}

/** The peer identity descriptor rendered on the surface footer. */
export function peerDisplay(peer: PeerIdentity): string {
  return `surface=${peer.surface} install=${peer.installId} user=${peer.userId}`;
}
