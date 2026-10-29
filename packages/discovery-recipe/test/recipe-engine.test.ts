/**
 * T011 TEST_MATRIX suite `recipe-schema-and-interpreter` — declarative
 * Recipe data per PRD §23 / L2 §6.6, finite capability vocabulary bounded by
 * PRD §14, fail-closed decode, matcher → capability plan → policy/scope
 * validation pipeline traceable to the confirmed contract.
 */
import { describe, expect, it } from 'vitest';
import { unwrapOrThrow, type EvidenceRecord } from '@xdownload/domain-contracts';
import {
  authorizeCapability,
  decodeCapabilityList,
  decodePlannedCapabilities,
  decodeRecipeDefinition,
  matchRecipe,
  planRecipeExecution,
  recipeEvidenceRecord,
} from '../src/index.ts';
import {
  GALLERY_OBSERVATIONS,
  SCHEMA,
  confirmedCurrentPageContract,
  confirmedPlaylistContract,
  galleryRecipe,
  mid,
} from './fixtures.ts';

describe('recipe decode — declarative data (PRD §23)', () => {
  it('decodes a valid declarative recipe with identity, matcher, capabilities, evidence and fallback', () => {
    const recipe = galleryRecipe();
    expect(recipe.recipeId).toBe('recipe/gallery-v1');
    expect(recipe.schemaIdentity).toEqual(SCHEMA);
    expect(recipe.allowedCapabilities.length).toBe(6);
    expect(recipe.evidenceRules.independenceFromDiscovery).toBe('DISCOVERY_DERIVED');
    expect(recipe.deterministicFallback.kind).toBe('ASK_USER');
    expect(recipe.validationRequirements).toEqual(['membership', 'target']);
  });

  it('fails closed on a capability outside the finite PRD §14 vocabulary', () => {
    const result = decodeRecipeDefinition(
      JSON.parse(
        JSON.stringify({
          ...(galleryRecipe() as unknown as Record<string, unknown>),
          allowedCapabilities: ['observe_current_page', 'run_shell_command'],
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
      expect(result.diagnostics.some((d) => d.invariant === 'ADR-007')).toBe(true);
    }
  });

  it.each([
    ['execute_javascript', 'arbitrary JS'],
    ['export_cookies', 'cookie/token export'],
    ['write_filesystem', 'unrestricted filesystem'],
    ['scan_host_range', 'arbitrary host scanning'],
    ['recursive_crawl', 'recursive navigation'],
    ['general_crawl', 'general site frontier'],
  ])('cannot express %s (%s) as a capability', (capability) => {
    const result = decodeCapabilityList([capability], 'recipe.allowedCapabilities');
    expect(result.ok).toBe(false);
  });

  it('fails closed on an imperative matcher body (no scripting fields)', () => {
    const raw = galleryRecipe() as unknown as Record<string, unknown>;
    const result = decodeRecipeDefinition({
      ...raw,
      matcher: { allOf: [], script: 'return document.querySelectorAll("a")' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_FIELD')).toBe(true);
    }
  });

  it('fails closed when evidence rules claim independence from discovery', () => {
    const raw = galleryRecipe() as unknown as Record<string, unknown>;
    const result = decodeRecipeDefinition({
      ...raw,
      evidenceRules: {
        ...(raw['evidenceRules'] as Record<string, unknown>),
        independenceFromDiscovery: 'INDEPENDENT',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
    }
  });

  it('fails closed when evidence rules claim decisive (oracle-grade) certainty', () => {
    const raw = galleryRecipe() as unknown as Record<string, unknown>;
    const result = decodeRecipeDefinition({
      ...raw,
      evidenceRules: {
        ...(raw['evidenceRules'] as Record<string, unknown>),
        certaintyCeiling: 'DECISIVE',
      },
    });
    expect(result.ok).toBe(false);
  });

  it('fails closed when the fallback acts instead of asking/aborting', () => {
    const raw = galleryRecipe() as unknown as Record<string, unknown>;
    const result = decodeRecipeDefinition({
      ...raw,
      deterministicFallback: {
        kind: 'EXPAND_SCOPE',
        description: 'Crawl more of the site silently',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_ENUM_VALUE')).toBe(true);
    }
  });

  it('rejects raw secret fields in recipe data', () => {
    const raw = galleryRecipe() as unknown as Record<string, unknown>;
    const result = decodeRecipeDefinition({ ...raw, token: 'secret-value' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'RAW_SECRET_FIELD')).toBe(true);
    }
  });
});

describe('deterministic matcher', () => {
  it('matches when all declarative conditions hold', () => {
    const recipe = galleryRecipe();
    const result = matchRecipe(recipe, GALLERY_OBSERVATIONS);
    expect(result.matched).toBe(true);
  });

  it('reports the first failed condition deterministically on mismatch', () => {
    const recipe = galleryRecipe();
    const result = matchRecipe(recipe, { ...GALLERY_OBSERVATIONS, pageKind: 'article' });
    expect(result.matched).toBe(false);
    expect(result.failedCondition?.field).toBe('pageKind');
  });

  it('supports contains/exists operators deterministically', () => {
    const recipe = galleryRecipe({
      matcher: {
        allOf: [
          { field: 'url', op: 'contains', value: '/gallery/' },
          { field: 'memberSelector', op: 'exists' },
        ],
      },
    });
    expect(
      matchRecipe(recipe, { url: 'https://x.test/gallery/1', memberSelector: 'figure' }).matched,
    ).toBe(true);
    expect(
      matchRecipe(recipe, { url: 'https://x.test/article/1', memberSelector: 'figure' }).matched,
    ).toBe(false);
    expect(matchRecipe(recipe, { url: 'https://x.test/gallery/1' }).matched).toBe(false);
  });
});

describe('interpreter pipeline — matcher → capability plan → policy/scope validation', () => {
  it('plans only contract-authorized capabilities, traceable to the confirmed contract', () => {
    const recipe = galleryRecipe();
    const contract = confirmedPlaylistContract(
      {},
      { kind: 'DECLARED_BATCH_COUNT', count: 5 },
      'DECLARED_CONTINUATION_EDGES',
    );
    const plan = planRecipeExecution(recipe, contract, GALLERY_OBSERVATIONS, {
      scopeIdentityKey: 'entire_supported_collection:collection/playlist-042',
      frozenMemberIds: ['member-001'],
    });
    expect(plan.matched).toBe(true);
    expect(plan.trace.contractId).toBe('contract-s6-playlist');
    const capabilityKinds = plan.steps
      .filter((step) => step.kind === 'CAPABILITY')
      .map((step) => (step.kind === 'CAPABILITY' ? step.capability.kind : ''));
    expect(capabilityKinds).toContain('observe_current_page');
    expect(capabilityKinds).toContain('scroll_current_page');
    expect(capabilityKinds).toContain('follow_declared_collection_continuation');
    const validation = plan.steps.find((step) => step.kind === 'POLICY_VALIDATION_REQUIRED');
    expect(validation).toBeDefined();
    if (validation?.kind === 'POLICY_VALIDATION_REQUIRED') {
      expect(validation.layers).toEqual(['membership', 'target']);
    }
  });

  it('never plans scroll/continuation capabilities under continuation_scope=NONE (never implicit scope authority)', () => {
    const recipe = galleryRecipe();
    const contract = confirmedPlaylistContract();
    expect(contract.continuationScope.kind).toBe('NONE');
    const plan = planRecipeExecution(recipe, contract, GALLERY_OBSERVATIONS, {
      scopeIdentityKey: 'entire_supported_collection:collection/playlist-042',
      frozenMemberIds: [],
    });
    const capabilityKinds = plan.steps
      .filter((step) => step.kind === 'CAPABILITY')
      .map((step) => (step.kind === 'CAPABILITY' ? step.capability.kind : ''));
    expect(capabilityKinds).not.toContain('scroll_current_page');
    expect(capabilityKinds).not.toContain('follow_declared_collection_continuation');
    expect(plan.excluded).toContainEqual({
      capability: 'scroll_current_page',
      reason: 'CONTINUATION_SCOPE_NONE',
    });
    expect(plan.excluded).toContainEqual({
      capability: 'follow_declared_collection_continuation',
      reason: 'CONTINUATION_SCOPE_NONE',
    });
  });

  it('excludes navigation capabilities on a DRAFT (unconfirmed) contract', () => {
    const recipe = galleryRecipe();
    const contract = confirmedCurrentPageContract({ status: 'DRAFT', confirmedAt: undefined });
    const plan = planRecipeExecution(recipe, contract, GALLERY_OBSERVATIONS, {
      scopeIdentityKey: 'current_page:collection/current-page-001',
      frozenMemberIds: [],
    });
    expect(plan.steps.every((step) => step.kind !== 'CAPABILITY')).toBe(true);
    expect(plan.excluded.every((entry) => entry.reason === 'NOT_CONFIRMED')).toBe(true);
  });

  it('falls back deterministically (never widens scope) when the recipe no longer matches (C20 replay)', () => {
    const recipe = galleryRecipe();
    const contract = confirmedPlaylistContract();
    const plan = planRecipeExecution(
      recipe,
      contract,
      { pageKind: 'gallery', galleryTemplate: 'gallery-v2-redesigned' },
      {
        scopeIdentityKey: 'entire_supported_collection:collection/playlist-042',
        frozenMemberIds: [],
      },
    );
    expect(plan.matched).toBe(false);
    expect(plan.failedCondition?.field).toBe('galleryTemplate');
    expect(plan.fallback?.kind).toBe('ASK_USER');
    expect(plan.steps).toHaveLength(0);
  });

  it('authorizes capability kinds by contract state exactly', () => {
    const noneContract = confirmedPlaylistContract();
    const declaredContract = confirmedPlaylistContract(
      {},
      { kind: 'DECLARED_NATURAL_END' },
      'DECLARED_CONTINUATION_EDGES',
    );
    expect(authorizeCapability('observe_current_page', noneContract)).toBe(true);
    expect(authorizeCapability('scroll_current_page', noneContract)).toBe(false);
    expect(authorizeCapability('follow_declared_collection_continuation', noneContract)).toBe(
      false,
    );
    expect(authorizeCapability('scroll_current_page', declaredContract)).toBe(true);
    expect(authorizeCapability('follow_declared_collection_continuation', declaredContract)).toBe(
      true,
    );
    // Declared continuation without the matching exploration permission stays unauthorized.
    const missingPermission = confirmedPlaylistContract(
      {},
      { kind: 'DECLARED_NATURAL_END' },
      'COLLECTION_MEMBER_EDGES',
    );
    expect(authorizeCapability('follow_declared_collection_continuation', missingPermission)).toBe(
      false,
    );
  });

  it('member-detail capability entries bind only frozen member identities', () => {
    const ok = decodePlannedCapabilities(
      [{ kind: 'open_confirmed_member_detail', memberId: 'member-001' }],
      ['member-001', 'member-002'],
    );
    expect(ok.ok).toBe(true);
    const rejected = decodePlannedCapabilities(
      [{ kind: 'open_confirmed_member_detail', memberId: 'member-999' }],
      ['member-001', 'member-002'],
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((d) => d.code === 'ADMISSION_REJECTED')).toBe(true);
      expect(rejected.diagnostics.some((d) => d.invariant === 'PRD-§14')).toBe(true);
    }
  });

  it('capability plan entries carrying undeclared parameters fail closed (ADR-007)', () => {
    const rejected = decodePlannedCapabilities(
      [{ kind: 'observe_current_page', js: 'fetch("/api")' }],
      [],
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((d) => d.code === 'MALFORMED_REQUIRED_FIELD')).toBe(true);
      expect(rejected.diagnostics.some((d) => d.invariant === 'ADR-007')).toBe(true);
    }
  });
});

describe('discovery evidence typing (C34 boundary at the recipe seam)', () => {
  it('recipe evidence records are always DISCOVERY_DERIVED and never oracle-grade', () => {
    const recipe = galleryRecipe();
    const record = unwrapOrThrow(
      recipeEvidenceRecord({
        recipe: recipe,
        contractRef: 'contract-s6-playlist',
        claimType: 'MEMBERSHIP',
        claimSubject: { kind: 'MEMBER', ref: mid('member-001') },
        evidenceId: 'evidence-recipe-membership-001',
        sourceIdentity: 'recipe-interpreter:gallery-v1',
      }),
    ) as EvidenceRecord;
    expect(record.independenceFromDiscovery).toBe('DISCOVERY_DERIVED');
    expect(record.certaintyClass).toBe('PROBATIVE');
  });

  it('suggestion-flavored recipe evidence is SUGGESTIVE, never independent truth', () => {
    const recipe = galleryRecipe();
    const record = unwrapOrThrow(
      recipeEvidenceRecord({
        recipe: recipe,
        contractRef: 'contract-s6-playlist',
        claimType: 'RESOURCE_IDENTITY',
        claimSubject: { kind: 'RESOURCE', ref: 'res-001' },
        evidenceId: 'evidence-recipe-suggestion-001',
        sourceIdentity: 'recipe-interpreter:gallery-v1',
        suggestion: true,
      }),
    ) as EvidenceRecord;
    expect(record.sourceType).toBe('UI_SUGGESTION');
    expect(record.certaintyClass).toBe('SUGGESTIVE');
  });

  it('refuses claim types the recipe evidence rules do not declare', () => {
    const recipe = galleryRecipe();
    const result = recipeEvidenceRecord({
      recipe: recipe,
      contractRef: 'contract-s6-playlist',
      claimType: 'QUALITY',
      claimSubject: { kind: 'RESOURCE', ref: 'res-001' },
      evidenceId: 'evidence-recipe-quality-001',
      sourceIdentity: 'recipe-interpreter:gallery-v1',
    });
    expect(result.ok).toBe(false);
  });
});
