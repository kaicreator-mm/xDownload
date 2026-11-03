# Execution Contract — V022-A03 Domain Host Boundary

## Exact identity

- Task: xDownload #342; parent #337.
- Task Pack: docs/implementation/v0.2.2/task-packs/V022-A03-DOMAIN-HOST-BOUNDARY.md@planning/v0.2.2-domain-package-architecture-r0@c009e17a9e9ceb8832f2953c1220c5024d0f1a75#blob:96c4134a7bd07357471cb5ad6c49a3691a190b80
- Exact WIP base: a3e1b22c200ef11a942dacc953e2bfecdc3db03c
- Base tree: 0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7
- Task branch target: `task/v022-a03-domain-host-boundary`
- Integration target: `wip/v0.2.2-ui-rebuild-r0` only.
- Exact write set: the 14 paths in MANIFEST.yaml and Task Pack #342.
- Pinned ADS: v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`.

## Execution authority

This pack is dispatch preparation, not a Builder Claim. The actual Local Builder must re-read the WIP ref/tree, Task Pack, Execution Pack and ADS contract, then publish its own accepted schema-conforming `DISPATCH_CLAIMED` before source mutation. Do not fabricate or reuse another agent's Claim.

## Goal

Remove Host→App source imports, consume neutral A01/A01B Host request contracts, and place physical SDK document-store and dormant T09 plain-file adapters behind Host-owned implementations.

Preserve permit checks, targetRef opacity, operation/slice binding, budget, digest, atomic materialization, cancellation and existing HLS engine behavior. Keep T09 dormant.

## Required implementation

1. Direct Host bridge validates `validateDirectHostAcquisitionRequest` from neutral Contracts before permit, registry, network or filesystem effects.
2. TargetRef registry uses neutral A01 token grammar and raw-locator rejection; no App imports.
3. S3 media bridge validates A01B `validateS3MediaHostAcquisitionRequest`, pinned to `media.acquire + S3`.
4. S4 media bridge validates A01 `validateS4HostAcquisitionRequest`; recomputes tuple digest in Host from freshly fetched master facts and cross-checks byte-identical behavior.
5. Media permit grammar/constants come from neutral Contracts; preserve permit schema and origin/budget checks.
6. Move the physical FileCasDocStore implementation into Host storage. Preserve SDK V10DocStore semantics, CAS, temp+rename atomicity, and restart behavior. Use a narrow structural interface if the Host package must not add the SDK dependency; A04 proves assignability at the actual Core load call site.
7. Move PlainFileLineageStore physical file I/O behind Host migration. Preserve LineageStore structural shape, schema/revision checks and typed errors. It remains dormant; do not add a Core caller.
8. Add Host package-boundary regression test: no static, side-effect, relative deep, dynamic or CommonJS source import from App. Prefer AST-backed parsing if compatible with existing tooling; do not add dependencies/manifests.

## Validation sequence — syntax before CI

1. Re-read exact base/tree, Task Pack, this Execution Pack and accepted Claim.
2. Node 24 syntax parse/transpile check all changed TS/JS files.
3. Changed-file Prettier check.
4. Focused Direct, S3, S4, FileCasDocStore and PlainFileLineageStore tests.
5. Host package tests.
6. `pnpm run typecheck`.
7. `pnpm run ci:verify`.
8. Local Docker Woodpecker exact-candidate-SHA SUCCESS; record Build ID, pipeline, backend, clone/verify exit codes and URL.
9. Independent Exact-SHA review; no self-review.

Do not start CI if syntax preflight or changed-file formatting fails.

## Stop conditions

- WIP base/tree moved; rebind pack and Claim first.
- Any write outside the exact 14-path set.
- Any Host import from App remains after migration.
- A01/A01B neutral contract does not accurately represent the current Host request.
- S4 tuple digest is not byte-identical or not recomputed from fresh master facts.
- Permit, targetRef, origin, budget, digest, cancellation, atomic materialization or durable-store semantics change.
- Need to edit App, Contracts, Core, package manifests, lockfile, CI, apps, SDK or vendor.
- T09 is activated, becomes a second route authority, or UNKNOWN is auto-cleared.
- New K, Journal, Scheduler, transfer engine, SQLite/native driver or multi-process CAS claim is introduced.

## Integration boundary

The historical Owner WIP authorization on parent #337 explicitly covered PRs #335, #330, #331 and #334. It does NOT by itself authorize merging A03 PR #345 (or A02 PR #344). Obtain a fresh Owner authorization naming the exact PR heads after independent Exact-SHA review. After implementation, open a PR targeting WIP and write evidence to #342. Do not merge the PR; Web Controller performs currentness review and WIP integration. No main/version merge, release, deployment, real external download, Native Host or Windows Host side effect.
