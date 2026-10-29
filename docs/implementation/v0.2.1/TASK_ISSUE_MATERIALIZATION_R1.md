# xDownload v0.2.1 — Task Issue Materialization Receipt R1

```ini
STATUS=PARTIAL_BLOCKED_NATIVE_DEPENDENCY_WRITE_API
PLANNING_FREEZE_RECEIPT=docs/implementation/v0.2.1/FREEZE_RECEIPT_R1.md
FROZEN_PLANNING_SUBJECT=07af78c3abee741196ff566a7f21fdfe15d71da7
PLANNING_BRANCH_HEAD_BEFORE_THIS_RECEIPT=1cffd6445308ac78fa2f9e4489af579f0deb32ef
INTEGRATION_BRANCH=version/v0.2.1
INTEGRATION_BASE_SHA=c29af4a4b89123997d03d5566ebe09ba83855fb0
TASK_ISSUES_CREATED=22/22
TASK_ISSUES_STATE=PLANNED
NATIVE_DEPENDENCIES_WRITTEN=0/63
NATIVE_DEPENDENCY_READBACK=BLOCKED
JIT_CLAIMS=NONE
SOURCE_DISPATCH=NONE
CI=NO_RUN
MAIN=HOLD
```

## 1. Frozen authority

Task Issue materialization follows Product/L2/DAG Freeze Receipt R1. The exact reviewed planning blobs remain unchanged. The canonical Task Pack source is `docs/implementation/v0.2.1/TASK_PACKS_R0.md` at planning branch commit `1cffd6445308ac78fa2f9e4489af579f0deb32ef`, blob `c0cbed29ffa1a47cad5aed288aa262dd0dd549a8`.

The integration branch `version/v0.2.1` was created from the accepted base `main@c29af4a4b89123997d03d5566ebe09ba83855fb0`. It contains no v0.2.1 source changes.

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

## 3. Native dependency API blocker

The connected GitHub toolset can create/read/update issues and perform GET requests, but exposes no write action for the native Issue dependency endpoint. The available GitHub fetch operation is GET-only. Read-back of `GET /repos/kaicreator-mm/xDownload/issues/251/dependencies/blocked_by` and the corresponding endpoint for issue #258 returned empty arrays. No native dependency edges have been claimed.

The remaining materialization action must use an authenticated GitHub API writer, e.g. Windows Git Bash with the already-authenticated `gh` CLI, to POST each edge to:

`POST /repos/kaicreator-mm/xDownload/issues/{blocked_issue_number}/dependencies/blocked_by`

with JSON `{"issue_id": <numeric GitHub ID of the predecessor issue>}`, then GET every blocked issue's `dependencies/blocked_by` endpoint and compare the result against all 63 frozen edges. Use predecessor **issue IDs**, not issue numbers, in the POST body. Do not substitute a Markdown dependency list for native edges.

## 4. Fail-closed execution state

Until the 63 native dependency edges are written and read back:
- all 22 Task Issues remain `state:planned`;
- no JIT execution branch is created for a Task;
- no Task is marked ready/claimed/dispatched;
- no source file may be changed;
- no PR may be treated as implementation evidence;
- native dependency readback must match the frozen DAG exactly before dispatch planning resumes.

After successful native read-back, recompute the ready frontier from the canonical Task Issues and the frozen DAG. Each dispatched Task still requires its own current baseline read-back, exclusive write-set check and accepted single-writer CAS `DISPATCH_CLAIMED`.
