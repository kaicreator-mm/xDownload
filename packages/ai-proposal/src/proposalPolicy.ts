/**
 * T012 deterministic proposal validation/rejection policy (frozen L2
 * ADR-008: AI is proposal-only and cannot grant authority).
 *
 * The policy is pure and deterministic: the same proposal bytes plus the
 * same gap/contract context always yield the same accept/reject decision,
 * with or without a live model (C19). It composes the unmodified
 * `decodeRecipeDefinition` of `@xdownload/discovery-recipe` — the proposal
 * target schema — with proposal-only authority rules:
 *
 * - provenance binding: the envelope must name exactly the gap, contract
 *   context and provider it was issued for;
 * - suggestion ceiling: model-sourced recipes carry `SUGGESTIVE` evidence
 *   ceilings only; they can never self-certify validation/coverage or claim
 *   independence from discovery (C34, C22);
 * - capability admission: every requested capability must already be
 *   authorized by the confirmed contract through the same Core rule
 *   (`authorizeCapability`) used for human-suggested recipes — a proposal
 *   can never widen navigation, auth, scope or execution authority (C06,
 *   PRD §14, ADR-007);
 * - durable-credential containment: recipes must not embed signed URLs,
 *   credentials or identity secrets as durable reusable rules (PRD §29).
 *
 * Acceptance produces data with suggestion provenance — never authority.
 * Anything actionable in an accepted proposal still flows through the
 * ordinary deterministic paths (Recipe decode, capability authorization,
 * contract/snapshot scope validation, user confirmation, typed evidence),
 * exactly as if a human had suggested the same Recipe.
 */

import {
  currentSchemaIdentity,
  deepFreeze,
  makeEvidenceId,
  type ClaimSubject,
  type ClaimType,
  type EvidenceDomain,
  type EvidenceRecord,
} from '@xdownload/domain-contracts';
import {
  authorizeCapability,
  decodeRecipeDefinition,
  type RecipeDefinition,
} from '@xdownload/discovery-recipe';
import type { ProviderIdentity } from './providerPort.ts';
import {
  decodeProposalEnvelope,
  type DecodedProposalEnvelope,
  type ProposalProvenance,
} from './proposalEnvelope.ts';
import {
  domainDiagnosticsToProposal,
  proposalDiagnostic,
  proposalFail,
  proposalOk,
  type ProposalDiagnostic,
  type ProposalValidationResult,
} from './diagnostics.ts';

/** The exact gap/contract/provider context a proposal must be bound to. */
export interface ProposalEvaluationContext {
  readonly expectedGapRef: string;
  readonly expectedContractRef: string;
  readonly expectedProvider: ProviderIdentity;
}

/**
 * The confirmed-contract authority facts the policy evaluates capability
 * admission against. Structural subset of the canonical AcquisitionContract,
 * matching `authorizeCapability` (the same rule the deterministic engine
 * applies to any recipe, human-suggested or not).
 */
export interface ContractAuthorityFacts {
  readonly status: string;
  readonly continuationScope: { readonly kind: string };
  readonly explorationPermission: string;
}

/** An accepted proposal: data with suggestion provenance, never authority. */
export interface AcceptedProposal {
  readonly proposalId: string;
  readonly schemaIdentity: DecodedProposalEnvelope['schemaIdentity'];
  readonly provider: ProviderIdentity;
  readonly provenance: ProposalProvenance;
  readonly recipe: RecipeDefinition;
  /**
   * Model-sourced suggestions are SUGGESTIVE at best; this field is a typed
   * statement of the ceiling so downstream consumers cannot misread a
   * proposal as validation truth (C34).
   */
  readonly certaintyCeiling: 'SUGGESTIVE';
}

/**
 * Signed-URL / durable-credential containment: recipe strings must not
 * embed credentialed URLs as durable reusable rules (PRD §29 "Recipe/
 * Knowledge must not embed credentials, signed URLs as durable reusable
 * rules"). Conservative, explicit parameter allowlist scan over string
 * values; deterministic and pattern-pure.
 */
const CREDENTIALED_URL_PARAM_PATTERN =
  /[?&](?:x-goog-signature|x-amz-signature|x-amz-credential|x-amz-security-token|x-amz-expires|sig|signature|token|apikey|api_key|access_key|password|authorization|credential)=/i;

function findCredentialedUrlViolation(
  value: unknown,
  path: string,
): ProposalDiagnostic | undefined {
  if (typeof value === 'string') {
    if (CREDENTIALED_URL_PARAM_PATTERN.test(value)) {
      return proposalDiagnostic(
        'RAW_SECRET_FIELD',
        path,
        'recipe strings must not embed credentialed/signed URLs as durable reusable rules (PRD-§29)',
        'PRD-§29',
      );
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCredentialedUrlViolation(value[index], `${path}[${String(index)}]`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const found = findCredentialedUrlViolation(child, `${path}.${key}`);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function assertSuggestionCeiling(recipe: RecipeDefinition): ProposalValidationResult<void> {
  // Model-sourced proposals are at best suggestive: the decoder admits
  // PROBATIVE ceilings for ordinary discovery recipes, but a proposal can
  // never carry one (C34: a suggestion cannot type itself as stronger truth).
  if (recipe.evidenceRules.certaintyCeiling !== 'SUGGESTIVE') {
    return proposalFail([
      proposalDiagnostic(
        'SELF_CERTIFICATION',
        'proposal.payload.recipe.evidenceRules.certaintyCeiling',
        `model-sourced proposals are suggestions at best; certainty ceiling '${recipe.evidenceRules.certaintyCeiling}' self-certifies evidence beyond the SUGGESTIVE suggestion ceiling`,
        'C34',
      ),
    ]);
  }
  if (recipe.evidenceRules.independenceFromDiscovery !== 'DISCOVERY_DERIVED') {
    return proposalFail([
      proposalDiagnostic(
        'SELF_CERTIFICATION',
        'proposal.payload.recipe.evidenceRules.independenceFromDiscovery',
        'proposal-sourced evidence can never claim independence from discovery',
        'C34',
      ),
    ]);
  }
  if (
    recipe.deterministicFallback.kind !== 'ASK_USER' &&
    recipe.deterministicFallback.kind !== 'ABORT'
  ) {
    return proposalFail([
      proposalDiagnostic(
        'UNKNOWN_ENUM_VALUE',
        'proposal.payload.recipe.deterministicFallback.kind',
        'proposal fallbacks are limited to ASK_USER or ABORT; imperative fallbacks fail closed',
        'ADR-007',
      ),
    ]);
  }
  return proposalOk(undefined);
}

function assertCapabilitiesAuthorized(
  recipe: RecipeDefinition,
  contract: ContractAuthorityFacts,
): ProposalValidationResult<void> {
  for (const capability of recipe.allowedCapabilities) {
    if (!authorizeCapability(capability, contract)) {
      return proposalFail([
        proposalDiagnostic(
          'CAPABILITY_NOT_AUTHORIZED',
          'proposal.payload.recipe.allowedCapabilities',
          `capability '${capability}' is not authorized by the confirmed contract (status '${contract.status}', continuation '${contract.continuationScope.kind}', exploration '${contract.explorationPermission}'); proposals cannot request authority the contract does not already grant`,
          'ADR-008',
        ),
      ]);
    }
  }
  return proposalOk(undefined);
}

/**
 * Deterministic proposal evaluation. Pure: no clocks, no randomness, no
 * model, no I/O — the identical function runs with the model present or
 * absent (C19 parity), and identical inputs always produce the identical
 * decision.
 */
export function evaluateProposal(
  value: unknown,
  context: ProposalEvaluationContext,
  contract: ContractAuthorityFacts,
): ProposalValidationResult<AcceptedProposal> {
  const envelope = decodeProposalEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }
  const binding = assertProvenanceBinding(envelope.value, context);
  if (!binding.ok) {
    return binding;
  }
  // The proposal target schema: the unmodified Recipe decoder, from unknown input.
  const recipe = decodeRecipeDefinition(envelope.value.payload);
  if (!recipe.ok) {
    return proposalFail(
      domainDiagnosticsToProposal(recipe.diagnostics).map((d) => ({
        ...d,
        path: `proposal.payload.${d.path}`,
      })),
    );
  }
  const ceiling = assertSuggestionCeiling(recipe.value);
  if (!ceiling.ok) {
    return ceiling;
  }
  const credentialed = findCredentialedUrlViolation(recipe.value, 'proposal.payload.recipe');
  if (credentialed !== undefined) {
    return proposalFail([credentialed]);
  }
  const capabilities = assertCapabilitiesAuthorized(recipe.value, contract);
  if (!capabilities.ok) {
    return capabilities;
  }
  return proposalOk(
    deepFreeze({
      proposalId: envelope.value.proposalId,
      schemaIdentity: envelope.value.schemaIdentity,
      provider: envelope.value.provider,
      provenance: envelope.value.provenance,
      recipe: recipe.value,
      certaintyCeiling: 'SUGGESTIVE' as const,
    }),
  );
}

function assertProvenanceBinding(
  envelope: DecodedProposalEnvelope,
  context: ProposalEvaluationContext,
): ProposalValidationResult<void> {
  const diagnostics: ProposalDiagnostic[] = [];
  if (
    envelope.provider.providerId !== context.expectedProvider.providerId ||
    envelope.provider.modelId !== context.expectedProvider.modelId
  ) {
    diagnostics.push(
      proposalDiagnostic(
        'PROVENANCE_BINDING_REJECTED',
        'proposal.provider',
        `proposal names provider '${envelope.provider.providerId}/${envelope.provider.modelId}' but was issued for '${context.expectedProvider.providerId}/${context.expectedProvider.modelId}'`,
        'T012-provenance-binding',
      ),
    );
  }
  if (envelope.provenance.gapRef !== context.expectedGapRef) {
    diagnostics.push(
      proposalDiagnostic(
        'PROVENANCE_BINDING_REJECTED',
        'proposal.provenance.gapRef',
        `proposal answers gap '${envelope.provenance.gapRef}' but was issued for gap '${context.expectedGapRef}'`,
        'T012-provenance-binding',
      ),
    );
  }
  if (envelope.provenance.contractRef !== context.expectedContractRef) {
    diagnostics.push(
      proposalDiagnostic(
        'PROVENANCE_BINDING_REJECTED',
        'proposal.provenance.contractRef',
        `proposal targets contract '${envelope.provenance.contractRef}' but was issued for contract '${context.expectedContractRef}'`,
        'T012-provenance-binding',
      ),
    );
  }
  return diagnostics.length === 0 ? proposalOk(undefined) : proposalFail(diagnostics);
}

/**
 * Typed suggestion evidence for an accepted proposal, built from the
 * existing canonical evidence vocabulary: source type `UI_SUGGESTION` (the
 * suggestion class), certainty `SUGGESTIVE`, independence
 * `DISCOVERY_DERIVED`. The record can never serve as an independent
 * validation oracle for the same claim (C34) — see
 * `assertProposalNeverIndependentTruth`.
 */
export function proposalSuggestionEvidence(input: {
  readonly proposal: AcceptedProposal;
  readonly claimType: ClaimType;
  readonly claimSubject: ClaimSubject;
  readonly evidenceId: string;
}): ProposalValidationResult<EvidenceRecord> {
  const { proposal } = input;
  const evidenceId = makeEvidenceId(input.evidenceId);
  if (!evidenceId.ok) {
    return proposalFail([
      proposalDiagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'evidence.evidenceId',
        'evidence id must be a valid evidence identity',
      ),
    ]);
  }
  const domain: EvidenceDomain = proposal.recipe.evidenceRules.evidenceDomain;
  const record: EvidenceRecord = deepFreeze({
    schemaIdentity: currentSchemaIdentity(),
    evidenceId: evidenceId.value,
    claimType: input.claimType,
    claimSubject: deepFreeze(input.claimSubject),
    sourceType: 'UI_SUGGESTION',
    provenance: {
      sourceIdentity: `ai-proposal:${proposal.provider.providerId}/${proposal.provider.modelId}#${proposal.proposalId}`,
    },
    independenceFromDiscovery: 'DISCOVERY_DERIVED',
    scope: { domain: domain, contractRef: proposal.provenance.contractRef },
    certaintyClass: 'SUGGESTIVE',
  });
  return proposalOk(record);
}

/**
 * Oracle rule for proposal-sourced evidence: a suggestion record can never
 * serve as the independent validation oracle for a semantic claim, no
 * matter how it is later relabeled (C34; frozen L2 invariant 6).
 */
export function assertProposalNeverIndependentTruth(
  record: EvidenceRecord,
): ProposalValidationResult<void> {
  if (
    record.independenceFromDiscovery === 'INDEPENDENT' ||
    record.certaintyClass === 'DECISIVE' ||
    record.certaintyClass === 'PROBATIVE'
  ) {
    return proposalFail([
      proposalDiagnostic(
        'SELF_CERTIFICATION',
        'evidence.independenceFromDiscovery',
        'proposal-sourced suggestions can never be typed as independent or oracle-grade truth for the same claim; ordinary deterministic validation evidence is required',
        'C34',
      ),
    ]);
  }
  return proposalOk(undefined);
}
