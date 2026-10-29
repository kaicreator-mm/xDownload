/**
 * T003 exact-subject evidence capture and deterministic formatting
 * (frozen PRD §20 claim model, §21 confirmation limits, §22 validation
 * layers; C26/C27/C34).
 *
 * Capture delegates the claim fields to the canonical
 * `decodeEvidenceRecord` (claim_type, claim_subject, source identity/
 * provenance, independence_from_discovery, scope, certainty class) so
 * discovery/UI provenance can never be typed as independent truth for the
 * same claim. Formatting is byte-stable and subject-exact: merged or
 * approximated subjects are rejected.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type ConfirmationType,
  type DomainValidationResult,
  type EvidenceRecord,
} from '@xdownload/domain-contracts';
import { decodeEvidenceRecord, whatConfirmationProves } from '@xdownload/domain-contracts';
import { stableStringify } from './canonical-json.ts';

/**
 * Capture one material evidence record from untrusted input. Rejection is
 * the canonical typed diagnostic; partial/corrupt records never surface.
 */
export function captureEvidence(raw: unknown): DomainValidationResult<EvidenceRecord> {
  return decodeEvidenceRecord(raw);
}

/**
 * Deterministic, subject-exact formatting: canonical stable JSON so two
 * calls with identical records are byte-identical regardless of key
 * insertion order.
 */
export function formatEvidenceRecord(record: EvidenceRecord): string {
  return stableStringify(record);
}

/**
 * Exact-subject binding: the record's claim subject must equal the expected
 * identity exactly. Merged, prefixed or approximated subjects fail closed
 * (PRD §20).
 */
export function assertEvidenceSubjectExact(
  record: EvidenceRecord,
  expectedSubjectRef: string,
): DomainValidationResult<void> {
  if (record.claimSubject.ref !== expectedSubjectRef) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'evidence.claimSubject.ref',
        `evidence subject '${record.claimSubject.ref}' does not exactly match the claimed subject '${expectedSubjectRef}'; merged or approximated subjects are rejected`,
        'PRD-§20',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Confirmation proof-scope rule (PRD §21, C26/C27): a user-confirmation
 * record proves exactly the claim type the user was shown/asked, and can
 * never stand in for Transfer/Format/Media validation or rewrite
 * experiment truth.
 */
export function assertConfirmationProofScope(
  record: EvidenceRecord,
  confirmationType: ConfirmationType,
): DomainValidationResult<void> {
  if (record.sourceType !== 'USER_CONFIRMATION') {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'evidence.sourceType',
        `proof-scope rule applies to USER_CONFIRMATION records, got '${record.sourceType}'`,
        'PRD-§21',
      ),
    ]);
  }
  const scope = whatConfirmationProves(confirmationType);
  if (record.claimType !== scope.proves) {
    return fail([
      diagnostic(
        'CONFIRMATION_CANNOT_WAIVE_VALIDATION',
        'evidence.claimType',
        `confirmation '${confirmationType}' proves only '${scope.proves}'; typing it as '${record.claimType}' would waive required validation`,
        'PRD-§21',
      ),
    ]);
  }
  return ok(undefined);
}

/**
 * Truth-source usability: for a claim, truth must come from the
 * pre-registered source exactly; UI suggestion/discovery inference can never
 * be ground truth (C34), and unregistered references fail closed.
 */
export function createEvidenceGate(preRegisteredRefs: readonly string[]): {
  assertUsableTruthSource(ref: string): DomainValidationResult<void>;
} {
  const registered = new Set(preRegisteredRefs);
  return deepFreeze({
    assertUsableTruthSource(ref: string): DomainValidationResult<void> {
      if (!registered.has(ref)) {
        return fail([
          diagnostic(
            'INSUFFICIENT_EVIDENCE',
            'truthSource.ref',
            `truth source '${ref}' is not pre-registered; it cannot ground any Validation comparison`,
            'C34/PRD-§32.1',
          ),
        ]);
      }
      if (/(^|[/#])(ui-suggestion|discovery-inference|model-self)([/#]|$)/.test(ref)) {
        return fail([
          diagnostic(
            'SELF_CERTIFICATION',
            'truthSource.ref',
            `'${ref}' is discovery/UI/model output and can never be independent truth for the same claim`,
            'C34',
          ),
        ]);
      }
      return ok(undefined);
    },
  });
}

/**
 * Determinism helper for harness outputs: canonical stable serialization of
 * any recorded result, so harness outputs are byte-stable across repeated
 * runs on identical inputs.
 */
export function formatHarnessOutput(value: unknown): string {
  return stableStringify(value);
}
