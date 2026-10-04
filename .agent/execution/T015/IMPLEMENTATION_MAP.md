# T015 Implementation Map — exact base `4d40a2a1c389f6de4f3ce916c113fe4055f5e197`

This map records seams that exist on the exact integration base (tree `1fdb53447a84492b8d4dba051fc0846b3b0f8549`) and how the authoritative Core Runtime composes them. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Package inventory observed on the exact base

| Package (pnpm name) | Origin task | Public src surface (as merged) | T015 disposition |
| --- | --- | --- | --- |
| `@xdownload/domain-contracts` | T002 (+T007 additive) | `budget, contract, coverage-accounting, decode, diagnostics, evidence, ids, ledger, ports, result-projector, result, scope, slices, snapshot, validation-record, version` | Consume as-is: the only canonical vocabulary. Terminal truth via `result-projector`; ports (`ports.ts`) are the composition points. |
| `@xdownload/core-seam` | T004 | `createCoreSeamServer(CoreSeamServerOptions{expectedPeer, journal?})` → `CoreSeamServer{handleFrame, recordFailedMembers, inspectProjection, acceptedCommandCount}`; `createSeamClient(SeamClientOptions)`; `projectAggregate`; `envelope/bounds/peer/state/transport/transport-loopback/diagnostics/ids` | Consume as-is: the single command/query authority boundary and restart-replay journal seam. |
| `@xdownload/core-scheduler` | T006 | `CoreScheduler(log: DurableControlFactLog)` with `submitLineage/cancel/resumeLineage/reconcile` and `static reopenFromJson / overEmptyLog`; `acceptanceCutoff`; `BudgetLedger`; `controlTransition/effectiveCancellation/cutoffDecisionFor`; `InMemoryControlFactLog`; `controlOk/controlReject/ControlResult`; `decodeFactLog/serializeFacts` | Consume as-is: the control layer. Budget consumption is unconstructible outside its single authoritative mutation path by design. |
| `@xdownload/persistence-ledger` | T005 | `AuthoritativeLedgerWriter(connection, store)` with `SubmitAcquisitionInput/DispatchInput/StageArtifactInput/AcceptArtifactInput` (+ `AcceptanceValidation` gate); `LedgerConnection/LedgerDatabase`; `FilesystemArtifactStore` (digest/provenance-bound); `LedgerReader`; `RecoveryService(deps)` DB-first/FS-first classification; `MIGRATION_STEPS`, `CURRENT_SCHEMA_VERSION`, `DURABILITY_CLAIM` | Consume as-is: the only durable state authority (single writer). Recovery composes with scheduler reopen. |
| `@xdownload/direct-acquisition` | T008 | `DirectHttpAdapter(ledger: TransferBudgetLedgerPort)`; `port.ts` types (`DirectTransferRequest/Outcome/Slice`, `PartialTransferState`, `ResumeDecision`, `MediaPolicy`, `TransferBudgetLedgerPort`); `validateTransfer/validateFormat/validateMedia/validateTarget`; `projectOutcome`; `planResume/observeIdentity/classifyRangeResponse` | Consume as-is: S1/S3 execution adapter behind the canonical acquisition port. |
| `@xdownload/hls-vod-adapter` | T009 | `playlist, bind, topology, plan, budget, acquire, assemble, validate, request, pipeline` (bounded decode → immutable manifest/rendition binding → provenance-bound segment plan → budgeted acquire → assembly via tooling port → validation chain → canonical emission; unsupported topologies fail closed) | Consume as-is: S4 execution adapter behind the same acquisition port. |
| `@xdownload/browser-observation` | T010 | untrusted-input gate, provenance-bound observations, handoff into canonical vocabulary, sink redaction (pure) | Reference as port types only; workflow integration is T016. |
| `@xdownload/browser-auth-broker` | T010 | native host/broker, `allowed_origins`, expiring scoped capabilities, secret zone (pure semantics; stdio loop only I/O) | Reference as port types only; workflow integration is T016. |
| `@xdownload/discovery-recipe` | T011 | recipe engine, bounded discovery, collection/member identity, continuation admission, selection/confirmation (pure decision logic) | Reference as port types only; collection workflow integration is T016. |
| `@xdownload/version-validation` | T003 | corpora registries, C01–C34 oracle corpus, `G0BaselinePlan`, journey harnesses CJ-01..CJ-09, G0/G1 gate instrumentation, evidence capture | Consume as-is for focused-integration oracle grounding where useful; concerns remain T003-owned. |
| `@xdownload/toolchain-smoke`, `@xdownload/toolchain-smoke-core` | T001 | toolchain smoke packages | Outside T015 concern. |
| `apps/browser-extension` | T010 | manifest + service worker + content observer (privileged boundary consumes browser-observation) | Outside T015; real-browser path is T016. |

## Existing repository seams

| Exact current path | Exact-base fact | T015 use / constraint |
| --- | --- | --- |
| `package.json` / `pnpm-workspace.yaml` | pnpm monorepo admitting `packages/*` and `apps/*`; Node `24.x` per `.nvmrc`; toolchain from T001 | New runtime integration package belongs under `packages/*`. Wiring edits narrowly necessary only. `apps/*` is out of T015. |
| `tsconfig.json` / `vitest.config.ts` | strict TS incl. `packages/*/src|test`; Vitest discovers `packages/*/test/**/*.test.ts` | Runtime source/tests must fit existing include patterns; focused integration tests are package-local and must run in the Node environment without real browser/network (loopback/local fixtures only). |
| `packages/core-seam` transport | transport-neutral `handleFrame` port + loopback transport; `CoreSeamServerOptions.journal` enables restart replay (production durability port is T005) | Compose the runtime's command/query entry here. Loopback or in-process invocation is acceptable for v0.1.0 concern; no new wire protocol. |
| `packages/core-scheduler` store | `DurableControlFactLog` is pluggable (`InMemoryControlFactLog`, JSON serialize/reopen) | Bind the scheduler's fact log durably through the persistence seam for restart cases; correctness must derive from durable facts, not process memory. |
| `packages/persistence-ledger` writer/reader | one `AuthoritativeLedgerWriter` per DB + artifact store; `AcceptanceValidation` gates artifact acceptance; `RecoveryService` classifies DB/FS divergence | The runtime instantiates exactly one writer path; acceptance of artifacts flows through `acceptArtifact` with validation results from the adapters' validate chains. |
| `packages/domain-contracts` ports | stable adapter-facing ports (T002 §7 of contract; `ports.ts`) extended by T007 projector | The runtime translates adapter outcomes → canonical effects/evidence → projection; it must not fork status/evidence types. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics | Read-only authority (§15 budgets, §16 result model, §17/§18 accounting/legal combinations, §28 S1–S6). |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: §6.1 Alternative C (one authoritative Core Control Runtime + adapters), §10 ownership table, §11 failure/restart/cancellation semantics, ADR-001/003/004/006/009/010/013. |
| `.agent/execution/T015/` | this JIT pack | Guidance/evidence only; never product source. |

## Composition topology the runtime must realize (non-authoritative sketch)

```text
surfaces (later: T016 browser / T017 Desktop+CLI)      # NOT wired by T015
        │ (same seam contract; loopback/in-process for focused tests)
        ▼
createCoreSeamServer(expectedPeer, journal)            # @xdownload/core-seam
        │ accepted idempotent commands only
        ▼
CoreScheduler(DurableControlFactLog)                   # @xdownload/core-scheduler
        │ dispatch grants / cutoff decisions / cancel & resume orders
        ├────────────► AuthoritativeLedgerWriter       # @xdownload/persistence-ledger
        │                ├─ LedgerConnection (SQLite, migrations)
        │                └─ FilesystemArtifactStore (digest/provenance)
        ▼
acquisition port (domain-contracts ports)
        ├─ DirectHttpAdapter          # @xdownload/direct-acquisition (S1/S3)
        └─ HLS VOD pipeline           # @xdownload/hls-vod-adapter (S4)
        │ outcomes → validate chain (transfer/format/media/target)
        ▼
typed Evidence / ValidationRecord / CoverageAccounting # domain-contracts (T007 layer)
        ▼
result-projector → terminal multidimensional result    # domain-contracts result-projector
        ▲
        └── LedgerReader / RecoveryService on restart  # DB-first/FS-first + scheduler reopen + journal replay
```

Single-writer rule: exactly one `AuthoritativeLedgerWriter` and one scheduler fact-log mutation path exist in the composed runtime. No adapter, projection, or test helper writes durable state otherwise.

## What stays a port on this base (deliberate T015 absences)

- No real transport server (socket/IPC) binding: seam remains transport-neutral (ADR-012); loopback/in-process is in-scope for the concern.
- No browser/native/broker workflow: T016 owns the cross-boundary handoff and S2/S5/S6.
- No Desktop/CLI apps and no AI adapter: T017.
- No model-provider adapter, no packaging/installer: T012/T018 lanes.
- No crawler/frontier: frozen out by D5 everywhere.

These absences are not gaps T015 may fill "while it is there".

## Dependency decision seam

The exact base has no new runtime dependency needs for composition (all composition is workspace-internal). If the Builder finds a narrowly justified new dependency (e.g. a deterministic temp-file helper), it is an F1 choice requiring exact package/version/license/provenance recording, and it must not imply any new Product/L2 authority.

## Expected test placement seam

Focused integration tests live in the new runtime package under `packages/*/test/**/*.test.ts`, exercising the composed runtime in-process: seam frames → scheduler → adapters (loopback HTTP/local files) → ledger (temp SQLite dir) → projector. All suites must be deterministic, offline, and map to `TEST_MATRIX.yaml` ids.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T015 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`d176b357b7278b229091ee2e3d624b0ff691802d`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`, checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission;
- T016/T017 have not merged anything that redefines the seams this pack composes (they depend on T015, so this is expected to hold).
