/**
 * TEST_MATRIX suite `golden-machine-readable-output`: the PRD §27 required
 * field set is present verbatim in the machine-readable status contract,
 * values are projected from Core-owned READ_PROJECTION views (never locally
 * derived), and golden fixtures are byte-deterministic across runs for the
 * same projection input.
 */

import { describe, expect, it } from 'vitest';
import {
  collectionContract,
  projectTerminal,
  runCli,
  setupContract,
  setupSnapshot,
  singleResourceContract,
  snapshotPayload,
  startSeam,
  harnessClient,
  terminalPayload,
  type RunningSeam,
} from './helpers.ts';

const FIXED_PRESENTATION = { summary: null, no_match_verified: false };

describe('golden machine-readable output', () => {
  it('pre-terminal status renders the exact §27 document with absent fields as null', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    const run = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect(run.exitCode).toBe(0);
    const expected = {
      document: 'xdownload.cli.status',
      schema: '1',
      contract_id: 'contract-single-001',
      contract_revision: 1,
      intent_type: 'SINGLE_RESOURCE',
      lineage_status: 'ACTIVE',
      projection_schema: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      requested_scope: null,
      continuation_scope: null,
      snapshot_id: null,
      requested_count_if_known: null,
      auth_accessible_count_if_known: null,
      resolved_count: null,
      selected_count: null,
      validated_success_count: null,
      RequestFulfillmentStatus: null,
      TargetResolutionStatus: null,
      SelectionAcquisitionStatus: null,
      CoverageStatus: null,
      StopReason: null,
      needs_user_action: null,
      failed_member_count: 0,
      retried_member_ids: [],
      presentation: FIXED_PRESENTATION,
      diagnostics: null,
    };
    // Byte-stable golden: the full document equals the spec literal exactly.
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('status after snapshot confirmation projects snapshot facts verbatim', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, collectionContract());
    await setupSnapshot(client, 'contract-collection-001', 1, snapshotPayload());
    const run = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    expect(run.exitCode).toBe(0);
    const json = run.json as Record<string, unknown>;
    expect(json['document']).toBe('xdownload.cli.status');
    expect(json['snapshot_id']).toBe('snapshot-001');
    expect(json['selected_count']).toBe(3);
    expect(json['contract_revision']).toBe(2);
    expect(json['lineage_status']).toBe('ACTIVE');
    expect(json['requested_scope']).toBe(null);
    expect(json['resolved_count']).toBe(null);
  });

  it('terminal success status projects the exact six-dimension tuple', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract());
    await projectTerminal(
      client,
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
    const run = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect(run.exitCode).toBe(0);
    const expected = {
      document: 'xdownload.cli.status',
      schema: '1',
      contract_id: 'contract-single-001',
      contract_revision: 2,
      intent_type: 'SINGLE_RESOURCE',
      lineage_status: 'TERMINAL',
      projection_schema: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      requested_scope: null,
      continuation_scope: null,
      snapshot_id: null,
      requested_count_if_known: null,
      auth_accessible_count_if_known: null,
      resolved_count: null,
      selected_count: null,
      validated_success_count: 1,
      RequestFulfillmentStatus: 'COMPLETE',
      TargetResolutionStatus: 'RESOLVED',
      SelectionAcquisitionStatus: 'COMPLETE',
      CoverageStatus: 'NOT_APPLICABLE',
      StopReason: 'NONE',
      needs_user_action: false,
      failed_member_count: 0,
      retried_member_ids: [],
      presentation: FIXED_PRESENTATION,
      diagnostics: null,
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('submit acceptance is its own golden document, separate from any result', async () => {
    const seam: RunningSeam = await startSeam();
    const files = new Map([['contract.json', JSON.stringify(singleResourceContract())]]);
    const run = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-golden-001'],
      seam.target,
      { files },
    );
    expect(run.exitCode).toBe(0);
    const expected = {
      document: 'xdownload.cli.acceptance',
      schema: '1',
      command: 'submit',
      outcome: 'ACCEPTED',
      contract_id: 'contract-single-001',
      request_id: 'req-golden-001',
      revision: 1,
      converged: false,
      current_revision: 1,
      needs_user_action: false,
      required_action: null,
      note: 'submit acceptance is not final acquisition success',
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('a seam typed rejection renders its golden document with diagnostics verbatim', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, singleResourceContract());
    const files = new Map([['contract.json', JSON.stringify(singleResourceContract())]]);
    const run = await runCli(
      ['submit', '--file', 'contract.json', '--request-id', 'req-golden-dup'],
      seam.target,
      { files },
    );
    expect(run.exitCode).toBe(2);
    // The CLI submitted with expectedRevision 0 (creation assertion) against
    // the already-existing aggregate: the seam's revision gate rejects before
    // the allocation gate. The typed rejection is projected verbatim.
    const expected = {
      document: 'xdownload.cli.rejection',
      schema: '1',
      command: 'submit',
      outcome: 'REJECTED',
      request_id: 'req-golden-dup',
      contract_id: 'contract-single-001',
      current_revision: 1,
      diagnostics: [
        {
          code: 'REVISION_MISMATCH',
          path: 'expectedRevision',
          message: 'expected revision 0 but current aggregate revision is 1',
          invariant: 'L2-§10',
        },
      ],
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });

  it('golden fixtures are deterministic across repeated runs for the same projection', async () => {
    const seam: RunningSeam = await startSeam();
    const client = harnessClient(seam.target);
    await setupContract(client, collectionContract());
    await setupSnapshot(client, 'contract-collection-001', 1, snapshotPayload());
    const first = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    const second = await runCli(['status', '--contract', 'contract-collection-001'], seam.target);
    expect(second.document).toBe(first.document);
    expect(second.document.length).toBeGreaterThan(0);
  });

  it('usage errors render a stable typed error document', async () => {
    const seam: RunningSeam = await startSeam();
    const run = await runCli(['frobnicate'], seam.target);
    expect(run.exitCode).toBe(1);
    const expected = {
      document: 'xdownload.cli.error',
      schema: '1',
      error: 'USAGE',
      message: "unknown command 'frobnicate'; run 'xdownload help'",
      usage: 'run: xdownload help',
      diagnostics: null,
    };
    expect(run.document).toBe(JSON.stringify(expected));
  });
});
