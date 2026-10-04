# T004 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T004 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; gates `format:check`/`lint`/`typecheck`/`test:unit`/`ci:verify` | Modify only if narrowly necessary for T004 package/test dependency wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T004 command/query seam code belongs under the already-existing `packages/*` seam. `apps/*` is outside T004. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T004 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T004 seam/transport/negative tests should fit this existing test seam. |
| `eslint.config.js` | root lint authority established by T001 | T004 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 output: `@xdownload/domain-contracts`, pure ESM package — `DomainGateway` (`submitContract`/`confirmSnapshot`/`appendEvidence`/`projectTerminalResult`, all `unknown → DomainValidationResult<T>`), branded ids (`ContractId`, `SnapshotId`, `LogicalTargetId`, `MemberId`, `EffectId`, `EvidenceId`, `AuthorizationContextRef`, ...), fail-closed `decode*` validators, `DomainValidationResult` diagnostics, schema identity/versioning (`DOMAIN_CONTRACTS_SCHEMA_ID`/`_VERSION`, supported-major-version gate) | **The primary T004 integration seam.** Commands/observations decode payloads through these decoders; rejections reuse `DomainValidationResult`/diagnostics; command correlation ids are new T004-layer identities distinct from domain ids; envelope versioning follows the same supported-major-version fail-closed pattern. Do not fork, patch or wrap-around its semantics. |
| `packages/toolchain-smoke-core/`, `packages/toolchain-smoke/` | T001 smoke packages | Leave outside T004 concern unless an unavoidable root-toolchain compatibility repair is necessary. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics through Stage 1 freeze record | Read-only authority: §6.3 CLI first-class, §6.4 deferred surfaces, §8 contract projection parity, §27 CLI Contract, §35 counterexample corpus. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7` | Read-only authority: §6.1 authority topology/Local Command/Query Port, §6.3 command transaction, §6.8 idempotent command identities/duplicate submit, §9 platform constraints, §10 ownership/synchronization, §11 failure/restart/idempotency, §11.1 AR-F01 precedence, §12 security boundary, ADR-001/010/011/012/013. |
| `docs/implementation/v0.1.0/task-packs/T004_core-command-query-boundary.md` | frozen T004 WHAT blob `b3b6bdd6f47f0e6908222c8fe9e42dc69ad31f36` | Read-only task authority. |
| `.agent/execution/T002/`, `.agent/execution/T004/` | JIT packs (T002 by Issue #51; T004 by this prep) | Guidance/evidence only. Never ship as product content; not implementation source. |

## Integration with packages/domain-contracts

- **Payload admission is delegated.** A command payload is untrusted wire data; it becomes a canonical value only by passing the existing `@xdownload/domain-contracts` decode/validate functions (e.g. `submitContract`/`decodeAcquisitionContract` for submit commands, snapshot/evidence/result decoders for their command kinds). T004 adds no second decoder vocabulary.
- **Typed rejections are shared.** Seam-level rejections (bad envelope, oversized input, unauthorized peer, idempotency conflict) use the same `DomainValidationResult`/diagnostic style so surfaces receive one rejection shape.
- **Identity separation.** Command/idempotency identity, peer identity and revision counters are T004-layer concepts. They must be type-distinct from `ContractId`/`SnapshotId`/`EffectId` and must never be accepted as substitutes for domain identity in canonical values.
- **Version discipline.** The envelope carries its own schema identity/version gate mirroring the `domain-contracts` supported-major-version fail-closed pattern; the two version spaces are independent but both fail closed.
- **Projection read side returns read-only canonical values.** Reading a projection must not hand surfaces mutable authority over contracts, snapshots, budgets or results (frozen L2 §6.7: per-surface status derivation remains rejected).

## Current absence facts that matter

At the bound base there is **no** command/query seam package, no transport implementation, no peer authorization implementation and no CLI/Desktop/Browser adapter. T004 must create the minimum seam-layer surface. It must not pre-build T005 persistence, T006 scheduler or T013/T014/T016 adapters; "CLI/browser/Desktop can be clients" is proven at the seam contract/port level, not by building those surfaces.

This absence is not permission to invent later architecture. T004 stops at the command/query server/client seam, wire compatibility, peer authentication/authorization, input validation and lifecycle-independent client behavior.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose one package or a very small split under `packages/*`. The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit:

- versioned command/query envelope codec (encode/decode/framing) with declared bounds;
- command registry/handler seam mapping command types to Core-owned operations;
- idempotency/revision gate (identity seen, payload equality, expected revision);
- input bounds policy (size/depth/field/declared-limits) enforced before authority transition;
- peer identity + same-install/same-user authorization decision;
- transport-neutral server/client ports plus the one F1-chosen concrete local transport;
- projection read facade over canonical state reads;
- lifecycle-independent client side (submit, reconnect, replay-with-same-identity) as a library the later adapters consume;
- tests mapping to `TEST_MATRIX.yaml`, including applicable C-oracle mappings.

Do not split by Desktop/Browser/CLI product surface and do not add persistence, scheduler, network transfer, media or browser-extension implementations.

## Dependency decision seam

The exact base has no runtime dependencies beyond the T002 workspace package. A new runtime transport/validation dependency is therefore a material T004 implementation choice, not an assumed base capability. Under F1 the Builder may:

1. implement the transport with Node built-ins and deterministic validators in-package; or
2. add one narrowly justified runtime dependency.

If option 2 is chosen, the implementation candidate must record exact package/version/license/provenance and demonstrate that dependency semantics do not redefine Product/L2 authority or become the de facto peer-authorization trust root. The JIT pack intentionally does not preselect a transport or library.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T004 tests should remain package-local and deterministic and should cover:

- envelope encode/decode success for legal commands and queries;
- unknown/incompatible envelope version rejection;
- malformed/oversized/deep payload rejection before authority transition;
- unauthorized/foreign peer rejection and authorized same-install/same-user admission;
- idempotent replay convergence, conflicting-payload duplicate rejection, revision mismatch rejection;
- Core restart + client reconnect/re-submit without duplicate effects; late-command-after-terminal handling;
- projection read-only semantics and absence of surface-owned budget/result state;
- applicable counterexample oracles from `TEST_MATRIX.yaml`.

No real second machine, real browser, real Desktop shell, real database or real network transfer harness belongs in T004 concern tests. If the F1 transport is a real loopback socket/pipe, tests exercise it locally and deterministically.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T004 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match;
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
