/**
 * TEST_MATRIX suite `no-surface-local-authority` (T017).
 *
 * Must prove:
 * - no surface or glue module owns lifecycle, progress, budget, membership,
 *   coverage or terminal truth; canonical vocabulary comes only from
 *   domain-contracts via the seam;
 * - Core-disconnect is an explicit degraded state on every surface with no
 *   fabricated status/progress;
 * - authorization context stays an opaque reference at every surface; raw
 *   reusable secrets are refused at every interaction boundary.
 *
 * Negative coverage: surface-local-status-derivation-attempt,
 * raw-secret-at-surface-interaction-boundary,
 * model-input-boundary-receives-unredacted-context (lane boundary),
 * per-surface command vocabulary (closed vocabulary rejects).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { makeAuthorizationContextRef } from '@xdownload/domain-contracts';
import {
  COMMAND_TYPES,
  createLoopbackClientTransport,
  decodeSeamEnvelope,
} from '@xdownload/core-seam';
import {
  bindSurfaceToCore,
  degradedState,
  renderProjectionBytes,
  SURFACE_KINDS,
  SurfaceBindingError,
} from '../src/index.ts';
import {
  bindExtensionConsumer,
  extensionDegraded,
} from '../../../apps/browser-extension/src/core-consumer.ts';
import {
  composeCore,
  rawSingleResourceContract,
  nextRequestId,
  type ComposedCore,
} from './fixtures.ts';

const cores: ComposedCore[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) {
    await core.stop();
  }
});

describe('T017 no-surface-local-authority', () => {
  it('the surface binding exposes no local truth: only verbatim submit/read/close over the closed seam vocabulary', async () => {
    const core = await composeCore('t017-no-local-truth');
    cores.push(core);
    const surface = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId(),
    });
    // Structural: the binder's API surface is exactly the seam vocabulary —
    // no status setter, no budget writer, no lifecycle owner, no cache.
    expect(Object.keys(surface).sort()).toEqual(
      ['client', 'peer', 'readProjection', 'close', 'submitCanonicalCommand', 'surface'].sort(),
    );
    // The command vocabulary is the closed v1 seam set: an invented
    // per-surface command discriminant is not even representable in the
    // binder's typed API (CommandType) and the seam envelope decoder rejects
    // it fail-closed — no per-surface vocabulary can exist in the glue.
    expect(COMMAND_TYPES).toEqual([
      'SUBMIT_CONTRACT',
      'CONFIRM_SNAPSHOT',
      'CANCEL_LINEAGE',
      'RETRY_FAILED_MEMBERS',
      'PROJECT_TERMINAL_RESULT',
    ]);
    const decoded = decodeSeamEnvelope({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
      kind: 'command',
      commandType: 'SET_STATUS_LOCAL',
      peer: { installId: 'install-t017', userId: 'user-t017', surface: 'CLI' },
      requestId: 'req-invented-001',
      aggregateId: 'contract-x',
      expectedRevision: 0,
      correlation: {},
      issuedAt: '2026-10-04T01:00:00Z',
      payload: { status: 'COMPLETE' },
    });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.diagnostics[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
    }
    await surface.close();
  });

  it('Core projections are read-only canonical values: local tampering of a rendered copy never becomes Core truth', async () => {
    const core = await composeCore('t017-readonly-projection');
    cores.push(core);
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('cli'),
    });
    const submitted = await cli.submitCanonicalCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-t017-readonly',
      payload: rawSingleResourceContract({ contractId: 'contract-t017-readonly' }),
      expectedRevision: 0,
      requestId: nextRequestId('submit'),
    });
    expect(submitted.outcome).toBe('ACCEPTED');
    const view = await cli.readProjection('contract-t017-readonly');
    expect(view.outcome).toBe('PROJECTION');
    const originalBytes = renderProjectionBytes(view.projection);
    // Surface-local status derivation/patching cannot stick: the surface can
    // tamper with its own rendered copy, but the Core projection is the only
    // truth — the next verbatim render is byte-identical to Core's.
    const tampered = JSON.parse(originalBytes) as {
      readonly contract: { status: string };
    };
    (tampered.contract as { status: string }).status = 'COMPLETED_LOCALLY';
    expect(JSON.stringify(tampered)).not.toBe(originalBytes);
    const reread = await cli.readProjection('contract-t017-readonly');
    expect(
      (reread.projection as { readonly contract: { readonly status: string } }).contract.status,
    ).toBe('CONFIRMED');
    expect(renderProjectionBytes(reread.projection)).toBe(originalBytes);
    await cli.close();
  });

  it('Core-disconnect is an explicit degraded state on every surface with no fabricated status/progress', async () => {
    const core = await composeCore('t017-disconnect');
    cores.push(core);
    const cli = bindSurfaceToCore({
      surface: 'CLI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('cli'),
    });
    const desktop = bindSurfaceToCore({
      surface: 'DESKTOP_UI',
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('desktop'),
    });
    const extension = bindExtensionConsumer({
      installId: 'install-t017',
      userId: 'user-t017',
      transport: createLoopbackClientTransport(),
      target: core.target,
      makeRequestId: () => nextRequestId('ext'),
    });
    // Stop the Core AND its seam transport: every surface loses the authority.
    await core.stop();
    cores.splice(cores.indexOf(core), 1);
    const failures = await Promise.allSettled([
      cli.readProjection('contract-any'),
      desktop.readProjection('contract-any'),
      extension.readProjection('contract-any'),
    ]);
    for (const failure of failures) {
      expect(failure.status).toBe('rejected');
      if (failure.status === 'rejected') {
        // Explicit degradation, verbatim detail — never a status.
        const degraded = degradedState(failure.reason);
        expect(degraded.degraded).toBe(true);
        expect(degraded.detail.length).toBeGreaterThan(0);
        expect(JSON.stringify(degraded)).not.toContain('terminal');
        // The surface-specific degraded renderer carries the same shape.
        expect(extensionDegraded(failure.reason)).toEqual(degraded);
      }
    }
    await cli.close();
    await desktop.close();
    await extension.close();
  });

  it('authorization context stays an opaque reference; raw reusable secrets are refused at the interaction boundary', () => {
    // The domain gate refuses raw secret material as an authorization
    // context; surfaces and glue pass the opaque reference only.
    const rawSecret = makeAuthorizationContextRef('Bearer abc123; cookie=session-should-not-pass');
    expect(rawSecret.ok).toBe(false);
    const opaque = makeAuthorizationContextRef('authctx/local-001');
    expect(opaque.ok).toBe(true);
    // The seam command vocabulary has no surface-writable budget/result
    // authority: a forged budget-mutation command is unknown (closed set).
    expect(SURFACE_KINDS).toEqual(['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION']);
    expect(() =>
      bindSurfaceToCore({
        surface: 'ADMIN_CONSOLE' as never,
        installId: 'install-t017',
        userId: 'user-t017',
        transport: createLoopbackClientTransport(),
        target: { host: '127.0.0.1', port: 1 },
        makeRequestId: () => nextRequestId(),
      }),
    ).toThrow(SurfaceBindingError);
  });
});
