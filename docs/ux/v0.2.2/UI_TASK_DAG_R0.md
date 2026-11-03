# xDownload 后继 UI R0 — 最小 Task DAG（候选，未冻结）

所有节点属于 #305，当前不是已经批准的 ADS 原生 blocked_by 图。每一节点须独立 Task Pack + CAS Claim + 写集唯一所有者；当前 PR #307/#309 属 WIP 草稿，无生产放行资格。

| 节点 | 内容 | 写集（候选） | 前置 | 并行 |
|---|---|---|---|---|
| U00 | 当前界面截图/真实任务流程 UX 基线，外部行业操作对照 | docs/ux/** | 无 | 可与 U01/U02 并行 |
| U01 | Desktop Renderer 主界面、表单、筛选、详情 | apps/desktop-shell/src/renderer/** + 独立测试 | 无（现有 #306） | Lane A |
| U02 | Browser Popup 当前页/批量/合集/高级分层交互 | apps/browser-extension/src/popup/** + 独立测试 | 无（现有 #308） | Lane B |
| U03 | 可信动态表单/能力描述文档和双端合同测试 | 新增形式层，仅在 U01/U02 冻结后裁定独占写集 | U01、U02 | Lane C（先分析） |
| U04 | Desktop 实际文件获取、任务持久历史等产品能力缺口单独验收与 L2 修订 | Core/adapter/Host 精确白名单，未获准前不可写 | U00、Product scoped authorization | Lane D（独立） |
| U05 | Desktop/Browser 回归、截图、无障碍与安装包实测 | docs/validation/**；必要测试有独占写集 | U01、U02、U03；产品能力修复（若纳入） | Gate |
| U06 | 独立审查、候选冻结、发布资格与版本限定合并 | docs/release/** | U05 | Gate |

当前 WIP：U01 和 U02 源码草稿已经提交且同属一个不可自动合并的后继集成目标，未运行 Node24 / Woodpecker / 真实 Electron / Chrome，可见 UI 审核 NOT_RUN。未经 Owner 审核/批准冻结，不得将草稿表当成已批准 DAG。


## Owner-approved canonical U00–U06 responsibility map (2026-11-03)

> Approval: project Owner comment on #327, comment #6584999871. This approves the lane definitions and historical mapping below only. The full UI DAG remains `CANDIDATE_NOT_FROZEN`; it does not approve every candidate Task, dependency edge, Product/L2 change, release or merge.

| Canonical lane | Responsibility | Existing work / evidence mapping |
|---|---|---|
| U00 | Installed-surface UX audit, screenshots and industry workflow comparison | #305 UX baseline; screenshot/evidence inputs in #311 Attempt-08. |
| U01 | Desktop information architecture and design-system decisions | Planning responsibility captured by #305; consumed by the Desktop renderer. No separate implementation Task is invented. |
| U02 | Trusted, versioned schema/capability-driven dynamic forms | #324 Browser structured-input gap; Desktop form-schema work is part of the historical #306/#307 implementation; current Browser follow-up is #328. |
| U03 | Desktop renderer replacement and correctness/hardening | #306 initial Desktop renderer Task, #307 implementation, #312 hardening and PR #313. |
| U04 | Browser Popup workflows, progressive disclosure, localization, accessibility and browser-specific correctness | #308 / PR #309; #314 / PR #315; findings #323/#325; bounded follow-up #328. |
| U05 | Product capability remediation in Core/adapter/Host | #310 only. This remains separately scoped and is NOT authorized by the UI lane-map or #328 approval. |
| U06 | Integration, Windows Node24 / Chrome / Electron validation, screenshots/accessibility, Woodpecker and independent review | #311, #326 and `.woodpecker/xd-ui-r0-verify.yaml` / Build #4. |

### Historical identifier reconciliation

- Historical issue titles and append-only comments are not rewritten. A former lane label in an issue title is a historical alias, not a second current lane definition.
- #306/#307 are mapped to canonical U03 based on their actual Desktop renderer deliverable, not U01.
- #312/#313 are also U03 Desktop renderer hardening.
- #308/#309 and #314/#315 are U04 Browser Popup work.
- #324 is the U02 Browser schema-form gap; #323 and #325 are U04 Browser workflow correctness findings. #328 is a single-writer pack spanning U02 and U04 because its three-file write set overlaps.
- #311 and #326 provide U06 validation/harness evidence. U00 UX observations may be reused from #311 only where the actual screenshot/scenario evidence exists; validation is not silently relabelled as a completed UX audit.
- #310 remains U05 and requires its own Product/L2 authority; it is not included in #328.

### Current approved bounded Task

- Task Pack proposal: #328, Owner-approved comment #6585001449.
- Formal Task Issue and exact Task Pack reference will be linked after materialization.
- Exact approved write set: `apps/browser-extension/src/popup/popup.html`, `apps/browser-extension/src/popup/popup.js`, `apps/browser-extension/test/popup-s5-admission.test.ts`.
- One Writer only; the three findings #323/#324/#325 must not be dispatched as parallel source writers.
- The UI DAG remains `CANDIDATE_NOT_FROZEN`. No other lane is implicitly dispatched by this Task.


## U06 follow-up after read-only harness feasibility (2026-11-03)

> This is an append-only mapping update. The canonical U00–U06 responsibility map above remains in force; the full DAG remains `CANDIDATE_NOT_FROZEN`. This does not authorize #310 Product scope, any version/main merge, release or deployment.

- #326 feasibility probe: Desktop ACTIVE/COMPLETE/FAILED/CANCELLED valid Core projections were executed through real Electron/Core Seam; Browser denial control passed; genuine toolbar-action activeTab positive remained NOT_RUN because Windows was locked. Exact evidence: #326 comment #6594634490.
- #332 is the bounded U06 harness implementation successor. Frozen Task Pack blob: `8c6ece8e0cf8f6389a97dc47bda5c5811a9bce9d`. Its exclusive write set is:
  - `apps/desktop-shell/test/smoke/harness-core.ts`
  - `apps/desktop-shell/test/smoke/electron-shell-smoke.mjs`
  - `apps/browser-extension/test/chrome-toolbar-active-tab.mjs`
- #332 is admitted for an actual Local Builder under the pinned ADS v4.18.0 `LOCAL_BUILDER/LOCAL` profile; its current Execution Pack and HANDOFF_READY are linked in #332. The worker's own accepted `DISPATCH_CLAIMED` remains required before source mutation.
- The valid single-resource COMPLETE projection still has coverage `NOT_APPLICABLE` and the current renderer displays “ended · not completed”. Renderer/Product correction is separate from this test-only Task and is not authorized here.
- PR #331 (#329 Browser follow-up) and PR #330 (#322 Desktop serialization) are implementation-complete but remain unmerged pending WIP integration control. Their source changes do not alter the frozen base of #332 unless explicitly integrated/rebound.


## U03 follow-up from U06 single-resource terminal fixture (2026-11-03)

> Append-only evidence update; canonical lane definitions remain unchanged and the full UI DAG remains `CANDIDATE_NOT_FROZEN`.

- #326 real Electron/Core Seam fixture exposed a valid single-resource COMPLETE projection misclassified by the Desktop renderer as “ended · not completed” and counted failed. Domain contract requires `coverage=NOT_APPLICABLE` for direct single-resource results; renderer completion predicate only accepted `VERIFIED_COMPLETE`.
- #333 is the bounded U03 renderer correction. Frozen Task Pack blob: `3e1fa992df6360d8896f0e007f439eefe4c8b83b`. Exclusive write set:
  - `apps/desktop-shell/src/renderer/renderer-main.ts`
  - `apps/desktop-shell/test/ux-r0-form-schema.test.ts`
- #333 uses the Owner-approved LOCAL_BUILDER/LOCAL route under ADS v4.18.0; the worker's accepted claim remains required.
- The fix must preserve all authoritative completion dimensions, treat NOT_APPLICABLE as complete only when the remaining dimensions prove success, and never alter the domain contract or fabricate coverage.



## Adjacent architecture track — A01 Domain Package / Host cleanup (2026-11-03)

> This is a cross-cutting architecture lane, not a renumbering or expansion of the Owner-approved U00–U06 UI map. The full DAG remains CANDIDATE_NOT_FROZEN. No user-visible Product capability is added.

- Goal: apply DomainHarness #1465 / PR #1466 to the current xDownload v0.2.2 successor; remove the App↔Host package cycle, move physical Host storage/bridges and production assembly to Host/Core, and make K / Seam / Route Projection / Lineage ownership explicit.
- Source baseline: `wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334`, Tree `ba48b805697ad19c36a6eb3a5e54b6d601b36120`.
- Formal Task Issue: [#335](https://github.com/kaicreator-mm/xDownload/issues/335), currently `state:planned` / `DISPATCH=NOT_DISPATCHED`.
- Task Pack: `docs/implementation/v0.2.2/task-packs/V022-A01-DOMAIN-PACKAGE-ARCHITECTURE-CLEANUP.md` (blob `e254a710388a98e2773bc7d4d85176fe2d868375`; proposed for independent review; no Claim/Execution Pack yet).
- Proposed exclusive source write set: `packages/download-domain-app/**`, `packages/download-domain-host/**`, `packages/domain-contracts/**` only for neutral shared contracts, `packages/core-runtime/**`, directly related package tests, architecture record and required package manifests/lockfile.
- This lane is disjoint from U02/U03/U04 UI renderer/popup/harness write sets. UI work may continue in parallel; integration must rebind to the current WIP SHA and rerun exact-SHA gates.
- No DomainHarness SDK/API/ABI change, no v0.2.1/main mutation, no Product capability expansion, no new permission/IPC/Provider, no release or deployment.
- Authority rule: do not blindly merge K Store, Seam Journal, RouteLog and T09 LineageLedger; prove production ownership and UNKNOWN/recovery semantics first.
