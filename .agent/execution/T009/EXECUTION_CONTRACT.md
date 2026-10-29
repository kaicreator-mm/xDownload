# T009 Execution Contract — HLS VOD media adapter

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #28, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T009` / Issue `#28`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- JIT branch: `task/v0.1.0-t009-hls-vod-media`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (which is exactly this task's integration base)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T009_hls-vod-media.md@685e5f384c344872d23038525e1eefd3f1124145`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`
- Execution boundary (frozen): `S4 media/protocol execution`

## Owned write boundary

T009 owns only the HLS/media adapter: HLS playlist/rendition binding, segment acquisition planning under `TransferBudget`, supported media assembly/probing behind a tooling boundary, applicable manifest/segment/format/media/target validation, unsupported-topology fail-closed behavior, and the deterministic media fixtures/tests that prove them.

The exact base is a TypeScript/pnpm monorepo with `packages/*` admitted by `pnpm-workspace.yaml`; `packages/domain-contracts` (`@xdownload/domain-contracts`) already exists as the T002 canonical contract layer. The Builder may create the minimal package(s) under the existing `packages/*` workspace seam needed to satisfy T009, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests. T009 consumes the T002 canonical vocabulary through its public exports/ports; it must not fork, redefine or locally re-project contract/result/budget semantics.

### Forbidden scope

Do not implement or redesign, per the Frozen Task Pack and Frozen L2:

- No generic opaque byte path pretending HLS correctness — treating a manifest+segment topology as one opaque file transfer is exactly what L2 U6/ADR-006 reject.
- No DRM bypass and no handling of DRM/encrypted topologies beyond fail-closed `UNSUPPORTED/FAILED`.
- No universal DASH/multi-audio/subtitle/separate A/V/mux/post-processing promises; unsupported topology must fail closed.
- No Core Control Runtime, scheduler, persistence/recovery ledger, discovery/Recipe engine, browser/auth broker, AI adapter, CLI/Desktop surface or packaging work — those are T004–T006, T010–T014, T015+ lanes. T009 is an adapter, not the acquisition port owner.
- No CoverageAccounting/ResultProjector reimplementation; emit canonical records, do not project terminal truth locally.
- No mutation of `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T009 Task Pack to make implementation easier.

## Required semantic outputs

The implementation must provide, inside the owned boundary:

1. **Manifest/rendition binding.** Selection binds an explicit master-playlist/rendition (media playlist) identity derived from the selected manifest/resource; the binding is immutable for the frozen logical target once selection is made, and rendition substitution is a successor-identity event, not a silent update.
2. **Provenance-bound segment/CDN locators.** Every segment/CDN/signed locator used must descend from the selected manifest/resource provenance and stay bound to the frozen logical target (L2 invariant 4: logical target is not locator). Unrelated locator substitution must be rejected.
3. **Segment acquisition under TransferBudget.** Segment requests count against `TransferBudget` through the canonical budget semantics (PRD §15, C28): discovery-budget exhaustion does not by itself block transfer of a frozen HLS target while `TransferBudget` + `GlobalSafetyBudget` remain; budget exhaustion stops work without redefining requested scope; retry inherits remaining budget.
4. **Supported assembly/probing behind a media tooling boundary.** Assembly and probing of downloaded segments into final media stay behind a replaceable adapter port (L2 HLS VOD rules, invariant 19); the port consumes canonical effect identity and returns typed validation evidence, never adapter-local success verdicts.
5. **Applicable manifest/rendition/segment/format/media/target validation.** Final acceptance requires the applicable validation chain (L2 invariant 18: accepted artifacts require validation). Segment-count equality alone is never media validity; missing/truncated/failed segments forbid acceptance.
6. **Fail-closed unsupported topology.** Unsupported encryption/keyed segments, DRM markers, unsupported track/mux topology and required post-processing must fail closed as truthful `UNSUPPORTED/FAILED` in the canonical result vocabulary — never silently degrade to generic byte transfer or partial success (PRD S4, L2 A6, C15).
7. **Canonical record emission.** The adapter emits canonical effect/evidence/validation records via the T002 vocabulary and invariants 17/typed-evidence rules; it does not invent its own success semantics and stores no reusable secrets/keys as ordinary state.

## Required invariants / invalid states

Fail closed when inputs are malformed, identity is ambiguous, or a state combination violates Frozen Product semantics. The adapter must reject at least:

- segment/rendition/manifest input that is malformed, duplicates identities with conflicting semantics, or declares an unsupported/incompatible playlist version;
- rendition or target substitution after binding without successor identity;
- a CDN/segment locator that does not descend from the selected manifest provenance being treated as the same logical target;
- acceptance/completion claims from segment counts, byte totals, playlist closure or budget exhaustion alone;
- a missing, unreachable, truncated or failed segment being normalized into partial-but-accepted media;
- unsupported encryption/DRM/track/mux/post-processing topology being processed as plain transfer;
- budget domains being conflated (discovery budget spent to justify transfer, or transfer budget used to define/reinterpret requested scope);
- reusable credentials, signed-URL secrets or DRM key material stored as ordinary canonical adapter state;
- adapter-local success projection that bypasses canonical result/evidence semantics.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal file decomposition under `packages/*`;
- HLS manifest/playlist parsing approach: bounded deterministic parsers implemented in-repo, or a narrowly justified runtime dependency with exact version/license/provenance recorded;
- the concrete media assembly/probe tooling behind the port (e.g., external CLI tool invocation), provided the exact tool/version/license is recorded, the tool stays behind the replaceable port, and tests remain deterministic/local (no real network, no real DRM content);
- fixture organization (generated synthetic HLS manifests/segments are expected) and helper APIs;
- internal segment plan/binding representation details that preserve the required immutability/provenance semantics.

These choices must not weaken or reinterpret the required invariants, and tooling/dependency choices must not become de facto Product/Architecture authority.

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

T009 concern Validation is separate from this prep task and must additionally prove the T009 manifest/segment/media/oracle matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T009 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (e.g., being forced to implement HLS correctness as an opaque byte path or to bypass the tooling port).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base or the T002 completion identity is no longer current and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T009. Current durable execution facts are the materialization terminal, Issue #28 with native dependency on #21, the T002 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
