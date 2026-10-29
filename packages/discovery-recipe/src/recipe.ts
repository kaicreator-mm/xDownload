/**
 * T011 declarative Recipe schema, decode and deterministic interpreter
 * (PRD §23, L2 §6.6, ADR-007).
 *
 * A Recipe is declarative product knowledge: identity/version,
 * applicability scope, matcher, parameter schema, allowed capabilities from
 * the finite vocabulary, evidence rules, validation requirements, failure
 * conditions and a deterministic fallback. The interpreter executes only
 *
 *   matcher → capability plan → policy/scope validation → typed plan,
 *
 * every step deterministic and every planned navigation traceable to the
 * confirmed AcquisitionContract. A Recipe MUST NOT authorize arbitrary shell
 * execution, unrestricted JavaScript, unrestricted filesystem access,
 * unrestricted cookie/token export, arbitrary host scanning or recursive
 * navigation; the decoder fails closed on any such attempt.
 */

import {
  asRecord,
  currentSchemaIdentity,
  deepFreeze,
  decodeSchemaIdentity,
  diagnostic,
  fail,
  makeEvidenceId,
  ok,
  requireArrayOfStrings,
  requireBoolean,
  requireLiteral,
  requireNonEmptyString,
  rejectRawSecretFields,
  rejectUnknownFields,
  type DomainValidationResult,
  type ClaimSubject,
  type EvidenceDomain,
  type EvidenceRecord,
  type SchemaIdentity,
  type ValidationDiagnostic,
  type ValidationLayer,
  type ClaimType,
  type CertaintyClass,
} from '@xdownload/domain-contracts';
import {
  decodeCapabilityList,
  isPassiveCapability,
  type CapabilityKind,
  type PlannedCapability,
} from './capabilities.ts';

const RECIPE_KEYS: readonly string[] = [
  'schemaIdentity',
  'recipeId',
  'applicabilityScope',
  'matcher',
  'parameterSchema',
  'allowedCapabilities',
  'evidenceRules',
  'validationRequirements',
  'failureConditions',
  'deterministicFallback',
];

const APPLICABILITY_KEYS: readonly string[] = ['description', 'scopeKeys'];
const MATCHER_KEYS: readonly string[] = ['allOf'];
const CONDITION_KEYS: readonly string[] = ['field', 'op', 'value'];
const PARAMETER_KEYS: readonly string[] = ['name', 'type', 'required'];
const EVIDENCE_RULES_KEYS: readonly string[] = [
  'emittedClaimTypes',
  'certaintyCeiling',
  'independenceFromDiscovery',
  'evidenceDomain',
];
const FAILURE_CONDITION_KEYS: readonly string[] = ['code', 'description'];
const FALLBACK_KEYS: readonly string[] = ['kind', 'description'];

const MATCH_OPERATORS = ['equals', 'contains', 'exists'] as const;
export type MatchOperator = (typeof MATCH_OPERATORS)[number];

export interface MatchCondition {
  readonly field: string;
  readonly op: MatchOperator;
  readonly value?: string;
}

export interface RecipeMatcher {
  readonly allOf: readonly MatchCondition[];
}

export interface RecipeParameter {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly required: boolean;
}

export interface RecipeEvidenceRules {
  /** Claim types the recipe's extraction rules may emit as discovery evidence. */
  readonly emittedClaimTypes: readonly ClaimType[];
  /** Discovery evidence never rises above PROBATIVE certainty (suggestions are SUGGESTIVE). */
  readonly certaintyCeiling: CertaintyClass;
  /** Fixed to DISCOVERY_DERIVED: discovery evidence is never independent truth. */
  readonly independenceFromDiscovery: 'DISCOVERY_DERIVED';
  readonly evidenceDomain: EvidenceDomain;
}

export interface RecipeFailureCondition {
  readonly code: string;
  readonly description: string;
}

/**
 * Deterministic fallback: only ask-the-user or abort. A fallback never widens
 * scope, invents navigation or executes imperative actions.
 */
export interface RecipeFallback {
  readonly kind: 'ASK_USER' | 'ABORT';
  readonly description: string;
}

export interface RecipeDefinition {
  readonly schemaIdentity: SchemaIdentity;
  readonly recipeId: string;
  readonly applicabilityScope: {
    readonly description: string;
    readonly scopeKeys: readonly string[];
  };
  readonly matcher: RecipeMatcher;
  readonly parameterSchema: readonly RecipeParameter[];
  readonly allowedCapabilities: readonly CapabilityKind[];
  readonly evidenceRules: RecipeEvidenceRules;
  readonly validationRequirements: readonly ValidationLayer[];
  readonly failureConditions: readonly RecipeFailureCondition[];
  readonly deterministicFallback: RecipeFallback;
}

const VALIDATION_LAYERS: readonly ValidationLayer[] = [
  'transfer',
  'format',
  'media',
  'target',
  'membership',
  'coverage',
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

const EVIDENCE_DOMAINS: readonly EvidenceDomain[] = [
  'BATCH_DOWNLOAD',
  'CONTINUATION_NAVIGATION',
  'SINGLE_RESOURCE_TRANSFER',
  'MEMBERSHIP',
  'COVERAGE',
  'AUTHORIZATION',
];

/** Discovery inference is suggestive at best; it can never be oracle-grade truth. */
const ALLOWED_CERTAINTY_CEILINGS: readonly CertaintyClass[] = ['SUGGESTIVE', 'PROBATIVE'];

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

function decodeMatcher(value: unknown): DomainValidationResult<RecipeMatcher> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe.matcher'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, MATCHER_KEYS, 'recipe.matcher'), diagnostics);
  const allOfRaw = record['allOf'];
  if (!Array.isArray(allOfRaw)) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.matcher.allOf',
        'matcher must be declarative data: {"allOf": [conditions]}',
        'ADR-007',
      ),
    );
    return fail(diagnostics);
  }
  const conditions: MatchCondition[] = [];
  for (const raw of allOfRaw) {
    const condition = unwrap(decodeMatchCondition(raw), diagnostics);
    if (condition === undefined) {
      return fail(diagnostics);
    }
    conditions.push(condition);
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ allOf: deepFreeze(conditions) }));
}

function decodeMatchCondition(value: unknown): DomainValidationResult<MatchCondition> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe.matcher.allOf[]'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, CONDITION_KEYS, 'recipe.matcher.allOf[]'), diagnostics);
  const field = unwrap(
    requireNonEmptyString(record, 'field', 'recipe.matcher.allOf[]'),
    diagnostics,
  );
  const op = unwrap(
    requireLiteral(record, 'op', MATCH_OPERATORS, 'recipe.matcher.allOf[]'),
    diagnostics,
  );
  const rawValue = record['value'];
  if (op === 'exists') {
    if (rawValue !== undefined) {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'recipe.matcher.allOf[].value',
          "operator 'exists' takes no value",
        ),
      );
    }
  } else if (typeof rawValue !== 'string' || rawValue.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.matcher.allOf[].value',
        `operator '${String(op)}' requires a non-empty string value`,
      ),
    );
  }
  if (diagnostics.length > 0 || field === undefined || op === undefined) {
    return fail(diagnostics);
  }
  const condition: MatchCondition =
    rawValue === undefined || op === 'exists'
      ? deepFreeze({ field, op })
      : deepFreeze({ field, op, value: rawValue });
  return ok(condition);
}

function decodeParameterSchema(value: unknown): DomainValidationResult<readonly RecipeParameter[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.parameterSchema',
        'parameter schema must be an array of declarative parameter descriptors',
      ),
    );
    return fail(diagnostics);
  }
  const parameters: RecipeParameter[] = [];
  for (const raw of value) {
    const record = unwrap(asRecord(raw, 'recipe.parameterSchema[]'), diagnostics);
    if (record === undefined) {
      return fail(diagnostics);
    }
    pushAll(rejectUnknownFields(record, PARAMETER_KEYS, 'recipe.parameterSchema[]'), diagnostics);
    const name = unwrap(
      requireNonEmptyString(record, 'name', 'recipe.parameterSchema[]'),
      diagnostics,
    );
    const type = unwrap(
      requireLiteral(
        record,
        'type',
        ['string', 'number', 'boolean'] as const,
        'recipe.parameterSchema[]',
      ),
      diagnostics,
    );
    const required = unwrap(
      requireBoolean(record, 'required', 'recipe.parameterSchema[]'),
      diagnostics,
    );
    if (name === undefined || type === undefined || required === undefined) {
      return fail(diagnostics);
    }
    parameters.push(deepFreeze({ name, type, required }));
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(parameters));
}

function decodeEvidenceRules(value: unknown): DomainValidationResult<RecipeEvidenceRules> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe.evidenceRules'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'recipe.evidenceRules'), diagnostics);
  pushAll(rejectUnknownFields(record, EVIDENCE_RULES_KEYS, 'recipe.evidenceRules'), diagnostics);
  const rawClaimTypes = record['emittedClaimTypes'];
  if (!Array.isArray(rawClaimTypes)) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.evidenceRules.emittedClaimTypes',
        'expected an array of claim types',
      ),
    );
    return fail(diagnostics);
  }
  const emittedClaimTypes: ClaimType[] = [];
  for (const raw of rawClaimTypes) {
    const claimType = unwrap(
      requireLiteral({ claimType: raw }, 'claimType', CLAIM_TYPES, 'recipe.evidenceRules'),
      diagnostics,
    );
    if (claimType === undefined) {
      return fail(diagnostics);
    }
    if (!emittedClaimTypes.includes(claimType)) {
      emittedClaimTypes.push(claimType);
    }
  }
  const certaintyCeiling = unwrap(
    requireLiteral(record, 'certaintyCeiling', ALLOWED_CERTAINTY_CEILINGS, 'recipe.evidenceRules'),
    diagnostics,
  );
  const independence = unwrap(
    requireLiteral(
      record,
      'independenceFromDiscovery',
      ['DISCOVERY_DERIVED'] as const,
      'recipe.evidenceRules',
    ),
    diagnostics,
  );
  const evidenceDomain = unwrap(
    requireLiteral(record, 'evidenceDomain', EVIDENCE_DOMAINS, 'recipe.evidenceRules'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  if (emittedClaimTypes.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.evidenceRules.emittedClaimTypes',
        'evidence rules must declare at least one emitted claim type',
      ),
    );
    return fail(diagnostics);
  }
  return ok(
    deepFreeze({
      emittedClaimTypes: deepFreeze(emittedClaimTypes),
      certaintyCeiling: certaintyCeiling!,
      independenceFromDiscovery: independence!,
      evidenceDomain: evidenceDomain!,
    }),
  );
}

function decodeValidationRequirements(
  value: unknown,
): DomainValidationResult<readonly ValidationLayer[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  const raws = unwrap(
    requireArrayOfStrings({ value }, 'value', 'recipe.validationRequirements'),
    diagnostics,
  );
  if (raws === undefined) {
    return fail(diagnostics);
  }
  const layers: ValidationLayer[] = [];
  for (const raw of raws) {
    const layer = unwrap(
      requireLiteral({ layer: raw }, 'layer', VALIDATION_LAYERS, 'recipe.validationRequirements'),
      diagnostics,
    );
    if (layer === undefined) {
      return fail(diagnostics);
    }
    if (!layers.includes(layer)) {
      layers.push(layer);
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(layers));
}

function decodeFailureConditions(
  value: unknown,
): DomainValidationResult<readonly RecipeFailureCondition[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.failureConditions',
        'a recipe must declare its failure conditions declaratively',
      ),
    );
    return fail(diagnostics);
  }
  const conditions: RecipeFailureCondition[] = [];
  for (const raw of value) {
    const record = unwrap(asRecord(raw, 'recipe.failureConditions[]'), diagnostics);
    if (record === undefined) {
      return fail(diagnostics);
    }
    pushAll(
      rejectUnknownFields(record, FAILURE_CONDITION_KEYS, 'recipe.failureConditions[]'),
      diagnostics,
    );
    const code = unwrap(
      requireNonEmptyString(record, 'code', 'recipe.failureConditions[]'),
      diagnostics,
    );
    const description = unwrap(
      requireNonEmptyString(record, 'description', 'recipe.failureConditions[]'),
      diagnostics,
    );
    if (code === undefined || description === undefined) {
      return fail(diagnostics);
    }
    conditions.push(deepFreeze({ code, description }));
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(conditions));
}

function decodeFallback(value: unknown): DomainValidationResult<RecipeFallback> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe.deterministicFallback'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, FALLBACK_KEYS, 'recipe.deterministicFallback'), diagnostics);
  const kind = unwrap(
    requireLiteral(record, 'kind', ['ASK_USER', 'ABORT'] as const, 'recipe.deterministicFallback'),
    diagnostics,
  );
  const description = unwrap(
    requireNonEmptyString(record, 'description', 'recipe.deterministicFallback'),
    diagnostics,
  );
  if (diagnostics.length > 0 || kind === undefined || description === undefined) {
    return fail(diagnostics);
  }
  return ok(deepFreeze({ kind, description }));
}

/**
 * Decode a RecipeDefinition from untrusted input. Anything outside the
 * declarative schema — imperative bodies, script fields, capabilities outside
 * the finite vocabulary, evidence rules claiming independence from discovery,
 * or fallbacks that act instead of asking/aborting — fails closed.
 */
export function decodeRecipeDefinition(value: unknown): DomainValidationResult<RecipeDefinition> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'recipe'), diagnostics);
  pushAll(rejectUnknownFields(record, RECIPE_KEYS, 'recipe'), diagnostics);
  const schemaIdentity = unwrap(decodeSchemaIdentity(record['schemaIdentity']), diagnostics);
  const recipeId = unwrap(requireNonEmptyString(record, 'recipeId', 'recipe'), diagnostics);
  const applicability = unwrap(decodeApplicabilityScope(record['applicabilityScope']), diagnostics);
  const matcher = unwrap(decodeMatcher(record['matcher']), diagnostics);
  const parameterSchema = unwrap(decodeParameterSchema(record['parameterSchema']), diagnostics);
  const allowedCapabilities = unwrap(
    decodeCapabilityList(record['allowedCapabilities'], 'recipe.allowedCapabilities'),
    diagnostics,
  );
  const evidenceRules = unwrap(decodeEvidenceRules(record['evidenceRules']), diagnostics);
  const validationRequirements = unwrap(
    decodeValidationRequirements(record['validationRequirements']),
    diagnostics,
  );
  const failureConditions = unwrap(
    decodeFailureConditions(record['failureConditions']),
    diagnostics,
  );
  const fallback = unwrap(decodeFallback(record['deterministicFallback']), diagnostics);
  if (
    diagnostics.length > 0 ||
    schemaIdentity === undefined ||
    recipeId === undefined ||
    applicability === undefined ||
    matcher === undefined ||
    parameterSchema === undefined ||
    allowedCapabilities === undefined ||
    evidenceRules === undefined ||
    validationRequirements === undefined ||
    failureConditions === undefined ||
    fallback === undefined
  ) {
    return fail(
      diagnostics.length > 0
        ? diagnostics
        : [diagnostic('MALFORMED_REQUIRED_FIELD', 'recipe', 'recipe decode failed')],
    );
  }
  const recipe: RecipeDefinition = {
    schemaIdentity: schemaIdentity,
    recipeId: recipeId,
    applicabilityScope: applicability,
    matcher: matcher,
    parameterSchema: parameterSchema,
    allowedCapabilities: allowedCapabilities,
    evidenceRules: evidenceRules,
    validationRequirements: validationRequirements,
    failureConditions: failureConditions,
    deterministicFallback: fallback,
  };
  return ok(deepFreeze(recipe));
}

function decodeApplicabilityScope(
  value: unknown,
): DomainValidationResult<RecipeDefinition['applicabilityScope']> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'recipe.applicabilityScope'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, APPLICABILITY_KEYS, 'recipe.applicabilityScope'),
    diagnostics,
  );
  const description = unwrap(
    requireNonEmptyString(record, 'description', 'recipe.applicabilityScope'),
    diagnostics,
  );
  const scopeKeys = unwrap(
    requireArrayOfStrings(record, 'scopeKeys', 'recipe.applicabilityScope'),
    diagnostics,
  );
  if (description === undefined || scopeKeys === undefined) {
    return fail(diagnostics);
  }
  if (scopeKeys.length === 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'recipe.applicabilityScope.scopeKeys',
        'applicability scope must declare at least one scope key',
      ),
    );
    return fail(diagnostics);
  }
  return ok(deepFreeze({ description, scopeKeys: deepFreeze([...scopeKeys].sort()) }));
}

/** Deterministic matcher evaluation over plain observation facts. */
export function matchRecipe(
  recipe: RecipeDefinition,
  observations: Readonly<Record<string, string>>,
): { readonly matched: boolean; readonly failedCondition?: MatchCondition } {
  for (const condition of recipe.matcher.allOf) {
    const observed = observations[condition.field];
    if (condition.op === 'exists') {
      if (observed === undefined) {
        return deepFreeze({ matched: false, failedCondition: condition });
      }
      continue;
    }
    if (condition.op === 'equals' && observed !== condition.value) {
      return deepFreeze({ matched: false, failedCondition: condition });
    }
    if (
      condition.op === 'contains' &&
      (observed === undefined || !observed.includes(condition.value ?? ''))
    ) {
      return deepFreeze({ matched: false, failedCondition: condition });
    }
  }
  return deepFreeze({ matched: true });
}

/**
 * Authorize a recipe capability against the confirmed contract (policy/scope
 * validation, PRD §14):
 *
 * - passive observation is authorized for any confirmed contract (traceable
 *   to it, never navigates);
 * - `scroll_current_page` is authorized only when the confirmed contract
 *   carries an explicit declared continuation scope — with
 *   `continuation_scope = NONE` scrolling cannot add in-scope members, so it
 *   is not planned (it is never implicit scope authority);
 * - `open_confirmed_member_detail` is authorized per frozen member only;
 * - `follow_declared_collection_continuation` is authorized only with an
 *   explicit declared continuation scope AND the matching
 *   `DECLARED_CONTINUATION_EDGES` exploration permission.
 */
export function authorizeCapability(
  capability: CapabilityKind,
  contract: {
    readonly status: string;
    readonly continuationScope: { readonly kind: string };
    readonly explorationPermission: string;
  },
): boolean {
  if (contract.status !== 'CONFIRMED') {
    return false;
  }
  if (isPassiveCapability(capability)) {
    return true;
  }
  const explicitContinuation =
    contract.continuationScope.kind === 'DECLARED_BATCH_COUNT' ||
    contract.continuationScope.kind === 'DECLARED_NATURAL_END';
  if (
    capability === 'scroll_current_page' ||
    capability === 'follow_declared_collection_continuation'
  ) {
    return explicitContinuation && contract.explorationPermission === 'DECLARED_CONTINUATION_EDGES';
  }
  // open_confirmed_member_detail is authorized per member via the frozen
  // membership; the plan step checks the member identity against the frozen
  // set, so at capability level a confirmed contract suffices.
  return true;
}

/** Contract trace carried by every planned capability (PRD §14). */
export interface RecipeContractTrace {
  readonly contractId: string;
  readonly scopeIdentityKey: string;
  readonly continuationScopeKind: string;
}

export type RecipePlanStep =
  | { readonly kind: 'CAPABILITY'; readonly capability: PlannedCapability }
  | {
      readonly kind: 'POLICY_VALIDATION_REQUIRED';
      readonly layers: readonly ValidationLayer[];
    };

export interface RecipeExecutionPlan {
  readonly recipeId: string;
  readonly matched: boolean;
  readonly trace: RecipeContractTrace;
  readonly steps: readonly RecipePlanStep[];
  readonly excluded: readonly {
    readonly capability: CapabilityKind;
    readonly reason: 'NOT_CONFIRMED' | 'CONTINUATION_SCOPE_NONE' | 'MISSING_EXPLORATION_PERMISSION';
  }[];
  readonly fallback?: RecipeFallback;
  readonly failedCondition?: MatchCondition;
}

/**
 * The deterministic interpreter pipeline: matcher → capability plan →
 * policy/scope validation → bounded plan. No execution of any navigation
 * happens here; the plan is the only output and every navigation step is
 * traceable to the confirmed contract through `trace`.
 */
export function planRecipeExecution(
  recipe: RecipeDefinition,
  contract: {
    readonly contractId: string;
    readonly status: string;
    readonly requestedScope: { readonly kind: string };
    readonly continuationScope: { readonly kind: string };
    readonly explorationPermission: string;
    readonly validationPolicy: { readonly requiredLayers: readonly ValidationLayer[] };
  },
  observations: Readonly<Record<string, string>>,
  options: { readonly scopeIdentityKey: string; readonly frozenMemberIds: readonly string[] },
): RecipeExecutionPlan {
  const trace: RecipeContractTrace = deepFreeze({
    contractId: contract.contractId,
    scopeIdentityKey: options.scopeIdentityKey,
    continuationScopeKind: contract.continuationScope.kind,
  });
  const match = matchRecipe(recipe, observations);
  if (!match.matched) {
    return deepFreeze({
      recipeId: recipe.recipeId,
      matched: false,
      trace: trace,
      steps: deepFreeze([]),
      excluded: deepFreeze([]),
      fallback: recipe.deterministicFallback,
      failedCondition: match.failedCondition,
    });
  }
  const steps: RecipePlanStep[] = [];
  const excluded: {
    capability: CapabilityKind;
    reason: 'NOT_CONFIRMED' | 'CONTINUATION_SCOPE_NONE' | 'MISSING_EXPLORATION_PERMISSION';
  }[] = [];
  for (const capability of recipe.allowedCapabilities) {
    if (!authorizeCapability(capability, contract)) {
      if (contract.status !== 'CONFIRMED') {
        excluded.push({
          capability: capability,
          reason: 'NOT_CONFIRMED',
        });
      } else if (
        (capability === 'scroll_current_page' ||
          capability === 'follow_declared_collection_continuation') &&
        contract.continuationScope.kind === 'NONE'
      ) {
        excluded.push({
          capability: capability,
          reason: 'CONTINUATION_SCOPE_NONE',
        });
      } else {
        excluded.push({
          capability: capability,
          reason: 'MISSING_EXPLORATION_PERMISSION',
        });
      }
      continue;
    }
    const planned = planCapability(capability, contract);
    if (planned === undefined) {
      excluded.push({
        capability: capability,
        reason: 'CONTINUATION_SCOPE_NONE',
      });
      continue;
    }
    steps.push({ kind: 'CAPABILITY', capability: planned });
  }
  steps.push({
    kind: 'POLICY_VALIDATION_REQUIRED',
    layers: recipe.validationRequirements,
  });
  return deepFreeze({
    recipeId: recipe.recipeId,
    matched: true,
    trace: trace,
    steps: deepFreeze(steps),
    excluded: deepFreeze(excluded),
  });
}

function planCapability(
  capability: CapabilityKind,
  contract: {
    readonly continuationScope: { readonly kind: string };
    readonly explorationPermission: string;
  },
): PlannedCapability | undefined {
  switch (capability) {
    case 'observe_current_page':
    case 'observe_network':
    case 'observe_player':
    case 'observe_frames':
    case 'collect_candidates':
      return deepFreeze({ kind: capability });
    case 'scroll_current_page':
    case 'follow_declared_collection_continuation': {
      const kind = contract.continuationScope.kind;
      if (kind !== 'DECLARED_BATCH_COUNT' && kind !== 'DECLARED_NATURAL_END') {
        return undefined;
      }
      const planned: PlannedCapability =
        capability === 'scroll_current_page'
          ? { kind: 'scroll_current_page', continuationScopeKind: kind }
          : { kind: 'follow_declared_collection_continuation', continuationScopeKind: kind };
      return deepFreeze(planned);
    }
    case 'open_confirmed_member_detail':
      // Plan level carries no member: the caller issues per-member detail
      // steps against the frozen membership via discovery session outputs.
      return undefined;
    default:
      return undefined;
  }
}

/** Build a discovery-derived evidence record from a recipe's evidence rules. */
export function recipeEvidenceRecord(input: {
  readonly recipe: RecipeDefinition;
  readonly contractRef: string;
  readonly claimType: ClaimType;
  readonly claimSubject: ClaimSubject;
  readonly evidenceId: string;
  readonly sourceIdentity: string;
  readonly suggestion?: boolean;
}): DomainValidationResult<EvidenceRecord> {
  const { recipe } = input;
  if (!recipe.evidenceRules.emittedClaimTypes.includes(input.claimType)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'evidence.claimType',
        `recipe '${recipe.recipeId}' does not declare evidence rules for claim type '${input.claimType}'`,
      ),
    ]);
  }
  const certainty: CertaintyClass =
    input.suggestion === true ? 'SUGGESTIVE' : recipe.evidenceRules.certaintyCeiling;
  const evidenceId = makeEvidenceId(input.evidenceId);
  if (!evidenceId.ok) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'evidence.evidenceId',
        'evidence id must be a valid evidence identity',
      ),
    ]);
  }
  const record: EvidenceRecord = {
    schemaIdentity: currentSchemaIdentity(),
    evidenceId: evidenceId.value,
    claimType: input.claimType,
    claimSubject: deepFreeze(input.claimSubject),
    sourceType: input.suggestion === true ? 'UI_SUGGESTION' : 'DISCOVERY_INFERENCE',
    provenance: {
      sourceIdentity: input.sourceIdentity,
      executionContext: { toolsUsed: [`recipe:${recipe.recipeId}`] },
    },
    independenceFromDiscovery: 'DISCOVERY_DERIVED',
    scope: { domain: recipe.evidenceRules.evidenceDomain, contractRef: input.contractRef },
    certaintyClass: certainty,
  };
  return ok(deepFreeze(record));
}
