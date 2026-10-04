/**
 * T012 redaction-aware bounded model-input boundary (PRD §29 "LLM may
 * receive capability facts but must not require raw secrets for ordinary
 * tasks"; frozen L2 §6.4 "redact secrets at logs/evidence/model/Recipe/
 * Core-durable boundaries"; counterexample C21).
 *
 * Model input is built only from redacted bounded knowledge gaps,
 * observations and capability facts. Containment follows the T010 exit-sink
 * precedent (`@xdownload/browser-observation` `redactForSink`):
 *
 * 1. key-based: values under `RAW_SECRET_FIELD_NAMES` keys are replaced with
 *    the redaction marker at any nesting depth;
 * 2. value-based: strings containing registered secret sentinels are
 *    replaced wholesale, so secret material smuggled into non-secret-named
 *    fields cannot leak either.
 *
 * Structural violations of the bounded gap envelope fail closed. Secret
 * material is contained (redacted), never persisted, exported or forwarded;
 * after redaction an explicit audit re-proves containment before anything
 * may reach a provider port.
 */

import {
  RAW_SECRET_FIELD_NAMES,
  asRecord,
  deepFreeze,
  diagnostic,
  rejectUnknownFields,
  requireLiteral,
  requireNonEmptyString,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import {
  REDACTED_MARKER,
  auditValueContainsSentinel,
  redactForSink,
} from '@xdownload/browser-observation';
import {
  proposalDiagnostic,
  proposalFail,
  proposalOk,
  type ProposalDiagnostic,
  type ProposalValidationResult,
} from './diagnostics.ts';

/** Declared bound for serialized model input; enforced after redaction, before any provider use. */
export const MAX_MODEL_INPUT_SERIALIZED_CHARS = 16_384;

const GAP_INPUT_KEYS: readonly string[] = [
  'gap',
  'observations',
  'capabilityFacts',
  'contractContext',
];
const GAP_KEYS: readonly string[] = ['gapId', 'gapKind', 'description', 'fallbackPreference'];
const CONTRACT_CONTEXT_KEYS: readonly string[] = ['contractRef', 'scopeSummary'];

const FALLBACK_PREFERENCES: readonly ('ASK_USER' | 'ABORT')[] = ['ASK_USER', 'ABORT'];

/** A bounded knowledge gap: the only gap shape the adapter accepts from callers. */
export interface BoundedKnowledgeGap {
  readonly gapId: string;
  readonly gapKind: string;
  readonly description: string;
  /** Deterministic fallback used whenever the model is absent or unusable (never widened). */
  readonly fallbackPreference: 'ASK_USER' | 'ABORT';
}

export interface RedactedContractContext {
  readonly contractRef: string;
  readonly scopeSummary: string;
}

/** Caller-shaped gap envelope (untrusted); decoded strictly, then redacted. */
export interface GapEnvelopeInput {
  readonly gap: BoundedKnowledgeGap;
  /** Open-domain observation facts (field name → string); secret material is redacted, never forwarded. */
  readonly observations: Readonly<Record<string, string>>;
  /** Capability facts (names/status only — never secret material). */
  readonly capabilityFacts: readonly string[];
  readonly contractContext: RedactedContractContext;
}

export interface RedactedModelInput {
  readonly gap: BoundedKnowledgeGap;
  readonly observations: Readonly<Record<string, string>>;
  readonly capabilityFacts: readonly string[];
  readonly contractContext: RedactedContractContext;
  /** Exact serialized form handed to the provider port; contains no secret material. */
  readonly serialized: string;
}

/** One containment violation found by the secret-material audit. */
export interface SecretMaterialViolation {
  readonly kind: 'RAW_SECRET_KEY_VALUE' | 'SENTINEL_VALUE';
  readonly path: string;
}

function childPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

/**
 * Deep audit for secret material: values under raw-secret keys must be the
 * redaction marker, and no string anywhere may contain a registered secret
 * sentinel. Sentinel matching follows the sanctioned T010 registry
 * mechanics; the audit is the executable containment proof at every T012
 * boundary (model input, proposal payload, provider response).
 */
export function auditSecretMaterial(value: unknown): readonly SecretMaterialViolation[] {
  const violations: SecretMaterialViolation[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (auditValueContainsSentinel(node)) {
        violations.push({ kind: 'SENTINEL_VALUE', path: path });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${String(index)}]`));
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        const at = childPath(path, key);
        if (
          RAW_SECRET_FIELD_NAMES.has(key) &&
          typeof child === 'string' &&
          child !== REDACTED_MARKER
        ) {
          violations.push({ kind: 'RAW_SECRET_KEY_VALUE', path: at });
        }
        walk(child, at);
      }
    }
  };
  walk(value, '');
  return violations;
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

function decodeGap(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): BoundedKnowledgeGap | undefined {
  const record = unwrap(asRecord(value, 'modelInput.gap'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  pushAll(rejectUnknownFields(record, GAP_KEYS, 'modelInput.gap'), diagnostics);
  const gapId = unwrap(requireNonEmptyString(record, 'gapId', 'modelInput.gap'), diagnostics);
  const gapKind = unwrap(requireNonEmptyString(record, 'gapKind', 'modelInput.gap'), diagnostics);
  const description = unwrap(
    requireNonEmptyString(record, 'description', 'modelInput.gap'),
    diagnostics,
  );
  const fallbackPreference = unwrap(
    requireLiteral(record, 'fallbackPreference', FALLBACK_PREFERENCES, 'modelInput.gap'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return undefined;
  }
  return deepFreeze({
    gapId: gapId!,
    gapKind: gapKind!,
    description: description!,
    fallbackPreference: fallbackPreference!,
  });
}

function decodeObservations(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): Readonly<Record<string, string>> | undefined {
  const record = unwrap(asRecord(value, 'modelInput.observations'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  for (const [key, child] of Object.entries(record)) {
    if (typeof child !== 'string') {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          `modelInput.observations.${key}`,
          'observation facts must be string values',
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  return deepFreeze({ ...(record as Record<string, string>) });
}

function decodeCapabilityFacts(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'modelInput.capabilityFacts',
        'capability facts must be an array of strings',
      ),
    );
    return undefined;
  }
  return deepFreeze([...(value as readonly string[])]);
}

function decodeContractContext(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): RedactedContractContext | undefined {
  const record = unwrap(asRecord(value, 'modelInput.contractContext'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  pushAll(
    rejectUnknownFields(record, CONTRACT_CONTEXT_KEYS, 'modelInput.contractContext'),
    diagnostics,
  );
  const contractRef = unwrap(
    requireNonEmptyString(record, 'contractRef', 'modelInput.contractContext'),
    diagnostics,
  );
  const scopeSummary = unwrap(
    requireNonEmptyString(record, 'scopeSummary', 'modelInput.contractContext'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return undefined;
  }
  return deepFreeze({ contractRef: contractRef!, scopeSummary: scopeSummary! });
}

/**
 * Decode, redact, bound and audit a gap envelope into the only shape a
 * provider port may receive. Deterministic: the same raw input and the same
 * sentinel registry always produce the same redacted model input.
 */
export function buildModelInput(raw: unknown): ProposalValidationResult<RedactedModelInput> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(raw, 'modelInput'), diagnostics);
  if (record === undefined) {
    return proposalFail(diagnostics.map(toProposalDiagnostic));
  }
  pushAll(rejectUnknownFields(record, GAP_INPUT_KEYS, 'modelInput'), diagnostics);
  const gap = record['gap'] === undefined ? undefined : decodeGap(record['gap'], diagnostics);
  const observations =
    record['observations'] === undefined
      ? undefined
      : decodeObservations(record['observations'], diagnostics);
  const capabilityFacts =
    record['capabilityFacts'] === undefined
      ? undefined
      : decodeCapabilityFacts(record['capabilityFacts'], diagnostics);
  const contractContext =
    record['contractContext'] === undefined
      ? undefined
      : decodeContractContext(record['contractContext'], diagnostics);
  if (
    diagnostics.length > 0 ||
    gap === undefined ||
    observations === undefined ||
    capabilityFacts === undefined ||
    contractContext === undefined
  ) {
    return proposalFail(
      diagnostics.length > 0
        ? diagnostics.map(toProposalDiagnostic)
        : [
            proposalDiagnostic(
              'MALFORMED_REQUIRED_FIELD',
              'modelInput',
              'gap envelope requires gap, observations, capabilityFacts and contractContext',
            ),
          ],
    );
  }
  // Containment first: deep-redact before any serialization or size check.
  const redacted = {
    gap: redactForSink(gap),
    observations: redactForSink(observations),
    capabilityFacts: redactForSink(capabilityFacts),
    contractContext: redactForSink(contractContext),
  };
  const violations = auditSecretMaterial(redacted);
  if (violations.length > 0) {
    return proposalFail(
      violations.map((violation) =>
        proposalDiagnostic(
          'SECRET_MATERIAL_DETECTED',
          violation.path,
          violation.kind === 'SENTINEL_VALUE'
            ? 'registered secret sentinel survived redaction; model input fails closed (C21)'
            : 'raw secret key carries an unredacted value; model input fails closed (PRD-§29)',
          violation.kind === 'SENTINEL_VALUE' ? 'C21' : 'PRD-§29',
        ),
      ),
    );
  }
  const serialized = JSON.stringify(redacted);
  if (serialized.length > MAX_MODEL_INPUT_SERIALIZED_CHARS) {
    return proposalFail([
      proposalDiagnostic(
        'PROPOSAL_INPUT_TOO_LARGE',
        'modelInput',
        `redacted model input exceeds the declared bound of ${String(MAX_MODEL_INPUT_SERIALIZED_CHARS)} characters`,
        'T012-bounded-envelope',
      ),
    ]);
  }
  return proposalOk(
    deepFreeze({
      gap: redacted.gap,
      observations: redacted.observations,
      capabilityFacts: redacted.capabilityFacts,
      contractContext: redacted.contractContext,
      serialized: serialized,
    }),
  );
}

function toProposalDiagnostic(d: ValidationDiagnostic): ProposalDiagnostic {
  return { code: d.code, path: d.path, message: d.message, invariant: d.invariant };
}
