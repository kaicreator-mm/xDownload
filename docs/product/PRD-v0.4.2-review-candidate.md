# xDownload PRD v0.4.2 — ADS Stage 1 Review Candidate

**Product:** xDownload  
**Initial product release target:** `v0.1.0`  
**PRD document revision:** `v0.4.2`  
**Document status:** Stage 1 Product/Scope Review Candidate  
**Product Freeze:** NO  
**Architecture Freeze:** NO  
**L2 eligibility:** NO  
**Implementation:** NOT STARTED  
**Date:** 2026-10-02

## Authority

This document is governed by the immutable project pin:

- Standard repository: `kaicreator-mm/ai-development-standard`
- Standard version: `4.0.0`
- Standard revision: `94cad2b0487e8a552c66d6bcd1cba36b7779383d`

Required Stage 1 upstream evidence:

- `docs/product/L1_PRODUCT_EVIDENCE.md`
- `docs/reviews/2026-10-02-v0.2-fresh-independent-adversarial-review.md`
- `docs/reviews/2026-10-02-v0.3-fresh-independent-adversarial-review.md`
- `docs/reviews/2026-10-02-v0.4-claude-fresh-independent-adversarial-review.md`
- Issue #2 terminal review `5950568942`

This is a Product/Scope contract only. It does not freeze architecture, implementation technology, module layout or runtime design.

---

# 0. Version Relationship and Supersession

`PRD-v0.4.2-review-candidate.md` is a **complete, self-contained successor Product/Scope contract**.

For Product Freeze review:

- this file **supersedes** `PRD-v0.4.1-review-candidate.md` as the current PRD subject;
- v0.4.1 and older PRDs remain provenance/history only;
- the only intended Product-contract changes from v0.4.1 are the R01–R03 repairs required by Issue #2/#3;
- no reader is required to combine old PRD clauses to determine current product behavior.

The PRD document revision `v0.4.2` is not the product release version. The initial product release target remains `xDownload v0.1.0`.

---

# 1. Product Problem

Users often know **what they want to save**, but do not know the final network URL, exact stream, correct variant, complete member set, or reliable way to organize the result.

Existing tools already solve basic transport well. Mature products also provide browser sniffing, extractor ecosystems, collection handling and AI/MCP control. xDownload therefore does **not** exist to prove that an LLM can download files.

The product problem is:

> **Reduce the discovery, selection, recovery and organization work required to correctly acquire a user-declared resource or bounded collection that the user is authorized to access, while preserving truthful result semantics and avoiding silent crawler-like scope expansion.**

---

# 2. Product Goal

Primary product goal:

> **让用户更方便、更正确、更可靠、以更低认知和操作成本，获取并整理自己明确想要且有权访问的网络资源。**

User-facing sequence:

```text
Discover
→ Select
→ Acquire
→ Validate
→ Organize
```

Internal product strategy:

```text
User Intent
→ deterministic/template path when possible
→ bounded discovery if necessary
→ low-cost user confirmation when ambiguity remains
→ bounded AI only for knowledge gaps
→ deterministic acquisition
→ independent validation
→ optional validated knowledge reuse
```

---

# 3. Product Priorities

Priority order:

```text
Correct target acquisition
>
Truthful status / no false success
>
Reliability / recovery
>
Low user cognitive and operational cost
>
Fast feedback
>
Automation level
>
AI usage
>
Knowledge reuse
>
Cross-user knowledge network
```

The product MUST NOT sacrifice correctness or transparency to increase automation percentage.

---

# 4. Target Users and Jobs

## 4.1 Primary user

Desktop user who wants to save resources visible or reachable from a browser without manually reverse-engineering resource URLs.

Typical jobs:

- save a known direct file;
- save the current page's attachment;
- save the current page's video/audio;
- choose the correct resource among several candidates;
- save desired items from an explicit finite page/playlist/gallery;
- retry or recover after an interrupted/changed source;
- keep downloaded outputs meaningfully grouped.

## 4.2 Automation user

Technical user or local Agent that needs stable CLI submission, machine-readable status and bounded non-interactive behavior.

## 4.3 Out-of-target user

xDownload is not designed as:

- a website crawler operator;
- a data scraping platform;
- a site indexing/monitoring system;
- a DRM/access-control bypass tool;
- a general web automation agent.

---

# 5. Core Product Principles

## 5.1 Minimum Necessary Intelligence

Use the least complex mechanism that can correctly satisfy the current task:

```text
Deterministic direct path
→ Known Template / Recipe
→ Template + user confirmation
→ LLM-assisted template adaptation
→ Bounded exploratory reasoning
→ Explicit UNKNOWN / UNSUPPORTED
```

LLM is not the default executor.

## 5.2 Minimum Necessary Interaction

Ask the user only when interaction materially resolves target, membership, scope, authorization/profile, quality or target-change ambiguity.

Preferred policy:

```text
Automation when reliable.
Batch/group confirmation before per-item confirmation.
Manual selection when semantic choice is inherently personal.
Silent guessing is forbidden.
```

## 5.3 Template-first Acquisition

The initial product assumes the valuable download problem is mostly recurring patterns plus parameters, not unconstrained Web Agent reasoning.

Initial pattern families:

- Direct File
- Current-page Attachment
- Direct Media
- HLS VOD
- Current-page Resource Collection
- Explicit Playlist
- Explicit Gallery
- Embedded Player
- Browser-authorized Resource
- Signed/Expiring URL

Bounded Pagination remains an experiment/P1 slice, not a v0.1.0 required release slice.

---

# 6. Product Surfaces

## 6.1 Desktop UI — primary

Primary interactive surface for ordinary users.

## 6.2 Browser Integration — core

Used to hand off ordinary browser downloads, observe current-page/network/player context, provide page/profile/session context locally, and expose candidates for current-page and supported collection workflows.

## 6.3 CLI — first-class automation surface

Used for direct submission, batch input, machine-readable status and Agent/local automation.

## 6.4 Deferred surfaces

Not required for v0.1.0 Product Freeze:

- public REST API;
- MCP server;
- SDK;
- remote worker/server mode.

Desktop, Browser and CLI MUST share the same product status semantics even if architecture later chooses separate processes.

---

# 7. AcquisitionIntent

```text
AcquisitionIntent
├── SingleResourceIntent
└── CollectionIntent
```

SingleResourceIntent covers explicit single URLs/files/media. CollectionIntent covers explicit bounded member relations such as current-page attachments, selected gallery members, supported playlists/galleries, and user-declared finite URL sets.

CollectionIntent is not “any finite crawl”.

---

# 8. AcquisitionContract

Every task MUST have one authoritative AcquisitionContract.

Required fields:

```text
AcquisitionContract
├── intent_type
├── requested_target
├── collection_identity?          # required for CollectionIntent
├── membership_basis?             # required for CollectionIntent
├── requested_scope
├── continuation_scope?           # explicit; NONE by default
├── selection_policy
├── automation_mode
├── exploration_permission
├── budget_profile
├── authorization_context_ref
├── selection_snapshot?
├── validation_policy
├── stop_policy
└── result_policy
```

UI, CLI and Browser Integration MUST project the same contract semantics.

`requested_scope` is immutable after user confirmation. `continuation_scope`, when present, is part of `requested_scope` semantics and is also immutable after confirmation. Any change that broadens/narrows scope, adds continuation authority, changes authorization context in a way that changes permissible acquisition, or re-enumerates changed membership MUST create a successor contract/snapshot identity rather than silently mutating the current one.

Budget values constrain execution inside the confirmed scope. A budget MUST NOT define, enlarge, narrow or silently rewrite user scope.

---

# 9. Collection Admission Contract

Collection acquisition is admitted only when **all** conditions are true:

1. `CollectionIdentity` is identifiable.
2. Membership relation is observable from a supported template/source or explicitly declared as a finite set by the user.
3. Requested scope is understandable to the user.
4. Navigation, when any, is limited to collection/member/declared continuation edges.
5. A hard stopping condition exists.
6. No arbitrary URL frontier is created.

A user declaration does not bypass the crawler boundary. “Search the first 1000 pages under example.com and download every PDF” is rejected because it creates a crawl/filter frontier. “Download these 100 explicitly listed URLs” is accepted because membership is user-declared and finite.

---

# 10. Scope Grammar

Scope and Budget are different concepts.

Supported scope primitives for v0.1.0:

```text
single_resource
current_page
explicit_member_set
entire_supported_collection
selected_collection_members
```

Optional/experimental primitive:

```text
collection_page_range
```

## 10.1 `current_page` membership boundary — R01 normative rule

For every `current_page` contract, membership is frozen from the **confirmed current-page membership snapshot**.

At contract confirmation, `current_page` includes only members that are already bound to the current document by the supported membership basis without executing a continuation action. This may include resources already represented by DOM/page metadata, already-observed network/player evidence, or another supported deterministic current-page relation.

Default rule:

```text
continuation_scope = NONE
```

Therefore content that would become a new member only after any of the following is **excluded by default**:

- user/automation scroll that triggers additional collection members;
- load-more action;
- infinite-scroll continuation;
- following a collection continuation edge;
- navigating to another logical collection page.

Passive completion of evidence for a member already in the confirmed membership snapshot MAY continue; it does not authorize adding a new member.

If the user wants continuation, it MUST be explicit before confirmation and bounded by one of these product scopes:

```text
DECLARED_BATCH_COUNT(n)
DECLARED_PAGE_RANGE(a..b)        # only for collection_page_range
DECLARED_NATURAL_END            # only for a supported collection with a validated natural-end relation
```

A continuation scope MUST be understandable before acquisition starts and MUST NOT be inferred from available DiscoveryBudget. “Continue until budget runs out” is not a valid user scope.

If `continuation_scope = NONE` and the user later chooses “load more / continue / include more”, the existing contract cannot expand. A **successor AcquisitionContract and successor SelectionSnapshot** are required.

If an explicit continuation scope exists at contract creation, continuation may remain in the same contract only within that exact frozen scope. Any later enlargement creates a successor contract/snapshot.

## 10.2 Continuation result semantics

For a default `current_page` contract (`continuation_scope = NONE`), successful accounting of the confirmed current-page snapshot may yield:

```text
RequestFulfillmentStatus = COMPLETE
TargetResolutionStatus = RESOLVED
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = VERIFIED_COMPLETE
StopReason = USER_SCOPE_REACHED
```

This means complete for the confirmed `current_page` scope only. It makes no claim that a parent feed/gallery has no additional continuation members.

For `DECLARED_BATCH_COUNT(n)` or `DECLARED_PAGE_RANGE(a..b)`, reaching the frozen requested bound is `USER_SCOPE_REACHED`; if all requested members are independently accounted/acquired, requested-scope coverage may be `VERIFIED_COMPLETE` even if a larger parent collection exists.

For `DECLARED_NATURAL_END`, if discovery stops before validated natural end because DiscoveryBudget is exhausted:

```text
RequestFulfillmentStatus = PARTIAL
TargetResolutionStatus = PARTIAL
SelectionAcquisitionStatus = COMPLETE   # only if all already-frozen selected targets succeeded
CoverageStatus = TRUNCATED
StopReason = DISCOVERY_BUDGET_EXHAUSTED
```

Budget exhaustion cannot be reinterpreted as the end of user scope.

## 10.3 Page-range semantics

If `collection_page_range` is used:

- page indices are **1-based logical collection pages anchored to the collection root**;
- `current_page` is a different scope and never means “page 1” implicitly;
- member detail pages do not increment collection-page count;
- iframe content is excluded unless a supported membership relation explicitly includes it;
- infinite-scroll/load-more is a continuation relation, never silently a numbered page;
- UI and CLI MUST display the resolved scope before acquisition starts.

---

# 11. Collection Sets and Scope Accounting

```text
C = CandidateSet
R = RequestedMemberReferenceSet
X = AuthAccessibleSubset of R under AuthorizationContextRef
M = ConfirmedMemberSet
S = SelectedTargetSet scheduled for acquisition
A = AcquiredValidatedSet
```

Rules:

- `C` is discovery output only.
- `R` is derived from the immutable confirmed `requested_scope`; authorization MUST NOT silently replace `R` with `X`.
- `X` records which requested members are currently accessible/authorized when that fact is knowable.
- `M` requires membership evidence.
- `S` is the frozen acquisition set and may be an explicit user-selected subset or the currently authorized/acquirable subset, but any omission from `R` MUST retain an explicit reason.
- `A` contains only targets that passed required acquisition validation.
- Count equality never substitutes for identity correspondence.

Parent collection coverage, requested-scope coverage and accessible-subset accounting are different facts and MUST NOT be substituted for each other.

---

# 12. SelectionSnapshot

After preview/selection is confirmed, create a SelectionSnapshot containing:

```text
snapshot_id
contract_id
collection_identity
requested_scope
continuation_scope
coverage_target
requested_member_identities_or_basis
auth_accessible_member_identities_or_basis
selected_member_identities
authorization_context_ref
profile_context_ref
selection_claims
source/version marker
created_at
```

Rules:

- retry/resume uses the same snapshot;
- failed-item retry cannot add new members;
- changed collection/profile/version requiring re-enumeration creates a new snapshot;
- adding continuation permission after confirmation creates a successor contract/snapshot;
- silent candidate replacement is forbidden.

---

# 13. Automation Modes and Interaction Cost

```text
AUTO
ASSISTED
MANUAL_SELECTION
```

AUTO requires sufficient evidence for material target/membership/scope claims. ASSISTED performs mechanical discovery but requests a small number of material confirmations. MANUAL_SELECTION exposes a candidate set when the final semantic choice is personal or ambiguous.

Interaction priority:

```text
one scope-level confirmation
→ one batch/group confirmation
→ small number of material item confirmations
→ manual selection UI
```

The product MUST NOT repeatedly ask item-by-item questions when a batch/manual selection surface resolves the same ambiguity.

Product experiments record confirmation count, user decision time, manual actions, recovery actions and abandonment caused by interaction burden.

---

# 14. Browser Observation and Navigation

Allowed Tools at product-contract level:

```text
observe_current_page
observe_network
observe_player
observe_frames
collect_candidates
scroll_current_page
open_confirmed_member_detail
follow_declared_collection_continuation
```

`scroll_current_page` is an allowed capability, not implicit scope authority. If scrolling reveals new members, those members are admitted only when the confirmed contract includes the matching explicit `continuation_scope`; otherwise they are outside the current contract and require a successor contract/snapshot.

Forbidden product capability:

```text
general crawl(url)
recursive arbitrary link following
general site frontier
continuous recrawl
```

Any active navigation MUST be traceable to the AcquisitionContract.

---

# 15. Budget Domains

Budgets are lifecycle-scoped and never silently replenished by retry/restart/repair.

## 15.1 DiscoveryBudget

Controls active actions whose purpose is resolving the target set, including collection navigation, metadata/probe requests, player/template probes, model calls for discovery/adaptation and generated discovery requests.

Passive browser traffic from a page the user is already using does not consume generated-request count, but remains evidence with provenance.

## 15.2 TransferBudget

Controls acquisition of frozen selected targets, including resource requests, HLS segments, downloaded bytes, active transfer time and retry transfer requests. Remote validation fetches that retrieve target bytes count against TransferBudget.

## 15.3 GlobalSafetyBudget

Hard ceiling across the entire Acquisition lifecycle, including global active elapsed time, total generated requests, configured model cost/calls and explicit safety limits. GlobalSafetyBudget has highest precedence.

## 15.4 Exhaustion precedence

- DiscoveryBudget exhausted → no new discovery/navigation; already frozen `S` MAY continue transfer if TransferBudget and GlobalSafetyBudget remain.
- TransferBudget exhausted → no further acquisition bytes/segments; result cannot claim acquisition completion.
- GlobalSafetyBudget exhausted → all generated work stops.
- Retry/restart/resume/repair inherit remaining budgets.
- User pause time is excluded from active elapsed-time counters unless a specific global wall-clock limit says otherwise.
- No budget limit creates or changes requested scope.

---

# 16. Result Model

A single `success` field is forbidden. Every final/terminal result MUST expose:

```text
RequestFulfillmentStatus
TargetResolutionStatus
SelectionAcquisitionStatus
CoverageStatus
StopReason
ValidationSummary
```

## 16.1 RequestFulfillmentStatus

```text
COMPLETE
PARTIAL
UNSATISFIED
UNKNOWN
```

This always answers whether the **original immutable requested_scope** was satisfied. It is never computed relative only to the accessible subset.

## 16.2 TargetResolutionStatus

```text
RESOLVED
PARTIAL
EMPTY_CONFIRMED
EMPTY_UNKNOWN
BLOCKED
```

Resolution concerns identity/accounting of requested targets, not whether all resolved targets are authorized for transfer. A requested member may be `RESOLVED` and simultaneously inaccessible under the current authorization context.

## 16.3 SelectionAcquisitionStatus

```text
NOT_STARTED
COMPLETE
PARTIAL
FAILED
CANCELLED
```

This concerns only the frozen `SelectedTargetSet S`. No empty-set vacuous success exists.

## 16.4 CoverageStatus

Coverage is always relative to the requested-scope CoverageTarget:

```text
VERIFIED_COMPLETE
VERIFIED_SUBSET
TRUNCATED
UNKNOWN
NOT_APPLICABLE
```

`VERIFIED_COMPLETE` means the requested reference set is independently accounted for; it does not mean every requested member was transferable or fulfilled.

## 16.5 StopReason

```text
NONE
NATURAL_COLLECTION_END
USER_SCOPE_REACHED
USER_SELECTION_COMPLETE
DISCOVERY_BUDGET_EXHAUSTED
TRANSFER_BUDGET_EXHAUSTED
GLOBAL_SAFETY_LIMIT
NO_PROGRESS
AUTH_REQUIRED
AUTH_FAILED
TARGET_CHANGED
COLLECTION_CHANGED
UNSUPPORTED
USER_CANCELLED
VALIDATION_FAILED
```

Use `AUTH_REQUIRED` when the current context is insufficient for otherwise identified requested members and additional/different authorization would be required. Use `AUTH_FAILED` when an attempted supplied authorization/session itself fails validation.

---

# 17. Coverage and Authorization Accounting — R02 normative rule

Primary `CoverageTarget` is:

```text
CollectionIdentity
+ immutable RequestedScope
+ SnapshotVersion
```

`AuthorizationContextRef` is recorded alongside the CoverageTarget as acquisition/evidence context; it MUST NOT redefine `RequestedScope` or shrink the reference set used for `RequestFulfillmentStatus`.

Three views are distinct:

1. **Requested-scope coverage** — authoritative `CoverageStatus` for the immutable requested scope.
2. **Accessible-subset accounting** — identities/counts in `X`, plus inaccessible identities/reasons where knowable.
3. **Parent collection coverage** — optional secondary information only; never replaces requested-scope coverage.

Example: a 10-page parent collection exists, but the user explicitly requests pages 1–3. If all requested members are independently accounted for, `CoverageStatus = VERIFIED_COMPLETE` for pages 1–3. Parent coverage may separately be `VERIFIED_SUBSET` or `UNKNOWN`.

## 17.1 Explicit selected subset of a larger collection

If, before confirmation, the user chooses exactly 5 members from a larger collection, the confirmed `requested_scope` becomes `selected_collection_members` containing those 5 identities. If all five are resolved, acquired and validated:

```text
RequestFulfillmentStatus = COMPLETE
TargetResolutionStatus = RESOLVED
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = VERIFIED_COMPLETE
StopReason = USER_SELECTION_COMPLETE
```

This does not imply the parent collection is complete.

## 17.2 Canonical authorization-limited whole-collection tuple

Canonical case:

- collection metadata identifies exactly 18 requested members;
- user confirms the **whole collection** as `requested_scope`;
- current authorization can acquire exactly 16;
- the remaining 2 identities are known and independently classified as inaccessible under the current authorization context;
- all 16 accessible selected targets are acquired and validated;
- no unauthorized exploration/acquisition is attempted.

Required tuple:

```text
RequestFulfillmentStatus = PARTIAL
TargetResolutionStatus = RESOLVED
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = VERIFIED_COMPLETE
StopReason = AUTH_REQUIRED
```

Required accounting:

```text
requested_scope_count = 18
requested_accounted_count = 18
auth_accessible_count = 16
auth_inaccessible_count = 2
selected_count = 16
validated_success_count = 16
```

Required user-visible explanation:

> `16 of 18 requested members were acquired and validated. The requested scope remains all 18 members. Two known requested members are inaccessible under the current authorization context; no unauthorized access was attempted.`

The task is `PARTIAL` because the original request was not fully fulfilled, even though requested-scope enumeration/coverage is complete and the accessible selected set was acquired completely.

If the two inaccessible members are not independently accounted/identified, `TargetResolutionStatus` and `CoverageStatus` MUST degrade consistently (`PARTIAL`/`UNKNOWN` or `TRUNCATED` as applicable); they cannot be inferred complete from the accessible 16.

---

# 18. Legal Status Combination Rules

## 18.1 Direct resource success

```text
RequestFulfillmentStatus = COMPLETE
TargetResolutionStatus = RESOLVED
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = NOT_APPLICABLE
StopReason = NONE
```

## 18.2 Requested bounded scope fully acquired

```text
RequestFulfillmentStatus = COMPLETE
TargetResolutionStatus = RESOLVED
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = VERIFIED_COMPLETE
StopReason = USER_SCOPE_REACHED or NATURAL_COLLECTION_END
```

## 18.3 Whole collection requested, discovery truncated after frozen targets succeed

```text
RequestFulfillmentStatus = PARTIAL
TargetResolutionStatus = PARTIAL
SelectionAcquisitionStatus = COMPLETE
CoverageStatus = TRUNCATED
StopReason = DISCOVERY_BUDGET_EXHAUSTED
```

## 18.4 Auth failure before any target is resolved

```text
RequestFulfillmentStatus = UNSATISFIED
TargetResolutionStatus = BLOCKED
SelectionAcquisitionStatus = NOT_STARTED
CoverageStatus = UNKNOWN
StopReason = AUTH_FAILED or AUTH_REQUIRED
```

## 18.5 Independently verified empty requested collection

```text
RequestFulfillmentStatus = COMPLETE
TargetResolutionStatus = EMPTY_CONFIRMED
SelectionAcquisitionStatus = NOT_STARTED
CoverageStatus = VERIFIED_COMPLETE
StopReason = NATURAL_COLLECTION_END
```

UI/CLI MUST say “No matching resources in the requested scope (verified)” rather than “Downloaded successfully”.

## 18.6 Empty but not proven empty

```text
RequestFulfillmentStatus = UNKNOWN
TargetResolutionStatus = EMPTY_UNKNOWN
SelectionAcquisitionStatus = NOT_STARTED
CoverageStatus = UNKNOWN
StopReason = appropriate non-success reason
```

## 18.7 Authorization-limited but fully enumerated request

Use the exact §17.2 tuple. `RequestFulfillmentStatus = COMPLETE` is forbidden while known requested members remain unfulfilled because of authorization.

## 18.8 Forbidden combinations

Invalid unless the Product contract is amended:

- `TargetResolutionStatus = PARTIAL` + `CoverageStatus = VERIFIED_COMPLETE` for the same requested-scope CoverageTarget;
- `SelectionAcquisitionStatus = COMPLETE` when required selected targets failed validation;
- `TargetResolutionStatus = EMPTY_UNKNOWN` + `RequestFulfillmentStatus = COMPLETE`;
- `CoverageStatus = VERIFIED_COMPLETE` based only on max_items/max_pages/timeout/budget exhaustion;
- direct single-resource task with collection coverage other than `NOT_APPLICABLE`;
- whole collection request reported `COMPLETE` merely because all currently authorized members succeeded;
- authorization context silently changing requested scope.

---

# 19. Completeness Contract

`SelectionAcquisitionStatus = COMPLETE` only if every identity in `S` maps to exactly one accepted acquisition result in `A` and required validation passes.

`CoverageStatus = VERIFIED_COMPLETE` requires independent evidence that the full requested-scope CoverageTarget has been accounted for.

Acceptable classes of evidence:

- authoritative member identity list;
- declared total plus unique identity correspondence plus valid natural-end/continuation closure;
- user-declared finite member set fully accounted for;
- supported collection API/template whose completion semantics are independently validated.

Not sufficient alone:

- count equality;
- max_items reached;
- page limit reached;
- timeout;
- budget exhaustion;
- failed next page;
- pagination loop;
- “no more found” without natural-end evidence.

Known inaccessible members MAY count as accounted for coverage only when their identities and authorization status are independently evidenced; they never count as fulfilled/acquired.

---

# 20. Evidence Claim Model

Every material Evidence record MUST declare:

```text
claim_type
claim_subject
source_type
source_identity/provenance
independence_from_discovery
scope
confidence_or_certainty_class
```

Claim types:

```text
RESOURCE_IDENTITY
MEMBERSHIP
SELECTION
QUALITY
AUTHORIZATION
TRANSFER
FORMAT
MEDIA
COVERAGE
```

One Evidence item can support multiple claim types only when each relationship is explicit.

---

# 21. User Confirmation Claims

Allowed confirmation types:

```text
CONFIRM_RESOURCE_IDENTITY
CONFIRM_MEMBERSHIP
CONFIRM_SELECTION
CONFIRM_QUALITY_CHOICE
ACCEPT_TARGET_CHANGE
```

User confirmation proves only the claim the user was shown and asked to decide. It cannot silently prove hidden semantic properties, cannot waive Transfer/Format/Media Validation, and cannot rewrite experiment truth.

---

# 22. Validation Layers

Required layers as applicable:

- Transfer Validation — byte/range/segment completeness and response consistency.
- Format Validation — parseability/container/document/archive checks and rejection of login/error HTML masquerading as target content.
- Media Validation — expected tracks/media presence, duration/container/manifest sanity.
- Target Validation — acquired resource matches requested/confirmed identity.
- Membership Validation — resource is a valid collection member under the frozen basis.
- Coverage Validation — declared CoverageStatus has independent evidence.

Discovery inference cannot be the sole validation oracle for the same semantic claim.

---

# 23. Template / Recipe Contract

A Recipe is declarative product knowledge:

```text
Recipe
=
TemplateType
+ Matcher
+ Parameters
+ AllowedActions
+ EvidenceRules
+ ValidationRules
+ ApplicabilityScope
+ FailureConditions
+ Fallback
```

Recipe MUST NOT authorize arbitrary shell execution, unrestricted JavaScript, unrestricted filesystem access, unrestricted cookie/token export, arbitrary host scanning or recursive arbitrary browser navigation.

Allowed actions come from a bounded capability list defined later by architecture/implementation and remain subordinate to Product Scope.

Template-first does not mean “try every template before asking the user”. When user clarification is cheaper than more probes, ASSISTED mode is preferred.

---

# 24. Knowledge Promotion

v0.1.0 Product Freeze requires only:

```text
L0 Local Candidate
L1 Local Verified
```

Task-local user preference/selection is not reusable semantic knowledge.

Promotion to `L1 Local Verified` requires declared applicability scope, cross-task or structural evidence, target/membership validation, known failure conditions, deterministic fallback, and no embedded credentials/identity secrets.

Shared/community promotion is deferred and not a v0.1.0 Product Freeze or Release requirement.

---

# 25. Organization Semantics

Organization is best-effort but must preserve identity/provenance:

- byte dedup does not erase Collection member positions;
- same bytes may belong to multiple logical members;
- same filename does not imply same content;
- source/member mapping is retained;
- uncertain semantic ordering is not presented as authoritative;
- user can override naming/folder organization;
- cleanup/reorganization effort counts in Product Value experiments.

---

# 26. UI Contract

Primary flow:

```text
Add / Paste / Browser handoff
→ resolve intent
→ simple direct path OR scope/preview when needed
→ AUTO / ASSISTED / MANUAL_SELECTION
→ freeze contract + SelectionSnapshot
→ acquire
→ validate
→ show multi-dimensional result
→ open / organize / retry failed / explicitly refresh or expand scope
```

Rules:

- simple single-resource tasks MUST NOT be forced through collection preview;
- ambiguity prompts should be grouped/batched when possible;
- confirmed `requested_scope`, explicit continuation scope, coverage target and truncation/UNKNOWN state must be understandable;
- “Refresh collection”, “Load more”, “Continue”, or any scope expansion after confirmation creates a successor contract/snapshot;
- unsupported/out-of-scope must be visible rather than silently approximated.

---

# 27. CLI Contract

CLI MUST expose submit acceptance separately from final acquisition result.

Required machine-readable fields:

```text
contract_id
intent_type
requested_scope
continuation_scope
snapshot_id?
requested_count_if_known
auth_accessible_count_if_known
resolved_count
selected_count
validated_success_count
RequestFulfillmentStatus
TargetResolutionStatus
SelectionAcquisitionStatus
CoverageStatus
StopReason
needs_user_action
```

Non-interactive mode cannot block indefinitely on confirmation. `NEEDS_USER_ACTION` returns a bounded machine-readable state. Submit exit success does not mean final task success. Wait-mode final exit semantics reflect final request/selection result.

---

# 28. v0.1.0 Support Slice Registry

A slice is supported only when every declared field is satisfied by implementation and validation evidence. The PRD freezes product behavior, not technical implementation.

## S1 — Direct HTTP/HTTPS File — REQUIRED

Explicit direct resource URL/response; public or locally brokered authorized context; selected-resource redirects/CDN allowed without discovery expansion; single-file model; Transfer + Format/Target validation; truthful failure.

## S2 — Browser Download Handoff / Explicit Current-page Attachment — REQUIRED

Browser response or explicit current-page member identity; local authorized context; provenance-bound redirects/CDN; single-file model; Target + Transfer + Format validation; auth/expiry/mismatch visible.

## S3 — Direct Media File — REQUIRED

Explicit downloadable video/audio; selected-resource provenance; single media file; no required separate A/V mux; Transfer + Format + Media + Target validation.

## S4 — HLS VOD Basic — REQUIRED

Selected HLS VOD manifest; authorized browser context allowed; CDN/segments must descend from selected manifest/resource provenance; non-DRM supported simple topology; manifest/rendition/segment/final-media validation; unsupported encryption/track topology/post-processing returns UNSUPPORTED/FAILED.

## S5 — Current-page Resource Collection — REQUIRED

- Identity: current page plus supported explicit member relation.
- Default scope: confirmed current-page membership snapshot with `continuation_scope = NONE`.
- Continuation-loaded members are excluded unless explicit continuation scope was confirmed; later expansion creates successor contract/snapshot.
- Auth: current browser context.
- Redirect/cross-origin: allowed for member delivery with provenance.
- Resource model: bounded members under the frozen current-page/continuation rule; no arbitrary frontier.
- Validation: Membership + per-member Target/Transfer/Format + requested-scope Coverage semantics.
- Failure: partial/truncated/unknown is truthful; no count-based completeness.

## S6 — Explicit Playlist / Gallery Collection — REQUIRED

Explicit supported CollectionIdentity; deterministic supported membership relation; user-authorized context when required; only declared collection continuation/member detail edges; provenance-bound cross-origin/CDN delivery; finite or naturally terminable supported collection; Membership + Target + per-member acquisition + Coverage validation. Failure to close requested continuation yields TRUNCATED/UNKNOWN; never a general site frontier.

Conditional/deferred slices remain: complex DASH/separate A/V, multi-audio/complex subtitle processing, generic bounded pagination across arbitrary listings, continuous monitoring, BitTorrent/magnet/eMule, proprietary cloud-drive protocols, and full website/course mirroring.

---

# 29. Security / Authorization Boundary

xDownload is for resources the user is authorized to access.

Explicit non-goals:

- DRM circumvention;
- paywall/access-control bypass;
- credential theft;
- password/auth cracking;
- protected-key extraction;
- unauthorized content access.

AuthorizationContextRef may constrain acquisition and evidence. It MUST NOT silently rewrite confirmed `requested_scope`.

Cookies/tokens/passwords remain in local broker/browser context where possible. LLM may receive capability facts but must not require raw secrets for ordinary tasks. Recipe/Knowledge must not embed credentials, signed URLs as durable reusable rules or user identity secrets.

---

# 30. Failure Taxonomy

At Product/Scope level, at least distinguish:

```text
NETWORK_FAILURE
AUTH_REQUIRED
AUTH_FAILED
RESOURCE_EXPIRED
TARGET_MISMATCH
COLLECTION_CHANGED
SITE_PATTERN_CHANGED
RATE_LIMITED
DISCOVERY_BUDGET_EXHAUSTED
TRANSFER_BUDGET_EXHAUSTED
UNSUPPORTED
DRM_OR_ACCESS_CONTROLLED
DISK_OR_PERMISSION_FAILURE
VALIDATION_FAILURE
USER_CANCELLED
```

Failure category must not be silently rewritten to success by retries or AI explanation.

---

# 31. Critical Journeys

## CJ-01 Direct file

```text
Paste/click direct URL
→ resolve
→ acquire
→ validate
→ COMPLETE
```

Model offline must not block.

## CJ-02 Browser explicit attachment

```text
Current page
→ select explicit attachment
→ browser/local auth context
→ acquire
→ validate target/file
```

## CJ-03 Current-page media

```text
observe page/network/player
→ candidate set
→ AUTO or small ASSISTED confirmation
→ acquire supported media
→ validate
```

## CJ-04 Current-page collection — R01 normalized

```text
current page
→ build supported current-page membership snapshot
→ show requested scope + continuation_scope (default NONE)
→ confirm contract
→ freeze snapshot
→ batch acquire selected members
→ per-member validation
→ requested-scope coverage result
```

No scroll/load-more/infinite-scroll action may add members when `continuation_scope = NONE`. If the user requests more after confirmation, create successor contract/snapshot before acquiring new members.

## CJ-05 Explicit playlist/gallery

```text
identify collection
→ validate membership basis
→ declare requested scope + any continuation scope
→ enumerate only declared collection edges
→ optional confirmation
→ snapshot
→ acquire
→ coverage validation
```

If `DECLARED_NATURAL_END` is requested but continuation is not exhausted, return truthful PARTIAL/TRUNCATED rather than silently treating the budget stop as scope completion.

## CJ-06 Retry/resume

Existing snapshot → retry/resume original targets only → no target replacement, scope expansion or budget reset.

## CJ-07 Model unavailable

Direct/template-supported paths continue; unresolved hard case returns NEEDS_USER_ACTION / UNKNOWN / UNSUPPORTED.

## CJ-08 Site/template mismatch

Fail closed from stale assumptions → bounded repair/user confirmation → never silently reuse stale target/membership claims.

## CJ-09 Authorization-limited whole collection — R02 normalized

```text
whole collection requested
→ account requested members
→ preserve original requested_scope
→ separate accessible/inaccessible accounting
→ acquire authorized selected subset only
→ report §17.2 tuple when 18/16 canonical conditions hold
```

---

# 32. Product Gates and Confirmation Protocols

Gate results:

```text
PASS
FAIL
INSUFFICIENT_EVIDENCE
```

## 32.1 Common confirmation rules

- Sample unit: one end-to-end user Acquisition task, not each downloaded file.
- Inclusion: tasks intentionally sampled for the Gate and matching the frozen support slice/corpus.
- Out-of-scope task: excluded from primary success denominator but reported separately; classification error counts against scope/UX correctness.
- `UNKNOWN`: not success; remains in denominator unless independent truth itself is unavailable, then `INSUFFICIENT_EVIDENCE`.
- Abandonment caused by xDownload friction/failure: non-success.
- External/unrelated cancellation: excluded only with pre-recorded reason.
- Truth source: pre-registered expectations, independent manual oracle or authoritative metadata; never model self-evaluation.
- Confirmation data isolation: Phase B tasks/results MUST NOT be opened before protocol, supported slices, decision rules **and G0 baseline plan** are frozen.
- Any protocol change after Phase B exposure invalidates the run, including baseline identity, baseline selection criteria, comparison set or aggregation rule changes.
- Repeated runs of the same unchanged task do not create independent sample units.

## 32.2 G0 deterministic baseline protocol — R03 normative rule

Before any Phase B/confirmation result is opened, create and freeze a `G0BaselinePlan` containing:

```text
g0_baseline_plan_id
candidate_baseline_registry
support_slice_or_task_class_rules
applicability_criteria
baseline_selection_rule
fixed_comparison_sets_if_any
baseline_version_or_identity
configuration/profile assumptions
same-task/same-auth/same-scope constraints
metric aggregation rule
tie_break_rule
frozen_at
```

Candidate baseline registry is fixed before Phase B and may include browser-native download, yt-dlp, JDownloader, Gopeed/Motrix or an OmniGet-like workflow where they are relevant to the task class.

For each support slice/task class:

1. Remove baselines that cannot satisfy the same task shape, requested scope and authorization assumptions.
2. If exactly one applicable conventional baseline remains, freeze that identity.
3. If multiple reasonable applicable baselines remain, do **not** choose after seeing Phase B data. Use one of these pre-registered choices:
   - a Phase-A selection rule frozen before Phase B; or
   - a fixed comparison set containing all tied/applicable baselines.
4. A Phase-A selection rule MUST be deterministic. Default rule unless the plan pre-registers another objective rule:

```text
highest Phase-A correct task completion
→ lowest Phase-A active user time
→ lowest Phase-A manual action count
→ lexical baseline_id tie-break
```

5. If a fixed comparison set is used, the G0 plan MUST pre-register how multiple results aggregate; the aggregation rule cannot be chosen after Phase B exposure.
6. Baseline version/configuration and any material workflow assumptions are part of baseline identity.
7. Any baseline identity/selection/comparison-set/aggregation change after Phase B exposure invalidates the whole affected confirmation run; a new independent confirmation run is required.

This protocol prevents teams from choosing a favorable conventional baseline after seeing confirmation results.

## G0 — Product Value — REQUIRED

Corpus: Natural Corpus across S1–S6.

Primary correctness metric: correct end-to-end task fulfillment.

Secondary cost metrics: active user time, manual actions, recovery effort and false-success rate.

PASS rule:

1. every required Critical Journey has confirmation evidence on its required support slice;
2. no unresolved Critical wrong-target/false-success defect exists;
3. correct completion is not lower than the conventional baseline result determined by the frozen `G0BaselinePlan` for the same task set;
4. collection tasks do not require more active user effort than the frozen baseline result without a compensating correctness improvement documented by independent truth.

Otherwise FAIL or INSUFFICIENT_EVIDENCE.

No actual G0 PASS is claimed by this PRD. Economic benefit remains `NOT_MEASURED`.

## G1a — Batch Acquisition Increment — REQUIRED for S5/S6

Compare manual/single-resource baseline vs batch acquisition with the same frozen target set. PASS requires strict reduction in active user actions/time, no lower correct completion and no new critical false-success.

## G1b — Navigation Increment — REQUIRED only when S6 confirmation requires continuation/navigation

Compare same explicit collection with manual member navigation vs bounded declared continuation. PASS requires strict effort/time reduction, no scope expansion and no correctness regression. If no navigation-requiring S6 confirmation case exists, result is `INSUFFICIENT_EVIDENCE` and S6 must be narrowed before release.

## G1c — Semantic Selection Increment — REQUIRED when semantic filtering/selection is enabled

Compare raw candidate/manual selection vs semantic filtering/ASSISTED selection. PASS requires strict selection effort/time reduction, no increase in wrong-target rate and confirmation burden included in cost.

## G1d — Organization Increment — RECOMMENDED / non-blocking for v0.1.0

Best-effort organization may ship if correctness/provenance rules are satisfied even when measurable convenience gain is not proven.

## G2 — AI Increment — CONDITIONAL

Required only if AI fallback is enabled by default in v0.1.0. Hard Corpus must be frozen from tasks where deterministic/template path is insufficient under the same Tools/Auth/Budgets. PASS requires incremental correctly resolved hard tasks, no critical false-success increase, independent target truth, and full accounting of extra user work.

## G3 — Local Knowledge Compounding — RECOMMENDED / non-blocking for v0.1.0

PASS only if Local Verified knowledge reduces model use, active time or repair effort on new in-scope pages/sessions while correctness and scope do not regress.

## G4 — Shared Knowledge — DEFERRED / NOT A v0.1.0 RELEASE GATE

Public/shared Recipe network is outside initial release requirements.

---

# 33. Experiment Corpora and Baselines

## Natural Corpus

Ordinary in-scope tasks across S1–S6.

## Collection Corpus

Current-page attachments, explicit gallery, explicit playlist, and at least one supported continuation case if S6 claims continuation support.

## Hard Corpus

Cases where deterministic/template path is insufficient or materially ambiguous.

## Holdout Corpus

New pages/sessions/profile states for knowledge/generalization checks.

## Baseline rule — R03 normalized

Baseline choice is task-specific but **not discretionary after confirmation data is visible**. Every G0 run MUST use the pre-registered `G0BaselinePlan` from §32.2. The plan selects one baseline or a frozen comparison set per support slice/task class before Phase B opens.

A new baseline, changed version, changed configuration, changed applicability rule or changed comparison-set aggregation after Phase B exposure is a protocol change and invalidates the affected run.

---

# 34. Capability Ablation

For Collection value attribution:

```text
A0 single/manual acquisition
A1 + current-page batch
A2 + bounded declared collection continuation
A3 + semantic filtering/selection
A4 + organization
```

Each layer receives credit only for its own incremental benefit.

---

# 35. Counterexample Corpus C01–C34

All cases are Product contract tests. Current executable status: **NOT RUN**.

Each run must pre-register target, scope, expected stop, expected result statuses, truth source and applicable frozen G0 baseline plan when G0 is involved.

| ID | Scenario | Required product behavior |
|---|---|---|
| C01 | Duplicate replaces a missing member while total count stays equal | No `VERIFIED_COMPLETE`; identity correspondence required. |
| C02 | Requested scope contains 150 members but safety cap stops after 100 | Request PARTIAL; Resolution PARTIAL; Coverage TRUNCATED; never complete. |
| C03 | Next page fails / next control missing / pagination loops | Not natural end; Coverage UNKNOWN/TRUNCATED with truthful StopReason. |
| C04 | No declared total, supported finite collection reaches independently validated natural end | `VERIFIED_COMPLETE` only with identity/membership closure evidence. |
| C05 | User explicitly selects 5 of a larger collection before confirmation and all 5 succeed | Exact tuple: Request COMPLETE; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop USER_SELECTION_COMPLETE. Parent collection completeness is not implied. |
| C06 | “First 1000 pages under domain, all PDFs” | Reject Collection admission as arbitrary frontier. |
| C07 | Confirmed member requires detail page/CDN | Allow only traceable member/detail/CDN path; retain provenance. |
| C08 | Requested `collection_page_range=1..3`; iframe/load-more/detail pages are present; no explicit continuation permission | Only logical root pages 1–3 and members bound by the supported membership basis are in scope. iframe/load-more/detail do not add pages or members. If those requested members close successfully: Request COMPLETE; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop USER_SCOPE_REACHED. Any later load-more requires successor contract/snapshot. |
| C09 | Original vs thumbnail / main video vs ad are all technically valid files | No semantic PASS without typed independent Target/Quality evidence or sufficiently informed user claim. |
| C10 | Collection metadata identifies 18; whole collection requested; current auth can acquire 16; 2 are known inaccessible | Exact §17.2 tuple: Request PARTIAL; Resolution RESOLVED; Selection COMPLETE; Coverage VERIFIED_COMPLETE; Stop AUTH_REQUIRED; explain 16/18 acquired, requested scope remains 18. |
| C11 | Collection changes after Preview | Snapshot cannot silently drift; refresh creates successor snapshot. |
| C12 | Retry failed items | Retry only original failed members; no new/replacement members. |
| C13 | Restart/repair/UI+CLI concurrency | Budgets inherit remaining values; no duplicate allocation. |
| C14 | All discovered targets succeed but requested collection enumeration unfinished | Selection may COMPLETE; Request PARTIAL/UNKNOWN; Coverage not VERIFIED_COMPLETE. |
| C15 | DASH/separate A/V requires unsupported mux | UNSUPPORTED/FAILED; never silent video-only success. |
| C16 | Simple task forced through unnecessary Scope/Preview | Product value fails the task if avoidable interaction regresses without correctness benefit. |
| C17 | Single-page batch succeeds but pagination untested | Credit G1a only; G1b remains unproven. |
| C18 | Same bytes in two chapters / same names differ in content | Preserve member/source mapping; no semantic collapse. |
| C19 | AI vs non-AI comparison | Same Tools/Auth/Budget/Context and independent truth required. |
| C20 | Local Recipe replay on new page/session/layout change | Revalidate scope/correctness; cache/output controlled. |
| C21 | Shared knowledge on independent user/account | Not v0.1.0 release gate; if tested, no credential/private-data leakage and fail closed. |
| C22 | Too little evidence | `INSUFFICIENT_EVIDENCE`; no post-hoc threshold conversion to PASS. |
| C23 | Whole collection requested; page 1–2 selected targets succeed; page 3 undiscovered due DiscoveryBudget | Request PARTIAL; Resolution PARTIAL; Selection COMPLETE; Coverage TRUNCATED; Stop DISCOVERY_BUDGET_EXHAUSTED. |
| C24 | Auth failure yields no targets | Request UNSATISFIED; Resolution BLOCKED; Selection NOT_STARTED; Coverage UNKNOWN; Stop AUTH_REQUIRED/AUTH_FAILED according to §16.5. |
| C25 | Parent 10 pages; user requests only pages 1–3 and all requested members succeed | CoverageTarget is pages 1–3; Coverage VERIFIED_COMPLETE for requested scope only; no whole-parent claim. |
| C26 | User confirms a system-labeled “original” candidate without enough distinguishing information | User click proves selection only; QUALITY/original claim remains unverified. |
| C27 | User confirms correct candidate but transfer is truncated/missing required track | Confirmation does not waive validation; SelectionAcquisition not COMPLETE. |
| C28 | DiscoveryBudget exhausted; frozen HLS target still needs segments | Continue only if TransferBudget + GlobalSafetyBudget remain; HLS requests count TransferBudget. |
| C29 | Current-page attachment redirects to declared CDN | S2 provenance accepts; validate final target; unrelated redirect rejected/fails. |
| C30 | 50 candidates each ask one confirmation; batch/manual selection can resolve once | Batch/manual selection required; per-item burden counts against G0/G1c. |
| C31 | User selects 12/18 once; later similar page differs | Task selection is not reusable membership knowledge without cross-task validation/promotion. |
| C32 | Confirmation set includes failure, abandonment, UNKNOWN, out-of-scope | Apply common denominator rules exactly. |
| C33 | Team opens Phase B results, then changes template/support/decision rule **or G0 baseline identity/selection/comparison-set/aggregation rule** | Prior confirmation run is invalid; create a new independent run. |
| C34 | UI suggestion used as “ground truth” | Invalid; truth must be pre-registered/independent and cannot be rewritten by confirmation. |

---

# 36. Acceptance Criteria for Product/Scope Freeze

This PRD is eligible for Product/Scope Freeze only when:

1. formal L1 Product Evidence is checkpointed;
2. the exact current PRD subject receives required Fresh Independent Product Review `PASS`;
3. no unresolved P0/P1 changes product semantics;
4. S1–S6 product support contracts are sufficiently specific for L2 without inventing product behavior;
5. C01–C34 each have a unique expected Product outcome;
6. UI/CLI result semantics are coherent with the shared AcquisitionContract;
7. current-page continuation, requested/auth subset accounting and G0 baseline selection are deterministic;
8. Product gates and denominator/UNKNOWN/abandonment/truth/isolation rules are frozen;
9. release target `v0.1.0`, scope and non-goals are accepted;
10. no Architecture implementation choice is accidentally frozen as Product authority.

Product Review is assurance evidence. It does not itself perform Product Freeze and does not substitute for downstream executable Validation.

---

# 37. v0.1.0 Release Blockers Frozen by this PRD

After Product Freeze and implementation, v0.1.0 cannot qualify for release while any of the following remains unresolved:

- critical wrong-target or false-success defect;
- arbitrary crawler/frontier escape from Collection admission;
- required S1–S6 support slice not implemented/validated or explicitly removed through Product amendment;
- G0 FAIL / INSUFFICIENT_EVIDENCE;
- required G1a failure for collection slices;
- required G1b failure where release claims continuation/navigation;
- required G1c failure where semantic selection is enabled;
- required Critical Journey failure;
- model-unavailable regression on deterministic/template-supported ordinary tasks;
- credential/secret leakage across Browser/Recipe/LLM boundary;
- required validation/package/release gates from Frozen Architecture/standard not satisfied.

G2 may fail without blocking the base release only if AI is disabled or clearly experimental. G3/G4 are not base v0.1.0 release blockers.

---

# 38. Finding Closure Matrix

## 38.1 Issue #2 blocking repairs

| Finding | v0.4.2 Product-contract resolution | Builder status |
|---|---|---|
| R01 / F04 / C08 — `current_page` continuation/membership boundary | §§8, 10, 12, 14, 26–28, 31 and C08 freeze default `continuation_scope=NONE`, explicit bounded continuation, successor contract/snapshot on later expansion, and exact unexhausted-continuation statuses. Budget cannot define scope. | CLOSED_BY_CANDIDATE |
| R02 / N03 / C05/C10 — requested vs selected vs auth-accessible subset | §§11, 16–19, 27, 29, CJ-09, C05/C10 freeze immutable requested scope, separate `X/S/A`, primary requested-scope coverage, parent/access accounting, and exact 18/16 tuple. | CLOSED_BY_CANDIDATE |
| R03 / F10/N06/G0 — deterministic baseline | §§32.1–32.2, G0, §33 and C33 require a pre-registered deterministic `G0BaselinePlan`, fixed baseline identity or comparison set before Phase B, and run invalidation after baseline/protocol changes. | CLOSED_BY_CANDIDATE |

These are Builder candidate resolutions only. A fresh independent reviewer must determine actual closure/PASS on the exact successor HEAD.

## 38.2 v0.4 structural findings

- S1 relationship: CLOSED candidate by §0 self-contained supersession.
- S2 N01–N08 durability: CLOSED candidate by durable v0.3 review + this matrix.
- S3 C23–C34: CLOSED candidate by §35.
- S4 concepts without decision rules: CLOSED candidate subject to fresh review; v0.4.2 additionally normalizes R01–R03.

## 38.3 N01–N08 intended disposition

- N01 selected acquisition vs request fulfillment → §§16–18.
- N02 user confirmation proof scope → §§20–22.
- N03 Coverage reference → §§11, 17–19 and R02 normalization.
- N04 Budget domains → §15.
- N05 Support Slice specificity → §28.
- N06 Gate protocol → §32 plus R03 deterministic G0 baseline.
- N07 interaction cost → §13 and G0/G1c.
- N08 task choice vs reusable knowledge → §24/C31.

## 38.4 Historical F01–F12 intended disposition

- F01 identity/completeness → §§11, 17, 19.
- F02 crawler boundary → §§9–10, 14.
- F03 semantic self-certification → §§20–22.
- F04 scope/selection/budget ambiguity → §§8–10, 15 plus R01.
- F05 preview drift → §12.
- F06 budget reset → §15.
- F07 final-state ambiguity → §§16–18.
- F08 support breadth → §28.
- F09 collection attribution → G1a–G1d + §34.
- F10 post-hoc Gate judgement → §§32–33 plus R03.
- F11 organization semantics → §25.
- F12 Recipe promotion → §24.

Actual `CLOSED/PARTIAL/OPEN` remains the authority of a Fresh Independent Reviewer on the exact current subject.

---

# 39. Explicit Non-goals

v0.1.0 does not promise:

- general-purpose crawling;
- arbitrary recursive link traversal;
- continuous site monitoring;
- general scraping/indexing;
- full-site or full-course mirroring;
- DRM circumvention;
- paywall/access-control bypass;
- credential theft/auth cracking/protected-key extraction;
- arbitrary executable Recipes;
- model-required ordinary downloads;
- BitTorrent/magnet/eMule parity;
- public/shared Recipe registry;
- universal site support;
- universal HLS/DASH track/post-processing support.

---

# 40. What Remains for L2

Only after Product/Scope Freeze may L2 decide desktop framework, language/runtime, browser extension architecture, process boundaries, storage implementation, download engine implementation/reuse, template DSL representation, validation implementation, local secret broker design, model provider/runtime integration, package/monorepo structure and exact platform/build toolchains.

L2 MUST NOT change Frozen Product semantics simply to simplify implementation.

---

# PRD Terminal

```text
Product: xDownload
Product release target: v0.1.0
PRD revision: v0.4.2
ADS Stage: Stage 1 Product/Scope Review Candidate
Primary value: correct, reliable, low-friction targeted resource acquisition
Primary UI: Desktop
Browser integration: Core
CLI: First-class automation surface
Intent model: SingleResourceIntent + CollectionIntent
Collection rule: identifiable collection + membership + bounded declared edges + hard stop + no arbitrary frontier
Current-page continuation: NONE by default; explicit bounded scope only; later expansion requires successor contract/snapshot
Requested scope: immutable after confirmation; authorization cannot silently rewrite it
Authorization-limited canonical whole-collection result: PARTIAL / RESOLVED / COMPLETE / VERIFIED_COMPLETE / AUTH_REQUIRED when all requested identities are accounted but some are inaccessible
Automation modes: AUTO / ASSISTED / MANUAL_SELECTION
Execution strategy: Template-first / Minimum Necessary Intelligence
Interaction strategy: Minimum Necessary Interaction
AI: bounded knowledge-gap fallback; conditional release gate
Result model: RequestFulfillment + TargetResolution + SelectionAcquisition + Coverage + StopReason
Coverage: always bound to immutable requested scope; parent/access accounting is separate
G0 baseline: deterministic and pre-registered before Phase B; post-exposure baseline change invalidates run
Validation: independent claim-based evidence; user confirmation does not waive transfer/format/media checks
Required v0.1.0 support slices: S1–S6
Counterexample corpus: C01–C34
Formal L1 Product Evidence: COMPLETE
Economic benefit: NOT_MEASURED
Product Freeze: NO
Architecture Freeze: NO
L2 eligibility: NO
Next required action: Fresh Independent Product/Scope Review on exact successor SHA under ADS Stage 1
```
