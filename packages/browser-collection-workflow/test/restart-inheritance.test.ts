/**
 * REVIEW_CHECKLIST §5.6 composed exercise (review P2-3 repair): a core-runtime
 * restart via `reopenCoreRuntime` inherits the in-flight lineage's durable
 * truth through the composed workflow —
 *
 * - the reopened runtime classifies the pre-restart work item ACCEPTED with
 *   verified bytes (recovered durable truth, no re-execution);
 * - remaining budgets are inherited unchanged (never reset or replenished);
 * - the workflow continues on the reopened runtime: a new frozen flow
 *   acquires through the SAME durable budget ledger, and the pre-restart
 *   lineage stays untouched (no re-enumeration, no new membership).
 *
 * Fixture/observation-feed level; canonical vocabulary only.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import { reopenCoreRuntime } from '@xdownload/core-runtime';
import type { DiscoveryEvent } from '@xdownload/discovery-recipe';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
  runtimeOptions,
} from '../../core-runtime/test/helpers.ts';
import type { MemberDelivery } from '../src/index.ts';
import { runCollectionFlow } from '../src/index.ts';
import {
  budgetsOpen,
  currentPageContract,
  injectedConfirmationSource,
  payload as fixturePayload,
  sha256,
  snapshotFor,
} from './fixtures.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const FIRST = 'member-restart-001';
const SECOND = 'member-restart-002';

function seedFor(memberId: string): number {
  let seed = 23;
  for (const char of memberId) {
    seed = (seed * 31 + char.charCodeAt(0)) % 251;
  }
  return seed;
}

async function startFixture(): Promise<string> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const memberId of [FIRST, SECOND]) {
    fixture.serveFile(`/${memberId}.bin`, {
      body: fixturePayload(256, seedFor(memberId)),
      etag: `restart-${memberId}`,
    });
  }
  return baseUri;
}

function deliveryFor(baseUri: string): (memberId: string) => MemberDelivery {
  return (memberId: string) => {
    const bytes = fixturePayload(256, seedFor(memberId));
    return {
      kind: 'direct',
      targetId: memberId,
      artifactId: `artifact:${memberId}`,
      locator: { kind: 'direct', uri: `${baseUri}/${memberId}.bin` },
      provenance: {
        binding: 'SELECTED_RESOURCE_PROVENANCE',
        originLocatorUri: `${baseUri}/${memberId}.bin`,
      },
      declaredRedirectHosts: [new URL(baseUri).host],
      expectedSha256: sha256(bytes),
    };
  };
}

function frozen(memberId: string): DiscoveryEvent {
  return { kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' };
}

describe('T016 restart inheritance through the composed workflow', () => {
  it('inherits durable truth across reopenCoreRuntime: recovery classification, remaining budgets, continued acquisition, no re-enumeration', async () => {
    const baseUri = await startFixture();
    // Two distinct frozen identities: the pre-restart flow (FIRST) and the
    // post-restart continuation flow (SECOND) with fresh contract/snapshot
    // identity — restart never mints or mutates membership.
    const firstContract = currentPageContract({ contractId: 'contract-s5-restart-a' });
    const firstSnapshot = snapshotFor(firstContract, [FIRST]);
    const secondContract = currentPageContract({ contractId: 'contract-s5-restart-b' });
    const secondSnapshot = snapshotFor(secondContract, [SECOND]);

    const rootDir = makeTempDir('t016-restart-inheritance');
    dirs.push(rootDir);
    const firstRuntime = openRuntime(rootDir);
    let firstWorkItemId = '';
    let firstLineageKey = '';
    let remainingBefore:
      Awaited<ReturnType<typeof firstRuntime.scheduler.remainingBudgets>> | undefined;
    try {
      const first = await runCollectionFlow({
        runtime: firstRuntime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract: firstContract,
        snapshot: firstSnapshot,
        events: [frozen(FIRST)],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(baseUri),
        confirmationSource: injectedConfirmationSource(),
        authorization: {
          origin: baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:restart-a',
        },
        recordedAt: '2026-10-04T09:00:00Z',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error('unreachable');
      const firstOutcome = first.result.memberOutcomes[0];
      expect(firstOutcome?.accepted).toBe(true);
      if (firstOutcome?.flow === undefined || !('workItemId' in firstOutcome.flow)) {
        throw new Error('expected a direct flow outcome');
      }
      firstWorkItemId = firstOutcome.flow.workItemId;
      firstLineageKey = firstOutcome.flow.lineageKey;

      // Run 1 consumed transfer budget on the durable ledger.
      remainingBefore = firstRuntime.scheduler.remainingBudgets(firstLineageKey);
      expect(remainingBefore.ok).toBe(true);
      if (remainingBefore.ok) {
        expect(remainingBefore.value.transfer.perLimit['bytes']).toBeLessThan(1_000_000_000);
      }
    } finally {
      closeRuntime(firstRuntime);
    }

    // Restart: reopen derives state ONLY from durable truth.
    const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
    try {
      // The in-flight lineage is inherited as recovered durable truth:
      // ACCEPTED with verified bytes — without re-execution.
      const classification = reopened.recovery.classify(firstWorkItemId);
      expect(classification.lifecycleClass).toBe('ACCEPTED');
      expect(classification.bytesVerified).toBe(true);
      expect(
        reopened.recoveryAtComposition.some(
          (entry) =>
            entry.workItemId === firstWorkItemId &&
            entry.lifecycleClass === 'ACCEPTED' &&
            entry.bytesVerified,
        ),
      ).toBe(true);

      // Remaining budgets are inherited unchanged — never reset/replenished.
      const remainingAfter = reopened.scheduler.remainingBudgets(firstLineageKey);
      expect(remainingAfter).toEqual(remainingBefore);
      expect(remainingAfter.ok).toBe(true);

      // The workflow continues on the reopened runtime: a NEW frozen flow
      // (fresh contract/snapshot identity — restart never mints or mutates
      // membership) acquires through the reopened durable ledger while the
      // pre-restart lineage stays untouched.
      const second = await runCollectionFlow({
        runtime: reopened,
        broker: createAuthBroker(),
        slice: 'S5',
        contract: secondContract,
        snapshot: secondSnapshot,
        events: [frozen(SECOND)],
        budgetSteps: [budgetsOpen],
        deliveryFor: deliveryFor(baseUri),
        confirmationSource: injectedConfirmationSource(),
        authorization: {
          origin: baseUri,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:restart-b',
        },
        recordedAt: '2026-10-04T09:10:00Z',
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error('unreachable');
      expect(second.result.memberOutcomes.map((outcome) => outcome.memberId)).toEqual([SECOND]);
      expect(second.result.memberOutcomes[0]?.accepted).toBe(true);

      // No re-enumeration / no membership mutation: exactly the two frozen
      // work items exist, each bound to its own original frozen member, and
      // the pre-restart lineage stays durably ACCEPTED.
      const workItems = reopened.writer.reader.workItems();
      expect(workItems.map((item) => item.memberId).sort()).toEqual([FIRST, SECOND].sort());
      expect(reopened.recovery.classify(firstWorkItemId).lifecycleClass).toBe('ACCEPTED');
    } finally {
      closeRuntime(reopened);
    }
  });
});
