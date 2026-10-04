/**
 * T012 bounded proposal envelope (frozen Task Pack: the proposal envelope
 * carries provenance/traceability and a payload that must decode as a
 * RecipeDefinition through the unmodified `@xdownload/discovery-recipe`
 * decoder — the proposal target schema).
 *
 * The envelope is deliberately thin: explicit schema identity, a declared
 * maximum size enforced before any deep processing, unknown-field
 * rejection, provider identity and provenance binding (which gap, which
 * contract context, which provider), and the still-untrusted payload.
 * All Recipe semantics live in the existing decoder and the deterministic
 * policy — the envelope invents no authority fields and fails closed on
 * anything it does not declare.
 */

import {
  asRecord,
  parseSemVer,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireNonEmptyString,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import type { ProviderIdentity } from './providerPort.ts';
import {
  proposalDiagnostic,
  proposalFail,
  proposalOk,
  type ProposalDiagnostic,
  type ProposalValidationResult,
} from './diagnostics.ts';

export const AI_PROPOSAL_SCHEMA_ID = 'xdownload.ai-proposal' as const;

/** Current proposal envelope schema identity stamped onto accepted proposals. */
export const AI_PROPOSAL_SCHEMA_VERSION = '1.0.0' as const;

/** Proposal envelope major versions this adapter can decode deterministically. */
export const SUPPORTED_PROPOSAL_MAJOR_VERSIONS: readonly number[] = [1];

/**
 * Declared bound for serialized proposals; oversized proposals reject
 * before policy evaluation (frozen Task Pack: bounded size limit rejects
 * oversized proposals before policy evaluation).
 */
export const MAX_PROPOSAL_SERIALIZED_CHARS = 32_768;

const ENVELOPE_KEYS: readonly string[] = [
  'schemaIdentity',
  'proposalId',
  'provider',
  'provenance',
  'payload',
];
const PROVIDER_KEYS: readonly string[] = ['providerId', 'modelId'];
const PROVENANCE_KEYS: readonly string[] = ['gapRef', 'contractRef'];

export interface ProposalSchemaIdentity {
  readonly schema: typeof AI_PROPOSAL_SCHEMA_ID;
  readonly version: string;
}

export interface ProposalProvenance {
  /** The knowledge gap this proposal answers (binding is checked by policy). */
  readonly gapRef: string;
  /** The contract context the proposal was issued for (binding is checked by policy). */
  readonly contractRef: string;
}

export interface DecodedProposalEnvelope {
  readonly schemaIdentity: ProposalSchemaIdentity;
  readonly proposalId: string;
  readonly provider: ProviderIdentity;
  readonly provenance: ProposalProvenance;
  /** Still untrusted; only the deterministic policy decodes it (via `decodeRecipeDefinition`). */
  readonly payload: unknown;
}

function serializedChars(value: unknown): DomainValidationResult<number> {
  if (typeof value === 'string') {
    return { ok: true, value: value.length };
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'MALFORMED_REQUIRED_FIELD',
          path: 'proposal',
          message: 'proposal must be acyclic JSON-serializable data',
        },
      ],
    };
  }
  return { ok: true, value: serialized === undefined ? 0 : serialized.length };
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

function decodeProvider(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): ProviderIdentity | undefined {
  const record = unwrap(asRecord(value, 'proposal.provider'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  pushAll(rejectUnknownFields(record, PROVIDER_KEYS, 'proposal.provider'), diagnostics);
  const providerId = unwrap(
    requireNonEmptyString(record, 'providerId', 'proposal.provider'),
    diagnostics,
  );
  const modelId = unwrap(
    requireNonEmptyString(record, 'modelId', 'proposal.provider'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return undefined;
  }
  return { providerId: providerId!, modelId: modelId! };
}

function decodeProvenance(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): ProposalProvenance | undefined {
  const record = unwrap(asRecord(value, 'proposal.provenance'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  pushAll(rejectRawSecretFields(record, 'proposal.provenance'), diagnostics);
  pushAll(rejectUnknownFields(record, PROVENANCE_KEYS, 'proposal.provenance'), diagnostics);
  const gapRef = unwrap(
    requireNonEmptyString(record, 'gapRef', 'proposal.provenance'),
    diagnostics,
  );
  const contractRef = unwrap(
    requireNonEmptyString(record, 'contractRef', 'proposal.provenance'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return undefined;
  }
  return { gapRef: gapRef!, contractRef: contractRef! };
}

function decodeProposalSchemaIdentity(
  value: unknown,
  diagnostics: ValidationDiagnostic[],
): ProposalSchemaIdentity | undefined {
  const record = unwrap(asRecord(value, 'proposal.schemaIdentity'), diagnostics);
  if (record === undefined) {
    return undefined;
  }
  pushAll(
    rejectUnknownFields(record, ['schema', 'version'], 'proposal.schemaIdentity'),
    diagnostics,
  );
  if (record['schema'] !== AI_PROPOSAL_SCHEMA_ID) {
    diagnostics.push({
      code: 'UNKNOWN_SCHEMA_IDENTITY',
      path: 'proposal.schemaIdentity.schema',
      message: `expected proposal schema '${AI_PROPOSAL_SCHEMA_ID}'`,
    });
  }
  const version = record['version'];
  if (typeof version !== 'string' || parseSemVer(version) === undefined) {
    diagnostics.push({
      code: 'MALFORMED_REQUIRED_FIELD',
      path: 'proposal.schemaIdentity.version',
      message: 'version must be a valid semver string',
    });
  } else if (!SUPPORTED_PROPOSAL_MAJOR_VERSIONS.includes(parseSemVer(version)!.major)) {
    diagnostics.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      path: 'proposal.schemaIdentity.version',
      message: `unsupported proposal schema major version ${String(parseSemVer(version)!.major)}; incompatible proposal versions fail closed`,
      invariant: 'schema-versioning',
    });
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  return { schema: AI_PROPOSAL_SCHEMA_ID, version: version as string };
}

/**
 * Decode the bounded proposal envelope from untrusted input. Order is
 * deliberate and deterministic: size bound first (before any deep
 * processing), then shape, secret-field, unknown-field, version, provider
 * and provenance decoding. The payload is returned unvalidated on purpose —
 * only the deterministic policy may decode it, through the unmodified
 * Recipe decoder.
 */
export function decodeProposalEnvelope(
  value: unknown,
): ProposalValidationResult<DecodedProposalEnvelope> {
  // Cheap early rejection: oversized proposals never reach field decoding.
  const size = serializedChars(value);
  if (!size.ok) {
    return proposalFail(size.diagnostics);
  }
  if (size.value > MAX_PROPOSAL_SERIALIZED_CHARS) {
    return proposalFail([
      proposalDiagnostic(
        'PROPOSAL_TOO_LARGE',
        'proposal',
        `serialized proposal exceeds the declared bound of ${String(MAX_PROPOSAL_SERIALIZED_CHARS)} characters`,
        'T012-bounded-envelope',
      ),
    ]);
  }
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'proposal'), diagnostics);
  if (record === undefined) {
    return proposalFail(diagnostics.map(toProposalDiagnostic));
  }
  pushAll(rejectRawSecretFields(record, 'proposal'), diagnostics);
  pushAll(rejectUnknownFields(record, ENVELOPE_KEYS, 'proposal'), diagnostics);
  const schemaIdentity =
    record['schemaIdentity'] === undefined
      ? undefined
      : decodeProposalSchemaIdentity(record['schemaIdentity'], diagnostics);
  const proposalId = unwrap(requireNonEmptyString(record, 'proposalId', 'proposal'), diagnostics);
  const provider =
    record['provider'] === undefined ? undefined : decodeProvider(record['provider'], diagnostics);
  const provenance =
    record['provenance'] === undefined
      ? undefined
      : decodeProvenance(record['provenance'], diagnostics);
  if (record['payload'] === undefined) {
    diagnostics.push({
      code: 'MISSING_REQUIRED_FIELD',
      path: 'proposal.payload',
      message: 'proposal envelope requires a payload',
    });
  }
  if (
    diagnostics.length > 0 ||
    schemaIdentity === undefined ||
    proposalId === undefined ||
    provider === undefined ||
    provenance === undefined
  ) {
    return proposalFail(
      diagnostics.length > 0
        ? diagnostics.map(toProposalDiagnostic)
        : [
            proposalDiagnostic(
              'MALFORMED_REQUIRED_FIELD',
              'proposal',
              'proposal envelope decode failed',
            ),
          ],
    );
  }
  return proposalOk({
    schemaIdentity: schemaIdentity,
    proposalId: proposalId,
    provider: provider,
    provenance: provenance,
    payload: record['payload'],
  });
}

function toProposalDiagnostic(d: ValidationDiagnostic): ProposalDiagnostic {
  return { code: d.code, path: d.path, message: d.message, invariant: d.invariant };
}
