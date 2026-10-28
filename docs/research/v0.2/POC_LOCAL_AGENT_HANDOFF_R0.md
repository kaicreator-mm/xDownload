# xDownload DomainHarness v0.10.3 — local Research Demo execution handoff R0

**Status:** PREPARED / NOT ADMITTED / NOT EXECUTED. **Owner:** [xDownload #183](https://github.com/kaicreator-mm/xDownload/issues/183). **Architecture protocol:** `docs/research/v0.2/DOMAIN_APP_POC_PROTOCOL.md`. **Related:** ADS adoption #182/#192; conditional Product intake #184; v0.2 planning #188 and R2 #191.

This is a **research task pack**, not a full production implementation Task and not an authorized Dispatch. It is intentionally separate from the 22-item v0.2 candidate DAG, which cannot freeze until architectural unknowns U01/U02/U03 have valid disposition. The user-visible local Agent trigger must stay **pointer-only** to Issue #183 under ADS `ISSUE_FIRST_TASK_TRIGGER.md`.

## 0. Boundary and permitted execution conditions

1. Research subject: `version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2` is an **inspection baseline only**, not a branch for implementation. **Current independently qualified experiment execution base:** `experiment/ads-v418-poc@86bf394a36b78209f39b503b65d57ce1c7bcbecd`, after PR #195 was merged experiment-only under independent R1 #196 PASS. Never merge research PoC into v0.1 or main.
2. Future PoC worktree: create a JIT isolated `research/domain-app-poc-183` branch **only after** current qualified ADS experimental adoption and #183 has a current accepted `DISPATCH_CLAIMED` under ADS 4.18, with exact head/source and native dependency readback (or explicit proven none). The live work branch should inherit the qualified isolated ADS pin; use the exact source base recorded at Claim, not a moving tag and not unreviewed planning docs.
3. **Allowed source write set for an admitted #183 Research Builder only:** `experiments/domain-app-download/**`, plus `docs/research/v0.2/POC_RESULT_R0.md` and an explicitly linked sanitised run manifest if needed. All existing `packages/**`, `apps/**`, `build/**`, `tests/**`, `pnpm-lock.yaml`, `.dev-standard/**`, `version/v0.1.0` and `main` remain read-only. An exception needs a new independently reviewed scope decision before the change, never implicit permission.
4. Source must consume the **actual** existing direct-acquisition implementation and v0.10.3 public SDK. Building an external SDK candidate at exact source SHA is an authorized **local research validation prerequisite**, not permission to modify upstream or publish anything. No paid model call, secrets, arbitrary remote network/crawler, irreversible file migration, or unapproved Host privilege change.
5. Native GitHub Issue dependency capability missing or Claim UNKNOWN is `HOLD`, not fake READY. The controller may use a separately authorized local `gh` route to write/read canonical dependencies; a task-specific comment/prompt is not a substitute.

## 1. Real dependency identities

- xDownload inspected existing baseline: `195355d03b847825ce5acf78c73e06f7386e11e2`, as verified in #188 planning evidence. Re-check live exact SHA before checkout/claim.
- DomainHarness target **frozen Contract/L2 ABI v0.10.3 only**: initially selected source snapshot `7d571858bd6524ffd13a7985227183dbecb2924a`; final RQ/tag/package publication NOT assumed. The local Agent records actual selected SDK SHA, source tree and **packed public package byte SHA256**, plus Node version, OS and `pnpm/npm` info; do not silently use v0.10.2 or private SDK compiler APIs.
- Standard target ADS `4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7`. Review of isolated adoption PR #185 is #192, not yet PASS by this pack.

## 1A. Native Issue dependency and admission controller (before source)

A designated local GitHub controller with **GitHub CLI >=2.94.0** should use the documented native issue dependency readback, for example `gh issue view 183 -R kaicreator-mm/xDownload --json blockedBy,blocking`. Read the current Issue #183 body/classification, selected `type:research-demo`, `state:planned`, `review:required`, `risk:high`, all prior Claim/event history and current exact experimental branch SHA. The controller must reconcile any actual native blockers rather than equating an empty Markdown dependency line with a qualified edge. See ADS 4.18.0 `GITHUB_WORK_ITEM_CONTRACT_STANDARD.md` §§9–12 and `GITHUB_AGENT_INTERACTION_PROTOCOL.md` for serialized CAS Claim / accepted `DISPATCH_CLAIMED` authority. If a real accepted Claim cannot be established and independently read back, **STOP before editing `experiments/domain-app-download/**`**; record `CLAIM_NOT_PROVEN`, not `READY`.

Source work only starts after one current accepted Claim naming local Agent identity/session, Issue #183, exact experimental base and `experiments/domain-app-download/**` plus the sanitized result file. No source-first v0.2 Scaffold Task/DAG admission follows from this experimental research Claim.

## 2. Minimal local source structure *only if admitted*

```text
experiments/domain-app-download/
  README.md                      # what is tested and NOT proven
  package.json                   # clean Node24 consumer, no workspace-root replacement
  src/                           # small selected public BUILD producer, K/S/B/C and Host test driver
  tests/                         # P01 P02 N01-N07 and bounded fixtures
  scripts/                       # only if needed for reproducible pack/clean install
```

Use existing xDownload `DirectHttpAdapter` behind a **real selected K Permit→C/Host gate**; its existing `TransferBudgetLedgerPort` is not a grant by itself. The experiment must either demonstrate how one K owner can safely compose budgets/replay without old Core granting the same effect, or report `U01/U02=BLOCKED`. Never invent a second private authoritative ledger or clear unknown journals to force a green test.

## 3. Finite acceptance matrix and abort cases

| ID | Test | Required independent evidence |
| --- | --- | --- |
| E01 | Node24 clean public v0.10.3 SDK package pack/install, BUILD selecting exactly one K and declared S/B/C, load/send/query/subscribe | exact module ID/hash, source and package bytes, commands and EXIT |
| P01 | approved fixed local/HTTPS fixture → K admission → real Host/direct transfer → validated materialized file → terminal query | actual bytes/file SHA256, K journal/effect trace and result |
| P02 | no configured LLM provider | same deterministic functionality, zero paid calls |
| N01 | absent/stale K Permit or unselected C | zero network/file effect; actual counters |
| N02 | target/output path/redirect host changes outside confirmed scope | refusal without side effect |
| N03 | duplicate request/effect/accepted file | one accepted artifact and idempotent/blocked duplicate |
| N04 | post-send timeout/cancel/restart | truthful UNKNOWN and authorised reconciliation, no automatic redownload |
| N05 | tampered K receipt/journal/fence/identity | fail-closed, no journal clearing |
| N06 | legacy Core and K both claim authority for same lineage | reject duplicate writer or explicit independently verifiable partition proof |
| N07 | altered/unselected source module import or BUILD hash | failed activation before external effect |
| M01 | old direct path vs K-orchestrated path, same bounded fixture and host | wall clock/memory/cost as measured; UNKNOWN if not measurable |

**Stop** on absent public v0.10.3 ABI, unsafe Host/effect admission, budget writer conflict, no reliable cancellation/replay, or elevated scope. Do not enlarge demo into production migration. Escalate a minimal reproducible, sanitized SDK gap to `kaicreator-mm/domain-harness` only when an actual SDK gap is demonstrated; otherwise return concrete `BLOCKED`.

## 4. Accepted result, Review and the next stage

- A local Builder publishes one **reviewable research PR**, exact source/SDK/package hashes, positive/negative test results with command and EXIT, and a `POC_RESULT_R0.md` distinguishing what was actually proven from remaining U01/U02/U03 UNKNOWN. Do not self-mark PASS.
- Independent exact-SHA reviewer produces P0/P1/P2, `DOMAIN_APP_POC=PASS|FAIL|BLOCKED|NOT_RUN`, `SDK_GAP=YES|NO|UNKNOWN`, old/new lineage and budget owner verdict, compatibility/cost findings.
- Only a qualified PASS or lawful non-contradictory Architecture disposition may feed the separately reviewed Product/L2 Freeze; then T01/T02 and other v0.2 Task Issues can be formally admitted after DAG Freeze/native Issue dependency readback and current JIT Claims.
- No PoC result, even PASS, changes v0.1 release gates.

**Current gates:** `ADS_ADOPTION_R1_192=PASS_EXPERIMENT_ONLY`, `OVERRIDE_R1_196=PASS`, `OVERRIDE_PR_195=MERGED_TO_EXPERIMENT_AT_86bf394a36b78209f39b503b65d57ce1c7bcbecd`, `NATIVE_BLOCKED_BY=NOT_READ_BACK`, `BUILDER_CLAIM=NONE`, `POC_SOURCE=NOT_STARTED`, `NODE24_EVIDENCE=NOT_RUN`, `DOMAIN_APP_POC=NOT_RUN`.
