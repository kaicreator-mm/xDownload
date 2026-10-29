# v0.2.0 — T19 Hidden Validation public index R1

Task T19 (#219) — independent hidden validation of the frozen candidate declared in
`docs/release/v0.2.0/candidate/CANDIDATE_FREEZE_R2.md` under the amended component-level
claims CL-1..CL-4 (`docs/planning/v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md`). This file is the
ONLY public artifact of the hidden pack: it carries probe categories, counts and verdict
distribution. Case content, payloads and driver code stay private (workspace `_tmp`,
outside the repository) per the T19 contract.

## Verdict

**HIDDEN_VALIDATION=PASS** — 12 adversarial probes / 48 cases; **0 ESCAPED**;
46 BLOCKED-CAUGHT; 2 OBSERVED-BOUNDARY (sanitized notes below). No defect escaped the
declared security semantics at composition level.

## Probe categories and verdict distribution

| # | Adversarial category | Cases | BLOCKED-CAUGHT | ESCAPED | BOUNDARY |
| --- | --- | --- | --- | --- | --- |
| 1 | Intent payload smuggling against the no-widening gate (unknown fields, raw locators, root traversal, relative handles) | 5 | 5 | 0 | 0 |
| 2 | TargetRef handle forgery; registry-only resolution (unregistered handles, locator-shaped handles at seed/injection/gate) | 4 | 4 | 0 | 0 |
| 3 | Duplicate-occurrence and forged replay semantics (divergent-payload replay, fresh occurrence id on a settled request, replay across restart) | 4 | 4 | 0 | 0 |
| 4 | Durable journal / permit document tampering (settled-status rewrite, permit deletion, store corruption) | 3 | 3 | 0 | 0 |
| 5 | Permit-less and route-less dispatch admission | 4 | 4 | 0 | 0 |
| 6 | Cancellation followed by resubmission (no automatic redownload) | 3 | 2 | 0 | 1 |
| 7 | Digest / declared-size divergence (byte swap, truncation, declared-size lie, un-anchored intent) | 4 | 4 | 0 | 0 |
| 8 | Transfer-budget exhaustion and bypass | 4 | 3 | 0 | 1 |
| 9 | S-lane ambiguity silent selection and advisory authority promotion (ties, contestation, grant-shaped hints, super-suggestive certainty) | 4 | 4 | 0 | 0 |
| 10 | Out-of-set member injection and confirmation widening | 4 | 4 | 0 | 0 |
| 11 | Lineage authority partition (CL-4: default ownership, partition inversion both ways, cross-writer conflict, legacy immutability, stale re-claim authorization) | 7 | 7 | 0 | 0 |
| 12 | Sealed composition identity and route vocabulary (deterministic seals, byte-tamper detection, rogue route vocabulary, advisory-as-intent) | 4 | 4 | 0 | 0 |
| | **Total** | **48** | **46** | **0** | **2** |

Sanitized boundary observations (not escapes; recorded for honesty):

- Category 6: a fresh occurrence id on an already-settled confirmed request settles as a
  typed non-completed failure with zero new transfer — the request-scoped effect identity
  forbids a second grant; no automatic redownload exists in any probed path.
- Category 8: the transfer budget is enforced as a chunk-granular stop-work boundary
  (documented engine semantics), not a per-byte hard cap: a body that ends exactly at the
  boundary may complete with an overshoot bounded by one body chunk, while mid-stream
  bodies stop exactly at the boundary and the next preflight refuses once the ledger is
  over-committed (consumption truth stays exact throughout).

## ESCAPED defects

None.

## Execution environment facts

- Candidate under test: `version/v0.2.0@bca81e2`. Executed on worktree branch
  `task/v02-t19` at `a58df27` — verified code-identical to the freeze candidate
  (0 diff lines across `packages/`, `apps/`, `tests/`, `build/`, lock/manifest files;
  the delta is the freeze-record document only).
- Host: Windows (win32), Node v24.21.0 run with `--experimental-transform-types`;
  workspace dependencies exactly as installed for the candidate (untouched; candidate
  sources read-only for the validator).
- Harness: validator-authored driver, entirely private (workspace `_tmp`, outside the
  repository, never committed). All probes drive the PUBLIC facades only
  (`@xdownload/download-domain-app` package entry; `@xdownload/download-domain-host`
  `/direct` face) over a validator-owned bounded 127.0.0.1 loopback fixture on ephemeral
  ports, with per-probe isolated temp output roots and durable K stores (including
  real stop/reopen restart legs).
- Evidence discipline: real per-probe process exit codes (0 = caught-only, non-zero =
  escape or crash); final full-pack run: 12/12 probes EXIT=0. Per-probe logs and an
  events stream are retained in the private evidence directory (not published).
- Scope note: composition-level claims only (CL-1..CL-4); installed CLI/browser surfaces
  and human sessions are out of claims per the amendment and were not probed.
