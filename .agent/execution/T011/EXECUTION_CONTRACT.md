# T011 Execution Contract — declarative Recipe engine, bounded discovery and collection semantics

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #30, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T011` / Issue `#30`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- JIT branch: `task/v0.1.0-t011-recipe-discovery-collection`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (PR #52)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T011_recipe-discovery-collection.md@2e4a3b178bb33a41ff8e47307a3915c4a0ca872d`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`
- Preferred executor: High-capability Builder

## Owned write boundary

T011 owns only what the Frozen Task Pack declares: Recipe schema/interpreter, bounded discovery orchestration, collection/member identity handling, continuation admission and selection/confirmation workflow logic. This is the L2 `deterministic discovery/S5-S6/HITL` boundary — the `core/discovery/` and `core/recipe-runtime/` responsibility seams of the L2 logical map (responsibility map, not a mandated file layout).

The exact base already contains the T002 canonical contract layer in `packages/domain-contracts` (`@xdownload/domain-contracts`): AcquisitionContract decode/confirm/successor (`decodeAcquisitionContract`, `confirmContract`, `deriveSuccessorContract`, `admitCollectionContract`), scope grammar and continuation decode (`decodeRequestedScope`, `decodeContinuationScope`, `validateScopeContinuationPair`, `sameScopeIdentity`), SelectionSnapshot build/validate/immutability (`buildSnapshot`, `validateSnapshotSemantics`, `assertSnapshotImmutable`, `planRetryOfFailedMembers`, `deriveSuccessorSnapshot`), budget domains (`decodeBudgetProfile`, `budgetRemaining`, `canStartNewDiscoveryWork`, `canTransferAfterDiscoveryExhaustion`), typed evidence (`decodeEvidenceRecord`, `canServeAsIndependentValidationOracle`, `assertNoDiscoverySelfCertification`), S1–S6 representations, multidimensional result model and the `DomainGateway` surface seam. T011 consumes these canonical values; it does not restate or re-derive them.

The Builder may create the minimal new package(s) under the existing `packages/*` workspace seam needed to satisfy T011, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

### Forbidden scope

Do not implement or redesign (Frozen Task Pack forbidden scope, restated without weakening):

- arbitrary shell execution, unrestricted JavaScript, unrestricted filesystem access, unrestricted cookie/token export, arbitrary host scanning (PRD §23; L2 invariant 15);
- recursive frontier / general crawl / general site frontier / continuous recrawl (PRD §14; L2 D5) — `admitCollectionContract` already encodes the admission boundary, T011 must not bypass it;
- budget-as-scope: continuation must never be inferred from available DiscoveryBudget; "continue until budget runs out" is not a valid user scope (PRD §10.1);
- silent candidate replacement or post-confirmation membership growth (PRD §12);
- byte-transfer engines, HLS/media assembly, persistence/ledger, scheduler/budget-ledger ownership (T006/T008/T009), browser observation/auth broker (T010), AI proposal adapter (T012), CLI/Desktop surfaces (T013/T014), core runtime integration (T015);
- mutations to `@xdownload/domain-contracts` semantics, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T011 Task Pack.

## Required semantic outputs

1. **Declarative Recipe schema/interpreter** (PRD §23; L2 §6.6; ADR-007): `RecipeDefinition` as declarative data — recipe identity/schema version, applicability scope, matcher, parameter schema, allowed capabilities from a finite typed capability vocabulary, evidence rules, validation requirements, failure conditions, deterministic fallback. The interpreter executes only matcher → capability plan → policy/scope validation → bounded execution → typed evidence; every active navigation must be traceable to the confirmed AcquisitionContract.
2. **Finite capability vocabulary**: capabilities are enumerated, typed and auditable, limited to the Product allowed-tool class (PRD §14: observe current page/network/player/frames, collect candidates, scroll current page, open confirmed member detail, follow declared collection continuation). `scroll_current_page` is a capability, never implicit scope authority. No capability may express arbitrary shell/JS/filesystem/cookie-export or recursive navigation; unknown/undeclared capabilities fail closed.
3. **Bounded discovery orchestration** (L2 D5): resolves/finalizes the frozen target set for admitted collection contracts; produces `CandidateSet C` and membership evidence as canonical typed values; never creates a URL frontier; never transfers bytes.
4. **Current-page snapshot semantics (S5, PRD §10.1 R01)**: membership frozen from the confirmed current-page membership snapshot without executing a continuation action; default `continuation_scope = NONE`; passive completion of evidence for already-frozen members MAY continue; scroll/load-more/continuation-edge members are excluded unless the confirmed contract carries the matching explicit continuation scope.
5. **Declared continuation bounds (PRD §10.1/§10.2)**: `DECLARED_BATCH_COUNT(n)`, `DECLARED_PAGE_RANGE(a..b)` (1-based logical collection pages anchored to the collection root; member detail pages and iframe content do not increment page count; infinite-scroll/load-more is a continuation relation, never a numbered page), `DECLARED_NATURAL_END` (only for a supported collection with a validated natural-end relation). Reaching a frozen requested bound is `USER_SCOPE_REACHED`; budget exhaustion can never be reinterpreted as natural end or end of user scope (exact §10.2 tuple: PARTIAL/PARTIAL/COMPLETE/TRUNCATED/DISCOVERY_BUDGET_EXHAUSTED).
6. **Continuation admission and successor admission (PRD §10.1/§12)**: with `continuation_scope = NONE`, any later "load more / include more" requires successor AcquisitionContract + successor SelectionSnapshot (use `deriveSuccessorContract`/`deriveSuccessorSnapshot`); with an explicit continuation scope, continuation stays within the exact frozen scope; any enlargement creates successor identity. Silent candidate replacement and retry-adding-members are forbidden (`planRetryOfFailedMembers` domain only).
7. **Collection/member identity handling (PRD §11, §19)**: identity correspondence, never count equality; member detail/CDN transitions are provenance-bound locator changes that preserve logical member identity; unrelated locator substitution may not inherit identity; duplicate-replacing-missing with equal count is not completeness.
8. **Selection/confirmation workflow logic (PRD §13, §21; HITL)**: AUTO/ASSISTED/MANUAL_SELECTION interaction priority (one scope-level confirmation → one batch/group confirmation → small number of material item confirmations → manual selection UI; C30). Confirmation evidence proves selection only; it cannot self-certify target quality/membership truth (C26, C34) and cannot waive required validation (C27). Task-local selection is not reusable membership knowledge without distinct validated provenance (C31).
9. **S5/S6 slice semantics (PRD §28)**: S5 current-page resource collection and S6 explicit playlist/gallery collection behave exactly as the frozen slice fields declare — supported membership relations only, provenance-bound cross-origin/CDN delivery, finite or naturally terminable collections, truthful partial/truncated/unknown failure, no count-based completeness.

## Required invariants / invalid states

Fail closed when a discovery/continuation/confirmation state violates Frozen Product semantics. T011 must reject at least:

- creating or following a URL frontier, recursive link space or crawl/filter scope (C06), including via user declaration;
- admitting continuation because DiscoveryBudget remains, or deriving continuation width from budget values;
- adding members to a confirmed `continuation_scope=NONE` contract without successor identity;
- exceeding an exact `DECLARED_BATCH_COUNT(n)` / `DECLARED_PAGE_RANGE(a..b)` scope; treating declared bound exhaustion as natural-end evidence;
- claiming natural end from a failed next page, missing next control, or pagination loop (C03);
- `VERIFIED_COMPLETE` claims from count equality, declared/observed max items, page limit, timeout or budget exhaustion alone (C01, C14, §19);
- silent snapshot member drift or candidate replacement (C11); retry adding replacement/new members (C12);
- Recipe capability outside the finite vocabulary; recipe-declared validation requirements being skipped or self-certified by discovery inference (§22);
- confirmation being counted as target-quality/membership evidence (C26/C27/C34);
- scope primitives or continuation forms outside the PRD §10 grammar being accepted at admission.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- new package naming and internal file decomposition under `packages/*` (L2 names `core/discovery` + `core/recipe-runtime` as responsibilities, not required paths);
- Recipe data encoding in-repo (typed TS data structures vs validated decode-from-unknown at trust boundaries — both must runtime-validate untrusted input);
- matcher expression form, provided matching is deterministic, declarative and auditable;
- internal orchestration shape (pure decision functions vs small state machine), provided all scope/continuation/budget decisions remain deterministic and testable from canonical inputs;
- fixture organization and helper APIs.

These choices must not weaken or reinterpret required semantics, must not rewrite T002 contracts, and must not move authority into surfaces.

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

T011 concern Validation is separate from this prep task and must additionally prove the T011 S5/S6 + C01-C34 collection fixture matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T011 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (including any need for a non-declarative Recipe capability or frontier API — ADR-007/D5 are frozen; capability extension is "controlled ADR capability extension", never local invention).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T011. Current durable execution facts are the materialization terminal, the Issue #30 DAG position, the T002 closeout (PR #52 merge `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
