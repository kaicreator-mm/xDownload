/**
 * TEST_MATRIX counterexample oracles (Frozen PRD §35): seam-level T004
 * mappings for C08, C11, C12, C13, C16, C30, C31. Each oracle proves the
 * seam admits the legal shape and rejects the counterexample shape with a
 * typed outcome — never a silent reinterpretation.
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  EXPECTED_PEER,
  peer,
  rawCollectionContract,
  rawCommand,
  rawSingleResourceContract,
  rawSnapshot,
} from './helpers.ts';

function server() {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function submit(s: ReturnType<typeof server>, raw: Record<string, unknown>) {
  return s.handleFrame(JSON.stringify(raw));
}

describe('C08 — page-range 1..3 with iframe/load-more detail, no continuation', () => {
  it('a command attempting additional continuation for a continuation_scope=NONE contract rejects', () => {
    const s = server();
    const first = submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract({ continuationScope: { kind: 'NONE' } }),
      }),
    );
    expect(first.outcome).toBe('ACCEPTED');
    // Same contract identity attempting to add continuation authority:
    // successor identity is required; the plain command rejects (SCOPE_MUTATION).
    const expand = submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        payload: rawCollectionContract({
          continuationScope: { kind: 'DECLARED_NATURAL_END' },
        }),
      }),
    );
    expect(expand.outcome).toBe('REJECTED');
    const codes = expand.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain('SCOPE_MUTATION');
    expect(expand.diagnostics?.some((d) => d.invariant === 'C08')).toBe(true);
  });

  it('load-more requires a successor contract identity; the successor path is admitted', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract({ continuationScope: { kind: 'NONE' } }),
      }),
    );
    const successor = submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001-successor',
        payload: rawCollectionContract({
          contractId: 'contract-collection-001-successor',
          continuationScope: { kind: 'DECLARED_NATURAL_END' },
          supersedesContractId: 'contract-collection-001',
        }),
      }),
    );
    expect(successor.outcome).toBe('ACCEPTED');
    expect(s.inspectProjection('contract-collection-001-successor')).toBeDefined();
  });
});

describe('C11 — collection changes after preview', () => {
  it('no command can mutate a confirmed snapshot through the seam; refresh requires successor identity', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract(),
      }),
    );
    const confirm = submit(
      s,
      rawCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        payload: rawSnapshot(),
      }),
    );
    expect(confirm.outcome).toBe('ACCEPTED');
    // Re-confirmation / refresh of the same lineage is a snapshot mutation.
    const refresh = submit(
      s,
      rawCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-collection-001',
        expectedRevision: 2,
        payload: rawSnapshot({ snapshotId: 'snapshot-002', createdAt: '2026-10-04T02:00:00Z' }),
      }),
    );
    expect(refresh.outcome).toBe('REJECTED');
    expect(refresh.diagnostics?.[0]?.code).toBe('SNAPSHOT_MUTATION');
    expect(refresh.diagnostics?.[0]?.invariant).toBe('C11');
    // The confirmed snapshot identity is unchanged.
    const view = s.inspectProjection('contract-collection-001');
    expect(view?.snapshot?.snapshotId).toBe('snapshot-001');
  });
});

describe('C12 — retry failed items', () => {
  it('retry authority domain is the original failed members; replacement/new members reject', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract(),
      }),
    );
    // Core-internal runtime fact (never a surface command): the original
    // failed-member identity domain.
    expect(s.recordFailedMembers('contract-collection-001', ['member-001', 'member-002']).ok).toBe(
      true,
    );
    const legal = submit(
      s,
      rawCommand({
        commandType: 'RETRY_FAILED_MEMBERS',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        payload: { memberIds: ['member-001'] },
      }),
    );
    expect(legal.outcome).toBe('ACCEPTED');
    const smuggled = submit(
      s,
      rawCommand({
        commandType: 'RETRY_FAILED_MEMBERS',
        aggregateId: 'contract-collection-001',
        expectedRevision: 2,
        payload: { memberIds: ['member-002', 'member-new-replacement'] },
      }),
    );
    expect(smuggled.outcome).toBe('REJECTED');
    expect(smuggled.diagnostics?.[0]?.code).toBe('RETRY_AUTHORITY_DOMAIN_REJECTED');
    expect(smuggled.diagnostics?.[0]?.invariant).toBe('C12');
  });

  it('retry cannot invent a failed-member domain when none was recorded', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
      }),
    );
    const invented = submit(
      s,
      rawCommand({
        commandType: 'RETRY_FAILED_MEMBERS',
        aggregateId: 'contract-single-001',
        expectedRevision: 1,
        payload: { memberIds: ['member-001'] },
      }),
    );
    expect(invented.outcome).toBe('REJECTED');
    expect(invented.diagnostics?.[0]?.code).toBe('RETRY_AUTHORITY_DOMAIN_REJECTED');
  });
});

describe('C13 — restart/repair/UI+CLI concurrency', () => {
  it('two surfaces submitting the same logical command converge to one lineage; duplicate allocation rejects', () => {
    const s = server();
    const uiSubmit = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      requestId: 'req-shared-001',
      asPeer: peer('DESKTOP_UI'),
    });
    const cliRetry = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      requestId: 'req-shared-001',
      asPeer: peer('CLI'),
    });
    const fromUi = submit(s, uiSubmit);
    const fromCli = submit(s, cliRetry);
    expect(fromUi.outcome).toBe('ACCEPTED');
    expect(fromCli.outcome).toBe('ACCEPTED');
    expect(fromCli.acceptance?.converged).toBe(true);
    expect(fromCli.acceptance?.revision).toBe(fromUi.acceptance?.revision);
    expect(s.acceptedCommandCount).toBe(1);
    // Duplicate allocation under a NEW identity for the same aggregate rejects.
    const duplicate = submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        expectedRevision: 1,
        payload: rawSingleResourceContract(),
        requestId: 'req-shared-002',
        asPeer: peer('CLI'),
      }),
    );
    expect(duplicate.outcome).toBe('REJECTED');
    expect(duplicate.diagnostics?.[0]?.code).toBe('DUPLICATE_ALLOCATION');
  });
});

describe('C16 — simple task forced through unnecessary preview/scope machinery', () => {
  it('the seam admits single-resource commands without collection-shaped fields', () => {
    const s = server();
    const payload = rawSingleResourceContract();
    expect('collectionIdentity' in payload).toBe(false);
    expect('membershipBasis' in payload).toBe(false);
    const response = submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload,
      }),
    );
    expect(response.outcome).toBe('ACCEPTED');
    const view = s.inspectProjection('contract-single-001');
    expect(view?.contract.intentType).toBe('SINGLE_RESOURCE');
    // The single-resource path reaches terminal truth without any snapshot.
    const terminal = submit(
      s,
      rawCommand({
        commandType: 'PROJECT_TERMINAL_RESULT',
        aggregateId: 'contract-single-001',
        expectedRevision: 1,
        payload: {
          result: {
            schemaIdentity: {
              schema: 'xdownload.domain-contracts',
              version: '1.0.0',
            },
            contractId: 'contract-single-001',
            requestFulfillment: 'COMPLETE',
            targetResolution: 'RESOLVED',
            selectionAcquisition: 'COMPLETE',
            coverage: 'NOT_APPLICABLE',
            stopReason: 'NONE',
            validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
            recordedAt: '2026-10-04T01:00:00Z',
          },
          selectedValidationOutcomes: [
            { memberId: 'target-file-001', requiredValidationPassed: true },
          ],
        },
      }),
    );
    expect(terminal.outcome).toBe('ACCEPTED');
  });
});

describe('C30 — fifty-item confirmations vs batch selection', () => {
  it('one command may carry a batch selection claim set; no per-item authority commands are required', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract(),
      }),
    );
    const fifty = Array.from({ length: 50 }, (_, i) => `member-${String(i + 1).padStart(3, '0')}`);
    const batch = submit(
      s,
      rawCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        payload: rawSnapshot({
          selectedMemberIds: fifty,
          requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: fifty },
          authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: fifty },
          selectionClaims: [
            { kind: 'BATCH', confirmationType: 'CONFIRM_SELECTION', memberRefs: fifty },
          ],
        }),
      }),
    );
    // One batch claim command expresses the whole selection.
    expect(batch.outcome).toBe('ACCEPTED');
    expect(
      s.inspectProjection('contract-collection-001')?.snapshot?.selectedMemberIds,
    ).toHaveLength(50);
  });
});

describe('C31 — prior selection reused on a different task/page', () => {
  it('a command replaying another task selection/authorization payload cannot inherit its authority', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract(),
      }),
    );
    // The payload binds task B's contract while the command addresses task A's
    // aggregate: cross-task replay rejects instead of inheriting authority.
    const crossTask = submit(
      s,
      rawCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        payload: rawSnapshot({ contractId: 'contract-collection-999' }),
      }),
    );
    expect(crossTask.outcome).toBe('REJECTED');
    const codes = crossTask.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain('CONTRACT_BINDING_MISMATCH');
  });

  it('a command whose correlation references another aggregate rejects at the binding gate', () => {
    const s = server();
    submit(
      s,
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-collection-001',
        payload: rawCollectionContract(),
      }),
    );
    const hijack = submit(
      s,
      rawCommand({
        commandType: 'CANCEL_LINEAGE',
        aggregateId: 'contract-collection-001',
        expectedRevision: 1,
        correlation: { contractId: 'contract-collection-999' },
      }),
    );
    expect(hijack.outcome).toBe('REJECTED');
    expect(hijack.diagnostics?.[0]?.code).toBe('CORRELATION_BINDING_REJECTED');
    expect(s.inspectProjection('contract-collection-999')).toBeUndefined();
  });
});
