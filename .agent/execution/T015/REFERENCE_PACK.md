# T015 L3 Reference Pack — authoritative Core runtime integration

Task: `T015` / Issue `#34`  
Bound base: `version/v0.1.0@4d40a2a1c389f6de4f3ce916c113fe4055f5e197`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It pins no new Product/L2 module layout, no transport decision and no new dependency.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11` (root-pinned since T001), discovering `packages/*/test/**/*.test.ts`, Node environment.

Patterns to emulate for integration tests:

- compose the real runtime once per suite (or per case when isolation matters) against local fixtures: temp-dir SQLite (`LedgerConnection`), temp artifact dirs (`FilesystemArtifactStore`), loopback/in-process seam invocation (`transport-loopback` / direct `handleFrame`);
- simulate process death by serializing the durable fact log (`serializeFacts` / journal) and reopening (`CoreScheduler.reopenFromJson`, seam journal replay, `RecoveryService` classification) — never by faking recovered state;
- drive duplicate/cancel/restart/budget cases through the public seam and scheduler APIs only, as surfaces would;
- table-driven crash-window matrices (L2 §11: after reservation before dispatch, staged/partial bytes, after bytes before acceptance, around DB/FS finalization);
- assert projected tuples exactly (no prefix/substring matching of statuses);
- keep every test offline and deterministic: no real network, no browser, no real clock dependence (inject observations).

Reference: Vitest at exact tag `v4.1.11` (`https://github.com/vitest-dev/vitest/tree/v4.1.11`, MIT). Already selected by T001; T015 does not introduce it.

### 1.2 Oracle grounding already in-tree

`@xdownload/version-validation` (T003) ships the C01–C34 oracle corpus, corpora registries, journey definitions and gate instrumentation. Reuse its canonical fixtures/corpus records where a focused test needs a frozen counterexample shape; do not fork its vocabularies, and do not claim its gates.

## 2. Contract / interface references (read these files first)

| Composition question | Authoritative source on base |
| --- | --- |
| Command/query admission, idempotency, peer scope, journal replay | `packages/core-seam/src/{server,client,state,envelope,bounds,peer,transport,transport-loopback}.ts` |
| Dispatch/cancel/resume/reconcile, cutoff, budgets, fact log shape | `packages/core-scheduler/src/{scheduler,cutoff,budgets,machine,facts,store,rejections}.ts` |
| Durable writer inputs, acceptance gate, artifact staging, recovery classes | `packages/persistence-ledger/src/{writer,reader,recovery,connection,artifact-store,rows,migrations,version}.ts` |
| Canonical vocabulary, ports, evidence/validation/coverage/projector | `packages/domain-contracts/src/{ports,contract,snapshot,result,evidence,validation-record,coverage-accounting,result-projector,budget,scope,ids,decode}.ts` |
| Direct HTTP execution + validate chain + projection | `packages/direct-acquisition/src/{direct-http-adapter,port,integrity,identity,projection}.ts` |
| HLS VOD pipeline | `packages/hls-vod-adapter/src/pipeline.ts` and its stages (`playlist,bind,topology,plan,budget,acquire,assemble,validate,request`) |
| Frozen semantics being composed | Frozen PRD §§15–18, §28; Frozen L2 §6.1/§6.5/§6.8, §10–§12, ADR-001/003/004/006/009/010/013 |

Type-level rule: composition code must bind to the exported public APIs above; reaching into package internals (non-exported modules) is forbidden. Where a needed type is not exported, that is a `CONSUMED_API_GAP` escalation, not a reason to deep-import or patch.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Runtime as composition root, not domain layer

The new package should be a thin composition root: construct/own the seam server, scheduler, ledger writer/connection/store, adapters and projector; wire outcomes between them via canonical types; expose a lifecycle (start/reopen/stop) and nothing else. All domain behavior already exists upstream — if logic starts accumulating in the runtime package, that is a drift signal.

### 3.2 One durable-truth spine

Recommended binding:

```text
CoreSeamServer(journal ← persisted seam journal)
CoreScheduler(DurableControlFactLog ← durable log store)
AuthoritativeLedgerWriter(LedgerConnection ← temp/test SQLite, FilesystemArtifactStore ← dir)
adapters ← TransferBudgetLedgerPort ← BudgetLedger (scheduler-owned)
```

For focused in-memory cases `InMemoryControlFactLog` is acceptable; restart suites must exercise the durable path.

### 3.3 Port-level substitutes for absent lanes

T016/T017 lanes are absent by design. Where the runtime needs a surface or browser fact, define/accept it at the existing canonical port boundary and substitute deterministic test doubles inside tests. Substitutes may inject facts (e.g. an authorization-failed terminal for C24) but must never grant authority or decide outcomes.

### 3.4 Restart is reopen, not migration

Compose restart as: read ledger → classify via `RecoveryService` → reopen scheduler from durable fact log → replay/verify seam journal → resume lineages with inherited budgets. Any impulse to "fix up" state during reopen is a semantics drift and fails review.

### 3.5 Fail closed at every composition boundary

Malformed seam frames, unknown contract versions, corrupt fact logs, digest mismatches, unsupported HLS topologies: each upstream package already fails closed — glue must not catch-and-normalize those failures into softer outcomes. Propagate typed rejections; classify crash divergence via `RecoveryService` instead of inventing repair heuristics.

## 4. Failure handling patterns

- `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` / `EXECUTION_PACK_INVALID` / `CONSUMED_API_GAP`: see EXECUTION_CONTRACT.md escalation section; stop, do not local-redesign.
- Flaky/undeterministic integration behavior: treat as a product defect or test defect — never mask with retries/timeouts in glue.
- Partial failure between DB and FS: DB-first/FS-first classification is `RecoveryService`-owned; glue only surfaces its classification.

## 5. Examples / docs mapping to T015 acceptance

| Acceptance concern (Frozen Task Pack) | Reference pattern | Required T015 proof |
| --- | --- | --- |
| command→schedule→transfer/media→validate→persist→project | composition root over §2 seams | focused-core-integration suite |
| process restart | reopen composition (3.4) + crash-window matrix | process-restart suite |
| duplicate submit | seam idempotency + scheduler lineage keys | duplicate-command suite |
| cancellation cutoff | ADR-013 / `acceptanceCutoff` / §11.1 projection | cancellation-cutoff suite |
| budget exhaustion | three domains, precedence §15.4, ledger port | budgets suite |
| missing/corrupt artifact negatives | `AcceptanceValidation` + `RecoveryService` | transfer-and-media + negative coverage |
| projection truth | result-projector exclusivity via seam READ_PROJECTION | projection suite |

## 6. Dependency/version/license facts

| Package | Version on base | License | T015 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict composition typing (pre-existing) |
| `vitest` | `4.1.11` | MIT | integration test runner (pre-existing) |
| workspace packages | `0.0.0` (internal) | repository | the composed seams themselves |

No new runtime dependency is recommended or pinned by this Reference Pack. Composition is workspace-internal. Any justified addition follows the F1 recording rule (exact name/version/license/provenance in the implementation PR).

## 7. Do / Don't

### Do

- compose through public exported APIs only;
- keep the runtime package thin: lifecycle + wiring + tests;
- prove restart/duplicate/cancel/budget behavior through public surfaces;
- propagate upstream fail-closed rejections verbatim;
- substitute absent lanes at canonical ports with deterministic test doubles;
- leave T016/T017 seams documented and open.

### Don't

- don't fork or re-declare any canonical type, status, budget or evidence concept;
- don't write durable state anywhere but the authoritative writer;
- don't decide terminal/acceptance/cancellation outcomes in glue;
- don't treat restart as replenishment, re-enumeration or successor identity;
- don't deep-import package internals or patch upstream sources to fit;
- don't pull browser/collection workflow, surfaces or AI into this lane;
- don't claim version Validation, Candidate Freeze or platform readiness from concern evidence.

## 8. Reuse / license risk

Low: everything consumed is in-tree workspace code or pre-existing MIT/Apache-2.0 toolchain. Do not copy external runtime/scheduler/persistence implementations into the runtime package; the merged packages already embody the reviewed semantics.

## 9. Validation boundary

This Reference Pack does not prove T015. The later Builder produces an exact candidate; T015 concern Validation must execute the `TEST_MATRIX.yaml` suites on that exact candidate; Fresh Independent Review is separately required because this task is `risk:critical` and `review:required`. Version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
