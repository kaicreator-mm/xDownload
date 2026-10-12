# T022 / #81 — Phase-B successor campaign report (PB2)

Status: **measurement campaign complete; evidence-ready; gates evaluated by the
frozen T003 machinery. This report is data collection + gate board ONLY — it is
NOT a T022 verdict and NOT a release PASS** (T022_VALIDATION=NOT_YET_AUTHORIZED;
RELEASE_PASS=NO; the independent T022 Validator owns the verdict).

## Binding identities

- Controller disposition: issue #81 comment 6131991315 (PHASE_B_AUTHORIZED=YES_AFTER_MANIFEST_V2_FREEZE)
- Manifest v2.1 (pre-exposure freeze): SHA256
  `755169b3df6e6395636c15991cd260f768b456885f4813117b2bb1d1e89fa9c5`
  (path `C:\xDev\runtimes\t022-g0-phase-b\manifest-v2.json`; predecessor chain
  v1 `b17c344c…d22b`, v2 `effe401f…cbe3` superseded pre-measurement — see
  `manifest-v2.json` `predecessor_freeze_chain`).
- Candidate: `5f70de80310d9ecd8a486a34d3ab7d67877a0fde`, tree
  `7828bf12eb57b73c7ce38d7f30ed5939925d60d7` (T019_VALIDATION #38 comment
  6131952596 PASS; locally rebuilt in worktree `i81-pb2-op`, dist identity
  binds the exact sha).
- Baselines (re-verified 2026-10-12T21:07Z, all hashes OK): Chrome for Testing
  120.0.6099.109 (win64), yt-dlp nightly 2026.09.27.232945. No substitution.
- Frozen G0 plan: `g0-plan/v0.1.0-primary`, digest `44f437a2…f0b15`, unchanged.
- OLD_PHASE_B_REUSE=FORBIDDEN honored: no prior Phase-B evidence was read.

## Execution summary (all runs real host I/O; evidence under
`C:\xDev\runtimes\t022-g0-phase-b\runs\<run_id>\`)

| run | workflow | manual actions | active ms | outcome | truth |
|---|---|---|---|---|---|
| PB2-S1-B1 | browser-native | 4 | 19 131 | SUCCESS | byte-exact |
| PB2-S1-B2 | yt-dlp | 2 | 27 192 | SUCCESS | byte-exact (no-ext filename noted) |
| PB2-S1-X1 | xdownload | 4 | 25 060 | SUCCESS | byte-exact |
| PB2-S2-B1/X1 | — | — | — | NOT_EXECUTED | BLOCKED_AUTH (symmetric) |
| PB2-S3-B1 | browser-native | 5 | 28 764 | SUCCESS | byte-exact |
| PB2-S3-B2 | yt-dlp | 2 | 24 423 | SUCCESS | byte-exact |
| PB2-S3-X1 | xdownload | 6 (incl. 2 typed rejections) | 92 475 | SUCCESS | byte-exact |
| PB2-S4-B1 | browser-native | 184 | 510 372 | SUCCESS | 181/181 segments + playlist byte-exact |
| PB2-S4-X1 | xdownload | 2 | 129 590 | SUCCESS | 181/181 transferred; target/transfer/media all PASSED; ffprobe 1800.0958s vs planned 1800.001s |
| PB2-S5-B1 | browser-native per-member | 9 | 44 182 | SUCCESS | 6/6 byte-exact |
| PB2-S5-X1 | xdownload collection | 4 | 69 906 | SUCCESS | 6/6 byte-exact, 0 extras |
| PB2-S6-B1 | browser-native per-member | 19 | 76 727 | SUCCESS | 16/16 byte-exact, 0 extras |
| PB2-S6-X1 | xdownload collection | 4 | 142 731 | SUCCESS | 16/16 byte-exact, 0 extras; terminal COMPLETE/NATURAL_COLLECTION_END via declared natural-end closure |
| PB2-S6NAV-B1/X1 | — | — | — | NOT_EXECUTED | BLOCKED_AUTH (symmetric) |

Wrong-target: 0 everywhere. False success: 0. Abandoned: 0. Unknown: 0.
§32.1 denominator: 16 pre-registered tasks; 12 executed once each (EX-R5
reruns carried the same run identity); 4 NOT_EXECUTED (BLOCKED_AUTH).

## Operator disclosure

`operator_ref=pb2-operator-01`: an AI agent session (ZCode/GLM) performed every
recorded interaction as REAL host I/O (real browser download flows, real CLI
invocations, real command executions, real byte verification) under the
supervising account kaicreator-mm. **No human-effort pacing is claimed**: the
numbers measure agent-operated task burden with identical action sequences on
both sides (paired design). Absolute times carry instrumentation overhead
disclosed in `MANIFEST-V2-CHANGES.log` (fnm exec per CLI call ~2-5s, scripted
pacing sleeps, dpr-1.75 input-injection workaround). No sample is fabricated;
every artifact byte and action timestamp is re-verifiable.

## Gate board (frozen T003 `evaluateGate`, unmodified candidate machinery;
raw output `evaluate-gates.ts` → run 2026-10-13)

| gate | result | notes |
|---|---|---|
| G0 | **INSUFFICIENT_EVIDENCE** | CJ-02 (S2), CJ-09 (S6NAV) auth-blocked NOT_EXECUTED; CJ-06/07/08 hard-corpus confirmations out of #81 campaign scope (CJ-08 additionally awaits the #80 successor oracle). Executed slices: correct completion parity ✓ (12/12 vs baselines 12/12), collection effort reduced (S5+S6 actions 28→8) ✓, zero critical defects ✓. |
| G1a | **SPLIT: PASS on actions / FAIL on time** | S5 pair: manual actions 9→4 (strict reduction, machinery PASS); active time 44.2s→70.0s (machinery FAIL) — the time regression is dominated by the disclosed instrumentation overhead asymmetry; both raw numbers are in the CSV for Validator adjudication. Correct completion parity ✓, false success 0 ✓. |
| G1b | **INSUFFICIENT_EVIDENCE** | no executable navigation-required case (AUTH_LIMITED_ACCOUNT unavailable) — machinery: "S6 must be narrowed before release" stands. |
| G1c | **FAIL** | S3 pair: actions 5→6, time 28.8s→92.5s — no strict selection-effort reduction measured on the CLI surface (the X-side actions include two honest typed-rejection recoveries); wrong-target rate 0 both sides (no correctness regression). |

## NOT_EXECUTED coverage (explicit)

- PB2-S2-B1/X1 (CJ-02): BROWSER_AUTH_LOCAL unavailable — no real signed-in
  local browser context; pinned profile is no-sign-in by frozen identity;
  account creation declined; fixtures forbidden (EX-R6).
- PB2-S6NAV-B1/X1 (CJ-09, G1b): AUTH_LIMITED_ACCOUNT unavailable — no real
  limited-authorization account; fixtures forbidden.
- CJ-06/07/08 hard-corpus confirmations: out of #81 Phase-B scope (CJ-08 is
  gated on the #80 CJ-08 successor oracle; the #79 secret-sink hardening and
  #71 items are separate).

## Instrumentation change log (all pre-result, EX-R5 reruns, disclosed)

`C:\xDev\runtimes\t022-g0-phase-b\MANIFEST-V2-CHANGES.log` changes 001-007:
harness exit-hold; CDP input-injection workaround (DOM click activation);
multi-download permission pre-grant; S4 assembly-port request-shape fix;
collection confirmation-source relay (origin faithfully recorded
INJECTED_SOURCE); S6 declared-natural-end handoff instantiation. The Phase-A
profile-template Preferences path corruption found pre-measurement was repaired
and recorded inside manifest v2.1 (`profile_template_repair`).

## Terminal

`G0_G1_MEASUREMENT=EVIDENCE_READY` — real dual-workflow measurements captured
on the exact approved successor under the frozen protocol; gate board above is
data, not a verdict. `PHASE_B_EVIDENCE_READY`; `T022_VALIDATION=NOT_YET_AUTHORIZED`;
`RELEASE_PASS=NO`.
