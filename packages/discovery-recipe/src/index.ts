/**
 * @xdownload/discovery-recipe — T011 declarative Recipe engine, bounded
 * discovery orchestration, collection/member identity handling, continuation
 * admission and selection/confirmation workflow logic.
 *
 * Consumes the T002 canonical vocabulary (`@xdownload/domain-contracts`) as
 * the only scope/snapshot/budget/evidence authority. Pure decision logic:
 * no browser, network, filesystem, transfer, persistence or scheduler
 * behavior, no URL frontier, no budget-as-scope.
 */

export * from './capabilities.ts';
export * from './recipe.ts';
export * from './discovery.ts';
export * from './identity.ts';
export * from './continuation.ts';
export * from './confirmation.ts';
export * from './slices.ts';
