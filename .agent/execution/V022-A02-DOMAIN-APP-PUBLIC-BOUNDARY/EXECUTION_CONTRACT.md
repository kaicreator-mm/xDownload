# Execution Contract — V022-A02-DOMAIN-APP-PUBLIC-BOUNDARY

## Identity and baseline

- Task: xDownload #341; parent #337.
- Task Pack blob: 6e1101e51505b18a30c310b5ba0c2052b5e189e0.
- Planning reference: planning/v0.2.2-domain-package-architecture-r0@1c4dea041a00db526d6ef99450460d86d1001997.
- WIP integration target: wip/v0.2.2-ui-rebuild-r0.
- Exact expected base: 5880731aa84601373c028e45f2ec0380e521686f.
- Base tree: d49b4a72ef54bcc8db1f354c394d44650fbec412.
- Task branch: task/v022-a02-domain-app-public-boundary.
- Exact write set: the 11 App paths listed in Task Pack #341.
- Pinned ADS: v4.18.0 2c395c55569fe2edf3f4135f12d3d069e526d0b7.

## Execution authority

The Task Pack has independent review PASS. The pinned v4.18.0 schema has no WEB_BUILDER profile; ADS v4.19 PR #1358 is still Draft and is not adopted. Therefore source mutation must be performed by an actual LOCAL_BUILDER / LOCAL executor. Never label a Web executor as Local.

This Execution Pack is preparation, not a Builder Claim. The actual Local Agent must re-read GitHub, verify the exact base and pack, and publish its own accepted schema-conforming DISPATCH_CLAIMED before source mutation.

## Goal

Remove App-to-Host source imports and narrow the App public root without changing domain behavior, sealed K/S/B/C identities, module bytes, Business Intent semantics or operation IDs.

## Transitional compatibility

The current Core route still deep-imports App FileCasDocStore, InMemoryMediaTargetRegistry and the S4 bridge ABI seam. Keep these internal paths temporarily so this Task remains integration-safe. They must not be re-exported by the App public root. A04 owns moving Core to Host-owned adapters and deleting the App compatibility implementations.

Do not modify Core in this Task. Do not remove the current deep-import symbols until A04 is ready.

## Required implementation

- Remove the four App-to-Host import edges listed in the Task Pack.
- Switch media registry targetRef validation to A01 neutral Contracts.
- Replace broad root exports with a curated App-owned public API.
- Keep K/S/B/C declarations, sealed BUILD producer, Business Intent validators, semantic rules, Workflow and domain journeys.
- Remove production Host assembly exports from the App public root.
- Keep temporary Core compatibility classes/functions internal only.
- Preserve App-level pure tests; record all runtime integration cases moved to Core A04.
- Do not modify T09 policy or activate its dormant lineage ledger.

## Validation order — syntax before CI

1. Re-read current WIP ref, exact base/tree, Task Pack, this Execution Pack and accepted Claim.
2. Node 24 syntax parse/transpile check for every changed TS/JS file.
3. Changed-file Prettier check.
4. Focused App domain, seal, intent and journey tests.
5. pnpm run typecheck.
6. pnpm run ci:verify.
7. Local Docker Woodpecker exact-SHA SUCCESS; record actual Build ID, pipeline, backend, exit codes and URL.
8. Independent Exact-SHA review; do not self-review.

Do not start CI if syntax preflight fails. GitHub Actions are not used.

## Stop conditions

- WIP base moved or task branch is stale.
- Any write outside the exact 11-path write set.
- Any App source import from Host remains.
- Any root export of Host runtime assemblers, bridge pins or physical adapters remains.
- Any changed K/S/B/C identifier, sealed module byte/hash, Business Intent, operation ID or user-visible behavior.
- Any Core/Host/Contracts, package manifest, lockfile, CI, SDK or vendor change.

## Integration boundary

The historical Owner WIP authorization on parent #337 explicitly covered PRs #335, #330, #331 and #334. It does NOT by itself authorize merging A02 PR #344 or A03 PR #345. Obtain a fresh Owner authorization naming the exact PR heads after independent Exact-SHA review. Before any merge, re-read current WIP HEAD, verify exact changed paths and independent review, and run the required gate at the actual integration SHA. No main/version merge, tag, release, deployment, real download, Native Host or Windows side effect.


## Rebase validation addendum — 2026-11-04

The original dispatch/Claim base above remains the historical identity. After A01B PR #343 integrated, the same 11 source blobs were replayed unchanged onto WIP base `a3e1b22c200ef11a942dacc953e2bfecdc3db03c` / tree `0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7`. The current candidate is `330efd081a89e443d79fa27064109c4c40d17b16` / tree `253ad057c813c1c447e05d57d5afb1737b092457`. See [REBASE_VALIDATION_2026-11-04.md](./REBASE_VALIDATION_2026-11-04.md) for exact blob identity, syntax/Prettier, tests, typecheck and Woodpecker #20 evidence. This is a validation rebind only; it changes no write-set permission. Independent Exact-SHA review of the rebound commit is still required.
