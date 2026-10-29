/**
 * TEST_MATRIX suite `auth-expiry-and-inaccessible-members` (+ C10, C24;
 * negatives expired-capability-silently-extended-or-reused,
 * capability-binding-field-substitution-passing-use).
 *
 * Must prove (fixture/observation-feed level):
 * - scoped capability expiry surfaces truthfully (capabilityStatus) — expired
 *   authorization yields AUTH_REQUIRED-influenced truthful partials, never
 *   silent success or silent re-authorization (C24 shape at flow level);
 * - an authorization-limited whole-collection flow acquiring only the
 *   accessible subset yields the exact PARTIAL tuple with requested scope
 *   unchanged and inaccessible members named, not dropped (C10);
 * - capability binding mismatch (origin/target/contract/snapshot/provenance/
 *   partition/scope) is rejected via bindingsExactMatch/bindingMismatchField
 *   semantics through the composed adapter;
 * - only an opaque AuthorizationContextRef crosses the flow; no raw reusable
 *   secret enters glue, fixtures or logs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  bindingMismatchField,
  createAuthBroker,
  type CapabilityBinding,
  type Clock,
} from '@xdownload/browser-auth-broker';
import type { DiscoveryEvent } from '@xdownload/discovery-recipe';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
} from '../../core-runtime/test/helpers.ts';
import {
  capabilityBindingFor,
  inspectCapability,
  issueScopedCapability,
  useScopedCapability,
} from '../src/auth-lifecycle.ts';
import { runCollectionFlow } from '../src/index.ts';
import {
  budgetsOpen,
  currentPageContract,
  injectedConfirmationSource,
  independentEvidence,
  seedBytes,
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

const EIGHTEEN = Array.from(
  { length: 18 },
  (_, index) => `g-member-${String(index + 1).padStart(2, '0')}`,
);
const INACCESSIBLE = EIGHTEEN.slice(16); // two known-inaccessible members (C10)

async function startGallery(): Promise<string> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const baseUri = await fixture.start();
  for (const member of EIGHTEEN) {
    fixture.serveFile(`/${member}.bin`, { body: seedBytes(64, member), etag: `g-${member}` });
  }
  return baseUri;
}

describe('T016 auth-expiry-and-inaccessible-members', () => {
  it('projects the exact C10 PARTIAL tuple: accessible subset acquired, inaccessible named, scope unchanged', async () => {
    const served = await startGallery();
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, EIGHTEEN);

    const rootDir = makeTempDir('t016-c10');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      const events: DiscoveryEvent[] = [
        ...EIGHTEEN.slice(0, 16).map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        // Independently evidenced auth-inaccessible observations for the two
        // known-inaccessible requested members.
        ...INACCESSIBLE.map(
          (memberId) => ({ kind: 'MEMBER_AUTH_INACCESSIBLE', memberId }) as DiscoveryEvent,
        ),
        // The requested-scope enumeration closed with the two inaccessible
        // members independently accounted.
        { kind: 'COLLECTION_ENUMERATION_CLOSED' },
      ];
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker(),
        slice: 'S5',
        contract,
        snapshot,
        events,
        budgetSteps: [budgetsOpen],
        deliveryFor: (memberId) => ({
          kind: 'direct',
          targetId: memberId,
          artifactId: `artifact:${memberId}`,
          locator: { kind: 'direct', uri: `${served}/${memberId}.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${served}/${memberId}.bin`,
          },
          declaredRedirectHosts: [new URL(served).host],
          expectedSha256: sha256(seedBytes(64, memberId)),
        }),
        inaccessibleEvidenceFor: (memberId) =>
          independentEvidence(`evidence-inaccessible-${memberId}`, {
            kind: 'MEMBER',
            ref: memberId,
          }),
        authorization: {
          origin: served,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 60_000,
          issueDecisionToken: 'user-confirm:c10',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T06:00:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // Exactly the accessible subset was acquired; the inaccessible two were
      // named, not dropped, and the requested scope still holds all 18.
      expect(result.memberOutcomes.length).toBe(16);
      expect(result.requestedMemberIds.length).toBe(18);
      expect(result.accounting?.counts.authInaccessible).toBe(2);
      expect(result.accounting?.authInaccessible.map((m) => m.memberId).sort()).toEqual(
        [...INACCESSIBLE].sort(),
      );
      expect(result.accounting?.authInaccessible.every((m) => m.independentlyAccounted)).toBe(true);

      // The exact C10 tuple: PARTIAL / RESOLVED / COMPLETE / VERIFIED_COMPLETE
      // / AUTH_REQUIRED — never a narrowed COMPLETE.
      const terminal = result.terminalResult;
      expect(terminal?.requestFulfillment).toBe('PARTIAL');
      expect(terminal?.targetResolution).toBe('RESOLVED');
      expect(terminal?.selectionAcquisition).toBe('COMPLETE');
      expect(terminal?.coverage).toBe('VERIFIED_COMPLETE');
      expect(terminal?.stopReason).toBe('AUTH_REQUIRED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('projects the exact C24 tuple when authorization blocks every member before any resolution', async () => {
    const served = await startGallery();
    const contract = currentPageContract();
    const snapshot = snapshotFor(contract, EIGHTEEN.slice(0, 2));

    const rootDir = makeTempDir('t016-c24');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      // A monotonic 1ms-per-call clock with the least positive TTL: every
      // composed `use` lands at/after its capability's expiry, so every use
      // truthfully yields AUTH_REQUIRED (issue always precedes its use).
      let call = 0;
      const clock: Clock = {
        nowMs: () => {
          call += 1;
          return call;
        },
      };
      const outcome = await runCollectionFlow({
        runtime,
        broker: createAuthBroker({ clock }),
        slice: 'S5',
        contract,
        snapshot,
        events: EIGHTEEN.slice(0, 2).map(
          (memberId) =>
            ({ kind: 'MEMBER_OBSERVED', memberId, basis: 'FROZEN_BASIS' }) as DiscoveryEvent,
        ),
        budgetSteps: [budgetsOpen],
        deliveryFor: (memberId) => ({
          kind: 'direct',
          targetId: memberId,
          artifactId: `artifact:${memberId}`,
          locator: { kind: 'direct', uri: `${served}/${memberId}.bin` },
          provenance: {
            binding: 'SELECTED_RESOURCE_PROVENANCE',
            originLocatorUri: `${served}/${memberId}.bin`,
          },
          declaredRedirectHosts: [new URL(served).host],
          expectedSha256: sha256(seedBytes(64, memberId)),
        }),
        authorization: {
          origin: served,
          provenanceChain: 'tab-7/frame-0/http://127.0.0.1:9/-/-',
          ttlMs: 1,
          issueDecisionToken: 'user-confirm:c24',
        },
        confirmationSource: injectedConfirmationSource(),
        recordedAt: '2026-10-04T06:10:00Z',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const result = outcome.result;

      // Every member was truthfully denied; nothing was silently skipped.
      expect(result.memberOutcomes.length).toBe(2);
      expect(result.memberOutcomes.every((m) => m.kind === 'AUTH_DENIED')).toBe(true);
      expect(result.memberOutcomes.every((m) => m.auth?.outcome === 'AUTH_REQUIRED')).toBe(true);
      expect(runtime.writer.reader.workItems().length).toBe(0);

      // The exact C24 tuple: UNSATISFIED / BLOCKED / NOT_STARTED / UNKNOWN /
      // AUTH_REQUIRED — never a fallback acquisition.
      expect(result.terminalSource).toBe('AUTH_LIMITED_PROJECTION');
      expect(result.terminalResult?.requestFulfillment).toBe('UNSATISFIED');
      expect(result.terminalResult?.targetResolution).toBe('BLOCKED');
      expect(result.terminalResult?.selectionAcquisition).toBe('NOT_STARTED');
      expect(result.terminalResult?.coverage).toBe('UNKNOWN');
      expect(result.terminalResult?.stopReason).toBe('AUTH_REQUIRED');
    } finally {
      closeRuntime(runtime);
    }
  });

  it('surfaces expiry truthfully and never silently extends or re-issues (negative)', () => {
    const contract = currentPageContract();
    const snapshotId = 'snapshot-for-contract-s5-current-page';
    const binding = capabilityBindingFor({
      authorization: {
        origin: 'http://127.0.0.1:4173',
        target: 'target-current-page-root',
        provenanceChain: 'tab-7/frame-0/http://127.0.0.1:4173/-/-',
      },
      contract,
      snapshotId,
    });
    let now = 0;
    const broker = createAuthBroker({ clock: { nowMs: () => now } satisfies Clock });

    const issued = issueScopedCapability(broker, binding, 100, 'user-confirm:expiry-check');
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error('unreachable');
    const ref = issued.value.ref;
    expect(issued.value.status).toBe('ACTIVE');
    expect(useScopedCapability(broker, ref, binding).outcome).toBe('AUTH_GRANTED');

    // Time passes the mandatory expiry: the truthful status projection flips
    // to EXPIRED and later uses are AUTH_REQUIRED (never re-authorized).
    now = 200;
    const expiredView = inspectCapability(broker, ref);
    expect(expiredView.ok).toBe(true);
    if (expiredView.ok) {
      expect(expiredView.value.status).toBe('EXPIRED');
    }
    const denied = useScopedCapability(broker, ref, binding);
    expect(denied.outcome).toBe('AUTH_REQUIRED');
    if (denied.outcome === 'AUTH_REQUIRED') {
      expect(denied.reasons[0]?.code).toBe('CAPABILITY_EXPIRED');
    }
    // Reuse after expiry stays denied (no silent extension).
    expect(useScopedCapability(broker, ref, binding).outcome).toBe('AUTH_REQUIRED');

    // Re-authorization requires an EXPLICIT new decision token: an automatic
    // "renewal" token is rejected by the broker through the lane.
    const silentRenewal = issueScopedCapability(broker, binding, 100, 'auto-renew-attempt');
    expect(silentRenewal.ok).toBe(false);
    if (!silentRenewal.ok) {
      expect(silentRenewal.diagnostics[0]?.code).toBe('ISSUE_DECISION_REQUIRED');
    }
    const explicitReissue = issueScopedCapability(
      broker,
      binding,
      100,
      'explicit-reissue:user-decision-4711',
    );
    expect(explicitReissue.ok).toBe(true);
  });

  it('rejects every single-field binding substitution through the composed adapter (negative)', () => {
    const contract = currentPageContract();
    const snapshotId = 'snapshot-for-contract-s5-current-page';
    const broker = createAuthBroker();
    const bound = capabilityBindingFor({
      authorization: {
        origin: 'http://127.0.0.1:4173',
        target: 'target-current-page-root',
        provenanceChain: 'tab-7/frame-0/http://127.0.0.1:4173/-/-',
        partition: 'partition-a',
      },
      contract,
      snapshotId,
    });
    const issued = issueScopedCapability(broker, bound, 60_000, 'user-confirm:binding-matrix');
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error('unreachable');
    const ref = issued.value.ref;

    const substitutions: readonly (readonly [keyof CapabilityBinding, unknown, string])[] = [
      ['origin', 'https://evil.invalid', 'origin'],
      ['target', 'target-elsewhere', 'target'],
      ['contract', 'contract-other', 'contract'],
      ['snapshot', 'snapshot-other', 'snapshot'],
      ['provenanceChain', 'tab-9/frame-1/https://evil.invalid/-/-', 'provenanceChain'],
      ['partition', 'partition-b', 'partition'],
      ['requestedScopeKey', 'some_other_scope', 'requestedScopeKey'],
    ];
    for (const [field, value, expectedFieldLabel] of substitutions) {
      const claimed: CapabilityBinding = { ...bound, [field]: value } as CapabilityBinding;
      const outcome = useScopedCapability(broker, ref, claimed);
      expect(outcome.outcome).toBe('AUTH_FAILED');
      expect(bindingMismatchField(bound, claimed)).toBe(expectedFieldLabel);
    }
    // The exact tuple still grants (no false tightening either).
    expect(useScopedCapability(broker, ref, bound).outcome).toBe('AUTH_GRANTED');
  });
});
