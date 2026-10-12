# T022 / #81 — G0/G1 real-baseline Phase-A operator packet

**Status:** operator **preparation** only. No baseline measurements, Phase-B execution, Gate PASS, freeze or authority amendment is asserted by this file.

## 1. Authority and subject checks (must precede measurement)

- Frozen Product authority: `docs/product/PRD-v0.4.2-review-candidate.md` §§31–33, especially §32.1 task denominator and §32.2 preregistered baseline selection.
- Task pack: `docs/implementation/v0.1.0/task-packs/T022_product-critical-journey-validation.md`.
- T022 historical terminal: Issue #41 comment `6004819670`; exact old candidate `bc16d9b62e5585eef4d9dda7100f3be2261360e3`, tree `00cd35f126df21b56af9b89fb32e1237fadd223f`.
- Historical frozen G0 plan: `g0-plan/v0.1.0-primary`, digest `44f437a2dea560cecd5341e87f6a8d0bae1af53b552abac51a4d5db2addf0b15`, with registry labels `baseline/browser-native-download@chrome-120-manual-save` and `baseline/yt-dlp@nightly-2026-09`. **Labels are not proof of installed binary version or exact configuration.**
- Historical evidence file *reported by the local validator, not verified by Web*: `C:\xDev\kAiCreator\xDownload\_tmp\T022-validator\t022-cj-gate-evidence.json`. Check actual file presence and SHA256 on the Build Host before relying on it.
- The `packages/version-validation/test/helpers.ts` `rawG0BaselinePlan()` test fixture has illustrative different baseline identities. **Do not use it as the actual T022 frozen plan**.
- Read #80 and #83 fresh authority disposition before attempting a new Phase B. A changed oracle/baseline identity/protocol after the original exposed run requires C33 invalidation and **new, independently frozen successor** protocol; never rescore 8/9 to 9/9.

## 2. Phase-A readiness gates

Record a truthful `PASS`, `FAIL`, `BLOCKED` or `NOT_RUN` for each preparation check:

| Check | Evidence needed | Fail-closed when absent |
|---|---|---|
| Historical G0 plan recovery | Exact original plan JSON and original evidence bytes; recompute registered plan digest via T003 APIs | `PLAN_BYTES_UNVERIFIED` |
| Version/config identification | Actual browser binary/profile, yt-dlp binary/version and workflow/configuration digests; record OS, architecture, dependencies | `BASELINE_IDENTITY_UNAVAILABLE` |
| Applicability | Each task class × declared baseline with same target/scope/auth; objective frozen applicability reason | `APPLICABILITY_UNPROVEN` |
| Corpus and truth | Independently grounded target/membership and correct-completion oracle for every task; stable task IDs, no duplicate sampling | `INDEPENDENT_TRUTH_MISSING` |
| Task parity | Same input, authorization conditions, budgets/permissions, outcome constraints for baseline and xDownload; predeclared cancellation/exclusions | `PARITY_UNPROVEN` |
| Pre-exposure checkpoint | Exact candidate SHA/tree, selection or comparison rule, denominators, metric direction, oracle/protocol version **frozen before** Phase-B results | `PHASE_B_FORBIDDEN` |

If the historic frozen Chrome/yt-dlp identities are unavailable, do **not** silently use a latest version. Initiate approved C33 successor-protocol preparation and use genuinely fresh independent confirmation tasks after freeze.

## 3. Task cards sourced from the registered T003 corpus

The corpus entries are task **classes**, not already-measured human samples. Supply exact targets and truth oracle *before* exposure.

| Card | Registered corpus ID | Required consideration |
|---|---|---|
| S1 | `natural/s1-direct-file` / CJ-01 | Direct file with independent byte/identity truth |
| S2 | `natural/s2-attachment` / CJ-02 | Explicit Browser handoff; actual browser/auth parity |
| S3 | `natural/s3-current-page-media` / CJ-03 | Candidate selection and G1c assisted/manual comparison including confirmation cost |
| S4 | `natural/s4-hls-vod` | Bounded supported HLS VOD; avoid unsupported/encrypted topology |
| S5 | `natural/s5-current-page-collection` / CJ-04 | Same member set; manual/single versus batch G1a comparison |
| S6 | `natural/s6-playlist` / CJ-05 | Explicit bounded playlist; G1a where applicable |
| S6 navigation | `collection/explicit-playlist-continuation` / CJ-09 | G1b same collection, bounded declared continuation vs manual member navigation |

Other CJ negative controls remain separate: CJ-06 `hard/retry-failed-members`, CJ-07 `hard/model-unavailable`, CJ-08 `hard/site-template-mismatch` (**pending #80 successor oracle**). No benchmark outcome may be inferred from a fixture or the existence of a card.

## 4. Human measurement workflow (only after authorized Phase B)

1. Independently assign task and target truth; snapshot task ID, resources, scope/auth parity, expected bytes/membership/ground truth and exclusion rules.
2. Freeze the valid `G0BaselinePlan`, candidate SHA/tree, all measurement rules and required G0/G1 task definitions. Do not view new Phase-B xDownload results until this checkpoint is recorded.
3. On a real host, run the **declared applicable conventional baseline**, with a real operator. Record active user time, manual interactions, retries/recovery, correctness, wrong-target/false-success and actual interruption.
4. On the **same exact task/scope/auth constraints**, execute the exact xDownload candidate, with the same measurement semantics. Preserve raw output, logs, screen/command evidence without leaking cookies or tokens.
5. Compute each task once for §32.1 denominator. Out-of-scope classification, UNKNOWN, abandonment and external cancellation use the exact frozen rules; repeated reruns are not new independent tasks.
6. Apply independent truth and G0/G1 evaluator. G0 needs no correctness regression and collection effort parity unless independently demonstrated compensating correctness improvement; G1a, G1b and G1c require **strict effort/time reduction** with no correctness regression under their prerequisites.
7. Return raw, append-only evidence to the independent T022 Validator. Do not make a release PASS from human notes alone. If data cannot be collected, retain `INSUFFICIENT_EVIDENCE`.

## 5. Blank observation template

Use accompanying `T022_G0_G1_PHASE_A_OBSERVATIONS.csv`. It deliberately contains **header only and zero measurements**. Its rows are future raw evidence, not authority by themselves.

Required values for `phase`: `A` (selection/preparation measurements), or `B` (fresh confirmation only after approved freeze). Use `workflow=baseline|xdownload` and exact `baseline_id` only when applicable. Keep raw task IDs, configuration digests and evidence references alongside sanitized operator identifiers; never record raw credentials.

## 6. Terminal states

- `PHASE_A_READY`: exact plan + binary/config identity + task/oracle parity verified.
- `BASELINE_IDENTITY_UNAVAILABLE`: historical baseline cannot be faithfully reproduced; C33 successor needed.
- `BLOCKED`: hardware/browser/authorization/human operator or independent-truth unavailable.
- `PHASE_B_EVIDENCE_READY`: actual dual-workflow results captured on an approved exact successor, **not** a Gate PASS.
- `G0/G1=PASS|FAIL|INSUFFICIENT_EVIDENCE`: only the independent Validator using pre-registered T003 instrumentation can issue the required gate outcomes.

No new normative authority is introduced by this operator packet.
