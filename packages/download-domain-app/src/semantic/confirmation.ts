/**
 * v0.2 T05 — the requiresConfirmation branch vocabulary.
 *
 * When the semantic lane cannot uniquely decide, it returns a confirmation
 * plan instead of a selection — it never silently picks. The request levels
 * and the small-number-of-material-confirmations bound are a deliberate
 * vocabulary reuse of the existing discovery confirmation workflow
 * (SCOPE_LEVEL / BATCH_GROUP / MATERIAL_ITEM / MANUAL_SELECTION_UI and
 * MAX_MATERIAL_ITEM_CONFIRMATIONS = 3); this module declares them locally
 * because the discovery package is not a dependency of the Domain App.
 *
 * Per-item interrogation is never the default resolution path (frozen C30):
 * ambiguous sets larger than the material bound collapse into one batch
 * request, and open-ended ambiguity exposes one manual-selection surface.
 */
import { deepFreeze, type MemberId } from '@xdownload/domain-contracts';

import { compareCodeUnitOrder } from './finite-membership.ts';

/** Deterministic bound on "a small number of material item confirmations". */
export const MAX_MATERIAL_ITEM_CONFIRMATIONS = 3;

export type SemanticConfirmationRequest =
  | { readonly level: 'SCOPE_LEVEL'; readonly scopeKey: string }
  | { readonly level: 'BATCH_GROUP'; readonly memberRefs: readonly string[] }
  | { readonly level: 'MATERIAL_ITEM'; readonly memberRef: string }
  | { readonly level: 'MANUAL_SELECTION_UI'; readonly candidateRefs: readonly string[] };

export interface SemanticConfirmationPlan {
  readonly requests: readonly SemanticConfirmationRequest[];
  /** Per-item interrogation is never the default resolution path (C30). */
  readonly perItemInterrogationUsed: boolean;
  readonly escalationReason?: 'INSUFFICIENT_DECISIVE_EVIDENCE';
}

/** Why the lane could not uniquely decide (frozen, exhaustive). */
export type SelectionAmbiguityReason =
  'AMBIGUOUS_TIE' | 'INSUFFICIENT_EVIDENCE' | 'ADVISORY_CONTESTED';

/**
 * Build the deterministic confirmation plan for an undecided selection.
 * Same inputs always yield a deeply equal plan: members are processed in
 * canonical code-unit order and the level choice depends only on the count.
 */
export function buildConfirmationPlan(input: {
  readonly reason: SelectionAmbiguityReason;
  /** Members the user must disambiguate (canonical order enforced here). */
  readonly memberIds: readonly MemberId[];
  /** Scope key for the SCOPE_LEVEL fallback (bounded opaque identifier). */
  readonly scopeKey: string;
}): SemanticConfirmationPlan {
  const members = deepFreeze([...input.memberIds].sort(compareCodeUnitOrder));
  const requests: readonly SemanticConfirmationRequest[] =
    input.reason === 'AMBIGUOUS_TIE' && members.length > MAX_MATERIAL_ITEM_CONFIRMATIONS
      ? [{ level: 'BATCH_GROUP', memberRefs: members }]
      : input.reason === 'AMBIGUOUS_TIE' && members.length > 0
        ? members.map((memberRef) => ({ level: 'MATERIAL_ITEM', memberRef }) as const)
        : input.reason === 'INSUFFICIENT_EVIDENCE'
          ? [{ level: 'MANUAL_SELECTION_UI', candidateRefs: members }]
          : [{ level: 'SCOPE_LEVEL', scopeKey: input.scopeKey }];
  return deepFreeze({
    requests,
    perItemInterrogationUsed: false,
    ...(input.reason === 'INSUFFICIENT_EVIDENCE'
      ? { escalationReason: 'INSUFFICIENT_DECISIVE_EVIDENCE' as const }
      : {}),
  });
}
