# T007 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T007 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies | Modify only if narrowly necessary for T007 dependency/test wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T007 code belongs under `packages/*`. `apps/*` is outside T007. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T007 source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T007 ledger/accounting/projection tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T007 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 canonical value layer (merged PR #52): `evidence.ts` (EvidenceRecord schema, ClaimType/EvidenceSourceType/IndependenceFromDiscovery/CertaintyClass/ValidationLayer/ConfirmationType vocabulary, `canServeAsIndependentValidationOracle`, `assertNoDiscoverySelfCertification`, `whatConfirmationProves`, `aggregateConfirmationOutcomes`, KnowledgeRef rules), `result.ts` (six-dimension TerminalResult value, `decodeTerminalResult`, `validateTerminalResult`, `buildTerminalResult`, `CoverageEvidence` sufficient/insufficient bases), `snapshot.ts`, `scope.ts`, `budget.ts`, `ids.ts`, `decode.ts`, `diagnostics.ts`, `version.ts`, `slices.ts` | Canonical vocabulary T007 must consume, not fork. T007 adds the semantic layer on top: ledger, validation records, accounting, projection. Any extension inside this package must preserve T002 schemas/exports; a new minimal sibling package is an allowed F1 alternative. |
| `packages/domain-contracts/src/ports.ts` | `DomainGateway` seam: `appendEvidence(raw)` currently decodes only (no durable append semantics); `projectTerminalResult(raw, context)` validates an externally supplied result — it does **not** derive status from facts; `TerminalResultProjection`/`projectForSurface` is a thin read wrapper | Exact gap T007 fills: real append-oriented ledger semantics, validator-output records, and a projector that computes the six dimensions from canonical facts. Read projections stay non-authoritative. |
| `packages/toolchain-smoke/`, `packages/toolchain-smoke-core/` | T001 smoke packages | Leave outside T007 concern. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics | Read-only authority: §16 result model/status enums, §17 coverage/auth accounting + §17.2 18/16 tuple, §18 legal combinations + §18.8 forbidden, §19 completeness contract, §20 evidence claim model, §21 confirmation claims, §22 validation layers, §35 C01–C34. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: D4 multidimensional terminal truth, invariants 1/2/3/5/6/17/18/20, §6.7 EvidenceLedger/ValidationRecord/CoverageAccounting/ResultProjector ownership, §11.1 cancellation/reconciliation/acceptance precedence and status-projection rules, ADR-009. |
| `docs/implementation/v0.1.0/task-packs/T007_evidence-validation-result-projection.md` | frozen T007 WHAT blob `6f5dddfa89b8054bb1cca0e7a60bb5a194ede7be` | Read-only task authority. |
| `.agent/execution/T007/` | JIT pack created by this prep on the T007 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** typed EvidenceLedger (append-oriented store semantics), **no** ValidationRecord type (only the `ValidationLayer` vocabulary and the minimal `SelectedMemberValidationOutcome` exist), **no** requested-scope CoverageAccounting with the three distinct §17 views and §17.2 count tuple, and **no** deterministic ResultProjector that derives the six dimensions from evidence/validation/coverage facts (including cancellation projection per L2 §11.1). `projectTerminalResult` validates a result that the caller already supplied; deriving the result is exactly T007's gap.

This absence is not permission to invent downstream lanes. T007 stops at the truth/evidence/result semantic layer and its read projections; persistence, scheduling, adapters and runtime integration belong to T003/T004/T005/T008/T009/T015.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may extend `packages/domain-contracts` or add a minimal sibling package under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- append-only typed evidence ledger semantics (append/query; immutable accepted records);
- validation records with exact subject/artifact/snapshot/layer binding and independence basis;
- requested-scope coverage accounting (three views, sufficient/insufficient bases, §17.2 counts);
- the deterministic result projector (legal combinations, empty-set, cancellation, auth-limited tuple, partial/truncated/unknown distinctions);
- thin read projections for surfaces;
- fixtures + tests mapping to `TEST_MATRIX.yaml`, including C01–C34 at projection/behavior level.

Do not add persistence engines, schedulers, network/media execution or UI code.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T007 tests should remain package-local and should cover:

- projector determinism: identical canonical facts always yield identical terminal results;
- every legal canonical tuple (§18.1–§18.7 shapes) projects and every §18.8 forbidden combination rejects;
- empty-set handling: §18.5 verified-empty tuple vs §18.6 unproven-empty; no vacuous acquisition success for empty selected sets;
- cancellation projection across the L2 §11.1 cancel-timing matrix (before dispatch, before bytes complete, before validation, before acceptance, after acceptance, after terminal, explicit retry/resume);
- the exact §17.2 auth-limited 18/16 tuple and its required accounting/explanation facts, including the degraded variants when the 2 inaccessible members are not independently accounted;
- partial/truncated/unknown distinctions (C02/C03/C14/C23);
- ledger/validator independence: discovery-derived evidence cannot serve as the sole oracle for the same claim (C34, C22); confirmation proves only the shown claim (C26); failed transfer/format/media validation blocks `SelectionAcquisitionStatus=COMPLETE` (C27);
- count-equality and all insufficient coverage bases rejected as `VERIFIED_COMPLETE` grounds (C01, PRD §19);
- ledger immutability: append-only enforcement and rejection of rewrite/delete/corrupt records;
- read projections never recompute status and never mutate canonical truth.

No browser, filesystem, database, real network, media transfer or UI harness belongs in T007 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T007 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
