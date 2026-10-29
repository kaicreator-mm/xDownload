# xDownload v0.2.1 — Task Issue Materialization Receipt R1

```ini
STATUS=NATIVE_DEPENDENCIES_MATERIALIZED_READBACK_PASS
PLANNING_FREEZE_RECEIPT=docs/implementation/v0.2.1/FREEZE_RECEIPT_R1.md
FROZEN_PLANNING_SUBJECT=07af78c3abee741196ff566a7f21fdfe15d71da7
PLANNING_BRANCH_HEAD_BEFORE_THIS_RECEIPT=2291b715d47992b10aad7ac865fbeaa28ab0b64a
PREVIOUS_RECEIPT_HEAD=1cffd6445308ac78fa2f9e4489af579f0deb32ef
INTEGRATION_BRANCH=version/v0.2.1
INTEGRATION_BASE_SHA=c29af4a4b89123997d03d5566ebe09ba83855fb0
TASK_ISSUES_CREATED=22/22
TASK_ISSUES_STATE=PLANNED
NATIVE_DEPENDENCIES_WRITTEN=63/63
NATIVE_DEPENDENCY_READBACK=PASS_63_63_EXACT
NATIVE_DEPENDENCY_READBACK_MISSING=0
NATIVE_DEPENDENCY_READBACK_EXTRA=0
NATIVE_DEPENDENCY_READBACK_DUPLICATE=0
JIT_CLAIMS=NONE
SOURCE_DISPATCH=NONE
CI=NO_RUN
MAIN=HOLD
```

## 1. Frozen authority

Task Issue materialization follows Product/L2/DAG Freeze Receipt R1. The exact reviewed planning blobs remain unchanged. The canonical Task Pack source is `docs/implementation/v0.2.1/TASK_PACKS_R0.md` at planning branch commit `1cffd6445308ac78fa2f9e4489af579f0deb32ef`, blob `c0cbed29ffa1a47cad5aed288aa262dd0dd549a8`.

The integration branch `version/v0.2.1` was created from the accepted base `main@c29af4a4b89123997d03d5566ebe09ba83855fb0`. It contains no v0.2.1 source changes.

This receipt update records the completion of the native dependency materialization that was blocked in the previous state (`PARTIAL_BLOCKED_NATIVE_DEPENDENCY_WRITE_API`). Only this receipt file changed on the planning branch; no frozen authority document was modified.

## 2. Canonical Task Issues

All 22 issues below were created with their frozen Task Pack text, exact baseline, task ID, declared dependency IDs, allowed write set, risk/review labels, and `state:planned`. Each issue body explicitly says `native_dependencies: NOT_MATERIALIZED` and `dispatch_status: NONE`; body metadata is not treated as a native dependency edge or execution authorization.

| Task | Issue | Declared predecessors |
|---|---:|---|
| T01 | #250 | — |
| T02 | #251 | T01, T03, T06 |
| T03 | #252 | T01 |
| T04 | #253 | T01, T02 |
| T05 | #254 | T01, T02 |
| T06 | #255 | T01 |
| T07 | #256 | T01, T02 |
| T08 | #257 | T01, T02, T03, T07 |
| T09 | #258 | T04, T05, T06, T07, T08 |
| T10 | #259 | T04, T05, T06, T08, T09 |
| T11 | #260 | T01 |
| T12 | #261 | T02, T04, T09, T11 |
| T13 | #262 | T02, T05, T09, T11 |
| T14 | #263 | T02, T08, T09, T11 |
| T15 | #264 | T02, T06, T09, T11 |
| T16 | #265 | T09, T12, T13, T14, T15 |
| T17 | #266 | T12, T13, T14, T15, T16 |
| T18 | #267 | T10, T12, T13, T14, T15, T16, T17 |
| T19 | #268 | T18 |
| T20 | #269 | T19 |
| T21 | #270 | T20 |
| T22 | #271 | T21 |

## 3. Native dependency materialization execution

Executor: Windows Git Bash with the authenticated `gh` CLI (account `kaicreator-mm`, token scopes `gist, read:org, repo, workflow`). Direct `api.github.com` access showed transient `TLS handshake timeout` errors; all calls therefore alternated the local proxy (`http://127.0.0.1:10808`) and direct connection with retry. Every write below succeeded on its first attempt; no retried write, no duplicate creation, and no 4xx/5xx write occurred.

### 3.1 Edge source and mapping verification (no manual transcription)

- Edges were machine-extracted from the frozen `TASK_DAG_R0.md` at planning HEAD `2291b715d47992b10aad7ac865fbeaa28ab0b64a` from two independent sources: the mermaid graph (63 edges, including the `T18 --> T19 --> T20 --> T21 --> T22` chain parsed as 4 edges) and the task-table `Depends on` column (63 edges). Both extracted sets are identical and contain no duplicates. Extraction exit code 0.
- Task→Issue mapping `Tnn → #(249+nn)` was verified against every issue title tag `[v0.2.1][Tnn]`: 22/22 open issues matched, zero mismatches. Predecessor database IDs were taken from `GET /repos/kaicreator-mm/xDownload/issues/{n}` (`id` field), never from issue numbers.

### 3.2 Pre-state

`GET .../issues/{250..271}/dependencies/blocked_by` for all 22 issues returned empty arrays: 0 pre-existing edges (consistent with the previous receipt state `NATIVE_DEPENDENCIES_WRITTEN=0/63`). One probe edge `#268 blocked_by #267` was written first to validate the endpoint (`HTTP/2.0 201 Created`, `Date: Thu, 29 Oct 2026 23:01:19 GMT`, `X-Github-Request-Id: A668:1E4738:8473D:CD9FA`); the batch therefore treated it as pre-existing and skipped it, so no edge was ever POSTed twice.

### 3.3 Writes (all 63 edges)

Endpoint per edge: `POST /repos/kaicreator-mm/xDownload/issues/{blocked_issue_number}/dependencies/blocked_by` with body `{"issue_id": <predecessor issue database ID>}` (`gh api -F issue_id=<dbid>`). Batch window `2026-10-29T23:02:50Z`–`23:05:22Z` (62 POSTs + 1 skip, 0.4 s throttle between writes). Result: 62 batch POSTs `HTTP/2.0 201 Created`, `rc=0`, `attempt=1`; 1 skipped as pre-existing (probe-created); 0 failed. Batch exit code 0.

Real API response sample (probe POST, raw): status line `HTTP/2.0 201 Created`, `Location: https://api.github.com/repos/kaicreator-mm/xDownload/issues/268`, `X-Ratelimit-Remaining: 4917`, response body is the blocked issue object including `"issue_dependencies_summary":{"blocked_by":1,"total_blocked_by":1,"blocking":0,"total_blocking":0}`.

| # | Blocked (Task) | Prereq (Task) | Prereq DB ID | Write action | HTTP status | rc |
|---:|---|---|---|---|---|---|
| 1 | #251 (T02) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 2 | #251 (T02) | #252 (T03) | 6108520514 | POST created | HTTP/2.0 201 Created | 0 |
| 3 | #251 (T02) | #255 (T06) | 6108528767 | POST created | HTTP/2.0 201 Created | 0 |
| 4 | #252 (T03) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 5 | #253 (T04) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 6 | #253 (T04) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 7 | #254 (T05) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 8 | #254 (T05) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 9 | #255 (T06) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 10 | #256 (T07) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 11 | #256 (T07) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 12 | #257 (T08) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 13 | #257 (T08) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 14 | #257 (T08) | #252 (T03) | 6108520514 | POST created | HTTP/2.0 201 Created | 0 |
| 15 | #257 (T08) | #256 (T07) | 6108529524 | POST created | HTTP/2.0 201 Created | 0 |
| 16 | #258 (T09) | #253 (T04) | 6108521166 | POST created | HTTP/2.0 201 Created | 0 |
| 17 | #258 (T09) | #254 (T05) | 6108521818 | POST created | HTTP/2.0 201 Created | 0 |
| 18 | #258 (T09) | #255 (T06) | 6108528767 | POST created | HTTP/2.0 201 Created | 0 |
| 19 | #258 (T09) | #256 (T07) | 6108529524 | POST created | HTTP/2.0 201 Created | 0 |
| 20 | #258 (T09) | #257 (T08) | 6108530120 | POST created | HTTP/2.0 201 Created | 0 |
| 21 | #259 (T10) | #253 (T04) | 6108521166 | POST created | HTTP/2.0 201 Created | 0 |
| 22 | #259 (T10) | #254 (T05) | 6108521818 | POST created | HTTP/2.0 201 Created | 0 |
| 23 | #259 (T10) | #255 (T06) | 6108528767 | POST created | HTTP/2.0 201 Created | 0 |
| 24 | #259 (T10) | #257 (T08) | 6108530120 | POST created | HTTP/2.0 201 Created | 0 |
| 25 | #259 (T10) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 26 | #260 (T11) | #250 (T01) | 6108519038 | POST created | HTTP/2.0 201 Created | 0 |
| 27 | #261 (T12) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 28 | #261 (T12) | #253 (T04) | 6108521166 | POST created | HTTP/2.0 201 Created | 0 |
| 29 | #261 (T12) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 30 | #261 (T12) | #260 (T11) | 6108539175 | POST created | HTTP/2.0 201 Created | 0 |
| 31 | #262 (T13) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 32 | #262 (T13) | #254 (T05) | 6108521818 | POST created | HTTP/2.0 201 Created | 0 |
| 33 | #262 (T13) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 34 | #262 (T13) | #260 (T11) | 6108539175 | POST created | HTTP/2.0 201 Created | 0 |
| 35 | #263 (T14) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 36 | #263 (T14) | #257 (T08) | 6108530120 | POST created | HTTP/2.0 201 Created | 0 |
| 37 | #263 (T14) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 38 | #263 (T14) | #260 (T11) | 6108539175 | POST created | HTTP/2.0 201 Created | 0 |
| 39 | #264 (T15) | #251 (T02) | 6108519800 | POST created | HTTP/2.0 201 Created | 0 |
| 40 | #264 (T15) | #255 (T06) | 6108528767 | POST created | HTTP/2.0 201 Created | 0 |
| 41 | #264 (T15) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 42 | #264 (T15) | #260 (T11) | 6108539175 | POST created | HTTP/2.0 201 Created | 0 |
| 43 | #265 (T16) | #258 (T09) | 6108530965 | POST created | HTTP/2.0 201 Created | 0 |
| 44 | #265 (T16) | #261 (T12) | 6108540071 | POST created | HTTP/2.0 201 Created | 0 |
| 45 | #265 (T16) | #262 (T13) | 6108540848 | POST created | HTTP/2.0 201 Created | 0 |
| 46 | #265 (T16) | #263 (T14) | 6108541530 | POST created | HTTP/2.0 201 Created | 0 |
| 47 | #265 (T16) | #264 (T15) | 6108542091 | POST created | HTTP/2.0 201 Created | 0 |
| 48 | #266 (T17) | #261 (T12) | 6108540071 | POST created | HTTP/2.0 201 Created | 0 |
| 49 | #266 (T17) | #262 (T13) | 6108540848 | POST created | HTTP/2.0 201 Created | 0 |
| 50 | #266 (T17) | #263 (T14) | 6108541530 | POST created | HTTP/2.0 201 Created | 0 |
| 51 | #266 (T17) | #264 (T15) | 6108542091 | POST created | HTTP/2.0 201 Created | 0 |
| 52 | #266 (T17) | #265 (T16) | 6108548716 | POST created | HTTP/2.0 201 Created | 0 |
| 53 | #267 (T18) | #259 (T10) | 6108531680 | POST created | HTTP/2.0 201 Created | 0 |
| 54 | #267 (T18) | #261 (T12) | 6108540071 | POST created | HTTP/2.0 201 Created | 0 |
| 55 | #267 (T18) | #262 (T13) | 6108540848 | POST created | HTTP/2.0 201 Created | 0 |
| 56 | #267 (T18) | #263 (T14) | 6108541530 | POST created | HTTP/2.0 201 Created | 0 |
| 57 | #267 (T18) | #264 (T15) | 6108542091 | POST created | HTTP/2.0 201 Created | 0 |
| 58 | #267 (T18) | #265 (T16) | 6108548716 | POST created | HTTP/2.0 201 Created | 0 |
| 59 | #267 (T18) | #266 (T17) | 6108549383 | POST created | HTTP/2.0 201 Created | 0 |
| 60 | #268 (T19) | #267 (T18) | 6108549989 | PROBE 201 + batch SKIP (pre-existing) | HTTP/2.0 201 Created (probe 23:01:19Z) | 0 |
| 61 | #269 (T20) | #268 (T19) | 6108550675 | POST created | HTTP/2.0 201 Created | 0 |
| 62 | #270 (T21) | #269 (T20) | 6108551294 | POST created | HTTP/2.0 201 Created | 0 |
| 63 | #271 (T22) | #270 (T21) | 6108557428 | POST created | HTTP/2.0 201 Created | 0 |

### 3.4 Strict readback (63/63)

After the writes, `GET .../issues/{250..271}/dependencies/blocked_by` was re-read for **all 22** Task Issues (window `2026-10-29T23:05:35Z`–`23:06:22Z`, 44 GETs incl. raw capture, exit code 0) and the actual edge set was compared as a multiset against the 63 frozen edges mapped to issue numbers:

```text
EXPECTED_EDGES=63
ACTUAL_EDGES=63
MISSING_EDGES=0
EXTRA_EDGES=0
DUPLICATE_EDGES=0
VERDICT=PASS 63/63 exact readback match
```

Real readback API response sample (`GET .../issues/268/dependencies/blocked_by`): array whose first element is the predecessor issue object `{"url":"https://api.github.com/repos/kaicreator-mm/xDownload/issues/267",...,"id":6108549989,"number":267,"title":"[v0.2.1][T18] Candidate Freeze",...}` — predecessor identity is carried by both database ID and issue number.

| Task | Issue | Frozen predecessors (issues) | Readback blocked_by (issues) | Count | Match |
|---|---:|---|---|---:|---|
| T01 | #250 | (none) | (none) | 0 | EXACT |
| T02 | #251 | #250 #252 #255 | #250 #252 #255 | 3 | EXACT |
| T03 | #252 | #250 | #250 | 1 | EXACT |
| T04 | #253 | #250 #251 | #250 #251 | 2 | EXACT |
| T05 | #254 | #250 #251 | #250 #251 | 2 | EXACT |
| T06 | #255 | #250 | #250 | 1 | EXACT |
| T07 | #256 | #250 #251 | #250 #251 | 2 | EXACT |
| T08 | #257 | #250 #251 #252 #256 | #250 #251 #252 #256 | 4 | EXACT |
| T09 | #258 | #253 #254 #255 #256 #257 | #253 #254 #255 #256 #257 | 5 | EXACT |
| T10 | #259 | #253 #254 #255 #257 #258 | #253 #254 #255 #257 #258 | 5 | EXACT |
| T11 | #260 | #250 | #250 | 1 | EXACT |
| T12 | #261 | #251 #253 #258 #260 | #251 #253 #258 #260 | 4 | EXACT |
| T13 | #262 | #251 #254 #258 #260 | #251 #254 #258 #260 | 4 | EXACT |
| T14 | #263 | #251 #257 #258 #260 | #251 #257 #258 #260 | 4 | EXACT |
| T15 | #264 | #251 #255 #258 #260 | #251 #255 #258 #260 | 4 | EXACT |
| T16 | #265 | #258 #261 #262 #263 #264 | #258 #261 #262 #263 #264 | 5 | EXACT |
| T17 | #266 | #261 #262 #263 #264 #265 | #261 #262 #263 #264 #265 | 5 | EXACT |
| T18 | #267 | #259 #261 #262 #263 #264 #265 #266 | #259 #261 #262 #263 #264 #265 #266 | 7 | EXACT |
| T19 | #268 | #267 | #267 | 1 | EXACT |
| T20 | #269 | #268 | #268 | 1 | EXACT |
| T21 | #270 | #269 | #269 | 1 | EXACT |
| T22 | #271 | #270 | #270 | 1 | EXACT |

Execution summary (all UTC): mapping fetch 22/22 (exit 0, title verify 22/22); pre-state read of 22 issues → 0 edges (exit 0); probe write 23:01:19Z `201 Created` (exit 0); batch writes 23:02:50Z–23:05:22Z, 62 `201 Created` + 1 skip, 0 failed (exit 0); strict readback 23:05:35Z–23:06:22Z, 63/63, missing/extra/duplicate = 0/0/0 (exit 0).

## 4. Post-readback execution state

The native dependency graph now matches the frozen DAG exactly (63/63, no missing/extra/duplicate edges). Accordingly:

- the fail-closed condition on native dependencies in the previous receipt state is lifted for **dispatch planning only**;
- all 22 Task Issues remain `state:planned`; no Task is claimed, ready or dispatched;
- no JIT execution branch exists for any Task; no source file has been changed; no PR is implementation evidence;
- the maximum safe parallel frontier may now be computed from the canonical Task Issues and the frozen DAG (initial frontier: T01 #250 and T11 #260 have no predecessors);
- every dispatched Task still requires its own current baseline read-back, exclusive write-set check and accepted single-writer CAS `DISPATCH_CLAIMED` against the exact integration base and Task Pack blob before any source write.
