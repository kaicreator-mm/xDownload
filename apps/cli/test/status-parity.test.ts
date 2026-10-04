/**
 * TEST_MATRIX suite `status-parity-with-core`: CLI machine-readable status
 * equals the Core projection for the same aggregate (independent read
 * paths), absent projection fields render as absent, reads are never cached,
 * and verified-empty scope renders as no-match truthfully.
 */

import { describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { renderStatusDocument } from '../src/index.ts';
import {
  collectionContract,
  harnessClient,
  projectTerminal,
  queryCountingTransport,
  runCli,
  setupContract,
  setupSnapshot,
  singleResourceContract,
  snapshotPayload,
  startSeam,
  terminalPayload,
  type RunningSeam,
} from './helpers.ts';

describe('status parity with core', () => {
  it('CLI status equals the Core projection for the same aggregate, including terminal result', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, collectionContract());
    await setupSnapshot(client, 'contract-collection-001', 1, snapshotPayload());
    await projectTerminal(
      client,
      'contract-collection-001',
      2,
      terminalPayload({
        contractId: 'contract-collection-001',
        snapshotId: 'snapshot-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_COLLECTION_END',
        passedCount: 3,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: [
          { memberId: 'member-001', requiredValidationPassed: true },
          { memberId: 'member-002', requiredValidationPassed: true },
          { memberId: 'member-003', requiredValidationPassed: true },
        ],
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: ['member-001', 'member-002', 'member-003'],
          },
        },
      }),
    );
    // Independent read paths: the CLI over the wire, the server view in process.
    const run = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    const coreView = seam.server.inspectProjection('contract-collection-001');
    expect(coreView).toBeDefined();
    expect(run.document).toBe(JSON.stringify(renderStatusDocument(coreView!)));
    const json = run.json as Record<string, unknown>;
    expect(json['CoverageStatus']).toBe('VERIFIED_COMPLETE');
    expect(json['validated_success_count']).toBe(3);
    expect(json['selected_count']).toBe(3);
  });

  it('absent projection fields render as absent, never as invented values', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const run = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    // Scope facts the projection carries are rendered verbatim, never
    // re-derived or rewritten by the CLI.
    expect(json['requested_scope']).toStrictEqual({
      kind: 'single_resource',
      targetId: 'target-file-001',
    });
    expect(json['continuation_scope']).toStrictEqual({ kind: 'NONE' });
    // The v1 READ_PROJECTION carries none of these counts or statuses; the
    // CLI must not synthesize them before Core projects them.
    expect(json['requested_count_if_known']).toBe(null);
    expect(json['auth_accessible_count_if_known']).toBe(null);
    expect(json['resolved_count']).toBe(null);
    expect(json['selected_count']).toBe(null);
    expect(json['validated_success_count']).toBe(null);
    expect(json['RequestFulfillmentStatus']).toBe(null);
    expect(json['needs_user_action']).toBe(null);
  });

  it('verified-empty renders as no-match truthfully, never as download success', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, collectionContract({ contractId: 'contract-empty-001' }));
    await projectTerminal(
      client,
      'contract-empty-001',
      1,
      terminalPayload({
        contractId: 'contract-empty-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'EMPTY_CONFIRMED',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_COLLECTION_END',
        passedCount: 0,
        failedCount: 0,
        summaryStatus: 'NOT_PERFORMED',
        outcomes: [],
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: [] },
        },
      }),
    );
    const run = await runCli(
      ['wait', '--contract', 'contract-empty-001', '--timeout-ms', '1000', '--poll-ms', '20'],
      seam.target,
    );
    const json = run.json as Record<string, unknown>;
    const presentation = json['presentation'] as {
      summary: string | null;
      no_match_verified: boolean;
    };
    expect(presentation['no_match_verified']).toBe(true);
    expect(presentation['summary']).toBe('No matching resources in the requested scope (verified)');
    // Verified-empty never exits as download success: nothing was acquired.
    expect(run.exitCode).toBe(4);
    expect(json['SelectionAcquisitionStatus']).toBe('NOT_STARTED');
  });

  it('reads are never cached: every status performs a fresh READ_PROJECTION', async () => {
    const seam: RunningSeam = await startSeam();
    const transport = queryCountingTransport(createLoopbackClientTransport());
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const before = await runCli(['status', '--contract', 'contract-single-001'], seam.target, {
      transport,
    });
    expect((before.json as Record<string, unknown>)['RequestFulfillmentStatus']).toBe(null);
    const queriesAfterFirstRead = transport.queryCount();
    expect(queriesAfterFirstRead).toBeGreaterThanOrEqual(1);
    await projectTerminal(
      harnessClient(seam.target),
      'contract-single-001',
      1,
      terminalPayload({
        contractId: 'contract-single-001',
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
    const after = await runCli(['status', '--contract', 'contract-single-001'], seam.target, {
      transport,
    });
    // A cached view would still show the pre-terminal state; the fresh read
    // shows the projected terminal truth.
    expect((after.json as Record<string, unknown>)['RequestFulfillmentStatus']).toBe('COMPLETE');
    expect(transport.queryCount()).toBeGreaterThan(queriesAfterFirstRead);
  });
});
