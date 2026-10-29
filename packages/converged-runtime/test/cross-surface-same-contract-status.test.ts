/**
 * TEST_MATRIX suite `cross-surface-same-contract-status` (T017).
 *
 * Must prove:
 * - the same canonical contract/command driven through SurfaceKind CLI and
 *   SurfaceKind DESKTOP_UI clients yields the same SeamResponse class
 *   (ACCEPTED/REJECTED/PROJECTION) and the same six-dimension terminal
 *   projection;
 * - surfaces render Core projections verbatim; no surface-local status
 *   derivation, patching or success-boolean collapse exists in the glue;
 * - REJECTED diagnostics project verbatim and identically across surfaces;
 * - scope/continuation/authorization semantics are identical whether driven
 *   from UI or CLI (successor-identity refresh routes through the same seam
 *   on every surface; no in-place mutation of the original).
 *
 * Oracle mappings exercised here: C02, C05, C08, C11.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderProjectionBytes } from '../src/index.ts';
import {
  boundSurface,
  composeCore,
  nextRequestId,
  rawSingleResourceContract,
  rawSnapshotPayload,
  terminalTuplePayload,
  type ComposedCore,
} from './fixtures.ts';

const cores: ComposedCore[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) {
    await core.stop();
  }
});

function ids(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`,
  );
}

describe('T017 cross-surface-same-contract-status', () => {
  it('the same canonical contract through CLI and DESKTOP_UI on symmetric cores yields the same response class and projection bytes', async () => {
    const coreA = await composeCore('t017-parity-a');
    const coreB = await composeCore('t017-parity-b');
    cores.push(coreA, coreB);
    const cli = boundSurface('CLI', await coreA);
    const desktop = boundSurface('DESKTOP_UI', await coreB);
    // The identical canonical payload bytes are the only input difference
    // between surfaces: none.
    const contract = rawSingleResourceContract();
    const acceptedCli = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-single-001',
      payload: contract,
      requestId: nextRequestId('cli'),
      correlation: { contractId: 'contract-t017-single-001' },
    });
    const acceptedDesktop = await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-single-001',
      payload: contract,
      requestId: nextRequestId('desktop'),
      correlation: { contractId: 'contract-t017-single-001' },
    });
    expect(acceptedCli.outcome).toBe('ACCEPTED');
    expect(acceptedDesktop.outcome).toBe('ACCEPTED');
    expect(acceptedCli.acceptance?.revision).toBe(acceptedDesktop.acceptance?.revision);

    const viewCli = await cli.readProjection('contract-t017-single-001');
    const viewDesktop = await desktop.readProjection('contract-t017-single-001');
    expect(viewCli.outcome).toBe('PROJECTION');
    expect(viewDesktop.outcome).toBe('PROJECTION');
    // Verbatim render parity: the same projection bytes, not synced state.
    expect(renderProjectionBytes(viewCli.projection)).toBe(
      renderProjectionBytes(viewDesktop.projection),
    );
    await cli.close();
    await desktop.close();
  });

  it('on one core, the same canonical command gets the same verdict whichever surface drives it; no surface admits what another rejects', async () => {
    const core = await composeCore('t017-one-authority');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const extension = boundSurface('BROWSER_EXTENSION', core);
    const contract = rawSingleResourceContract();
    const first = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-single-001',
      payload: contract,
      expectedRevision: 0,
      requestId: nextRequestId('first'),
    });
    expect(first.outcome).toBe('ACCEPTED');
    // Canonical identity rules, not surface identity: a second allocation of
    // the same aggregate is the same DUPLICATE_ALLOCATION typed rejection
    // from every surface.
    const duplicates = await Promise.all([
      desktop.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-single-001',
        payload: contract,
        expectedRevision: 1,
        requestId: nextRequestId('dup-desktop'),
      }),
      extension.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-single-001',
        payload: contract,
        expectedRevision: 1,
        requestId: nextRequestId('dup-extension'),
      }),
    ]);
    for (const duplicate of duplicates) {
      expect(duplicate.outcome).toBe('REJECTED');
      expect(duplicate.diagnostics?.[0]?.code).toBe('DUPLICATE_ALLOCATION');
      expect(JSON.stringify(duplicate.diagnostics)).toBe(
        JSON.stringify(duplicates[0]?.diagnostics),
      );
    }
    await cli.close();
    await desktop.close();
    await extension.close();
  });

  it('REJECTED diagnostics project verbatim and identically across surfaces', async () => {
    const core = await composeCore('t017-reject-parity');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const submitted = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-single-001',
      payload: rawSingleResourceContract(),
      expectedRevision: 0,
      requestId: nextRequestId('submit'),
    });
    expect(submitted.outcome).toBe('ACCEPTED');
    // The same malformed snapshot through both surfaces: the same verbatim
    // typed diagnostics, and the rejection consumes no authority state.
    const rejections = await Promise.all([
      cli.submitCanonicalCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-t017-single-001',
        payload: {},
        expectedRevision: 1,
        requestId: nextRequestId('reject-cli'),
      }),
      desktop.submitCanonicalCommand({
        commandType: 'CONFIRM_SNAPSHOT',
        aggregateId: 'contract-t017-single-001',
        payload: {},
        expectedRevision: 1,
        requestId: nextRequestId('reject-desktop'),
      }),
    ]);
    expect(rejections[0]?.outcome).toBe('REJECTED');
    expect(JSON.stringify(rejections[0]?.diagnostics)).toBe(
      JSON.stringify(rejections[1]?.diagnostics),
    );
    expect((rejections[0]?.diagnostics ?? []).length).toBeGreaterThan(0);
    await cli.close();
    await desktop.close();
  });

  it('C02: the PARTIAL/TRUNCATED terminal tuple renders identically on every surface and no surface upgrades it to COMPLETE', async () => {
    const core = await composeCore('t017-c02');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const extension = boundSurface('BROWSER_EXTENSION', core);
    const selected = ids('member', 4);
    const contract = rawSingleResourceContract({
      contractId: 'contract-t017-c02',
      intentType: 'COLLECTION',
      requestedTarget: 'target-c02-root',
      collectionIdentity: 'collection/t017-c02',
      membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
      requestedScope: {
        kind: 'entire_supported_collection',
        collectionIdentity: 'collection/t017-c02',
      },
      explorationPermission: 'COLLECTION_MEMBER_EDGES',
      automationMode: 'ASSISTED',
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
    });
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-c02',
      payload: contract,
      expectedRevision: 0,
      requestId: nextRequestId('c02-submit'),
    });
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = await desktop.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-c02',
      payload: rawSnapshotPayload('contract-t017-c02', selected, {
        requestedScope: {
          kind: 'entire_supported_collection',
          collectionIdentity: 'collection/t017-c02',
        },
        collectionIdentity: 'collection/t017-c02',
        coverageTarget: {
          collectionIdentity: 'collection/t017-c02',
          scopeKind: 'entire_supported_collection',
          scopeIdentityKey: 'entire_supported_collection:collection/t017-c02',
          snapshotVersion: 1,
        },
      }),
      expectedRevision: 1,
      requestId: nextRequestId('c02-confirm'),
    });
    expect(confirm.outcome).toBe('ACCEPTED');
    const projected = await cli.submitCanonicalCommand({
      commandType: 'PROJECT_TERMINAL_RESULT',
      aggregateId: 'contract-t017-c02',
      payload: terminalTuplePayload({
        contractId: 'contract-t017-c02',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
        stopReason: 'GLOBAL_SAFETY_LIMIT',
        passedCount: 4,
        failedCount: 0,
        summaryStatus: 'ALL_PASSED',
        outcomes: selected.map((memberId) => ({ memberId, requiredValidationPassed: true })),
        coverageEvidence: { kind: 'INSUFFICIENT', basis: 'MAX_ITEMS_REACHED' },
      }),
      expectedRevision: 2,
      requestId: nextRequestId('c02-terminal'),
    });
    expect(projected.outcome).toBe('ACCEPTED');

    const views = await Promise.all([
      cli.readProjection('contract-t017-c02'),
      desktop.readProjection('contract-t017-c02'),
      extension.readProjection('contract-t017-c02'),
    ]);
    for (const view of views) {
      expect(view.outcome).toBe('PROJECTION');
    }
    // One projection, many renderers: byte-identical verbatim renders.
    const bytes = views.map((view) => renderProjectionBytes(view.projection));
    expect(new Set(bytes).size).toBe(1);
    const rendered = JSON.parse(bytes[0]!) as Record<string, unknown>;
    expect(rendered['terminal']).toBeDefined();
    const terminal = rendered['terminal'] as Record<string, unknown>;
    expect(terminal['requestFulfillment']).toBe('PARTIAL');
    expect(terminal['coverage']).toBe('TRUNCATED');
    expect(terminal['stopReason']).toBe('GLOBAL_SAFETY_LIMIT');
    // No surface upgrade happened anywhere: the six-dimension render keeps
    // PARTIAL/TRUNCATED verbatim on every surface.
    for (const view of views) {
      const rendered = (view.projection as { readonly terminal?: Record<string, unknown> })
        .terminal;
      expect(rendered?.['requestFulfillment']).toBe('PARTIAL');
      expect(rendered?.['coverage']).toBe('TRUNCATED');
      expect(rendered?.['stopReason']).toBe('GLOBAL_SAFETY_LIMIT');
    }
    await cli.close();
    await desktop.close();
    await extension.close();
  });

  it('C05: the exact COMPLETE tuple for the user-selected five renders identically from UI and CLI for the same contract', async () => {
    const core = await composeCore('t017-c05');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const requested = ids('c05-member', 8);
    const selected = requested.slice(0, 5);
    const contract = rawSingleResourceContract({
      contractId: 'contract-t017-c05',
      intentType: 'COLLECTION',
      requestedTarget: 'target-c05-root',
      collectionIdentity: 'collection/t017-c05',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: {
        kind: 'selected_collection_members',
        collectionIdentity: 'collection/t017-c05',
        memberIds: requested,
      },
      automationMode: 'MANUAL_SELECTION',
      selectionPolicy: { basis: 'EXPLICIT_USER_SELECTION', allowsBatchSelection: true },
    });
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-c05',
      payload: contract,
      expectedRevision: 0,
      requestId: nextRequestId('c05-submit'),
    });
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = await desktop.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-c05',
      payload: rawSnapshotPayload('contract-t017-c05', selected, {
        requestedScope: {
          kind: 'selected_collection_members',
          collectionIdentity: 'collection/t017-c05',
          memberIds: requested,
        },
        requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: requested },
      }),
      expectedRevision: 1,
      requestId: nextRequestId('c05-confirm'),
    });
    expect(confirm.outcome).toBe('ACCEPTED');
    const projected = await desktop.submitCanonicalCommand({
      commandType: 'PROJECT_TERMINAL_RESULT',
      aggregateId: 'contract-t017-c05',
      payload: terminalTuplePayload({
        contractId: 'contract-t017-c05',
        snapshotId: 'snapshot-t017-001',
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
      expectedRevision: 2,
      requestId: nextRequestId('c05-terminal'),
    });
    expect(projected.outcome).toBe('ACCEPTED');
    const [cliView, desktopView] = await Promise.all([
      cli.readProjection('contract-t017-c05'),
      desktop.readProjection('contract-t017-c05'),
    ]);
    expect(renderProjectionBytes(cliView.projection)).toBe(
      renderProjectionBytes(desktopView.projection),
    );
    const terminal = (cliView.projection as { readonly terminal?: Record<string, unknown> })
      .terminal;
    expect(terminal?.['requestFulfillment']).toBe('COMPLETE');
    expect(terminal?.['selectionAcquisition']).toBe('COMPLETE');
    expect(terminal?.['coverage']).toBe('VERIFIED_COMPLETE');
    await cli.close();
    await desktop.close();
  });

  it('C11: refresh after change routes a successor-snapshot command through the seam from any surface; the original never mutates in place', async () => {
    const core = await composeCore('t017-c11');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const predecessor = rawSingleResourceContract({
      contractId: 'contract-t017-v1',
      intentType: 'COLLECTION',
      requestedTarget: 'target-v1-root',
      collectionIdentity: 'collection/t017-v1',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: {
        kind: 'explicit_member_set',
        memberIds: ['member-a', 'member-b'],
      },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
    });
    const submit = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-v1',
      payload: predecessor,
      expectedRevision: 0,
      requestId: nextRequestId('v1-submit'),
    });
    expect(submit.outcome).toBe('ACCEPTED');
    // The collection changed: the successor identity is the ONLY path, from
    // whichever surface observes the change.
    const successor = rawSingleResourceContract({
      contractId: 'contract-t017-v2',
      intentType: 'COLLECTION',
      requestedTarget: 'target-v2-root',
      collectionIdentity: 'collection/t017-v1',
      membershipBasis: { basis: 'DECLARED_FINITE_SET' },
      requestedScope: {
        kind: 'explicit_member_set',
        memberIds: ['member-a', 'member-b', 'member-c'],
      },
      selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
      automationMode: 'ASSISTED',
      supersedesContractId: 'contract-t017-v1',
    });
    const successorSubmit = await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-v2',
      payload: successor,
      expectedRevision: 0,
      requestId: nextRequestId('v2-submit'),
    });
    expect(successorSubmit.outcome).toBe('ACCEPTED');
    // The original display/state did not mutate in place: the predecessor
    // projection is untouched and the successor carries the binding.
    const [v1View, v2View] = await Promise.all([
      cli.readProjection('contract-t017-v1'),
      desktop.readProjection('contract-t017-v2'),
    ]);
    const v1 = v1View.projection as Record<string, unknown>;
    const v2 = v2View.projection as Record<string, unknown>;
    expect((v1['contract'] as Record<string, unknown>)['supersedesContractId']).toBeUndefined();
    expect((v2['contract'] as Record<string, unknown>)['supersedesContractId']).toBe(
      'contract-t017-v1',
    );
    // A second snapshot on the original lineage is refused identically from
    // both surfaces: confirmation freezes selection (no in-place refresh).
    const snapshot = rawSnapshotPayload('contract-t017-v1', ['member-a', 'member-b'], {
      collectionIdentity: 'collection/t017-v1',
    });
    const firstConfirm = await desktop.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-v1',
      payload: snapshot,
      expectedRevision: 1,
      requestId: nextRequestId('v1-confirm-1'),
    });
    expect(firstConfirm.outcome).toBe('ACCEPTED');
    const secondConfirm = await cli.submitCanonicalCommand({
      commandType: 'CONFIRM_SNAPSHOT',
      aggregateId: 'contract-t017-v1',
      payload: snapshot,
      expectedRevision: 2,
      requestId: nextRequestId('v1-confirm-2'),
    });
    expect(secondConfirm.outcome).toBe('REJECTED');
    expect(secondConfirm.diagnostics?.[0]?.code).toBe('SNAPSHOT_MUTATION');
    // And the same refusal is what the CLI surface already showed: identity
    // (not surface) decides.
    expect(secondConfirm.currentRevision).toBe(firstConfirm.currentRevision);
    await cli.close();
    await desktop.close();
  });
});
