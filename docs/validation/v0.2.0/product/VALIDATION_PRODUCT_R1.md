# VALIDATION_PRODUCT_R1 — v0.2.0 T16 Product journey Validation (Issue #216)

- **Task:** T16 — validation-product (Task Pack `docs/implementation/v0.2.0/TASK_PACKS_R0.md` §T16)
- **Validator:** independent Product Validator, operator_id `zcode:xd-v02-t16-validator-agent`
- **Exact candidate:** `task/v02-t16` @ `7fa721053aeb2c48ce7b1c150ef71ea94e15e09d` (= T13 final merge 7fa7210, exact candidate baseline)
- **Workstation:** `xd-v02-t16-validator` (working tree clean at validation start; only this write set changed)
- **Environment:** Windows x64, node v24.21.0 (engines-pinned), pnpm 12.8.1, real commands only
- **Write scope:** `docs/validation/v0.2.0/product/**` only; no source, no tests, no manifests touched

## 0. Verdict summary (layered — no washing into a single PASS)

| Layer | Verdict | Basis |
| --- | --- | --- |
| COMPOSITION_LEVEL (candidate's real journey suites, re-run) | **PASS** | 5/5 suites re-run green on the exact candidate: 42/42 tests, all `node --test` EXIT=0 |
| INSTALLED_LEVEL (release-claimed installed user path S1–S6) | **BLOCKED** | Candidate has NO installed surface: CLI argv not wired to the v0.2 Domain App; no packaged/installable v0.2 product artifact exists. Gap list in §3.4 |
| HUMAN_G0G1 (Product G0/G1 parity, human effort comparison) | **NOT_RUN** | No human sessions exist on v0.1 or v0.2 side; measurement fabrication forbidden by the task pack. §4 |

T16 acceptance demands the **installed user path for release-claimed S1–S6**. That object does not exist on this candidate, so the gate cannot be declared satisfied; the honest terminal state for the installed layer is BLOCKED with concrete preconditions for T18. What *does* exist on the candidate — the T11/T12 composition-runtime journey suites — was re-run for real and passes; that is recorded at its true (composition) level, never relabeled as installed evidence.

## 1. COMPOSITION_LEVEL = PASS — real re-runs on the exact candidate

These are the candidate's actual "user-path equivalents" at composition-runtime level: real `127.0.0.1` fixtures (zero mocks), the real vendored v0.10.3 SDK kernel `load`, real K permits/journals, real bytes on disk re-read and re-hashed against the confirmed digest anchor. They are **not** installed-level journeys and are not claimed as such.

Commands (run from repo root of the exact candidate; node v24.21.0):

| # | Suite | Command | EXIT | tests / pass / fail / skipped |
| --- | --- | --- | --- | --- |
| 1 | T11 direct journey | `node --experimental-transform-types --test packages/download-domain-app/src/composition/composition-runtime.test.ts` | 0 | 8 / 8 / 0 / 0 (duration_ms ≈ 1012.7) |
| 2 | T12 S3 media journey | `node --experimental-transform-types --test packages/download-domain-app/src/integrations/s3-media.test.ts` | 0 | 9 / 9 / 0 / 0 (≈ 494.5) |
| 3 | T12 S2 discovery journey | `node --experimental-transform-types --test packages/download-domain-app/src/integrations/s2-discovery.test.ts` | 0 | 7 / 7 / 0 / 0 (≈ 396.0) |
| 4 | T12 S5 collection journey | `node --experimental-transform-types --test packages/download-domain-app/src/integrations/s5-collection.test.ts` | 0 | 9 / 9 / 0 / 0 (≈ 449.8) |
| 5 | T12 S6 navigation journey | `node --experimental-transform-types --test packages/download-domain-app/src/integrations/s6-navigation.test.ts` | 0 | 9 / 9 / 0 / 0 (≈ 442.9) |
| | **Total** | | **0 (each)** | **42 / 42 / 0 / 0** |

Exit codes are the test runner's real process exit codes, captured as `EXIT=$?` after full-output redirection (no pipes, no coercion). All 42 tests assert end-to-end journeys, including the negative spine: T01 gate-before-send zero-effect refusals, exactly-one-permit/no-double-journal, duplicate-messageId idempotency, mid-flight abort settling truthfully non-completed with no auto-redownload, store stop/reopen journal replay, digest-mismatch materializing no file (T11); HLS no-widening refusals, unresolvable-dispatch truthful zero-network failure, digest anchor behind engine acceptance (S3); over-selection refusal and ambiguity→confirmation-plan with zero effects (S2/S5/S6).

### 1.1 Slice coverage at this level (honest denominators)

| Slice | T10 baseline oracle level | Candidate journey on this candidate | This re-run |
| --- | --- | --- | --- |
| S1 Direct HTTP/HTTPS File | FULL_ORACLE (`baseline-oracle.test.ts`) | T11 `submitConfirmedDownload` + suite #1 | PASS 8/8 |
| S2 Browser handoff / attachment | DESCRIPTOR_REGISTRY_MATCH | T12 s2-discovery (browser-mediated chain exercised at loopback-fixture level; real browser legs are T15 scope, NOT_PROVEN by the module's own header) | PASS 7/7 |
| S3 Direct Media File | DESCRIPTOR_REGISTRY_MATCH | T12 s3-media (`MEDIA_SLICE = 'S3'`), real bounded HLS fixture | PASS 9/9 |
| S4 HLS VOD Basic | DESCRIPTOR_REGISTRY_MATCH | **No candidate implementation journey exists** (descriptor only; see gap G5) | NOT_RUN (no object to run) |
| S5 Current-page collection | DESCRIPTOR_REGISTRY_MATCH | T12 s5-collection | PASS 9/9 |
| S6 Explicit playlist/gallery collection | DESCRIPTOR_REGISTRY_MATCH | T12 s6-navigation | PASS 9/9 |

Composition-level PASS therefore means: every journey the candidate actually implements re-runs green. It does NOT mean S1–S6 product acceptance is discharged — S4 has no journey at all, and S2/S5/S6 remain browser-mediated slices whose real-session legs belong to T15.

## 2. T10 baseline re-check — PASS

Command: `node tests/domain-app/run.mjs` → **HARNESS_EXIT=0** (the runner prints and propagates the real exit code), node v24.21.0, 4 test files (`baseline-oracle`, `fixtures`, `recovery`, `zero-network`): **37 / 37 pass, 0 fail, 0 skipped** (duration_ms ≈ 461.9).

S1–S6 descriptor status vs candidate implementation vocabulary spot-check:

- `tests/domain-app/baselines/slices-s1-s6.baseline.json` descriptors (titles, surfaceClass, defaultContinuation, requiredValidationLayers) match the frozen registry `packages/domain-contracts/src/slices.ts` (`SUPPORT_SLICE_IDS`, `SLICE_REGISTRY`) one-for-one; the passing `baseline-oracle.test.ts` asserts `assertBaselineMatchesRegistry(baseline)` returns `mismatches: []` with `ok: true`, plus `installedBaselineStatus === 'DESCRIPTOR_ONLY_PENDING_INSTALLED_RELEASE'` and per-slice `installedBaseline.status === 'NOT_PROVEN_DESCRIPTOR_ONLY'`.
- The candidate implementation reuses the T10 vocabulary verbatim, honestly: `s2-discovery.ts` / `s5-collection.ts` / `s6-navigation.ts` headers cite "T10 DESCRIPTOR_REGISTRY_MATCH" and state real installed browser sessions are "NOT_PROVEN here by design" (T15); `s3-media.ts` states "PROVEN at bounded-fixture level … Installed-path media validation … NOT_PROVEN here and belongs to T16 validation-product"; `slice-journey-shared.ts` submits the T01 S1 `acquisition.acquire` vocabulary for every slice's effectful leg.
- Descriptor `installedBaseline` ownership: S1/S3/S4/S5/S6 → `T16 validation-product`; S2 → `T15 validation-browser`; all six are `NOT_PROVEN_DESCRIPTOR_ONLY` — consistent with this file's §3.

No drift found between baseline descriptors, frozen contracts registry and candidate implementation vocabulary.

## 3. INSTALLED_LEVEL = BLOCKED — fact record and gaps

### 3.1 CLI argv is not wired to the v0.2 Domain App (source fact)

- `apps/cli/src/main.ts` (the process argv entry) imports only `./args.ts`, `./render.ts`, `./adapter.ts`, `@xdownload/core-seam`, `@xdownload/domain-contracts` (v0.1 seam runtime). It contains **no reference** to `domain-app-commands` / `domain-app-facade` / the v0.2 Domain App.
- The v0.2 T07 deliverable `apps/cli/src/domain-app-commands.ts` (+ `domain-app-facade.ts`) is imported **only by its own colocated test** (`domain-app-commands.test.ts`). It is unreachable from process argv — a structural mirror/command adapter, not an installed command path.
- Therefore no `xdownload <url>`-style installed user journey over the T11/T12 composition exists on this candidate.

### 3.2 No packaged/installable v0.2 product artifact exists

- No `dist/` tree and no `.tgz` product artifact exist in the candidate tree (T13 build outputs are git-ignored and were not produced here; nothing installed-level to launch).
- The T13 packaging normalization ledger (`build/README.md`, §"v0.2.0 domain packages (T13) — packaging boundary") records the boundary verbatim: the v0.2 packages `@xdownload/download-domain-app` / `@xdownload/download-domain-host` are delivered **as workspace packages, not as dist artifacts**; T13 "deliberately adds no `ARTIFACTS` entry for them"; "no frozen v0.2 lane owns a terminal-product packaging claim for the domain app/host (installed-path validation belongs to T15/T16)"; the dist pipeline (cli/core/extension/native-host) remains the **v0.1.0** terminal-product bundler.
- T13's packaging evidence in `packages/download-domain-app/README.md` §"Packaging evidence" is package-consumer level (`pnpm pack` tarballs, clean install, esbuild bundler smoke 12/12 over the installed bytes). Real and green — but it exercises the SDK facade surface, not an installed product user path.

### 3.3 Baseline descriptors corroborate

All six slices in the T10 baseline carry `installedBaseline.status = "NOT_PROVEN_DESCRIPTOR_ONLY"` with honesty note: an "actual installed baseline tied to the release SHA … belongs to the version Validation lanes (T13 packaging, T16 product journeys) and is NOT_PROVEN here by design."

### 3.4 Gap list (T18-visible inputs; each blocks installed-level S1–S6)

| # | Gap | Evidence anchor |
| --- | --- | --- |
| G1 | CLI argv wiring: `apps/cli` `main.ts`/`adapter.ts` must reach the v0.2 journey entry (`domain-app-commands` path) so an installed command drives `submitConfirmedDownload` | §3.1; `apps/cli/src/main.ts`, `apps/cli/src/domain-app-commands.ts` import graph |
| G2 | A packaged/installable v0.2 product artifact (dist ARTIFACTS entry or installer) with an owning lane and support-matrix evidence | §3.2; `build/README.md` packaging-boundary section |
| G3 | Installed baseline tied to the release SHA for all release-claimed slices (replaces `NOT_PROVEN_DESCRIPTOR_ONLY`) | §3.3; `tests/domain-app/baselines/slices-s1-s6.baseline.json` |
| G4 | Real browser / native-host sessions for the browser-mediated legs (S2 attachment; S5/S6 current-page membership) — T15 validation-browser scope; T16 accepts their handoff | module headers §1.1; T15 owner in baseline JSON |
| G5 | S4 "HLS VOD Basic" has **no candidate implementation journey at all** (`MEDIA_SLICE = 'S3'` only; no `S4` reference anywhere in non-test sources) — either an owning lane delivers an S4 journey or the release claim must exclude S4 | §1.1; grep evidence: only `slices-s1-s6.baseline.json` mentions S4 outside tests |

Until G1–G3 (and the S4 claim decision G5) are closed by owning lanes, installed S1–S6 journeys cannot be executed by any validator — this is a candidate-scope blocker, not an execution failure of T16.

## 4. HUMAN_G0G1 = NOT_RUN

- PRD authority (`docs/product/PRD-v0.4.2-review-candidate.md` §§31–33): G0 requires human confirmation evidence across S1–S6 against a frozen `G0BaselinePlan` (active user time, manual actions, recovery effort, false-success rate); G1a/G1c require manual-vs-batch/assisted effort comparison. The PRD itself states: "No actual G0 PASS is claimed by this PRD. Economic benefit remains `NOT_MEASURED`."
- v0.1 comparison material exists **only at preparation level**: `docs/implementation/v0.1.0/T022_G0_G1_PHASE_A_OPERATOR_PACKET.md` is explicitly "operator preparation only. No baseline measurements, Phase-B execution, Gate PASS … is asserted"; `docs/implementation/v0.1.0/T022_G0_G1_PHASE_A_OBSERVATIONS.csv` contains the header row only — **zero observation rows**. There is no v0.1 human baseline to compare against, hence no v0.1↔v0.2 parity computation is possible.
- No human sessions were conducted in this validation and none are fabricated. Per the task pack ("No fabricated human measurements"), the human G0/G1 layer is recorded **NOT_RUN**, and any future G0 run must use a newly frozen, independently confirmed successor protocol (C33 discipline), not a rescoring of the historical 8/9.

## 5. Final VALIDATION_PRODUCT statement (R1)

- COMPOSITION_LEVEL: **PASS** — reproducible, real-exit evidence in §1–2 (42/42 journey tests + 37/37 baseline harness, all EXIT=0 on `7fa721053aeb2c48ce7b1c150ef71ea94e15e09d`).
- INSTALLED_JOURNEYS: **BLOCKED** — no installed surface exists on the candidate; gaps G1–G5 in §3.4 are the preconditions T18 must see.
- HUMAN_G0G1: **NOT_RUN** — no measurement sessions exist on either side; nothing fabricated.
- Net: T16 cannot certify release-claimed installed S1–S6 on this candidate. This file records the true state and hands the gap list forward; BLOCKED is not washed into PASS and NOT_RUN is not backfilled.

## 6. Evidence hygiene

- All commands above were executed by this validator on the exact candidate in the listed workstation; exit codes captured uncoerced; no output truncation that could hide failures (full logs kept locally at `_tmp/t16-validator/`, outside the repo write set).
- Diff of this deliverable touches `docs/validation/v0.2.0/product/**` only.
- No comments, no merges, no source changes, no scope changes.
