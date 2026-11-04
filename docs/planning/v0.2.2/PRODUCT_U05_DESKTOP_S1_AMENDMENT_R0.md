# U05 Product Scope Amendment R0 — Desktop S1 Direct Acquisition

> STATE: OWNER_AUTHORIZED_SCOPE / PENDING_INDEPENDENT_REVIEW / NOT_YET_FROZEN
> VERSION: xDownload v0.2.2
> PARENT: Issue #310
> OWNER AUTHORIZATION: #310 comment 6616747471
> WIP BASE OBSERVED: 4d2148b80976532cecfaddc111c7fdc94980a289
> FROZEN PRODUCT BASE: docs/planning/v0.2.0/PRODUCT_R0.md (unchanged)

## 1. Purpose

Close the Desktop manager's missing S1 single-resource acquisition and durable history capability by reusing the existing CLI/Core direct-acquisition path. This is a bounded successor amendment; it does not reopen or rewrite the frozen v0.2.0 Product baseline.

## 2. Product behavior

### 2.1 Add one direct resource

- The user enters one absolute HTTP(S) URL in the Desktop manager.
- Desktop validates the URL shape before routing and shows a preview.
- The user explicitly confirms the single-resource scope through the existing Core-produced confirmation workflow.
- Desktop submits the accepted contract and then sends the existing Core Seam command `EXECUTE_S1_DIRECT_ACQUISITION` with the canonical S1 delivery facts.
- Default declared redirect allowlist is the locator's own host, matching the CLI default. No automatic widening to unrelated hosts.
- Optional digest/content-type/total-byte constraints are not added to the Desktop form in this amendment.
- Acceptance of the execution command is not download success. The row remains pending/unknown until Core projection supplies terminal truth.

### 2.2 Durable manager history

- The Desktop manager lists S1 jobs from a read-only Core-owned index query derived from durable accepted-command history.
- The query is scoped to the verified same-install/same-user peer. It includes S1 execution intents accepted from authorized surfaces for that same install/user; it does not enumerate other users or installs.
- The index contains no independently authored status. Every row is hydrated from the existing Core `READ_PROJECTION` result.
- The manager can reopen an existing task after Desktop/Core restart by selecting its Core aggregate identity and reading the current projection.
- The list is bounded to the latest 200 entries; when older entries are omitted, the UI must explicitly show that the list is truncated. No claim of complete history may be made when `truncated=true`.

### 2.3 Destination behavior

- The only destination is the artifact root already configured by Core Runtime.
- No per-download `outputRoot`, destination field, folder picker, or shell-owned destination override is permitted.
- No reveal/open-folder action is shown unless a future Core projection explicitly returns a validated artifact path. The current S1 projection does not expose such a path, so U05 does not claim or synthesize one.
- UI may say `保存位置由 Core 配置管理`; it must not display a guessed path.

### 2.4 Truthful status

- Status, six-dimensional terminal result, retry availability and errors are derived from Core projections only.
- No percentage, ETA, byte total, completion or validation result is fabricated when Core does not expose the corresponding fact.
- A transport disconnect or failed projection read is not rendered as a stale successful task.
- Retry/cancel continue to route through existing Core commands and Core re-decides each transition.

## 3. Frozen scope boundaries

IN SCOPE:
- Desktop S1 single-resource HTTP(S) direct acquisition.
- Reuse existing `SUBMIT_CONTRACT` and `EXECUTE_S1_DIRECT_ACQUISITION` seam commands and Core Runtime S1 driver.
- Read-only, same-install/same-user S1 job index query backed by the existing accepted-command journal and Core projections.
- Durable Desktop history/reopen UI backed by Core identity and projection.
- Removal of any active per-job destination picker/reveal behavior from the Desktop manager flow.

OUT OF SCOPE:
- S2 browser-delivered, S3 selected media, S4 HLS, S5 current-page collection, S6 explicit collection.
- New downloader, transfer engine, K, Scheduler, Journal, Ledger, SQLite authority or second lifecycle store.
- New retry semantics, budget policy, discovery policy, protocol support or redirect-host expansion.
- Per-download destination/output-root selection, shell-owned artifact paths or guessed reveal paths.
- Product-wide redesign outside the U05 Desktop manager path.
- Real external download in CI or local implementation validation; deterministic localhost fixtures only.
- main/version merge, release, tag, deployment or production installation.

## 4. Acceptance criteria

1. A Desktop S1 request uses the existing Core direct-acquisition authority; no Desktop-owned HTTP transfer is introduced.
2. Invalid/non-HTTP(S) URL and unauthorized peer are rejected before any transfer effect.
3. The S1 execution command is bound to the accepted aggregate, single-resource target and declared delivery facts.
4. Core terminal projection, not command acceptance, determines the final row status.
5. The Core-owned list query returns only S1 aggregate projections for the verified install/user; cross-user/install requests fail closed.
6. After Core and Desktop restart, existing S1 jobs remain enumerable and their current projection can be reopened without re-submitting or re-downloading.
7. Duplicate command replay converges through Core idempotency and does not start a second transfer.
8. List truncation is explicit at the 200-item bound.
9. The only destination is Core-configured; no per-download path crosses IPC or is persisted by Desktop.
10. Missing progress/ETA/artifact path remains absent in UI.
11. Tests use deterministic localhost fixtures; no real external download or Native Host side effect.
12. Node 24 syntax and changed-file Prettier run before CI; typecheck, aggregate `ci:verify`, local Docker Woodpecker and Exact-SHA review pass.

## 5. Required sequencing

1. Independent review this Product amendment and its companion L2 amendment.
2. Freeze Product/L2 R0 for U05 without changing v0.2.0 baselines.
3. Freeze a Task DAG with disjoint writers: Core Seam S1 index query; Desktop adapter S1 command mapping; Desktop shell manager/history integration. The shell integration depends on the first two.
4. Freeze each exact Task Pack/write set and publish fresh CAS-bound `LOCAL_BUILDER` claims.
5. Implement, run syntax/Prettier before CI, then typecheck/aggregate CI/local Docker Woodpecker.
6. Independent Exact-SHA review of the combined U05 candidate.
7. Separate Owner authorization for WIP-only integration.

## 6. Owner decisions already fixed

- Core-configured output root only.
- No per-download outputRoot or destination picker.
- Core-owned durable S1 enumeration and projection remain authoritative.
- No new downloader/K/Journal/Scheduler/ledger/transfer engine.
- S1 only; S2–S6 are not added by this amendment.