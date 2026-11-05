# Task Pack R1 — V022-U05-DESKTOP-ADAPTER-S1-DIRECT

> TASK_PACK_STATE: OWNER_APPROVED_SCOPE / INDEPENDENT_R1_REVIEW_REQUIRED / GENERATION_2_BUILDER_CLAIM_REQUIRED
> Task: #352
> Parent: #310
> Amendment authorization: #354 comment 6623288615
> Supersedes for future mutation: R0 Task Pack blob `e29c487caa6ebff2a81e527f3c39bbc2bad10f3a`
> DAG: `docs/architecture/v0.2.2/U05_DESKTOP_S1_IMPLEMENTATION_DAG_R1.md`
> Product blob (immutable): `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
> L2 blob (immutable): `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
> Exact WIP base: `ea0eecd65a1c317fc43e9eb20356c5b5f9d6dbcd`
> Exact WIP tree: `870657c54eecae9721a6b06221828a6bdfdfbb0d`
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`

## Goal

Expose the existing Core S1 direct-acquisition path and read-only S1 job-index query through the Desktop adapter. Use the CLI sequence only as a mapping reference; do not implement a Desktop transfer engine.

## Exact exclusive write set — 6 paths

1. `apps/desktop/src/adapter.ts`
2. `apps/desktop/src/commands.ts`
3. `apps/desktop/src/manager-documents.ts`
4. `apps/desktop/test/core-authority.test.ts`
5. `apps/desktop/test/manager-documents.test.ts`
6. `apps/desktop/test/s1-direct-acquisition.test.ts` (new)

No other path is permitted. T02 does not own Core Seam, Core Runtime, CLI, shell, Host, package manifests, lockfile or CI.

## Required implementation contract

1. Preserve the existing Desktop `SUBMIT_CONTRACT` and Core-produced confirmation workflow.
2. After accepted confirmation, build/send `EXECUTE_S1_DIRECT_ACQUISITION` with canonical snapshot/member/artifact identities and the accepted aggregate binding.
3. Preserve the actual `DESKTOP_UI` Peer surface. Never rewrite it to `CLI`, omit the Peer, or spoof a different caller.
4. Default `declaredRedirectHosts` to the selected URL host only, matching CLI; do not widen redirect policy.
5. Optional digest/content-type/total-byte fields remain absent from the U05 form.
6. Command acceptance is admission only; current and terminal truth comes from Core `READ_PROJECTION`.
7. Add typed `LIST_S1_JOB_PROJECTIONS` adapter access and strict validation of envelope, item projections, aggregate bindings, `totalCount`, `truncated` and the 200-item bound.
8. Preserve request identity across retry/reconnect for the same logical command; no new local durable store.
9. Project manager rows from Core facts only; no guessed output path, destination, progress, ETA or terminal success.

## Deterministic Mock Transport contract

- Adapter mapping tests must use a deterministic injected/mock SeamClient transport and must remain inside the six-path write set.
- The injected transport must capture the exact outgoing envelopes and Peer identity, then return explicitly test-fixture responses for the adapter mapping path.
- Assert that the outgoing command retains `peer.surface = DESKTOP_UI` and the correct accepted aggregate/contract binding.
- Mark all such tests and evidence as **ADAPTER_UNIT / MOCK_TRANSPORT_ONLY**.
- Mock acceptance is not evidence that Core accepted DESKTOP_UI, that `authorizePeer` passed, or that any Core security gate works.
- Do not use a scripted transport that silently rewrites Desktop to CLI or returns a fabricated Core success while claiming end-to-end admission.
- If no existing injection point can be used within the six paths, stop and report the exact blocker; do not expand the write set without a new Owner decision.

## Required tests

- Valid URL → preview/confirm → exact S1 command envelope through injected transport.
- Outgoing Peer identity remains DESKTOP_UI; accepted aggregate binding and canonical payload are exact.
- Invalid URL / failed confirmation / rejected submit sends no S1 command.
- Redirect host defaults to URL host only; optional delivery constraints remain absent.
- Command acceptance is not presented as completion; projection refresh controls status.
- Strict index response shape/bounds/identity validation; typed refusal/disconnect is not an empty successful list.
- Duplicate/reconnect behavior preserves logical request identity.
- Existing cancel/retry behavior and all prior Desktop adapter tests remain intact.
- Every mock-based result is labelled adapter-unit evidence only; no Core admission claim.

## Combined-candidate acceptance boundary

Actual Core admission of the DESKTOP_UI S1 command must be verified only after T01's reviewed Core change is separately Owner-integrated into WIP. T03/combined-candidate end-to-end tests must use the real Core Seam route and prove:
- DESKTOP_UI command admission succeeds only after the existing per-frame Peer authorization;
- CLI behavior remains intact;
- other surfaces remain rejected;
- accepted aggregate/Lineage and all S1 constraints remain enforced;
- durable index and same-install/same-user behavior are correct.

T02 alone must not claim this end-to-end result.

## Existing generation-1 claim and worktree

The generation-1 Builder reported a clean task worktree and no source mutation. Before any source mutation:
1. Re-read exact WIP and task branch base/tree.
2. Read the R1 pack and verify the unchanged six-path write set.
3. Publish a fresh accepted generation-2 CAS `DISPATCH_CLAIMED` bound to this R1 pack, exact base/tree and exact write set.
4. Stop if base changed or any dirty/out-of-scope file is found.

## Required gates

- Independent review of this R1 Task Pack must PASS before generation-2 Claim.
- Exact-base current branch and Task Pack/manifest refs.
- Node 24 syntax and changed-file Prettier before focused tests/CI.
- Focused Desktop adapter tests, typecheck, aggregate `pnpm run ci:verify`, local Docker Woodpecker exact-SHA SUCCESS.
- Independent Exact-SHA source review after implementation.

## Forbidden

- No mutation outside the exact six paths.
- No Core Seam/Core Runtime/CLI/Host/shell/package manifest/lockfile changes.
- No new transfer engine, K, scheduler, journal, ledger or durable store.
- No per-download outputRoot/destination picker/reveal, guessed path, synthetic progress/ETA, S2–S6 or real external download.
- No Native Host, registry, main/version, tag, release or deployment side effect.
- No WIP merge without separate Owner authorization naming exact candidate HEAD/tree.
