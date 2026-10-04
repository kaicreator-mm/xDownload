# T014 Implementation Map — exact base `f5ac137f94438a591fd6781c5b758be6c375233a`

This map records seams that exist on the exact integration base (after T002/T004/T005/T006/T007/T008/T010/T011 merges). It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T014 use / constraint |
| --- | --- | --- |
| `packages/core-seam/` | T004 (`#23`, merge `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2`): versioned local command/query authority boundary — `SeamClient` (`submitCommand`/`submitQuery`/`close`, idempotent re-submit across reconnects), `CommandEnvelope`/`QueryEnvelope` wire contract, declared input bounds, same-install/same-user `PeerIdentity` with `SURFACE_KINDS` including `'DESKTOP_UI'`, `authorizePeer`, read-only `SeamProjectionView` (`ContractProjectionView`, optional `SnapshotProjectionView`, `LineageProjectionView`), and `transport-loopback` for deterministic in-process tests | The only Core boundary T014 may consume. UI submits commands/queries and reads projections through it; `transport-loopback` is the intended Core stand-in for component/interaction tests, including forced-disconnect cases. |
| `packages/domain-contracts/` | T002 (`#21`) + T007 (`#26`, merge `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`): Core-owned canonical vocabulary — `AcquisitionContract`, `SelectionSnapshot`, immutable scope/continuation, budget domains, typed `Evidence`/validation records, `projectResult`/`ProjectedTerminalResult`/`TerminalResultStore` result projection, and adapter-facing `ports.ts` (`SurfaceCommand`, `TerminalResultProjection`, `DomainGateway`) | Read/consume only. The UI renders projected values verbatim and never re-derives, re-projects or re-decodes them into competing surface semantics. Decode failures of projection data fail closed to an explicit degraded state. |
| `packages/discovery-recipe/` | T011 (`#30`, merge `35d322c`): HITL selection/confirmation semantics — `planConfirmationWorkflow`, `ConfirmationRequest` levels `SCOPE_LEVEL`/`BATCH_GROUP`/`MATERIAL_ITEM`/`MANUAL_SELECTION_UI`, `MAX_MATERIAL_ITEM_CONFIRMATIONS = 3`, `recordConfirmation`/`confirmationEvidenceRecord`/`selectionAcquisitionComplete`/`whatConfirmationProves`, `AutomationMode` `AUTO`/`ASSISTED`/`MANUAL_SELECTION` | The UI renders and drives exactly these confirmation levels as Core commands; it never invents per-item interrogation beyond the material-item bound and never presents confirmation as proving target quality/membership truth. |
| `packages/core-scheduler/` | T006: scheduler, lifecycle budgets, cancellation/retry control transitions, cancel-vs-acceptance cutoff, budget precedence | UI submits cancel/retry commands and reads resulting projections; no surface-local precedence, timeout-cancel or "recovery wins" rule (L2 invariant 20, §6.8). |
| `packages/persistence-ledger/` | T005: SQLite durable ledger, recovery | Never read/written by the UI; UI state is rebuilt from seam projections only. |
| `packages/direct-acquisition/` | T008: direct HTTP/file acquisition, resume/retry/integrity | No direct access; transfer progress/status reaches the UI only through seam projections. |
| `packages/browser-auth-broker/`, `packages/browser-observation/`, `packages/browser-extension/` | T010 (merge `f5ac137`): browser observation, Native Messaging broker, scoped authorization | Outside T014 except that auth-required/blocked/action-required Core statuses may surface as UI prompts (C10/C24). The UI never holds broker secrets or raw credentials. |
| `packages/toolchain-smoke/`, `packages/toolchain-smoke-core/` | T001 toolchain smoke packages | Reference only for workspace mechanics; not product code. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | Desktop presentation belongs under the already-admitted `apps/*` seam (L2 §8 logical home `apps/desktop/`). No workspace file change expected. |
| `tsconfig.json` | strict TS; includes `packages/*/src/**/*.ts`, `packages/*/test/**/*.ts` and already `apps/*/src/**/*.ts` | `apps/desktop` source typechecks today. Any further config change must be directly necessary tooling wiring. |
| `vitest.config.ts` | Node environment; discovers only `packages/*/test/**/*.test.ts` | Desktop UI component/interaction tests require narrowly necessary include wiring (or a presentation-package test seam). Whatever harness is added (e.g. DOM-simulating environment/framework renderer) is an F2 choice whose exact package/version/license must be recorded. |
| `eslint.config.js` | root lint authority established by T001 | T014 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics (§6 Desktop primary surface, §13 minimum-necessary interaction, §21 status explanation rules, C01–C34) | Read-only authority for the confirmation priority, immutable-scope display and truthful-result explanation. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` (D10 thin surfaces, invariant 2, U1/U9, §6.7 projection authority, §7 Result central projector, ADR-012) | Read-only authority: Desktop submits and reads; it does not own lifecycle truth; framework/IPC stay replaceable. |
| `docs/implementation/v0.1.0/task-packs/T014_desktop-ui-adapter.md` | frozen T014 WHAT blob `848be622d379f55dc3f42c8dc10e53d0826fe177` | Read-only task authority. |
| `.agent/execution/T014/` | JIT pack created by this prep on the T014 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** `apps/` directory, no desktop shell/framework/runtime/IPC choice (deliberately unfrozen per U9/ADR-012), no UI component/interaction test harness dependency, and no production IPC transport. T014 therefore creates the minimum presentation surface and its deterministic test seam rather than wiring into an existing app.

This absence is not permission to make packaging/platform/release decisions. Framework choice is a bounded implementation detail; T014 proves its acceptance with UI tests, not release UX or platform claims (Frozen Task Pack Merge/routing rule).

## Suggested bounded decomposition — non-authoritative F2 choice

The Builder may choose the layout. Whatever is chosen should keep these concerns explicit:

- presentation components/views (intent entry, scope preview, selection/confirmation, progress/status, result explanation);
- projection view-models mapping `SeamProjectionView`/`ProjectedTerminalResult` to display state (no semantic re-derivation);
- seam client adapter (`createSeamClient` + `DESKTOP_UI` peer identity + loopback transport for tests);
- non-authoritative interaction state (form drafts, expansion/refresh intents) clearly separated from confirmed/authoritative values;
- component/interaction tests mapping to `TEST_MATRIX.yaml`.

Do not implement persistence, scheduler, discovery, transfer, browser or packaging behavior inside the surface.

## Expected test placement seam

Existing runner discovers `packages/*/test/**/*.test.ts`; `apps/*` tests need the bounded include wiring recorded in implementation evidence. T014 tests must remain deterministic and local, covering:

- immutable confirmed-scope rendering and successor-routing interactions;
- confirmation-plan level rendering (scope → batch → ≤3 material items → manual selection);
- truthful multi-dimensional status/result explanation from projections;
- cancel/retry command submission and resulting projection reads;
- Core-disconnect/reconnect degradation without fabricated status;
- C02/C05/C08/C09/C10/C11/C12/C13/C14/C15/C16/C23/C24/C26/C27/C30/C31/C34 presentation-level oracle mapping.

No real network, real desktop shell, real browser, filesystem, database or media transfer belongs in T014 concern tests; `transport-loopback` stands in for Core.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T014 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
