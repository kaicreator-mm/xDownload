# V022-A04 Core Runtime Consolidation — Preparation R1

> STATE: OWNER_SEQUENCE_APPROVED / STAGING_INPUTS_PRESENT / TASK_PACK_R1_PREPARED
> Parent DAG: #337
> Tracking issue: #346
> Task: #357 (V022-A04-CORE-RUNTIME-CONSOLIDATION-01)
> Supersedes preparation R0 for current candidate identity only
> ADS practice input: [#1359 Delivery-First](https://github.com/kaicreator-mm/ai-development-standard/issues/1359) — Product/L2 intake only, NOT_FROZEN

## 1. Exact staging inputs

The previously Owner-approved non-WIP A04 staging sequence is now materialized.

- Staging branch: `staging/v0.2.2-a04-domain-package-integration`
- Exact A04 base HEAD: `8620090b41f4745394b8371b00307b441baecad7`
- Exact A04 base tree: `f50e1115f14c220d4ca4d9b9c16ae09e09e2989e`
- WIP remains: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
- WIP tree remains: `870657c54eecae9721a6b06221828a6bdfdfbb0d`
- Staging is exactly five commits ahead of WIP and zero commits behind. It is a separate non-WIP candidate.

Staged inputs:
- A03 PR #345, exact source HEAD `d0eafef73229daa379c58d8101f303f396a09fcf`, source tree `a653664b3027dd40657d0feb613595ca30034280`; merged to staging at `5eb0d7849242195e9ab1eae9dac54b003d9944f9`. Its R2 source review is PASS P0=0/P1=0/P2=3 at PR #345 comment 6621122923.
- A02 PR #344, exact source HEAD `330efd081a89e443d79fa27064109c4c40d17b16`, source tree `253ad057c813c1c447e05d57d5afb1737b092457`; merged to staging at `8620090b41f4745394b8371b00307b441baecad7` **as a staging input only**. Its P1 remains OPEN and is not waived.

No A02/A03 source has been integrated into WIP. Product/L2 freeze blobs remain unchanged.

## 2. Root-cause findings A04 must close

### A02 #341 — P1

The 25 S2/S5/S6 tests still use App's `slice-journey-testkit.ts`, which calls the now-throwing `assembleDownloadRuntime()` relocation sentinel. The source-colocated suites are excluded from current `ci:verify`; green CI therefore does not cover them.

A04 must migrate the testkit and all 25 S2/S5/S6 cases into Core Runtime tests included by `pnpm run ci:verify`. Do not widen A02's frozen 11-path write set or rewrite its historical evidence.

### A02 #341 — P2

1. Public S3/S4 journey signatures still expose physical store/registry Runtime types.
2. The App boundary scanner misses side-effect imports and CommonJS `require()` forms.
3. A04 must preserve the S4 second-standalone-assembly conflict scenario, not merely duplicate bridge registration.

### A03 #342 — P2

1. The actual Core SDK `load()` callsite must prove structural assignability of the Host `FileCasDocStore` to the pinned public SDK `V10DocStore`; the temporary assignment probe is not enough.
2. S3/S4 opaque `targetRef` resolution and trusted manifest/rendition/origin/budget permit derivation must live behind the single Host/Core composition. Unknown or mismatched refs must fail before segment requests and file writes.
3. A same-process close/reopen test must not be described as a child-process/crash/power-loss proof. Add a spawned-process readback only if required by the actual acceptance contract; otherwise qualify the evidence precisely. No multi-process CAS claim.

## 3. A04 ownership boundary

- Core Runtime is the only production composition root. It owns lifecycle/wiring and calls the public DomainHarness SDK `load()` once for the selected Domain App per Core process.
- Domain App owns K/S/B/C domain declarations, route vocabulary, intent grammar and journey logic. It must not own physical Host adapters or import Host.
- Domain Host owns physical adapters: direct/media bridges, targetRef registries, durable K document storage and dormant physical lineage storage.
- Core composes App and Host through stable package root exports only. No Core deep import from `@xdownload/download-domain-app/src/**` or `@xdownload/download-domain-host/src/**`.
- App and Host workspace dependencies must be one-way: App must not depend on Host; Host must not depend on App. Core may depend on both.
- Preserve one Core, one K, existing DirectHttpAdapter/HLS engine, scheduler, ledger, artifact store, budgets, digests, redirects, journal and terminal authorities. No second K, scheduler, journal, ledger, engine or persistence authority.
- T09 remains dormant. Moving its physical store to Host does not activate lineage migration, UNKNOWN resolution, SQLite or multi-process semantics.

If the pinned public SDK cannot compose the required route contributions into one K without changing frozen K/S payload bytes/identity or creating a second K, stop and report the exact SDK/API limitation. Do not bypass the single-K constraint.

## 4. Delivery-First execution

ADS #1359 is an unfrozen Product/L2 intake, not a new mandatory process. Its Delivery-First practice is applied here without weakening existing frozen contracts:
- A03 PASS is reused; do not repeat its already-passed source review or tests.
- A02 remains a truthful staging input with its P1 open.
- A04 is the next critical-path delivery because it closes the missing Core test execution and Host/Core composition.
- One bounded LOCAL_BUILDER owns implementation, repair and local validation. No standalone LOCAL_VALIDATION handoff.
- Independent Exact-SHA source review remains required after A04 because this changes the Core/Host composition and physical-effect boundary.
- PASS advances immediately to the separately authorized WIP integration decision; no repeated Owner token for ordinary in-scope work.
- WIP integration, main/version, tag, release, deployment and real external download remain outside this authorization.

## 5. Frozen A04 Task Pack

See `docs/implementation/v0.2.2/task-packs/V022-A04-CORE-RUNTIME-CONSOLIDATION-R1.md`.

- Exact write set: 34 paths.
- Exact source base/tree: `8620090b41f4745394b8371b00307b441baecad7` / `f50e1115f14c220d4ca4d9b9c16ae09e09e2989e`.
- Task Pack and Execution Pack must be bound to this exact staging candidate.
- The Builder must acquire its own accepted CAS `DISPATCH_CLAIMED` before source mutation.

## 6. Exit conditions

A04 is not complete when files are merely moved or tests are merely copied. It is complete only when:
1. The actual Core `load()` callsite compiles against the pinned SDK and the single-K invariant is tested.
2. App/Host/Core package boundaries and stable exports are enforced by tests.
3. All 25 migrated S2/S5/S6 tests execute under Core's `ci:verify`.
4. Direct/S3/S4 integration scenarios, targetRef/permit zero-effect negatives and S4 duplicate-assembly conflict are covered.
5. Node24 syntax, changed-file Prettier, focused tests, typecheck, aggregate `pnpm run ci:verify` and exact-SHA local Docker Woodpecker pass.
6. Independent Exact-SHA review passes with P0=0/P1=0.
7. A separate Owner decision names the exact combined candidate HEAD/tree before any WIP integration.
