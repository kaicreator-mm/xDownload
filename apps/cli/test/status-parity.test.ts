/**
 * TEST_MATRIX suite `status-parity-with-core`: CLI machine-readable status
 * equals the Core projection for the same aggregate (independent read
 * paths), absent projection fields render as absent, reads are never cached,
 * and verified-empty scope renders as no-match truthfully.
 */

import { describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { createEvidenceLedger, evidenceRecord } from '@xdownload/domain-contracts';
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
    expect(json['requested_count_if_known']).toBe(1);
    expect(json['auth_accessible_count_if_known']).toBe(null);
    expect(json['resolved_count']).toBe(null);
    expect(json['selected_count']).toBe(null);
    expect(json['validated_success_count']).toBe(null);
    expect(json['RequestFulfillmentStatus']).toBe(null);
    expect(json['needs_user_action']).toBe(null);
  });

  it('projects durable Core accounting counts verbatim without CLI derivation', async () => {
    const seam: RunningSeam = await startSeam(undefined, { durableJournal: true });
    const client = harnessClient(seam.target);
    await setupContract(client, collectionContract());
    await setupSnapshot(client, 'contract-collection-001', 1, snapshotPayload());

    const accounting = {
      coverageTarget: {
        collectionIdentity: 'collection/playlist-001',
        scopeKind: 'entire_supported_collection',
        scopeIdentityKey: 'entire_supported_collection:collection/playlist-001',
        snapshotVersion: 1,
      },
      authorizationContextRef: 'authctx/local-001',
      requested: ['member-001', 'member-002', 'member-003'],
      authAccessible: ['member-001', 'member-002', 'member-003'],
      authInaccessible: [],
      resolved: ['member-001', 'member-002', 'member-003'],
      selected: ['member-001', 'member-002', 'member-003'],
      validated: ['member-001', 'member-002', 'member-003'],
      accounted: ['member-001', 'member-002', 'member-003'],
      counts: {
        requested: 3,
        accounted: 3,
        authAccessible: 3,
        authInaccessible: 0,
        selected: 3,
        validated: 3,
      },
    };
    const recorded = seam.server.recordCoverageAccounting(
      'contract-collection-001',
      accounting as never,
    );
    expect(recorded.ok).toBe(true);

    const run = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    const coreView = seam.server.inspectProjection('contract-collection-001');
    expect(coreView).toBeDefined();
    expect(json['requested_count_if_known']).toBe(coreView?.requestedMemberCount);
    expect(json['auth_accessible_count_if_known']).toBe(coreView?.authAccessibleMemberCount);
    expect(json['resolved_count']).toBe(coreView?.resolvedMemberCount);
    expect(json['requested_count_if_known']).toBe(3);
    expect(json['auth_accessible_count_if_known']).toBe(3);
    expect(json['resolved_count']).toBe(3);
  });

  it('renders the required 18 requested / 16 accessible / 18 resolved Core accounting matrix verbatim', async () => {
    const seam: RunningSeam = await startSeam(undefined, { durableJournal: true });
    const client = harnessClient(seam.target);
    const requested = Array.from(
      { length: 18 },
      (_, index) => `member-${String(index + 1).padStart(3, '0')}`,
    );
    const accessible = requested.slice(0, 16);
    const inaccessible = requested.slice(16);
    await setupContract(client, collectionContract());
    await setupSnapshot(
      client,
      'contract-collection-001',
      1,
      snapshotPayload(
        {
          requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: requested },
          authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: accessible },
          selectedMemberIds: accessible,
          selectionClaims: [
            {
              kind: 'BATCH',
              confirmationType: 'CONFIRM_SELECTION',
              memberRefs: accessible,
            },
          ],
        },
        requested,
      ),
    );

    const ledger = createEvidenceLedger();
    for (const [index, memberId] of inaccessible.entries()) {
      const admitted = ledger.append(
        evidenceRecord({
          evidenceId: `evidence-auth-${String(index + 1).padStart(3, '0')}` as never,
          claimType: 'AUTHORIZATION',
          claimSubject: { kind: 'MEMBER', ref: memberId },
          sourceType: 'INDEPENDENT_VALIDATOR',
          provenance: {
            sourceIdentity: 'independent-auth-validator-001',
            executionContext: {
              toolsUsed: ['independent-auth-validator'],
              authorizationContextRef: 'authctx/local-001',
              budgetRefs: [],
            },
          },
          independenceFromDiscovery: 'INDEPENDENT',
          scope: {
            domain: 'AUTHORIZATION',
            contractRef: 'contract-collection-001',
            snapshotRef: 'snapshot-001',
          },
          certaintyClass: 'DECISIVE',
        }),
      );
      expect(admitted.ok).toBe(true);
    }

    const accounting = {
      coverageTarget: {
        collectionIdentity: 'collection/playlist-001',
        scopeKind: 'entire_supported_collection',
        scopeIdentityKey: 'entire_supported_collection:collection/playlist-001',
        snapshotVersion: 1,
      },
      authorizationContextRef: 'authctx/local-001',
      requested,
      authAccessible: accessible,
      authInaccessible: inaccessible.map((memberId, index) => ({
        memberId,
        classificationEvidenceId: `evidence-auth-${String(index + 1).padStart(3, '0')}`,
        independentlyAccounted: true,
      })),
      resolved: requested,
      selected: accessible,
      validated: accessible,
      accounted: requested,
      counts: {
        requested: 18,
        accounted: 18,
        authAccessible: 16,
        authInaccessible: 2,
        selected: 16,
        validated: 16,
      },
    };
    const recorded = seam.server.recordCoverageAccounting(
      'contract-collection-001',
      accounting as never,
      ledger,
    );
    expect(recorded.ok).toBe(true);

    const run = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    const json = run.json as Record<string, unknown>;
    expect(json['requested_count_if_known']).toBe(18);
    expect(json['auth_accessible_count_if_known']).toBe(16);
    expect(json['resolved_count']).toBe(18);
    expect(json['selected_count']).toBe(16);
    expect(json['validated_success_count']).toBe(null);
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
