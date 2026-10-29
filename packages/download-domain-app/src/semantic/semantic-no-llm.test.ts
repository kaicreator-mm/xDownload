/**
 * v0.2 T05 negative/positive semantic lane tests — the zero-LLM default path
 * is complete and the lane source carries no model/network/wall-clock/
 * randomness/environment surface (node:test, colocated inside the T05 write
 * set).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { FINITE_MEMBERSHIP_BASIS } from './finite-membership.ts';
import { decodeSemanticLaneRequest, runSemanticLaneNoLlm } from './run.ts';

const LANE_DIR = dirname(fileURLToPath(import.meta.url));

function laneRequestFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipe: {
      recipeId: 'recipe:fixture-video',
      matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
    },
    scope: {
      basis: FINITE_MEMBERSHIP_BASIS,
      memberIds: ['member-a', 'member-b', 'member-c'],
      collectionId: 'collection:fixture-1',
    },
    observations: [
      { memberId: 'member-a', facts: { kind: 'video' } },
      { memberId: 'member-b', facts: { kind: 'audio' } },
      { memberId: 'member-c', facts: {} },
    ],
    ...overrides,
  };
}

function decodedRequest(overrides: Record<string, unknown> = {}) {
  const decoded = decodeSemanticLaneRequest(laneRequestFixture(overrides));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) throw new Error('unreachable: fixture lane request refused');
  return decoded.value;
}

describe('zero-LLM default path is complete', () => {
  it('decodes and runs a raw request end-to-end to a selection with no provider anywhere', () => {
    const outcome = runSemanticLaneNoLlm(decodedRequest());
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.outcome, 'SELECTED');
      if (outcome.value.outcome === 'SELECTED') {
        assert.equal(outcome.value.selectedMemberId, 'member-a');
      }
    }
  });

  it('an ambiguous scope routes to confirmation through the same entry point', () => {
    const outcome = runSemanticLaneNoLlm(
      decodedRequest({
        observations: [
          { memberId: 'member-a', facts: { kind: 'video' } },
          { memberId: 'member-b', facts: { kind: 'video' } },
          { memberId: 'member-c', facts: {} },
        ],
      }),
    );
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.outcome, 'REQUIRES_CONFIRMATION');
      if (outcome.value.outcome === 'REQUIRES_CONFIRMATION') {
        assert.equal(outcome.value.reason, 'AMBIGUOUS_TIE');
        assert.ok(outcome.value.confirmation.requests.length >= 1);
      }
    }
  });

  it('the lane request surface is exact-key: no advisory or provider field can ride in', () => {
    const widened = decodeSemanticLaneRequest(laneRequestFixture({ model: 'paid-model-x' }));
    assert.equal(widened.ok, false);
    if (!widened.ok) {
      assert.equal(widened.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
      assert.match(widened.diagnostics[0]?.message ?? '', /model/);
    }
  });

  it('the default entry takes pure data only — no callable can be injected into it', () => {
    const request = decodedRequest();
    for (const value of Object.values(request)) {
      assert.notEqual(typeof value, 'function');
    }
    assert.equal(runSemanticLaneNoLlm.length, 1);
  });
});

describe('lane source purity — no model, network, wall-clock, randomness or environment reads', () => {
  const FORBIDDEN_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
    { name: 'dynamic import', pattern: /\bimport\s*\(/ },
    { name: 'fetch call', pattern: /\bfetch\s*\(/ },
    { name: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
    { name: 'WebSocket', pattern: /WebSocket/ },
    { name: 'wall-clock read', pattern: /Date\s*\.\s*now|new\s+Date\s*\(|performance\s*\.\s*now/ },
    {
      name: 'randomness',
      pattern: /Math\s*\.\s*random|crypto\s*\.\s*(getRandomValues|randomUUID)/,
    },
    { name: 'environment read', pattern: /process\s*\.\s*env/ },
    { name: 'node builtins import', pattern: /from\s+'node:/ },
    { name: 'require call', pattern: /(^|\s)require\s*\(/ },
  ];

  it('no lane implementation source contains a forbidden surface token', () => {
    const files = readdirSync(LANE_DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    assert.ok(
      files.length >= 6,
      `expected the lane implementation files, found: ${files.join(', ')}`,
    );
    for (const file of files) {
      const source = readFileSync(join(LANE_DIR, file), 'utf8');
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        assert.equal(
          pattern.test(source),
          false,
          `${file} must not contain a ${name} surface (zero-LLM, side-effect-free lane)`,
        );
      }
    }
  });
});
