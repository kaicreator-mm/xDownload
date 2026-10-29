/**
 * @xdownload/desktop-ui — T014 desktop presentation/interaction adapter.
 *
 * Thin desktop surface over the `@xdownload/core-seam` authority boundary:
 * intent entry, immutable scope preview/confirmation, selection/confirmation
 * flows driven by the canonical confirmation workflow, truthful multi-
 * dimensional status/result explanation, cancellation/retry routing and
 * Core-disconnect degradation. The surface owns no contract/snapshot/
 * budget/result truth; the concrete desktop shell/renderer remains
 * replaceable (L2 U9/ADR-012).
 */

export * from './commands.ts';
export * from './display.ts';
export * from './payloads.ts';
export * from './projection-decode.ts';
export * from './view-model.ts';
export * from './adapter.ts';
