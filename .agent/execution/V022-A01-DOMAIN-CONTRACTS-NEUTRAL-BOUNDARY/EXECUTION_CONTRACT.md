# Execution Contract — V022-A01-DOMAIN-CONTRACTS-NEUTRAL-BOUNDARY

## Identity and baseline

- Task: xDownload #335; parent #337.
- Task Pack blob: `60b73fc67022cf6cc6ee45d878d57a163187f778`.
- Planning reference: `planning/v0.2.2-domain-package-architecture-r0@1d48bc3dc8ab23173f6d4df7b7d1329fff3e6500`.
- WIP integration target: `wip/v0.2.2-ui-rebuild-r0`.
- Exact expected base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`.
- Base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`.
- Task branch: `task/v022-a01-domain-contracts-neutral-boundary`.
- Exact write set:
  1. `packages/domain-contracts/src/download-host/**`
  2. `packages/domain-contracts/src/index.ts` — additive export only
  3. `packages/domain-contracts/test/download-host/**`
- Pinned ADS: v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`.

## Execution authority

Owner direction is recorded in xDownload #335 comment #6602507630. The general bounded Local Builder authorization is #305 comment #6586392596. The pinned v4.18.0 schema has no WEB_BUILDER profile; ADS v4.19 PR #1358 is still Draft and is not adopted. Therefore this task must use an actual LOCAL_BUILDER / LOCAL executor. Never label a Web executor as Local.

This Execution Pack is current preparation, not a Builder Claim. The actual Local Agent must re-read GitHub, verify the exact base and pack, and publish its own accepted schema-conforming `DISPATCH_CLAIMED` before source mutation.

## Goal

Add only the narrow neutral Host-operation contracts genuinely shared by Domain App and trusted Host. Keep Business Intent, K/S/B/C declarations, route-table/BUILD validation, domain policy, Workflow definitions and semantic recipe in Domain App.

## Contract boundary

Neutral Contracts may contain:
- Host-facing Direct acquisition request DTO and exact validator.
- Host-facing S4/media acquisition request DTO and exact validator, including selection facts that Host must independently re-check.
- Typed EffectEnvelope and MaterializedEvidence output contracts consumed by App, Host and Core.
- Opaque targetRef grammar and raw-locator negative helper where both App and Host need the same grammar.
- Narrow shared port types only where both sides require identical types.

Do not add:
- Business Intent definitions or user confirmation semantics.
- K/S/B/C declarations or operation vocabulary.
- Host I/O, filesystem, network, registries, runtime assembly, K, Permit or Journal implementations.
- App/Host/Core imports, Node APIs or DomainHarness SDK imports.
- Dependencies, package manifest edits or lockfile changes.

App must project its validated Business Intent into the narrow Host DTO. Host independently validates the DTO before any physical effect. Do not create divergent duplicate validators.

## Required implementation outcomes

1. Exact, bounded, no-widening schemas with unknown-key rejection.
2. DTOs contain only fields required by the Host operation; no UI-only or Agent-only fields.
3. Host-side validators reject malformed, raw URL/path locators, path escape, invalid digest/byte counts and stale/invalid S4 selection inputs before I/O.
4. EffectEnvelope accepted/running states remain non-terminal; only typed terminal outcomes settle.
5. MaterializedEvidence remains digest-backed and output-root bounded.
6. Neutral package remains pure and I/O-free.
7. No App public export, manifest, lockfile, SDK, ABI or product behavior change in this Task.

## Validation order — syntax before CI

1. Re-read current WIP ref, exact base/tree, Task Pack, this Execution Pack and accepted Claim.
2. Node 24 syntax parse/transpile check for every changed TS/JS file.
3. Changed-file Prettier check.
4. Focused domain-contracts tests for the new DTOs/validators and negative cases.
5. `pnpm run typecheck`.
6. `pnpm run ci:verify`.
7. Local Docker Woodpecker exact-SHA SUCCESS; record actual Build ID, pipeline, backend, exit codes and URL.
8. Independent Exact-SHA review; do not self-review.

Do not start CI if syntax preflight fails. GitHub Actions are not used.

## Stop conditions

- WIP base moved or task branch is stale.
- Any write outside the exact three-path write set.
- Need to move Business Intent, K/S/B/C, route-table or Workflow policy.
- Need for Contracts to import App, Host, Core, Node I/O, network or SDK.
- Need for divergent duplicate validators.
- Any product behavior, permission, IPC, Provider, protocol, SDK/ABI or persistence authority change.
- Any attempt to add package dependencies, change manifests or pnpm-lock.yaml.

## Integration boundary

Implementation and validation do not imply merge. No WIP integration, main/version merge, tag, release, deployment, real download, Native Host, registry or Windows side effect is authorized by this pack. Re-read the WIP head and obtain explicit Owner integration authorization before any integration.
