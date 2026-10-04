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
  type ContinuationScope,
  type RequestedScope,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import type { LineageState, SeamAuthorityState } from './state.ts';

export interface ContractProjectionView {
  readonly contractId: string;
  readonly status: AcquisitionContract['status'];
  readonly intentType: AcquisitionContract['intentType'];
  readonly revision: number;
  readonly supersedesContractId?: string;
  /**
   * Additive PRD §27 exposure (wire-compatible, v1 schema unchanged): the
   * confirmed contract's immutable requested/continuation scope, projected
   * verbatim as read-only canonical values. Present whenever the aggregate
   * exists (always, in v1); typed optional so presence stays the explicit
   * contract and an absent fact is rendered absent by consumers, never
   * synthesized.
   */
  readonly requestedScope?: RequestedScope;
  readonly continuationScope?: ContinuationScope;
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
  /**
   * Additive PRD §27 exposure (wire-compatible, v1 schema unchanged): the
   * cardinality of the confirmed selection identity list. Present only while
   * a snapshot is confirmed; when unknown the key is absent entirely (never
   * null/0) so consumers render the fact as absent, not invented.
   */
  readonly selectedMemberCount?: number;
  /**
   * Additive PRD §27 exposure (wire-compatible, v1 schema unchanged): the
   * projected validation summary's passed count. Present only once a terminal
   * result is projected; when unknown the key is absent entirely.
   */
  readonly validatedSuccessCount?: number;
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
      // Additive §27 exposure: the scope values are read-only canonical
      // domain values (already deep-frozen by the domain decode); shared by
      // reference exactly like the terminal result, never writable here.
      requestedScope: contract.requestedScope,
      continuationScope: contract.continuationScope,
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
    // Additive §27 exposure with explicit presence semantics: a fact that is
    // unknown at this lineage state gets NO key at all, so the wire form and
    // the in-process form both render it absent (JSON.stringify drops the
    // conditional-spread absence identically).
    ...(lineage.snapshot === undefined
      ? {}
      : { selectedMemberCount: lineage.snapshot.selectedMemberIds.length }),
    ...(lineage.terminal === undefined
      ? {}
      : { validatedSuccessCount: lineage.terminal.validationSummary.passedCount }),
  };
  return deepFreeze(view);
}
