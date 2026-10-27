# S6 successor — finite playlist/gallery navigation and coverage (v0.1.0)

**Authority:** #110; **status:** PROPOSED / independent exact-SHA review required.  
**Frozen base:** `version/v0.1.0@0d9fd0bb6c5c3cb735e7feedd148228f15d8bc78`.  
**Product:** PRD §§9–10, 14–17, 19–22, 28 S6, 29, 31; L2/T011/T016. **Dependency:** reviewed and adopted #109 S5 collection authority and a separate #110 carrier review. Neither #103 S1 nor #109 S5 implicitly authorizes S6 navigation.

## Supported scope / user selection

The installed user explicitly selects a playlist/gallery `CollectionIdentity` and confirms the exact desired requested scope, supported membership relation and **declared finite or naturally terminable continuation scope** (PRD §28 S6). Use the already-closed `RequestedScope` and `ContinuationScope` pair: bounded page selections use `requestedScope.kind=collection_page_range` with `continuationScope.kind=DECLARED_PAGE_RANGE` and matching 1-based `fromPage/toPage`; complete supported collections use `requestedScope.kind=entire_supported_collection` and `continuationScope.kind=DECLARED_NATURAL_END` **only when natural-end semantics are independently supported**. **Erratum (R1 #173, one-sentence scope clarification only):** for `collection_page_range` the declared range is already exactly bounded by its immutable `fromPage/toPage`, so the canonical frozen `validateScopeContinuationPair` requires `continuationScope.kind=NONE` for this scope and the `DECLARED_PAGE_RANGE` pairing in the preceding sentence is superseded (any later page expansion requires an explicit user-confirmed successor contract and snapshot, never a mutation of the confirmed one). Never invent a generic frontier scope, infer end-of-list from exhausted budget, or mutate a confirmed scope to include new pages. Run the frozen `validateScopeContinuationPair` before admitting the Core navigation carrier. Allowed generated capabilities are only those already typed in T011: `observe_current_page`, `observe_network`, `observe_player`, `collect_candidates`, `scroll_current_page`, `open_confirmed_member_detail`, `follow_declared_collection_continuation`; no `general crawl(url)`, arbitrary link recursion or website frontier. An action with implicit/unspecified `continuationScope` or new member outside frozen authority is rejected. Budget exhaustion cannot create a natural-end assertion. To expand the declared scope requires explicit user confirmation of a *successor* contract and snapshot; it never modifies the current one.

## Core-owned execution authority

1. A real installed browser surface observes a supported collection relation and records provenance, candidate identities and explicit user scope decision. The privileged broker binds origin, contract, snapshot, member, authorization partition and TTL; no raw tokens/cookies leave the privilege boundary. An AI proposal/Recipe is only a hypothesis and cannot independently verify requested membership or natural-end.
2. An **S6-specific reviewed typed Core carrier** binds immutable CollectionIdentity, requested scope, membership/continuation plan, selected members, auth-context ref, declared delivery hosts and bounded budget. It is not a general-purpose URL/action API. The Core records each accepted navigation/transfer intent and budget allocation durably **before generated network/navigation effects**, and retains single authority over membership, selection, artifacts and final result.
3. Reuse T011 `discovery-recipe/{capabilities,continuation,slices}.ts`, T016 `browser-collection-workflow/{continuation-lane,collection-flow}.ts`; typed planned actions must be traceable to the frozen acquisition contract. Only the privileged browser executes authorized browsing capabilities, with recorded observations returned as untrusted evidence. Core independently reconciles and gates each expansion and transfer. A browser observation alone cannot promote itself into Membership/Coverage validation.
4. A member-detail page may be opened **only for already confirmed members**. Supported member delivery and cross-origin CDN must remain provenance-bound. Reuse reviewed per-member S1/S3/S4 routes only where those slices are actually supported and validated. Transfer/Format/Target + Membership/Coverage evidence and one canonical Core artifact per accepted selected member are required.
5. The authoritative terminal separates **requested-scope coverage** from accessible-subset successes and optional parent coverage. **Canonical 18/16/2 case:** requested=18, accounted=18, auth-accessible=16, inaccessible=2, selected=16, validated=16; `RequestFulfillmentStatus=PARTIAL`, `TargetResolutionStatus=RESOLVED`, `SelectionAcquisitionStatus=COMPLETE`, `CoverageStatus=VERIFIED_COMPLETE`, `StopReason=AUTH_REQUIRED` (PRD §17.2), never 16/16 complete fulfillment. Unknown identities/unauthorized context must degrade resolution/coverage consistently.
6. Natural-end proof needs independently validated supported API/template end semantics or complete finite member reference set; count equality, max_items, page limit, timeout, failed next, or budget exhaustion alone are insufficient. Failure to close a supported declared scope yields truthful TRUNCATED/UNKNOWN. Crash, retry, budget and cancel preserve immutable member identity and remaining limits; no duplicate transfers or accepted artifacts.

## Negative matrix / required G1b evidence

| Counterexample | Must occur |
|---|---|
| User requests whole 18 but auth reaches only 16 | Frozen 18/16/2 tuple, no inaccessible-member erasure or unauthorized access |
| User requests pages 1–3 of 10 | Validate pages 1–3; do not claim entire parent complete |
| Continuation scope NONE yet "load more" clicked | Reject current-scope expansion; successor contract required |
| Page limit / retry exhaustion with unknown natural-end | TRUNCATED/UNKNOWN, no false COMPLETE |
| Pagination loop / changed relation / membership drift | Stop with scope/identity diagnostic, no arbitrary frontier |
| Browser attempts off-scope detail or unbound domain | Refuse, no secret leakage |
| Count-equal but missing independent identity correspondence | Coverage cannot be VERIFIED_COMPLETE |
| Kill during navigation/segment acquisition, then reopen | Reconcile durable intents/budgets, never double-charge or silently promote unobserved members |
| Synthetic fixture supplies all member IDs without real user navigation | Does not establish installed S6 G1b PASS |

## Independent gate

Fresh exact-SHA #110 contract review **after confirming dependency on #109** → bounded Core continuation carrier PR → installed browser navigation + selection PR → real Chrome/Edge with auth/natural-end/membership source and exact evidence for an actual user-triggered S6 navigation → #100 reachability gate → version T019–T023 requalification → #81 true human G0/G1b (instrumented; no AI proxy or manual oracle entry). This review authorizes no implementation and no unsupported capability.

No general scraping engine, DRM bypass, hidden membership expansion, or Product/L2/DAG edits. **RELEASE_PASS=NO.**
