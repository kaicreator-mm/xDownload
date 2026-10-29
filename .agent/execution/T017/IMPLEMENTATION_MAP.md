# T017 Implementation Map — exact base `5b86cd2ca3b5cc587f7bf42f4331716637081353`

This map records seams that exist on the exact integration base (the T016 merge, which includes the #72 T010 hardening). It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing merged tree (observed)

Workspace: pnpm monorepo (`pnpm-workspace.yaml` admits `packages/*` and `apps/*`); TypeScript `5.9.3`, Vitest `4.1.11`, ESLint `9.39.5`, Prettier `3.9.9`; root gates `format:check`/`lint`/`typecheck` (`tsc --noEmit`)/`test:unit` (`vitest run`)/`ci:verify`. Root tree `4f6fe02886d373613597711fb9d8cc4ba7915d7f` contains **15 packages** — 13 product packages + 2 T001 smoke packages — and **3 app surfaces**.

### Product packages (consumed as-is)

| Exact current path | Delivered by | Exact-base fact | T017 use / constraint |
| --- | --- | --- | --- |
| `packages/domain-contracts` | T002 | canonical contract/schema vocabulary; AcquisitionContract, SelectionSnapshot, multidimensional results, typed Evidence/Validation, budget domains, `DomainValidationResult` diagnostics | Source of all canonical vocabulary; consumed as-is. |
| `packages/version-validation` | T002/T003 | schema/version validation kernel | Consumed as-is. |
| `packages/core-seam` | T004 | `SURFACE_KINDS = ['CLI','DESKTOP_UI','BROWSER_EXTENSION']` (`src/peer.ts`), `PeerIdentity{installId,userId,surface}`, `ExpectedPeerScope{installId,userId,allowedSurfaces}` with **per-frame** authorization; `createSeamClient`/`stampPeer`, `CommandEnvelope`/`QueryEnvelope`, `SEAM_MESSAGE_LIMITS`, loopback transport (`transport-loopback.ts`), `CoreSeamServer` with journal replay | THE surface connection point: every surface connects as a seam client with its `SurfaceKind`; surfaces never bypass it. |
| `packages/core-scheduler` | T006 | control facts, lifecycle budgets, cancellation/retry | Consumed as-is via core-runtime. |
| `packages/persistence-ledger` | T005 | SQLite ledger, artifact store, recovery | Consumed as-is via core-runtime. |
| `packages/direct-acquisition` | T008 | direct HTTP/file transfer + resume/retry/integrity | Consumed as-is via core-runtime. |
| `packages/hls-vod-adapter` | T009 | HLS VOD pipeline | Consumed as-is via core-runtime. |
| `packages/browser-observation` | T010 | untrusted-input gate, provenance-bound `ObservationRecord` (`EVIDENCE_INPUT_ONLY`), redacted handoff | Consumed as-is via workflow. |
| `packages/browser-auth-broker` | T010 | strict `allowed_origins`, expiring scoped capabilities bound to exact tuples | Consumed as-is via workflow. |
| `packages/discovery-recipe` | T011 | bounded discovery, recipe engine + `RecipeDefinition` decode, `planConfirmationWorkflow`/`recordConfirmation` + `ConfirmationOutcome` aggregation, continuation admission (`admitContinuationRequest`/`deriveContinuationSuccessor`), `detectFrozenMembershipDrift`/`planFailedMemberRetry` | Confirmation/HITL and recipe-decode authority; the AI proposal target schema; consumed as-is. |
| `packages/ai-proposal` | T012 | `ModelProviderPort{identity: ProviderIdentity, propose(ProviderProposalRequest{input: RedactedModelInput}) → ProviderProposalOutcome}`; outcome = `PROPOSAL{payload: unknown}` \| `UNAVAILABLE{reason: OUTAGE\|TIMEOUT\|MALFORMED_RESPONSE, detail}`; `AiProposalAdapter.proposeRecipe(ProposalRequest{gap, expectedGapRef, expectedContractRef, contract}) → ProposalRequestPath`; `provider: undefined` = deterministic-only mode; pipeline redact→bound/audit→provider→containment audit→deterministic policy→accepted proposal (suggestion provenance) \| typed rejection \| `MODEL_UNAVAILABLE` + `DeterministicFallback{kind: ASK_USER\|ABORT}`; envelope `xdownload.ai-proposal@1.0.0`, supported majors `[1]` | **Currently imported by nothing outside its own package/tests** — wiring it into the composed path is exactly the T017 gap. Consumed as-is; no internal deadline exists (by design), so the caller-side deadline wrap is T017's. |
| `packages/core-runtime` | T015 | THE single composition root: `createCoreRuntime`/`reopenCoreRuntime`/`closeCoreRuntime`, `CoreSeamServer` + `FileBackedSeamJournal`, `CoreScheduler` + `FileBackedControlFactLog`, ledger + artifact store + `RecoveryService`, `CoreRuntimeBudgetBridge`/`schedulerTransferBudgetPort`/`schedulerHlsTransferLedger`, flows `executeDirectAcquisition`/`executeHlsAcquisition`, lineage `registerLineage`/`cancelLineage`/`resumeLineage`, `projectLineageResult`, `effectIdFor` | All surfaces' commands land here; all terminal truth comes from its T007 projection. Composed once, no second authority. |
| `packages/browser-collection-workflow` | T016 | S2/S5/S6 lanes: `runS2AttachmentFlow`/`composeObservationHandoff`/`projectS2Flow`/`locatorProvenanceFacts`, auth-lifecycle (`issueScopedCapability`/`useScopedCapability`/`inspectCapability`/`revokeScopedCapability`), `collection-flow.ts`, `continuation-lane.ts` | The browser→Core lane whose outcomes must project identically to all surfaces; consumed as-is. |
| `packages/toolchain-smoke`, `packages/toolchain-smoke-core` | T001 | toolchain smoke only | Outside T017 concern. |

### App surfaces

| Exact current path | Delivered by | Exact-base fact | T017 use / constraint |
| --- | --- | --- | --- |
| `apps/cli` | T013 | thin client: argv → `@xdownload/domain-contracts` decoders (fail closed) → `CommandEnvelope` via `createSeamClient` (SurfaceKind `'CLI'`, idempotent requestId) → `SeamResponse` ACCEPTED/REJECTED/PROJECTION → render → documented exit; "no surface-local status derivation, no private store, no retry bookkeeping" | Converge as-is; presentation-only wiring. Its thin-client/authority rules must survive verbatim. |
| `apps/desktop` | T014 | thin presentation/interaction: verified projections only; confirmed scope immutable; `planConfirmationWorkflow` rendered verbatim; no UI-derived completion; disconnect = explicit degraded; opaque `AuthorizationContextRef`, raw secrets refused at interaction boundary | Converge as-is; presentation-only wiring. Its authority rules must survive verbatim. |
| `apps/browser-extension` | T010 | privileged service worker: untrusted content gate, Native Messaging `connectNative` only, no fallback transport, no business logic; bundling explicitly deferred ("T016 integration / T018 packaging") | Consumer/verification only: browser-triggered actions must project identically. No packaging (T018), no privileged-logic redesign. |

## Current absence facts that matter

At the bound base:

1. `@xdownload/ai-proposal` is wired into **no** composed path — no `core-runtime`, `browser-collection-workflow`, or `apps/*` module imports it. T017 performs that wiring as an optional suggestion source bound to discovery/confirmation gaps.
2. No cross-surface convergence composition exists: CLI and Desktop each stand alone against the seam; no shared fixture/flow proves same-contract → same-status across surfaces; no concurrent UI/CLI flow exists.
3. No caller-side provider deadline exists anywhere (correctly — the port is currently uncalled). T017 introduces the deadline/budget wrap at the call site.
4. No surface-level aggregation/brokerage module exists. If shared convergence glue is needed, it is a NEW minimal module under the existing `packages/*` seam — not a modification of consumed packages.

These absences are not permission to invent downstream architecture. T017 stops at convergence wiring + focused evidence; packaging/platform work is T018.

## Convergence topology (non-authoritative F1 shape)

```text
apps/cli (SurfaceKind CLI) ─┐
apps/desktop (DESKTOP_UI) ──┼─→ core-seam client (per-frame peer auth, idempotent requestId)
apps/browser-extension ─────┘          │
        │ (Native Messaging only)       ▼
        │                        @xdownload/core-runtime (T015: ONE composition root)
        │                          ├─ @xdownload/browser-collection-workflow (T016 lanes)
        │                          │      └─ discovery/confirmation gaps ──┐
        │                          ├─ scheduler/budget bridges              │
        │                          └─ T007 projection (terminal truth)      ▼
        │                                                @xdownload/ai-proposal (T012)
        │                                                optional ModelProviderPort
        │                                                [T017 caller-side deadline,
        │                                                 charged to PRD §15 budgets]
        └─ every surface renders ONLY SeamResponse/PROJECTION — verbatim, no local truth
```

## Expected test placement seam

Existing runner discovers `packages/*/test/**/*.test.ts`; apps carry their established test placement. T017 convergence tests should cover (see `TEST_MATRIX.yaml`):

- same canonical contract driven through two `SurfaceKind`s → same response class + same projection;
- concurrent clients (UI + CLI + browser-triggered) → convergent statuses, idempotent replay, duplicate-allocation rejection;
- provider outage/timeout/malformed/hang → deterministic fallback (`ASK_USER`/`ABORT`), identical deterministic outcomes with and without the provider;
- malicious/hostile proposal payloads → fail safely through the deterministic policy, never authority;
- HITL plans rendered/routed identically across surfaces, fallbacks explicit;
- no-surface-local-authority negatives (a surface attempt to derive/patch status must not exist in glue).

Tests are deterministic and local (loopback transport or bounded drivers); no real network provider, no packaging/bundling harness.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T017 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
