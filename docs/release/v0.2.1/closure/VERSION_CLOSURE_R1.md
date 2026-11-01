# xDownload v0.2.1 — Version Closure R1

```yaml
status: COMPLETE_R1
issue: 269
frozen_candidate_source: 52a39451dafd44ff3c2d03b93c95db78c3add126
frozen_candidate_zip_sha256: 9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718
frozen_candidate_content_hash: 87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9
closure_date: 2026-11-01
```

## 1. Task/issue/PR reconciliation (all tasks terminal)

| Task | Issue (state) | PR | Delivered head | Merge SHA | CI (Woodpecker) |
|---|---|---|---|---|---|
| T01 | #250 CLOSED | #272 | (pre-baseline) | e71ff24c | (prior session) |
| T02–T09, T11 | #251–#258,#260 CLOSED | #277–#282 etc. | (pre-baseline) | …→1b7785f/56f9e16 | (prior session) |
| Amendment R1 (T09-R1 admission) | #284 record | #286 | 240d5a05 | d96ddb32 | docs-only |
| T09-R1 | #285 CLOSED | #288 | 29793e31 | a9a49cd12 | #116 |
| Amendment R2 + R2A (T02-R1 admission) | #287/#291 records | #290/#292 | 267c4b18 / 8f4777b6 | 69be00740 / 24ac13f39 | docs-only |
| T02-R1 | #291 CLOSED | #293 | bb2664cc | 52a39451 | #118 (#117 prettier-fixed) |
| T10 | #259 CLOSED | #283 | af146aed | 4581e044 | #114 + #115 |
| T12 | #261 CLOSED | #294 | 661dca77 | fcfd2190 | #122 (#120/#121 diff-check-fixed) |
| T13 | #262 CLOSED | #295 | e754df89 | 5246af1d | #119 |
| T14 | #263 CLOSED | #297 | bddbed2f | 6b38ed13 | #125 |
| T15 | #264 CLOSED | #296 | df830075 | 1a3e432c | #123 |
| T16 | #265 CLOSED | #298 | c22299e2 | 18d2c32d | #126 |
| T17 | #266 CLOSED | #299 | 2365dec2 | 392afa77 | #128 (#127 transient, restart) |
| T18 Freeze | #267 CLOSED | #300 | 9663d1d7 | d8e9ccdb | #129 |
| T19 Hidden | #268 CLOSED | #301 | e1237cbb | 777c9248 | #130 |

Every v0.2.1 task issue (#250–#271 lineage incl. successors) is CLOSED except
T20 (#269), T21 (#270) and T22 (#271), which are this and the next gates.
P1 issues #284/#287 are CLOSED with resolution records (fixes are ancestors
of the frozen candidate, merge-base verified during the T18 review).

## 2. Candidate and installed-hash binding

- Immutable candidate: source `52a39451dafd44ff3c2d03b93c95db78c3add126`;
  installer zip `9ea81169…4f6e718`; content `87a257f5…360e9` (150 files);
  artifacts cli `35414eab…`, core `2c057fd4…`, desktop `63752077…`,
  extension `1257a8cb…`, native-host `631f8926…`; desktop exe `c579acaa…143c`.
- Every installed-path validation (T12–T16), the T09-R1 packaged-exe smoke,
  and the T19 hidden runs bind to these exact hashes; the T18 freeze review
  verified byte-finality (post-52a3945 commits touch documentation only).
- Toolchain identity declared in every artifact: node 24.21.0, pnpm 12.8.1,
  esbuild 0.25.12.

## 3. Evidence currency

- Every gate's Woodpecker evidence is a SUCCESS run at the gate's FINAL
  delivered head on the local Docker agent (Node 24.21.0 / pnpm 12.8.1);
  where an earlier pin existed it is listed (T10: #114 ran at the pre-review
  head, #115 at the final af146aed). Known CI incidents and their
  resolutions: #117 (prettier on 2 test files), #120/#121 (raw-log EOF blank
  line vs `git diff --check`), #127 (transient suite flake; restart #128
  green). No gate was marked PASS on a failed pipeline.
- Disclosure: the repository's GitHub Actions `ci:verify` workflow has never
  been green on this lineage (baseline prettier failures across 21 src
  files predating v0.2.1; its `pull_request` trigger also only targets
  version/v0.1.0, so PR checks are push-event echoes). Per project policy
  GitHub Actions is not a gate for v0.2.1 — the authoritative CI is the
  local Docker Woodpecker exact-SHA evidence above. Carried to T21.
- Auditability note (from the T18 review): the local Woodpecker backend does
  not retain logs after completion; the durable audit chain is the in-repo
  EVIDENCE documents + PR merge commits + pipeline status records cited in
  each closeout.

## 4. Deferral ledger reconciliation (v0.2.0 → v0.2.1, per #242)

| Deferred item | v0.2.1 disposition |
|---|---|
| Installed CLI user surface / CF-1 | CLOSED — T04 + T12 (CF-1 EXIT=0 on the candidate; live v0.2 route proven installed via T02-R1) |
| Browser extension v0.2 cutover + real Chromium | CLOSED at host level — T05 + T13 (S2 full chain, negatives, privacy); popup-level allow-positive remains human-gated (§5) |
| S4 HLS as a release journey | CLOSED — T06 + T15 (real interactive VOD download, honest refusals); v0.2-route HLS end-to-end is a deployment fact (unseeded registry) |
| Installed baselines bound to a release SHA | CLOSED — T16 binds clean-install/upgrade/uninstall/hashes to the frozen candidate |
| Real human G0/G1 | NOT RUN — protocol+kit delivered (T17); owner-executed sessions pending (§5) |

## 5. NOT_RUN / NOT_PROVEN and residual risks (explicit)

1. **T17 human G0/G1 sessions — NOT_RUN** (owner-executed per
   docs/validation/v0.2.1/human/PROTOCOL.md; no G0 claim is made; RQ cannot
   be READY until sessions exist and are independently reviewed).
2. **T13 popup-level allow-permission positive — NOT_PROVEN_HUMAN_REQUIRED**
   (procedure in browser/EVIDENCE.md §9.1).
3. **T14 DESKTOP_UI acquisition reachability** — product-scope boundary
   (admission/control plane only on this candidate; CLI surface owns byte
   acquisition).
4. **T16 read-only-destination FS-level refusal — NOT_PROVEN** (binding-fence
   convergence recorded).
5. **T12 retry-success projection — NOT_PROVEN** (unreachable installed;
   LATE_COMMAND immutability proven).
6. **#289 (P2, OPEN, deferred)** — uninstall cleanliness (G3 typed EPERM with
   Core running; G4 dangling broker.json). Deferred to a v0.2.2 candidate or
   owner direction; recorded in T16 evidence.
7. **T09-R1 review P2 residuals** — packaged-tree debug.log hygiene, lazy
   zip-header shorthand, cross-platform zip-equality unit test.
8. **T19 hardening notes** — legacy contract-id grammar accepts `/` (zero
   path effect measured); SUBMIT_CONTRACT has no surface gate (frozen code).
9. **Platform scope** — win32-x64 + Node 24 only; all other platforms
   NOT_TESTED and unclaimed.

## 6. Closure statement

All 22 frozen tasks plus the three admitted successors (T09-R1, T02-R1 via
Amendments R1/R2/R2A) have reached terminal states with independent
exact-SHA review and local-Docker Woodpecker evidence at their exact heads,
except the human-owned items listed in §5 (1)(2), which are explicit
exclusions rather than silent gaps. The immutable candidate of §2 is the
sole release lineage. T21 (Release Qualification) decides
READY/CONDITIONAL/BLOCKED/FAIL on this closure.
