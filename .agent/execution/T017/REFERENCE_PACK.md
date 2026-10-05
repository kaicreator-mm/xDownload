# T017 L3 Reference Pack — surface + AI convergence integration

Task: `T017` / Issue `#36`  
Bound base: `version/v0.1.0@5b86cd2ca3b5cc587f7bf42f4331716637081353`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It introduces no new runtime dependency and redefines no public semantics.

## 1. Tests — highest priority references

Primary exact-base test mechanism: `vitest@4.1.11` (already pinned by T001), discovering `packages/*/test/**/*.test.ts` via `vitest.config.ts`; apps carry their established test placement. Keep every convergence claim as a deterministic, local, executable fixture.

**In-repo patterns to emulate (read these first — they are the house style on this base):**

- `packages/ai-proposal/test/oracles-parity.test.ts` — AI-vs-deterministic parity oracle style; the exact pattern T017 needs for "identical results with and without the provider" (C16/C19).
- `packages/ai-proposal/test/proposal-schema.test.ts` — envelope negative decode style (unknown versions, oversized, unknown fields, secret material); extend the same discipline to the wired path.
- `packages/core-seam` loopback transport tests — two clients against one server via `transport-loopback.ts`: the direct template for concurrent UI/CLI convergence fixtures without real IPC.
- `apps/cli` and `apps/desktop` tests (T013/T014) — thin-client render/route fixtures; reuse their response-class/projection assertions for cross-surface parity cases.
- `packages/browser-collection-workflow` tests (T016) — composed-lane fixture style for browser-triggered projection identity.
- `packages/core-runtime` tests (T015) — single-instance composition + reopen fixtures for concurrent-control and disconnect/degraded cases.

**Required test shapes:**

- one fixture matrix keyed by (canonical command, SurfaceKind) asserting identical SeamResponse class + identical projection;
- concurrent-client fixtures (Promise.all over two loopback clients) proving convergence, idempotent replay, and duplicate-allocation rejection;
- provider fault-injection table: omitted / outage / timeout / malformed / hang-past-deadline / malicious-payload → each asserting truthful `MODEL_UNAVAILABLE` + deterministic fallback and unchanged deterministic outcomes;
- deadline tests with fake timers or deterministic cancellation so a hung provider resolves within the bound;
- negative glue tests proving absence of surface-local truth (assert render happens only from projections — e.g., projection mutation is visible on both surfaces).

No real network provider, no real browser-required test, no packaging harness belongs in T017 concern tests.

## 2. Contract / interface references (exact-base seams)

- `@xdownload/core-seam`: `createSeamClient`, `stampPeer`, `CommandEnvelope`/`QueryEnvelope`, `SURFACE_KINDS`/`PeerIdentity`/`ExpectedPeerScope` (`packages/core-seam/src/peer.ts` — per-frame admission), `SEAM_MESSAGE_LIMITS`, `transport-loopback.ts`. Surfaces connect ONLY here; their `SurfaceKind` is fixed by T004 (`'CLI' | 'DESKTOP_UI' | 'BROWSER_EXTENSION'`).
- `@xdownload/core-runtime`: `createCoreRuntime`/`reopenCoreRuntime`/`closeCoreRuntime`, `CoreRuntimeBudgetBridge`, `executeDirectAcquisition`/`executeHlsAcquisition`, `registerLineage`/`cancelLineage`/`resumeLineage`, `projectLineageResult` (`packages/core-runtime/src/flow.ts`). One instance; all surfaces' truth flows through its T007 projection.
- `@xdownload/ai-proposal`: `AiProposalAdapter`/`AiProposalAdapterOptions{provider?}`, `ModelProviderPort`, `ProviderProposalOutcome`, `ProposalRequestPath` with `DeterministicFallback{kind: 'ASK_USER'|'ABORT'}` (`packages/ai-proposal/src/adapter.ts`, `providerPort.ts`, `fallback.ts`). `provider: undefined` is the deterministic-only mode and must remain a first-class configuration.
- `@xdownload/discovery-recipe`: `planConfirmationWorkflow`/`recordConfirmation`, `RecipeDefinition` decode, continuation admission/successor APIs. The proposal target schema and the HITL authority — never reimplemented in glue.
- `@xdownload/browser-collection-workflow`: `runS2AttachmentFlow`, scoped-capability lifecycle (`issueScopedCapability`/`useScopedCapability`/`revokeScopedCapability`), `projectS2Flow`. The lane whose outcomes must project identically everywhere.
- `@xdownload/domain-contracts`: the only canonical vocabulary; six-dimension terminal results; opaque `AuthorizationContextRef`.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Deadline as caller-side wrapper (the T012 P2 waiver constraint)

`@xdownload/ai-proposal` intentionally enforces no internal provider timeout: the port contract says "thrown errors, hung calls and garbage responses must be mapped by the implementation to `UNAVAILABLE`", and the T012 P2 waiver (PR #31 review) records that the provider deadline belongs to the caller/budget per Frozen PRD §15. T017 is that caller. Pattern:

```text
composed gap → ProposalRequest (exact gap/contract binding)
  → deadline wrap (race provider.propose against a deterministic
    cancellation charged to GlobalSafetyBudget model cost/calls +
    elapsed-time semantics)
  → expiry resolves { kind: 'MODEL_UNAVAILABLE', reason: 'TIMEOUT' }
    → DeterministicFallback ASK_USER/ABORT
  → never: hang, silent skip, exception leak, budget redefinition
```

Keep the wrap at the T017 call site; do not patch `packages/ai-proposal`.

### 3.2 One projection, many renderers

Every surface renders the same `SeamResponse`/`PROJECTION` bytes. Parity is achieved by sharing the canonical projection — not by syncing per-surface derived state. If two surfaces disagree, the bug is glue-local derivation; delete it rather than compensate.

### 3.3 Optional-dependency composition

Follow the T015/T016 composition idiom: compose consumed packages through their public APIs as-is; glue decides order and lifetime only. The provider is an injectable option; the deterministic path must construct, run and close with the option absent.

### 3.4 Concurrency via canonical identity

Concurrent clients are safe only through canonical identities: idempotent `requestId`, lineage/effect ids, per-frame peer authorization. Never add client-side mutexes/queues as a substitute — schedule through Core control transitions and let identity reject duplicates (C13).

## 4. Failure handling patterns

Fail closed, truthfully, and identically on every surface:

- AI unavailable (any reason, including caller-deadline expiry) → typed `MODEL_UNAVAILABLE` + `ASK_USER`/`ABORT`; never empty/partial success; deterministic outcomes unchanged.
- Malicious proposal → typed rejection/unavailability through the deterministic policy; nothing durable, nothing behavioral.
- Surface disagreement/disconnect → explicit degraded state, no fabricated status; reconnect re-syncs from projections only.
- Seam rejection → diagnostics verbatim on every surface.
- Glue-facing contradictions: `TASK_PACK_DEFECT` / `ARCHITECTURE_CONTRADICTION` / `EXECUTION_PACK_INVALID` / `PACK_STALE_MATERIAL_OR_REBIND_REQUIRED` per `FAILURE_MATRIX.yaml` — stop and route, never redesign locally.

## 5. Examples / docs mapping to T017 acceptance

| Acceptance concern (frozen) | Reference pattern | Required T017 proof |
| --- | --- | --- |
| Same contract → compatible UI/CLI status | (command, SurfaceKind) parity matrix over `createSeamClient` + `projectLineageResult` | identical response class + six-dimension projection per surface |
| Concurrent clients converge | loopback two-client fixtures; idempotent requestId; canonical identity (C13) | one status per lineage; duplicate allocation rejected identically |
| Browser-triggered actions project identically | `runS2AttachmentFlow` outcome observed from CLI + Desktop clients | same projection bytes from every surface |
| AI outage/malicious proposal fails safely | fault-injection table over `ModelProviderPort`; deterministic policy tests (`oracles-parity` style) | typed unavailability/rejection; containment holds; truth unchanged |
| Deterministic work model-independent | provider omitted vs configured parity runs (C16/C19) | identical results/statuses; no required model path |
| HITL choices explicit | `planConfirmationWorkflow` verbatim render + idempotent answer routing (C05/C26/C30) | same plan/answers on all surfaces; ASK_USER never auto-resolved |
| No surface-local authority | negative glue tests; disconnect/degraded fixtures | no local truth anywhere; opaque auth refs; raw secrets refused |

## 6. Dependency/version/license facts

| Package | Exact version on bound base | License | T017 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static wiring/type checking (already pinned; not introduced by T017) |
| `vitest` | `4.1.11` | MIT | executable convergence/fault-injection tests (already pinned) |
| `eslint` / `prettier` | `9.39.5` / `3.9.9` | MIT | root gates (already pinned) |

**No new runtime dependency is recommended or pinned by this Reference Pack.** The convergence composes already-merged workspace packages. Under `F1_BOUNDED_IMPLEMENTATION` the Builder may justify a narrowly scoped addition (e.g., a deterministic timer/cancellation helper), but it must record exact package/version/license/provenance and Review must confirm it does not become de facto Product/Architecture authority. Real provider SDKs are NOT introduced by T017: the provider remains an injectable port satisfied by fakes in tests.

## 7. Do / Don't

### Do

- wrap every provider call with the caller-side deadline/budget bound;
- keep `provider: undefined` (deterministic-only) a first-class, fully-working mode;
- render Core projections verbatim; test cross-surface parity explicitly;
- route suggestions through the unmodified confirmation machinery;
- use loopback transports and fake providers for determinism;
- keep consumed packages as-is; put shared glue in a minimal new module only when genuinely shared;
- keep the extension surface consumer-only.

### Don't

- don't patch `packages/ai-proposal` (or any consumed package) to fix an integration gap — escalate instead;
- don't let a hung provider stall the path or leak an exception past the wrapper;
- don't derive, cache or patch status locally on any surface;
- don't special-case AI past confirmation, policy, or any contract invariant;
- don't introduce a real provider SDK, network dependency, packaging or bundling work;
- don't add per-surface command vocabularies or a second composition root.

## 8. Reuse / license risk

Low: this task composes first-party workspace packages and pinned first-party toolchain. No external spec text or third-party source needs to be copied. Any justified new dependency follows the provenance-recording rule above.

## 9. Validation boundary

This Reference Pack does not prove T017. The later Builder produces an exact candidate; T017 concern Validation must execute the convergence matrix (`TEST_MATRIX.yaml`) on that exact candidate; Fresh Independent Review is separately required (`review:required`, `risk:high`). Version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
