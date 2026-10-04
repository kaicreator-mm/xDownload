/**
 * TEST_MATRIX applicable counterexample-oracle surface renderings (Frozen PRD
 * §35): C02, C05, C10, C12, C13, C14, C15, C16, C17, C23, C24, C26, C27,
 * C32 — at CLI rendering/routing level, without re-deriving Core truth. The
 * harness drives the Core lanes through the seam; the CLI renders exactly
 * what the projection carries.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  harnessClient,
  projectTerminal,
  rawCommand,
  runCli,
  setupContract,
  setupSnapshot,
  singleResourceContract,
  snapshotPayload,
  startSeam,
  terminalPayload,
  type RunningSeam,
} from './helpers.ts';

function ids(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`,
  );
}

describe('C02 — requested-150-safety-cap-stops-100', () => {
  it('renders the PARTIAL/TRUNCATED tuple verbatim; exit never upgrades cap-exhaustion to success', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    const selected = ids('member', 100);
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c02-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c02-root',
        collectionIdentity: 'collection/c02',
        membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/c02',
        },
        explorationPermission: 'COLLECTION_MEMBER_EDGES',
      }),
    });
    await setupSnapshot(
      client,
      'contract-c02-001',
      1,
      snapshotPayload(
        {
          contractId: 'contract-c02-001',
          requestedScope: {
            kind: 'entire_supported_collection',
            collectionIdentity: 'collection/c02',
          },
        },
        selected,
      ),
    );
    await projectTerminal(
      client,
      'contract-c02-001',
      2,
      terminalPayload({
        contractId: 'contract-c02-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
        stopReason: 'GLOBAL_SAFETY_LIMIT',
        passedCount: 100,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: selected.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'MAX_ITEMS_REACHED' },
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c02-001', '--timeout-ms', '1000', '--poll-ms', '20'],
      seam.target,
    );
    const json = run.json as Record<string, unknown>;
    expect(json['RequestFulfillmentStatus']).toBe('PARTIAL');
    expect(json['CoverageStatus']).toBe('TRUNCATED');
    expect(json['StopReason']).toBe('GLOBAL_SAFETY_LIMIT');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['validated_success_count']).toBe(100);
    // Cap exhaustion is never success.
    expect(run.exitCode).toBe(4);
  });
});

describe('C05 — user-selects-five-before-confirmation-all-five-succeed', () => {
  const requested = ids('c05-member', 8);
  const selected = requested.slice(0, 5);

  function c05Contract(): Record<string, unknown> {
    return singleResourceContract({
      contractId: 'contract-c05-001',
      intentType: 'COLLECTION',
      requestedTarget: 'target-c05-root',
      collectionIdentity: 'collection/c05',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: {
        kind: 'selected_collection_members',
        collectionIdentity: 'collection/c05',
        memberIds: requested,
      },
      automationMode: 'MANUAL_SELECTION',
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
      explorationPermission: 'NONE',
    });
  }

  function c05Snapshot(): Record<string, unknown> {
    return snapshotPayload(
      {
        contractId: 'contract-c05-001',
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/c05',
          memberIds: requested,
        },
        requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: requested },
      },
      selected,
    );
  }

  it('pre-confirmation submit surfaces bounded NEEDS_USER_ACTION; post-confirmation result renders the exact Core tuple', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([['contract.json', JSON.stringify(c05Contract())]]);
    const submit = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-c05-1'],
      seam.target,
      { files },
    );
    expect(submit.exitCode).toBe(3);
    // The non-wait submit returns the acceptance document carrying the
    // bounded needs_user_action state (PRD §27 acceptance separation).
    expect((submit.json as Record<string, unknown>)['document']).toBe('xdownload.cli.acceptance');
    expect((submit.json as Record<string, unknown>)['needs_user_action']).toBe(true);
    expect((submit.json as Record<string, unknown>)['required_action']).toBe('CONFIRM_SNAPSHOT');
    // The user confirms exactly five members through the CLI confirm command.
    const snapshot = new Map([['snapshot.json', JSON.stringify(c05Snapshot())]]);
    const confirm = await runCli(
      [
        'confirm',
        '--contract',
        'contract-c05-001',
        '--expected-revision',
        '1',
        '--file',
        'snapshot.json',
        '--request-id',
        'req-c05-2',
      ],
      seam.target,
      { files: snapshot },
    );
    expect(confirm.exitCode).toBe(0);
    expect((confirm.json as Record<string, unknown>)['command']).toBe('confirm');
    await projectTerminal(
      harnessClient(seam.target),
      'contract-c05-001',
      2,
      terminalPayload({
        contractId: 'contract-c05-001',
        snapshotId: 'snapshot-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'USER_SELECTION_COMPLETE',
        passedCount: 5,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: selected.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: [...selected] },
        },
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c05-001', '--timeout-ms', '1000', '--poll-ms', '20'],
      seam.target,
    );
    const json = run.json as Record<string, unknown>;
    expect(run.exitCode).toBe(0);
    expect(json['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['CoverageStatus']).toBe('VERIFIED_COMPLETE');
    expect(json['StopReason']).toBe('USER_SELECTION_COMPLETE');
    expect(json['selected_count']).toBe(5);
    expect(json['validated_success_count']).toBe(5);
  });
});

describe('C10 — whole-collection-18-auth-acquires-16-two-known-inaccessible', () => {
  it('renders the exact PARTIAL/RESOLVED/COMPLETE/VERIFIED_COMPLETE/AUTH_REQUIRED projection with needs_user_action truthy', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    const accessible = ids('c10-member', 16);
    const inaccessible = ['c10-member-017', 'c10-member-018'];
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c10-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c10-root',
        collectionIdentity: 'collection/c10',
        membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/c10',
        },
        explorationPermission: 'COLLECTION_MEMBER_EDGES',
      }),
    });
    await setupSnapshot(
      client,
      'contract-c10-001',
      1,
      snapshotPayload(
        {
          contractId: 'contract-c10-001',
          requestedScope: {
            kind: 'entire_supported_collection',
            collectionIdentity: 'collection/c10',
          },
        },
        accessible,
      ),
    );
    await projectTerminal(
      client,
      'contract-c10-001',
      2,
      terminalPayload({
        contractId: 'contract-c10-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'AUTH_REQUIRED',
        passedCount: 16,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: accessible.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: [...accessible, ...inaccessible],
          },
        },
        knownAuthInaccessibleRequestedCount: 2,
      }),
    );
    const run = await runCli(['status', '--contract', 'contract-c10-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    expect(json['RequestFulfillmentStatus']).toBe('PARTIAL');
    expect(json['TargetResolutionStatus']).toBe('RESOLVED');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['CoverageStatus']).toBe('VERIFIED_COMPLETE');
    expect(json['StopReason']).toBe('AUTH_REQUIRED');
    expect(json['needs_user_action']).toBe(true);
    // The requested-scope count is a Core projection fact the v1 view does
    // not carry; the CLI renders absence instead of deriving "18" locally.
    expect(json['requested_count_if_known']).toBe(null);
    expect(run.exitCode).toBe(0); // plain status read succeeded; truth is visible
  });
});

describe('C13 — restart-repair-ui-cli-concurrency', () => {
  it('a second concurrent CLI client reads the same Core projection; duplicate cancel converges', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(
      harnessClient(seam.target),
      singleResourceContract({ contractId: 'contract-c13-001' }),
    );
    const cancelA = await runCli(
      [
        'cancel',
        '--contract',
        'contract-c13-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-c13-a',
      ],
      seam.target,
    );
    expect(cancelA.exitCode).toBe(0);
    // A second, independent CLI client instance observes the same truth.
    const statusB = await runCli(['status', '--contract', 'contract-c13-001'], seam.target);
    expect((statusB.json as Record<string, unknown>)['lineage_status']).toBe('CANCELLED');
    // The same client re-submitting the duplicate cancel with the SAME
    // idempotent identity converges rather than double-applying.
    const cancelB = await runCli(
      [
        'cancel',
        '--contract',
        'contract-c13-001',
        '--expected-revision',
        '1',
        '--request-id',
        'req-c13-a',
      ],
      seam.target,
    );
    expect(cancelB.exitCode).toBe(0);
    expect((cancelB.json as Record<string, unknown>)['converged']).toBe(true);
    expect((cancelB.json as Record<string, unknown>)['revision']).toBe(2);
  });
});

describe('C14 — discovered-targets-succeed-enumeration-unfinished', () => {
  it('renders Selection COMPLETE alongside Request UNKNOWN exactly as projected; no completion inference', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    const discovered = ids('c14-member', 5);
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c14-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c14-root',
        collectionIdentity: 'collection/c14',
        membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/c14',
        },
        explorationPermission: 'COLLECTION_MEMBER_EDGES',
      }),
    });
    await setupSnapshot(
      client,
      'contract-c14-001',
      1,
      snapshotPayload(
        {
          contractId: 'contract-c14-001',
          requestedScope: {
            kind: 'entire_supported_collection',
            collectionIdentity: 'collection/c14',
          },
        },
        discovered,
      ),
    );
    await projectTerminal(
      client,
      'contract-c14-001',
      2,
      terminalPayload({
        contractId: 'contract-c14-001',
        requestFulfillment: 'UNKNOWN',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'UNKNOWN',
        stopReason: 'NONE',
        passedCount: 5,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: discovered.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'NO_MORE_FOUND_WITHOUT_CLOSURE' },
      }),
    );
    const run = await runCli(['status', '--contract', 'contract-c14-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['RequestFulfillmentStatus']).toBe('UNKNOWN');
    expect(json['CoverageStatus']).toBe('UNKNOWN');
    // No CLI-side completion inference: UNKNOWN stays UNKNOWN and non-success.
    const wait = await runCli(
      ['wait', '--contract', 'contract-c14-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    expect(wait.exitCode).toBe(4);
  });
});

describe('C15 — unsupported-dash-separate-av-needs-mux', () => {
  it('renders UNSUPPORTED as non-success; exit and needs_user_action never present it as success', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract({ contractId: 'contract-c15-001' }));
    await projectTerminal(
      client,
      'contract-c15-001',
      1,
      terminalPayload({
        contractId: 'contract-c15-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'UNSUPPORTED',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c15-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    const json = run.json as Record<string, unknown>;
    expect(run.exitCode).toBe(4);
    expect(json['StopReason']).toBe('UNSUPPORTED');
    expect(json['SelectionAcquisitionStatus']).toBe('FAILED');
    expect(json['needs_user_action']).toBe(false);
  });
});

describe('C16 — simple-task-forced-through-unnecessary-preview', () => {
  it('direct single-resource submission completes without CLI-invented collection/confirmation steps', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([
      ['contract.json', JSON.stringify(singleResourceContract({ contractId: 'contract-c16-001' }))],
    ]);
    const submit = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-c16-1'],
      seam.target,
      { files },
    );
    expect(submit.exitCode).toBe(0);
    const acceptance = submit.json as Record<string, unknown>;
    // No CLI-invented preview/confirmation step: direct acceptance, no user
    // action required, no needs-user-action document.
    expect(acceptance['needs_user_action']).toBe(false);
    expect(acceptance['required_action']).toBe(null);
    expect(acceptance['document']).toBe('xdownload.cli.acceptance');
    await projectTerminal(
      harnessClient(seam.target),
      'contract-c16-001',
      1,
      terminalPayload({
        contractId: 'contract-c16-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'NONE',
        passedCount: 1,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c16-001', '--timeout-ms', '1000', '--poll-ms', '20'],
      seam.target,
    );
    expect(run.exitCode).toBe(0);
    expect((run.json as Record<string, unknown>)['TargetResolutionStatus']).toBe('RESOLVED');
  });
});

describe('C17 — batch-succeeds-pagination-untested', () => {
  it('batch per-item evidence renders without cross-claim promotion of coverage', async () => {
    const seam: RunningSeam = await startSeam();
    const stdin = [
      JSON.stringify(singleResourceContract({ contractId: 'contract-c17-001' })),
      JSON.stringify(singleResourceContract({ contractId: 'contract-c17-002' })),
    ].join('\n');
    const run = await runCli(['batch', '--stdin', '--request-id', 'req-c17'], seam.target, {
      stdinText: stdin,
    });
    expect(run.exitCode).toBe(0);
    const json = run.json as { items: Record<string, unknown>[]; document: string };
    expect(json['items']).toHaveLength(2);
    // Batch success carries per-item acceptance evidence only: no document
    // field claims coverage, continuation or navigation completion.
    const text = run.document;
    expect(text.includes('CoverageStatus')).toBe(false);
    expect(text.includes('coverage')).toBe(false);
    expect(text.includes('continuation')).toBe(false);
  });
});

describe('C23 — whole-collection-page3-undiscovered-due-discovery-budget', () => {
  it('renders the exact PARTIAL/PARTIAL/COMPLETE/TRUNCATED/DISCOVERY_BUDGET_EXHAUSTED projection verbatim', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    const found = ids('c23-member', 3);
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c23-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c23-root',
        collectionIdentity: 'collection/c23',
        membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/c23',
        },
        explorationPermission: 'COLLECTION_MEMBER_EDGES',
      }),
    });
    await setupSnapshot(
      client,
      'contract-c23-001',
      1,
      snapshotPayload(
        {
          contractId: 'contract-c23-001',
          requestedScope: {
            kind: 'entire_supported_collection',
            collectionIdentity: 'collection/c23',
          },
        },
        found,
      ),
    );
    await projectTerminal(
      client,
      'contract-c23-001',
      2,
      terminalPayload({
        contractId: 'contract-c23-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
        stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
        passedCount: 3,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: found.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'PAGE_LIMIT_REACHED' },
      }),
    );
    const run = await runCli(['status', '--contract', 'contract-c23-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    expect(json['RequestFulfillmentStatus']).toBe('PARTIAL');
    expect(json['TargetResolutionStatus']).toBe('PARTIAL');
    expect(json['SelectionAcquisitionStatus']).toBe('COMPLETE');
    expect(json['CoverageStatus']).toBe('TRUNCATED');
    expect(json['StopReason']).toBe('DISCOVERY_BUDGET_EXHAUSTED');
    const wait = await runCli(
      ['wait', '--contract', 'contract-c23-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    expect(wait.exitCode).toBe(4);
  });
});

describe('C24 — auth-failure-yields-no-targets', () => {
  it('renders UNSATISFIED/BLOCKED/NOT_STARTED/UNKNOWN with AUTH_REQUIRED and non-success exit', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    // A collection request blocked by authorization before any target was
    // resolved: coverage stays UNKNOWN (the §18.4 tuple); a single-resource
    // scope would require NOT_APPLICABLE coverage instead.
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c24-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c24-root',
        collectionIdentity: 'collection/c24',
        membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/c24',
        },
        explorationPermission: 'COLLECTION_MEMBER_EDGES',
      }),
    });
    await projectTerminal(
      client,
      'contract-c24-001',
      1,
      terminalPayload({
        contractId: 'contract-c24-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'BLOCKED',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'UNKNOWN',
        stopReason: 'AUTH_REQUIRED',
        passedCount: 0,
        failedCount: 0,
        summaryStatus: 'NOT_PERFORMED',
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c24-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    const json = run.json as Record<string, unknown>;
    expect(run.exitCode).toBe(4);
    expect(json['RequestFulfillmentStatus']).toBe('UNSATISFIED');
    expect(json['TargetResolutionStatus']).toBe('BLOCKED');
    expect(json['SelectionAcquisitionStatus']).toBe('NOT_STARTED');
    expect(json['CoverageStatus']).toBe('UNKNOWN');
    expect(json['StopReason']).toBe('AUTH_REQUIRED');
    expect(json['needs_user_action']).toBe(true);
  });
});

describe('C26 — user-confirms-system-labeled-original-without-enough-information', () => {
  it('confirmation routes selection only; CLI output makes no validation claim for the selection', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c26-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c26-root',
        collectionIdentity: 'collection/c26',
        membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/c26',
          memberIds: ['c26-member-001', 'c26-member-002'],
        },
        automationMode: 'MANUAL_SELECTION',
        selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
      }),
    });
    const snapshot = snapshotPayload(
      {
        contractId: 'contract-c26-001',
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/c26',
          memberIds: ['c26-member-001', 'c26-member-002'],
        },
      },
      ['c26-member-001', 'c26-member-002'],
    );
    const files = new Map([['snapshot.json', JSON.stringify(snapshot)]]);
    const confirm = await runCli(
      [
        'confirm',
        '--contract',
        'contract-c26-001',
        '--expected-revision',
        '1',
        '--file',
        'snapshot.json',
      ],
      seam.target,
      { files },
    );
    expect(confirm.exitCode).toBe(0);
    // The acceptance document proves routing only: it carries acceptance
    // facts and asserts no quality/validation claim about the selection.
    const text = confirm.document;
    expect(text.includes('validationSummary')).toBe(false);
    expect(text.includes('QUALITY')).toBe(false);
    expect(text.includes('"outcome":"ACCEPTED"')).toBe(true);
    const status = await runCli(['status', '--contract', 'contract-c26-001'], seam.target);
    expect((status.json as Record<string, unknown>)['snapshot_id']).toBe('snapshot-001');
    expect((status.json as Record<string, unknown>)['RequestFulfillmentStatus']).toBe(null);
  });
});

describe('C27 — confirmed-candidate-transfer-truncated-or-track-missing', () => {
  it('Core rejects a forged selection COMPLETE; the CLI renders the truthful non-success without waiver', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract({ contractId: 'contract-c27-001' }));
    // Harness-level proof of the Core gate: claiming selection COMPLETE while
    // a required validation failed is rejected with the C27 invariant.
    const forged = await rawCommand(client, {
      commandType: 'PROJECT_TERMINAL_RESULT',
      aggregateId: 'contract-c27-001',
      expectedRevision: 1,
      payload: terminalPayload({
        contractId: 'contract-c27-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'NONE',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    });
    expect(forged.outcome).toBe('REJECTED');
    const codes = (forged.diagnostics ?? []).map((diagnostic) => diagnostic.code);
    expect(codes).toContain('INVALID_RESULT_COMBINATION');
    // CLI-level: the truthful failed result renders as non-success; no
    // CLI-side waiver of validation exists.
    await projectTerminal(
      client,
      'contract-c27-001',
      1,
      terminalPayload({
        contractId: 'contract-c27-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'VALIDATION_FAILED',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-c27-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    expect(run.exitCode).toBe(4);
    expect((run.json as Record<string, unknown>)['SelectionAcquisitionStatus']).toBe('FAILED');
  });
});

describe('C32 — gate-set-includes-failure-abandonment-unknown-out-of-scope', () => {
  it('preserves distinct non-success and exclusion classifications as projected; no generic success collapse', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    const mixed = ['c32-a', 'c32-b', 'c32-c'];
    await setupContract(client, {
      ...singleResourceContract({
        contractId: 'contract-c32-001',
        intentType: 'COLLECTION',
        requestedTarget: 'target-c32-root',
        collectionIdentity: 'collection/c32',
        membershipBasis: { basis: 'DECLARED_FINITE_SET' },
        requestedScope: {
          kind: 'explicit_member_set',
          collectionIdentity: 'collection/c32',
          memberIds: mixed,
        },
      }),
    });
    await setupSnapshot(
      client,
      'contract-c32-001',
      1,
      snapshotPayload(
        {
          contractId: 'contract-c32-001',
          requestedScope: {
            kind: 'explicit_member_set',
            collectionIdentity: 'collection/c32',
            memberIds: mixed,
          },
        },
        mixed,
      ),
    );
    await projectTerminal(
      client,
      'contract-c32-001',
      2,
      terminalPayload({
        contractId: 'contract-c32-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'PARTIAL',
        coverage: 'TRUNCATED',
        stopReason: 'AUTH_FAILED',
        passedCount: 2,
        failedCount: 1,
        summaryStatus: 'PARTIAL',
        outcomes: [
          { memberId: 'c32-a', requiredValidationPassed: true },
          { memberId: 'c32-b', requiredValidationPassed: true },
          { memberId: 'c32-c', requiredValidationPassed: false },
        ],
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'FAILED_NEXT_PAGE' },
      }),
    );
    const run = await runCli(['status', '--contract', 'contract-c32-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    // Every dimension is rendered distinctly, exactly as projected.
    expect(json['RequestFulfillmentStatus']).toBe('PARTIAL');
    expect(json['TargetResolutionStatus']).toBe('PARTIAL');
    expect(json['SelectionAcquisitionStatus']).toBe('PARTIAL');
    expect(json['CoverageStatus']).toBe('TRUNCATED');
    expect(json['StopReason']).toBe('AUTH_FAILED');
    expect(json['validated_success_count']).toBe(2);
    expect(json['needs_user_action']).toBe(true);
    const wait = await runCli(
      ['wait', '--contract', 'contract-c32-001', '--timeout-ms', '500', '--poll-ms', '20'],
      seam.target,
    );
    expect(wait.exitCode).toBe(4);
  });
});

describe('concurrent wait observation (C13/C05 composition guard)', () => {
  it('submit --wait observes a terminal projected by another lane while waiting', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([
      [
        'contract.json',
        JSON.stringify(singleResourceContract({ contractId: 'contract-conc-001' })),
      ],
    ]);
    const runPromise = runCli(
      [
        'submit',
        '--file',
        'contract.json',
        '--request-id',
        'req-conc-1',
        '--wait',
        '--timeout-ms',
        '4000',
        '--poll-ms',
        '20',
      ],
      seam.target,
      { files },
    );
    await vi.waitFor(() => {
      expect(seam.server.inspectProjection('contract-conc-001')).toBeDefined();
    });
    await projectTerminal(
      harnessClient(seam.target),
      'contract-conc-001',
      1,
      terminalPayload({
        contractId: 'contract-conc-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'NONE',
        passedCount: 1,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: true }],
      }),
    );
    const run = await runPromise;
    expect(run.exitCode).toBe(0);
  });
});
