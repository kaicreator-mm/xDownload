# T002 Execution Contract — canonical domain contracts, schemas and semantic kernel

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #21, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T002` / Issue `#21`
- Integration base: `version/v0.1.0@72b04774592265953671f7203d5ca0687da5b033`
- Base tree: `6c06629c70f06d1dde51be0d3aeb7a9fc046dff3`
- JIT branch: `task/v0.1.0-t002-canonical-domain-contracts`
- Dependency completion: `T001/#20` closed `state:done`, merge commit `72b04774592265953671f7203d5ca0687da5b033`
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T002_canonical-domain-contracts.md@ca43f082a9ecf083b4ca755c2706809c5fab82f4`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`

## Owned write boundary

T002 owns only the canonical domain/public contract layer and directly necessary pure semantic rules, compatibility fixtures, negative fixtures and schema/contract tests.

The exact base currently has a TypeScript/pnpm monorepo workspace with `packages/*` admitted by `pnpm-workspace.yaml`; `tsconfig.json` typechecks `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts`; `vitest.config.ts` discovers `packages/*/test/**/*.test.ts`. No product/domain package exists yet. The Builder may create the minimal package(s) under the existing `packages/*` workspace seam needed to satisfy T002, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

### Forbidden scope

Do not implement or redesign:

- Desktop, Browser Integration or CLI surfaces;
- persistence/database/recovery implementation;
- crawler/frontier/navigation engines;
- download/transfer/media adapters;
- scheduler/concurrency engine;
- authorization secret broker or credential storage;
- AI/model execution;
- packaging/release/platform qualification;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T002 Task Pack to make implementation easier.

## Required public/domain semantic outputs

The implementation must provide one Core-owned, versioned contract/schema vocabulary sufficient for later tasks to consume without inventing competing truth. At minimum it must represent and validate:

1. `AcquisitionContract` including intent, requested target, immutable requested scope, explicit continuation scope, selection policy, automation/exploration permission, budget profile, authorization context reference, optional selection snapshot reference, validation policy, stop policy and result policy.
2. `SelectionSnapshot` with stable snapshot/contract identity, collection identity where applicable, immutable scope/continuation, coverage target, requested/auth-accessible/selected membership identities or explicit basis, authorization/profile refs, selection claims, source/version marker and creation identity/time.
3. Logical identity types that separate stable target/member/effect identity from volatile locators such as redirect/CDN/signed URLs.
4. Lifecycle budget domains `DiscoveryBudget`, `TransferBudget`, `GlobalSafetyBudget` as constraints only. Budgets must never define or mutate requested scope and retry/restart must not imply replenishment.
5. Typed `Evidence`, `Validation` and result identities with claim subject/provenance/independence/scope information sufficient to prevent discovery self-certification.
6. Multidimensional terminal result representation: Request Fulfillment, Target Resolution, Selection Acquisition, Coverage, Stop Reason and Validation Summary. A single authoritative `success` boolean is not sufficient.
7. Stable adapter-facing ports/types for later lanes to submit/read canonical domain values without transferring mutable authority to surfaces/adapters.
8. Canonical representation of required support slices S1–S6 at the contract/type level only; no slice implementation belongs here.

## Required invariants / invalid states

Fail closed when data is malformed, schema versions are unsupported/incompatible, or a state combination violates Frozen Product semantics. The schema/semantic layer must reject at least:

- scope expansion/narrowing by budget or authorization context;
- adding continuation permission to an already confirmed contract without successor identity;
- retry/resume adding or replacing snapshot members;
- silent member drift where counts match but identities differ;
- locator change treated as logical-target change without provenance/binding rules, or logical-target substitution hidden as a locator update;
- `CoverageStatus=VERIFIED_COMPLETE` from count equality, limits, timeout, budget exhaustion, failed next-page, pagination loop or unproven natural end alone;
- `SelectionAcquisitionStatus=COMPLETE` when required selected members fail required validation;
- `TargetResolutionStatus=EMPTY_UNKNOWN` with Request Fulfillment `COMPLETE`;
- `TargetResolutionStatus=PARTIAL` with requested-scope `CoverageStatus=VERIFIED_COMPLETE` for the same target;
- direct single-resource results claiming collection coverage other than `NOT_APPLICABLE`;
- authorization-limited whole-collection request being marked Request Fulfillment `COMPLETE` solely because the accessible subset succeeded;
- empty selected set being treated as vacuous acquisition success;
- unknown schema fields/versions being silently accepted where they could alter authoritative semantics.

## Successor contract / snapshot rule

Any post-confirmation change that changes requested scope, continuation authority, materially changes authorization in a way that changes permissible acquisition, or requires re-enumerating changed membership must create successor identity. The original contract/snapshot remains immutable historical authority. Retry/resume of the same task uses the same frozen snapshot and can only operate on members/effects already authorized by it.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal file decomposition under `packages/*`;
- TypeScript type shapes (interfaces/type aliases/classes) and internal constructor/factory layout;
- runtime validator implementation approach, including a small new dependency if justified, provided the exact version/license is recorded and no new Product/L2 authority is implied;
- representation details for branded identifiers and version tags;
- fixture organization and helper APIs;
- whether JSON Schema is emitted/maintained in addition to runtime validators, provided one canonical semantic source remains clear.

These choices must not weaken or reinterpret the required contract/invariants.

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

T002 concern Validation is separate from this prep task and must additionally prove the T002 contract/oracle matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T002 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T002. Current durable execution facts are the materialization terminal, Issue DAG, T001 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
