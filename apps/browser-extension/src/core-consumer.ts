/**
 * T017 browser-extension consumer-side convergence wiring.
 *
 * The extension surface stays consumer/verification only (frozen T017
 * boundary; packaging/bundling is T018; T010 privileged-logic semantics
 * stand and the service worker is untouched). This module is the declared
 * consumer contract of the converged runtime for SurfaceKind
 * 'BROWSER_EXTENSION':
 *
 * - the extension surface connects through the SAME shared one-authority
 *   binder as CLI/Desktop — there is no extension-private transport, no
 *   privileged seam bypass, and Native Messaging remains the only broker
 *   transport (the seam client ride happens over the T018 platform IPC);
 * - the lane contributes EVIDENCE and INTENT only: it reads Core projections
 *   and submits commands through the closed canonical seam vocabulary. It
 *   never owns transfer lifecycle, progress authority or terminal truth —
 *   outcomes render through the same Core projection as every other
 *   surface's view of the same lineage.
 */

import {
  bindSurfaceToCore,
  degradedState,
  type BoundSurface,
  type SurfaceBindingInput,
} from '@xdownload/converged-runtime';
import type { SeamClientTransport, SeamListenTarget } from '@xdownload/core-seam';

/** The extension surface kind is fixed: this binding is the BROWSER_EXTENSION peer. */
export const BROWSER_EXTENSION_SURFACE = 'BROWSER_EXTENSION' as const;

export interface ExtensionConsumerBindingInput {
  readonly installId: string;
  readonly userId: string;
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  readonly makeRequestId: () => string;
  readonly now?: () => string;
}

/**
 * Bind the extension's consumer surface to the single Core authority. The
 * per-frame peer authorization remains the seam server's decision: a
 * deployment that excludes 'BROWSER_EXTENSION' from `allowedSurfaces` is
 * enforced by Core, never negotiated here.
 */
export function bindExtensionConsumer(input: ExtensionConsumerBindingInput): BoundSurface {
  const binding: SurfaceBindingInput = {
    surface: BROWSER_EXTENSION_SURFACE,
    installId: input.installId,
    userId: input.userId,
    transport: input.transport,
    target: input.target,
    makeRequestId: input.makeRequestId,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  return bindSurfaceToCore(binding);
}

/**
 * Explicit degraded state for the consumer surface: the verbatim transport
 * failure, never a fabricated observation/progress/status.
 */
export function extensionDegraded(error: unknown): {
  readonly degraded: true;
  readonly detail: string;
} {
  return degradedState(error);
}
