# T014 L3 Reference Pack — Desktop UI thin presentation/interaction adapter

Task: `T014` / Issue `#33`  
Bound base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It deliberately does not select a desktop framework, renderer or UI harness dependency; that choice stays with the Builder under `F2_ENGINEERING_DISCRETION` and L2 U9/ADR-012.

## 1. Tests — highest priority references

### 1.1 Existing repository runner and proven test patterns

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, currently discovering `packages/*/test/**/*.test.ts`. Desktop UI tests require narrowly necessary include wiring (recorded in implementation evidence) or a presentation-package test seam.

Study these in-repo patterns before writing UI tests — they define the interaction semantics the adapter must honor:

- `packages/core-seam/test/projection-read-side.test.ts` — how read-only projections are built and asserted;
- `packages/core-seam/test/transport-loopback.test.ts` — deterministic Core stand-in, including reconnect behavior to reuse for disconnect tests;
- `packages/discovery-recipe/test/confirmation-workflow.test.ts` — the confirmation-plan levels and material-item bound the UI must render;
- `packages/domain-contracts/test/oracles-c01-c34.test.ts` and `t007-result-projector.test.ts` — the multi-dimensional result tuples the UI displays verbatim.

**Patterns to emulate:**

- table-driven/parameterized interaction cases so each legal and illegal presentation has a stable oracle identity;
- render-from-projection tests: feed a fixture projection, assert exactly what the surface displays;
- forced-disconnect/reconnect tests through the loopback transport, never real sockets or a real shell;
- immutable-display assertions: interaction attempts that must not mutate confirmed scope leave the rendered state unchanged and instead produce a successor-routed command;
- negative-path-first: the surface-authority/silent-mutation/fabricated-status cases in `TEST_MATRIX.yaml` fail before the fix;
- deterministic fixtures — no network, filesystem, database, real browser or real desktop shell in concern tests.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11` (MIT; already selected by T001 — T014 does not introduce it).

### 1.2 Component/interaction harness

No UI framework or DOM/interaction harness is installed on the exact base. Under F2 the Builder may add one (e.g. a DOM-simulating environment or framework-specific renderer/test library). Requirements:

- exact package/version/license and primary source recorded in the implementation PR;
- concern tests remain deterministic and headless-runnable in CI;
- the harness never becomes a place where authoritative semantics are re-implemented.

This pack intentionally does not preselect a framework or harness library.

## 2. Contract / interface references

Exact-base public seams T014 consumes (all read/consume only):

- `@xdownload/core-seam` — `createSeamClient({ transport, target, peer })`, `submitCommand`/`submitQuery`/`close` with idempotent re-submission across reconnects; `CommandEnvelope`/`QueryEnvelope`; declared input bounds; `PeerIdentity` with `SURFACE_KINDS` `'DESKTOP_UI'`; `decodePeerIdentity`/`authorizePeer`; `SeamProjectionView`/`ContractProjectionView`/`SnapshotProjectionView`/`LineageProjectionView`; `transport-loopback`.
- `@xdownload/domain-contracts` — `ProjectedTerminalResult`/`projectResult` (six result dimensions), `SurfaceCommand`/`TerminalResultProjection` port shapes, canonical scope/snapshot/evidence vocabulary.
- `@xdownload/discovery-recipe` — `planConfirmationWorkflow`, `ConfirmationRequest` (`SCOPE_LEVEL`/`BATCH_GROUP`/`MATERIAL_ITEM`/`MANUAL_SELECTION_UI`), `MAX_MATERIAL_ITEM_CONFIRMATIONS = 3`, `AutomationMode`, `whatConfirmationProves`.

Interface rule: the adapter maps projections to view state one-way. It never emits values that only Core may originate (statuses, completion, membership truth, scope facts), and it never re-decodes projection payloads into new surface semantics.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 One-way projection → view-model → display

```text
SeamProjectionView / ProjectedTerminalResult
→ pure view-model mapping (no semantic decisions)
→ rendered display state
```

Keep the mapping pure and table-testable; interaction components stay thin above it.

### 3.2 Non-authoritative interaction state

Form drafts, filter text, expansion/refresh intent live in ephemeral UI state, clearly separated from confirmed values read from projections. Any state that would contradict a projection loses; the projection is re-read on focus/reconnect.

### 3.3 Confirmation flow as command routing

The UI renders the Core-produced confirmation plan and turns user answers into idempotent commands. It never decides locally that ambiguity is resolved, never invents extra prompts, and never collapses a batch ambiguity into per-item interrogation (PRD §13; C30).

### 3.4 Disconnect-first status presentation

Treat "no fresh projection" as a first-class display state, not an error path. `SeamClient` already re-submits idempotently across reconnects; the UI surfaces "degraded/disconnected — showing last known Core state" and forbids itself from extrapolating.

## 4. Failure handling patterns

Fail closed at the presentation boundary:

- stale/unparseable projection → explicit degraded display; never reinterpret partial data into a plausible status;
- Core unreachable → degraded state; no fabricated progress/completion; recovery = re-read projections;
- command rejection (malformed/over-bounds input per seam bounds) → surface the typed diagnostics; do not retry by locally "fixing" authoritative values;
- cancel/retry command failure → show the transition did not happen; never display local intent as if it were durable Core state;
- contradiction/uncertainty → `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` / `EXECUTION_PACK_INVALID` per `EXECUTION_CONTRACT.md`; tooling unavailable → `VALIDATION_NOT_EXECUTED`, no PASS.

## 5. Examples / docs mapping to T014 acceptance

| Acceptance concern | Reference pattern | Required T014 proof |
| --- | --- | --- |
| Immutable confirmed scope | L2 invariant 2/D10; PRD §21 rules | display immutable; expansion routes successor (C08/C11) |
| Batch confirmation | PRD §13 priority; `confirmation-workflow.test.ts` | scope → batch → ≤3 material items → manual; no per-item burden (C30) |
| Selection | `planConfirmationWorkflow` levels; C31/C16 | Core-sourced plan rendered; no reusable-selection offer; direct tasks skip preview |
| Status explanation | `ProjectedTerminalResult` six dimensions; PRD §21 | truthful PARTIAL/UNKNOWN/TRUNCATED/UNSATISFIED display (C02/C10/C14/C15/C23/C24) |
| Confirmation ≠ truth | `whatConfirmationProves`; C26/C27/C34 | selection-only proof surfaced; validation never waived by confirmation |
| Cancellation/retry routing | L2 §6.8/invariant 20; `core-scheduler` transitions | command submission + projection readback; no local precedence (C12/C13) |
| Core-disconnect behavior | `transport-loopback` reconnect semantics; Task Pack acceptance | degraded state, no fabrication, projection re-sync |
| Auth/action prompts | C10/C24; opaque authorization context | Core-sourced prompts; no secret capture |

## 6. Dependency/version/license facts

| Package | Exact version on bound base | License | T014 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict view-model/component typing (already pinned) |
| `vitest` | `4.1.11` | MIT | component/interaction test runner (already pinned) |

Sources: root `package.json` on exact base; upstream exact-tag license files in `microsoft/TypeScript@v5.9.3` and `vitest-dev/vitest@v4.1.11`.

**No desktop framework, renderer or DOM/interaction harness is recommended or pinned by this Reference Pack.** Under F2 the Builder may add one; the implementation evidence must record exact package/version/license and primary source, and Review must check the choice stays a bounded implementation detail (U9/ADR-012) rather than de facto Architecture authority.

## 7. Do / Don't

### Do

- read everything displayable from seam projections; keep the mapping pure;
- route confirmation/selection/cancel/retry as idempotent Core commands with a `DESKTOP_UI` peer identity;
- make disconnect/degraded a designed display state with loopback-driven tests;
- render the six result dimensions and stop reasons verbatim, including ugly truths;
- test negative paths first; map the applicable C-oracles at presentation level;
- record any added UI dependency's exact version/license.

### Don't

- don't derive status, completion, membership or scope truth UI-side;
- don't mutate confirmed scope/selection displays or offer in-place refresh;
- don't interrogate item-by-item where batch/manual resolves the ambiguity;
- don't fabricate or extrapolate state while Core is disconnected;
- don't display suggestions/confirmations as verified quality/membership truth;
- don't capture raw secrets into UI state;
- don't claim framework/OS/installer/release support or close with UX claims instead of UI tests;
- don't copy substantial external source into the repository.

## 8. Reuse / license risk

Risk is low if external material is used as interface/testing/design reference only. Do not copy substantial source from any framework or library into T014. If a new dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T014. The later Builder produces an exact candidate; T014 concern Validation must execute the component/interaction test matrix on that exact candidate with UI tests, not release UX claims. Version-level visible Validation is owned by T020–T023 on the exact T019 candidate. Review is `recommended` and risk is `medium` per the frozen Issue #33 policy.
