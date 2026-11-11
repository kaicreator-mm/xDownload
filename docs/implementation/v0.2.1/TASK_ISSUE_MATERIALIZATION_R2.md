# xDownload v0.2.1 — Native Task DAG Independent Readback R2

```ini
STATUS=PASS_NATIVE_DAG_BIDIRECTIONAL_READBACK
PLANNING_HEAD_AT_READBACK=7e8ac7f902e4a65cf2af0295fff810751cc493f5
FROZEN_DAG_BLOB=ecb2e31088c9e3895fad042401f737938c37628a
FROZEN_TASK_PACK_BLOB=c0cbed29ffa1a47cad5aed288aa262dd0dd549a8
MAIN_SHA=c29af4a4b89123997d03d5566ebe09ba83855fb0
VERSION_BRANCH_SHA=c29af4a4b89123997d03d5566ebe09ba83855fb0
TASK_ISSUES=22_OF_22_OPEN_PLANNED
BLOCKED_BY_GET=22_OF_22_SUCCESS
BLOCKED_BY_EDGES=63_OF_63_EXACT
BLOCKING_GET=22_OF_22_SUCCESS
BLOCKING_EDGES=63_OF_63_RECIPROCAL_EXACT
MISSING=0
EXTRA=0
DUPLICATE=0
INITIAL_READY_FRONTIER=T01_ISSUE_250_ONLY
JIT_CLAIMS=NONE
SOURCE_DISPATCH=NONE
CI=NO_RUN
MAIN_MERGE=NO
```

## 1. Purpose and authority

This is an additive current-readback receipt for the native GitHub Issue dependency graph. It does not modify or supersede the frozen Product, L2, Task DAG or Task Packs. It supplements the earlier write receipt `TASK_ISSUE_MATERIALIZATION_R1.md` (blob `af9fa5afd6888bfe9ee36b09951816610e0fa6b8`).

The current planning branch HEAD at readback start was `7e8ac7f902e4a65cf2af0295fff810751cc493f5`. The live planning DAG blob remains `ecb2e31088c9e3895fad042401f737938c37628a`; the Task Pack blob remains `c0cbed29ffa1a47cad5aed288aa262dd0dd549a8`. The integration branch `version/v0.2.1` and `main` both remain at the frozen baseline `c29af4a4b89123997d03d5566ebe09ba83855fb0`.

## 2. Independent native readback

Authenticated GitHub REST GETs were performed against every canonical Task Issue:

- `GET /issues/{250..271}/dependencies/blocked_by`: 22/22 successful responses.
- `GET /issues/{250..271}/dependencies/blocking`: 22/22 successful responses.
- The predecessor/successor mapping was compared against the frozen 22-node, 63-edge DAG, not against Issue body prose.
- Both directions match exactly: 63/63 blocked_by and 63/63 reciprocal blocking.
- Missing = 0, extra = 0, duplicate = 0, one-sided relationships = 0.

### 2.1 Blocked-by readback

| Task | Issue | Exact native blocked_by |
|---|---:|---|
| T01 | #250 | — |
| T02 | #251 | #250, #252, #255 |
| T03 | #252 | #250 |
| T04 | #253 | #250, #251 |
| T05 | #254 | #250, #251 |
| T06 | #255 | #250 |
| T07 | #256 | #250, #251 |
| T08 | #257 | #250, #251, #252, #256 |
| T09 | #258 | #253, #254, #255, #256, #257 |
| T10 | #259 | #253, #254, #255, #257, #258 |
| T11 | #260 | #250 |
| T12 | #261 | #251, #253, #258, #260 |
| T13 | #262 | #251, #254, #258, #260 |
| T14 | #263 | #251, #257, #258, #260 |
| T15 | #264 | #251, #255, #258, #260 |
| T16 | #265 | #258, #261, #262, #263, #264 |
| T17 | #266 | #261, #262, #263, #264, #265 |
| T18 | #267 | #259, #261, #262, #263, #264, #265, #266 |
| T19 | #268 | #267 |
| T20 | #269 | #268 |
| T21 | #270 | #269 |
| T22 | #271 | #270 |

### 2.2 Reciprocal blocking readback

| Task | Issue | Exact native blocking |
|---|---:|---|
| T01 | #250 | #251, #252, #253, #254, #255, #256, #257, #260 |
| T02 | #251 | #253, #254, #256, #257, #261, #262, #263, #264 |
| T03 | #252 | #251, #257 |
| T04 | #253 | #258, #259, #261 |
| T05 | #254 | #258, #259, #262 |
| T06 | #255 | #251, #258, #259, #264 |
| T07 | #256 | #257, #258 |
| T08 | #257 | #258, #259, #263 |
| T09 | #258 | #259, #261, #262, #263, #264, #265 |
| T10 | #259 | #267 |
| T11 | #260 | #261, #262, #263, #264 |
| T12 | #261 | #265, #266, #267 |
| T13 | #262 | #265, #266, #267 |
| T14 | #263 | #265, #266, #267 |
| T15 | #264 | #265, #266, #267 |
| T16 | #265 | #266, #267 |
| T17 | #266 | #267 |
| T18 | #267 | #268 |
| T19 | #268 | #269 |
| T20 | #269 | #270 |
| T21 | #270 | #271 |
| T22 | #271 | — |

## 3. Corrected ready frontier and topological layers

**Correction to one sentence in R1:** R1's final paragraph incorrectly said both T01 #250 and T11 #260 had no predecessors. The frozen DAG table and live native API show T11 #260 is blocked by T01 #250. T01 #250 is the **only** initial dependency-ready Task.

Topological layers derived from the frozen DAG (a layer is a dependency wave, not permission to dispatch every member before currentness/Claim checks):

| Layer | Tasks | Count |
|---:|---|---:|
| 1 | T01 | 1 |
| 2 | T03, T06, T11 | 3 |
| 3 | T02 | 1 |
| 4 | T04, T05, T07 | 3 |
| 5 | T08 | 1 |
| 6 | T09 | 1 |
| 7 | T10, T12, T13, T14, T15 | 5 |
| 8 | T16 | 1 |
| 9 | T17 | 1 |
| 10 | T18 | 1 |
| 11 | T19 | 1 |
| 12 | T20 | 1 |
| 13 | T21 | 1 |
| 14 | T22 | 1 |

Maximum graph-layer width is 5. A dependent Task becomes eligible only after every actual predecessor Issue is in the required terminal `state:done` and the remaining JIT/currentness/admission predicates are freshly satisfied. A Claim or a PR alone does not unblock a dependent.

## 4. Issue-body snapshot currentness

The 22 Task Issue bodies remain unchanged as stable work contracts. Their `native_dependencies: NOT_MATERIALIZED` field records the creation-time planning snapshot; it is not a current native-DAG projection and MUST NOT override this later exact native API readback. Do not mass-rewrite historical Task Issue bodies into a mutable status dashboard. Current native dependencies and subsequent execution facts are authoritative in GitHub native objects and append-oriented events/comments, consistent with ADS v4.18 currentness/consumer guidance (including ADS #1348).

## 5. Execution boundary

All 22 Task Issues remain `state:planned` at this receipt. This readback admits only **dispatch planning**. It does not accept a Builder Claim or authorize source mutation. For T01, the next legal controller step is a fresh per-Task read of Issue #250, its empty native `blocked_by`, exact current `version/v0.2.1` base, Task Pack identity, existing Claim/dispatch history, role/Execution Pack requirements and applicable assurance/currentness facts. Only then may the single writer create the JIT dispatch and publish an accepted `DISPATCH_CLAIMED` event. No source write occurs before accepted Claim.

No CI, local test, runtime, installed-product, release or main-merge PASS is implied by this receipt.
