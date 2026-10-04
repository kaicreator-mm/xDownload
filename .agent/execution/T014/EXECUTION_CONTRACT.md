# T014 Execution Contract — Desktop UI thin presentation/interaction adapter

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #33, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T014` / Issue `#33`
- Integration base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`
- Base tree: `e9acfb8020befa669a87f074a6789f754d9ca81e`
- JIT branch: `task/v0.1.0-t014-desktop-ui-adapter`
- Dependency completion: `T004/#23` closed `state:done`, merge commit `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2`; `T007/#26` closed `state:done`, merge commit `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T014_desktop-ui-adapter.md@848be622d379f55dc3f42c8dc10e53d0826fe177`
- Agent freedom: `F2_ENGINEERING_DISCRETION`
- Review: `recommended`; risk: `medium`; L3: `recommended`

## Owned write boundary

T014 owns only the Desktop presentation surface: presentation/interaction adapter for intent entry, scope preview/confirmation, selection, progress/status, cancellation/retry and truthful result explanation; interaction state that is non-authoritative; Core client wiring abstractions; and UI component/interaction tests.

The exact base is a TypeScript/pnpm monorepo. `pnpm-workspace.yaml` admits `packages/*` and `apps/*`; `tsconfig.json` already includes `apps/*/src/**/*.ts`; `apps/` does not exist yet. Frozen L2 §8 assigns Desktop to `apps/desktop/  # presentation adapter`, and L2 U9/ADR-012 deliberately leave the concrete desktop shell/framework/IPC unfrozen. Under `F2_ENGINEERING_DISCRETION` the Builder may create the minimal `apps/*` surface (or a `packages/*` presentation package) needed for T014, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that surface and its tests (for example extending the vitest include set, which currently discovers only `packages/*/test/**/*.test.ts`).

### Forbidden scope

Do not implement or redesign:

- UI-owned contract/snapshot/budget/result truth; per-surface status derivation (L2 §7 Result: central projector only);
- silent selection or scope change; in-place scope expansion/refresh after confirmation;
- item-by-item confirmation where one batch/manual selection surface resolves the same ambiguity (PRD §13; C30);
- scheduler/concurrency/budget-ledger, persistence/recovery, discovery/Recipe engines, transfer/media adapters, browser extension/broker, packaging/installer/updater/platform qualification;
- authorization decisions or raw-secret storage in UI state;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T014 Task Pack to make implementation easier. Close with UI tests, not release UX claims; no desktop framework/platform/support claim is made or proven by T014.

## Required outputs

The implementation must provide one thin Desktop adapter that consumes Core-owned state exclusively through the existing seams. At minimum it must:

1. Intent entry: collect user intent and submit it as an idempotent command envelope through `@xdownload/core-seam` with a `DESKTOP_UI` peer identity. No contract truth is constructed UI-side.
2. Scope preview/confirmation: render `ContractProjectionView`/`SnapshotProjectionView` read-only projections. Confirmed `requested_scope`, continuation scope and coverage target are displayed as immutable; "Load more"/"Refresh"/"Continue"/any expansion interaction routes a successor-identity command and never mutates the confirmed display in place.
3. Selection/confirmation flow: render and drive the confirmation plan levels produced by `@xdownload/discovery-recipe` (`SCOPE_LEVEL` → one `BATCH_GROUP` → at most `MAX_MATERIAL_ITEM_CONFIRMATIONS` `MATERIAL_ITEM` items → `MANUAL_SELECTION_UI`), routed as Core commands. The surface must not re-derive, reorder or bypass the interaction-priority policy (PRD §13, C30/C31/C34).
4. Progress/status and result explanation: read seam projections only. Multi-dimensional terminal results (`ProjectedTerminalResult`) are displayed verbatim — Request Fulfillment, Target Resolution, Selection Acquisition, Coverage, Stop Reason and Validation Summary — including truthful PARTIAL/UNKNOWN/TRUNCATED/UNSATISFIED states and unsupported/out-of-scope visibility (C02/C10/C14/C15/C23/C24). No single success boolean; no UI-derived completion.
5. Cancellation/retry routing: submit cancellation/retry as Core control transitions through the seam and reflect resulting projections; no surface-local precedence, no local timeout-cancel, no local "recovery wins" rule (L2 invariant 20; C12/C13).
6. Core-disconnect behavior: when the seam client cannot reach Core, present an explicit degraded/disconnected state with no fabricated status/progress, and re-sync from projections on reconnect (`SeamClient` reconnect semantics). UI-local durable truth is forbidden.
7. Auth/action prompts: surface authorization-required/blocked/action-required states originating from Core statuses; the UI collects no raw reusable secrets into ordinary state (opaque authorization context only; C10/C24).
8. UI tests: deterministic component/interaction tests covering the acceptance list — immutable confirmed scope, batch selection, auth/action prompts, cancellation/retry routing, partial/unknown result explanation and Core-disconnect behavior.

## Required invariants / invalid states

The adapter must fail closed / refuse to present at least:

- UI interaction state presented or persisted as authoritative contract/snapshot/budget/result truth;
- confirmed scope/selection edited, narrowed, enlarged or silently re-selected UI-side without a Core-accepted successor transition;
- per-item interrogation beyond the bounded material-item level while a batch/manual surface resolves the same ambiguity;
- fabricated progress/status/completion while Core is disconnected or a projection is stale/unparseable;
- a terminal result collapsed to one success boolean, or unsupported/out-of-scope silently approximated as supported;
- confirmation presented as proving target quality/membership truth rather than selection only (C26/C27/C34);
- raw reusable credentials displayed or stored as ordinary UI state.

## F2 implementation choices left open

The Builder may choose, inside the frozen semantics:

- desktop shell/framework/runtime and internal component/state architecture (unfrozen by U9/ADR-012; bounded implementation detail);
- `apps/desktop` package naming/layout or an alternative `packages/*` presentation-package placement;
- interaction-test harness additions (e.g. DOM-simulating environment or framework renderer) with exact package/version/license recorded;
- UI styling, layout and localization details.

These choices must not weaken or reinterpret thin-surface authority, confirmation-priority policy, immutable-scope display or truthful-result semantics, and must not introduce release/packaging/platform claims.

## Verification commands available on the exact base

The T001 toolchain provides the durable root gates:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

`tsconfig.json` already includes `apps/*/src/**/*.ts`; `vitest.config.ts` currently discovers only `packages/*/test/**/*.test.ts`, so any Desktop UI test seam requires the narrowly necessary config wiring described above. T014 concern Validation is separate from this prep task and must additionally prove the T014 test matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation. Version-level visible Validation is owned by T020–T023 on the exact T019 candidate.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T014 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (e.g. being forced into surface-owned truth).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T014. Current durable execution facts are the materialization terminal, the Issue #33 dependency facts (T004/T007 merges), the dependency closeouts and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
