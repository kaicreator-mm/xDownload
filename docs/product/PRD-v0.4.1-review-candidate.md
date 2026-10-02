# xDownload PRD v0.4.1 — ADS Stage 1 Review Candidate

**Product:** xDownload  
**Initial product release target:** `v0.1.0`  
**PRD document revision:** `v0.4.1`  
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

This is a Product/Scope contract only. It does not freeze architecture, implementation technology, module layout or runtime design.

---

# 0. Version Relationship and Supersession

`PRD-v0.4.1-review-candidate.md` is a **complete, self-contained successor Product/Scope contract**.

For Product Freeze review:

- this file **supersedes** `PRD-v0.3-review-candidate.md` and `PRD-v0.4-review-candidate.md` as the current PRD subject;
- older PRDs remain provenance/history only;
- older review findings remain assurance evidence and are explicitly mapped in this document;
- no reader is required to combine old PRD clauses to determine current product behavior.

The PRD document revision `v0.4.1` is not the product release version. The initial product release target is `xDownload v0.1.0`.

---

# 1. Product Problem

Users often know **what they want to save**, but do not know the final network URL, exact stream, correct variant, complete member set, or reliable way to organize the result.

Existing tools already solve basic transport well. Current evidence also shows mature browser sniffing, extractor ecosystems, playlist/gallery handling and even AI/MCP-controlled download managers.

Therefore xDownload does **not** exist to prove that an LLM can download files.

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
- save all desired items from an explicit finite page/playlist/gallery;
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

Ask the user only when interaction materially resolves:

- target ambiguity;
- membership ambiguity;
- scope ambiguity;
- authorization/profile choice;
- quality choice;
- target change acceptance.

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

Bounded Pagination is retained as an experiment/P1 slice, not a v0.1.0 required release slice.

---

# 6. Product Surfaces

## 6.1 Desktop UI — primary

Primary interactive surface for ordinary users.

## 6.2 Browser Integration — core

Used to:

- hand off ordinary browser downloads;
- observe the current page/network/player context;
- provide page/profile/session context locally;
- expose candidates for current-page and supported collection workflows.

## 6.3 CLI — first-class automation surface

Used for:

- direct submission;
- batch input;
- machine-readable status;
- Agent/local automation.

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

## 7.1 SingleResourceIntent

Examples:

- download this URL;
- save this PDF;
- save the current video;
- save this direct media file.

## 7.2 CollectionIntent

Examples:

- all explicit attachments on the current page;
- selected images in the current gallery;
- all members of a supported explicit playlist;
- all members of a supported explicit gallery;
- user-declared finite URL set.

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

Contract change after user confirmation MUST be explicit and create a successor contract/snapshot identity rather than silently mutating the current one.

---

# 9. Collection Admission Contract

Collection acquisition is admitted only when **all** conditions are true:

1. `CollectionIdentity` is identifiable.
2. Membership relation is observable from a supported template/source or explicitly declared as a finite set by the user.
3. Requested scope is understandable to the user.
4. Navigation, when any, is limited to collection/member/declared continuation edges.
5. A hard stopping condition exists.
6. No arbitrary URL frontier is created.

## 9.1 User declaration does not bypass the crawler boundary

The following remains rejected even if the user requests it explicitly:

> “Search the first 1000 pages under example.com and download every PDF.”

Reason: this defines a crawl/filter frontier, not a Collection membership relation.

## 9.2 Accepted user-declared finite set

The following is accepted:

> “Download these 100 explicitly listed URLs.”

Reason: membership is user-declared and finite; the system does not discover a new frontier.

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

## 10.1 Page-range semantics

If `collection_page_range` is used:

- page indices are **1-based logical collection pages anchored to the collection root**;
- `current_page` is a different scope and never means “page 1” implicitly;
- member detail pages do not increment collection-page count;
- iframe content is not included unless a supported membership relation explicitly includes it;
- infinite-scroll/load-more is represented as continuation batches, not silently treated as numbered pages;
- UI and CLI MUST display the resolved scope before acquisition starts.

---

# 11. Collection Sets

```text
C = CandidateSet
M = ConfirmedMemberSet
S = SelectedTargetSet
A = AcquiredValidatedSet
```

Rules:

- `C` is discovery output only.
- `M` requires membership evidence.
- `S` is the target set frozen for acquisition.
- `A` contains only targets that passed required acquisition validation.
- Count equality never substitutes for identity correspondence.

---

# 12. SelectionSnapshot

After preview/selection is confirmed, create a SelectionSnapshot containing:

```text
snapshot_id
contract_id
collection_identity
coverage_target
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
- silent candidate replacement is forbidden.

---

# 13. Automation Modes and Interaction Cost

```text
AUTO
ASSISTED
MANUAL_SELECTION
```

## AUTO

All material target/membership/scope claims have sufficient evidence.

## ASSISTED

The system performs mechanical discovery but requests a small number of material confirmations.

## MANUAL_SELECTION

The product discovers a candidate set but the user chooses the final set because the choice is personal or semantically ambiguous.

## 13.1 Interaction policy

The product MUST prefer, in order:

```text
one scope-level confirmation
→ one batch/group confirmation
→ small number of material item confirmations
→ manual selection UI
```

The product MUST NOT repeatedly ask item-by-item questions when a batch/manual selection surface can resolve the same ambiguity.

For product experiments, record:

- confirmation count;
- user decision time;
- manual action count;
- recovery actions;
- abandonment caused by interaction burden.

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

Controls actions whose purpose is resolving the target set:

- active collection navigation;
- active metadata/probe requests;
- player/template probes;
- model calls for discovery/adaptation;
- generated discovery requests.

Passive browser traffic observed from a page the user is already using does not consume generated-request count, but it remains evidence with provenance.

## 15.2 TransferBudget

Controls acquisition of frozen selected targets:

- resource requests;
- HLS segments;
- downloaded bytes;
- active transfer time;
- retry transfer requests.

Remote validation fetches that retrieve target bytes count against TransferBudget.

## 15.3 GlobalSafetyBudget

Hard ceiling across the entire Acquisition lifecycle:

- global active elapsed time;
- total generated requests;
- total model cost/calls when configured;
- explicit safety limits.

GlobalSafetyBudget has highest precedence.

## 15.4 Exhaustion precedence

- DiscoveryBudget exhausted → no new discovery/navigation; already frozen `S` MAY continue transfer if TransferBudget and GlobalSafetyBudget remain.
- TransferBudget exhausted → no further acquisition bytes/segments; discovery MAY continue only if useful and GlobalSafetyBudget remains, but result cannot claim acquisition completion.
- GlobalSafetyBudget exhausted → all generated work stops.
- Retry/restart/resume/repair inherit remaining budgets.
- User pause time is excluded from active elapsed-time counters unless a specific Global wall-clock limit says otherwise.

---

# 16. Result Model

A single `success` field is forbidden.

Every final/terminal result MUST expose:

```text
RequestFulfillmentStatus
TargetResolutionStatus
SelectionAcquisitionStatus
CoverageStatus
StopReason
ValidationSummary
```

## 16.1 RequestFulfillmentStatus

Whether the user's original request was satisfied:

```text
COMPLETE
PARTIAL
UNSATISFIED
UNKNOWN
```

## 16.2 TargetResolutionStatus

Whether the requested target set was resolved:

```text
RESOLVED
PARTIAL
EMPTY_CONFIRMED
EMPTY_UNKNOWN
BLOCKED
```

## 16.3 SelectionAcquisitionStatus

Acquisition of the frozen `SelectedTargetSet`:

```text
NOT_STARTED
COMPLETE
PARTIAL
FAILED
CANCELLED
```

No empty-set vacuous success exists in this dimension.

## 16.4 CoverageStatus

Coverage relative to exactly one `CoverageTarget`:

```text
VERIFIED_COMPLETE
VERIFIED_SUBSET
TRUNCATED
UNKNOWN
NOT_APPLICABLE
```

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

---

# 17. CoverageTarget

Coverage is never implicitly relative to “the whole website” or “the largest parent collection”.

`CoverageTarget` is:

```text
CollectionIdentity
+ RequestedScope
+ AuthorizationContextRef
+ SnapshotVersion
```

Example:

A 10-page parent collection exists, but the user explicitly requests pages 1–3.

If all members in requested pages 1–3 are independently accounted for:

```text
CoverageStatus = VERIFIED_COMPLETE
CoverageTarget = collection X, pages 1..3, auth context A, snapshot V
```

This does not imply the 10-page parent collection is complete.

Parent coverage MAY be displayed separately as `UNKNOWN` or `VERIFIED_SUBSET`, but it cannot replace CoverageTarget semantics.

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

Example: explicit collection pages 1–3 are the requested scope and are fully enumerated/acquired.

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

## 18.7 Forbidden combinations

The following are invalid unless the document is amended:

- `TargetResolutionStatus = PARTIAL` + `CoverageStatus = VERIFIED_COMPLETE` for the same CoverageTarget;
- `SelectionAcquisitionStatus = COMPLETE` when required selected targets failed validation;
- `TargetResolutionStatus = EMPTY_UNKNOWN` + `RequestFulfillmentStatus = COMPLETE`;
- `CoverageStatus = VERIFIED_COMPLETE` based only on max_items/max_pages/timeout/budget exhaustion;
- direct single-resource task with collection coverage other than `NOT_APPLICABLE`.

---

# 19. Completeness Contract

## 19.1 Selected-target completeness

`SelectionAcquisitionStatus = COMPLETE` only if every identity in `S` maps to exactly one accepted acquisition result in `A` and required validation passes.

## 19.2 Collection coverage completeness

`VERIFIED_COMPLETE` requires independent evidence that the full `CoverageTarget` has been accounted for.

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

User confirmation is typed and cannot silently prove more than the user was shown/asked.

Allowed confirmation types:

```text
CONFIRM_RESOURCE_IDENTITY
CONFIRM_MEMBERSHIP
CONFIRM_SELECTION
CONFIRM_QUALITY_CHOICE
ACCEPT_TARGET_CHANGE
```

Rules:

- `CONFIRM_SELECTION` proves “the user selected this candidate”, not that the candidate is semantically an original/full-quality resource.
- `CONFIRM_RESOURCE_IDENTITY` is valid only when the UI exposes enough independent identity information for the user to distinguish candidates.
- `CONFIRM_QUALITY_CHOICE` proves user acceptance of the shown quality choice, not transfer/media integrity.
- user confirmation never waives required Transfer/Format/Media Validation.
- experiment ground truth cannot be replaced by system suggestions or post-hoc user acceptance.

---

# 22. Validation Layers

## Transfer Validation

Examples:

- byte/range completeness;
- segment completeness;
- checksum when available;
- final response/body consistency.

## Format Validation

Examples:

- MIME/container/document/archive parseability;
- reject login/error HTML disguised as target file.

## Media Validation

Examples:

- expected video/audio presence;
- duration sanity;
- track/container consistency;
- manifest/rendition consistency.

## Target Validation

Confirms the acquired resource matches the requested/confirmed target identity and claims.

## Membership Validation

Confirms the resource is a valid member of the Collection according to the frozen membership basis.

## Coverage Validation

Confirms whether the declared CoverageStatus is supported by independent evidence.

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

## 23.1 Expressive limits

Recipe MUST NOT contain or authorize:

- arbitrary shell execution;
- unrestricted JavaScript execution;
- unrestricted filesystem access;
- unrestricted cookie/token export;
- arbitrary host scanning;
- recursive arbitrary browser navigation.

Allowed actions MUST come from a bounded capability list defined later by architecture/implementation and subordinate to the Product Scope.

Template-first does not mean “try every template before asking the user”. The router must choose plausible templates from evidence; when user clarification is cheaper than additional probes, ASSISTED mode is preferred.

---

# 24. Knowledge Promotion

Product Freeze for v0.1.0 requires only:

```text
L0 Local Candidate
L1 Local Verified
```

Task-local user preference/selection is not reusable semantic knowledge.

Promotion to `L1 Local Verified` requires:

1. declared applicability scope;
2. evidence from at least one task other than the task whose one-off user preference created the candidate rule, unless the rule is purely structural/deterministic;
3. target/membership validation evidence;
4. known failure conditions;
5. deterministic fallback when mismatch is detected;
6. no credential/identity secret embedded in the rule.

Shared/community promotion is deferred and not a v0.1.0 Product Freeze or Release requirement.

---

# 25. Organization Semantics

Organization is best-effort but must preserve identity/provenance.

Requirements:

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
→ freeze SelectionSnapshot
→ acquire
→ validate
→ show multi-dimensional result
→ open / organize / retry failed / explicitly refresh collection
```

Rules:

- simple single-resource tasks MUST NOT be forced through collection preview;
- ambiguity prompts should be grouped/batched when possible;
- CoverageTarget and any truncation/UNKNOWN state must be understandable to the user;
- “Refresh collection” is explicit and creates a new snapshot;
- unsupported/out-of-scope must be visible rather than silently approximated.

---

# 27. CLI Contract

CLI MUST expose two distinct concepts:

- submit accepted;
- final acquisition result.

Required machine-readable fields:

```text
contract_id
intent_type
requested_scope
snapshot_id?
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

Non-interactive mode:

- cannot block indefinitely on confirmation;
- `NEEDS_USER_ACTION` returns a bounded machine-readable state;
- submit exit success does not mean final task success;
- wait mode final exit semantics MUST reflect final RequestFulfillment/SelectionAcquisition result.

---

# 28. v0.1.0 Support Slice Registry

A slice is supported only when every field below is satisfied by the implementation and validation evidence. The PRD freezes product behavior, not technical implementation.

## S1 — Direct HTTP/HTTPS File — REQUIRED

- Identity: explicit direct resource URL/response.
- Auth: public or locally brokered user-authorized browser context.
- Redirect: allowed when redirect chain remains part of the selected resource request and does not create discovery scope expansion.
- Cross-origin: allowed for redirect/CDN delivery of the selected resource.
- Resource model: single file.
- Validation: Transfer + Format/Target as applicable.
- Failure: truthful FAILED/UNSATISFIED; no HTML/error page false-success.

## S2 — Browser Download Handoff / Explicit Current-page Attachment — REQUIRED

- Identity: browser download response or explicit attachment/member identity on current page.
- Auth: browser-local authorized context may be propagated through local broker.
- Redirect: same rule as S1.
- Cross-origin: allowed when the attachment relation or redirect provenance binds it to the selected target.
- Resource model: single file.
- Validation: Target + Transfer + Format.
- Failure: auth/expiry/mismatch exposed; no silent fallback to unrelated same-page resource.

## S3 — Direct Media File — REQUIRED

- Identity: explicit downloadable video/audio resource.
- Auth/redirect/cross-origin: same selected-resource provenance rules.
- Resource model: single media file; no separate A/V mux requirement.
- Validation: Transfer + Format + Media + Target.
- Failure: missing/corrupt media is FAILED.

## S4 — HLS VOD Basic — REQUIRED

- Identity: HLS VOD manifest associated with selected target.
- Auth: browser-local authorized context allowed.
- Redirect/cross-origin: CDN/segment hosts allowed only as descendants of the selected manifest/resource provenance.
- Resource model: non-DRM VOD; supported single logical program/rendition path; no required multi-track post-processing beyond declared simple mux capability.
- Validation: manifest/rendition, segment completeness, final media presence.
- Failure: unsupported encryption/track topology/post-processing returns UNSUPPORTED/FAILED, never silent partial media success.

## S5 — Current-page Resource Collection — REQUIRED

- Identity: current page plus supported explicit member relation.
- Auth: current browser context.
- Redirect/cross-origin: allowed for member resource delivery when member provenance is retained.
- Resource model: finite members visible/declared by current-page template; no arbitrary navigation frontier.
- Validation: Membership + per-member Target/Transfer/Format + CoverageTarget semantics.
- Failure: partial members produce PARTIAL/UNKNOWN/TRUNCATED as appropriate; no count-based completeness.

## S6 — Explicit Playlist / Gallery Collection — REQUIRED

- Identity: explicit supported playlist/gallery CollectionIdentity.
- Membership: deterministic supported template/API/page relation.
- Auth: user-authorized context when required.
- Navigation: only declared collection continuation/member detail edges.
- Cross-origin/CDN: allowed for confirmed member delivery with provenance.
- Resource model: finite or naturally terminable supported collection.
- Validation: Membership + Target + per-member acquisition + Coverage.
- Failure: inability to close collection enumeration yields TRUNCATED/UNKNOWN; never general site frontier expansion.

## Conditional / Deferred slices

Not required for v0.1.0 release:

- DASH requiring separate audio/video mux;
- multi-audio / complex subtitle processing;
- generic bounded pagination across arbitrary listing sites;
- continuous collection monitoring;
- BitTorrent/magnet/eMule;
- proprietary cloud-drive protocols;
- full website/course mirroring.

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

Local secret rule:

- cookies/tokens/passwords stay in local broker/browser context where possible;
- LLM may receive capability facts such as `authentication_available=true` but MUST NOT require raw secret values to solve ordinary tasks;
- Recipe/Knowledge MUST NOT embed credentials, signed URLs as durable reusable rules, or user identity secrets.

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

## CJ-04 Current-page collection

```text
current page
→ confirmed member set
→ preview/select when needed
→ snapshot
→ batch acquire
→ per-member validation
→ coverage result
```

## CJ-05 Explicit playlist/gallery

```text
identify collection
→ validate membership basis
→ enumerate only collection edges
→ optional confirmation
→ snapshot
→ acquire
→ coverage validation
```

## CJ-06 Retry/resume

```text
existing snapshot
→ retry/resume original targets only
→ no silent target replacement or budget reset
```

## CJ-07 Model unavailable

```text
model unavailable
→ direct/template-supported paths continue
→ unresolved hard case returns NEEDS_USER_ACTION / UNKNOWN / UNSUPPORTED
```

## CJ-08 Site/template mismatch

```text
known template mismatches evidence
→ fail closed from old assumption
→ bounded repair/user confirmation path
→ never silently reuse stale target/membership claim
```

---

# 32. Product Gates and Confirmation Protocols

Gate results:

```text
PASS
FAIL
INSUFFICIENT_EVIDENCE
```

`UNKNOWN`, abandonment and out-of-scope handling are frozen below.

## 32.1 Common confirmation rules

- Sample unit: one end-to-end user Acquisition task, not each downloaded file.
- Inclusion: tasks intentionally sampled for the Gate and matching the frozen support slice/corpus.
- Out-of-scope task: excluded from primary success denominator but reported separately; an out-of-scope classification error counts against scope/UX correctness.
- `UNKNOWN`: not counted as success; remains in denominator unless the independent truth itself is unavailable, in which case result is `INSUFFICIENT_EVIDENCE`.
- Abandonment caused by xDownload friction/failure: counted as non-success.
- User cancellation for an external/unrelated reason: excluded only with pre-recorded reason.
- Truth source: pre-registered target/member expectations, independent manual oracle or authoritative collection/resource metadata; never model self-evaluation.
- Confirmation data isolation: Phase B tasks/results must not be opened before protocol, supported slices and decision rules are frozen.
- Protocol change after viewing Phase B result invalidates that confirmation run; a new independent confirmation set/run is required.
- Repeated runs of the same unchanged task do not create independent sample units.

## G0 — Product Value — REQUIRED

Corpora:

- Natural Corpus across S1–S6.

Primary correctness metric:

- correct end-to-end task fulfillment.

Secondary cost metrics:

- active user time;
- manual actions;
- recovery effort;
- false-success rate.

PASS rule:

1. every required Critical Journey has confirmation evidence on its required support slice;
2. no unresolved Critical wrong-target/false-success defect exists;
3. correct completion is not lower than the matched conventional baseline for the same task set;
4. collection tasks do not require more active user effort than the matched baseline without a compensating correctness improvement documented by independent truth.

Otherwise FAIL or INSUFFICIENT_EVIDENCE.

## G1a — Batch Acquisition Increment — REQUIRED for S5/S6

Comparison:

```text
manual/single-resource baseline
vs
batch acquisition with same frozen target set
```

PASS:

- strict reduction in active user actions or active user time;
- no lower correct completion;
- no new critical false-success.

## G1b — Navigation Increment — REQUIRED only when S6 confirmation task requires continuation/navigation

Comparison:

```text
same explicit collection with manual member navigation
vs
bounded collection continuation
```

PASS:

- strict reduction in active user effort/time on navigation-requiring tasks;
- no scope expansion;
- no correctness regression.

If v0.1.0 S6 confirmation corpus contains no navigation-requiring case, result is `INSUFFICIENT_EVIDENCE` and S6 must be narrowed to non-navigation collections before release.

## G1c — Semantic Selection Increment — REQUIRED when semantic filtering/selection is enabled

Comparison:

```text
raw candidate/manual selection
vs
semantic filtering/ASSISTED selection
```

PASS:

- strict reduction in selection effort/time;
- no increase in wrong-target rate;
- confirmation burden included in cost.

## G1d — Organization Increment — RECOMMENDED / non-blocking for v0.1.0

Organization can ship best-effort if correctness/provenance rules are satisfied even when measurable convenience gain is not proven.

## G2 — AI Increment — CONDITIONAL

Required only if AI fallback is enabled by default in v0.1.0 release.

Hard Corpus must be frozen from tasks where deterministic/template path is insufficient under the same Tools/Auth/Budgets.

PASS:

- AI-assisted path increases the number of correctly resolved hard tasks over deterministic/template baseline;
- no critical false-success increase;
- target truth remains independent;
- additional user work cannot be credited as AI success without being included in cost.

If G2 FAILS, base product may still release with AI disabled/experimental if all higher product gates pass.

## G3 — Local Knowledge Compounding — RECOMMENDED / non-blocking for v0.1.0

PASS only if Local Verified knowledge reduces at least one of model use, active time or repair effort on new in-scope pages/sessions while correctness does not regress and scope remains valid.

## G4 — Shared Knowledge — DEFERRED / NOT A v0.1.0 RELEASE GATE

Public/shared Recipe network is outside initial release requirements.

---

# 33. Experiment Corpora

## Natural Corpus

Ordinary in-scope tasks across S1–S6.

## Collection Corpus

- current-page attachments;
- explicit gallery;
- explicit playlist;
- at least one collection requiring supported continuation if S6 claims continuation support.

## Hard Corpus

Cases where deterministic/template path is insufficient or materially ambiguous.

## Holdout Corpus

New pages/sessions/profile states used for knowledge/generalization checks.

Baseline choice is task-specific and may include browser-native download, yt-dlp, JDownloader, Gopeed/Motrix or OmniGet-like workflow.

---

# 34. Capability Ablation

For Collection value attribution:

```text
A0 single/manual acquisition
A1 + current-page batch
A2 + bounded collection continuation
A3 + semantic filtering/selection
A4 + organization
```

Each layer receives credit only for its own incremental benefit.

---

# 35. Counterexample Corpus C01–C34

All cases are Product contract tests. Current executable status: **NOT RUN**.

Each run must pre-register target, scope, expected stop, expected result statuses and truth source.

| ID | Scenario | Required product behavior |
|---|---|---|
| C01 | Duplicate replaces a missing member while total count stays equal | No `VERIFIED_COMPLETE`; identity correspondence required. |
| C02 | Requested scope contains 150 members but implementation safety cap stops after 100 | Request `PARTIAL`, TargetResolution `PARTIAL`, Coverage `TRUNCATED`; never complete. |
| C03 | Next page fails / next control missing / pagination loops | Not natural end; Coverage `UNKNOWN`/`TRUNCATED` with truthful StopReason. |
| C04 | No declared total, but supported finite collection reaches independently validated natural end | `VERIFIED_COMPLETE` allowed only with identity/membership closure evidence. |
| C05 | User selects 5 of a larger collection and all 5 succeed | Selection COMPLETE; Coverage for selected scope complete/subset as frozen; never imply parent collection complete. |
| C06 | “First 1000 pages under domain, all PDFs” | Reject Collection admission as arbitrary frontier. |
| C07 | Confirmed collection member requires detail page/CDN | Allow only traceable member/detail/CDN path; retain provenance. |
| C08 | “Pages 1–3” with iframe/load-more/detail pages | Apply Scope Grammar: logical root pages only; iframe/load-more/detail do not silently alter page count. |
| C09 | Original vs thumbnail / main video vs ad are all technically valid files | No semantic PASS without typed independent Target/Quality evidence or sufficiently informed user claim. |
| C10 | Public collection advertises 18 items but current auth context can access only 16 | CoverageTarget includes auth context; do not explore unauthorized members; report accessible-scope truth. |
| C11 | Collection changes after Preview | Snapshot cannot silently drift; refresh creates successor snapshot. |
| C12 | Retry failed items | Retry only original failed members; no new/replacement members. |
| C13 | Restart/repair/UI+CLI concurrency | Budgets inherit remaining values; no duplicate budget allocation. |
| C14 | All discovered targets succeed but requested collection enumeration is unfinished | Selection may COMPLETE; Request PARTIAL/UNKNOWN; Coverage not VERIFIED_COMPLETE. |
| C15 | DASH/separate A/V requires unsupported mux | Return UNSUPPORTED/FAILED; never silent video-only success. |
| C16 | Simple task forced through unnecessary Scope/Preview | Product value fails that task if xDownload imposes avoidable interaction regression without correctness benefit. |
| C17 | Single-page batch succeeds but pagination untested | Evidence credits G1a only; G1b remains unproven. |
| C18 | Same bytes appear in two chapters / same names differ in content | Preserve member/source mapping; do not collapse semantic membership. |
| C19 | AI vs non-AI comparison | Same Tools/Auth/Budget/Context and independent truth required. |
| C20 | Local Recipe replay on new page/session/layout change | Cache/output controlled; scope and correctness revalidated. |
| C21 | Shared knowledge on independent user/account | Not a v0.1.0 release gate; if tested, no credential/private-data leakage and scope must fail closed. |
| C22 | Too little evidence | Return `INSUFFICIENT_EVIDENCE`; no post-hoc threshold conversion to PASS. |
| C23 | Whole collection requested; page 1–2 selected targets succeed; page 3 undiscovered due DiscoveryBudget | Request PARTIAL; Resolution PARTIAL; Selection COMPLETE; Coverage TRUNCATED; Stop DISCOVERY_BUDGET_EXHAUSTED. |
| C24 | Auth failure yields no targets | Request UNSATISFIED; Resolution BLOCKED; Selection NOT_STARTED; Coverage UNKNOWN; Stop AUTH_REQUIRED/AUTH_FAILED. |
| C25 | Parent collection 10 pages; user requests only pages 1–3 and all requested members succeed | CoverageTarget is pages 1–3; Coverage VERIFIED_COMPLETE for requested scope only; no whole-parent claim. |
| C26 | User confirms a system-labeled “original” candidate without enough distinguishing information | User click proves selection only; QUALITY/semantic original claim remains unverified. |
| C27 | User confirms correct candidate, but transfer is truncated/missing required track | Selection evidence does not waive validation; SelectionAcquisition not COMPLETE. |
| C28 | DiscoveryBudget exhausted; frozen HLS target still needs segments | May continue only if TransferBudget + GlobalSafetyBudget remain; HLS requests count TransferBudget. |
| C29 | Current-page attachment redirects to declared CDN | S2 provenance rule accepts; validate final target; arbitrary unrelated redirect is rejected/fails. |
| C30 | 50 candidates each ask one confirmation; batch/manual selection can resolve once | Interaction policy requires batch/manual selection; per-item confirmation burden counts against G0/G1c. |
| C31 | User selects 12/18 once; later similar page differs | Task selection is not reusable membership knowledge without cross-task validation/promotion. |
| C32 | Confirmation set includes failure, abandonment, UNKNOWN, out-of-scope | Apply common denominator rules exactly; teams must derive same Gate input set. |
| C33 | Team sees confirmation result, then changes template/support/decision rule | Prior confirmation invalidated; new independent confirmation required. |
| C34 | UI suggestion is used as “ground truth” in one experiment | Invalid; truth must be pre-registered/independent and cannot be rewritten by confirmation. |

---

# 36. Acceptance Criteria for Product/Scope Freeze

This PRD is eligible for Product/Scope Freeze only when:

1. formal L1 Product Evidence is checkpointed;
2. the current exact PRD subject receives required Fresh Independent Product Review `PASS`;
3. no unresolved P0/P1 changes product semantics;
4. S1–S6 product support contracts are considered sufficiently specific for L2 to design without inventing product behavior;
5. C01–C34 each have a unique expected product outcome;
6. UI/CLI result semantics are coherent with the shared AcquisitionContract;
7. Product gates and denominator/UNKNOWN/abandonment/truth/isolation rules are frozen;
8. product release target `v0.1.0`, scope and non-goals are accepted;
9. no Architecture implementation choice has been accidentally frozen as product authority.

Product Freeze review is assurance evidence. It does not substitute for downstream executable Validation.

---

# 37. v0.1.0 Release Blockers Frozen by this PRD

After Product Freeze and implementation, v0.1.0 cannot qualify for release while any of the following remains unresolved:

- critical wrong-target or false-success defect;
- arbitrary crawler/frontier escape from Collection admission;
- required S1–S6 support slice not implemented/validated or explicitly removed through a Product amendment;
- G0 FAIL / INSUFFICIENT_EVIDENCE;
- required G1a failure for collection slices;
- required G1b failure where release claims continuation/navigation;
- required G1c failure where semantic selection is enabled;
- required Critical Journey failure;
- model-unavailable regression on deterministic/template-supported ordinary tasks;
- credential/secret leakage across Browser/Recipe/LLM boundary;
- required validation/package/release gates from Frozen Architecture/standard not satisfied.

G2 may fail without blocking the base release only if AI is disabled or clearly experimental in that release.

G3/G4 are not base v0.1.0 release blockers.

---

# 38. Finding Closure Matrix

## 38.1 v0.4 Claude structural findings

| Finding | v0.4.1 response | Intended re-review status |
|---|---|---|
| S1 unclear v0.4/v0.3 relationship | §0 makes v0.4.1 a complete self-contained successor | CLOSE candidate |
| S2 N01–N08 not durable | v0.3 review is now durable; §38.2 maps N01–N08 | CLOSE candidate |
| S3 C23–C34 missing | §35 defines C23–C34 with expected results | CLOSE candidate |
| S4 names without rules | §§8–32 define schemas, precedence, status combinations, support slices and Gate rules | CLOSE candidate |

## 38.2 N01–N08

| Finding | v0.4.1 response | Intended re-review status |
|---|---|---|
| N01 selected acquisition vs request fulfillment | §§16–18 split Request/Resolution/Selection/Coverage and legal combinations | CLOSE candidate |
| N02 user confirmation proof scope | §§20–22 typed claims and validation non-waiver | CLOSE candidate |
| N03 Coverage reference | §17 explicit CoverageTarget | CLOSE candidate |
| N04 Budget domain conflict | §15 Discovery/Transfer/Global + precedence | CLOSE candidate |
| N05 Support Slice not concrete | §28 concrete S1–S6 contracts | CLOSE candidate |
| N06 Gate protocol not executable | §32 common denominator/truth/isolation rules + per-Gate decision rules | CLOSE candidate |
| N07 interaction cost | §13 and G0/G1c count confirmation/cognitive burden | CLOSE candidate |
| N08 task choice vs reusable knowledge | §24 promotion contract + C31 | CLOSE candidate |

## 38.3 Historical F01–F12

| Finding | Current disposition |
|---|---|
| F01 Completeness weakness | Addressed by identity sets + CoverageTarget + §19. |
| F02 Crawler boundary | Addressed by §9 AND admission + no frontier. |
| F03 Semantic self-certification | Addressed by typed independent evidence and user-claim limits. |
| F04 Scope/Selection/Budget ambiguity | Addressed by §§8–10, §15. |
| F05 Preview drift | Addressed by SelectionSnapshot. |
| F06 Budget reset | Addressed by lifecycle inheritance and domain precedence. |
| F07 final status ambiguity | Addressed by §§16–18. |
| F08 support breadth | Addressed by concrete S1–S6 + deferred slices. |
| F09 collection attribution | Addressed by G1a–G1d + ablation. |
| F10 post-hoc Gate judgement | Addressed by §32 confirmation protocol. |
| F11 organization semantics | Constrained by §25; best-effort, identity-preserving. |
| F12 Recipe promotion | Constrained by §24; shared promotion deferred. |

Actual `CLOSED/PARTIAL/OPEN` is determined only by a Fresh Independent Reviewer on the exact current subject.

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

After Product/Scope Freeze, L2 may decide:

- desktop framework;
- language/runtime;
- browser extension architecture;
- process boundaries;
- storage implementation;
- download engine implementation/reuse;
- template DSL representation;
- validation implementation;
- local secret broker design;
- model provider/runtime integration;
- package structure/monorepo layout;
- exact platform/build toolchains.

L2 MUST NOT change the frozen Product semantics simply to simplify implementation.

---

# PRD Terminal

```text
Product: xDownload
Product release target: v0.1.0
PRD revision: v0.4.1
ADS Stage: Stage 1 Product/Scope Review Candidate
Primary value: correct, reliable, low-friction targeted resource acquisition
Primary UI: Desktop
Browser integration: Core
CLI: First-class automation surface
Intent model: SingleResourceIntent + CollectionIntent
Collection rule: identifiable collection + membership + bounded declared edges + hard stop + no arbitrary frontier
Automation modes: AUTO / ASSISTED / MANUAL_SELECTION
Execution strategy: Template-first / Minimum Necessary Intelligence
Interaction strategy: Minimum Necessary Interaction
AI: bounded knowledge-gap fallback; conditional release gate
Result model: RequestFulfillment + TargetResolution + SelectionAcquisition + Coverage + StopReason
Coverage: always bound to explicit CoverageTarget
Validation: independent claim-based evidence; user confirmation does not waive transfer/format/media checks
Required v0.1.0 support slices: S1–S6
Counterexample corpus: C01–C34
Formal L1 Product Evidence: COMPLETE
Economic benefit: NOT_MEASURED
Product Freeze: NO
Architecture Freeze: NO
L2 eligibility: NO
Next required action: Fresh Independent Product/Scope Review on exact SHA under ADS Stage 1
```
