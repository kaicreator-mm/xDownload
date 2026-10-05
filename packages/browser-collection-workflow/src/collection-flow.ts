/**
 * T016 S5/S6 bounded collection flow — recipe-driven discovery → confirmation
 * → frozen snapshot → per-member acquisition through Core → coverage/selection
 * truth (PRD §28 S5/S6, §10–§19; frozen L2 D5/§6.6/§6.7).
 *
 * ONE composed collection flow in which every outcome stays upstream-owned:
 *
 *   optional recipe plan (T011 declarative interpreter) → slice conformance
 *   (T011) → bounded discovery session (T011 engine, typed rejections,
 *   canonical budget input) → confirmation workflow (T011, one selection
 *   claim set, MAX_MATERIAL_ITEM_CONFIRMATIONS bounds; outcomes enter ONLY
 *   through the declared ConfirmationOutcomeSource — never synthesized — and
 *   acquisition is gated on the recorded confirmation) → frozen membership
 *   (S5 default continuation_scope=NONE) → per-member scoped capability
 *   (exact broker tuple, opaque ref only) → per-member acquisition through
 *   @xdownload/core-runtime budget ports → requested-scope accounting
 *   (T007 accounting + T011 identity machinery) → terminal truth only through
 *   the T007 projector (or the T010 auth-limited projection when
 *   authorization blocked everything before any durable work existed).
 *
 * Glue decides ORDER only. It never computes a status, verdict, coverage
 * claim, membership identity or continuation admission: discovery stops,
 * rejections, broker outcomes, adapter outcomes, accounting and projection
 * are consumed verbatim and translated between canonical vocabularies only.
 */

import {
  bindLocator,
  buildCoverageAccounting,
  createEvidenceLedger,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  scopeIdentityKey,
  unwrapOrThrow,
  type BudgetRemaining,
  type ConfirmationOutcome,
  type ConfirmationType,
  type CoverageAccounting,
  type CoverageEvidence,
  type DomainValidationResult,
  type EnumerationClosure,
  type EvidenceId,
  type EvidenceLedger,
  type EvidenceRecord,
  type LocatorBinding,
  type LocatorProvenance,
  type LogicalTargetId,
  type MemberId,
  type ProjectedTerminalResult,
  type ResolutionFacts,
  type ResourceLocator,
  type StopFacts,
  type TerminalResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import { projectAuthLimitedResult } from '@xdownload/browser-auth-broker';
import type { AuthBroker, BrokerDiagnostic, BrokerResult } from '@xdownload/browser-auth-broker';
import type { DirectTransferRequest } from '@xdownload/direct-acquisition';
import type {
  HlsRenditionBinding,
  MasterPlaylist,
  MediaAssemblyPort,
  MediaPlaylist,
  SegmentFetcherPort,
} from '@xdownload/hls-vod-adapter';
import {
  CoreRuntimeFlowError,
  executeDirectAcquisition,
  executeHlsAcquisition,
  projectLineageResult,
  type CoreRuntime,
  type DirectFlowOutcome,
  type HlsFlowOutcome,
} from '@xdownload/core-runtime';
import {
  accountRequestedScope,
  assertSliceCollectionConformance,
  confirmationEvidenceRecord,
  coverageEvidenceForAccounting,
  initiateDiscovery,
  planConfirmationWorkflow,
  recordConfirmation,
  stepDiscovery,
  type ConfirmationOutcomeRecord,
  type ConfirmationRequest,
  type DiscoveryEvent,
  type DiscoveryRejection,
  type DiscoverySession,
  type NaturalEndRelation,
  type RecipeExecutionPlan,
  type RequestedScopeClosure,
} from '@xdownload/discovery-recipe';
import type { AcquisitionContract, SelectionSnapshot } from '@xdownload/domain-contracts';
import {
  capabilityBindingFor,
  issueScopedCapability,
  useScopedCapability,
} from './auth-lifecycle.ts';

/** Per-member delivery plan consumed by the acquisition lane (declared input). */
export type MemberDelivery =
  | {
      readonly kind: 'direct';
      readonly targetId: string;
      readonly artifactId: string;
      readonly locator: ResourceLocator;
      readonly provenance: LocatorProvenance;
      /** The only hosts a provenance-bound member-delivery redirect may bind to. */
      readonly declaredRedirectHosts: readonly string[];
      readonly expectedSha256: string;
      readonly expectedContentTypePrefix?: string;
    }
  | {
      readonly kind: 'hls';
      readonly targetId: string;
      readonly artifactId: string;
      readonly binding: HlsRenditionBinding;
      readonly master: MasterPlaylist | undefined;
      readonly mediaPlaylist: MediaPlaylist;
      readonly mediaPlaylistLocator: LocatorBinding<LogicalTargetId>;
      readonly fetcher: SegmentFetcherPort;
      readonly assemblyPort: MediaAssemblyPort;
      readonly recordedAt: string;
    };

/**
 * Where recorded confirmation outcomes came from: a real user decision or an
 * explicitly injected source (declared driver — e.g. a scripted test drive).
 * Injected outcomes are recorded as source-injected provenance and are never
 * autonomous CONFIRMED truth or USER_CONFIRMATION evidence.
 */
export type ConfirmationOutcomeOrigin = 'USER' | 'INJECTED_SOURCE';

/** What an injected/real confirmation source resolved for one confirmation step. */
export type ConfirmationOutcomeSourceResolution =
  | {
      readonly kind: 'RESOLVED';
      readonly origin: ConfirmationOutcomeOrigin;
      /** One verbatim outcome per member ref, in member-ref order. */
      readonly outcomes: readonly ConfirmationOutcome[];
    }
  | { readonly kind: 'NOT_AVAILABLE'; readonly reason: string };

/**
 * Injectable source of actual confirmation outcomes (the host's user-input
 * channel; tests drive flows through an explicitly injected instance). The
 * production/default composition is ABSENT: a confirmation step that requires
 * real user input then degrades to the typed cannot-proceed outcome instead
 * of proceeding on a synthesized decision.
 */
export interface ConfirmationOutcomeSource {
  readonly resolve: (input: {
    readonly confirmationType: ConfirmationType;
    readonly memberRefs: readonly MemberId[];
  }) => ConfirmationOutcomeSourceResolution;
}

/** Explicit issue decision for the collection lane (least-authority TTL). */
export interface CollectionAuthorizationInput {
  readonly origin: string;
  /** Observation provenance chain of the confirmed collection context. */
  readonly provenanceChain: string;
  readonly partition?: string;
  readonly ttlMs: number;
  readonly issueDecisionToken: string;
}

export interface CollectionFlowInput {
  readonly runtime: CoreRuntime;
  readonly broker: AuthBroker;
  readonly slice: 'S5' | 'S6';
  readonly contract: AcquisitionContract;
  readonly snapshot: SelectionSnapshot;
  readonly naturalEndRelation?: NaturalEndRelation;
  /**
   * Pre-planned recipe execution from the T011 declarative interpreter. A
   * non-matching plan surfaces its deterministic fallback instead of
   * executing (C20); an exclusions list is carried as facts.
   */
  readonly recipePlan?: RecipeExecutionPlan;
  /** Observation feed events (fixture or real observation-derived, canonical). */
  readonly events: readonly DiscoveryEvent[];
  /** Canonical per-step budget state; the last entry repeats (glue sequencing). */
  readonly budgetSteps: readonly BudgetRemaining[];
  /** Declared delivery plan for every member the flow may acquire. */
  readonly deliveryFor: (memberId: string) => MemberDelivery;
  /** Independently evidenced auth-inaccessibility classification (never fabricated here). */
  readonly inaccessibleEvidenceFor?: (memberId: string) => EvidenceRecord | undefined;
  readonly authorization: CollectionAuthorizationInput;
  /**
   * Declared membership of the confirmed basis for scopes that enumerate
   * through discovery (supported collection / page range). Consumed input —
   * never computed by the flow. Absent: the frozen snapshot member set is
   * the requested reference set (current-page / finite member scopes).
   */
  readonly declaredRequestedMemberIds?: readonly string[];
  /** Ambiguous material members routed through the confirmation workflow. */
  readonly ambiguousMaterialMemberIds?: readonly string[];
  /**
   * Declared source of actual confirmation outcomes. ABSENT by default: a
   * required confirmation then yields the typed cannot-proceed outcome
   * (CONFIRMATION_REQUIRED / NO_OUTCOME_SOURCE) and acquisition never starts.
   * Scripted outcomes enter ONLY here and are recorded as INJECTED_SOURCE.
   */
  readonly confirmationSource?: ConfirmationOutcomeSource;
  readonly recordedAt: string;
}

export interface MemberAcquisitionOutcome {
  readonly memberId: string;
  readonly kind: 'ACQUIRED' | 'AUTH_DENIED';
  readonly flow?: DirectFlowOutcome | HlsFlowOutcome;
  readonly auth?: {
    readonly outcome: 'AUTH_REQUIRED' | 'AUTH_FAILED';
    readonly reasons: readonly BrokerDiagnostic[];
  };
  /** Canonical recovery truth: durably accepted with verified bytes. */
  readonly accepted: boolean;
}

export type CollectionFlowRejection =
  | { readonly stage: 'SLICE_CONFORMANCE'; readonly diagnostics: readonly ValidationDiagnostic[] }
  | { readonly stage: 'DISCOVERY_INIT'; readonly diagnostics: readonly ValidationDiagnostic[] }
  | {
      readonly stage: 'MEMBERSHIP_IDENTITY';
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | {
      readonly stage: 'CONFIRMATION_REQUIRED';
      readonly requests: readonly ConfirmationRequest[];
      readonly reason:
        | 'NO_OUTCOME_SOURCE'
        | 'SOURCE_NOT_AVAILABLE'
        | 'SOURCE_OUTCOME_COUNT_MISMATCH'
        | 'RECORD_REJECTED'
        | 'SELECTION_NOT_CONFIRMED';
      /** The injected source's own decline reason (SOURCE_NOT_AVAILABLE). */
      readonly sourceReason?: string;
      /** The verbatim recorded aggregate (SELECTION_NOT_CONFIRMED). */
      readonly recordedAggregate?: ConfirmationOutcome;
    }
  | {
      readonly stage: 'AUTHORIZATION_ISSUE';
      readonly memberId: string;
      readonly diagnostics: readonly BrokerDiagnostic[];
    }
  | {
      readonly stage: 'MEMBER_DELIVERY_LOCATOR';
      readonly memberId: string;
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | {
      readonly stage: 'CORE_ACQUISITION';
      readonly memberId: string;
      readonly error: CoreRuntimeFlowError;
    }
  | {
      readonly stage: 'COVERAGE_ACCOUNTING';
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | { readonly stage: 'RECIPE_REPLAY'; readonly fallbackKind: 'ASK_USER' | 'ABORT' };

export interface CollectionFlowResult {
  readonly session: DiscoverySession;
  readonly rejections: readonly DiscoveryRejection[];
  readonly confirmation: ConfirmationOutcomeRecord | undefined;
  /**
   * Provenance of the recorded confirmation outcomes: USER for a real user
   * decision, INJECTED_SOURCE for outcomes that entered through the declared
   * source. Undefined when no confirmation was required/recorded.
   */
  readonly confirmationOrigin: ConfirmationOutcomeOrigin | undefined;
  /** Recipe capability exclusions (verbatim interpreter facts), when planned. */
  readonly recipeExclusions: readonly {
    readonly capability: string;
    readonly reason: string;
  }[];
  /** Flow-local typed evidence ledger (canonical T007 store, append-only). */
  readonly evidenceLedger: EvidenceLedger;
  readonly memberOutcomes: readonly MemberAcquisitionOutcome[];
  /** The immutable requested reference set R the flow was bounded by. */
  readonly requestedMemberIds: readonly string[];
  readonly accounting: CoverageAccounting | undefined;
  readonly coverageBasis: CoverageEvidence | undefined;
  readonly enumeration: EnumerationClosure;
  readonly stopFacts: StopFacts;
  /** Terminal truth: T007 projector via core-runtime, or the T010 auth-limited projection. */
  readonly terminalResult: TerminalResult | undefined;
  readonly terminalSource: 'CORE_PROJECTOR' | 'AUTH_LIMITED_PROJECTION' | 'NONE';
  readonly coreProjection?: DomainValidationResult<ProjectedTerminalResult>;
  readonly authLimitedProjection?: BrokerResult<TerminalResult>;
}

export type CollectionFlowOutcome =
  | { readonly ok: false; readonly rejection: CollectionFlowRejection }
  | { readonly ok: true; readonly result: CollectionFlowResult };

function acceptedThroughRecovery(runtime: CoreRuntime, workItemId: string): boolean {
  const classification = runtime.recovery.classify(workItemId);
  return classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
}

/** Re-validate canonical id strings into branded member identities (idempotent). */
function asMemberIds(ids: readonly string[]): MemberId[] {
  return ids.map((id) => unwrapOrThrow(makeMemberId(id)));
}

function budgetAt(steps: readonly BudgetRemaining[], index: number): BudgetRemaining {
  return steps[Math.min(index, steps.length - 1)]!;
}

/** Translate the discovery engine's typed stop into the canonical closure. */
function enumerationClosureFor(
  session: DiscoverySession,
  lastBudget: BudgetRemaining,
): EnumerationClosure {
  const stop = session.stop;
  if (stop === undefined) {
    return { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' };
  }
  switch (stop.kind) {
    case 'USER_SCOPE_REACHED':
      return { kind: 'USER_SCOPE_REACHED' };
    case 'NATURAL_COLLECTION_END':
      return { kind: 'NATURAL_END_VALIDATED' };
    case 'ENUMERATION_CLOSED':
      return { kind: 'CONTINUATION_CLOSED' };
    case 'DISCOVERY_BUDGET_EXHAUSTED':
      return {
        kind: 'TRUNCATED',
        by: lastBudget.globalSafety.exhausted ? 'GLOBAL_SAFETY' : 'DISCOVERY_BUDGET',
      };
    case 'CONTINUATION_UNCLOSABLE':
      return {
        kind: 'INCOMPLETE_UNKNOWN',
        reason:
          stop.cause === 'FAILED_NEXT_PAGE'
            ? 'FAILED_NEXT_PAGE'
            : stop.cause === 'PAGINATION_LOOP'
              ? 'PAGINATION_LOOP'
              : 'MISSING_NEXT_CONTROL',
      };
  }
}

/** Translate the discovery engine's typed stop into the T011 closure evidence. */
function coverageClosureFor(
  session: DiscoverySession,
  requested: readonly string[],
): RequestedScopeClosure {
  const stop = session.stop;
  if (stop === undefined) {
    return { kind: 'NO_CLOSURE', reason: 'NO_MORE_FOUND_WITHOUT_CLOSURE' };
  }
  switch (stop.kind) {
    case 'USER_SCOPE_REACHED':
      return { kind: 'AUTHORITATIVE_IDENTITY_LIST', identities: [...requested] };
    case 'ENUMERATION_CLOSED':
      return {
        kind: 'DECLARED_TOTAL_WITH_CLOSURE',
        declaredTotal: requested.length,
        closure: 'CONTINUATION_CLOSED',
      };
    case 'NATURAL_COLLECTION_END':
      return {
        kind: 'DECLARED_TOTAL_WITH_CLOSURE',
        declaredTotal: requested.length,
        closure: 'NATURAL_END_VALIDATED',
      };
    case 'DISCOVERY_BUDGET_EXHAUSTED':
      return { kind: 'NO_CLOSURE', reason: 'BUDGET_EXHAUSTED' };
    case 'CONTINUATION_UNCLOSABLE':
      return {
        kind: 'NO_CLOSURE',
        reason:
          stop.cause === 'FAILED_NEXT_PAGE'
            ? 'FAILED_NEXT_PAGE'
            : stop.cause === 'PAGINATION_LOOP'
              ? 'PAGINATION_LOOP'
              : 'NO_MORE_FOUND_WITHOUT_CLOSURE',
      };
  }
}

function identityContradiction(outsideRequested: readonly string[]): CollectionFlowRejection {
  return {
    stage: 'MEMBERSHIP_IDENTITY',
    diagnostics: [
      {
        code: 'SCOPE_MUTATION',
        path: 'discovery.resolvedMemberIds',
        message: `discovery resolved members outside the confirmed requested reference set (${outsideRequested.join(', ')}); fail closed`,
      },
    ],
  };
}

/**
 * Run the composed S5/S6 collection flow. See the module header for the
 * authority map; every rejection/failure propagates fail-closed.
 */
export async function runCollectionFlow(
  input: CollectionFlowInput,
): Promise<CollectionFlowOutcome> {
  // 0. Optional recipe plan: the declarative interpreter authorizes the
  //    capability plan against the confirmed contract; a non-matching replay
  //    surfaces its deterministic fallback instead of executing (C20).
  let recipeExclusions: readonly { capability: string; reason: string }[] = [];
  if (input.recipePlan !== undefined) {
    if (!input.recipePlan.matched) {
      return {
        ok: false,
        rejection: {
          stage: 'RECIPE_REPLAY',
          fallbackKind: input.recipePlan.fallback?.kind ?? 'ABORT',
        },
      };
    }
    recipeExclusions = input.recipePlan.excluded.map((entry) => ({
      capability: entry.capability,
      reason: entry.reason,
    }));
  }

  // 1. Slice conformance (T011): S5/S6 declared behavior only.
  const slice = assertSliceCollectionConformance(input.slice, input.contract);
  if (!slice.ok) {
    return { ok: false, rejection: { stage: 'SLICE_CONFORMANCE', diagnostics: slice.diagnostics } };
  }

  // 2. Bounded discovery session (T011 engine owns every admission decision).
  const initiated = initiateDiscovery({
    contract: input.contract,
    snapshot: input.snapshot,
    ...(input.naturalEndRelation === undefined
      ? {}
      : { naturalEndRelation: input.naturalEndRelation }),
  });
  if (!initiated.ok) {
    return {
      ok: false,
      rejection: { stage: 'DISCOVERY_INIT', diagnostics: initiated.diagnostics },
    };
  }

  let session = initiated.value;
  const rejections: DiscoveryRejection[] = [];
  for (let index = 0; index < input.events.length; index += 1) {
    const step = stepDiscovery(
      input.contract,
      session,
      input.events[index]!,
      budgetAt(input.budgetSteps, index),
    );
    session = step.state;
    rejections.push(...step.rejections);
  }

  // 3. The immutable requested reference set R (frozen scope identity).
  const requested = [...(input.declaredRequestedMemberIds ?? input.snapshot.selectedMemberIds)];
  const outsideRequested = session.resolvedMemberIds.filter((id) => !requested.includes(id));
  if (outsideRequested.length > 0) {
    return { ok: false, rejection: identityContradiction(outsideRequested) };
  }

  // 4. Confirmation workflow (T011): one selection claim set, bounded plan.
  const ledger = createEvidenceLedger();
  const confirmationPlan = planConfirmationWorkflow({
    contract: {
      automationMode: input.contract.automationMode,
      selectionPolicy: input.contract.selectionPolicy,
    },
    scopeScopeKey: scopeIdentityKey(input.contract.requestedScope),
    ambiguousMaterialMemberIds: input.ambiguousMaterialMemberIds ?? [],
    candidateCount: session.resolvedMemberIds.length,
    autoEvidenceSufficient: true,
  });
  let confirmation: ConfirmationOutcomeRecord | undefined;
  let confirmationOrigin: ConfirmationOutcomeOrigin | undefined;
  if (confirmationPlan.requests.length > 0 && session.resolvedMemberIds.length > 0) {
    const memberRefs: MemberId[] = session.resolvedMemberIds.map((id) =>
      unwrapOrThrow(makeMemberId(id)),
    );
    // Outcomes are never synthesized here. A required confirmation (scope
    // level, batch group, material item, MANUAL_SELECTION_UI) resolves only
    // through the declared source; without it the flow degrades to the typed
    // cannot-proceed outcome — a genuine user decision point is never
    // decided inside glue.
    const resolution = input.confirmationSource?.resolve({
      confirmationType: 'CONFIRM_SELECTION',
      memberRefs,
    });
    if (resolution === undefined || resolution.kind === 'NOT_AVAILABLE') {
      return {
        ok: false,
        rejection: {
          stage: 'CONFIRMATION_REQUIRED',
          requests: confirmationPlan.requests,
          reason: resolution === undefined ? 'NO_OUTCOME_SOURCE' : 'SOURCE_NOT_AVAILABLE',
          ...(resolution === undefined ? {} : { sourceReason: resolution.reason }),
        },
      };
    }
    if (resolution.outcomes.length !== memberRefs.length) {
      return {
        ok: false,
        rejection: {
          stage: 'CONFIRMATION_REQUIRED',
          requests: confirmationPlan.requests,
          reason: 'SOURCE_OUTCOME_COUNT_MISMATCH',
        },
      };
    }
    const recorded = recordConfirmation({
      claimKind: memberRefs.length > 1 ? 'BATCH' : 'SINGLE',
      confirmationType: 'CONFIRM_SELECTION',
      memberRefs,
      outcomes: resolution.outcomes,
    });
    if (!recorded.ok) {
      return {
        ok: false,
        rejection: {
          stage: 'CONFIRMATION_REQUIRED',
          requests: confirmationPlan.requests,
          reason: 'RECORD_REJECTED',
        },
      };
    }
    confirmation = recorded.value;
    confirmationOrigin = resolution.origin;
    // Real user confirmations carry canonical USER_CONFIRMATION evidence;
    // injected outcomes are recorded as source-injected provenance on the
    // result — never as autonomous user truth in the evidence store.
    if (resolution.origin === 'USER') {
      const evidence = confirmationEvidenceRecord({
        confirmationType: 'CONFIRM_SELECTION',
        evidenceId: `evidence-selection-${input.contract.contractId}`,
        claimSubject: {
          kind: 'COVERAGE_TARGET',
          ref: input.snapshot.coverageTarget.scopeIdentityKey,
        },
        contractRef: input.contract.contractId,
        snapshotRef: input.snapshot.snapshotId,
      });
      if (evidence.ok) {
        ledger.append(evidence.value);
      }
    }
    // Acquisition gate: the flow never proceeds past an unfulfilled
    // confirmation — the verbatim upstream aggregate owns the verdict.
    if (confirmation.outcomesAggregate !== 'CONFIRMED') {
      return {
        ok: false,
        rejection: {
          stage: 'CONFIRMATION_REQUIRED',
          requests: confirmationPlan.requests,
          reason: 'SELECTION_NOT_CONFIRMED',
          recordedAggregate: confirmation.outcomesAggregate,
        },
      };
    }
  }

  // 5. Per-member scoped authorization + acquisition through Core budget ports.
  const memberOutcomes: MemberAcquisitionOutcome[] = [];
  let lastLineageKey: DirectFlowOutcome['lineageKey'] | undefined;
  for (const memberId of session.resolvedMemberIds) {
    if (session.knownInaccessibleMemberIds.includes(memberId)) {
      // Auth-inaccessible per independently evidenced observation: never
      // acquired, never silently skipped — named in the accounting below.
      continue;
    }
    const delivery = input.deliveryFor(memberId);
    const binding = capabilityBindingFor({
      authorization: {
        origin: input.authorization.origin,
        target: delivery.targetId,
        provenanceChain: input.authorization.provenanceChain,
        ...(input.authorization.partition === undefined
          ? {}
          : { partition: input.authorization.partition }),
      },
      contract: input.contract,
      snapshotId: input.snapshot.snapshotId,
    });
    const issued = issueScopedCapability(
      input.broker,
      binding,
      input.authorization.ttlMs,
      input.authorization.issueDecisionToken,
    );
    if (!issued.ok) {
      return {
        ok: false,
        rejection: {
          stage: 'AUTHORIZATION_ISSUE',
          memberId,
          diagnostics: issued.diagnostics,
        },
      };
    }
    const use = useScopedCapability(input.broker, issued.value.ref, binding);
    if (use.outcome !== 'AUTH_GRANTED') {
      // Truthful denial: surfaced through member outcomes + stop facts +
      // accounting; never a silent skip, never a re-issue.
      memberOutcomes.push({
        memberId,
        kind: 'AUTH_DENIED',
        auth: { outcome: use.outcome, reasons: use.reasons },
        accepted: false,
      });
      continue;
    }
    try {
      if (delivery.kind === 'direct') {
        const locator = bindLocator(
          delivery.locator,
          unwrapOrThrow(makeLogicalTargetId(delivery.targetId)),
          delivery.provenance,
        );
        if (!locator.ok) {
          // Typed lane rejection: the verbatim upstream diagnostics surface
          // fail-closed instead of an untyped throw.
          return {
            ok: false,
            rejection: {
              stage: 'MEMBER_DELIVERY_LOCATOR',
              memberId,
              diagnostics: locator.diagnostics,
            },
          };
        }
        const transfer: DirectTransferRequest = {
          effectId: unwrapOrThrow(
            makeEffectId(
              `effect:${input.contract.contractId}:${input.snapshot.snapshotId}:${delivery.targetId}`,
            ),
          ),
          contractId: input.contract.contractId,
          slice: 'S1',
          selectedMemberId: unwrapOrThrow(makeMemberId(memberId)),
          binding: locator.value,
          expectedSha256: delivery.expectedSha256,
          ...(delivery.expectedContentTypePrefix === undefined
            ? {}
            : { expectedContentTypePrefix: delivery.expectedContentTypePrefix }),
          allowedRedirectHosts: delivery.declaredRedirectHosts,
          attempt: 0,
        };
        const flow = await executeDirectAcquisition(input.runtime, {
          contractId: input.contract.contractId,
          snapshotId: input.snapshot.snapshotId,
          targetId: delivery.targetId,
          authorizationContextRef: issued.value.ref,
          budgetProfile: input.contract.budgetProfile,
          frozenMemberIds: [...input.snapshot.selectedMemberIds],
          commandId: `${input.contract.contractId}:${memberId}:acquire`,
          memberId,
          artifactId: delivery.artifactId,
          transfer,
        });
        memberOutcomes.push({
          memberId,
          kind: 'ACQUIRED',
          flow,
          accepted: acceptedThroughRecovery(input.runtime, flow.workItemId),
        });
        lastLineageKey = flow.lineageKey;
      } else {
        const flow = executeHlsAcquisition(input.runtime, {
          contractId: input.contract.contractId,
          snapshotId: input.snapshot.snapshotId,
          targetId: delivery.targetId,
          authorizationContextRef: issued.value.ref,
          budgetProfile: input.contract.budgetProfile,
          frozenMemberIds: [...input.snapshot.selectedMemberIds],
          commandId: `${input.contract.contractId}:${memberId}:acquire`,
          memberId,
          artifactId: delivery.artifactId,
          binding: delivery.binding,
          master: delivery.master,
          mediaPlaylist: delivery.mediaPlaylist,
          mediaPlaylistLocator: delivery.mediaPlaylistLocator,
          fetcher: delivery.fetcher,
          assemblyPort: delivery.assemblyPort,
          recordedAt: delivery.recordedAt,
        });
        memberOutcomes.push({
          memberId,
          kind: 'ACQUIRED',
          flow,
          accepted: acceptedThroughRecovery(input.runtime, flow.workItemId),
        });
        lastLineageKey = flow.lineageKey;
      }
    } catch (error) {
      if (error instanceof CoreRuntimeFlowError) {
        return { ok: false, rejection: { stage: 'CORE_ACQUISITION', memberId, error } };
      }
      throw error;
    }
  }

  // 6. Requested-scope accounting (T007 accounting + T011 identity machinery).
  const lastBudget = budgetAt(input.budgetSteps, Math.max(0, input.events.length - 1));
  const accessible = memberOutcomes
    .filter((outcome) => outcome.kind === 'ACQUIRED')
    .map((outcome) => outcome.memberId);
  const validated = memberOutcomes
    .filter((outcome) => outcome.kind === 'ACQUIRED' && outcome.accepted)
    .map((outcome) => outcome.memberId);
  const denied = memberOutcomes
    .filter((outcome) => outcome.kind === 'AUTH_DENIED')
    .map((outcome) => outcome.memberId);
  const inaccessible: string[] = [];
  for (const memberId of [...session.knownInaccessibleMemberIds, ...denied]) {
    if (!inaccessible.includes(memberId)) {
      inaccessible.push(memberId);
    }
  }
  const evidenceByMember = new Map<string, EvidenceRecord>();
  const inaccessibleMembers: {
    readonly memberId: string;
    readonly classificationEvidenceId?: EvidenceId;
  }[] = [];
  for (const memberId of inaccessible) {
    const evidence = input.inaccessibleEvidenceFor?.(memberId);
    if (evidence === undefined) {
      inaccessibleMembers.push({ memberId });
      continue;
    }
    const appended = ledger.append(evidence);
    if (appended.ok) {
      evidenceByMember.set(memberId, appended.value);
      inaccessibleMembers.push({ memberId, classificationEvidenceId: appended.value.evidenceId });
    } else {
      inaccessibleMembers.push({ memberId });
    }
  }

  const accounting = buildCoverageAccounting(
    {
      coverageTarget: input.snapshot.coverageTarget,
      requestedMemberIds: asMemberIds(requested),
      resolvedMemberIds: asMemberIds([...accessible, ...inaccessible]),
      authAccessibleMemberIds: asMemberIds(accessible),
      authInaccessibleMembers: inaccessibleMembers.map((member) => ({
        memberId: unwrapOrThrow(makeMemberId(member.memberId)),
        ...(member.classificationEvidenceId === undefined
          ? {}
          : { classificationEvidenceId: member.classificationEvidenceId }),
      })),
      selectedMemberIds: asMemberIds(accessible),
      validatedMemberIds: asMemberIds(validated),
      authorizationContextRef: input.contract.authorizationContextRef,
    },
    ledger,
  );
  if (!accounting.ok) {
    return {
      ok: false,
      rejection: { stage: 'COVERAGE_ACCOUNTING', diagnostics: accounting.diagnostics },
    };
  }
  const identityAccounting = accountRequestedScope({
    requestedMemberIds: requested,
    acquiredValidatedIds: validated,
    inaccessibleMembers: [...evidenceByMember.entries()].map(([memberId, evidence]) => ({
      memberId,
      evidence,
    })),
  });
  const coverageBasis = coverageEvidenceForAccounting({
    accounting: identityAccounting,
    closure: coverageClosureFor(session, requested),
  });

  // 7. Truthful stop/resolution facts (factual translation of upstream outputs).
  const enumeration = enumerationClosureFor(session, lastBudget);
  const anyAuthFailed = memberOutcomes.some((outcome) => outcome.auth?.outcome === 'AUTH_FAILED');
  const anyAuthDenied = denied.length > 0 || inaccessible.length > 0;
  const stopFacts: StopFacts = {
    ...(anyAuthFailed ? { authFailed: true } : {}),
    ...(anyAuthDenied ? { authRequired: true } : {}),
    ...(session.stop?.kind === 'DISCOVERY_BUDGET_EXHAUSTED'
      ? { discoveryBudgetExhausted: true }
      : {}),
  };
  const everythingBlocked =
    accessible.length === 0 &&
    session.resolvedMemberIds.length > 0 &&
    inaccessible.length === session.resolvedMemberIds.length;
  const resolution: ResolutionFacts | undefined = everythingBlocked
    ? { blockedBeforeAnyResolution: { reason: anyAuthFailed ? 'AUTH_FAILED' : 'AUTH_REQUIRED' } }
    : undefined;

  // 8. Terminal truth — only through the canonical projectors.
  if (lastLineageKey !== undefined) {
    const coreProjection = projectLineageResult(input.runtime, {
      lineageKey: lastLineageKey,
      contractId: input.contract.contractId,
      snapshotId: input.snapshot.snapshotId,
      intentType: 'COLLECTION',
      scopeKind: input.contract.requestedScope.kind,
      requestedMemberIds: requested,
      recordedAt: input.recordedAt,
      enumeration,
      ...(Object.keys(stopFacts).length > 0 ? { stopFacts } : {}),
      ...(resolution === undefined ? {} : { resolution }),
      accounting: accounting.value,
      coverageBasis,
      requiredLayers: input.contract.validationPolicy.requiredLayers,
    });
    return {
      ok: true,
      result: {
        session,
        rejections,
        confirmation,
        confirmationOrigin,
        recipeExclusions,
        evidenceLedger: ledger,
        memberOutcomes,
        requestedMemberIds: requested,
        accounting: accounting.value,
        coverageBasis,
        enumeration,
        stopFacts,
        terminalResult: coreProjection.ok ? coreProjection.value.result : undefined,
        terminalSource: 'CORE_PROJECTOR',
        coreProjection,
      },
    };
  }
  if (resolution !== undefined) {
    // Authorization blocked every resolved member before any durable work
    // existed: the T010 auth-limited projection is the sanctioned truth.
    const authLimitedProjection = projectAuthLimitedResult({
      contractId: input.contract.contractId,
      snapshotId: input.snapshot.snapshotId,
      intentType: 'COLLECTION',
      scopeKind: input.contract.requestedScope.kind,
      requestedScopeCount: requested.length,
      accessibleMemberIds: [],
      inaccessibleMemberIds: inaccessible,
      authStopReason: anyAuthFailed ? 'AUTH_FAILED' : 'AUTH_REQUIRED',
      recordedAt: input.recordedAt,
    });
    return {
      ok: true,
      result: {
        session,
        rejections,
        confirmation,
        confirmationOrigin,
        recipeExclusions,
        evidenceLedger: ledger,
        memberOutcomes,
        requestedMemberIds: requested,
        accounting: accounting.value,
        coverageBasis,
        enumeration,
        stopFacts,
        terminalResult: authLimitedProjection.ok ? authLimitedProjection.value : undefined,
        terminalSource: 'AUTH_LIMITED_PROJECTION',
        authLimitedProjection,
      },
    };
  }
  return {
    ok: true,
    result: {
      session,
      rejections,
      confirmation,
      confirmationOrigin,
      recipeExclusions,
      evidenceLedger: ledger,
      memberOutcomes,
      requestedMemberIds: requested,
      accounting: accounting.value,
      coverageBasis,
      enumeration,
      stopFacts,
      terminalResult: undefined,
      terminalSource: 'NONE',
    },
  };
}
