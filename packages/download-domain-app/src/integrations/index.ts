/**
 * v0.2 T12 — integration-other lane public index (S2–S6 + media convergence
 * under K). Consumers import only these named exports.
 *
 * V022-A02: this barrel no longer surfaces Host bridge/runtime assembly
 * (`assembleMediaRuntime`, `assembleS4HlsRuntime`, the `MEDIA_BRIDGE_PIN` /
 * `S4_HLS_BRIDGE_PIN` pin names, the runtime option/counter types) — the
 * physical assembly moved to the Core composition root (A04). Domain-owned
 * surfaces stay: sealed BUILD producers/identities, the frozen routes and
 * operation declarations, Business Intent validators, the media targetRef
 * registry grammar, the S4 contribution seam and the domain journeys.
 * Transitional Core-compat symbols (`InMemoryMediaTargetRegistry`,
 * `acquireS4HlsBridgePin`, `S4HlsRuntime`, …) remain reachable at their deep
 * module paths only; the current Core route deep-imports them until A04.
 *
 * Release-claimed journey coverage (T10 baseline vocabulary):
 *
 *   - S3 "Direct Media File"  → `submitConfirmedMediaDownload` over the
 *     sealed media composition + the T06 media bridge. PROVEN at
 *     bounded-HLS-fixture level (real master→playlist→segments run through
 *     the existing engine under one K permit, digest-backed materialization);
 *     the fixture proof relocates to Core A04 with the assembly.
 *     Installed-path media validation is NOT_PROVEN here (owner: T16
 *     validation-product).
 *   - S2 "Browser Download Handoff / Explicit Current-page Attachment" →
 *     `runS2DiscoveryJourney`. PROVEN at logical-chain + bounded-fixture
 *     level. Installed browser sessions NOT_PROVEN here (owner: T15
 *     validation-browser).
 *   - S5 "Current-page Resource Collection" → `runS5CollectionJourney`.
 *     PROVEN at logical-chain + bounded-fixture level; installed NOT_PROVEN
 *     (owners: T15 browser / T16 product).
 *   - S6 "Explicit Playlist / Gallery Collection" → `runS6NavigationJourney`.
 *     PROVEN at logical-chain + bounded-fixture level; installed NOT_PROVEN
 *     (owners: T15 browser / T16 product).
 *
 * No-widening invariants shared by every entry: finite declared member sets
 * only; authorization on the frozen T01 contract (S1/S3 slices,
 * acquisition.acquire / media.acquire); zero browser-context representation
 * (the T08 payload-construction discipline); no second ledger, no second
 * engine, no unsupported sites, no broadened crawl.
 */
export {
  APP_ID_MEDIA,
  BUILD_ID_MEDIA,
  MEDIA_ACQUIRE_OPERATION,
  MEDIA_BUSINESS_MODULE_ID,
  MEDIA_CAPABILITY_MODULE_ID,
  MEDIA_ROUTE,
  MEDIA_SLICE,
  sealMediaComposition,
  submitConfirmedMediaDownload,
  type MediaJourneySummary,
  type MediaSubmissionOutcome,
  type SealedMediaComposition,
  type SubmitConfirmedMediaOptions,
} from './s3-media.ts';
export {
  MEDIA_REGISTRY_PROTOCOLS,
  validateMediaTargetRecord,
  type MediaTargetRecord,
  type MediaTargetRefSeed,
} from './media-registry.ts';
export {
  runS2DiscoveryJourney,
  type S2ConfirmationFacts,
  type S2DiscoveryJourneyRequest,
  type S2DiscoveryOutcome,
  type S2SemanticInput,
} from './s2-discovery.ts';
export {
  runS5CollectionJourney,
  type S5CollectionJourneyRequest,
  type S5CollectionOutcome,
} from './s5-collection.ts';
export {
  runS6NavigationJourney,
  type S6NavigationJourneyRequest,
  type S6NavigationOutcome,
} from './s6-navigation.ts';
export {
  SLICE_DIRECT_BINDING,
  buildDirectIntentCandidate,
  decidedOutcomePlan,
  intentCandidateDiagnostics,
  submitConfirmedMembers,
  validateBatchConfirmation,
  type SliceBatchConfirmationFacts,
  type SliceCallerIdentity,
  type SliceCollectionSummary,
  type SliceJourneyRefusal,
  type SliceMemberDeliveryFacts,
  type SliceMemberOutcome,
} from './slice-journey-shared.ts';

export {
  APP_ID_S4_HLS_VOD,
  BUILD_ID_S4_HLS_VOD,
  S4_HLS_ROUTE,
  sealS4HlsComposition,
  s4HlsCompositionContribution,
  s4HlsSealedPassthrough,
  submitConfirmedS4HlsVod,
  type S4HlsContribution,
  type S4HlsJourneyResult,
} from './s4-hls-vod.ts';
export {
  S4_HLS_MEDIA_OPERATION,
  S4_HLS_MEDIA_PROFILE,
  s4HlsSelectionTupleDigest,
  validateConfirmedS4HlsIntent,
  type ConfirmedS4HlsIntent,
  type S4ConfirmedSelection,
} from './s4-hls-vod-contract.ts';
