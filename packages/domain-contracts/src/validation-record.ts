/**
 * T007 ValidationRecord — validator output bound to exact subject/layer/
 * snapshot identity (frozen L2 §6.7, PRD §22).
 *
 * A validation record proves exactly the claim, subject and layer it names:
 * cross-claim or cross-subject promotion rejects at the binding gate. The
 * registry consumes evidence from the EvidenceLedger; a PASS outcome requires
 * oracle-grade independent evidence for the named layer — discovery-derived
 * or suggestion provenance can never serve as the sole oracle for the same
 * semantic claim (L2 invariant 6), and user confirmation can never satisfy
 * Transfer/Format/Media validation (PRD §21, C26/C27).
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { decodeSchemaIdentity, type SchemaIdentity } from './version.ts';
import {
  makeEvidenceId,
  makeValidationRecordId,
  type EvidenceId,
  type MemberId,
  type ValidationRecordId,
} from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireInteger,
  requireIsoTimestamp,
  requireLiteral,
  requireNonEmptyString,
  requireOptionalString,
  requireArrayOfStrings,
} from './decode.ts';
import {
  assertNoDiscoverySelfCertification,
  assertValidatesRequiredLayer,
  whatConfirmationProves,
  type BaselinePlanRef,
  type ClaimSubject,
  type ClaimType,
  type ConfirmationType,
  type ValidationLayer,
} from './evidence.ts';
import type { EvidenceLedger } from './ledger.ts';

export type ValidationOutcome = 'PASS' | 'FAIL';

/** Layer -> the semantic claim type a passing record proves (PRD §22 layers). */
export function claimTypeForLayer(layer: ValidationLayer): ClaimType {
  switch (layer) {
    case 'transfer':
      return 'TRANSFER';
    case 'format':
      return 'FORMAT';
    case 'media':
      return 'MEDIA';
    case 'target':
      return 'RESOURCE_IDENTITY';
    case 'membership':
      return 'MEMBERSHIP';
    case 'coverage':
      return 'COVERAGE';
  }
}

export interface ValidationRecord {
  readonly schemaIdentity: SchemaIdentity;
  readonly validationId: ValidationRecordId;
  readonly layer: ValidationLayer;
  /** Exact subject this record proves: artifact/target/member identity. */
  readonly subject: ClaimSubject;
  readonly outcome: ValidationOutcome;
  readonly contractRef?: string;
  readonly snapshotRef?: string;
  /** Experiment/baseline binding; changed baselines invalidate the record (C33). */
  readonly baselineRef?: BaselinePlanRef;
  /** Set when the record must prove a specific semantic claim type. */
  readonly claimType?: ClaimType;
  /** Confirmation type when the record consumes USER_CONFIRMATION evidence. */
  readonly confirmationType?: ConfirmationType;
  /** Evidence records consumed, by ledger id (independence carried by the evidence). */
  readonly evidenceRefs: readonly EvidenceId[];
  readonly validatorIdentity: string;
  readonly recordedAt: string;
}

const VALIDATION_KEYS: readonly string[] = [
  'schemaIdentity',
  'validationId',
  'layer',
  'subject',
  'outcome',
  'contractRef',
  'snapshotRef',
  'baselineRef',
  'claimType',
  'confirmationType',
  'evidenceRefs',
  'validatorIdentity',
  'recordedAt',
];

const CLAIM_TYPES: readonly ClaimType[] = [
  'RESOURCE_IDENTITY',
  'MEMBERSHIP',
  'SELECTION',
  'QUALITY',
  'AUTHORIZATION',
  'TRANSFER',
  'FORMAT',
  'MEDIA',
  'COVERAGE',
];

const CONFIRMATION_TYPES: readonly ConfirmationType[] = [
  'CONFIRM_RESOURCE_IDENTITY',
  'CONFIRM_MEMBERSHIP',
  'CONFIRM_SELECTION',
  'CONFIRM_QUALITY_CHOICE',
  'ACCEPT_TARGET_CHANGE',
];

const BASELINE_KEYS: readonly string[] = ['baselineId', 'version'];

function decodeBaselineRef(value: unknown): DomainValidationResult<BaselinePlanRef> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'validationRecord.baselineRef'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, BASELINE_KEYS, 'validationRecord.baselineRef'), diagnostics);
  const baselineId = unwrap(
    requireNonEmptyString(record, 'baselineId', 'validationRecord.baselineRef'),
    diagnostics,
  );
  const version = requireInteger(record, 'version', 'validationRecord.baselineRef');
  if (!version.ok) {
    diagnostics.push(...version.diagnostics);
  }
  if (diagnostics.length > 0 || baselineId === undefined || !version.ok) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ baselineId, version: version.value }));
}

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}

function pushAll(result: DomainValidationResult<void>, diagnostics: ValidationDiagnostic[]): void {
  if (!result.ok) {
    diagnostics.push(...result.diagnostics);
  }
}

/** Decode one validation record from untrusted input; fail closed. */
export function decodeValidationRecord(value: unknown): DomainValidationResult<ValidationRecord> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'validationRecord'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'validationRecord'), diagnostics);
  pushAll(rejectUnknownFields(record, VALIDATION_KEYS, 'validationRecord'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const validationIdRaw = unwrap(
    requireNonEmptyString(record, 'validationId', 'validationRecord'),
    diagnostics,
  );
  const validationId =
    validationIdRaw === undefined
      ? undefined
      : unwrap(makeValidationRecordId(validationIdRaw), diagnostics);
  const layer = unwrap(
    requireLiteral(
      record,
      'layer',
      ['transfer', 'format', 'media', 'target', 'membership', 'coverage'] as const,
      'validationRecord',
    ),
    diagnostics,
  );
  const subject = unwrap(decodeClaimSubject(record['subject']), diagnostics);
  const outcome = unwrap(
    requireLiteral(record, 'outcome', ['PASS', 'FAIL'] as const, 'validationRecord'),
    diagnostics,
  );
  const contractRef = unwrap(
    requireOptionalString(record, 'contractRef', 'validationRecord'),
    diagnostics,
  );
  const snapshotRef = unwrap(
    requireOptionalString(record, 'snapshotRef', 'validationRecord'),
    diagnostics,
  );
  let baselineRef: BaselinePlanRef | undefined;
  if ('baselineRef' in record && record['baselineRef'] !== undefined) {
    baselineRef = unwrap(decodeBaselineRef(record['baselineRef']), diagnostics);
  }
  let claimType: ClaimType | undefined;
  const claimTypeRaw = unwrap(
    requireOptionalString(record, 'claimType', 'validationRecord'),
    diagnostics,
  );
  if (claimTypeRaw !== undefined) {
    claimType = unwrap(
      requireLiteral(record, 'claimType', CLAIM_TYPES, 'validationRecord'),
      diagnostics,
    );
  }
  let confirmationType: ConfirmationType | undefined;
  const confirmationRaw = unwrap(
    requireOptionalString(record, 'confirmationType', 'validationRecord'),
    diagnostics,
  );
  if (confirmationRaw !== undefined) {
    confirmationType = unwrap(
      requireLiteral(record, 'confirmationType', CONFIRMATION_TYPES, 'validationRecord'),
      diagnostics,
    );
  }
  const evidenceRefsRaw = unwrap(
    requireArrayOfStrings(record, 'evidenceRefs', 'validationRecord'),
    diagnostics,
  );
  const evidenceRefs: EvidenceId[] = [];
  for (const raw of evidenceRefsRaw ?? []) {
    const evidenceId = makeEvidenceId(raw);
    if (evidenceId.ok) {
      evidenceRefs.push(evidenceId.value);
    } else {
      diagnostics.push(...evidenceId.diagnostics);
    }
  }
  const validatorIdentity = unwrap(
    requireNonEmptyString(record, 'validatorIdentity', 'validationRecord'),
    diagnostics,
  );
  const recordedAt = unwrap(
    requireIsoTimestamp(record, 'recordedAt', 'validationRecord'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  if (evidenceRefs.length === 0) {
    return fail([
      diagnostic(
        'MISSING_REQUIRED_FIELD',
        'validationRecord.evidenceRefs',
        'a validation record must reference the evidence it consumed',
      ),
    ]);
  }
  const decoded: ValidationRecord = deepFreeze({
    schemaIdentity: schemaIdentity!,
    validationId: validationId!,
    layer: layer!,
    subject: subject!,
    outcome: outcome!,
    contractRef,
    snapshotRef,
    baselineRef,
    claimType,
    confirmationType,
    evidenceRefs,
    validatorIdentity: validatorIdentity!,
    recordedAt: recordedAt!,
  });
  if (decoded.claimType !== undefined) {
    const proven = claimTypeForLayer(decoded.layer);
    if (decoded.claimType !== proven) {
      return fail([
        diagnostic(
          'VALIDATION_CLAIM_BINDING_MISMATCH',
          'validationRecord.claimType',
          `layer '${decoded.layer}' proves claim '${proven}', not '${decoded.claimType}'; no cross-claim promotion`,
          'PRD-§22',
        ),
      ]);
    }
  }
  if (decoded.confirmationType !== undefined) {
    const proves = whatConfirmationProves(decoded.confirmationType);
    const proven = decoded.claimType ?? claimTypeForLayer(decoded.layer);
    if (proves.proves !== proven) {
      return fail([
        diagnostic(
          'VALIDATION_CLAIM_BINDING_MISMATCH',
          'validationRecord.confirmationType',
          `confirmation '${decoded.confirmationType}' proves only '${proves.proves}'; it cannot prove '${proven}'`,
          'C26/PRD-§21',
        ),
      ]);
    }
  }
  return ok(decoded);
}

function decodeClaimSubject(value: unknown): DomainValidationResult<ClaimSubject> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'validationRecord.subject'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, ['kind', 'ref'], 'validationRecord.subject'), diagnostics);
  const kind = unwrap(
    requireLiteral(
      record,
      'kind',
      ['LOGICAL_TARGET', 'MEMBER', 'EFFECT', 'COVERAGE_TARGET', 'RESOURCE'] as const,
      'validationRecord.subject',
    ),
    diagnostics,
  );
  const ref = unwrap(requireNonEmptyString(record, 'ref', 'validationRecord.subject'), diagnostics);
  if (diagnostics.length > 0 || kind === undefined || ref === undefined) {
    return fail(
      diagnostics.length > 0
        ? diagnostics
        : [diagnostic('MALFORMED_REQUIRED_FIELD', 'validationRecord.subject', 'invalid subject')],
    );
  }
  return ok(deepFreeze({ kind, ref }));
}

/** Exact binding a claim must name to be satisfied by a validation record. */
export interface ValidationClaim {
  readonly layer: ValidationLayer;
  readonly subject: ClaimSubject;
  readonly contractRef?: string;
  readonly snapshotRef?: string;
  readonly baselineRef?: BaselinePlanRef;
}

function subjectEquals(a: ClaimSubject, b: ClaimSubject): boolean {
  return a.kind === b.kind && a.ref === b.ref;
}

function baselineEquals(a: BaselinePlanRef | undefined, b: BaselinePlanRef | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.baselineId === b.baselineId && a.version === b.version;
}

/**
 * Registry of validation records over one evidence ledger. Admission is the
 * binding gate: evidence must exist, must be oracle-grade for the layer on
 * PASS, must not self-certify discovery, and confirmations prove only their
 * shown claim. `satisfies` is the only way projection consumes records and it
 * never promotes across subject, layer, snapshot or baseline.
 */
export interface ValidationRegistry {
  readonly register: (raw: unknown) => DomainValidationResult<ValidationRecord>;
  readonly records: () => readonly ValidationRecord[];
  readonly findByValidationId: (validationId: ValidationRecordId) => ValidationRecord | undefined;
  /** Satisfy a claim from an accepted PASS record bound to exactly that claim. */
  readonly satisfies: (claim: ValidationClaim) => DomainValidationResult<ValidationRecord>;
}

export function createValidationRegistry(ledger: EvidenceLedger): ValidationRegistry {
  const registered: ValidationRecord[] = [];
  const byId = new Map<string, ValidationRecord>();

  return deepFreeze({
    register(raw) {
      const decoded = decodeValidationRecord(raw);
      if (!decoded.ok) {
        return decoded;
      }
      const record = decoded.value;
      if (byId.has(record.validationId)) {
        return fail([
          diagnostic(
            'ADMISSION_REJECTED',
            'validationRecord.validationId',
            `validation record '${record.validationId}' is already registered`,
          ),
        ]);
      }
      for (const ref of record.evidenceRefs) {
        const evidence = ledger.findByEvidenceId(ref);
        if (evidence === undefined) {
          return fail([
            diagnostic(
              'ADMISSION_REJECTED',
              'validationRecord.evidenceRefs',
              `validation record references unknown evidence '${ref}'`,
            ),
          ]);
        }
        if (record.outcome === 'PASS') {
          const layerOk = assertValidatesRequiredLayer(evidence, record.layer);
          if (!layerOk.ok) {
            return layerOk;
          }
          if (evidence.independenceFromDiscovery === 'DISCOVERY_DERIVED') {
            const selfCertified = assertNoDiscoverySelfCertification(evidence, evidence);
            if (!selfCertified.ok) {
              return selfCertified;
            }
          }
          // The same claim must not already be discovery-produced and validated
          // from the same discovery source identity (L2 invariant 6, C34).
          for (const discoveryRecord of ledger.query({
            claimType: claimTypeForLayer(record.layer),
            subject: evidence.claimSubject,
          })) {
            if (discoveryRecord.independenceFromDiscovery === 'DISCOVERY_DERIVED') {
              const crossCheck = assertNoDiscoverySelfCertification(discoveryRecord, evidence);
              if (!crossCheck.ok) {
                return crossCheck;
              }
            }
          }
        }
      }
      registered.push(record);
      byId.set(record.validationId, record);
      return ok(record);
    },
    records() {
      return deepFreeze([...registered]);
    },
    findByValidationId(validationId) {
      return byId.get(validationId);
    },
    satisfies(claim) {
      for (const record of registered) {
        if (record.outcome !== 'PASS' || record.layer !== claim.layer) {
          continue;
        }
        if (!subjectEquals(record.subject, claim.subject)) {
          continue;
        }
        if (record.contractRef !== claim.contractRef || record.snapshotRef !== claim.snapshotRef) {
          return fail([
            diagnostic(
              'VALIDATION_CLAIM_BINDING_MISMATCH',
              'validationRecord.snapshotRef',
              `validation record is bound to contract '${record.contractRef ?? '-'}'/snapshot '${record.snapshotRef ?? '-'}', not the claimed '${claim.contractRef ?? '-'}'/'${claim.snapshotRef ?? '-'}'; no cross-snapshot promotion`,
              'L2-§6.7',
            ),
          ]);
        }
        if (!baselineEquals(record.baselineRef, claim.baselineRef)) {
          return fail([
            diagnostic(
              'BASELINE_IDENTITY_CHANGED',
              'validationRecord.baselineRef',
              'validation evidence is bound to a different baseline identity; a new independent run is required before projection',
              'C33',
            ),
          ]);
        }
        return ok(record);
      }
      return fail([
        diagnostic(
          'INSUFFICIENT_EVIDENCE',
          'validationRecord',
          `no accepted PASS validation record bound to subject '${claim.subject.ref}' and layer '${claim.layer}'`,
          'PRD-§22',
        ),
      ]);
    },
  });
}

/**
 * Per-member required-validation outcome computed from the registry: a member
 * is VALIDATED only when every required layer has a satisfying PASS record.
 * A named FAIL record is terminal validation failure; anything else is
 * unproven evidence (the summary reports it as INSUFFICIENT_EVIDENCE — C22).
 * This is the exact PRD §19 gate consumed by the ResultProjector.
 */
export type MemberValidationResult = 'VALIDATED' | 'VALIDATION_FAILED' | 'NOT_VALIDATED';

export interface MemberRequiredValidation {
  readonly memberId: MemberId;
  readonly result: MemberValidationResult;
}

export function requiredValidationOutcomes(
  selectedMemberIds: readonly MemberId[],
  registry: ValidationRegistry,
  requiredLayers: readonly ValidationLayer[],
  binding: { readonly contractRef?: string; readonly snapshotRef?: string } = {},
): readonly MemberRequiredValidation[] {
  return selectedMemberIds.map((memberId) => {
    const subject: ClaimSubject = { kind: 'MEMBER', ref: memberId };
    for (const layer of requiredLayers) {
      const satisfied = registry.satisfies({ layer, subject, ...binding });
      if (!satisfied.ok) {
        const failed = registry
          .records()
          .some(
            (record) =>
              record.layer === layer &&
              record.outcome === 'FAIL' &&
              record.subject.kind === 'MEMBER' &&
              record.subject.ref === memberId,
          );
        return {
          memberId,
          result: failed ? ('VALIDATION_FAILED' as const) : ('NOT_VALIDATED' as const),
        };
      }
    }
    return { memberId, result: 'VALIDATED' as const };
  });
}
