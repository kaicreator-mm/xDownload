/**
 * T008 direct-acquisition port — the ADR-006 acquisition seam.
 *
 * Direct HTTP/file (S1/S3) is one execution adapter behind this single
 * acquisition port (frozen L2 §6.5 / ADR-006); the later HLS adapter lane
 * (T009) implements the same port without inheriting this file's transfer
 * semantics. Every request belongs to a durable effect lineage (frozen L2
 * invariant 8) and every outcome projects canonical multidimensional
 * results/evidence — the adapter never invents success semantics (invariant
 * 17). Budget consumption is reported only through the injected authoritative
 * ledger port (invariant 7); the adapter never keeps a private ledger.
 */

import type {
  BudgetRemaining,
  EvidenceRecord,
  EffectId,
  LocatorBinding,
  LogicalTargetId,
  MemberId,
  TerminalResult,
} from '@xdownload/domain-contracts';

/** Direct-transfer support slices owned by this adapter (frozen PRD §28). */
export type DirectTransferSlice = 'S1' | 'S3';

/**
 * Representation identity observed for one HTTP representation (RFC 9110
 * §8.8). Only a strong validator (non-weak `ETag`) is sufficient identity for
 * validated resume; weak validators and Last-Modified alone never authorize
 * append (frozen L2 U5).
 */
export interface RepresentationIdentity {
  readonly strongETag?: string;
  readonly weakETag?: string;
  readonly lastModified?: string;
  readonly contentLength?: number;
}

/** Partial bytes carried over from a previous attempt of the same lineage. */
export interface PartialTransferState {
  readonly bytes: Uint8Array;
  readonly receivedBytes: number;
  /** Identity observed for the representation the partial bytes came from. */
  readonly identity: RepresentationIdentity;
  readonly effectId: EffectId;
  readonly targetId: LogicalTargetId;
}

export interface MediaSignature {
  /** Hex-encoded byte signature required by Media Validation (frozen PRD §22). */
  readonly hex: string;
  readonly offset: number;
  /** What the signature represents (track/container sanity), for typed evidence. */
  readonly label: string;
}

export interface MediaPolicy {
  readonly signatures: readonly MediaSignature[];
}

export interface DirectTransferRequest {
  /** Durable effect identity; every attempt of this lineage reuses it. */
  readonly effectId: EffectId;
  readonly contractId: string;
  readonly slice: DirectTransferSlice;
  /** The confirmed selected member this transfer fulfills (result projection). */
  readonly selectedMemberId: MemberId;
  /** Provenance-bound delivery locator for the frozen logical target. */
  readonly binding: LocatorBinding<LogicalTargetId>;
  /**
   * Optional frozen target identity anchor: the independently published
   * SHA-256 of the complete bytes. When supplied, a digest mismatch fails
   * the transfer (C09). When absent, the Target claim rests on the
   * `REQUESTED_LOCATOR_PROVENANCE` basis (user-selected locator + declared
   * redirect graph); the computed artifact digest is durably recorded for
   * later corruption detection and is never promoted to an independent
   * target oracle (C34).
   */
  readonly expectedSha256?: string;
  /** Optional declared total size for Transfer Validation. */
  readonly expectedTotalBytes?: number;
  /** Optional declared content-type prefix for Format Validation. */
  readonly expectedContentTypePrefix?: string;
  /** Required media signatures (S3); empty/absent skips media probing. */
  readonly mediaPolicy?: MediaPolicy;
  /**
   * Declared delivery policy: the only hosts a redirect/CDN hop may bind to.
   * Any other host fails closed (ADR-011, counterexample C29); redirects can
   * never enlarge the requested single-target scope.
   */
  readonly allowedRedirectHosts: readonly string[];
  /**
   * Injected signed-locator refresher (opaque authorization boundary). The
   * adapter persists no secrets; the refresher returns a locator re-bound by
   * provenance to the same logical target, or the transfer fails closed.
   */
  readonly locatorRefresher?: (
    current: LocatorBinding<LogicalTargetId>,
  ) => Promise<LocatorBinding<LogicalTargetId>>;
  /** Zero-based attempt number; attempts > 0 consume retry request budget. */
  readonly attempt: number;
  /** Prior partial state to consider resuming from (same lineage required). */
  readonly resumeFrom?: PartialTransferState;
  /**
   * Retry lineage anchor (counterexample C12): when present it must match
   * this request's effect/target identities or the retry is rejected before
   * any transfer happens.
   */
  readonly retryLineage?: { readonly effectId: EffectId; readonly targetId: LogicalTargetId };
}

/** Typed resume/restart decision — explicit, never a heuristic (frozen L2 U5). */
export type ResumeDecision =
  | { readonly kind: 'FRESH_TRANSFER' }
  | {
      readonly kind: 'VALIDATED_RESUME';
      readonly offsetBytes: number;
      readonly strongETag: string;
    }
  | {
      readonly kind: 'SAFE_RESTART';
      readonly reason: 'NO_STRONG_VALIDATOR' | 'IDENTITY_CHANGED' | 'PROTOCOL_VIOLATION';
    };

export type ValidationLayerOutcome =
  | { readonly layer: 'transfer' | 'format' | 'target' | 'media'; readonly passed: true }
  | {
      readonly layer: 'transfer' | 'format' | 'target' | 'media';
      readonly passed: false;
      readonly failure: string;
      /** Canonical diagnostic code/reason vocabulary for the failure. */
      readonly code: string;
    };

export type DirectTransferTerminalReason =
  | 'COMPLETED'
  | 'TRUNCATED'
  | 'CORRUPT_BYTES'
  | 'WRONG_TARGET'
  | 'FORMAT_REJECTED'
  | 'MEDIA_INVALID'
  | 'LOCATOR_SUBSTITUTION'
  | 'REDIRECT_SCOPE_EXPANSION'
  | 'SIGNED_LOCATOR_REFRESH_FAILED'
  | 'TRANSFER_BUDGET_EXHAUSTED'
  | 'GLOBAL_SAFETY_EXHAUSTED'
  | 'AUTH_REQUIRED'
  | 'NO_PROGRESS'
  | 'UNSUPPORTED_RESPONSE';

/** The evidence basis of the Target validation claim for one attempt (C34). */
export type TargetIdentityBasis = 'PUBLISHED_SHA256' | 'REQUESTED_LOCATOR_PROVENANCE';

/**
 * The Target claim's evidence basis for a request: a publisher-digest
 * identity anchor when the request declared one, otherwise the conservative
 * provenance basis over the user-selected locator + declared redirect graph
 * (C34 — a computed digest is never promoted to the independent oracle).
 */
export function targetBasisOf(request: { readonly expectedSha256?: string }): TargetIdentityBasis {
  return request.expectedSha256 === undefined ? 'REQUESTED_LOCATOR_PROVENANCE' : 'PUBLISHED_SHA256';
}

/**
 * Terminal outcome of one direct-transfer attempt. `allApplicableValidationPassed`
 * is a derived convenience flag only; canonical terminal truth is the
 * multidimensional `terminalResult` plus typed `evidence` (PRD §16 — no
 * single success boolean is terminal truth).
 */
export interface DirectTransferOutcome {
  readonly effectId: EffectId;
  readonly targetId: LogicalTargetId;
  readonly slice: DirectTransferSlice;
  readonly bytes: Uint8Array | undefined;
  readonly receivedBytes: number;
  readonly resumeDecision: ResumeDecision;
  readonly reason: DirectTransferTerminalReason;
  readonly validations: readonly ValidationLayerOutcome[];
  readonly allApplicableValidationPassed: boolean;
  readonly terminalResult: TerminalResult;
  readonly evidence: readonly EvidenceRecord[];
  /** Locator/provenance hops actually taken, in order (first = request binding). */
  readonly locatorChain: readonly LocatorBinding<LogicalTargetId>[];
  /** Representation identity observed on the final response for this attempt. */
  readonly observedIdentity: RepresentationIdentity;
  /** True when the frozen target's resource actually responded (2xx). */
  readonly targetResolved: boolean;
  /**
   * The Target claim's evidence basis: a publisher-digest identity anchor
   * when the request declared one, otherwise the conservative provenance
   * basis over the user-selected locator + declared redirect graph (C34 —
   * a computed digest is never promoted to the independent oracle).
   */
  readonly targetBasis: TargetIdentityBasis;
}

/**
 * Authoritative budget ledger seam (frozen L2 invariant 7 — one budget
 * mutation path). The durable ledger is Core-owned; this port is the only
 * path the adapter may consume through. Implementations project remaining
 * budget with the canonical `budgetRemaining` semantics.
 */
export interface TransferBudgetLedgerPort {
  /** Authoritative remaining-budget projection across all three domains. */
  remaining(): BudgetRemaining;
  /**
   * Authoritatively record consumption of transfer units. Returns the
   * authoritative remaining projection after the charge.
   */
  consume(units: TransferConsumption): BudgetRemaining;
}

export interface TransferConsumption {
  /** Plain transfer requests issued (redirect hops included). */
  readonly transferRequests: number;
  /** Retry transfer requests issued (attempt > 0). */
  readonly retryTransferRequests: number;
  /** Bytes received. */
  readonly bytes: number;
}
