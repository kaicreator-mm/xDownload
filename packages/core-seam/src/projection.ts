/**
 * T004 projection read side (frozen L2 §6.7/§10).
 *
 * Surfaces read Core-owned projections through the seam; per-surface status
 * derivation remains rejected, terminal truth is not rewritable and no
 * surface-owned budget/result state is creatable through the seam. Views are
 * deep-frozen canonical read-only values: they may be rendered but never
 * become authority.
 */

import {
  deepFreeze,
  type AcquisitionContract,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import type { LineageState, SeamAuthorityState } from './state.ts';

export interface ContractProjectionView {
  readonly contractId: string;
  readonly status: AcquisitionContract['status'];
  readonly intentType: AcquisitionContract['intentType'];
  readonly revision: number;
  readonly supersedesContractId?: string;
}

export interface SnapshotProjectionView {
  readonly snapshotId: string;
  readonly contractId: string;
  readonly selectedMemberIds: readonly string[];
  readonly createdAt: string;
}

export interface LineageProjectionView {
  readonly status: LineageState['status'];
  readonly cancelOrder?: number;
  readonly failedMemberCount: number;
  readonly retriedMemberIds: readonly string[];
}

export interface SeamProjectionView {
  readonly schemaIdentity: { readonly schema: string; readonly version: string };
  readonly contract: ContractProjectionView;
  readonly snapshot?: SnapshotProjectionView;
  readonly lineage: LineageProjectionView;
  /** Present only once the lineage has a projected terminal result. */
  readonly terminal?: TerminalResult;
}

/**
 * Build the read-only projection view for one aggregate. Returns undefined
 * when the aggregate does not exist (unknown-subject queries reject upstream).
 */
export function projectAggregate(
  state: SeamAuthorityState,
  aggregateId: string,
): SeamProjectionView | undefined {
  const aggregate = state.aggregates.get(aggregateId);
  if (aggregate === undefined) {
    return undefined;
  }
  const lineage = state.lineages.get(aggregateId);
  if (lineage === undefined) {
    return undefined;
  }
  const contract = aggregate.contract;
  const view: SeamProjectionView = {
    schemaIdentity: { ...contract.schemaIdentity },
    contract: {
      contractId: contract.contractId,
      status: contract.status,
      intentType: contract.intentType,
      revision: aggregate.revision,
      supersedesContractId: contract.supersedesContractId,
    },
    snapshot: lineage.snapshot && {
      snapshotId: lineage.snapshot.snapshotId,
      contractId: lineage.snapshot.contractId,
      selectedMemberIds: [...lineage.snapshot.selectedMemberIds],
      createdAt: lineage.snapshot.createdAt,
    },
    lineage: {
      status: lineage.status,
      cancelOrder: lineage.cancelOrder,
      failedMemberCount: lineage.failedMembers.length,
      retriedMemberIds: [...lineage.retriedMembers],
    },
    terminal: lineage.terminal,
  };
  return deepFreeze(view);
}
