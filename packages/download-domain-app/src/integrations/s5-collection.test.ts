/**
 * v0.2 T12 — S5 current-page collection journey tests (node:test, colocated).
 *
 * Real per-member K submissions over the T11 direct runtime and a real
 * 127.0.0.1 fixture (zero mocks). Zero-effect negatives are proven as deltas
 * across fixture socket requests, bridge counters and the durable K store.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runS5CollectionJourney } from './s5-collection.ts';
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

const ONE = 'member-page-1';
const TWO = 'member-page-2';
const THREE = 'member-page-3';

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
  assert.equal(workspace.runtime.bridge.counters.acquireCalls - before0.acquireCalls, 0);
  assert.equal(workspace.runtime.store.journalRows().length - before0.journalRows, 0);
  assert.equal(workspace.runtime.store.permitDocs().length - before0.permitDocs, 0);
}

before(async () => {
  await fixture.start();
  workspace = await makeSliceWorkspace('s5', fixture, [
    { handle: 'ref:s5/one', path: '/one.bin' },
    { handle: 'ref:s5/two', path: '/two.bin' },
    { handle: 'ref:s5/three', path: '/three.bin' },
  ]);
});

after(async () => {
  await workspace.dispose();
  await fixture.stop();
});

function semantic(kindByMember: Record<string, string>) {
  return {
    recipe: {
      recipeId: 'recipe:s5-page-video',
      matcher: { allOf: [{ field: 'kind', op: 'equals', value: 'video' }] },
    },
    scope: {
      basis: 'DECLARED_FINITE_SET',
      memberIds: [ONE, TWO, THREE],
      collectionId: 'collection-s5-page',
    },
    observations: [ONE, TWO, THREE].map((memberId) => ({
      memberId,
      facts: { kind: kindByMember[memberId] ?? '' },
    })),
  };
}

const MATCHED_TWO = { [ONE]: 'video', [TWO]: 'video', [THREE]: 'image' };

// Declared member bodies: the digest anchor/size the facts must declare.
const BODY_ONE = payload(1024, 21);
const BODY_TWO = payload(1024, 22);

function request(overrides?: Partial<Parameters<typeof runS5CollectionJourney>[1]>) {
  return {
    semantic: semantic(MATCHED_TWO),
    lineageId: 'lineage-s5',
    outputRootScope: workspace.outputRoot,
    members: {
      [ONE]: {
        requestId: 's5-one',
        targetRef: 'ref:s5/one',
        digestAnchor: sha256(BODY_ONE),
        declaredBytes: BODY_ONE.byteLength,
      },
      [TWO]: {
        requestId: 's5-two',
        targetRef: 'ref:s5/two',
        digestAnchor: sha256(BODY_TWO),
        declaredBytes: BODY_TWO.byteLength,
      },
      [THREE]: {
        requestId: 's5-three',
        targetRef: 'ref:s5/three',
        digestAnchor: sha256(payload(64, 29)),
        declaredBytes: 64,
      },
    },
    caller: { actor: 'zcode:xd-v02-t12-builder-agent', sessionRef: 'session:t12-s5-test' },
    ...overrides,
  } as Parameters<typeof runS5CollectionJourney>[1];
}

describe('S5 — deterministic matched set collected under K, member by member', () => {
  it('collects exactly the full-match set after one batch confirmation covering it', async () => {
    fixture.serveBytes('/one.bin', BODY_ONE);
    fixture.serveBytes('/two.bin', BODY_TWO);
    const before0 = baseline();

    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [TWO, ONE],
        },
        members: {
          [ONE]: {
            requestId: 's5-one',
            targetRef: 'ref:s5/one',
            digestAnchor: sha256(BODY_ONE),
            declaredBytes: BODY_ONE.byteLength,
          },
          [TWO]: {
            requestId: 's5-two',
            targetRef: 'ref:s5/two',
            digestAnchor: sha256(BODY_TWO),
            declaredBytes: BODY_TWO.byteLength,
          },
        },
      }),
    );
    assert.equal(outcome.status, 'completed-collection');
    if (outcome.status !== 'completed-collection') return;
    assert.deepEqual(outcome.matchedMemberIds, [ONE, TWO]);
    assert.equal(outcome.summary.requested, 2);
    assert.equal(outcome.summary.completed, 2);
    assert.equal(outcome.summary.collectionStatus, 'COMPLETE');

    // Per-member terminal evidence with real bytes; canonical order kept.
    const first = outcome.members[0]!;
    const second = outcome.members[1]!;
    assert.equal(first.memberId, ONE);
    assert.equal(first.outcome.status, 'completed');
    assert.equal(second.outcome.status, 'completed');
    if (first.outcome.status !== 'completed' || second.outcome.status !== 'completed') return;
    assert.equal(first.outcome.evidence.fileSha256, sha256(BODY_ONE));
    assert.equal(second.outcome.evidence.fileSha256, sha256(BODY_TWO));
    assert.ok(existsSync(join(workspace.outputRoot, 's5-one.bin')));
    assert.ok(existsSync(join(workspace.outputRoot, 's5-two.bin')));

    // Exactly one socket request and one K permit per member.
    assert.equal(fixture.requestCount('/one.bin'), 1);
    assert.equal(fixture.requestCount('/two.bin'), 1);
    assert.equal(workspace.runtime.store.permitDocs().length - before0.permitDocs, 2);
    assert.equal(workspace.runtime.store.journalRows().length - before0.journalRows, 2);
  });

  it('reports PARTIAL truthfully when one confirmed member fails, never a complete claim', async () => {
    // All three members match; member THREE points at an unseeded opaque
    // handle, so its submission fails truthfully at the trusted registry.
    const before0 = baseline();
    const allMatch = request({
      semantic: semantic({ [ONE]: 'video', [TWO]: 'video', [THREE]: 'video' }),
      confirmation: {
        kind: 'BATCH',
        confirmationType: 'CONFIRM_SELECTION',
        memberRefs: [ONE, TWO, THREE],
      },
      members: {
        [ONE]: {
          requestId: 's5-part-one',
          targetRef: 'ref:s5/one',
          digestAnchor: sha256(BODY_ONE),
          declaredBytes: BODY_ONE.byteLength,
        },
        [TWO]: {
          requestId: 's5-part-two',
          targetRef: 'ref:s5/two',
          digestAnchor: sha256(BODY_TWO),
          declaredBytes: BODY_TWO.byteLength,
        },
        [THREE]: {
          requestId: 's5-part-three',
          targetRef: 'ref:s5/missing',
          digestAnchor: sha256(payload(64, 29)),
          declaredBytes: 64,
        },
      },
    });
    const outcome = await runS5CollectionJourney(workspace.runtime, allMatch);
    assert.equal(outcome.status, 'completed-collection');
    if (outcome.status !== 'completed-collection') return;
    assert.deepEqual(outcome.matchedMemberIds, [ONE, TWO, THREE]);
    assert.equal(outcome.summary.completed, 2);
    assert.equal(outcome.summary.failed, 1);
    assert.equal(outcome.summary.collectionStatus, 'PARTIAL');
    const failedMember = outcome.members.find((member) => member.memberId === THREE);
    assert.ok(failedMember);
    assert.equal(failedMember.outcome.status, 'failed');
    if (failedMember.outcome.status !== 'failed') return;
    assert.equal(failedMember.outcome.error.code, 'CONTRACT_BINDING_MISMATCH');
    assert.equal(existsSync(join(workspace.outputRoot, 's5-part-three.bin')), false);
    assert.ok(workspace.runtime.store.journalRows().length - before0.journalRows >= 3);
  });
});

describe('S5 — confirmation discipline with zero effects', () => {
  it('re-asks with the BATCH_GROUP plan when no confirmation facts are given', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(workspace.runtime, request());
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'AWAITING_BATCH_CONFIRMATION');
    assert.deepEqual(outcome.plan.requests, [{ level: 'BATCH_GROUP', memberRefs: [ONE, TWO] }]);
    assertZeroEffectsSince(before0);
  });

  it('refuses a batch naming a member outside the matched set (over-selection)', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [ONE, THREE],
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'CONFIRMATION_MEMBER_OUTSIDE_DECIDED_SET');
    assertZeroEffectsSince(before0);
  });

  it('refuses a duplicate batch reference (one batch covers every member exactly once)', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [ONE, ONE, TWO],
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'CONFIRMATION_SET_MISMATCH');
    assertZeroEffectsSince(before0);
  });

  it('refuses delivery facts for an unconfirmed member (latent widening)', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [ONE, TWO],
        },
        members: {
          [ONE]: {
            requestId: 's5-fact-one',
            targetRef: 'ref:s5/one',
            digestAnchor: sha256(BODY_ONE),
            declaredBytes: BODY_ONE.byteLength,
          },
          [TWO]: {
            requestId: 's5-fact-two',
            targetRef: 'ref:s5/two',
            digestAnchor: sha256(BODY_TWO),
            declaredBytes: BODY_TWO.byteLength,
          },
          [THREE]: {
            requestId: 's5-fact-three',
            targetRef: 'ref:s5/three',
            digestAnchor: sha256(payload(64, 29)),
            declaredBytes: 64,
          },
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEMBER_FACTS_OUTSIDE_CONFIRMED_SET');
    assertZeroEffectsSince(before0);
  });

  it('refuses when a confirmed member has no delivery facts (never silently dropped)', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [ONE, TWO],
        },
        members: {
          [ONE]: {
            requestId: 's5-only-one',
            targetRef: 'ref:s5/one',
            digestAnchor: sha256(BODY_ONE),
            declaredBytes: BODY_ONE.byteLength,
          },
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEMBER_FACTS_INCOMPLETE');
    assertZeroEffectsSince(before0);
  });

  it('refuses the whole collection before any submission when one member intent is invalid', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [ONE, TWO],
        },
        members: {
          [ONE]: {
            requestId: 's5-valid-one',
            targetRef: 'ref:s5/one',
            digestAnchor: sha256(BODY_ONE),
            declaredBytes: BODY_ONE.byteLength,
          },
          [TWO]: {
            requestId: 's5-bad-two',
            targetRef: 'ref:s5/two',
            digestAnchor: 'not-a-digest',
            declaredBytes: BODY_TWO.byteLength,
          },
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    // The malformed digest anchor of member TWO refuses the WHOLE journey at
    // the pre-send gate — never a half-submitted collection.
    assert.equal(outcome.code, 'MEMBER_INTENT_INVALID');
    assert.ok(outcome.message.includes('member-page-2'));
    assertZeroEffectsSince(before0);
  });
});

describe('S5 — zero decisive evidence re-asks with MANUAL_SELECTION_UI', () => {
  it('returns INSUFFICIENT_EVIDENCE with zero effects when nothing matches', async () => {
    const before0 = baseline();
    const outcome = await runS5CollectionJourney(
      workspace.runtime,
      request({
        semantic: semantic({ [ONE]: 'audio', [TWO]: 'audio', [THREE]: 'image' }),
      }),
    );
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual(outcome.plan.requests, [
      { level: 'MANUAL_SELECTION_UI', candidateRefs: [ONE, TWO, THREE] },
    ]);
    assertZeroEffectsSince(before0);
  });
});
