/**
 * T005 recovery / reconciliation — deterministic classification from durable
 * facts, DB-first and FS-first.
 *
 * Recovery is read-only. It never promotes, never auto-accepts, never
 * silently marks an uncertain effect successful and never blindly replays
 * (frozen L2 §11, ADR-010). Classification reads the durable transition
 * order, the transactional ledger state and a truthful filesystem
 * observation; DB state and filesystem state are reported as distinct
 * fields (frozen L2 §11: recovery records distinguish DB state from
 * filesystem staging/materialization/finalization).
 *
 * Recovery classes are the L2 §11 candidate classes with production names;
 * exact naming was an F1 choice (SEMANTICALLY the required distinctions:
 * NOT_DISPATCHED, IN_FLIGHT_UNKNOWN, PARTIAL_RECOVERABLE,
 * SUCCEEDED_UNACCEPTED, ACCEPTED, TERMINAL_FAILED).
 */

import type { SelectionAcquisitionStatus, StopReason } from '@xdownload/domain-contracts';
import type { FilesystemArtifactStore } from './artifact-store.ts';
import { PersistenceError } from './errors.ts';
import type { LedgerReader } from './reader.ts';
import type { LifecycleState, TransitionFact } from './rows.ts';
import type { AuthoritativeLedgerWriter } from './writer.ts';

export type RecoveryClass =
  | 'NOT_DISPATCHED'
  | 'IN_FLIGHT_UNKNOWN'
  | 'PARTIAL_RECOVERABLE'
  | 'SUCCEEDED_UNACCEPTED'
  | 'ACCEPTED'
  | 'TERMINAL_FAILED';

export type FilesystemTruthPhase =
  'ABSENT' | 'STAGED' | 'MATERIALIZED' | 'FINALIZED' | 'DIGEST_MISMATCH';

export interface RecoveryClassification {
  readonly workItemId: string;
  readonly lifecycleClass: RecoveryClass;
  /** Durable transactional (DB) state. */
  readonly dbState: LifecycleState;
  /** Truthful filesystem observation, digest-checked where bytes exist. */
  readonly fsState: FilesystemTruthPhase;
  readonly cancellationAuthoritative: boolean;
  /** Whether an acceptance transition is currently permitted by the cutoff. */
  readonly acceptanceAllowed: boolean;
  /** Whether automatic new dispatch is suppressed for this lineage. */
  readonly automaticDispatchSuppressed: boolean;
  /** Digest-bound finalized bytes physically verified at classification. */
  readonly bytesVerified: boolean;
  /**
   * Whether final success may be claimed for this lineage: requires durable
   * acceptance AND verified bytes AND no acceptance-blocking contradiction.
   * An `accepted` DB row alone NEVER makes this true (no DB-only success).
   */
  readonly successClaimable: boolean;
  /** Unaccepted bytes under a cancellation-authoritative lineage. */
  readonly cleanupEligibleBytes: boolean;
  readonly attempts: number;
  readonly reasons: readonly string[];
}

export interface LifecycleProjection {
  /**
   * Truthful per-lineage projection inputs in the frozen multidimensional
   * vocabulary. Deliberately NOT a terminal result value and never a single
   * success boolean: coverage, fulfillment and validation dimensions stay
   * owned by the T002 result projector (PRD §16; FAILURE_MATRIX
   * `db-only-final-success`).
   */
  readonly selectionAcquisitionStatus: SelectionAcquisitionStatus;
  readonly stopReason: StopReason;
  readonly accepted: boolean;
  readonly bytesVerified: boolean;
  readonly successClaimable: boolean;
  readonly terminal: boolean;
}

export interface RecoveryServiceDeps {
  readonly writer: AuthoritativeLedgerWriter;
  readonly store: FilesystemArtifactStore;
}

export class RecoveryService {
  private readonly reader: LedgerReader;
  private readonly store: FilesystemArtifactStore;
  private readonly cutoffQuery: (workItemId: string) => boolean;

  constructor(deps: RecoveryServiceDeps) {
    this.reader = deps.writer.reader;
    this.store = deps.store;
    this.cutoffQuery = (workItemId) => deps.writer.cancellationAuthoritative(workItemId);
  }

  classify(workItemId: string): RecoveryClassification {
    const workItem = this.reader.requireWorkItem(workItemId);
    const facts = this.reader.facts(workItemId);
    const reasons: string[] = [];

    const dispatchIntent = facts.find((fact) => fact.kind === 'DISPATCH_INTENT');
    const effect = this.reader.effect(workItemId);
    const cancellationAuthoritative = this.cutoffQuery(workItemId);
    const artifacts = this.reader.artifacts(workItemId);

    // Filesystem truth: check every recorded artifact; the lineage FS state
    // is the strongest phase across its artifacts, with digest checking.
    let fsState: FilesystemTruthPhase = 'ABSENT';
    let bytesVerified = false;
    for (const artifact of artifacts) {
      const observation = this.store.observe(artifact.artifactId);
      let phase: FilesystemTruthPhase = observation.phase;
      if (observation.phase !== 'ABSENT' && artifact.digestSha256 !== undefined) {
        if (observation.observedDigest === artifact.digestSha256) {
          if (observation.phase === 'FINALIZED') {
            bytesVerified = true;
          }
        } else {
          phase = 'DIGEST_MISMATCH';
        }
      }
      if (rankFs(phase) > rankFs(fsState)) {
        fsState = phase;
      }
    }

    if (workItem.lifecycleState === 'ACCEPTED') {
      // Accepted rows must carry a digest-bound artifact record; anything
      // else is ledger inconsistency and fails closed — it is never
      // projected, never normalized into success (R02, negative cases).
      const acceptedArtifact = artifacts.find(
        (artifact) =>
          artifact.digestSha256 !== undefined &&
          artifact.byteSize !== undefined &&
          artifact.byteSize > 0,
      );
      if (acceptedArtifact === undefined) {
        throw new PersistenceError(
          'INCONSISTENT_LEDGER',
          `work item '${workItemId}' is ACCEPTED without a digest-bound artifact record; refusing to classify or project`,
          { invariant: 'L2-inv9' },
        );
      }
      reasons.push('durable acceptance committed');
      if (!bytesVerified) {
        reasons.push(
          'accepted DB state without verified finalized bytes; success is not claimable from acceptance alone',
        );
      }
      const lifecycleClass: RecoveryClass = 'ACCEPTED';
      return this.finish({
        workItemId,
        lifecycleClass,
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: false,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified,
        // Acceptance committed before a later cancellation is NOT revoked
        // (ADR-013); verified bytes on an accepted identity are claimable.
        successClaimable: bytesVerified,
        cleanupEligibleBytes: false,
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    const terminalFailure = facts.find((fact) => fact.kind === 'TERMINAL_FAILURE');
    if (terminalFailure !== undefined) {
      reasons.push(`explicit terminal failure fact recorded`);
      return this.finish({
        workItemId,
        lifecycleClass: 'TERMINAL_FAILED',
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: false,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified,
        successClaimable: false,
        cleanupEligibleBytes: cancellationAuthoritative && fsState !== 'ABSENT',
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    if (fsState === 'DIGEST_MISMATCH') {
      reasons.push('bytes on disk do not match the durable digest binding');
      return this.finish({
        workItemId,
        lifecycleClass: 'TERMINAL_FAILED',
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: false,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified: false,
        successClaimable: false,
        cleanupEligibleBytes: cancellationAuthoritative,
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    if (dispatchIntent === undefined) {
      reasons.push('no durable dispatch intent');
      return this.finish({
        workItemId,
        lifecycleClass: 'NOT_DISPATCHED',
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: !cancellationAuthoritative,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified,
        successClaimable: false,
        cleanupEligibleBytes: cancellationAuthoritative && fsState !== 'ABSENT',
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    if (effect === undefined || effect.outcome !== 'OBSERVED') {
      reasons.push(
        'dispatch intent without observed outcome; the external effect is reconciled from durable facts, never silently succeeded and never blindly replayed',
      );
      return this.finish({
        workItemId,
        lifecycleClass: 'IN_FLIGHT_UNKNOWN',
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: !cancellationAuthoritative,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified,
        successClaimable: false,
        cleanupEligibleBytes: cancellationAuthoritative && fsState !== 'ABSENT',
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    if (fsState === 'FINALIZED' && bytesVerified) {
      reasons.push('finalized digest-verified bytes without durable acceptance');
      return this.finish({
        workItemId,
        lifecycleClass: 'SUCCEEDED_UNACCEPTED',
        dbState: workItem.lifecycleState,
        fsState,
        cancellationAuthoritative,
        acceptanceAllowed: !cancellationAuthoritative,
        automaticDispatchSuppressed: cancellationAuthoritative,
        bytesVerified,
        successClaimable: false,
        cleanupEligibleBytes: cancellationAuthoritative,
        attempts: this.attemptCount(facts),
        reasons,
      });
    }

    reasons.push(
      `external effect observed with filesystem phase '${fsState}'; partial truth is recoverable on the same lineage`,
    );
    return this.finish({
      workItemId,
      lifecycleClass: 'PARTIAL_RECOVERABLE',
      dbState: workItem.lifecycleState,
      fsState,
      cancellationAuthoritative,
      acceptanceAllowed: !cancellationAuthoritative,
      automaticDispatchSuppressed: cancellationAuthoritative,
      bytesVerified,
      successClaimable: false,
      cleanupEligibleBytes: cancellationAuthoritative && fsState !== 'ABSENT',
      attempts: this.attemptCount(facts),
      reasons,
    });
  }

  /**
   * Truthful cancellation-aware projection inputs (L2 §11.1 projection
   * rules, per lineage). Cancellation sets `USER_CANCELLED` only when it
   * actually stopped remaining work; a completed accepted lineage stays
   * COMPLETE and is never retroactively revoked.
   */
  project(workItemId: string): LifecycleProjection {
    const classification = this.classify(workItemId);
    const facts = this.reader.facts(workItemId);
    const hasCancel = facts.some((fact) => fact.kind === 'USER_CANCELLED');

    if (classification.lifecycleClass === 'ACCEPTED') {
      return {
        selectionAcquisitionStatus: 'COMPLETE',
        // USER_CANCELLED is set only when cancellation actually stopped
        // remaining lifecycle work; an accepted lineage stopped nothing, so
        // per-lineage StopReason stays NONE (L2 §11.1 projection rules).
        stopReason: 'NONE',
        accepted: true,
        bytesVerified: classification.bytesVerified,
        successClaimable: classification.successClaimable,
        terminal: true,
      };
    }
    if (hasCancel && classification.cancellationAuthoritative) {
      return {
        selectionAcquisitionStatus: 'CANCELLED',
        stopReason: 'USER_CANCELLED',
        accepted: false,
        bytesVerified: classification.bytesVerified,
        successClaimable: false,
        terminal: true,
      };
    }
    if (classification.lifecycleClass === 'TERMINAL_FAILED') {
      return {
        selectionAcquisitionStatus: 'FAILED',
        stopReason: 'VALIDATION_FAILED',
        accepted: false,
        bytesVerified: classification.bytesVerified,
        successClaimable: false,
        terminal: true,
      };
    }
    return {
      selectionAcquisitionStatus: 'NOT_STARTED',
      stopReason: 'NONE',
      accepted: false,
      bytesVerified: classification.bytesVerified,
      successClaimable: false,
      terminal: false,
    };
  }

  private finish(classification: RecoveryClassification): RecoveryClassification {
    return Object.freeze({ ...classification });
  }

  private attemptCount(facts: readonly TransitionFact[]): number {
    const dispatchCount = facts.filter((fact) => fact.kind === 'DISPATCH_INTENT').length;
    const retryCount = facts.filter((fact) => fact.kind === 'EXPLICIT_RETRY_RESUME').length;
    return dispatchCount + retryCount;
  }
}

function rankFs(phase: FilesystemTruthPhase): number {
  switch (phase) {
    case 'ABSENT':
      return 0;
    case 'STAGED':
      return 1;
    case 'MATERIALIZED':
      return 2;
    case 'FINALIZED':
      return 4;
    case 'DIGEST_MISMATCH':
      return 5;
  }
}
