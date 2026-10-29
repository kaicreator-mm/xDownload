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

- Target integration branch: `version/v0.2.1`, to be created only from the accepted freeze merge/base.
- SDK: exact qualified DomainHarness v0.10.3 Git-source/build pin; never silently resolve an npm registry package or downgrade.
- Use the existing pnpm monorepo and pinned Node/pnpm toolchain. No second repository/workspace or lockfile authority.
- Every task records exact base/head/tree, real commands, exit codes, platform, fixture identity and what remains NOT_PROVEN.
- Source builders do not self-approve reviews or validation. Independent exact-SHA Review, Validation, Candidate Freeze, Hidden Validation, Closure, RQ and merge are separate decisions.
- Fail closed on invalid intent, missing permission, target/remote identity change, untrusted redirect, path escape, corrupt partial state, Host mismatch, unknown operation outcome or stale evidence.
- No task may edit frozen v0.1/v0.2.0 Product/L2/DAG artifacts in place or change the existing release claims.
- No credentials, cookies, signed URLs, private headers or personal browsing content in fixtures, logs, issue comments or packages.
- Keep default direct downloads usable with no LLM. Any LLM is advisory and cannot widen scope or grant effects.
- Stop and request an approved L2 amendment if the accepted write set cannot implement the contract without a new authority, persistence owner or public API.

## T01 — Canonical user-facing contracts

- **Depends on:** none. **Risk:** high. **Review:** required.
- **Exclusive write set:** `packages/domain-contracts/src/**` and contract-owned tests only.
- **Output:** stable job/attempt/progress/error/diagnostic projections; explicit known/unknown total bytes; truthful terminal semantics; retry eligibility distinct from UNKNOWN; immutable confirmed target/scope.
- **Acceptance:** deterministic schema tests; positive and malformed/unknown-field negatives; cross-surface parity fixtures.
- **Forbidden:** no Core authority, scheduler, persistence, UI or transport implementation.

## T02 — Core transfer reliability and safe files

- **Depends on:** T01. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `packages/direct-acquisition/src/**` and its tests only.
- **Output:** bounded transient retry policy within existing budget; remote-validator-gated resume; safe partial-file identity; filename/path sanitation; collision policy; atomic finalization after applicable validation.
- **Acceptance:** timeout/reset/disk-full/redirect/changed-validator/path traversal/collision/partial-corruption tests; no false COMPLETE; no duplicate accepted artifact; direct-transfer baseline measured.
- **Forbidden:** no new HTTP/TLS stack, no unbounded retry, no blind append, no automatic replay of UNKNOWN, no new ledger authority.

## T03 — CLI usability and diagnostics

- **Depends on:** T01. **Risk:** high. **Review:** required.
- **Exclusive write set:** `apps/cli/**`.
- **Output:** installed argv route to the v0.2 Domain App; stable JSON mode and exit codes; explicit human-readable mode/progress on stderr; clear usage and actionable errors; local `doctor`-style Host/runtime/destination diagnostics.
- **Acceptance:** clean packaged consumer; TTY and redirected output; stdout JSON remains parseable; status/wait/cancel/retry/batch; missing Host, permission denial, malformed input and timeout negatives.
- **Forbidden:** no locally invented lifecycle truth; no silent transport fallback; no automatic Core launch/stop outside the accepted contract.

## T04 — Browser extension v0.2 cutover

- **Depends on:** T01, T02. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `apps/browser-extension/**`.
- **Output:** existing Manifest V3 extension submits through the v0.2 Host/Domain App path; permission is requested only when required; user sees selected target and actionable failure state.
- **Acceptance:** real Chromium session against packaged Host; allow/deny permission; wrong origin/Host mismatch; malformed target; no raw cookies or signed credentials in K/model/logs; no unauthorized network effect.
- **Forbidden:** no new crawler, no silent permission grant, no credential copying to model, no second authority.

## T05 — HLS VOD S4 journey

- **Depends on:** T01, T02. **Risk:** high. **Review:** required.
- **Exclusive write set:** `packages/hls-vod-adapter/**` and `packages/download-domain-app/src/hls/**`.
- **Output:** supported bounded HLS VOD flow through selected K/Host and existing HLS adapter.
- **Acceptance:** controlled authorized HLS fixture, explicit variant/scope policy, real materialized output and applicable integrity checks; unsupported live/DRM/ambiguous cases refuse truthfully.
- **Forbidden:** no new media engine or DRM/access bypass; no implicit playlist/page crawling; no S4 claim from unit tests alone.

## T06 — Desktop shell bootstrap and secure IPC

- **Depends on:** T01. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `apps/desktop-shell/package.json`, `apps/desktop-shell/src/main/**`, `apps/desktop-shell/src/preload/**`, and the root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` changes required for this package only.
- **Output:** local packaged Electron shell using the existing adapter and trusted Host boundary.
- **Acceptance:** clean build/start/close smoke; local assets only; Node integration disabled in renderer; context isolation and sandbox enabled; restrictive CSP; narrow typed preload API; validated IPC sender/payload; no arbitrary navigation/window or raw filesystem/shell authority in renderer.
- **Forbidden:** no remote privileged renderer, no generic IPC bridge, no independent queue/state store, no silent package-manager/toolchain changes.

## T07 — Desktop Download Manager UI

- **Depends on:** T01, T06, T02. **Risk:** high. **Review:** required.
- **Exclusive write set:** `apps/desktop-shell/src/renderer/**`.
- **Output:** add URL, target/output preview, job list, truthful progress/status, cancel, eligible retry, understandable failure, destination choice, reveal completed file/folder.
- **Acceptance:** accessible keyboard flow and empty/loading/error states; progress does not invent totals/ETA; renderer cannot call privileged APIs outside the preload allowlist.
- **Forbidden:** no pause/resume UI unless T02 proves it; no local status or retry decisions independent of Core.

## T08 — Host, installer and package integration

- **Depends on:** T03, T04, T05, T06, T07. **Risk:** critical. **Review:** required.
- **Exclusive write set:** `build/**`, `installers/**`, `scripts/install-host/**`.
- **Output:** reproducible user-installable package(s), correct native Host registration/manifest, version/build identity and safe uninstall/upgrade behavior.
- **Acceptance:** clean machine/user install, Host registration/readback, package contents audit, exact source/package/installer hashes, no execution/evidence-only files shipped.
- **Forbidden:** no edits to root lockfile or surface source files owned by sibling tasks; no unsupported OS claims; no npm SDK assumption.

## T09 — User and Agent documentation

- **Depends on:** T03, T04, T05, T07. **Risk:** medium. **Review:** recommended.
- **Exclusive write set:** `docs/user/**` and `docs/agent/**`.
- **Output:** Chinese-first user quick start, troubleshooting, permissions, destination/retry/recovery semantics and supported matrix; English-first Agent/automation contract, CLI examples and failure semantics.
- **Acceptance:** every documented command exists; examples run against the packaged candidate; known limits and privacy behavior match the exact implementation.
- **Forbidden:** no edits to frozen Product/L2 semantics; no unsupported marketing claims.

## T10 — Validation harness and controlled fixtures

- **Depends on:** T01. **Risk:** high. **Review:** required.
- **Exclusive write set:** `tests/v0.2.1/**`.
- **Output:** reusable controlled direct/HLS fixtures and corpus for restart, cancel, UNKNOWN, duplicate, changed validator, bad path, permission, Host mismatch, corrupt output and redaction.
- **Acceptance:** tests prove real Host/network/file effects where required; fakes are clearly labelled and never substitute for installed gates.
- **Forbidden:** no secrets, third-party personal content, arbitrary internet dependency or tests that erase/repair UNKNOWN state silently.

## T11 — CLI installed-path validation

- **Depends on:** T03, T08, T10. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/cli/**`.
- **Output:** exact-SHA clean install evidence for direct download, status/wait/cancel/retry/batch, JSON/text, exit codes and diagnostics.
- **Acceptance:** commands, environment, fixture, EXIT and artifact hashes recorded; no Builder-only evidence substitution.

## T12 — Browser/Host security validation

- **Depends on:** T04, T08, T10. **Risk:** critical. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/browser/**`.
- **Output:** real Chromium + installed Host evidence for S2 and permission/authority negatives.
- **Acceptance:** selected target, origin, permission, Host identity, output and exact package hashes recorded; all unauthorized paths fail closed.

## T13 — Desktop journey validation

- **Depends on:** T07, T08, T10. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/desktop/**`.
- **Output:** installed desktop journey and security evidence.
- **Acceptance:** add URL, destination, progress/status, cancel, retry, restart recovery and reveal-file flow; packaged renderer isolation rechecked.

## T14 — HLS journey validation

- **Depends on:** T05, T08, T10. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/hls/**`.
- **Output:** real controlled HLS VOD end-to-end evidence on the packaged candidate.
- **Acceptance:** finite scope, correct output, truthful unsupported/failure state, no false completion.

## T15 — Platform/install/upgrade validation

- **Depends on:** T08, T11, T12, T13, T14. **Risk:** critical. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/platform/**`.
- **Output:** installed baselines bound to exact release SHA and tested supported-platform matrix.
- **Acceptance:** clean install, upgrade from prior candidate, uninstall, Host registration, destination permissions and artifact hashes; any untested platform is explicitly not claimed.

## T16 — Human G0/G1 effort study

- **Depends on:** T11, T12, T13, T14, T15. **Risk:** high. **Review:** independent required.
- **Exclusive write set:** `docs/validation/v0.2.1/human/**`.
- **Owner:** human study coordinator; real participants required.
- **Output:** conventional baseline and xDownload sessions with attributable time, steps, errors, assistance and participant notes.
- **Acceptance:** consent/privacy-safe protocol, comparable tasks, raw observations and limitations. An Agent cannot self-report human effort or manufacture sessions.

## T17 — Candidate Freeze

- **Depends on:** T09, T11, T12, T13, T14, T15, T16. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/candidate/**`.
- **Output:** one immutable candidate SHA/tree and visible gate board.
- **Acceptance:** all release-claimed journeys PASS on that lineage; no blocking P0/P1; installed hashes bind to the candidate; open UNKNOWNs and exclusions are explicit.

## T18 — Hidden Validation

- **Depends on:** T17. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/hidden/**`.
- **Output:** adversarial hidden results for path/identity/permission/recovery/duplicate/redirect/credential/renderer IPC cases.
- **Acceptance:** zero escaped release-blocking P0/P1; hidden cases cannot be replaced by visible-test summaries.

## T19 — Version Closure

- **Depends on:** T18. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/closure/**`.
- **Output:** issue/PR/candidate/installed-hash and evidence-currentness reconciliation.
- **Acceptance:** every task has a terminal outcome; deferral ledger reconciled; NOT_RUN/NOT_PROVEN and residual risks remain explicit.

## T20 — Release Qualification

- **Depends on:** T19. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/rq/**`.
- **Output:** independent exact-SHA READY/CONDITIONAL/BLOCKED/FAIL decision and exact claim set.
- **Acceptance:** RQ rechecks candidate lineage, installed evidence, hidden results, closure and permission conditions; task/CI PASS alone cannot infer READY.

## T21 — Qualified main integration

- **Depends on:** T20. **Risk:** critical. **Review:** independent gate.
- **Exclusive write set:** `docs/release/v0.2.1/integration/**`; protected merge only when RQ explicitly permits.
- **Output:** base/diff re-read, qualified PR, merge result and exact main readback.
- **Acceptance:** only an accepted RQ READY with explicit integration permission can merge; no npm publication or additional release claim is inferred.

## Failure handling and stop rules

- Record P0/P1/P2 and exact evidence. Never downgrade severity to make a gate green.
- If the accepted v0.2.1 Product/L2 cannot be implemented without changing authority, persistence, trust boundary or supported scope, stop and request an approved amendment.
- If a real environment is required (Windows installer/Host, Chromium, desktop package or human G0/G1), the task must explicitly request that environment. Do not replace it with a simulation and report PASS.
- The DAG is frozen only after independent exact-SHA review, explicit Owner freeze and a durable freeze/read-back receipt. No source task is dispatchable before canonical issue/dependency materialization and its accepted JIT Claim.
