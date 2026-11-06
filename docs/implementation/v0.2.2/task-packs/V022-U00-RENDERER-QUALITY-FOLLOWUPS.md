# V022-U00-RENDERER-QUALITY-FOLLOWUPS-01 — Task Pack R0

## Identity

- Task ID: `V022-U00-RENDERER-QUALITY-FOLLOWUPS-01`
- Repository: `kaicreator-mm/xDownload`
- Version: `v0.2.2`
- Parent Product/UI initiative: #305
- Origin audit: #383 (U00; CLOSED / COMPLETED)
- Outcome Task: #389
- Finding issues: #385, #386, #387, #388
- WIP integration target: `wip/v0.2.2-ui-rebuild-r0`
- Frozen WIP base: `3821ee8606963ec11cc20aad279c4bbc9d76a48d`
- Frozen WIP tree: `09736a726e822546e6be13f44d9ad9345df2885e`
- Requested execution profile: `LOCAL_BUILDER`
- Required execution environment: `LOCAL_WINDOWS_ELECTRON_UI`
- Review policy: independent Fresh Exact-SHA review required
- Risk: medium (renderer accessibility and responsive presentation)
- Validation scope: renderer concern + installed-surface evidence
- Source mutation before accepted Claim: forbidden

## Purpose

Repair the four verified U00 P2 Desktop renderer findings as one implementation batch because they share the same renderer source surface and exact WIP baseline. This is a child follow-up batch, not a new Root DAG node. Each original issue remains separately traceable and must receive its own acceptance evidence before closure.

## Frozen source write set

Exactly these three paths:

1. `apps/desktop-shell/src/renderer/index.html`
2. `apps/desktop-shell/src/renderer/renderer-main.ts`
3. `apps/desktop-shell/src/renderer/styles.css`

No fourth path. If implementation discovers a genuine need for another repository path, stop before modifying it; submit a Task Pack amendment for independent review and exact-base rebinding. Temporary verification scripts and evidence may live outside the repository under the local evidence directory and must not be committed.

## Findings and acceptance

### F-1 / #385 — filter discoverability at 480×360

- The four task filters must all be visible at the default 480×360 CSS viewport, or a clearly visible, keyboard-operable overflow affordance must be present.
- Preferred direction: responsive wrapping/grid layout that exposes all four controls without relying on a thin horizontal scrollbar.
- Preserve native button semantics, focus visibility, `aria-pressed`, selected styling and correct counts.
- Capture a screenshot at exactly 480×360 and record geometry/overflow evidence.

### F-2 / #386 — WCAG 1.4.3 contrast

- Repair the three independently confirmed failures: task-row action link, Core connection state, and COMPLETE status tag.
- All normal text pairs must meet WCAG AA contrast ratio >= 4.5:1 against their effective painted backgrounds in light and dark themes.
- Re-run a complete renderer text-contrast sweep; do not introduce new failures in hover, selected, stale, failed, complete, disabled, notice, table, detail or dialog states.
- Record computed foreground/background colors and ratios; independently sample painted pixels from the final screenshots for the three original pairs and any changed token pair.

### F-4 / #387 — responsive details overlay semantics and focus

- Preserve the existing wide-screen side-panel behavior when it does not cover the workspace.
- At viewport widths where the details panel overlays the workspace (currently <=1050px), make it a genuine modal dialog with an accessible name and `aria-modal=true`.
- On open: move focus into the dialog; background controls covered by the overlay must be inert and unavailable to assistive technology.
- While modal: Tab/Shift+Tab remain inside all actually focusable controls (including disclosure summaries); Escape closes.
- On close: restore focus to the invoking row control. If that row no longer exists, use a deterministic accessible fallback such as the task-list heading/search control.
- At widths where the panel is non-overlapping, retain non-modal disclosure semantics and do not make unrelated background controls inert.
- Verify open → read → close using keyboard only and screen-reader/AX-tree inspection. Capture AX-tree and screenshot evidence at both a narrow overlay width and a wide non-overlapping width.
- Do not regress the existing Add and Preview dialogs.

### F-5 / #388 — same-host task identity

- Every visible task row and its accessible name must be unique, including two or more tasks from the same host:port and historical tasks after app restart.
- Add a privacy-preserving sequence/ordinal label that is available for all rows, not only rows submitted during the current renderer session.
- The details-panel heading must use the same display label as its originating row.
- Do not expose full URLs, URL paths, query strings, credentials, raw lineage IDs or raw internal K vocabulary in the default row label.
- Verify with >=2 same-host tasks that visible row text and accessible names are pairwise unique in DOM and AX-tree evidence.

## Shared validation

1. Re-read PR/branch state, WIP HEAD/TREE, this Task Pack blob and the accepted Claim before source mutation. Stop if the WIP base differs; request exact-base rebinding.
2. Node 24.21.0 syntax checks and changed-file Prettier for all three changed paths before CI.
3. Focused checks for filter layout, label uniqueness, dialog focus/keyboard semantics and contrast calculation.
4. Windows local Electron run at 480×360 and a wide viewport; record actual window/viewport dimensions, screenshots, DOM/AX tree, focus sequence, contrast ratios and all real exit codes.
5. Existing Desktop journey states D01–D18: re-run affected states plus a regression sweep sufficient to prove no unrelated journey changed. Keep Core data and UI presentation truth separate.
6. `pnpm run typecheck`.
7. `pnpm run ci:verify`.
8. Local Docker Woodpecker on the final exact HEAD; record actual Pipeline/Build ID, clone SHA, result and step logs. Do not reuse a prior SHA's CI result.
9. Record final HEAD/TREE/BASE, source blobs, evidence hashes, commands, exit codes, test counts, screenshots/AX artifacts, contrast table and each child issue's acceptance disposition in #389.
10. Fresh independent Exact-SHA review of the final candidate. Any findings must be consolidated; if repair is needed, repair within the original write set and revalidate the new SHA.

## Execution and handoff policy

- One Builder only, one accepted Claim, one source Writer.
- The LOCAL_BUILDER owns implementation, local validation, and repairs discovered during its validation. Do not dispatch a standalone `LOCAL_VALIDATION` task.
- Web/source review, local execution and metadata updates must be batched before a single final handoff. After handoff, do not invalidate the snapshot with nonessential writes.
- Reuse PASS evidence only for the exact same SHA and unchanged environment/input. If SHA changes, rerun affected gates and every final-SHA-bound gate.
- Environment NOT_RUN is not a source failure and does not authorize a new source repair batch. Record exact blocker and zero-side-effect evidence; do not fabricate screenshots or AX PASS.
- Fresh Exact-SHA Reviewer binds the candidate and reports all findings in one pass. If a source repair is needed, the Reviewer may directly act as Repairer within the original three-path write set under a valid accepted Claim/CAS; do not serialize a Web → Local → Web repair bounce. If a separate repair Claim is required, accept it before mutation.
- After any repair, a different final Verifier must review the latest HEAD/TREE/BASE; the Repairer cannot self-issue final PASS.
- No second task/Claim for individual findings #385–#388; this Task Pack owns the combined repair. Child issues close only after their own acceptance is evidenced.

## Forbidden scope

- Any path outside the three-path write set.
- Product/L1, L2, K/S identities, SDK pins, Core, Host, IPC, schema, permissions, manifest, worker, popup, download engine or transfer behavior.
- Full URL/path/credentials/raw lineage IDs in default visible labels.
- WIP integration, main, `version/v0.2.1`, tags, release, deployment, Native Host, registry, real external downloads or destructive local state changes.
- GitHub Actions. Use Node >=24 preflight and local Docker Woodpecker.
- Merging this PR or closing the child findings without explicit evidence and the required independent review.

## Dispatch state

```yaml
task_id: V022-U00-RENDERER-QUALITY-FOLLOWUPS-01
issue: 389
version: v0.2.2
base_branch: wip/v0.2.2-ui-rebuild-r0
baseline_sha: 3821ee8606963ec11cc20aad279c4bbc9d76a48d
baseline_tree: 09736a726e822546e6be13f44d9ad9345df2885e
execution_profile: LOCAL_BUILDER
execution_environment: LOCAL_WINDOWS_ELECTRON_UI
claim_generation_required: 1
source_mutation_authorized: false
allowed_write_set:
  - apps/desktop-shell/src/renderer/index.html
  - apps/desktop-shell/src/renderer/renderer-main.ts
  - apps/desktop-shell/src/renderer/styles.css
status: READY_FOR_GENERATION_1_LOCAL_BUILDER_CLAIM
```


## Task Pack review amendment R1

- Reviewed Task Pack blob: `73ca3349398981619cc82d358619e22eaa6b900b`
- Independent Task Pack review: #389 comment #6688039448
- Verdict: `TASK_PACK_REVIEW=PASS; P0=0; P1=0; P2=0`
- Review date: 2026-11-06
- Status projection advanced to `READY_FOR_GENERATION_1_LOCAL_BUILDER_CLAIM`.
- This is a metadata-only planning amendment. The exact WIP baseline, three-path source write set, acceptance criteria and forbidden scope are unchanged. No Claim was created and no source mutation is authorized by this amendment.


## Task Pack review amendment R2

- Supersedes R1 metadata snapshot `6eb0925b738c52e4420bc3879457eb1dea6aa3eb`.
- Delivery-First reviewer-repair policy clarified: consolidate findings, repair within the original write set under valid Claim/CAS, and require a different final Verifier after repair.
- No change to source write set, exact WIP baseline, child acceptance criteria or forbidden scope.
