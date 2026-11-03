# U03 exact-base rebind R1 — implementation validation

Date: 2026-11-04

## Exact identity
- WIP base: a3e1b22c200ef11a942dacc953e2bfecdc3db03c
- Base tree: 0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7
- Candidate: 9cbaccf5ac3bbae6cfc3d12f333fa929b0f6045f
- Candidate tree: 78246a75ef4951328b17f27b2f9da0b0824d90a4
- Parent: exact WIP base; compare 1 ahead / 0 behind.
- Exact changed paths:
  - apps/desktop-shell/src/renderer/renderer-main.ts
  - apps/desktop-shell/test/ux-r0-form-schema.test.ts
- The rebased two-file diff is byte-identical to the original reviewed candidate f48a7e14567ae9d0a89a79c99bf83220961b97d5.
- Candidate branch: task/v0.2.2-u03-single-resource-complete-status-r1.

## Fresh Builder admission
- Owner rebind approval: #333 comment 6614278265.
- Fresh accepted Builder Claim: #333 comment 6614387475.
- Builder result and evidence: #333 comment 6614815246.
- Branch reconciliation: final refs re-read show R1 branch points to candidate 9cbaccf5; legacy branch points to original f48a7e1. WIP and execution-pack branches are unchanged. No further pointer movement is required.

## Local validation (Windows x64, Node v24.21.0, pnpm 12.8.1)
| Gate | Result |
|---|---|
| Node 24 syntax/type preflight (pnpm run typecheck) | PASS, exit 0 |
| Changed-file Prettier | PASS, exit 0 |
| Focused renderer tests | PASS, 13/13 |
| Typecheck | PASS, exit 0 |
| Aggregate pnpm run ci:verify | PASS, exit 0; 218 files, 2404 passed / 1 skipped / 3 todo |

## Local Docker Woodpecker — exact candidate
- Pipeline #22, id 20066, manual event — SUCCESS.
- Local agent: woodpecker-agent-local, agent id 2266.
- Workflow: 4813, xd-ui-r0-verify.
- Clone step 14130 exit 0; ci-verify step 14131 exit 0.
- CI asserted Node v24.21.0 and git rev-parse HEAD = CI_COMMIT_SHA.
- Alpine run: 215 files passed / 3 skipped; 2345 passed / 57 skipped / 3 todo.

## Electron / Core Seam runtime recheck
- Real Electron 45.1.0 + Core Seam fixture re-run on candidate.
- Projection: COMPLETE / RESOLVED / COMPLETE / NOT_APPLICABLE / NONE / ALL_PASSED(1,0).
- Rendered DOM: 已完成; all=1 / active=0 / complete=1 / failed=0.
- Frozen-base control still renders 已结束 · 未完成, complete=0 / failed=1.
- realDownloads=0; nativeHostCalls=0.

## Review gate
- Fresh independent Exact-SHA review for 9cbaccf5: PENDING.
- Old review of f48a7e1 is historical and does not satisfy this gate.
- No PR opened; no WIP integration, merge, release or deployment.