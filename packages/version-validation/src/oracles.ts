/**
 * T003 C01–C34 counterexample oracle corpus (frozen PRD §35).
 *
 * One pre-registered oracle record per counterexample: scenario identity,
 * PRD reference, required product behavior (frozen text), pre-registered
 * target/scope/truth-source metadata, expected terminal status tuples and/or
 * rule assertions whose status literals bind to the canonical result
 * vocabulary of `@xdownload/domain-contracts`, and the gates whose
 * instrumentation the oracle feeds.
 *
 * Loading proves each record parses, carries a known C-identity and binds
 * canonical statuses; execution against a product candidate is NOT part of
 * T003 and remains NOT_RUN (Task Pack Acceptance).
 */

import {
  andThen,
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  rejectUnknownFields,
  requireArrayOfStrings,
  requireLiteral,
  requireNonEmptyString,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import {
  decodeExpectedTuple,
  assertCanonicalStatusRuleValue,
  type ExpectedTerminalStatusTuple,
} from './canonical-probe.ts';
import type { CorpusRegistry } from './corpora.ts';
import {
  CANONICAL_ORACLE_IDS,
  isCanonicalGateId,
  isCanonicalOracleId,
  makeOracleCaseId,
  type GateId,
  type OracleCaseId,
} from './identity.ts';
import { decodeTruthSource, type TruthSource } from './truth-source.ts';

export type StatusRuleField =
  | 'requestFulfillment'
  | 'targetResolution'
  | 'selectionAcquisition'
  | 'coverage'
  | 'stopReason'
  | 'validationSummary.status';

export type RulePolarity = 'MUST' | 'MAY' | 'MUST_NOT';

/**
 * One pre-registered status rule: for a conforming product run of the
 * counterexample, `field` MUST / MAY / MUST_NOT take the canonical `value`.
 * `value` is validated against the canonical enum for its field at load.
 */
export interface StatusRuleAssertion {
  readonly field: StatusRuleField;
  readonly value: string;
  readonly polarity: RulePolarity;
  /** Exact frozen authority reference for the rule. */
  readonly prdRef: string;
  /** Executable canonical rule binding (module/rule identity), when applicable. */
  readonly canonicalRuleRef?: string;
}

export interface CounterexampleOracle {
  readonly oracleId: OracleCaseId;
  /** Scenario slug from the frozen TEST_MATRIX/PRD §35 row. */
  readonly scenario: string;
  readonly prdRef: string;
  /** Verbatim frozen PRD §35 "Required product behavior" text. */
  readonly requiredBehavior: string;
  /** Pre-registered target of the counterexample run. */
  readonly target: string;
  /** Corpus linkage: the deterministic task case the oracle binds to. */
  readonly scopeRef: { readonly corpusId: string; readonly taskCaseId: string };
  readonly truthSource: TruthSource;
  /** Exact expected terminal status tuples (canonical-bound); may be empty. */
  readonly expectedTuples: readonly ExpectedTerminalStatusTuple[];
  /** Pre-registered status rules (canonical-bound); may be empty. */
  readonly ruleAssertions: readonly StatusRuleAssertion[];
  /** Gates whose instrumentation this oracle feeds; empty when none. */
  readonly gateRefs: readonly GateId[];
  /** Required when G0 is involved (frozen PRD §35 preamble). */
  readonly g0PlanRef?: string;
}

export interface OracleCorpus {
  readonly oracles: readonly CounterexampleOracle[];
  byId(oracleId: string): CounterexampleOracle | undefined;
  /**
   * Execution status against a product candidate. T003 builds the registry
   * only — every oracle is NOT_RUN here; execution belongs to later
   * version-level Validation (T019 candidate / T020–T023).
   */
  readonly executionStatus: 'NOT_RUN';
}

const ORACLE_KEYS: readonly string[] = [
  'oracleId',
  'scenario',
  'prdRef',
  'requiredBehavior',
  'target',
  'scopeRef',
  'truthSource',
  'expectedTuples',
  'ruleAssertions',
  'gateRefs',
  'g0PlanRef',
];

/**
 * Pre-registered status rule fields. Rule VALUES are never redeclared here:
 * each value is validated against the canonical result vocabulary of
 * `@xdownload/domain-contracts` through `assertCanonicalStatusRuleValue`
 * (the canonical structural decoder probe), so local drift from the canonical
 * enums is unrepresentable.
 */
const STATUS_RULE_FIELDS: readonly StatusRuleField[] = [
  'requestFulfillment',
  'targetResolution',
  'selectionAcquisition',
  'coverage',
  'stopReason',
  'validationSummary.status',
];

const SCOPE_REF_KEYS: readonly string[] = ['corpusId', 'taskCaseId'];
const RULE_KEYS: readonly string[] = ['field', 'value', 'polarity', 'prdRef', 'canonicalRuleRef'];

function decodeScopeRef(
  value: unknown,
  path: string,
  registry: CorpusRegistry,
): DomainValidationResult<{ readonly corpusId: string; readonly taskCaseId: string }> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, SCOPE_REF_KEYS, path), () => {
      const corpusId = requireNonEmptyString(record, 'corpusId', path);
      const taskCaseId = requireNonEmptyString(record, 'taskCaseId', path);
      if (!corpusId.ok || !taskCaseId.ok) {
        return fail([
          ...(corpusId.ok ? [] : corpusId.diagnostics),
          ...(taskCaseId.ok ? [] : taskCaseId.diagnostics),
        ]);
      }
      const caseRecord = registry.taskCase(taskCaseId.value);
      if (caseRecord === undefined || caseRecord.corpusId !== corpusId.value) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            `${path}.taskCaseId`,
            `oracle scope ref ('${corpusId.value}', '${taskCaseId.value}') does not resolve to a registered corpus task case`,
            'PRD-§35',
          ),
        ]);
      }
      return ok(deepFreeze({ corpusId: corpusId.value, taskCaseId: taskCaseId.value }));
    }),
  );
}

function decodeRuleAssertion(
  value: unknown,
  path: string,
): DomainValidationResult<StatusRuleAssertion> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, RULE_KEYS, path), () => {
      const field = requireLiteral(record, 'field', STATUS_RULE_FIELDS, path);
      if (!field.ok) {
        return field;
      }
      const polarity = requireLiteral(record, 'polarity', ['MUST', 'MAY', 'MUST_NOT'], path);
      if (!polarity.ok) {
        return polarity;
      }
      const prdRef = requireNonEmptyString(record, 'prdRef', path);
      if (!prdRef.ok) {
        return prdRef;
      }
      const valueRaw = requireNonEmptyString(record, 'value', path);
      if (!valueRaw.ok) {
        return valueRaw;
      }
      const canonicalRuleRef = requireNonEmptyString(record, 'canonicalRuleRef', path);
      // Bind the rule value to the canonical result vocabulary through the
      // structural decoder probe — never against a local redeclaration.
      const canonical = assertCanonicalStatusRuleValue(
        field.value as StatusRuleField,
        valueRaw.value,
        `${path}.value`,
      );
      if (!canonical.ok) {
        return fail(
          canonical.diagnostics.map((d) => ({
            ...d,
            message: `rule value '${valueRaw.value}' is not a canonical '${field.value}' status; oracle rules must bind the canonical result vocabulary`,
          })),
        );
      }
      return ok(
        deepFreeze({
          field: field.value as StatusRuleField,
          value: valueRaw.value,
          polarity: polarity.value,
          prdRef: prdRef.value,
          canonicalRuleRef:
            canonicalRuleRef.ok && canonicalRuleRef.value !== ''
              ? canonicalRuleRef.value
              : undefined,
        }),
      );
    }),
  );
}

function decodeOracle(
  value: unknown,
  path: string,
  registry: CorpusRegistry,
  knownG0PlanIds: readonly string[] | undefined,
): DomainValidationResult<CounterexampleOracle> {
  return andThen(asRecord(value, path), (record) =>
    andThen(rejectUnknownFields(record, ORACLE_KEYS, path), () => {
      const oracleIdRaw = requireNonEmptyString(record, 'oracleId', path);
      if (!oracleIdRaw.ok) {
        return oracleIdRaw;
      }
      const scenario = requireNonEmptyString(record, 'scenario', path);
      if (!scenario.ok) {
        return scenario;
      }
      const prdRef = requireNonEmptyString(record, 'prdRef', path);
      if (!prdRef.ok) {
        return prdRef;
      }
      const requiredBehavior = requireNonEmptyString(record, 'requiredBehavior', path);
      if (!requiredBehavior.ok) {
        return requiredBehavior;
      }
      const target = requireNonEmptyString(record, 'target', path);
      if (!target.ok) {
        return target;
      }
      const gateRefs = requireArrayOfStrings(record, 'gateRefs', path);
      if (!gateRefs.ok) {
        return gateRefs;
      }
      const oracleId = makeOracleCaseId(oracleIdRaw.value);
      if (!oracleId.ok) {
        return oracleId;
      }
      if (!isCanonicalOracleId(oracleId.value)) {
        return fail([
          diagnostic(
            'UNKNOWN_ENUM_VALUE',
            `${path}.oracleId`,
            `unknown counterexample identity '${oracleId.value}'; the frozen corpus is exactly C01–C34`,
            'PRD-§35',
          ),
        ]);
      }
      if (!prdRef.value.startsWith('PRD-§35')) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            `${path}.prdRef`,
            `oracle '${oracleId.value}' must reference its frozen PRD §35 row`,
            'PRD-§35',
          ),
        ]);
      }
      const scopeRef = decodeScopeRef(record['scopeRef'], `${path}.scopeRef`, registry);
      if (!scopeRef.ok) {
        return scopeRef;
      }
      const truthSource = decodeTruthSource(record['truthSource'], `${path}.truthSource`);
      if (!truthSource.ok) {
        return truthSource;
      }
      const rawTuples = record['expectedTuples'];
      const rawRules = record['ruleAssertions'];
      if (!Array.isArray(rawTuples) || !Array.isArray(rawRules)) {
        return fail([
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            `${path}.expectedTuples`,
            'expectedTuples and ruleAssertions must be arrays (possibly empty)',
          ),
        ]);
      }
      const tuples: ExpectedTerminalStatusTuple[] = [];
      const tupleSeen = new Set<string>();
      for (const [index, rawTuple] of rawTuples.entries()) {
        const tuple = decodeExpectedTuple(rawTuple, `${path}.expectedTuples[${index}]`);
        if (!tuple.ok) {
          return tuple;
        }
        const key = JSON.stringify(
          Array.isArray(rawTuple) ? rawTuple : (rawTuple as Record<string, unknown>),
        );
        if (tupleSeen.has(key)) {
          return fail([
            diagnostic(
              'DUPLICATE_IDENTITY',
              `${path}.expectedTuples[${index}]`,
              'duplicate expected status tuple variant',
            ),
          ]);
        }
        tupleSeen.add(key);
        tuples.push(tuple.value);
      }
      const rules: StatusRuleAssertion[] = [];
      for (const [index, rawRule] of rawRules.entries()) {
        const rule = decodeRuleAssertion(rawRule, `${path}.ruleAssertions[${index}]`);
        if (!rule.ok) {
          return rule;
        }
        rules.push(rule.value);
      }
      if (tuples.length === 0 && rules.length === 0) {
        return fail([
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            `${path}.expectedTuples`,
            `oracle '${oracleId.value}' must pre-register at least one expected tuple or rule assertion`,
            'PRD-§35',
          ),
        ]);
      }
      for (const gateRef of gateRefs.value) {
        if (!isCanonicalGateId(gateRef)) {
          return fail([
            diagnostic(
              'UNKNOWN_ENUM_VALUE',
              `${path}.gateRefs`,
              `unknown gate id '${gateRef}'`,
              'PRD-§32',
            ),
          ]);
        }
      }
      let g0PlanRef: string | undefined;
      const rawPlanRef = record['g0PlanRef'];
      if (rawPlanRef !== undefined) {
        if (typeof rawPlanRef !== 'string' || rawPlanRef.length === 0) {
          return fail([
            diagnostic(
              'MALFORMED_REQUIRED_FIELD',
              `${path}.g0PlanRef`,
              'must be a non-empty string',
            ),
          ]);
        }
        g0PlanRef = rawPlanRef;
      }
      const g0Involved = (gateRefs.value as readonly string[]).includes('G0');
      if (g0Involved && g0PlanRef === undefined) {
        return fail([
          diagnostic(
            'MISSING_REQUIRED_FIELD',
            `${path}.g0PlanRef`,
            `oracle '${oracleId.value}' involves G0 and must reference the applicable frozen G0BaselinePlan`,
            'PRD-§35/§32.2',
          ),
        ]);
      }
      if (!g0Involved && g0PlanRef !== undefined) {
        return fail([
          diagnostic(
            'INVALID_RESULT_COMBINATION',
            `${path}.g0PlanRef`,
            `oracle '${oracleId.value}' references a G0 plan without a G0 gate ref`,
            'PRD-§35',
          ),
        ]);
      }
      if (
        g0PlanRef !== undefined &&
        knownG0PlanIds !== undefined &&
        !knownG0PlanIds.includes(g0PlanRef)
      ) {
        return fail([
          diagnostic(
            'CONTRACT_BINDING_MISMATCH',
            `${path}.g0PlanRef`,
            `oracle '${oracleId.value}' references G0 plan '${g0PlanRef}' which is not registered`,
            'PRD-§32.2',
          ),
        ]);
      }
      return ok(
        deepFreeze({
          oracleId: oracleId.value,
          scenario: scenario.value,
          prdRef: prdRef.value,
          requiredBehavior: requiredBehavior.value,
          target: target.value,
          scopeRef: scopeRef.value,
          truthSource: truthSource.value,
          expectedTuples: deepFreeze(tuples),
          ruleAssertions: deepFreeze(rules),
          gateRefs: deepFreeze(gateRefs.value.map((id) => id as GateId)),
          g0PlanRef,
        }),
      );
    }),
  );
}

/**
 * Load the full C01–C34 oracle corpus from untrusted records. The corpus is
 * complete only when every canonical identity appears exactly once; unknown
 * identities, unknown canonical statuses, self-generated truth sources or
 * unresolved corpus/plan references fail closed.
 */
export function loadOracleCorpus(
  records: readonly unknown[],
  registry: CorpusRegistry,
  options: { readonly knownG0PlanIds?: readonly string[] } = {},
): DomainValidationResult<OracleCorpus> {
  if (!Array.isArray(records)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'oracles', 'expected an array of oracle records'),
    ]);
  }
  const oracles: CounterexampleOracle[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of records.entries()) {
    const decoded = decodeOracle(raw, `oracles[${index}]`, registry, options.knownG0PlanIds);
    if (!decoded.ok) {
      return decoded;
    }
    const oracle = decoded.value;
    if (seen.has(oracle.oracleId)) {
      return fail([
        diagnostic(
          'DUPLICATE_IDENTITY',
          `oracles[${index}].oracleId`,
          `counterexample identity '${oracle.oracleId}' registered twice`,
          'PRD-§35',
        ),
      ]);
    }
    seen.add(oracle.oracleId);
    oracles.push(oracle);
  }
  const missing = CANONICAL_ORACLE_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return fail(
      missing.map((id) =>
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          'oracles',
          `counterexample oracle '${id}' is missing from the corpus; the frozen PRD §35 corpus is exactly C01–C34`,
          'PRD-§35',
        ),
      ),
    );
  }
  oracles.sort((a, b) => (a.oracleId < b.oracleId ? -1 : 1));
  const byId = new Map<string, CounterexampleOracle>(
    oracles.map((oracle) => [oracle.oracleId, oracle]),
  );
  return ok(
    deepFreeze({
      oracles: deepFreeze(oracles),
      byId: (oracleId: string) => byId.get(oracleId),
      executionStatus: 'NOT_RUN' as const,
    }),
  );
}
