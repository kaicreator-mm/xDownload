import {
  buildCoverageAccounting,
  createEvidenceLedger,
  makeAuthorizationContextRef,
  makeCollectionId,
  makeContractId,
  makeEvidenceId,
  makeMemberId,
  makeSnapshotId,
  unwrapOrThrow,
  type CollectionId,
  type ContractId,
  type CoverageAccounting,
  type CoverageTarget,
  type EvidenceId,
  type EvidenceLedger,
  type MemberId,
  type SnapshotId,
} from '../src/index.ts';

/**
 * T007 projection/behavior-level fixtures. Evidence and validation records
 * are built RAW so every test exercises the fail-closed admission paths;
 * accounting/projection inputs are built through the canonical builders.
 */

export const T007_RECORDED_AT = '2026-10-04T02:00:00Z';

export const T007_COLLECTION = 'collection/t007-gallery-001';

/** Branded-id shortcuts (validated through the canonical id decoders). */
export const t007Contract = (raw: string): ContractId => unwrapOrThrow(makeContractId(raw));
export const t007Snapshot = (raw: string): SnapshotId => unwrapOrThrow(makeSnapshotId(raw));
export const t007CollectionId = (raw: string) => unwrapOrThrow(makeCollectionId(raw));

const toEvidenceId = (raw: string): EvidenceId => unwrapOrThrow(makeEvidenceId(raw));

export const t007CoverageTarget = (scopeKey: string, snapshotVersion = 1): CoverageTarget => ({
  collectionIdentity: t007CollectionId(T007_COLLECTION),
  scopeKind: 'entire_supported_collection',
  scopeIdentityKey: scopeKey,
  snapshotVersion,
});

/** Fresh member ids with a scenario-unique prefix (distinct identities per oracle). */
export function members(prefix: string, count: number): MemberId[] {
  return Array.from({ length: count }, (_unused, index) =>
    unwrapOrThrow(makeMemberId(`${prefix}-${String(index + 1).padStart(2, '0')}`)),
  );
}

/** Raw evidence record for ledger admission (untrusted input shape). */
export function evidenceRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    evidenceId: 'evidence-t007-001',
    claimType: 'TRANSFER',
    claimSubject: { kind: 'MEMBER', ref: 'member-t007-001' },
    sourceType: 'INDEPENDENT_VALIDATOR',
    provenance: { sourceIdentity: 'validator/t007-001' },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'BATCH_DOWNLOAD' },
    certaintyClass: 'DECISIVE',
    ...overrides,
  };
}

export function appendEvidenceOk(ledger: EvidenceLedger, raw: unknown) {
  return unwrapOrThrow(ledger.append(raw));
}

/** Oracle-grade independent evidence for one member + claim, appended to the ledger. */
export function appendMemberEvidence(
  ledger: EvidenceLedger,
  fields: {
    evidenceId: string;
    claimType: string;
    memberRef: string;
    sourceType?: string;
    certaintyClass?: string;
    independence?: string;
    sourceIdentity?: string;
    claimSubjectKind?: string;
    contractRef?: string;
    snapshotRef?: string;
  },
) {
  return appendEvidenceOk(
    ledger,
    evidenceRaw({
      evidenceId: fields.evidenceId,
      claimType: fields.claimType,
      claimSubject: { kind: fields.claimSubjectKind ?? 'MEMBER', ref: fields.memberRef },
      sourceType: fields.sourceType ?? 'INDEPENDENT_VALIDATOR',
      certaintyClass: fields.certaintyClass ?? 'DECISIVE',
      independenceFromDiscovery: fields.independence ?? 'INDEPENDENT',
      provenance: { sourceIdentity: fields.sourceIdentity ?? `validator/${fields.evidenceId}` },
      scope: {
        domain: 'BATCH_DOWNLOAD',
        contractRef: fields.contractRef,
        snapshotRef: fields.snapshotRef,
      },
    }),
  );
}

export interface AccountingOverrides {
  readonly coverageTarget?: CoverageTarget;
  readonly requestedMemberIds?: readonly MemberId[];
  readonly resolvedMemberIds?: readonly MemberId[];
  readonly authAccessibleMemberIds?: readonly MemberId[];
  readonly authInaccessibleMembers?: readonly {
    readonly memberId: MemberId;
    readonly classificationEvidenceId?: string;
  }[];
  readonly selectedMemberIds?: readonly MemberId[];
  readonly validatedMemberIds?: readonly MemberId[];
  readonly authorizationContextRef?: string;
  readonly parentCollectionCoverage?: {
    readonly collectionIdentity: CollectionId;
    readonly status:
      'VERIFIED_COMPLETE' | 'VERIFIED_SUBSET' | 'TRUNCATED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  };
}

/** Build accounting through the canonical builder; the ledger backs classification evidence. */
export function accountingOf(
  overrides: AccountingOverrides = {},
  ledger: EvidenceLedger = createEvidenceLedger(),
): CoverageAccounting {
  const requested = overrides.requestedMemberIds ?? members('member-t007-base', 3);
  const input = {
    coverageTarget:
      overrides.coverageTarget ??
      t007CoverageTarget('entire_supported_collection:collection/t007-gallery-001'),
    requestedMemberIds: requested,
    resolvedMemberIds: overrides.resolvedMemberIds ?? requested,
    authAccessibleMemberIds: overrides.authAccessibleMemberIds ?? requested,
    authInaccessibleMembers: (overrides.authInaccessibleMembers ?? []).map((member) => ({
      ...member,
      classificationEvidenceId:
        member.classificationEvidenceId === undefined
          ? undefined
          : toEvidenceId(member.classificationEvidenceId),
    })),
    selectedMemberIds: overrides.selectedMemberIds ?? requested,
    validatedMemberIds: overrides.validatedMemberIds ?? requested,
    authorizationContextRef:
      overrides.authorizationContextRef === undefined
        ? undefined
        : unwrapOrThrow(makeAuthorizationContextRef(overrides.authorizationContextRef)),
    parentCollectionCoverage: overrides.parentCollectionCoverage,
  };
  return unwrapOrThrow(buildCoverageAccounting(input, ledger));
}
