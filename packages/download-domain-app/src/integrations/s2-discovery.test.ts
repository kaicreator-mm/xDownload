/**
 * v0.2 T12 — S2 discovery/attachment journey tests (node:test, colocated).
 *
 * Real end-to-end over the T11 direct runtime and a real 127.0.0.1 fixture
 * (T11/T04 precedent, zero mocks). The T12 counter-evidence convention: every
 * zero-effect guarantee is proven four ways — fixture-side socket requests,
 * bridge-side counters, and the durable K store (permit/journal docs) — each
 * measured as a DELTA against the baseline captured before the journey, so a
 * claim is never anchored in one component's own bookkeeping.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runS2DiscoveryJourney } from './s2-discovery.ts';
import {
  LocalHttpFixture,
  makeSliceWorkspace,
  type SliceWorkspace,
} from './slice-journey-testkit.ts';

function payload(size: number, seed = 7): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const ALPHA = 'member-alpha';
const BETA = 'member-beta';
const GAMMA = 'member-gamma';

const fixture = new LocalHttpFixture();
let workspace: SliceWorkspace;

interface EffectBaseline {
  readonly requests: number;
  readonly acquireCalls: number;
  readonly journalRows: number;
  readonly permitDocs: number;
}

function baseline(): EffectBaseline {
  return {
    requests: fixture.totalRequests,
    acquireCalls: workspace.runtime.bridge.counters.acquireCalls,
    journalRows: workspace.runtime.store.journalRows().length,
    permitDocs: workspace.runtime.store.permitDocs().length,
  };
}

function assertZeroEffectsSince(before0: EffectBaseline): void {
  assert.equal(fixture.totalRequests - before0.requests, 0, 'no socket request may exist');
  assert.equal(
    workspace.runtime.bridge.counters.acquireCalls - before0.acquireCalls,
    0,
    'no bridge dispatch may exist',
  );
  assert.equal(
    workspace.runtime.store.journalRows().length - before0.journalRows,
    0,
    'no journal row may exist',
  );
  assert.equal(
    workspace.runtime.store.permitDocs().length - before0.permitDocs,
    0,
    'no K permit may exist',
  );
}

before(async () => {
  await fixture.start();
  workspace = await makeSliceWorkspace('s2', fixture, [
    { handle: 'ref:s2/alpha', path: '/alpha.bin' },
    { handle: 'ref:s2/beta', path: '/beta.bin' },
    { handle: 'ref:s2/gamma', path: '/gamma.bin' },
  ]);
});

after(async () => {
  await workspace.dispose();
  await fixture.stop();
});

function semantic(kindByMember: Record<string, string>) {
  return {
    recipe: {
      recipeId: 'recipe:s2-video',
      matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
    },
    scope: { basis: 'DECLARED_FINITE_SET', memberIds: [ALPHA, BETA, GAMMA] },
    observations: [ALPHA, BETA, GAMMA].map((memberId) => ({
      memberId,
      facts: { kind: kindByMember[memberId] ?? '' },
    })),
  };
}

function confirmationFor(memberId: string, requestId: string, body: Buffer = payload(2048, 11)) {
  return {
    confirmedMemberId: memberId,
    requestId,
    lineageId: 'lineage-s2',
    targetRef: 'ref:s2/alpha',
    outputRootScope: workspace.outputRoot,
    // Required by the sealed composition's full-field-set policy projection.
    digestAnchor: sha256(body),
    declaredBytes: body.byteLength,
    caller: { actor: 'zcode:xd-v02-t12-builder-agent', sessionRef: 'session:t12-s2-test' },
  };
}

describe('S2 — unique deterministic attachment completes under K', () => {
  it('selects the single full match, submits one confirmed intent, materializes digest-backed bytes', async () => {
    const body = payload(2048, 11);
    fixture.serveBytes('/alpha.bin', body);
    const before0 = baseline();

    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'video', [BETA]: 'audio', [GAMMA]: 'image' }),
      confirmation: confirmationFor(ALPHA, 's2-alpha'),
    });
    assert.equal(outcome.status, 'completed');
    if (outcome.status !== 'completed') return;
    assert.equal(outcome.selectedMemberId, ALPHA);
    assert.equal(outcome.evidence.fileSha256, sha256(body));
    assert.equal(outcome.evidence.stopReason, 'COMPLETED');
    assert.equal(outcome.confirmed.slice, 'S1');
    assert.equal(outcome.confirmed.allowedOperation, 'acquisition.acquire');
    assert.equal(outcome.permitEffectId.length > 0, true);

    // Real bytes on disk; exactly one socket request, one permit, one journal.
    const artifactPath = join(workspace.outputRoot, 's2-alpha.bin');
    assert.ok(existsSync(artifactPath));
    assert.equal(sha256(readFileSync(artifactPath)), sha256(body));
    assert.equal(fixture.requestCount('/alpha.bin'), 1);
    assert.equal(workspace.runtime.store.permitDocs().length - before0.permitDocs, 1);
    assert.equal(workspace.runtime.store.journalRows().length - before0.journalRows, 1);
    assert.equal(workspace.runtime.bridge.counters.acquireCalls - before0.acquireCalls, 1);
  });
});

describe('S2 — ambiguity routes to confirmation with zero effects', () => {
  it('returns the T05 AMBIGUOUS_TIE plan (one MATERIAL_ITEM per tied member) and never submits', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'video', [BETA]: 'video', [GAMMA]: 'image' }),
      confirmation: confirmationFor(ALPHA, 's2-tie'),
    });
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'AMBIGUOUS_TIE');
    assert.equal(outcome.plan.perItemInterrogationUsed, false);
    assert.deepEqual(
      outcome.plan.requests
        .map((request) => (request.level === 'MATERIAL_ITEM' ? request.memberRef : '?'))
        .sort(),
      [ALPHA, BETA],
    );
    assertZeroEffectsSince(before0);
  });

  it('returns INSUFFICIENT_EVIDENCE (MANUAL_SELECTION_UI) when nothing matches', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'audio', [BETA]: 'audio', [GAMMA]: 'image' }),
    });
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual(outcome.plan.requests, [
      {
        level: 'MANUAL_SELECTION_UI',
        candidateRefs: [ALPHA, BETA, GAMMA],
      },
    ]);
    assert.equal(outcome.plan.escalationReason, 'INSUFFICIENT_DECISIVE_EVIDENCE');
    assertZeroEffectsSince(before0);
  });
});

describe('S2 — decided selection awaits ratification; a foreign confirmation refuses', () => {
  it('stops at awaiting-confirmation (MATERIAL_ITEM plan) when no facts are given', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'video', [BETA]: 'audio', [GAMMA]: 'image' }),
    });
    assert.equal(outcome.status, 'awaiting-confirmation');
    if (outcome.status !== 'awaiting-confirmation') return;
    assert.equal(outcome.selectedMemberId, ALPHA);
    assert.deepEqual(outcome.plan.requests, [{ level: 'MATERIAL_ITEM', memberRef: ALPHA }]);
    assertZeroEffectsSince(before0);
  });

  it('refuses a confirmation naming a member the lane did not select', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'video', [BETA]: 'audio', [GAMMA]: 'image' }),
      confirmation: confirmationFor(BETA, 's2-overselect'),
    });
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'CONFIRMATION_MEMBER_MISMATCH');
    assertZeroEffectsSince(before0);
  });
});

describe('S2 — malformed declared inputs refuse with zero effects', () => {
  it('refuses observations outside the declared finite scope (T05 MEMBERSHIP_DRIFT)', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: {
        recipe: {
          recipeId: 'recipe:s2-drift',
          matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
        },
        scope: { basis: 'DECLARED_FINITE_SET', memberIds: [ALPHA] },
        observations: [
          { memberId: ALPHA, facts: { kind: 'video' } },
          { memberId: GAMMA, facts: { kind: 'video' } },
        ],
      },
      confirmation: confirmationFor(ALPHA, 's2-drift'),
    });
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'SEMANTIC_EVALUATION_REFUSED');
    assert.ok(outcome.message.includes('MEMBERSHIP_DRIFT'));
    assertZeroEffectsSince(before0);
  });

  it('refuses a locator-shaped download fact before any send (T01/T08 discipline)', async () => {
    const before0 = baseline();
    const outcome = await runS2DiscoveryJourney(workspace.runtime, {
      semantic: semantic({ [ALPHA]: 'video', [BETA]: 'audio', [GAMMA]: 'image' }),
      confirmation: {
        ...confirmationFor(ALPHA, 's2-locator'),
        targetRef: 'https://evil.example/alpha.bin',
      },
    });
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'INTENT_CANDIDATE_INVALID');
    assert.ok(outcome.message.includes('LOCATOR_SUBSTITUTION_REJECTED'));
    assertZeroEffectsSince(before0);
  });
});
