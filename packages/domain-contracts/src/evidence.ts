/**
 * T002 typed Evidence / Validation / Confirmation claims.
 *
 * Evidence retains claim type, claim subject, provenance/source identity,
 * scope and independence semantics (frozen L2 invariant 5). Discovery
 * inference cannot self-certify the same semantic claim (invariant 6); user
 * confirmation proves only the shown claim and can never waive Transfer,
 * Format or Media validation (PRD §20–§22).
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { currentSchemaIdentity, decodeSchemaIdentity, type SchemaIdentity } from './version.ts';
import { makeEvidenceId, type EvidenceId } from './ids.ts';
import {
  asRecord,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireArrayOfStrings,
  requireLiteral,
  requireNonEmptyString,
  requireOptionalString,
} from './decode.ts';

export type ClaimType =
  | 'RESOURCE_IDENTITY'
  | 'MEMBERSHIP'
  | 'SELECTION'
  | 'QUALITY'
  | 'AUTHORIZATION'
  | 'TRANSFER'
  | 'FORMAT'
  | 'MEDIA'
  | 'COVERAGE';

export type EvidenceSourceType =
  | 'DISCOVERY_INFERENCE'
  | 'UI_SUGGESTION'
  | 'USER_CONFIRMATION'
  | 'TRANSFER_OBSERVATION'
  | 'INDEPENDENT_VALIDATOR'
  | 'SUPPORTED_TEMPLATE'
  | 'USER_DECLARATION';

/** Discovery-derived facts stay discovery-derived; independence is explicit, never implied. */
export type IndependenceFromDiscovery = 'DISCOVERY_DERIVED' | 'INDEPENDENT';

export type CertaintyClass = 'DECISIVE' | 'PROBATIVE' | 'SUGGESTIVE' | 'INSUFFICIENT_EVIDENCE';

export type ValidationLayer =
  'transfer' | 'format' | 'media' | 'target' | 'membership' | 'coverage';

export type ClaimSubjectKind =
  'LOGICAL_TARGET' | 'MEMBER' | 'EFFECT' | 'COVERAGE_TARGET' | 'RESOURCE';

export interface ClaimSubject {
  readonly kind: ClaimSubjectKind;
  readonly ref: string;
}

export type EvidenceDomain =
  | 'BATCH_DOWNLOAD'
  | 'CONTINUATION_NAVIGATION'
  | 'SINGLE_RESOURCE_TRANSFER'
  | 'MEMBERSHIP'
  | 'COVERAGE'
  | 'AUTHORIZATION';

export interface EvidenceScope {
  readonly domain: EvidenceDomain;
  readonly contractRef?: string;
  readonly snapshotRef?: string;
}

export interface ExecutionContextIdentity {
  readonly toolsUsed?: readonly string[];
  readonly authorizationContextRef?: string;
  readonly budgetRefs?: readonly string[];
}

export interface EvidenceProvenance {
  readonly sourceIdentity: string;
  readonly executionContext?: ExecutionContextIdentity;
}

export interface EvidenceRecord {
  readonly schemaIdentity: SchemaIdentity;
  readonly evidenceId: EvidenceId;
  readonly claimType: ClaimType;
  readonly claimSubject: ClaimSubject;
  readonly sourceType: EvidenceSourceType;
  readonly provenance: EvidenceProvenance;
  readonly independenceFromDiscovery: IndependenceFromDiscovery;
  readonly scope: EvidenceScope;
  readonly certaintyClass: CertaintyClass;
}

export type ConfirmationType =
  | 'CONFIRM_RESOURCE_IDENTITY'
  | 'CONFIRM_MEMBERSHIP'
  | 'CONFIRM_SELECTION'
  | 'CONFIRM_QUALITY_CHOICE'
  | 'ACCEPT_TARGET_CHANGE';

/** What a confirmation run concluded for one shown decision (counterexample C32). */
export type ConfirmationOutcome = 'CONFIRMED' | 'FAILED' | 'ABANDONED' | 'UNKNOWN' | 'OUT_OF_SCOPE';

const EVIDENCE_KEYS: readonly string[] = [
  'schemaIdentity',
  'evidenceId',
  'claimType',
  'claimSubject',
  'sourceType',
  'provenance',
  'independenceFromDiscovery',
  'scope',
  'certaintyClass',
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

const SOURCE_TYPES: readonly EvidenceSourceType[] = [
  'DISCOVERY_INFERENCE',
  'UI_SUGGESTION',
  'USER_CONFIRMATION',
  'TRANSFER_OBSERVATION',
  'INDEPENDENT_VALIDATOR',
  'SUPPORTED_TEMPLATE',
  'USER_DECLARATION',
];

const CERTAINTY_CLASSES: readonly CertaintyClass[] = [
  'DECISIVE',
  'PROBATIVE',
  'SUGGESTIVE',
  'INSUFFICIENT_EVIDENCE',
];

const EVIDENCE_DOMAINS: readonly EvidenceDomain[] = [
  'BATCH_DOWNLOAD',
  'CONTINUATION_NAVIGATION',
  'SINGLE_RESOURCE_TRANSFER',
  'MEMBERSHIP',
  'COVERAGE',
  'AUTHORIZATION',
];

const CLAIM_SUBJECT_KINDS: readonly ClaimSubjectKind[] = [
  'LOGICAL_TARGET',
  'MEMBER',
  'EFFECT',
  'COVERAGE_TARGET',
  'RESOURCE',
];

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

/** Decode one material Evidence record from untrusted input. */
export function decodeEvidenceRecord(value: unknown): DomainValidationResult<EvidenceRecord> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'evidence'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'evidence'), diagnostics);
  pushAll(rejectUnknownFields(record, EVIDENCE_KEYS, 'evidence'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const evidenceIdRaw = unwrap(
    requireNonEmptyString(record, 'evidenceId', 'evidence'),
    diagnostics,
  );
  const evidenceId =
    evidenceIdRaw === undefined ? undefined : unwrap(makeEvidenceId(evidenceIdRaw), diagnostics);
  const claimType = unwrap(
    requireLiteral(record, 'claimType', CLAIM_TYPES, 'evidence'),
    diagnostics,
  );
  const sourceType = unwrap(
    requireLiteral(record, 'sourceType', SOURCE_TYPES, 'evidence'),
    diagnostics,
  );
  const certaintyClass = unwrap(
    requireLiteral(record, 'certaintyClass', CERTAINTY_CLASSES, 'evidence'),
    diagnostics,
  );
  const independence = unwrap(
    requireLiteral(
      record,
      'independenceFromDiscovery',
      ['DISCOVERY_DERIVED', 'INDEPENDENT'] as const,
      'evidence',
    ),
    diagnostics,
  );
  const claimSubject = unwrap(decodeClaimSubject(record['claimSubject']), diagnostics);
  const provenance = unwrap(decodeProvenance(record['provenance']), diagnostics);
  const scope = unwrap(decodeEvidenceScope(record['scope']), diagnostics);
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  // Structural consistency: suggestion/discovery provenance can never declare itself independent
  // truth (counterexample C34).
  if (
    (sourceType === 'UI_SUGGESTION' || sourceType === 'DISCOVERY_INFERENCE') &&
    independence === 'INDEPENDENT'
  ) {
    diagnostics.push(
      diagnostic(
        'SELF_CERTIFICATION',
        'evidence.independenceFromDiscovery',
        `${sourceType} provenance cannot be typed as independent truth for the same claim`,
        'C34',
      ),
    );
    return fail(diagnostics);
  }
  const evidence: EvidenceRecord = {
    schemaIdentity: schemaIdentity!,
    evidenceId: evidenceId!,
    claimType: claimType!,
    claimSubject: claimSubject!,
    sourceType: sourceType!,
    provenance: provenance!,
    independenceFromDiscovery: independence!,
    scope: scope!,
    certaintyClass: certaintyClass!,
  };
  return ok(deepFreeze(evidence));
}

function decodeClaimSubject(value: unknown): DomainValidationResult<ClaimSubject> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'evidence.claimSubject'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, ['kind', 'ref'], 'evidence.claimSubject'), diagnostics);
  const kind = unwrap(
    requireLiteral(record, 'kind', CLAIM_SUBJECT_KINDS, 'evidence.claimSubject'),
    diagnostics,
  );
  const ref = unwrap(requireNonEmptyString(record, 'ref', 'evidence.claimSubject'), diagnostics);
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ kind: kind!, ref: ref! }));
}

function decodeProvenance(value: unknown): DomainValidationResult<EvidenceProvenance> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'evidence.provenance'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, ['sourceIdentity', 'executionContext'], 'evidence.provenance'),
    diagnostics,
  );
  pushAll(rejectRawSecretFields(record, 'evidence.provenance'), diagnostics);
  const sourceIdentity = unwrap(
    requireNonEmptyString(record, 'sourceIdentity', 'evidence.provenance'),
    diagnostics,
  );
  let executionContext: ExecutionContextIdentity | undefined;
  if ('executionContext' in record && record['executionContext'] !== undefined) {
    const contextRecord = unwrap(
      asRecord(record['executionContext'], 'evidence.provenance.executionContext'),
      diagnostics,
    );
    if (contextRecord !== undefined) {
      pushAll(
        rejectUnknownFields(
          contextRecord,
          ['toolsUsed', 'authorizationContextRef', 'budgetRefs'],
          'evidence.provenance.executionContext',
        ),
        diagnostics,
      );
      pushAll(
        rejectRawSecretFields(contextRecord, 'evidence.provenance.executionContext'),
        diagnostics,
      );
      const toolsUsed = unwrap(
        requireArrayOfStrings(contextRecord, 'toolsUsed', 'evidence.provenance.executionContext'),
        diagnostics,
      );
      const authorizationContextRef = unwrap(
        requireOptionalString(
          contextRecord,
          'authorizationContextRef',
          'evidence.provenance.executionContext',
        ),
        diagnostics,
      );
      const budgetRefs = unwrap(
        requireArrayOfStrings(contextRecord, 'budgetRefs', 'evidence.provenance.executionContext'),
        diagnostics,
      );
      if (diagnostics.length > 0) {
        return fail(diagnostics);
      }
      executionContext = deepFreeze({
        toolsUsed,
        authorizationContextRef,
        budgetRefs,
      });
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const provenance: EvidenceProvenance =
    executionContext === undefined
      ? deepFreeze({ sourceIdentity: sourceIdentity! })
      : deepFreeze({ sourceIdentity: sourceIdentity!, executionContext });
  return ok(provenance);
}

function decodeEvidenceScope(value: unknown): DomainValidationResult<EvidenceScope> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'evidence.scope'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, ['domain', 'contractRef', 'snapshotRef'], 'evidence.scope'),
    diagnostics,
  );
  const domain = unwrap(
    requireLiteral(record, 'domain', EVIDENCE_DOMAINS, 'evidence.scope'),
    diagnostics,
  );
  const contractRef = unwrap(
    requireOptionalString(record, 'contractRef', 'evidence.scope'),
    diagnostics,
  );
  const snapshotRef = unwrap(
    requireOptionalString(record, 'snapshotRef', 'evidence.scope'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const scope: EvidenceScope =
    contractRef === undefined && snapshotRef === undefined
      ? deepFreeze({ domain: domain! })
      : deepFreeze({ domain: domain!, contractRef, snapshotRef });
  return ok(scope);
}

export function evidenceRecord(
  fields: Omit<EvidenceRecord, 'schemaIdentity'> & { schemaIdentity?: SchemaIdentity },
): EvidenceRecord {
  const { schemaIdentity, ...rest } = fields;
  return deepFreeze({ schemaIdentity: schemaIdentity ?? currentSchemaIdentity(), ...rest });
}

/**
 * Independent validation oracle rule: decisive/probative evidence that is
 * independent of discovery. Suggestions, discovery inference, suggestive
 * records and insufficient-certainty records can support hypotheses but
 * never serve as the validation oracle for a semantic claim (frozen L2
 * invariant 6).
 */
export function canServeAsIndependentValidationOracle(record: EvidenceRecord): boolean {
  return (
    (record.certaintyClass === 'DECISIVE' || record.certaintyClass === 'PROBATIVE') &&
    record.independenceFromDiscovery === 'INDEPENDENT' &&
    record.sourceType !== 'DISCOVERY_INFERENCE' &&
    record.sourceType !== 'UI_SUGGESTION'
  );
}

const VALIDATION_ORACLE_SOURCES_BY_LAYER: Readonly<
  Record<ValidationLayer, readonly EvidenceSourceType[]>
> = Object.freeze({
  transfer: ['INDEPENDENT_VALIDATOR', 'TRANSFER_OBSERVATION'],
  format: ['INDEPENDENT_VALIDATOR'],
  media: ['INDEPENDENT_VALIDATOR'],
  target: ['INDEPENDENT_VALIDATOR', 'USER_CONFIRMATION', 'SUPPORTED_TEMPLATE'],
  membership: ['INDEPENDENT_VALIDATOR', 'SUPPORTED_TEMPLATE', 'USER_CONFIRMATION'],
  coverage: ['INDEPENDENT_VALIDATOR', 'SUPPORTED_TEMPLATE', 'USER_DECLARATION'],
});

/**
 * Layer validation rule: required validation is satisfied only by sources
 * allowed for that layer with oracle-grade independence. User confirmation
 * can never satisfy Transfer/Format/Media layers — confirmation does not
 * waive validation (PRD §21, counterexamples C26/C27).
 */
export function assertValidatesRequiredLayer(
  record: EvidenceRecord,
  layer: ValidationLayer,
): DomainValidationResult<void> {
  const allowed = VALIDATION_ORACLE_SOURCES_BY_LAYER[layer];
  if (!allowed.includes(record.sourceType)) {
    return fail([
      diagnostic(
        record.sourceType === 'USER_CONFIRMATION'
          ? 'CONFIRMATION_CANNOT_WAIVE_VALIDATION'
          : 'SELF_CERTIFICATION',
        'evidence.sourceType',
        `${record.sourceType} evidence cannot satisfy required '${layer}' validation (allowed: ${allowed.join(', ')})`,
        'PRD-§21',
      ),
    ]);
  }
  if (record.certaintyClass === 'INSUFFICIENT_EVIDENCE') {
    return fail([
      diagnostic(
        'INSUFFICIENT_EVIDENCE',
        'evidence.certaintyClass',
        'evidence lacks the certainty required to validate the claim; no post-hoc conversion to PASS',
        'C22',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Discovery self-certification rule: a validation record whose provenance is
 * the same discovery source that produced the claim cannot validate that
 * claim (frozen L2 invariant 6, counterexample C34).
 */
export function assertNoDiscoverySelfCertification(
  discoveryEvidence: EvidenceRecord,
  validationEvidence: EvidenceRecord,
): DomainValidationResult<void> {
  const validationFromSameDiscovery =
    validationEvidence.sourceType === 'DISCOVERY_INFERENCE' ||
    validationEvidence.provenance.sourceIdentity === discoveryEvidence.provenance.sourceIdentity;
  if (
    discoveryEvidence.independenceFromDiscovery === 'DISCOVERY_DERIVED' &&
    validationFromSameDiscovery
  ) {
    return fail([
      diagnostic(
        'SELF_CERTIFICATION',
        'evidence.provenance.sourceIdentity',
        'discovery inference cannot validate the same semantic claim it produced',
        'L2-inv6',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Evidence-scope promotion rule (counterexample C17): batch evidence and
 * continuation/navigation evidence are distinct claims; a batch result never
 * promotes into continuation/navigation evidence — new independent evidence
 * is required instead.
 */
export function assertEvidenceScopeNotPromoted(
  record: EvidenceRecord,
  targetDomain: EvidenceDomain,
): DomainValidationResult<void> {
  if (record.scope.domain !== targetDomain) {
    return fail([
      diagnostic(
        'EVIDENCE_SCOPE_PROMOTION_FORBIDDEN',
        'evidence.scope.domain',
        `evidence scoped '${record.scope.domain}' cannot be re-labeled as '${targetDomain}'; collect new independent evidence`,
        'C17',
      ),
    ]);
  }
  return ok(undefined);
}

/** What a user confirmation proves: exactly the claim the user was shown (PRD §21, counterexample C26). */
export function whatConfirmationProves(confirmationType: ConfirmationType): {
  readonly proves: ClaimType;
  readonly doesNotProve: readonly ClaimType[];
} {
  switch (confirmationType) {
    case 'CONFIRM_RESOURCE_IDENTITY':
      return { proves: 'RESOURCE_IDENTITY', doesNotProve: ['QUALITY', 'MEDIA', 'FORMAT'] };
    case 'CONFIRM_MEMBERSHIP':
      return { proves: 'MEMBERSHIP', doesNotProve: ['QUALITY', 'TRANSFER'] };
    case 'CONFIRM_SELECTION':
      return { proves: 'SELECTION', doesNotProve: ['QUALITY', 'TRANSFER', 'FORMAT', 'MEDIA'] };
    case 'CONFIRM_QUALITY_CHOICE':
      // The user picked a candidate; the system's original/quality claim remains unverified.
      return { proves: 'SELECTION', doesNotProve: ['QUALITY'] };
    case 'ACCEPT_TARGET_CHANGE':
      return { proves: 'RESOURCE_IDENTITY', doesNotProve: ['QUALITY', 'MEDIA'] };
    default:
      return { proves: 'SELECTION', doesNotProve: ['QUALITY'] };
  }
}

/**
 * Common-denominator aggregation of confirmation outcomes (counterexample
 * C32): failure/abandonment/unknown/out-of-scope keep their distinct
 * non-success classification and never collapse into success.
 */
export function aggregateConfirmationOutcomes(
  outcomes: readonly ConfirmationOutcome[],
): ConfirmationOutcome {
  if (outcomes.length === 0) {
    return 'UNKNOWN';
  }
  if (outcomes.every((outcome) => outcome === 'CONFIRMED')) {
    return 'CONFIRMED';
  }
  if (outcomes.includes('FAILED')) {
    return 'FAILED';
  }
  if (outcomes.includes('ABANDONED')) {
    return 'ABANDONED';
  }
  if (outcomes.includes('OUT_OF_SCOPE')) {
    return 'OUT_OF_SCOPE';
  }
  return 'UNKNOWN';
}

/** Immutable experiment/baseline identity reference (counterexample C33). */
export interface BaselinePlanRef {
  readonly baselineId: string;
  readonly version: number;
}

/**
 * Baseline stability rule (counterexample C33): changing the baseline
 * identity, selection or version invalidates prior confirmation runs — the
 * prior evidence cannot be silently reinterpreted under the new baseline.
 */
export function assertBaselineIdentityUnchanged(
  prior: BaselinePlanRef,
  current: BaselinePlanRef,
): DomainValidationResult<void> {
  if (prior.baselineId !== current.baselineId || prior.version !== current.version) {
    return fail([
      diagnostic(
        'BASELINE_IDENTITY_CHANGED',
        'baselinePlanRef',
        `baseline identity changed ${prior.baselineId}@${String(prior.version)} -> ${current.baselineId}@${String(current.version)}; prior run is invalid and a new independent run is required`,
        'C33',
      ),
    ]);
  }
  return ok(undefined);
}

export type KnowledgeKind = 'TASK_LOCAL_SELECTION' | 'PROMOTED_LOCAL_VERIFIED';

/**
 * Reusable knowledge/recipe reference. Task-local selection is not reusable
 * membership knowledge (PRD §24, counterexample C31); promoted knowledge must
 * still be revalidated against the current contract before it can constrain
 * one (counterexample C20).
 */
export interface KnowledgeRef {
  readonly knowledgeId: string;
  readonly kind: KnowledgeKind;
  readonly applicableScopeKey: string;
  readonly requiresCurrentValidation: true;
}

const KNOWLEDGE_KEYS: readonly string[] = [
  'knowledgeId',
  'kind',
  'applicableScopeKey',
  'requiresCurrentValidation',
];

export function decodeKnowledgeRef(value: unknown): DomainValidationResult<KnowledgeRef> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'knowledgeRef'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'knowledgeRef'), diagnostics);
  pushAll(rejectUnknownFields(record, KNOWLEDGE_KEYS, 'knowledgeRef'), diagnostics);
  const knowledgeId = unwrap(
    requireNonEmptyString(record, 'knowledgeId', 'knowledgeRef'),
    diagnostics,
  );
  const kind = unwrap(
    requireLiteral(
      record,
      'kind',
      ['TASK_LOCAL_SELECTION', 'PROMOTED_LOCAL_VERIFIED'] as const,
      'knowledgeRef',
    ),
    diagnostics,
  );
  const applicableScopeKey = unwrap(
    requireNonEmptyString(record, 'applicableScopeKey', 'knowledgeRef'),
    diagnostics,
  );
  const requiresCurrentValidation = record['requiresCurrentValidation'];
  if (requiresCurrentValidation !== true) {
    diagnostics.push(
      diagnostic(
        'CURRENT_VALIDATION_REQUIRED',
        'knowledgeRef.requiresCurrentValidation',
        'reusable knowledge must declare that current-contract validation is required before replay',
        'C20',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(
    deepFreeze({
      knowledgeId: knowledgeId!,
      kind: kind!,
      applicableScopeKey: applicableScopeKey!,
      requiresCurrentValidation: true,
    }),
  );
}

/**
 * Knowledge application rule: task-local selection can never become reusable
 * membership authority; promoted knowledge constrains a new contract only
 * with current validation evidence binding it to that contract's scope.
 */
export function applyKnowledgeToContract(
  knowledge: KnowledgeRef,
  currentValidationEvidence: EvidenceRecord | undefined,
): DomainValidationResult<void> {
  if (knowledge.kind === 'TASK_LOCAL_SELECTION') {
    return fail([
      diagnostic(
        'KNOWLEDGE_NOT_REUSABLE',
        'knowledgeRef.kind',
        'task-local selection identity cannot become reusable membership authority without cross-task validated promotion',
        'C31',
      ),
    ]);
  }
  if (
    currentValidationEvidence === undefined ||
    !canServeAsIndependentValidationOracle(currentValidationEvidence)
  ) {
    return fail([
      diagnostic(
        'CURRENT_VALIDATION_REQUIRED',
        'knowledgeRef',
        'promoted knowledge requires current validation evidence against the present page/session/layout before replay',
        'C20',
      ),
    ]);
  }
  return ok(undefined);
}
