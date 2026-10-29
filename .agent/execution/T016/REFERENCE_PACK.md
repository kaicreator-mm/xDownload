# T016 L3 Reference Pack — browser + collection workflow integration

Task: `T016` / Issue `#35`  
Bound base: `version/v0.1.0@4166b51841709bd74cedf1dd89cfcf8f373c38a1`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not preselect a browser-driver dependency or redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository test seams (exact base)

Primary test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, discovering `packages/*/test/**/*.test.ts`.

The base already contains the patterns T016 flow tests should extend rather than reinvent:

- `packages/core-runtime/test/focused-core-integration.test.ts` — composed end-to-end runtime flow testing (the shape T016 S2/S5/S6 flow tests build on);
- `packages/core-runtime/test/fixture-http.ts` — `ControlledHttpFixture`: deterministic localhost HTTP fixture, programmed per test, every request recorded, no third-party network. Reuse this discipline for S2/S5 delivery-redirect/CDN fixtures;
- `packages/browser-auth-broker/test/provenance-redirect.test.ts`, `native-host-session.test.ts`, `allowed-origins.test.ts` — broker-side binding/expiry/transport rejection patterns;
- `packages/browser-observation/test/message-gate.test.ts`, `observation-handoff.test.ts` — gate/handoff patterns;
- `packages/discovery-recipe/test/continuation-successor.test.ts`, `confirmation-workflow.test.ts`, `slices-s5-s6.test.ts`, `identity-accounting.test.ts` — continuation/successor/confirmation/identity patterns;
- fixture file conventions: `packages/discovery-recipe/test/fixtures.ts`, `packages/hls-vod-adapter/test/fixtures.ts`.

**Patterns to emulate:**

- flow-level tests assert on projected terminal tuples, never on glue internals;
- one fixture/oracle mapping per applicable C-counterexample (see `TEST_MATRIX.yaml`);
- negative cases adjacent to positive ones (expired capability next to live capability; provenance-bound redirect next to unrelated redirect);
- fresh fixture per case so flows cannot pass through shared mutation;
- real-browser suites separated from fixture suites so an unavailable browser cannot silently degrade a claimed-PASS suite.

Primary reference: Vitest at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11` (MIT). Already selected by T001; T016 does not introduce it.

### 1.2 Real-browser flow harness — F1 choice, not pinned

The issue's validation scope includes real-browser flows. Under `F1_BOUNDED_IMPLEMENTATION` the Builder may drive a real browser via:

1. local fixture pages + a browser automation driver of their choice (e.g. Playwright, Apache-2.0; puppeteer-core, Apache-2.0) — none is pinned by this pack;
2. loading/pointing the existing `apps/browser-extension` context at local fixture pages, exercising the T010 native-host/broker path end-to-end.

Constraints whichever is chosen:

- record exact package/version/license/provenance in the implementation evidence;
- fixtures are localhost-only; no third-party network dependency;
- a missing browser/driver yields durable NOT_EXECUTED for those suites, never fixture-substituted PASS;
- no browser-context code that owns transfer truth — the driver may only witness what the composed flow already exposes.

## 2. Contract / interface references

### 2.1 The upstream packages themselves are the primary interface authority

T016 consumes public APIs as-is. Read, do not wrap-replace:

- `@xdownload/browser-observation`: `recordObservation` / `observationProvenanceKey` (`OBSERVATION_AUTHORITY_MARKER = 'EVIDENCE_INPUT_ONLY'`), `buildObservationHandoff`, `networkObservationEvidenceCandidate`;
- `@xdownload/browser-auth-broker`: `createAuthBroker` (`AuthBroker` issue/use/revoke), `CapabilityBinding`/`decodeCapabilityBinding`/`bindingsExactMatch`/`bindingMismatchField`/`capabilityStatus`, `allocateAuthorizationContextRef`, allowed-origins/native-host/channel modules;
- `@xdownload/discovery-recipe`: `DiscoverySession*` engine, `planConfirmationWorkflow`/`recordConfirmation`/`confirmationEvidenceRecord`/`selectionAcquisitionComplete`/`assertSelectionKnowledgeReusable`, `admitContinuationRequest`/`assertContinuationWithinFrozenScope`/`deriveContinuationSuccessor`/`detectFrozenMembershipDrift`/`planFailedMemberRetry`;
- `@xdownload/core-runtime`: `createCoreRuntime`/`reopenCoreRuntime`/`closeCoreRuntime`, `registerLineage`/`resumeLineage`/`cancelLineage`, `executeDirectAcquisition`/`executeHlsAcquisition`, `projectLineageResult`, `CoreRuntimeBudgetBridge` ports.

### 2.2 Frozen semantic references

- Frozen PRD §28 (S2/S5/S6 slice contracts) and §29 (Security/Authorization Boundary) — the WHAT for every flow;
- Frozen L2 trust/scope boundaries (blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7`) — observation-only vs Core-owned authority, budget domains, evidence independence;
- C01–C34 product counterexamples (PRD §35) — filtered to the T016-applicable set in `TEST_MATRIX.yaml`.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Handoff ends authority at the canonical record

```text
browser page event / explicit attachment
→ untrusted-input gate (browser-observation messageGate)
→ provenance-bound ObservationRecord (EVIDENCE_INPUT_ONLY)
→ buildObservationHandoff → canonical handoff value
→ broker capability bound to exact (origin, target, contract, snapshot, provenance, partition, scope)
→ Core lineage submission (registerLineage → executeDirect/HlsAcquisition)
→ projectLineageResult (only terminal truth)
```

The browser lane contributes evidence and intent, never truth. Anything a test needs to assert about transfer must be observable from Core projection.

### 3.2 Capability-to-contract binding is the security hinge

Bind each acquisition to a capability whose binding tuple exactly matches the live contract/snapshot/provenance (via `bindingsExactMatch`). On any mismatch field (`bindingMismatchField`), surface the broker's typed rejection — do not rebind, re-issue, or widen. Expired capability (`capabilityStatus`) mid-flow converts to truthful AUTH-influenced partials for remaining members, never skip-and-continue.

### 3.3 Continuation only through the T011 gate

S5 builds `continuation_scope=NONE` by default. Any LOAD_MORE/INCLUDE_MORE/CONTINUE_NEXT_PAGE request passes `admitContinuationRequest` + `assertContinuationWithinFrozenScope`; admission derives a successor via `deriveContinuationSuccessor`. Budget exhaustion is a stop reason, never a continuation source. Failed retries run through `planFailedMemberRetry` on the frozen member identity set only.

### 3.4 Redirects are provenance facts

Provenance-bound delivery transitions (declared CDN) update locators with recorded provenance while logical identity persists; unrelated redirects reject. Compare against `packages/direct-acquisition/test/redirects-locator.test.ts` for the identity-vs-locator discipline, now exercised at flow level.

### 3.5 Glue decides order, upstream decides outcomes

Orchestration may sequence discovery → confirmation → snapshot freeze → acquisition and choose transports/fixtures. It may never compute a status, verdict, coverage claim, membership identity, or continuation admission itself.

## 4. Failure handling patterns

Fail closed at the composed boundary.

### Authorization failures

- expired/revoked/mismatched capability → typed truthful rejection or AUTH-influenced partial; never silent re-authorization, never absorption into COMPLETE;
- wildcard/unlisted origin or fallback transport → broker rejection surfaces unchanged; treat any glue workaround as ARCHITECTURE_CONTRADICTION.

### Discovery/collection failures

- budget exhaustion → truthful StopReason (C23), no continuation inference;
- next-page failure/loop → not natural end (C03); coverage UNKNOWN-or-TRUNCATED;
- inaccessible members → named in PARTIAL result (C10), never silently dropped.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict (e.g. integration only possible browser-owned) → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- browser/tooling unavailable → `VALIDATION_NOT_EXECUTED`, never PASS

## 5. Examples / docs mapping to T016 acceptance

| Acceptance concern (Frozen Task Pack) | Reference pattern | Required T016 proof |
| --- | --- | --- |
| S2 explicit attachment + provenance redirects | handoff→broker→`executeDirectAcquisition` flow; C29 | provenance-bound CDN transition preserves identity; unrelated redirect rejects |
| S5 current-page `continuation_scope=NONE` | confirmation→snapshot→acquisition flow; C08 | continuation-loaded members excluded without confirmed scope |
| Explicit continuation/successor snapshot | T011 continuation machinery at flow level; C11/C12 | successor identity on expansion; frozen retry domain |
| S6 finite/natural-end collection | declared CollectionIdentity + natural-end relation; C04/C06 | closure only with identity evidence; frontier rejected |
| Auth expiry/inaccessible members | broker lifecycle at flow level; C10/C24 | truthful AUTH partials; no silent skip |
| Partial/truncated/unknown truth | T007 projection through `projectLineageResult`; C02/C03/C14/C23/C25/C28 | exact frozen PRD tuples end-to-end |

## 6. Dependency/version/license facts

### Already pinned and recommended for T016 use

| Package | Exact version on bound base | License | T016 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict composition typing |
| `vitest` | `4.1.11` | MIT | executable flow/oracle tests |
| `@types/node` | `24.19.1` | MIT | node typings for fixture servers |

Sources: root `package.json` on exact base.

### New browser-driver dependency

**None is recommended or pinned by this Reference Pack.** Under `F1_BOUNDED_IMPLEMENTATION` the Builder may add a narrowly justified driver (e.g. Playwright, Apache-2.0) for real-browser suites. If added, the implementation evidence must record exact package/version/license/provenance, keep it out of product runtime paths (test/dev wiring only), and Review must confirm it introduces no Product/Architecture authority and no network reach beyond localhost fixtures.

## 7. Do / Don't

### Do

- bind every acquisition to a live, exactly-matching capability;
- let observation stay evidence-input-only at every seam;
- route all continuation through the T011 admission/successor machinery;
- project all terminal truth through the T007/core-runtime projector;
- keep fixtures localhost-only, deterministic and per-case fresh;
- record real-browser suite availability truthfully (executed vs NOT_EXECUTED);
- map each applicable C-oracle to one durable flow fixture.

### Don't

- don't let the browser/extension lane own transfer lifecycle, progress or terminal truth;
- don't introduce a second transport, wildcard origin, or secret-bearing IPC payload;
- don't infer continuation from budget, timeout, or runtime state;
- don't mutate confirmed snapshots or reuse selection across pages without validated provenance;
- don't edit consumed packages to make composition easier;
- don't build T017 (surface/AI convergence) by side door;
- don't count fixture PASS as real-browser PASS.

## 8. Reuse / license risk

Risk is low if external material (driver libraries, browser devtools docs, Native Messaging documentation) is used as interface/design reference only. Do not copy substantial external source into the repository. Record exact provenance/version/license for any new dependency in the implementation PR. Chrome Native Messaging documentation is a design reference for the already-implemented T010 framing; T016 adds no new protocol semantics.

## 9. Validation boundary

This Reference Pack does not prove T016. The later Builder produces an exact candidate; T016 concern Validation must execute the flow/oracle matrix on that exact candidate; Fresh Independent Review is separately required because the workflow-integration task is `risk:critical` and `review:required`. Version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
