# xDownload v0.2.1 — Candidate Task Pack contracts

```yaml
status: CANDIDATE_NOT_FROZEN
planning_issue: 248
dag: docs/implementation/v0.2.1/TASK_DAG_R0.md
product: docs/planning/v0.2.1/PRODUCT_R0.md
l2: docs/architecture/v0.2.1/L2_R0.md
task_issue_materialization: NOT_STARTED
claims: NONE
```

These are planning contracts, not executable Claims. They become eligible only after Product/L2/DAG independent review and freeze, canonical Task Issue materialization, native dependency readback, and accepted JIT `DISPATCH_CLAIMED` on the exact current base. A task may not infer authority from this file, an open PR, a ready label, or a closed dependency count alone.

## Common execution contract

- Target integration branch: `version/v0.2.1`, created only from the accepted freeze merge/base.
- SDK source pin: DomainHarness tag commit `061376f4a023070f215f9feffad5c24d96d503cb`, tree `099cdc831aef63befd62aaede7e7a853d1be468f`. The selected four public SDK tarballs retain internal package version `0.10.2-rc.0`; verify their SHA-256 against `packages/download-domain-app/vendor/sdk/SHA256SUMS.txt` and the #183 source-build receipts. `v0.10.3` names the Git source tag, not an npm package version. No registry fallback, silent rename/re-pack or downgrade.
- Use the existing pnpm monorepo and pinned Node/pnpm toolchain. No second repository/workspace or lockfile authority.
- One local Core process owns runtime composition. Do not instantiate K separately in CLI, Electron, or Browser Native Host.
- Old v0.1 lineages stay old-Core-owned; newly admitted v0.2 lineages route to K. An ambiguous/conflicting owner refuses before any external effect.
- Every task records exact base/head/tree, real commands, exit codes, platform, fixture identity and what remains NOT_PROVEN.
- Source builders do not self-approve review or validation. Review, Validation, Freeze, Hidden, Closure, RQ and merge are separate decisions.
- Fail closed on invalid intent, missing permission, target/remote identity change, untrusted redirect, path escape, corrupt partial state, Host mismatch, unknown operation outcome or stale evidence.
- No credentials, cookies, signed URLs, private headers or personal browsing content in fixtures, logs, issue comments or packages.
- Keep default direct downloads usable with no LLM. Any LLM is advisory and cannot widen scope or grant effects.
- Stop and request an approved L2 amendment if the accepted write set cannot implement the contract without a new authority, persistence owner or public API.

## T01 — Canonical contracts and Core seam protocol

- **Depends on:** none. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `packages/domain-contracts/**; packages/core-seam/**`.
- **Output:** stable job/attempt/progress/error projections; known-vs-unknown totals; explicit v0.2 command/query route; no-widening intent validation; typed refusal for ambiguous lineage owner.
- **Acceptance:** deterministic schema tests, malformed/unknown-field negatives, old protocol compatibility, and cross-surface parity fixtures.
- **Forbidden:** no runtime composition, scheduler, persistence, UI or transfer implementation.

## T02 — Single-Core Domain App integration

- **Depends on:** T01, T03, T06. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `packages/core-runtime/**; packages/converged-runtime/**`.
- **Output:** load the selected Domain App/K once in the existing Core process; route old lineages to old Core and new v0.2 lineages to K; preserve one authority per lineage; expose the route through the existing Core seam.
- **Acceptance:** exact old-lineage regression, new K lineage positive path, owner-conflict refusal before network/file effect, restart/reopen preserves the owner, no per-surface K instantiation, and SDK source/tarball identities remain byte-bound to the qualified baseline.
- **Forbidden:** no new IPC transport, no second scheduler/ledger, no cross-process SQLite CAS claim, no rewriting old lineage history.

## T03 — Transfer reliability and safe files

- **Depends on:** T01. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `packages/direct-acquisition/**`.
- **Output:** bounded transient retry within existing budgets; resume only with range support and stable remote/local identity; safe partial-file identity; filename/path sanitation; collision policy; atomic finalize after validation.
- **Acceptance:** timeout/reset/disk-full/redirect/changed-validator/path traversal/collision/partial-corruption tests; no false COMPLETE, no duplicate accepted artifact; same-host direct-transfer baseline recorded.
- **Forbidden:** no new HTTP/TLS stack, unbounded retry, blind append, automatic UNKNOWN replay or new ledger authority.

## T04 — CLI usability and diagnostics

- **Depends on:** T01, T02. **Risk:** high. **Review:** required.
- **Exclusive write set:** `apps/cli/**`.
- **Output:** installed argv route through the existing Core seam to the v0.2 Domain App; stable JSON and exit codes; explicit human-readable mode/progress on stderr; actionable errors and local runtime/Host/destination diagnostics.
- **Acceptance:** clean installed consumer; TTY and redirected output; JSON remains parseable; direct/status/wait/cancel/retry/batch; missing Host, permission denial, malformed input and timeout negatives. Explicitly close CF-1: `apps/cli/src/main.ts` argv must reach the v0.2 `domain-app-commands`/`domain-app-facade` path and `submitConfirmedDownload`; `domain-app-commands.ts` imports `DOWNLOAD_OPERATIONS`/`DownloadOperationId` from the public package root `@xdownload/download-domain-app`, never the deep specifier `@xdownload/download-domain-app/src/contracts/index.ts`. In `apps/cli/test/headless-authority.test.ts`, permit this one dependency only by exact equality (`specifier === '@xdownload/download-domain-app'`), not by adding it to a `startsWith` prefix allowlist; the deep specifier must remain rejected. Run `pnpm exec vitest run apps/cli/test/headless-authority.test.ts` and require EXIT=0.
- **Forbidden:** no locally invented lifecycle truth, silent transport fallback or automatic Core start/stop outside the approved lifecycle contract.

## T05 — Browser extension v0.2 cutover

- **Depends on:** T01, T02. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `apps/browser-extension/**`.
- **Output:** existing Manifest V3 extension submits through the v0.2 route via the existing trusted Host/Core boundary; permission is requested only when required; selected target and actionable failure state are visible.
- **Acceptance:** real Chromium + installed Host; allow/deny permission; wrong origin/Host mismatch; malformed target; no raw cookies or signed credentials in K/model/logs; no unauthorized effect.
- **Forbidden:** no new crawler, silent permission grant, credential copying to model or second K instance.

## T06 — HLS VOD S4 K/Host integration

- **Depends on:** T01. **Risk:** high. **Review:** required.
- **Exclusive write set:** `packages/download-domain-app/src/integrations/s4-hls-vod*; packages/download-domain-app/src/integrations/index.ts; packages/download-domain-host/src/media/**; packages/hls-vod-adapter/**`.
- **Output:** an explicit bounded S4 HLS VOD journey through selected K/Host, reusing the existing HLS engine and transfer-budget contract.
- **Acceptance:** controlled authorized HLS fixture, explicit variant/scope policy, real materialized output and applicable integrity checks; unsupported live/DRM/ambiguous cases refuse truthfully.
- **Forbidden:** no new media engine, DRM/access bypass, implicit playlist crawl or S4 claim from unit tests alone.

## T07 — Desktop shell and secure IPC

- **Depends on:** T01, T02. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `apps/desktop-shell/package.json; apps/desktop-shell/src/main/**; apps/desktop-shell/src/preload/**; root package.json; pnpm-workspace.yaml; pnpm-lock.yaml`.
- **Output:** minimal runnable Electron shell that uses the existing Core lifecycle/seam and existing desktop adapter semantics; exact Electron version pinned.
- **Acceptance before T08:** source-level IPC/security review and a minimal non-installed shell smoke; local assets only; renderer Node integration disabled, context isolation and sandbox enabled, restrictive CSP, narrow typed preload, validated IPC sender/payload, no arbitrary navigation/window or raw filesystem/shell authority. This is not the installed/package/Host smoke; T14/T16 owns that after T09.
- **Forbidden:** no per-surface K/Core instance, generic IPC bridge, private queue store or floating dependencies.

## T08 — Desktop Download Manager UI

- **Depends on:** T01, T02, T03, T07. **Risk:** high. **Review:** required.
- **Exclusive write set:** `apps/desktop/src/**; apps/desktop-shell/src/renderer/**`.
- **Output:** add URL and target/output preview; job list; truthful progress/status; cancel; eligible retry; understandable errors; destination selection; reveal completed file/folder.
- **Acceptance:** accessible keyboard flow and empty/loading/error states; no fabricated total/ETA; renderer calls only allowlisted preload APIs; queue/result state comes from the Core projection.
- **Forbidden:** no pause/resume control unless T03 proves it; no local status/retry truth.

## T09 — Host, installer and package integration

- **Depends on:** T04, T05, T06, T07, T08. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `build/**; installers/**; scripts/install-host/**`.
- **Output:** reproducible user-installable package(s), correct native Host registration, existing single-Core start binding, exact version/build identity and safe install/upgrade/uninstall.
- **Acceptance:** clean install, Host registration/readback, package contents audit, exact source/package/installer hashes; no execution/evidence-only files shipped.
- **Forbidden:** no root lockfile or surface-source edits; no unsupported OS claims or npm SDK assumption.

## T10 — User and Agent documentation

- **Depends on:** T04, T05, T06, T08, T09. **Risk:** medium. **Review:** recommended.
- **Exclusive write set:** `docs/user/**; docs/agent/**`.
- **Output:** Chinese-first user quick-start/troubleshooting, permissions, destination/retry/recovery semantics and supported matrix; English-first Agent/automation contract and tested CLI examples.
- **Acceptance:** commands match the packaged candidate; privacy behavior and known limits are truthful; examples run against the exact candidate.
- **Forbidden:** no edits to frozen Product/L2/DAG; no unsupported marketing claims.

## T11 — Validation harness and controlled fixtures

- **Depends on:** T01. **Risk:** high. **Review:** required.
- **Exclusive write set:** `tests/v0.2.1/**`.
- **Output:** reusable direct/HLS fixtures and corpora for restart, cancel, UNKNOWN, duplicate, changed validator, bad path, permission, Host mismatch, corrupt output, owner conflict and redaction.
- **Acceptance:** real Host/network/file effects where required; fakes are labelled and never substitute for installed gates.
- **Forbidden:** no secrets, arbitrary internet dependency or tests that silently clear UNKNOWN.

## T12 — CLI installed-path validation

- **Depends on:** T02, T04, T09, T11. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/cli/**`.
- **Output:** exact-SHA clean installed CLI evidence for direct download, status/wait/cancel/retry/batch, JSON/text, exit codes, diagnostics and explicit CF-1 closure using `apps/cli/test/headless-authority.test.ts`.
- **Acceptance:** record the exact CF-1 test path `apps/cli/test/headless-authority.test.ts`, command `pnpm exec vitest run apps/cli/test/headless-authority.test.ts`, environment, fixture, EXIT=0 and installed artifact SHA. The installed argv path reaches the v0.2 submit journey; the public package root is allowed by exact equality and no deep internal SDK specifier remains. Record commands, environment, fixtures and artifact hashes for the full CLI matrix; no Builder-only evidence substitution.

## T13 — Browser/Host security validation

- **Depends on:** T02, T05, T09, T11. **Risk:** critical. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/browser/**`.
- **Output:** real Chromium + installed Host evidence for S2 and permission/authority negatives.
- **Acceptance:** selected target, origin, permission, Host identity, output and exact package hashes recorded; all unauthorized paths fail closed.

## T14 — Desktop journey validation

- **Depends on:** T02, T08, T09, T11. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/desktop/**`.
- **Output:** real packaged Electron executable/IPC smoke with installed Core/Host seam, followed by installed desktop journey and renderer security evidence.
- **Acceptance:** launch the real packaged executable against the installed Core/Host seam; verify IPC boundary and fail-closed Host/Core mismatch before the add URL, destination, progress/status, cancel, retry, restart recovery and reveal-file flow; packaged renderer isolation rechecked. T16 binds the installed package/installer hashes and supported platform.

## T15 — HLS journey validation

- **Depends on:** T02, T06, T09, T11. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/hls/**`.
- **Output:** real controlled HLS VOD end-to-end evidence on the packaged candidate.
- **Acceptance:** finite scope, correct output, truthful unsupported/failure state, no false completion.

## T16 — Platform/install/upgrade validation

- **Depends on:** T09, T12, T13, T14, T15. **Risk:** critical. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/platform/**`.
- **Output:** installed baselines bound to exact release SHA, real package/Host smoke readback and tested supported-platform matrix.
- **Acceptance:** clean install, upgrade from prior candidate, uninstall, Host registration, destination permissions and artifact hashes; untested platforms are not claimed.

## T17 — Human G0/G1 effort study

- **Depends on:** T12, T13, T14, T15, T16. **Risk:** high. **Review:** independent required; human-owned.
- **Exclusive write set:** `docs/validation/v0.2.1/human/**`.
- **Output:** conventional baseline and xDownload sessions with attributable time, steps, errors, assistance and participant notes.
- **Acceptance:** privacy-safe protocol, comparable tasks, raw observations and limitations. Agents cannot manufacture human sessions.

## T18 — Candidate Freeze

- **Depends on:** T10, T12, T13, T14, T15, T16, T17. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/candidate/**`.
- **Output:** one immutable candidate SHA/tree and visible gate board.
- **Acceptance:** all release-claimed journeys PASS on that lineage; no blocking P0/P1; installed hashes bind to candidate; open UNKNOWNs and exclusions explicit.

## T19 — Hidden Validation

- **Depends on:** T18. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/hidden/**`.
- **Output:** adversarial hidden results for path/identity/permission/recovery/duplicate/redirect/credential/renderer IPC/lineage-owner cases.
- **Acceptance:** zero escaped release-blocking P0/P1; hidden cases cannot be replaced by visible-test summaries.

## T20 — Version Closure

- **Depends on:** T19. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/closure/**`.
- **Output:** issue/PR/candidate/installed-hash and evidence-currentness reconciliation.
- **Acceptance:** every task terminal; deferral ledger reconciled; NOT_RUN/NOT_PROVEN and residual risks explicit.

## T21 — Release Qualification

- **Depends on:** T20. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/rq/**`.
- **Output:** independent exact-SHA READY/CONDITIONAL/BLOCKED/FAIL decision and exact claim set.
- **Acceptance:** recheck candidate lineage, installed evidence, hidden results, closure and permission conditions; task/CI PASS alone cannot infer READY.

## T22 — Qualified main integration

- **Depends on:** T21. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/integration/**`; protected merge only when RQ explicitly permits.
- **Output:** base/diff re-read, qualified PR, merge result and exact main readback.
- **Acceptance:** only accepted RQ READY with explicit integration permission can merge; no npm publication or additional release claim is inferred.

## Failure handling and stop rules

- Record P0/P1/P2 and exact evidence. Never downgrade severity to make a gate green.
- If the accepted v0.2.1 Product/L2 cannot be implemented without changing authority, persistence, trust boundary or supported scope, stop and request an approved amendment.
- If a real environment is required (Windows installer/Host, Chromium, desktop package or human G0/G1), request that environment explicitly. Do not replace it with a simulation and report PASS.
- The DAG is frozen only after independent exact-SHA review, explicit Owner freeze and a durable freeze/read-back receipt. No source task is dispatchable before canonical issue/dependency materialization and its accepted JIT Claim.
