/**
 * T012 TEST_MATRIX suite `malicious-proposal-rejection`: table-driven
 * hostile-proposal corpus with one stable identity per attack class. Every
 * rejection is deterministic, names the violated policy/oracle, and never
 * normalizes an invalid proposal into a legal one. The fake provider
 * "endorses" every payload — acceptance authority lives in the policy, not
 * the model.
 *
 * Negative cases covered here (TEST_MATRIX negative_decode_cases):
 * unknown-authoritative-enum-value, unknown-authority-changing-field,
 * scope-expanding-field, navigation-or-auth-grant-field,
 * shell-or-js-execution-field, validation-self-certification-field,
 * embedded-signed-url-as-durable-reusable-rule,
 * non-deterministic-or-imperative-fallback-kind,
 * capability-outside-finite-vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITY_KIND_LIST } from '@xdownload/discovery-recipe';
import { createAiProposalAdapter, evaluateProposal } from '../src/index.ts';
import { deterministicFakeProvider } from './fakeProvider.ts';
import {
  CONTINUATION_CONTRACT,
  CONTRACT_REF,
  CURRENT_PAGE_CONTRACT,
  GAP_REF,
  evaluationContext,
  gapEnvelopeInput,
  legalProposalBytes,
  legalRecipePayload,
  proposalEnvelope,
} from './fixtures.ts';

interface AttackCase {
  readonly caseId: string;
  readonly bytes: unknown;
  readonly contract: typeof CONTINUATION_CONTRACT;
  readonly expectedCode: string;
  readonly expectedInvariant?: string;
}

const ATTACK_CASES: readonly AttackCase[] = [
  {
    caseId: 'unknown-authoritative-enum-value[crawl capability]',
    bytes: proposalEnvelope(
      legalRecipePayload({ allowedCapabilities: ['observe_current_page', 'crawl_all_pages'] }),
    ),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_ENUM_VALUE',
    expectedInvariant: 'ADR-007',
  },
  {
    caseId: 'capability-outside-finite-vocabulary[shell execution]',
    bytes: proposalEnvelope(legalRecipePayload({ allowedCapabilities: ['execute_shell'] })),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_ENUM_VALUE',
    expectedInvariant: 'ADR-007',
  },
  {
    caseId: 'shell-or-js-execution-field[envelope-level script grant]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      executeScript: 'return Array.from(document.querySelectorAll("a"))',
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'unknown-authority-changing-field[payload-level navigation grant]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      navigationGrant: { allowArbitraryNavigation: true },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'navigation-or-auth-grant-field[envelope-level auth grant]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      authorizationGrant: { cookiesExport: true, tokenAccess: true },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'scope-expanding-field[envelope-level scope mutation]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      requestedScope: { kind: 'domain_wide', pattern: '*.example.com', pages: '1..1000' },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'navigation-or-auth-grant-field[active capability beyond contract authority]',
    bytes: proposalEnvelope(
      legalRecipePayload({
        allowedCapabilities: ['observe_current_page', 'follow_declared_collection_continuation'],
      }),
    ),
    contract: CURRENT_PAGE_CONTRACT,
    expectedCode: 'CAPABILITY_NOT_AUTHORIZED',
    expectedInvariant: 'ADR-008',
  },
  {
    caseId: 'navigation-or-auth-grant-field[member detail on scope-less contract]',
    bytes: proposalEnvelope(
      legalRecipePayload({ allowedCapabilities: ['open_confirmed_member_detail'] }),
    ),
    contract: {
      status: 'DRAFT',
      continuationScope: { kind: 'NONE' },
      explorationPermission: 'NONE',
    },
    expectedCode: 'CAPABILITY_NOT_AUTHORIZED',
    expectedInvariant: 'ADR-008',
  },
  {
    caseId: 'validation-self-certification-field[payload ceiling above suggestive]',
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
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'SELF_CERTIFICATION',
    expectedInvariant: 'C34',
  },
  {
    caseId: 'validation-self-certification-field[envelope-level coverage certificate]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      coverageCertificate: { coverage: 'VERIFIED_COMPLETE', certifiedBy: 'model' },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'embedded-signed-url-as-durable-reusable-rule[matcher condition]',
    bytes: proposalEnvelope(
      legalRecipePayload({
        matcher: {
          allOf: [
            {
              field: 'directFileUrl',
              op: 'equals',
              value:
                'https://cdn.example.com/file.zip?Expires=1234&Signature=abc123&Key-Pair-Id=APK',
            },
          ],
        },
      }),
    ),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'RAW_SECRET_FIELD',
    expectedInvariant: 'PRD-§29',
  },
  {
    caseId: 'non-deterministic-or-imperative-fallback-kind',
    bytes: proposalEnvelope(
      legalRecipePayload({
        deterministicFallback: { kind: 'EXECUTE_SCRIPT', description: 'run cleanup script' },
      }),
    ),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_ENUM_VALUE',
  },
  {
    caseId: 'unknown-authority-changing-field[filesystem access attempt]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      filesystemAccess: { paths: ['C:\\**'], mode: 'read-write' },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
  {
    caseId: 'unknown-authority-changing-field[host scan attempt]',
    bytes: proposalEnvelope(legalRecipePayload(), {
      hostScan: { range: '192.168.0.0/24' },
    }),
    contract: CONTINUATION_CONTRACT,
    expectedCode: 'UNKNOWN_FIELD',
  },
];

describe('T012 malicious proposal rejection (TEST_MATRIX malicious-proposal-rejection)', () => {
  it('every attack class rejects deterministically and names the violated policy/oracle', () => {
    for (const attack of ATTACK_CASES) {
      const decision = evaluateProposal(attack.bytes, evaluationContext(), attack.contract);
      expect(decision.ok, attack.caseId).toBe(false);
      if (!decision.ok) {
        expect(
          decision.diagnostics.map((d) => d.code),
          attack.caseId,
        ).toContain(attack.expectedCode);
        if (attack.expectedInvariant !== undefined) {
          expect(
            decision.diagnostics.map((d) => d.invariant),
            attack.caseId,
          ).toContain(attack.expectedInvariant);
        }
      }
      const repeat = evaluateProposal(attack.bytes, evaluationContext(), attack.contract);
      expect(JSON.stringify(repeat), attack.caseId).toBe(JSON.stringify(decision));
    }
  });

  it('every rejection names the violated rule; no invalid proposal is normalized into a legal one', () => {
    for (const attack of ATTACK_CASES) {
      const decision = evaluateProposal(attack.bytes, evaluationContext(), attack.contract);
      expect(decision.ok, attack.caseId).toBe(false);
      if (!decision.ok) {
        for (const diagnostic of decision.diagnostics) {
          expect(diagnostic.code.length, attack.caseId).toBeGreaterThan(0);
          expect(diagnostic.message, attack.caseId).not.toBe('');
          expect(diagnostic.path, attack.caseId).not.toBe('');
        }
      }
    }
  });

  it('rejection is independent of model endorsement: the same hostile bytes reject through the adapter', () => {
    const adapter = createAiProposalAdapter({
      provider: deterministicFakeProvider({
        payload: proposalEnvelope(legalRecipePayload({ allowedCapabilities: ['crawl_all_pages'] })),
      }),
    });
    return adapter
      .proposeRecipe({
        gap: gapEnvelopeInput(),
        expectedGapRef: GAP_REF,
        expectedContractRef: CONTRACT_REF,
        contract: CONTINUATION_CONTRACT,
      })
      .then((path) => {
        expect(path.kind).toBe('PROPOSAL_REJECTED');
        if (path.kind === 'PROPOSAL_REJECTED') {
          expect(path.diagnostics.map((d) => d.code)).toContain('UNKNOWN_ENUM_VALUE');
        }
      });
  });

  it('the capability vocabulary stays finite: proposed capabilities are a subset of CAPABILITY_KIND_LIST', () => {
    const legal = evaluateProposal(
      legalProposalBytes(),
      evaluationContext(),
      CONTINUATION_CONTRACT,
    );
    expect(legal.ok).toBe(true);
    if (legal.ok) {
      for (const capability of legal.value.recipe.allowedCapabilities) {
        expect(CAPABILITY_KIND_LIST.includes(capability)).toBe(true);
      }
    }
  });
});
