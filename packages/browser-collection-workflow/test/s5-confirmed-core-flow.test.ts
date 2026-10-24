import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import type { AcquisitionContract } from '@xdownload/domain-contracts';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import {
  runConfirmedCurrentPageGroup,
  validateConfirmedPageGroup,
} from '../src/s5-confirmed-group.ts';
import type { MemberDelivery } from '../src/collection-flow.ts';
import { budgetsOpen, currentPageContract, payload, sha256, snapshotFor } from './fixtures.ts';

const members = ['member-page-001', 'member-page-002'] as const;
const fixtures: ControlledHttpFixture[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.stop();
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

async function environment() {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const origin = await fixture.start();
  for (const memberId of members) {
    fixture.serveFile('/' + memberId + '.bin', {
      body: payload(256, memberId === members[0] ? 17 : 19),
      etag: 's5-confirmed-' + memberId,
    });
  }
  const base = currentPageContract();
  const snapshot = snapshotFor(base, members);
  const contract = {
    ...base,
    selectionSnapshotRef: snapshot.snapshotId,
  } as AcquisitionContract;
  const root = makeTempDir('s5-confirmed-core-member-flow');
  dirs.push(root);
  const runtime = openRuntime(root);
  return {
    fixture,
    origin,
    contract,
    snapshot,
    runtime,
    input: {
      runtime,
      broker: createAuthBroker(),
      contract,
      snapshot,
      events: [
        ...members.map((memberId) => ({
          kind: 'MEMBER_OBSERVED' as const,
          memberId,
          basis: 'FROZEN_BASIS' as const,
        })),
        { kind: 'COLLECTION_ENUMERATION_CLOSED' as const },
      ],
      budgetSteps: [budgetsOpen],
      deliveryFor: (memberId: string): MemberDelivery => {
        const bytes = payload(256, memberId === members[0] ? 17 : 19);
        const uri = origin + '/' + memberId + '.bin';
        return {
          kind: 'direct',
          targetId: memberId,
          artifactId: 'artifact:' + memberId,
          locator: { kind: 'direct', uri },
          provenance: { binding: 'SELECTED_RESOURCE_PROVENANCE', originLocatorUri: uri },
          declaredRedirectHosts: [new URL(origin).host],
          expectedSha256: sha256(bytes),
        };
      },
      authorization: {
        origin,
        provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
        ttlMs: 60_000,
        issueDecisionToken: 'user-confirm:s5-core-confirmed',
      },
      recordedAt: '2026-10-24T04:00:00Z',
    },
  };
}

describe('#151 S5 already-Core-confirmed snapshot -> real member effects', () => {
  it('drives real HTTP bytes through existing Core durable member acquisition and truthful coverage', async () => {
    const ctx = await environment();
    try {
      const admitted = validateConfirmedPageGroup(ctx.contract, ctx.snapshot);
      expect(admitted.ok).toBe(true);
      const result = await runConfirmedCurrentPageGroup(ctx.input);
      if (!result.ok) throw new Error(JSON.stringify(result.rejection));
      expect(result.result.memberOutcomes.map((member) => member.memberId)).toEqual(members);
      expect(result.result.memberOutcomes.every((member) => member.accepted)).toBe(true);
      expect(ctx.runtime.writer.reader.workItems()).toHaveLength(members.length);
      expect(result.result.accounting?.counts.requested).toBe(members.length);
      expect(result.result.terminalResult?.coverage).toBe('VERIFIED_COMPLETE');
      // This is replay of an already confirmed Core claim, NOT new observed
      // USER_CONFIRMATION provenance or independent human study evidence.
      expect(result.result.confirmationOrigin).toBe('INJECTED_SOURCE');
    } finally {
      closeRuntime(ctx.runtime);
    }
  });

  it('refuses incomplete discovery against confirmed group before any Core effect', async () => {
    const ctx = await environment();
    try {
      const result = await runConfirmedCurrentPageGroup({
        ...ctx.input,
        events: [ctx.input.events[0]!],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected refuse');
      expect(result.rejection.stage).toBe('CONFIRMATION_REQUIRED');
      expect(ctx.runtime.writer.reader.workItems()).toHaveLength(0);
    } finally {
      closeRuntime(ctx.runtime);
    }
  });

  it('denies unconfirmed status or a new caller-provided confirmation source', async () => {
    const ctx = await environment();
    try {
      expect(
        validateConfirmedPageGroup(
          { ...ctx.contract, status: 'DRAFT' } as unknown as AcquisitionContract,
          ctx.snapshot,
        ).ok,
      ).toBe(false);
      const result = await runConfirmedCurrentPageGroup({
        ...ctx.input,
        confirmationSource: {
          resolve: () => ({
            kind: 'RESOLVED',
            origin: 'USER',
            outcomes: ['CONFIRMED', 'CONFIRMED'],
          }),
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('must refuse second confirmation source');
      expect(result.rejection.stage).toBe('MEMBERSHIP_IDENTITY');
      expect(ctx.runtime.writer.reader.workItems()).toHaveLength(0);
    } finally {
      closeRuntime(ctx.runtime);
    }
  });
});
