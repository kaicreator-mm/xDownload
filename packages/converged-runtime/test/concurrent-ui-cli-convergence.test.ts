/**
 * TEST_MATRIX suite `concurrent-ui-cli-convergence` (T017).
 *
 * Must prove:
 * - concurrent UI + CLI clients against one Core instance converge on one
 *   status per lineage/effect identity;
 * - idempotent requestId replay across surfaces does not double-allocate;
 *   duplicate allocation is rejected by canonical identity (C13);
 * - interleaved control transitions (cancel/retry/resume) from different
 *   surfaces surface only as Core projections with no divergent or
 *   surface-invented status;
 * - per-frame peer authorization holds: a surface cannot inherit an earlier
 *   peer's admission.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createLoopbackClientTransport } from '@xdownload/core-seam';
import { bindSurfaceToCore, renderProjectionBytes } from '../src/index.ts';
import {
  SURFACES_WITHOUT_EXTENSION,
  boundSurface,
  composeCore,
  nextRequestId,
  rawSingleResourceContract,
  type ComposedCore,
} from './fixtures.ts';

const cores: ComposedCore[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) {
    await core.stop();
  }
});

describe('T017 concurrent-ui-cli-convergence', () => {
  it('concurrent CLI + DESKTOP_UI submissions of one aggregate converge: exactly one allocation, canonical identity rejects the duplicate (C13)', async () => {
    const core = await composeCore('t017-concurrent-dup');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const contract = rawSingleResourceContract({ contractId: 'contract-t017-race' });
    const results = await Promise.allSettled([
      cli.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-race',
        payload: contract,
        expectedRevision: 0,
        requestId: nextRequestId('race-cli'),
      }),
      desktop.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-race',
        payload: contract,
        expectedRevision: 0,
        requestId: nextRequestId('race-desktop'),
      }),
    ]);
    const responses = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value
        : (() => {
            throw result.reason;
          })(),
    );
    const accepted = responses.filter((response) => response.outcome === 'ACCEPTED');
    const rejected = responses.filter((response) => response.outcome === 'REJECTED');
    // Canonical identity — not surface identity — decides the winner, and the
    // loser's refusal is a typed Core verdict: DUPLICATE_ALLOCATION when the
    // revision matched, the revision gate when it raced stale.
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(['DUPLICATE_ALLOCATION', 'REVISION_MISMATCH']).toContain(
      rejected[0]?.diagnostics?.[0]?.code,
    );
    // One status per lineage identity: the single aggregate at revision 1.
    const view = await cli.readProjection('contract-t017-race');
    expect(
      (view.projection as { readonly contract: { readonly revision: number } }).contract.revision,
    ).toBe(1);
    // Sequential duplicate at the current revision: the canonical
    // DUPLICATE_ALLOCATION rejection, whichever surface drives it.
    const sequentialDuplicate = await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-race',
      payload: contract,
      expectedRevision: 1,
      requestId: nextRequestId('race-dup'),
    });
    expect(sequentialDuplicate.outcome).toBe('REJECTED');
    expect(sequentialDuplicate.diagnostics?.[0]?.code).toBe('DUPLICATE_ALLOCATION');
    await cli.close();
    await desktop.close();
  });

  it('idempotent requestId replay across surfaces converges without double-allocation; conflicting payloads reject (C13)', async () => {
    const core = await composeCore('t017-idempotent-replay');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const contract = rawSingleResourceContract({ contractId: 'contract-t017-replay' });
    const sharedRequestId = 'req-replay-shared-001';
    // The SAME idempotent identity submitted concurrently from two surfaces.
    const [fromCli, fromDesktop] = await Promise.all([
      cli.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-replay',
        payload: contract,
        expectedRevision: 0,
        requestId: sharedRequestId,
      }),
      desktop.submitCanonicalCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-t017-replay',
        payload: contract,
        expectedRevision: 0,
        requestId: sharedRequestId,
      }),
    ]);
    for (const response of [fromCli, fromDesktop]) {
      expect(response.outcome).toBe('ACCEPTED');
      expect(response.acceptance?.requestId).toBe(sharedRequestId);
    }
    // Exactly one allocation happened; the replay is marked converged.
    expect(
      fromCli.acceptance?.converged === true || fromDesktop.acceptance?.converged === true,
    ).toBe(true);
    expect(fromCli.acceptance?.revision).toBe(fromDesktop.acceptance?.revision);
    expect(fromCli.currentRevision).toBe(fromDesktop.currentRevision);
    // A different payload under the same identity is a conflicting duplicate:
    // typed rejection on every surface, order-independent.
    const conflict = await desktop.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-replay',
      payload: rawSingleResourceContract({
        contractId: 'contract-t017-replay',
        requestedTarget: 'target-tampered',
      }),
      expectedRevision: 1,
      requestId: sharedRequestId,
    });
    expect(conflict.outcome).toBe('REJECTED');
    expect(conflict.diagnostics?.[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
    await cli.close();
    await desktop.close();
  });

  it('interleaved control transitions from different surfaces surface only as Core projections with no divergent status', async () => {
    const core = await composeCore('t017-interleaved-control');
    cores.push(core);
    const cli = boundSurface('CLI', core);
    const desktop = boundSurface('DESKTOP_UI', core);
    const submitted = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-control',
      payload: rawSingleResourceContract({ contractId: 'contract-t017-control' }),
      expectedRevision: 0,
      requestId: nextRequestId('control-submit'),
    });
    expect(submitted.outcome).toBe('ACCEPTED');
    // Desktop cancels; CLI observes the SAME Core projection.
    const cancel = await desktop.submitCanonicalCommand({
      commandType: 'CANCEL_LINEAGE',
      aggregateId: 'contract-t017-control',
      expectedRevision: 1,
      requestId: nextRequestId('control-cancel'),
    });
    expect(cancel.outcome).toBe('ACCEPTED');
    const cancelOrder = (await desktop.readProjection('contract-t017-control')).projection as {
      readonly lineage: { readonly status: string; readonly cancelOrder?: number };
    };
    expect(cancelOrder.lineage.status).toBe('CANCELLED');
    // A second cancel from the OTHER surface converges on the same Core
    // order: no new precedence, no revision bump, no divergent status.
    const secondCancel = await cli.submitCanonicalCommand({
      commandType: 'CANCEL_LINEAGE',
      aggregateId: 'contract-t017-control',
      expectedRevision: 2,
      requestId: nextRequestId('control-cancel-2'),
    });
    expect(secondCancel.outcome).toBe('ACCEPTED');
    expect(secondCancel.currentRevision).toBe(cancel.currentRevision);
    // Both surfaces render the identical post-control projection.
    const [cliView, desktopView] = await Promise.all([
      cli.readProjection('contract-t017-control'),
      desktop.readProjection('contract-t017-control'),
    ]);
    expect(renderProjectionBytes(cliView.projection)).toBe(
      renderProjectionBytes(desktopView.projection),
    );
    expect(
      (cliView.projection as { readonly lineage: { readonly cancelOrder?: number } }).lineage
        .cancelOrder,
    ).toBe(cancelOrder.lineage.cancelOrder);
    await cli.close();
    await desktop.close();
  });

  it('per-frame peer authorization holds: no identity inheritance across frames and no surface outside the admitted scope', async () => {
    const core = await composeCore('t017-per-frame', SURFACES_WITHOUT_EXTENSION);
    cores.push(core);
    const cli = boundSurface('CLI', core);
    // An authorized CLI frame is admitted...
    const admitted = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-frame',
      payload: rawSingleResourceContract({ contractId: 'contract-t017-frame' }),
      expectedRevision: 0,
      requestId: nextRequestId('frame-cli'),
    });
    expect(admitted.outcome).toBe('ACCEPTED');
    // ...and the very next frame from a forged identity is rejected per
    // frame: the earlier admission is never inherited.
    const forged = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-attacker',
      userId: 'user-attacker',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('forged'),
    });
    const forgedQuery = await forged.readProjection('contract-t017-frame');
    expect(forgedQuery.outcome).toBe('REJECTED');
    expect(forgedQuery.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    // A deployment that excludes the extension surface is enforced by Core
    // per frame — PEER_UNAUTHORIZED, distinct from the identity rejection.
    const extension = boundSurface('BROWSER_EXTENSION', core);
    const unauthorized = await extension.readProjection('contract-t017-frame');
    expect(unauthorized.outcome).toBe('REJECTED');
    expect(unauthorized.diagnostics?.[0]?.code).toBe('PEER_UNAUTHORIZED');
    // The authorized surface still reads the same projection.
    const stillAdmitted = await cli.readProjection('contract-t017-frame');
    expect(stillAdmitted.outcome).toBe('PROJECTION');
    await cli.close();
    await forged.close();
    await extension.close();
  });
});
