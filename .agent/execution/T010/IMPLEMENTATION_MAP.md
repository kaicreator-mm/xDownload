# T010 Implementation Map — exact base `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T010 use / constraint |
| --- | --- | --- |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies | Modify only if narrowly necessary for T010 package/test/native-host wiring. Do not broaden scripts into downstream product execution. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | T010 browser/broker code belongs under these existing seams. Native-host runtime may need a non-Node runtime; record exact runtime/version if so. |
| `tsconfig.json` | strict TS; `noUncheckedIndexedAccess`; includes `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts` | New T010 TypeScript source/tests should fit the existing include patterns unless a bounded config change is strictly required. |
| `vitest.config.ts` | Node environment; includes `packages/*/test/**/*.test.ts` | T010 unit/negative/broker tests should fit this seam; real-browser tuple checks may need a bounded runner addition recorded as F1 evidence. |
| `eslint.config.js` | root lint authority established by T001 | T010 code must remain compatible; any edit must be tooling-only and directly necessary. |
| `packages/domain-contracts/` | T002 canonical contracts: opaque `AuthorizationContextRef` (branded identity in `src/ids.ts`, used by `contract.ts`/`snapshot.ts`), `decode.ts` fail-closed decode, `ports.ts` `DomainGateway`/`SurfaceCommand`/terminal projection, result/scope/budget/evidence/slices modules | Read/consume as the only canonical vocabulary for refs, contracts, snapshots, results. T010 must not fork or locally redefine these identities. |
| `packages/toolchain-smoke*/` | T001 toolchain smoke packages | Leave outside T010 concern. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics (§6.2 Browser Integration, §8 contract, §16.5/§17 auth accounting, §29 secret rules, S2 slice, C21/C24/C29) | Read-only authority. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7`: §6.4 browser/auth trust zones and candidate controls, §12 security seams, ADR-005, invariants 11–14, Research Demo #8 evidence/limitations | Read-only authority; the tested-tuple and limitation facts bind T010 closeout honesty. |
| `docs/implementation/v0.1.0/task-packs/T010_browser-observation-auth-broker.md` | frozen T010 WHAT blob `6a8505d2001009cd64ca63b80ecb97d51ec9a71f` | Read-only task authority. |
| `.agent/execution/T010/` | JIT pack created by this prep on the T010 task branch | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** browser extension package, no Native Messaging host/broker implementation, no auth capability store, no Core runtime, no transfer adapters and no product surface packages. T010 must create the minimum browser/auth seam itself rather than wiring into non-existent integration (T015/T016 own that convergence).

L2 ADR-012 keeps the concrete platform/IPC matrix replaceable: T010 proves one real tuple, not a portable framework. L2 also explicitly records (Research Demo #8, issue `#8` terminal comment `5954331493`) that the seam is proven only for Chromium `144.0.7559.96`/Linux; that research code is evidence/reference — promote validated invariants and limitations, do not bulk-copy research fixtures into production.

This absence is not permission to invent downstream architecture. T010 stops at the browser/auth boundary and its tests.

## Suggested bounded decomposition — non-authoritative F1 choice

The Builder may choose package split under `packages/*` (and/or an `apps/*` extension host seam). The pack does not freeze names. Whatever layout is chosen should keep these concerns explicit and separately testable:

- untrusted message schema/size gate (content-script → extension boundary);
- observation collection with provenance (tab/frame/origin/request) and handoff into canonical contract/evidence shapes;
- Native Messaging host process and message framing under `allowed_origins`;
- broker capability issue/use/revoke/expiry with opaque `AuthorizationContextRef` output and exact-tuple binding plus optional partition context;
- secret-zone containment/redaction at every exit sink (Core-durable, log, evidence, Recipe, model);
- tests: unit/negative in the existing Vitest seam plus the real-tuple harness for `TEST_MATRIX.yaml`.

## Expected test placement seam

The existing runner discovers `packages/*/test/**/*.test.ts`. T010 tests should cover:

- malformed/oversized/unknown-field message rejection before privilege;
- binding-matrix positives (exact match accepts) and negatives (origin/target/contract/snapshot/provenance/partition mismatch rejects);
- expiry/revocation truthfulness (`AUTH_REQUIRED`/`AUTH_FAILED`, no widening);
- `allowed_origins` enforcement and absence of any fallback path;
- secret-sink audits over the tested exit sinks;
- provenance-bound redirect acceptance vs unrelated redirect rejection (C29);
- at least one end-to-end check on the real browser/native-host tuple, with the tuple identity durably recorded.

No persistence/recovery, scheduler, transfer/media, Recipe, AI or Desktop/CLI behavior belongs in T010 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T010 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`6a8505d2001009cd64ca63b80ecb97d51ec9a71f`, `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
