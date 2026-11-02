# Task Pack — v022-U02-U04-BROWSER-POPUP-01

> **TASK_PACK_STATE:** OWNER_APPROVED_BOUNDED_PLANNING_CONTRACT / NOT_EXECUTION_PACK
> **Parent:** [#305](https://github.com/kaicreator-mm/xDownload/issues/305)
> **Source proposal:** [#328](https://github.com/kaicreator-mm/xDownload/issues/328), Owner approval comment #6585001449
> **Canonical lane map:** [#327](https://github.com/kaicreator-mm/xDownload/issues/327), Owner approval/correction comment #6584999871
> **ADS feedback:** [#1354 OBS-24](https://github.com/kaicreator-mm/ai-development-standard/issues/1354#issuecomment-6584656870)

## Task identity and authority

- **Task ID:** `v022-U02-U04-BROWSER-POPUP-01`
- **Repository:** `kaicreator-mm/xDownload`
- **Version:** `v0.2.2 UI R0`
- **Integration target:** `wip/v0.2.2-ui-rebuild-r0`
- **Merge target:** `wip/v0.2.2-ui-rebuild-r0` only
- **Authority refs:** #305 (approved UI product intent); #327 (Owner-approved canonical lane mapping); #328 (Owner-approved bounded implementation proposal)
- **Implementation profile refs:** none — bounded presentation-layer implementation; no new runtime/product profile is introduced.
- **Project overrides:** not-required — this task only narrows the existing approved UI intent and does not alter project-wide policy.
- **Risk:** medium
- **Review policy:** required; independent Exact-SHA review.
- **Agent freedom:** `F1_BOUNDED_IMPLEMENTATION` (field kinds, worker payloads, authority boundaries and acceptance are fixed; internal code structure may vary inside the exact write set).
- **L3 requirement:** not-required — this is a bounded UI-only follow-up, with no new Product, Core, Host or architecture contract.

## Dependencies

- **Live Task dependencies:** none. This is a single-writer leaf task; no upstream Task Issue is required to merge before its current WIP base.
- The exact integration base is bound separately in its JIT Execution Pack.
- Parent/related Issue links express context only; no synthetic blocked-by edge is claimed.
- Do not dispatch #323, #324 or #325 as separate source writers: their overlapping popup write sets are consolidated here.

## Exclusive allowed write set

1. `apps/browser-extension/src/popup/popup.html`
2. `apps/browser-extension/src/popup/popup.js`
3. `apps/browser-extension/test/popup-s5-admission.test.ts`

Exactly these three paths. Any additional path requires a new explicit Owner-approved scope amendment before it is touched. No parallel source writer may touch these paths while this Task is active.

## Acceptance criteria

### A. Schema-driven structured inputs (source finding #324; canonical U02)

1. Add a local, frozen `schemaVersion: 1` presentation-only descriptor for only the existing S6 collection and v0.2 advanced Host forms.
2. The field-kind allowlist is exactly `text`, `select`, `integer`; unknown schema versions, operation IDs or field kinds fail closed.
3. Render the currently supported S6 identity/kind/fromPage/toPage and v0.2 targetRef/outputRoot fields from the descriptor.
4. Preserve existing DOM IDs, labels, explanatory text and user-facing affordances unless a test proves a minimal change is required.
5. Preserve existing Worker message payloads exactly, including `S6_PREPARE_COLLECTION` and `V02_ADD_DOWNLOAD`.
6. The descriptor is UI presentation metadata only. It MUST NOT be interpreted as a Host/Core capability response and MUST NOT mint target handles, paths, permissions, budgets or confirmation. Core/Host remain authoritative.

### B. Monotonic status polling (source finding #323; canonical U04)

1. Add a reusable single-flight poll controller for S6 and v0.2 status polling.
2. Bind each poll run to its captured contract/lineage identity and generation; a newer submission invalidates the prior generation.
3. Skip/coalesce timer ticks while a request for the same active poll is in flight.
4. Once a terminal result or final typed refusal is accepted, latch it; late/stale responses MUST NOT regress the UI to RUNNING or replace the terminal/error state.
5. Preserve Worker message shapes, Core-owned status/error/raw JSON and current polling intervals unless a focused regression test demonstrates a necessary minimal adjustment.

### C. Initial scan permission denial (source finding #325; canonical U04)

1. Map the known Chrome `executeScript` missing-page-access diagnostic to a stable, user-friendly Chinese explanation.
2. Preserve the original exception exactly in an explicit technical-details disclosure/log, not in the ordinary status sentence.
3. Unknown errors remain distinguishable and retain their original detail.
4. Do not auto-request permission, widen host/optional permissions, change manifest permissions or weaken the fail-closed `activeTab` boundary.

## Required validation and evidence

1. Before CI, run Node 24 `node --check` on `popup.js` and changed-file Prettier; record exact commands and exit codes.
2. Focused tests prove descriptor schema/version/field allowlisting, conditional visibility, local input validation and unchanged Worker payloads.
3. Deferred-response tests cover overlapping S6 and v0.2 polls, terminal then late RUNNING/failure, old generation after new submission and single-flight behavior.
4. Initial-scan tests prove friendly Chinese copy, exact raw diagnostic preservation and zero permission requests.
5. Run typecheck, focused Vitest and one aggregate `pnpm run ci:verify` after the syntax/format preflight.
6. Obtain one exact-HEAD Woodpecker run on the local Docker Agent after the source PR is ready for WIP integration; no GitHub Actions.
7. Independent Exact-SHA review is required. Review must verify the three-path write set, unchanged Worker payloads, no permission/authority widening, monotonic polling, diagnostic preservation, and all focused/aggregate test evidence.
8. Installed Windows/Chrome toolbar-action validation remains U06 evidence under #326. It is not silently satisfied by VM/unit tests; report NOT_RUN until a genuine installed-popup/toolbar journey is executed. The Local Agent is validation-only and must not modify implementation source.

## Forbidden scope

- No files outside the three-path allowed write set.
- No Product/L2/Core/Host/IPC/service-worker/manifest/packaging/installer changes.
- No new permissions, Native Host, HKCU, real downloads, browser cookie access or widened network access.
- No fabricated Host handles, target references, filesystem paths, transfer progress, totals or ETA.
- No changes to `main` or `version/v0.2.1`; no release, deployment or production promotion.
- No implementation dispatch of #310 Product capability work.
- No separate parallel source writers for #323/#324/#325.

## Failure and blocker handling

- Any need to change public Product/Architecture/Core/Host/IPC/Worker/manifest contracts is a `TASK_PACK_DEFECT` or separate Product/L2 scope request; stop that path and record it on the owning Issue.
- Any stale base, active incompatible Builder Claim, missing/invalid Task Pack or Execution Pack, or failed CAS admission is BLOCKED; do not edit source.
- Any test/CI failure is preserved with exact SHA, command, exit code and first failure. Retries append evidence and never replace the original attempt.
- A Web Builder / WEB dispatch-profile mismatch under the pinned ADS revision must be reported as a governance blocker, not bypassed by mislabelling the Builder as LOCAL or REVIEWER.

## Closeout

The Task may be marked implementation-complete only after:
- a PR targeting `wip/v0.2.2-ui-rebuild-r0` contains exactly the three allowed paths;
- exact-HEAD Node24 syntax/format, typecheck, focused tests, aggregate CI and Woodpecker evidence are recorded;
- independent Exact-SHA review is PASS with P0/P1/P2;
- Windows/Chrome validation is separately and truthfully reported (PASS or NOT_RUN) under U06/#326.

Closeout must include source HEAD, Tree, PR, aggregate changed paths, test counts, exact CI build identity, independent review identity/result, and remaining NOT_RUN evidence. The full UI DAG and v0.2.2 release qualification remain separate.
