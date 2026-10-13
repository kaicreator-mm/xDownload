# S5 successor — shipped current-page member collection (v0.1.0)

**Authority:** #109; **status:** PROPOSED / independent exact-SHA review required.  
**Frozen base:** `version/v0.1.0@0d9fd0bb6c5c3cb735e7feedd148228f15d8bc78`.  
**Product:** PRD §§9, 10, 13–17, 20–22, 28 S5, 29, 31; L2/T011/T016. **Not preauthorized by S1 #103 or S6 #110.**

## Narrow architecture proposal

S5 is only the **user-confirmed current-page membership snapshot**, with `requestedScope.kind=current_page` and the default `continuationScope.kind=NONE`; it is not an implicit lazy-load/page-2 crawler. A user gesture in the installed extension collects observable candidate members and their source/member provenance. Discovery is *untrusted evidence*, never a transfer order or an accepted selection. The extension may render one group confirmation or a small number of material choices, but must not require manually downloading each item or entering each hash.

The privileged browser/Native Messaging zone validates origin, selected member binding and scoped authorization. Only bounded, secret-free member identity and scoped delivery references cross to Core. Do not export raw cookies/tokens to models, logs, Recipes or Core; broker capabilities are exact origin/contract/snapshot/member/TTL/partition-bound and revocable. Unsupported cross-origin member delivery is either positively provenance-authorized or rejected.

The one authoritative Core validates the already accepted contract, immutable page snapshot, membership basis `CONFIRMED_PAGE_SNAPSHOT`, user/group confirmation, selected target set, continuation NONE and allowed delivery graph. Proposed closed Core collection carrier is S5-specific and **requires its own reviewed L2 contract**, not generic URL execution. The member plan is journaled/committed before any transfer, with a durable work item/effect identity and scoped budget per member. Reuse T011 `discovery-recipe/slices.ts`, T016 `browser-collection-workflow/collection-flow.ts`, T008 direct acquisition and T009 HLS only for supported per-member types; do not create another browser-owned scheduler/ledger.

Each selected member needs Target+Transfer+Format and canonical Core artifact acceptance, plus **Membership Validation** against the pre-exposure confirmed snapshot; **Coverage Validation** needs independently accounted requested-scope membership. `RequestFulfillmentStatus`, `TargetResolutionStatus`, `SelectionAcquisitionStatus`, `CoverageStatus`, `StopReason` are the frozen multidimensional terminal—not the success count. Unsupported, inaccessible or unknown members are reported, never invisibly removed from the original request. If user requests a subset, make the selected subset the confirmed requested_scope *before* transfer and preserve correspondence to the parent page.

## Edge rules / fail-closed matrix

| Case | Required truth |
|---|---|
| Default S5 request; new members appear on scroll | Exclude from current frozen snapshot; new inclusion requires successor contract/snapshot |
| User chooses only 5 of 12 members | Explicit confirmed five-member scope; retain parent relation and no false parent completeness |
| Same filename/digest on two selected members | Keep both logical member identities/positions despite byte dedup |
| Member redirect to undeclared CDN | Deny wrong origin; no raw auth leak or inferred host authority |
| Browser login session expired / 2 inaccessible | Preserve requested reference scope; report AUTH_REQUIRED/AUTH_FAILED with accessible subset, do not claim complete fulfillment |
| Count equals requested count but independent membership evidence absent | Coverage UNKNOWN/TRUNCATED, never VERIFIED_COMPLETE |
| One member fails but 5 succeed | Truthful PARTIAL or UNSATISFIED, no group all-passed claim |
| Extension content script forges user confirmation | Refuse; only privileged user decision binds snapshot |
| User cancels/retries after some member accepts | Enforce Core cutoff, one effect per member, no budget replenishment |
| Change to current-page membership after freeze | Detect drift; new snapshot, no silent target substitution |

## Implementation gate and product proof

Independent #109 architecture contract review → small Core S5 batch/member execution PR → bounded installed extension user-surface PR → fresh independent real-browser + Native Messaging + Core evidence for one S5 group operation, without private-module-only execution → #100 installed-path re-review → future T019/T020/T021/T023 candidate gates → #81 genuine G0/G1a humans. Use existing C03/C04/C08/C17/C23/C24/C30/CJ09 fixtures as negative reference, and independent pre-exposure oracle separate from test operator.

**Not included:** S6 continuation/navigation, general site frontier, unconfirmed lazy-load items, arbitrary recursive crawl, new Product scope or release qualification. Frozen original L2/Task DAG/PRD remain byte-identical. **RELEASE_PASS=NO.**
