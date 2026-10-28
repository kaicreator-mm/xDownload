# xDownload v0.2.0 — Candidate Task Packs (ADS v4.18)

STATUS=PLANNED_NOT_FROZEN
WORK_ITEM=#188
PROJECT_PRODUCT=docs/planning/v0.2.0/PRODUCT_R0.md (NOT_FROZEN)
PROJECT_L2=docs/architecture/v0.2.0/L2_R0.md (NOT_FROZEN)
SCaffold=docs/planning/v0.2.0/SCAFFOLD_R0.md (NOT_ACCEPTED_SOURCE)
PLANNING_DAG=docs/implementation/v0.2.0/TASK_DAG_R0.md
FUTURE_INTEGRATION_TARGET=version/v0.2.0 (NOT_CREATED)
SDK=v0.10.3 frozen contract only; exact current SDK package proof at JIT

These are durable **planning candidates** only, not issued implementation Claims, Execution Packs, release gate results or Task IDs mapped to canonical GitHub Issues. They become executable only after accepted Product/L2, scaffold/source authority, DAG Review/Freeze, Task Issue+native dependency materialization and current valid Claim. JIT baselines must be re-read; historical v0.1 research SHA does NOT authorize source writes.

## Common contract / failure disposition

- Immutable inputs: selected exact ADS 4.18.0 pin, qualified v0.2 Product and L2 freezes once they exist, real current integration SHA and Task Issue, selected real DomainHarness v0.10.3 public SDK candidate. No v0.10.2 downgrade.
- Every Task must expose tests, contract, expected outcome, refusal, and what was NOT proven; independent Review required for risky public contract, security, Host effects, shared state and migration per table.
- Scope is additive: each Task may write only its unique paths. All unlisted paths, v0.1 frozen Product/L2/DAG, v0.1 version/main, old engine implementations and sibling-owned files are forbidden.
- Runtime/API/Effect/secret/physical operations remain behind the selected K and trusted Host. A fake test Host cannot establish a physical validation gate.
- No version Task Issue may be called READY without native blocked_by readback and accepted JIT Builder Claim. A draft PR, prose permission, one GitHub account, role claim or planned lane does not grant writes.
- Failed SDK seam/UNKNOWN triggers fail-closed and a narrow #183 or downstream SDK gap; do not expand Task/Product scope. RQ/Release is not an implementation Task PASS.

## Individual coherent Task Pack contracts

### T01 — Canonical K/B/C domain intent and operation contract

- **Lane:** contracts; **Depends on:** NONE; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/src/contracts/**; narrowly approved additive packages/domain-contracts/src/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** public SDK DTO compile; scope/authorization/secret rejection; no duplicate contract authority.
- **Candidate Builder:** Strong TypeScript contract Builder.
- **Required real Validation/handoff:** exact accepted Product/L2 and SDK ABI pin, deterministic schema/negative proof.
- **Forbidden/negative:** No runtime K authority, no package manifest/lockfile.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T02 — Selected B/K admission, confirmation, governed Effect and truthful status

- **Lane:** business; **Depends on:** T01; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/src/business/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** permitted external effect versus permitless zero dispatch, no LLM grant, accepted is not file completion.
- **Candidate Builder:** Strong K/domain Builder.
- **Required real Validation/handoff:** real selected K/BUILD consumer, Node24; Review of Effect/UNKNOWN.
- **Forbidden/negative:** No new Kernel implementation or Host code.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T03 — Direct acquisition C/Host bridge with budgets and verified file acceptance

- **Lane:** direct-host; **Depends on:** T01; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-host/src/direct/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** existing DirectHttpAdapter call only after K permit, single budget truth, digest-backed bytes, rejected URL/path and zero-network negatives.
- **Candidate Builder:** Node24/Windows Host Builder.
- **Required real Validation/handoff:** real Host/fixture, exact package bytes and budget/identity logs.
- **Forbidden/negative:** No new fetch engine, hidden auto-retry or secondary ledger.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T04 — Deterministic recipe/selection S and bounded optional advisory

- **Lane:** semantic; **Depends on:** T01; **Risk:** medium; **Independent Review:** recommended.
- **Allowed exclusive write set:** `packages/download-domain-app/src/semantic/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** finite discovery scope, deterministic no-LLM path, ambiguous result triggers confirmation, advisory never self-grants.
- **Candidate Builder:** Recipe/domain Builder.
- **Required real Validation/handoff:** fixture/source proof; optional provider tests only by separate authorization.
- **Forbidden/negative:** No universal crawler or paid model prerequisite.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T05 — Existing HLS media C/Host adapter

- **Lane:** media-host; **Depends on:** T01; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-host/src/media/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** supported HLS only, no new broad protocol claims, permission and budget negative cases.
- **Candidate Builder:** Media/Host Builder.
- **Required real Validation/handoff:** real bounded media fixture/FFmpeg only if used in existing implementation.
- **Forbidden/negative:** Do not modify existing HLS engine by default.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T06 — CLI adapter to one selected Domain App status and commands

- **Lane:** cli; **Depends on:** T01; **Risk:** medium; **Independent Review:** recommended.
- **Allowed exclusive write set:** `apps/cli/src/domain-app-*.ts (materialize exact paths at JIT)`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** real command→query/status, faithful UNKNOWN/FAILED, no private K internals exported.
- **Candidate Builder:** CLI TypeScript Builder.
- **Required real Validation/handoff:** Node24 CLI integration after central join, non-runtime source review may proceed earlier.
- **Forbidden/negative:** No new public REST gateway.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T07 — Browser/native-host bounded-authorization surface adapter

- **Lane:** browser; **Depends on:** T01; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `apps/browser-extension/src/domain-app/** (final exact files at JIT)`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** real authorized browser user action, no cookies/secrets to model and no scope widening, native Host check.
- **Candidate Builder:** Windows/browser security Builder.
- **Required real Validation/handoff:** Windows real browser/native session proof.
- **Forbidden/negative:** No automatic browser privilege expansion.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T08 — Single-authority old-Core / new-K lineage migration and rollback

- **Lane:** migration; **Depends on:** T01; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/src/migration/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** one writer per lineage; crash/restart and UNKNOWN; old-lineage v0.1 owner persists; rollback documented.
- **Candidate Builder:** Durability/concurrency Builder.
- **Required real Validation/handoff:** real SQLite/Host CAS, no mock admission passed off as authority.
- **Forbidden/negative:** No mass irreversible migration or dual business writers.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T09 — Independent regression fixtures, oracles and baseline preparation

- **Lane:** validation-harness; **Depends on:** T01; **Risk:** medium; **Independent Review:** recommended.
- **Allowed exclusive write set:** `tests/domain-app/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** S1-S6 released-slice baseline, honest failures, zero-network and recovery negative fixtures.
- **Candidate Builder:** Independent test/fixture Builder.
- **Required real Validation/handoff:** actual installed baseline tied to release SHA before final version Validation.
- **Forbidden/negative:** No fake human G0/G1 or synthetic acceptance.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T10 — One authoritative direct K→C/Host→file composition

- **Lane:** integration-direct; **Depends on:** T02,T03,T08; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/src/composition/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** Node24 selected K/S/B/C, real bytes and digest, exactly one K permit, no double journal, cancellation/recovery.
- **Candidate Builder:** Senior Integration Builder.
- **Required real Validation/handoff:** real SDK packed candidate and Host, full trace from intent to terminal.
- **Forbidden/negative:** No write to sibling B/Host/C sources without formal reassignment.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T11 — Non-direct S2-S6 and media/browser convergence

- **Lane:** integration-other; **Depends on:** T04,T05,T07,T10; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/src/integrations/**`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** each release-claimed installed journey connects existing adapters to K without widening collection/authorization.
- **Candidate Builder:** Senior Integration Builder.
- **Required real Validation/handoff:** physical browser/media/collection tests for applicable slices.
- **Forbidden/negative:** No unsupported sites or broadened crawl.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T12 — Single-writer BUILD manifest, exports, lockfile and packaged facade

- **Lane:** build-packaging; **Depends on:** T06,T10,T11; **Risk:** high; **Independent Review:** required.
- **Allowed exclusive write set:** `packages/download-domain-app/package.json, packages/download-domain-host/package.json, packages/download-domain-app/src/index.ts, packages/download-domain-app/README.md, build/**, root package.json, pnpm-lock.yaml (only if needed)`. Integration target when admitted: `version/v0.2.0`, Task branch created JIT, not now.
- **Inputs:** qualified Product/L2 and accepted Task DAG, canonical T01 interface after its merger, with only the listed genuine predecessors; actual exact SHA/SDK chosen at legal Claim.
- **Output/acceptance:** actual v0.10.3 packed SDK, sealed selected module hashes, clean install and actual package smoke; no duplicate package root.
- **Candidate Builder:** Node24/Woodpecker packaging Builder.
- **Required real Validation/handoff:** release candidate exact SHA, CI run/EXIT and Node24/Windows facts.
- **Forbidden/negative:** No SDK source rewrite or production auto-deploy.
- **Failure handling:** report P0/P1/P2 and actual command/EXIT if run; if unproven use NOT_RUN/BLOCKED; no upstream scope expansion, no implied merge authorization.
- **Status:** PLANNED; Canonical Issue # TBD; native blockers NOT_MATERIALIZED; no authorized source writer.

### T13 — Core crash/restart, UNKNOWN, integrity and durable replay Validation

- **Lane:** validation-core; **Depends on:** T09,T12; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/validation/v0.2.0/core/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Actual Node24/Windows source-bound K/Host, accepted file digest, fail-closed unknown/reconcile, no double grant; test commands and real EXIT.
- **Executor:** Independent Core Validator; independent of relevant implementation Builder.
- **Forbidden/negative:** No modification of implementation source or validated candidate.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T14 — Browser/native Host auth and security Validation

- **Lane:** validation-browser; **Depends on:** T12; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/validation/v0.2.0/browser/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Real Windows/Chromium trusted browser sessions, native Host confinement, secret/redaction/scope zero-execution negatives, file owner truth.
- **Executor:** Independent Browser Security Validator; independent of relevant implementation Builder.
- **Forbidden/negative:** No mocked browser sold as installed real proof.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T15 — Product critical journeys and G0/G1 parity Validation

- **Lane:** validation-product; **Depends on:** T12; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/validation/v0.2.0/product/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Installed user path for release-claimed S1–S6, product correctness/effort comparison where required, no false completion; current oracle/denominator.
- **Executor:** Independent Product Validator; independent of relevant implementation Builder.
- **Forbidden/negative:** No fabricated human measurements or unapproved value gate waivers.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T16 — Packed SDK and Windows/platform qualification Validation

- **Lane:** validation-platform; **Depends on:** T12; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/validation/v0.2.0/platform/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Clean packed v0.10.3 public SDK consumer with actual package bytes/hash, Node24 and claimed platform physical package smoke, reproducible exact candidate evidence.
- **Executor:** Independent Platform Validator; independent of relevant implementation Builder.
- **Forbidden/negative:** No inferred registry release from candidate manifest, no unrelated full platform matrix.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T17 — Candidate Freeze exact visible gate reconciliation

- **Lane:** candidate-freeze; **Depends on:** T13,T14,T15,T16; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/release/v0.2.0/candidate/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** All required visible Validation PASS and current on exactly one version candidate, correct tree/ref, freeze identity and no unresolved P0/P1.
- **Executor:** Candidate Freeze Controller; independent of relevant implementation Builder.
- **Forbidden/negative:** No freeze from mixed SHAs or incomplete platform/corpus.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T18 — Independent Hidden Validation on frozen candidate

- **Lane:** hidden-validation; **Depends on:** T17; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/release/v0.2.0/hidden-public-index/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Actual isolated hidden pack/environment/reviewer identity for frozen candidate, PASS/FAIL with privacy-preserving evidence pointers.
- **Executor:** Independent Hidden Validator; independent of relevant implementation Builder.
- **Forbidden/negative:** No private hidden pack content in public repo, no substitute public fixtures.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T19 — Version closure and evidence reconciliation

- **Lane:** version-closure; **Depends on:** T18; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/release/v0.2.0/closure/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Pinned closure checklist, issue/PR and candidate evidence currentness, migration/SDK baseline audit and truthful blockers.
- **Executor:** Version Closure Controller; independent of relevant implementation Builder.
- **Forbidden/negative:** No closed Issue count treated as version release acceptance.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T20 — Independent Release Qualification owner verdict

- **Lane:** release-qualification; **Depends on:** T19; **Risk:** high; **Review:** not-required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/release/v0.2.0/rq/**`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Real exact-SHA RQ READY/CONDITIONAL/BLOCKED/FAIL decision, explicit scope/limitations and main integration permission if READY.
- **Executor:** Independent Release Controller; independent of relevant implementation Builder.
- **Forbidden/negative:** No inferred qualification from task/CI/review results.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.


### T21 — Qualified mainline integration

- **Lane:** main-integration; **Depends on:** T20; **Risk:** high; **Review:** required. Gate owner decisions and independent Validator roles remain distinct.
- **Allowed exclusive evidence/write scope:** `docs/release/v0.2.0/integration/** (and protected repository merge authority only when allowed)`, version integration/candidate ref only when stage authority admits it.
- **Inputs:** accepted exact version candidate and current preceding gates, same SHA where required. No historical v0.1 or PoC substitution.
- **Output/acceptance and required physical evidence:** Only when T20 READY, exact version PR diff/base protection re-read, permitted merge and merged SHA/readback.
- **Executor:** Repository Integration Controller; independent of relevant implementation Builder.
- **Forbidden/negative:** No main merge before RQ, no new package tag inferred.
- **Failure handling:** real commands/EXIT/NOT_RUN, P0/P1/P2 if review applies; BLOCKED/FAIL not washed into PASS, no unapproved scope changes.
- **Status:** PLANNED; canonical Issue # TBD; native blocked_by NOT_MATERIALIZED; no authorized Claim.

## Source scaffold / Task DAG binding

SF-01→T01, SF-02→T02, SF-03→T03, SF-04→T04, SF-05→T05, SF-06→T06, SF-07→T07, SF-08→T08, SF-09→T09, SF-10→T10, SF-11→T11, SF-12→T12; T13–T16 are four independent validation owners; T17–T21 are distinct Candidate/Hidden/Closure/RQ/Integration controllers (no source Scaffold anchors).

Binding currently means **proposed path ownership**; no accepted Scaffold Git-object/mode inventory, real Task Issue binding, native Issue Dependency, DF blob freeze or independently recomputed MI digest exists. An actually accepted source-first Scaffold must be materialized in a separate current, lawful source-only Claim; then the Task-side immutable pair record is created *after* both SF and DF identities are fixed, never self-hashed.

## Handoff preconditions

1. Product/Scope R1 independent result + Product owner Freeze.
2. #183 real architecture-critical evidence U01/U02/U03 or formal L2 disposition, independent L2 review + owner Freeze.
3. Source Scaffold admitted and verified if early-source route is used; otherwise post-DAG scaffold Task; don't force early source.
4. Independent Task DAG review, formal DAG Freeze, actual GitHub Task Issues and native blocked_by write/readback.
5. Qualified JIT local task with explicit current source base/Task Pack/write set/Claim and execution profile; only then a pointer-only local Agent trigger.

PREPARATION_ONLY=YES
IMPLEMENTATION_NOT_STARTED=YES
