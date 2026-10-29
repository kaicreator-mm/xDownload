/**
 * T010 auth-limited terminal-result projection (PRD §16.5/§17/§18,
 * counterexamples C10/C24).
 *
 * The browser/auth seam must produce the exact multidimensional truthful
 * tuple when authorization limits or fails — never a narrowed COMPLETE and
 * never a fallback acquisition:
 *
 * - C10 (whole collection, auth acquires a subset, inaccessible identities
 *   known): Request PARTIAL; Resolution RESOLVED; Selection COMPLETE;
 *   Coverage VERIFIED_COMPLETE for the immutable requested scope;
 *   StopReason AUTH_REQUIRED; requested scope stays the full reference set.
 * - C24 (auth failure yields no targets): Request UNSATISFIED; Resolution
 *   BLOCKED; Selection NOT_STARTED; Coverage UNKNOWN; StopReason
 *   AUTH_REQUIRED or AUTH_FAILED per §16.5.
 *
 * The projection is built from the canonical `TerminalResult` vocabulary and
 * re-validated through the canonical legal-combination validator, so the
 * seam cannot invent its own success semantics (frozen L2 invariant 17).
 */

import {
  buildTerminalResult,
  makeContractId,
  makeMemberId,
  makeSnapshotId,
  validateTerminalResult,
  type CoverageEvidence,
  type ContractIntentType,
  type MemberId,
  type ScopePrimitive,
  type SelectedMemberValidationOutcome,
  type SnapshotId,
  type TerminalResult,
  type TerminalResultContext,
} from '@xdownload/domain-contracts';
import { brokerFail, brokerOk, type BrokerResult } from './result.ts';

export type AuthFailureKind = 'AUTH_REQUIRED' | 'AUTH_FAILED';

export interface AuthLimitedProjectionInput {
  readonly contractId: string;
  readonly snapshotId?: string;
  readonly intentType: ContractIntentType;
  readonly scopeKind: ScopePrimitive;
  /** Immutable requested-scope reference count (e.g. 18 in C10). */
  readonly requestedScopeCount: number;
  /** Requested identities that are accessible/acquired/validated under the current authorization. */
  readonly accessibleMemberIds: readonly string[];
  /** Requested identities known and independently classified as auth-inaccessible. */
  readonly inaccessibleMemberIds: readonly string[];
  /** Truthful auth stop reason per §16.5. */
  readonly authStopReason: AuthFailureKind;
  readonly recordedAt: string;
}

export interface AuthLimitedAccounting {
  readonly requestedScopeCount: number;
  readonly requestedAccountedCount: number;
  readonly authAccessibleCount: number;
  readonly authInaccessibleCount: number;
  readonly selectedCount: number;
  readonly validatedSuccessCount: number;
}

/** §17.2 accounting for the auth-limited projection. */
export function authLimitedAccounting(input: AuthLimitedProjectionInput): AuthLimitedAccounting {
  const accessible = input.accessibleMemberIds.length;
  const inaccessible = input.inaccessibleMemberIds.length;
  return {
    requestedScopeCount: input.requestedScopeCount,
    requestedAccountedCount: accessible + inaccessible,
    authAccessibleCount: accessible,
    authInaccessibleCount: inaccessible,
    selectedCount: accessible,
    validatedSuccessCount: accessible,
  };
}

/**
 * Project the truthful auth-limited tuple through the canonical validator.
 * Fails closed if the combination would be illegal — the seam cannot
 * normalize an auth-limited outcome into success.
 */
export function projectAuthLimitedResult(
  input: AuthLimitedProjectionInput,
): BrokerResult<TerminalResult> {
  const accounting = authLimitedAccounting(input);
  const accessible = input.accessibleMemberIds.length;
  const stopReason = input.authStopReason;
  const hasAccessibleTargets = accessible > 0;
  if (hasAccessibleTargets && accounting.requestedAccountedCount !== input.requestedScopeCount) {
    // A coverage claim (VERIFIED_COMPLETE) requires complete requested-scope
    // accounting; incomplete accounting can never project coverage.
    return brokerFail([
      {
        code: 'MALFORMED_REQUIRED_FIELD',
        path: 'authLimitedProjection',
        message: `requested scope accounting must be complete for a coverage claim: accounted ${accounting.requestedAccountedCount} vs requested ${input.requestedScopeCount}`,
        invariant: 'PRD-§17',
      },
    ]);
  }

  const memberIds: MemberId[] = [];
  for (const id of input.accessibleMemberIds) {
    const decoded = makeMemberId(id);
    if (!decoded.ok) {
      return brokerFail(decoded.diagnostics);
    }
    memberIds.push(decoded.value);
  }
  const validationOutcomes: SelectedMemberValidationOutcome[] = memberIds.map((memberId) => ({
    memberId,
    requiredValidationPassed: true,
  }));

  let coverageEvidence: CoverageEvidence | undefined;
  if (hasAccessibleTargets) {
    const accountedIdentities: string[] = [
      ...input.accessibleMemberIds,
      ...input.inaccessibleMemberIds,
    ];
    coverageEvidence = {
      kind: 'SUFFICIENT',
      basis: {
        basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
        identities: accountedIdentities,
      },
    };
  }

  const contractId = makeContractId(input.contractId);
  if (!contractId.ok) {
    return brokerFail(contractId.diagnostics);
  }
  let snapshotIdValue: SnapshotId | undefined;
  if (input.snapshotId !== undefined) {
    const decoded = makeSnapshotId(input.snapshotId);
    if (!decoded.ok) {
      return brokerFail(decoded.diagnostics);
    }
    snapshotIdValue = decoded.value;
  }

  const validationSummary = hasAccessibleTargets
    ? { status: 'ALL_PASSED' as const, passedCount: accessible, failedCount: 0 }
    : { status: 'NOT_PERFORMED' as const, passedCount: 0, failedCount: 0 };

  const candidate = buildTerminalResult({
    contractId: contractId.value,
    ...(snapshotIdValue === undefined ? {} : { snapshotId: snapshotIdValue }),
    requestFulfillment: hasAccessibleTargets ? 'PARTIAL' : 'UNSATISFIED',
    targetResolution: hasAccessibleTargets ? 'RESOLVED' : 'BLOCKED',
    selectionAcquisition: hasAccessibleTargets ? 'COMPLETE' : 'NOT_STARTED',
    coverage: hasAccessibleTargets ? 'VERIFIED_COMPLETE' : 'UNKNOWN',
    stopReason,
    validationSummary,
    recordedAt: input.recordedAt,
  });
  if (!candidate.ok) {
    return brokerFail(candidate.diagnostics);
  }
  const context: TerminalResultContext = {
    intentType: input.intentType,
    scopeKind: input.scopeKind,
    selectedMemberCount: accessible,
    ...(hasAccessibleTargets ? { selectedValidationOutcomes: validationOutcomes } : {}),
    ...(coverageEvidence !== undefined ? { coverageEvidence } : {}),
    ...(input.inaccessibleMemberIds.length > 0
      ? { knownAuthInaccessibleRequestedCount: input.inaccessibleMemberIds.length }
      : {}),
  };
  const legal = validateTerminalResult(candidate.value, context);
  if (!legal.ok) {
    return brokerFail(legal.diagnostics);
  }
  return brokerOk(candidate.value);
}
