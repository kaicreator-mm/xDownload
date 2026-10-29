/**
 * v0.2 T12 — S6 explicit playlist/gallery collection journey tests (node:test,
 * colocated). Real per-member K submissions over the T11 direct runtime and a
 * real 127.0.0.1 fixture (zero mocks); zero-effect negatives proven as deltas
 * across fixture requests, bridge counters and the durable K store.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runS6NavigationJourney } from './s6-navigation.ts';
import {
  type SliceBatchConfirmationFacts,
  type SliceMemberDeliveryFacts,
} from './slice-journey-shared.ts';
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

const EP1 = 'member-episode-1';
const EP2 = 'member-episode-2';

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
  workspace = await makeSliceWorkspace('s6', fixture, [
    { handle: 'ref:s6/ep1', path: '/ep1.bin' },
    { handle: 'ref:s6/ep2', path: '/ep2.bin' },
    { handle: 'ref:s6/ep3', path: '/ep3.bin' },
    { handle: 'ref:s6/ep4', path: '/ep4.bin' },
    { handle: 'ref:s6/ep5', path: '/ep5.bin' },
  ]);
});

after(async () => {
  await workspace.dispose();
  await fixture.stop();
});

/** Five declared episodes: >3 members, so the decided plan is one BATCH_GROUP. */
const PLAYLIST = [EP1, EP2, 'member-episode-3', 'member-episode-4', 'member-episode-5'];

const EPISODE_BODIES = new Map<string, Buffer>(
  [1, 2, 3, 4, 5].map((index) => [`/ep${String(index)}.bin`, payload(512, 30 + index)]),
);

function factsByIndex(count: number, prefix: string) {
  const members: Record<
    string,
    { requestId: string; targetRef: string; digestAnchor: string; declaredBytes: number }
  > = {};
  for (let index = 0; index < count; index += 1) {
    const memberId = PLAYLIST[index]!;
    const body = EPISODE_BODIES.get(`/ep${String(index + 1)}.bin`)!;
    members[memberId] = {
      requestId: `${prefix}-${String(index + 1)}`,
      targetRef: `ref:s6/ep${String(index + 1)}`,
      // Required by the sealed composition's full-field-set policy projection.
      digestAnchor: sha256(body),
      declaredBytes: body.byteLength,
    };
  }
  return members;
}

function request(overrides?: {
  readonly scope?: unknown;
  readonly confirmation?: SliceBatchConfirmationFacts;
  readonly members?: Record<string, SliceMemberDeliveryFacts>;
}) {
  return {
    scope: {
      basis: 'DECLARED_FINITE_SET',
      memberIds: PLAYLIST,
      collectionId: 'collection-s6-playlist',
    },
    lineageId: 'lineage-s6',
    outputRootScope: workspace.outputRoot,
    members: factsByIndex(5, 's6'),
    caller: { actor: 'zcode:xd-v02-t12-builder-agent', sessionRef: 'session:t12-s6-test' },
    ...overrides,
  };
}

describe('S6 — the explicit declared set collected under K, canonical order', () => {
  it('collects exactly the declared set after one full batch confirmation', async () => {
    for (const [path, body] of EPISODE_BODIES) fixture.serveBytes(path, body);
    const before0 = baseline();

    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [...PLAYLIST].reverse(),
        },
      }),
    );
    assert.equal(outcome.status, 'completed-collection');
    if (outcome.status !== 'completed-collection') return;
    assert.deepEqual(outcome.declaredMemberIds, PLAYLIST);
    assert.equal(outcome.summary.requested, 5);
    assert.equal(outcome.summary.completed, 5);
    assert.equal(outcome.summary.collectionStatus, 'COMPLETE');

    // Canonical submission order (declared sets decode canonically sorted).
    assert.deepEqual(
      outcome.members.map((member) => member.memberId),
      PLAYLIST,
    );
    for (const member of outcome.members) {
      assert.equal(member.outcome.status, 'completed');
      if (member.outcome.status !== 'completed') return;
      const episode = Number(member.memberId.slice(-1));
      const expected = EPISODE_BODIES.get(`/ep${String(episode)}.bin`)!;
      assert.equal(member.outcome.evidence.fileSha256, sha256(expected));
      assert.ok(existsSync(join(workspace.outputRoot, `s6-${String(episode)}.bin`)));
      assert.equal(fixture.requestCount(`/ep${String(episode)}.bin`), 1);
    }
    assert.equal(workspace.runtime.store.permitDocs().length - before0.permitDocs, 5);
    assert.equal(workspace.runtime.store.journalRows().length - before0.journalRows, 5);
  });
});

describe('S6 — identity correspondence discipline with zero effects', () => {
  it('re-asks with the BATCH_GROUP plan when no confirmation facts are given', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(workspace.runtime, request());
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'AWAITING_BATCH_CONFIRMATION');
    assert.deepEqual(outcome.plan.requests, [{ level: 'BATCH_GROUP', memberRefs: [...PLAYLIST] }]);
    assert.deepEqual(outcome.declaredMemberIds, [...PLAYLIST]);
    assertZeroEffectsSince(before0);
  });

  it('refuses a batch naming a member outside the declared set (a confirmation can never add members)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [...PLAYLIST, 'member-episode-6-foreign'],
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'CONFIRMATION_MEMBER_OUTSIDE_DECLARED_SCOPE');
    assert.ok(outcome.message.includes('member-episode-6-foreign'));
    assertZeroEffectsSince(before0);
  });

  it('re-asks with the full-set plan on a strict subset batch (never partial promotion)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [EP1, EP2],
        },
      }),
    );
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.equal(outcome.reason, 'INCOMPLETE_BATCH');
    assert.deepEqual(outcome.plan.requests, [{ level: 'BATCH_GROUP', memberRefs: [...PLAYLIST] }]);
    assertZeroEffectsSince(before0);
  });

  it('refuses a duplicate batch reference (every member exactly once)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: [EP1, EP1, EP2, 'member-episode-3', 'member-episode-4', 'member-episode-5'],
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'CONFIRMATION_SET_MISMATCH');
    assertZeroEffectsSince(before0);
  });

  it('refuses delivery facts for an undeclared member (latent widening)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        confirmation: {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: PLAYLIST,
        },
        members: {
          ...factsByIndex(5, 's6f'),
          'member-undeclared-x': {
            requestId: 's6-undeclared',
            targetRef: 'ref:s6/ep1',
            digestAnchor: 'a'.repeat(64),
            declaredBytes: 64,
          },
        },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'MEMBER_FACTS_OUTSIDE_DECLARED_SET');
    assertZeroEffectsSince(before0);
  });
});

describe('S6 — the declared scope grammar refuses with zero effects', () => {
  it('refuses duplicate declared members (membership drift)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        scope: { basis: 'DECLARED_FINITE_SET', memberIds: [EP1, EP1] },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'DECLARED_SCOPE_INVALID');
    assert.ok(outcome.message.includes('MEMBERSHIP_DRIFT'));
    assertZeroEffectsSince(before0);
  });

  it('refuses an empty declared set (empty is not success)', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        scope: { basis: 'DECLARED_FINITE_SET', memberIds: [] },
      }),
    );
    assert.equal(outcome.status, 'refused');
    if (outcome.status !== 'refused') return;
    assert.equal(outcome.code, 'DECLARED_SCOPE_INVALID');
    assert.ok(outcome.message.includes('EMPTY_SET_NOT_SUCCESS'));
    assertZeroEffectsSince(before0);
  });
});

describe('S6 — two-member explicit set uses per-member MATERIAL_ITEM asks', () => {
  it('returns one MATERIAL_ITEM confirmation per declared member for a small set', async () => {
    const before0 = baseline();
    const outcome = await runS6NavigationJourney(
      workspace.runtime,
      request({
        scope: {
          basis: 'DECLARED_FINITE_SET',
          memberIds: [EP1, EP2],
          collectionId: 'collection-s6-small',
        },
        members: factsByIndex(2, 's6small'),
      }),
    );
    assert.equal(outcome.status, 'needs-confirmation');
    if (outcome.status !== 'needs-confirmation') return;
    assert.deepEqual(outcome.plan.requests, [
      { level: 'MATERIAL_ITEM', memberRef: EP1 },
      { level: 'MATERIAL_ITEM', memberRef: EP2 },
    ]);
    assertZeroEffectsSince(before0);
  });
});
