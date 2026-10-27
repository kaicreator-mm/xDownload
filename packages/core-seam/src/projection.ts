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
import type {
  S4ConfirmedSelectionRecord,
  S4PreviewRecord,
  LineageState,
  SeamAuthorityState,
  TargetEvidenceReceipt,
} from './state.ts';

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
  /** Core-owned identities, never inferred from failed counts by surfaces. */
  readonly failedMemberIds: readonly string[];
  readonly retriedMemberIds: readonly string[];
}

export interface SeamProjectionView {
  readonly schemaIdentity: { readonly schema: string; readonly version: string };
  readonly contract: ContractProjectionView;
  readonly snapshot?: SnapshotProjectionView;
  readonly lineage: LineageProjectionView;
  /** Present only once the lineage has a projected terminal result. */
  readonly terminal?: TerminalResult;
  /** #151 Core-frozen observed S5 page-group facts (presence = prepared). */
  readonly s5PreparedGroup?: {
    readonly prepareId: string;
    readonly snapshotId: string;
    readonly pageOrigin: string;
    readonly members: readonly {
      readonly memberId: string;
      readonly href: string;
      readonly text: string;
    }[];
    readonly observedTupleDigest: string;
    readonly status: 'AVAILABLE';
  };
  /** #151 Core-confirmed S5 selection facts (presence = confirmed). */
  readonly s5ConfirmedGroup?: {
    readonly confirmedGroupId: string;
    readonly prepareId: string;
    readonly snapshotId: string;
    readonly selectedMemberIds: readonly string[];
    readonly displayedTupleDigest: string;
    readonly confirmedAt: string;
    readonly expiresAt: string;
    /** The Core-constructed contract status (always CONFIRMED here). */
    readonly contractStatus: string;
  };
  /** #151 Core-derived per-member S5 outcomes (presence = driver recorded). */
  readonly s5Members?: readonly {
    readonly memberId: string;
    readonly href: string;
    readonly outcome: 'ACQUIRED' | 'AUTH_DENIED' | 'NOT_RUN';
    readonly accepted: boolean;
    readonly detail: string;
  }[];
  /** #154 Core-frozen S6 collection admission facts (presence = prepared). */
  readonly s6PreparedCollection?: {
    readonly prepareId: string;
    readonly snapshotId: string;
    readonly collectionOrigin: string;
    /** The exact prepared collection page URL (frozen identity of declared-range page 1). */
    readonly collectionPageUrl: string;
    readonly collectionIdentity: string;
    readonly fromPage: number;
    readonly toPage: number;
    readonly observedTupleDigest: string;
    readonly status: 'AVAILABLE';
  };
  /** #154 Core-frozen observed collection pages (presence = at least one page recorded). */
  readonly s6Pages?: readonly {
    readonly pageNumber: number;
    readonly members: readonly {
      readonly memberId: string;
      readonly href: string;
      readonly text: string;
    }[];
    /** The actually observed (admit-verified) page URL the members were scanned on. */
    readonly pageUrl: string;
    readonly observedTupleDigest: string;
  }[];
  /** #154 Core-confirmed S6 selection facts (presence = confirmed). */
  readonly s6ConfirmedCollection?: {
    readonly confirmedGroupId: string;
    readonly prepareId: string;
    readonly snapshotId: string;
    readonly selectedMemberIds: readonly string[];
    readonly displayedTupleDigest: string;
    readonly confirmedAt: string;
    readonly expiresAt: string;
    /** The Core-constructed contract status (always CONFIRMED here). */
    readonly contractStatus: string;
  };
  /** #154 Core-derived per-member S6 outcomes (presence = driver recorded). */
  readonly s6Members?: readonly {
    readonly memberId: string;
    readonly href: string;
    readonly outcome: 'ACQUIRED' | 'AUTH_DENIED' | 'NOT_RUN';
    readonly accepted: boolean;
    readonly detail: string;
  }[];
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
  /** Actual immutable requested members when Core has authoritative identity evidence. */
  readonly requestedMemberCount?: number;
  /** Auth-accessible requested identities from the durable Core accounting receipt. */
  readonly authAccessibleMemberCount?: number;
  /** Independently resolved requested identities from the durable Core accounting receipt. */
  readonly resolvedMemberCount?: number;
  /** Core-owned action semantics, present only for an authoritative terminal. */
  readonly needsUserAction?: boolean;
  /**
   * Additive durable Target evidence exposure (#101 P2-2, wire-compatible v1
   * schema unchanged): the secret-free typed identity basis + certainty of
   * the successful S1 record with its exact artifact/effect identity. Present
   * only once the trusted Core receipt exists; an unknown basis is absent
   * entirely (never synthesized), so no-digest and publisher-hash records
   * stay distinguishable on the sanctioned read projection.
   */
  readonly targetEvidence?: TargetEvidenceReceipt;
  /**
   * #153 the Core-observed S4 preview facts (L2 SEAM12 §3): present only
   * once a PREVIEW_S4_HLS_VOD intent was durably admitted. Secret-free —
   * the variants/failure the Core itself observed, never a CLI upload. The
   * trusted CLI renders ONLY these projection facts when asking the user to
   * pick a rendition.
   */
  readonly s4Preview?: S4PreviewRecord;
  /**
   * #153 the durably confirmed S4 selection facts: present only once a
   * CONFIRM_S4_SELECTION COMMIT was durably admitted (secret-free; the raw
   * challenge never appears here).
   */
  readonly s4ConfirmedSelection?: S4ConfirmedSelectionRecord;
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
      failedMemberIds: [...lineage.failedMembers],
      retriedMemberIds: [...lineage.retriedMembers],
    },
    terminal: lineage.terminal,
    // #151 additive exposure with the same explicit presence semantics: the
    // frozen/confirmed S5 page-group facts and the Core-derived per-member
    // outcomes render only when that lineage state exists.
    ...(lineage.s5PreparedGroup === undefined
      ? {}
      : {
          s5PreparedGroup: {
            prepareId: lineage.s5PreparedGroup.prepareId,
            snapshotId: lineage.s5PreparedGroup.snapshotId,
            pageOrigin: lineage.s5PreparedGroup.pageOrigin,
            members: lineage.s5PreparedGroup.members.map((member) => ({
              memberId: member.memberId,
              href: member.href,
              text: member.text,
            })),
            observedTupleDigest: lineage.s5PreparedGroup.observedTupleDigest,
            status: lineage.s5PreparedGroup.status,
          },
        }),
    ...(lineage.s5ConfirmedGroup === undefined
      ? {}
      : {
          s5ConfirmedGroup: {
            confirmedGroupId: lineage.s5ConfirmedGroup.confirmedGroupId,
            prepareId: lineage.s5ConfirmedGroup.prepareId,
            snapshotId: lineage.s5ConfirmedGroup.snapshotId,
            selectedMemberIds: [...lineage.s5ConfirmedGroup.selectedMemberIds],
            displayedTupleDigest: lineage.s5ConfirmedGroup.displayedTupleDigest,
            confirmedAt: lineage.s5ConfirmedGroup.confirmedAt,
            expiresAt: lineage.s5ConfirmedGroup.expiresAt,
            contractStatus: lineage.s5ConfirmedGroup.contract.status,
          },
        }),
    ...(lineage.s5MemberOutcomes === undefined
      ? {}
      : { s5Members: lineage.s5MemberOutcomes.map((member) => ({ ...member })) }),
    // #154 additive exposure with the same explicit presence semantics: the
    // frozen collection admission, the frozen observed pages, the confirmed
    // selection and the Core-derived per-member outcomes render only when
    // that lineage state exists.
    ...(lineage.s6PreparedCollection === undefined
      ? {}
      : {
          s6PreparedCollection: {
            prepareId: lineage.s6PreparedCollection.prepareId,
            snapshotId: lineage.s6PreparedCollection.snapshotId,
            collectionOrigin: lineage.s6PreparedCollection.collectionOrigin,
            collectionPageUrl: lineage.s6PreparedCollection.collectionPageUrl,
            collectionIdentity: lineage.s6PreparedCollection.collectionIdentity,
            fromPage: lineage.s6PreparedCollection.fromPage,
            toPage: lineage.s6PreparedCollection.toPage,
            observedTupleDigest: lineage.s6PreparedCollection.observedTupleDigest,
            status: lineage.s6PreparedCollection.status,
          },
        }),
    ...(lineage.s6Pages === undefined
      ? {}
      : {
          s6Pages: lineage.s6Pages.map((page) => ({
            pageNumber: page.pageNumber,
            members: page.members.map((member) => ({ ...member })),
            pageUrl: page.pageUrl,
            observedTupleDigest: page.observedTupleDigest,
          })),
        }),
    ...(lineage.s6ConfirmedCollection === undefined
      ? {}
      : {
          s6ConfirmedCollection: {
            confirmedGroupId: lineage.s6ConfirmedCollection.confirmedGroupId,
            prepareId: lineage.s6ConfirmedCollection.prepareId,
            snapshotId: lineage.s6ConfirmedCollection.snapshotId,
            selectedMemberIds: [...lineage.s6ConfirmedCollection.selectedMemberIds],
            displayedTupleDigest: lineage.s6ConfirmedCollection.displayedTupleDigest,
            confirmedAt: lineage.s6ConfirmedCollection.confirmedAt,
            expiresAt: lineage.s6ConfirmedCollection.expiresAt,
            contractStatus: lineage.s6ConfirmedCollection.contract.status,
          },
        }),
    ...(lineage.s6MemberOutcomes === undefined
      ? {}
      : { s6Members: lineage.s6MemberOutcomes.map((member) => ({ ...member })) }),
    // Additive §27 exposure with explicit presence semantics: a fact that is
    // unknown at this lineage state gets NO key at all, so the wire form and
    // the in-process form both render it absent (JSON.stringify drops the
    // conditional-spread absence identically).
    ...(lineage.snapshot === undefined
      ? {}
      : { selectedMemberCount: lineage.snapshot.selectedMemberIds.length }),
    ...(lineage.terminal === undefined
      ? {}
      : {
          validatedSuccessCount: lineage.terminal.validationSummary.passedCount,
          ...(lineage.terminal.stopReason === 'AUTH_REQUIRED' ||
          lineage.terminal.stopReason === 'AUTH_FAILED'
            ? { needsUserAction: true }
            : lineage.terminal.requestFulfillment === 'COMPLETE' &&
                lineage.terminal.stopReason === 'NONE'
              ? { needsUserAction: false }
              : {}),
        }),
    ...(lineage.coverageAccounting === undefined
      ? contract.requestedScope.kind === 'single_resource'
        ? { requestedMemberCount: 1 }
        : contract.requestedScope.kind === 'explicit_member_set' ||
            contract.requestedScope.kind === 'selected_collection_members'
          ? { requestedMemberCount: contract.requestedScope.memberIds.length }
          : {}
      : {
          // Never trust stored bare counts: derive the public facts from the
          // replay-safe identity sets in the trusted Core accounting receipt.
          requestedMemberCount: lineage.coverageAccounting.requested.length,
          authAccessibleMemberCount: lineage.coverageAccounting.authAccessible.length,
          resolvedMemberCount: lineage.coverageAccounting.resolved.length,
        }),
    // Additive §27-pattern exposure (#101 P2-2): the durable Target evidence
    // receipt is projected verbatim when present, absent when unknown.
    ...(lineage.targetEvidence === undefined ? {} : { targetEvidence: lineage.targetEvidence }),
    // #153 additive exposure: the Core-observed preview facts and the
    // confirmed selection facts ride the aggregate projection verbatim
    // (secret-free, deep-frozen read-only values shared by reference).
    ...(lineage.s4Preview === undefined ? {} : { s4Preview: lineage.s4Preview }),
    ...(lineage.s4ConfirmedSelection === undefined
      ? {}
      : { s4ConfirmedSelection: lineage.s4ConfirmedSelection }),
  };
  return deepFreeze(view);
}
