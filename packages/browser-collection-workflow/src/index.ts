/**
 * @xdownload/browser-collection-workflow — T016 browser + collection workflow
 * integration (S2/S5/S6).
 *
 * ONE composition/orchestration layer over the already-merged packages,
 * consumed as-is through their public APIs:
 *
 * - @xdownload/browser-observation (T010): untrusted-input gate, provenance-
 *   bound observation records (EVIDENCE_INPUT_ONLY), redacted handoff;
 * - @xdownload/browser-auth-broker (T010): strict allowed_origins, expiring
 *   scoped capabilities bound to exact tuples, truthful lifecycle;
 * - @xdownload/discovery-recipe (T011): bounded discovery, recipe engine,
 *   confirmation workflow, continuation admission/successor machinery;
 * - @xdownload/core-runtime (T015): THE authoritative composition root — all
 *   acquisition runs through its canonical budget ports and all terminal
 *   truth comes only through its T007 projection.
 *
 * No domain decision is made in glue: statuses, verdicts, capability
 * validity, membership identity, coverage truth, continuation admission and
 * validation outcomes remain owned by the consumed packages and surface
 * verbatim. Canonical vocabulary comes only from @xdownload/domain-contracts.
 */

export {
  authStopFactsFromUse,
  capabilityBindingFor,
  inspectCapability,
  issueScopedCapability,
  revokeScopedCapability,
  useScopedCapability,
  type ScopedAuthorizationFacts,
} from './auth-lifecycle.ts';
export {
  composeObservationHandoff,
  locatorProvenanceFacts,
  projectS2Flow,
  runS2AttachmentFlow,
  type LocatorProvenanceFacts,
  type ObservationLaneOutcome,
  type S2AttachmentFlowInput,
  type S2AuthorizationInput,
  type S2HandoffOutcome,
  type S2HandoffRejection,
} from './s2-handoff.ts';
export {
  runCollectionFlow,
  type CollectionAuthorizationInput,
  type CollectionFlowInput,
  type CollectionFlowOutcome,
  type CollectionFlowRejection,
  type CollectionFlowResult,
  type MemberAcquisitionOutcome,
  type MemberDelivery,
} from './collection-flow.ts';
export {
  assertContinuationWithinFrozenScope,
  detectFrozenMembershipDrift,
  expandThroughSuccessor,
  planFailedMemberRetry,
  requestContinuation,
  type ContinuationExpansionBundle,
  type ContinuationExpansionInput,
  type ContinuationJustification,
  type ContinuationLaneDecision,
} from './continuation-lane.ts';
