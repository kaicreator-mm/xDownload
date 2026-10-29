/**
 * T002 stable adapter-facing ports.
 *
 * Surfaces (Desktop/Browser/CLI) submit canonical values and read
 * projections; they never own lifecycle truth (frozen L2 invariant 2 /
 * ADR-001). The gateway here is a pure decode+validate boundary: untrusted
 * surface input becomes a canonical value only after fail-closed
 * validation, and canonical authority never leaks to adapters as mutable
 * state.
 */

import { diagnostic, fail, type DomainValidationResult } from './diagnostics.ts';
import {
  decodeAcquisitionContract,
  admitCollectionContract,
  type AcquisitionContract,
} from './contract.ts';
import {
  decodeSelectionSnapshot,
  sameScopeSnapshotBinding,
  validateSnapshotSemantics,
  type SelectionSnapshot,
} from './snapshot.ts';
import { sameContinuationIdentity } from './scope.ts';
import {
  decodeTerminalResult,
  validateTerminalResult,
  type TerminalResult,
  type TerminalResultContext,
} from './result.ts';
import { decodeEvidenceRecord, type EvidenceRecord } from './evidence.ts';

/**
 * Canonical domain gateway: the only seam a surface/adapter needs. Every
 * method accepts `unknown` input and returns validated canonical values or
 * typed rejections.
 */
export interface DomainGateway {
  /** Decode + admit a contract (collection admission included). */
  submitContract(raw: unknown): DomainValidationResult<AcquisitionContract>;
  /** Confirm a snapshot bound to a confirmed contract. */
  confirmSnapshot(
    raw: unknown,
    contract: AcquisitionContract,
  ): DomainValidationResult<SelectionSnapshot>;
  /** Append typed evidence with provenance. */
  appendEvidence(raw: unknown): DomainValidationResult<EvidenceRecord>;
  /** Validate a terminal result against legal-combination semantics. */
  projectTerminalResult(
    raw: unknown,
    context: TerminalResultContext,
  ): DomainValidationResult<TerminalResult>;
}

function gatewayError(result: DomainValidationResult<never>): DomainValidationResult<never> {
  return result;
}

export function createDomainGateway(): DomainGateway {
  return {
    submitContract(raw) {
      const contract = decodeAcquisitionContract(raw);
      if (!contract.ok) {
        return gatewayError(contract);
      }
      const admitted = admitCollectionContract(contract.value);
      if (!admitted.ok) {
        return gatewayError(admitted as DomainValidationResult<never>);
      }
      return contract;
    },
    confirmSnapshot(raw, contract) {
      const snapshot = decodeSelectionSnapshot(raw);
      if (!snapshot.ok) {
        return gatewayError(snapshot);
      }
      if (snapshot.value.contractId !== contract.contractId) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            'snapshot.contractId',
            `snapshot binds contract '${snapshot.value.contractId}' but confirmation was requested for '${contract.contractId}'`,
          ),
        ]);
      }
      if (contract.status !== 'CONFIRMED') {
        return fail([
          diagnostic(
            'SCOPE_MUTATION',
            'contract.status',
            'snapshots confirm only against confirmed contracts',
          ),
        ]);
      }
      const binding = sameScopeSnapshotBinding(
        snapshot.value.requestedScope,
        contract.requestedScope,
      );
      if (!binding) {
        return fail([
          diagnostic(
            'SCOPE_MUTATION',
            'snapshot.requestedScope',
            'snapshot requested scope must bind the confirmed contract requested scope',
            'PRD-§12',
          ),
        ]);
      }
      // continuation_scope is frozen inside the snapshot (PRD §12) and must
      // bind the confirmed contract's continuation: an expanded or otherwise
      // different continuation authority can never confirm against this
      // contract — it requires a successor contract and successor snapshot.
      if (!sameContinuationIdentity(snapshot.value.continuationScope, contract.continuationScope)) {
        return fail([
          diagnostic(
            'SCOPE_MUTATION',
            'snapshot.continuationScope',
            'snapshot continuation scope must bind the confirmed contract continuation scope; expanded continuation requires a successor contract and snapshot',
            'PRD-§12',
          ),
        ]);
      }
      const semantics = validateSnapshotSemantics(snapshot.value);
      if (!semantics.ok) {
        return gatewayError(semantics as DomainValidationResult<never>);
      }
      return snapshot;
    },
    appendEvidence(raw) {
      return decodeEvidenceRecord(raw);
    },
    projectTerminalResult(raw, context) {
      const result = decodeTerminalResult(raw);
      if (!result.ok) {
        return gatewayError(result);
      }
      const legal = validateTerminalResult(result.value, context);
      if (!legal.ok) {
        return gatewayError(legal as DomainValidationResult<never>);
      }
      return result;
    },
  };
}

/**
 * Effect command envelope for later lanes: commands carry opaque identity
 * references only — never raw secrets, never mutable canonical state.
 */
export interface SurfaceCommand {
  readonly effectId: string;
  readonly contractId: string;
  readonly kind: 'START' | 'PAUSE' | 'CANCEL' | 'RESUME' | 'RETRY_FAILED_MEMBERS';
}

/**
 * Read-only terminal projection handed to surfaces. Surfaces may render it
 * but never rewrite canonical truth (frozen L2 invariant 2).
 */
export interface TerminalResultProjection {
  readonly contractId: string;
  readonly snapshotId?: string;
  readonly terminal: TerminalResult;
}

export function projectForSurface(result: TerminalResult): TerminalResultProjection {
  return { contractId: result.contractId, snapshotId: result.snapshotId, terminal: result };
}
