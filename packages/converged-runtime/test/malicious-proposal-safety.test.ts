/**
 * TEST_MATRIX suite `malicious-proposal-safety` (T017).
 *
 * Must prove (through the WIRED composed path — the fake provider sits behind
 * the caller-side deadline wrap and the real T012 adapter):
 * - hostile proposal payloads (unknown/unsupported envelope version, oversized
 *   envelope, unknown authority-bearing fields, credential/secret-bearing
 *   content, gap-ref or contract-ref mismatch, scope/membership-expanding
 *   Recipe) fail safely through the deterministic policy as typed rejections
 *   or unavailability;
 * - no malicious or malformed proposal reaches behavior, scope, membership,
 *   authorization or terminal status through the composed path;
 * - redaction/containment holds at the integration boundary: no raw secrets
 *   or unredacted observations cross to the provider port via the wired path.
 */

import { describe, expect, it } from 'vitest';
import { SENTINEL_SECRET } from '../../ai-proposal/test/fixtures.ts';
import { createAiSuggestionLane } from '../src/index.ts';
import {
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  CURRENT_PAGE_CONTRACT,
  deterministicFakeProvider,
  GAP_REF,
  gapEnvelopeInput,
  legalRecipePayload,
  openBudgetFacts,
  proposalEnvelope,
} from './lane-fixtures.ts';

describe('T017 malicious-proposal-safety', () => {
  const confirmation = {
    automationMode: 'ASSISTED',
    selectionPolicyBasis: 'ENTIRE_REQUESTED_SCOPE',
    ambiguousMaterialMemberIds: [],
    candidateCount: 1,
    autoEvidenceSufficient: true,
    scopeScopeKey: 'gap-resolution:t017',
  } as const;

  async function wiredOutcome(payloadFromProvider: unknown, contract = CONTINUATION_CONTRACT) {
    const provider = deterministicFakeProvider({ payload: payloadFromProvider });
    const lane = createAiSuggestionLane({ provider, budgetFacts: openBudgetFacts });
    const outcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput({
        observations: {
          pageKind: 'playlist',
          playlistTemplate: 'playlist-v1',
          membershipRelation: 'a.playlist-item',
          // A raw reusable secret under a secret-named observation field:
          // the redaction boundary must contain it before the provider port.
          cookie: `${SENTINEL_SECRET} ; session value`,
        },
      }),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: contract,
      confirmation,
    });
    return { outcome, provider };
  }

  const attacks: readonly {
    readonly caseId: string;
    readonly bytes: unknown;
    /** The contract the proposal must not exceed (defaults to CONTINUATION_CONTRACT). */
    readonly contract?: typeof CONTINUATION_CONTRACT;
  }[] = [
    {
      caseId: 'unknown/unsupported envelope schema version',
      bytes: proposalEnvelope(legalRecipePayload(), {
        schemaIdentity: { schema: 'xdownload.ai-proposal', version: '9.0.0' },
      }),
    },
    {
      caseId: 'oversized envelope payload',
      bytes: proposalEnvelope(
        legalRecipePayload({
          applicabilityScope: {
            description: ` oversized ${'x'.repeat(40_000)}`,
            scopeKeys: ['playlist-template'],
          },
        }),
      ),
    },
    {
      caseId: 'unknown authority-bearing envelope field (scope mutation)',
      bytes: proposalEnvelope(legalRecipePayload(), {
        requestedScope: { kind: 'domain_wide', pattern: '*.example.com', pages: '1..1000' },
      }),
    },
    {
      caseId: 'unknown authority-bearing envelope field (auth grant)',
      bytes: proposalEnvelope(legalRecipePayload(), {
        authorizationGrant: { cookiesExport: true, tokenAccess: true },
      }),
    },
    {
      caseId: 'credential/signed-URL-bearing recipe rule',
      bytes: proposalEnvelope(
        legalRecipePayload({
          matcher: {
            allOf: [
              {
                field: 'directFileUrl',
                op: 'equals',
                value: 'https://cdn.example.com/file.zip?Expires=1234&Signature=abc123',
              },
            ],
          },
        }),
      ),
    },
    {
      caseId: 'registered-secret-sentinel-bearing payload',
      bytes: proposalEnvelope(legalRecipePayload(), {
        providerNotes: `use ${SENTINEL_SECRET} for download`,
      }),
    },
    {
      caseId: 'gap-ref mismatch (stale proposal replay, C20)',
      bytes: proposalEnvelope(legalRecipePayload(), {
        provenance: { gapRef: 'gap/another-gap', contractRef: CONTRACT_REF },
      }),
    },
    {
      caseId: 'contract-ref mismatch (cross-contract replay, C31)',
      bytes: proposalEnvelope(legalRecipePayload(), {
        provenance: { gapRef: GAP_REF, contractRef: 'contract-other' },
      }),
    },
    {
      caseId: 'scope/membership-expanding recipe capability',
      bytes: proposalEnvelope(
        legalRecipePayload({
          allowedCapabilities: ['observe_current_page', 'follow_declared_collection_continuation'],
        }),
      ),
      // A current-page contract without continuation authority: the recipe's
      // declared-continuation capability is OUTSIDE it (the same pairing the
      // T012 policy suites use).
      contract: CURRENT_PAGE_CONTRACT,
    },
    {
      caseId: 'validation self-certification ceiling',
      bytes: proposalEnvelope(
        legalRecipePayload({
          evidenceRules: {
            emittedClaimTypes: ['RESOURCE_IDENTITY'],
            certaintyCeiling: 'PROBATIVE',
            independenceFromDiscovery: 'DISCOVERY_DERIVED',
            evidenceDomain: 'CONTINUATION_NAVIGATION',
          },
        }),
      ),
    },
  ];

  it('every hostile proposal fails safely through the wired path as typed rejections or unavailability; nothing behavioral survives', async () => {
    for (const attack of attacks) {
      const { outcome } = await wiredOutcome(attack.bytes, attack.contract);
      expect(
        outcome.kind === 'PROPOSAL_REJECTED' || outcome.kind === 'MODEL_UNAVAILABLE',
        attack.caseId,
      ).toBe(true);
      if (outcome.kind === 'PROPOSAL_REJECTED') {
        expect(outcome.diagnostics.length, attack.caseId).toBeGreaterThan(0);
        expect(
          outcome.diagnostics.every((d) => d.code.length > 0 && d.message.length > 0),
          attack.caseId,
        ).toBe(true);
      }
      if (outcome.kind === 'MODEL_UNAVAILABLE') {
        expect(outcome.fallback.kind, attack.caseId).toBe('ASK_USER');
        expect(outcome.fallback.via, attack.caseId).toBe('DETERMINISTIC_PATH');
      }
      expect(JSON.stringify(outcome), attack.caseId).not.toContain('PROPOSAL_ACCEPTED');
      expect(JSON.stringify(outcome), attack.caseId).not.toContain('recipeId');
    }
  });

  it('a capability beyond the contract authority rejects with the typed capability diagnostic (no scope/membership elevation)', async () => {
    // A continuation capability against a contract WITHOUT continuation
    // authority is rejected through the wired path.
    const { outcome } = await wiredOutcome(
      proposalEnvelope(
        legalRecipePayload({
          allowedCapabilities: ['observe_current_page', 'follow_declared_collection_continuation'],
        }),
      ),
      CURRENT_PAGE_CONTRACT,
    );
    expect(outcome.kind).toBe('PROPOSAL_REJECTED');
    if (outcome.kind === 'PROPOSAL_REJECTED') {
      expect(outcome.diagnostics.map((d) => d.code)).toContain('CAPABILITY_NOT_AUTHORIZED');
    }
    // A member-detail capability against a non-confirmed contract fails the
    // same way: the contract, not the proposal, is the authority.
    const provider = deterministicFakeProvider({
      payload: proposalEnvelope(
        legalRecipePayload({ allowedCapabilities: ['open_confirmed_member_detail'] }),
      ),
    });
    const lane = createAiSuggestionLane({ provider, budgetFacts: openBudgetFacts });
    const noAuthorityOutcome = await lane.propose({
      gapEnvelope: gapEnvelopeInput(),
      expectedGapRef: GAP_REF,
      expectedContractRef: CONTRACT_REF,
      contract: {
        status: 'DRAFT',
        continuationScope: { kind: 'NONE' },
        explorationPermission: 'NONE',
      },
      confirmation,
    });
    expect(noAuthorityOutcome.kind).toBe('PROPOSAL_REJECTED');
    if (noAuthorityOutcome.kind === 'PROPOSAL_REJECTED') {
      expect(noAuthorityOutcome.diagnostics.map((d) => d.code)).toContain(
        'CAPABILITY_NOT_AUTHORIZED',
      );
    }
  });

  it('containment holds at the integration boundary: the provider port receives only redacted bounded input', async () => {
    const { provider } = await wiredOutcome(proposalEnvelope(legalRecipePayload()));
    // The raw secret never crossed to the provider port: key-based redaction
    // replaced it and the raw value never appears in the serialized input.
    expect(provider.requests).toHaveLength(1);
    const serialized = provider.requests[0]?.serialized ?? '';
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).toContain('[REDACTED]');
    expect(provider.requests[0]?.observations['cookie']).toBe('[REDACTED]');
  });
});
