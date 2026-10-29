/**
 * T012 TEST_MATRIX suite `schema-policy-rejection`: every acceptable
 * proposal payload decodes as a RecipeDefinition through the unmodified
 * `@xdownload/discovery-recipe` decoder; malformed/unknown/oversized/
 * unsupported-version inputs reject deterministically; provenance binding
 * is exact.
 *
 * Negative cases covered here (TEST_MATRIX negative_decode_cases):
 * oversized-proposal-payload, malformed-required-field,
 * unsupported-proposal-schema-version, raw-secret-field-in-proposal-payload.
 */
import { describe, expect, it } from 'vitest';
import { decodeRecipeDefinition } from '@xdownload/discovery-recipe';
import { decodeProposalEnvelope, evaluateProposal } from '../src/index.ts';
import {
  CONTINUATION_CONTRACT,
  CURRENT_PAGE_CONTRACT,
  FAKE_PROVIDER_IDENTITY,
  GAP_REF,
  CONTRACT_REF,
  evaluationContext,
  legalProposalBytes,
  legalRecipePayload,
  proposalEnvelope,
} from './fixtures.ts';

describe('T012 schema/policy rejection (TEST_MATRIX schema-policy-rejection)', () => {
  it('accepts a legal proposal whose payload decodes as a RecipeDefinition via the unmodified decoder', () => {
    const bytes = legalProposalBytes();
    // The exact payload decodes through the unmodified discovery-recipe decoder.
    const envelope = decodeProposalEnvelope(bytes);
    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      const recipe = decodeRecipeDefinition(envelope.value.payload);
      expect(recipe.ok).toBe(true);
    }
    const decision = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.proposalId).toBe('proposal/playlist-continuation-001');
      expect(decision.value.certaintyCeiling).toBe('SUGGESTIVE');
      expect(decision.value.provider).toEqual(FAKE_PROVIDER_IDENTITY);
      expect(decision.value.provenance).toEqual({ gapRef: GAP_REF, contractRef: CONTRACT_REF });
      expect(decision.value.recipe.recipeId).toBe('recipe/playlist-natural-end-suggested');
    }
  });

  it('accepts passive-only proposals against a contract with no continuation authority', () => {
    const bytes = proposalEnvelope(legalRecipePayload());
    const decision = evaluateProposal(bytes, evaluationContext(), CURRENT_PAGE_CONTRACT);
    expect(decision.ok).toBe(true);
  });

  it('negative[oversized-proposal-payload]: rejects before policy evaluation with the declared bound named', () => {
    const oversized = proposalEnvelope(
      legalRecipePayload({
        applicabilityScope: {
          description: ` oversized ${'x'.repeat(40_000)}`,
          scopeKeys: ['playlist-template'],
        },
      }),
    );
    const decision = evaluateProposal(oversized, evaluationContext(), CONTINUATION_CONTRACT);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.diagnostics).toHaveLength(1);
      expect(decision.diagnostics[0]?.code).toBe('PROPOSAL_TOO_LARGE');
      expect(decision.diagnostics[0]?.invariant).toBe('T012-bounded-envelope');
    }
  });

  it('negative[malformed-required-field]: rejects missing envelope fields and non-object payloads', () => {
    for (const bytes of [
      proposalEnvelope(legalRecipePayload(), { proposalId: undefined }),
      proposalEnvelope(42),
      proposalEnvelope('not-a-recipe'),
      proposalEnvelope(legalRecipePayload({ evidenceRules: undefined })),
    ]) {
      const decision = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        const codes = decision.diagnostics.map((d) => d.code);
        expect(
          codes.includes('MALFORMED_REQUIRED_FIELD') ||
            codes.includes('MISSING_REQUIRED_FIELD') ||
            codes.includes('UNKNOWN_FIELD'),
        ).toBe(true);
      }
    }
  });

  it('negative[unsupported-proposal-schema-version]: rejects incompatible envelope versions fail-closed', () => {
    for (const [bytes, expectedCode] of [
      [
        proposalEnvelope(legalRecipePayload(), {
          schemaIdentity: { schema: 'xdownload.ai-proposal', version: '2.0.0' },
        }),
        'UNSUPPORTED_SCHEMA_VERSION',
      ],
      [
        proposalEnvelope(legalRecipePayload(), {
          schemaIdentity: { schema: 'xdownload.some-other-proposal', version: '1.0.0' },
        }),
        'UNKNOWN_SCHEMA_IDENTITY',
      ],
      [
        proposalEnvelope(legalRecipePayload(), {
          schemaIdentity: { schema: 'xdownload.ai-proposal', version: 'not-semver' },
        }),
        'MALFORMED_REQUIRED_FIELD',
      ],
    ] as const) {
      const decision = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.diagnostics.map((d) => d.code)).toContain(expectedCode);
      }
    }
  });

  it('negative[raw-secret-field-in-proposal-payload]: rejects raw secret fields at envelope and payload level', () => {
    const atEnvelope = proposalEnvelope(legalRecipePayload(), { apiKey: 'sk-test-123' });
    const atPayload = proposalEnvelope(legalRecipePayload({ token: 'tok_smuggled' }));
    for (const bytes of [atEnvelope, atPayload]) {
      const decision = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.diagnostics.map((d) => d.code)).toContain('RAW_SECRET_FIELD');
        expect(decision.diagnostics.map((d) => d.invariant)).toContain('PRD-§29');
      }
    }
  });

  it('rejects provenance binding to a different gap, contract context or provider', () => {
    for (const context of [
      evaluationContext({ expectedGapRef: 'gap/other-001' }),
      evaluationContext({ expectedContractRef: 'contract-other' }),
      evaluationContext({
        expectedProvider: { providerId: 'fake/other', modelId: FAKE_PROVIDER_IDENTITY.modelId },
      }),
    ]) {
      const decision = evaluateProposal(legalProposalBytes(), context, CONTINUATION_CONTRACT);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.diagnostics.map((d) => d.code)).toContain('PROVENANCE_BINDING_REJECTED');
        expect(decision.diagnostics.map((d) => d.invariant)).toContain('T012-provenance-binding');
      }
    }
  });

  it('policy is deterministic: same proposal + gap + contract always yields the identical decision', () => {
    const bytes = legalProposalBytes();
    const first = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
    const second = evaluateProposal(bytes, evaluationContext(), CONTINUATION_CONTRACT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const hostileBytes = proposalEnvelope(legalRecipePayload({ recipeId: 'recipe/hostile' }), {
      proposalId: 'proposal/hostile',
    });
    const hostileFirst = evaluateProposal(hostileBytes, evaluationContext(), CURRENT_PAGE_CONTRACT);
    const hostileSecond = evaluateProposal(
      hostileBytes,
      evaluationContext(),
      CURRENT_PAGE_CONTRACT,
    );
    expect(JSON.stringify(hostileFirst)).toBe(JSON.stringify(hostileSecond));
  });
});
