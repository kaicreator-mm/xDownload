# Execution Contract — v022-U03-SINGLE-RESOURCE-COMPLETE-STATUS-01

## Identity and exact baseline

- Task: xDownload #333.
- Task Pack blob: `3e1fa992df6360d8896f0e007f439eefe4c8b83b`.
- WIP target: `wip/v0.2.2-ui-rebuild-r0`.
- Exact base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`.
- Base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`.
- Task branch: `task/v0.2.2-u03-single-resource-complete-status`.
- Write set: exactly `apps/desktop-shell/src/renderer/renderer-main.ts` and `apps/desktop-shell/test/ux-r0-form-schema.test.ts`.
- Pinned ADS: v4.18.0 `2c395c55569fe2edf3f4135f12d3d069e526d0b7`.

## Authority

Owner policy #305 comment 6586392596 authorizes an actual Local Agent to use `role=builder`, `execution_profile=LOCAL_BUILDER`, `execution_environment=LOCAL` for bounded implementation. This Execution Pack is not a Builder Claim; the Local Agent must publish its own accepted schema-conforming `DISPATCH_CLAIMED` before source mutation.

## Required behavior

- A present TERMINAL row is complete when targetResolution=RESOLVED, selectionAcquisition=COMPLETE, requestFulfillment=COMPLETE, validationSummary.status=ALL_PASSED, and coverage is either VERIFIED_COMPLETE or NOT_APPLICABLE.
- NOT_APPLICABLE is required for direct single-resource results by the domain contract. Do not modify that contract.
- Keep VERIFIED_COMPLETE collection behavior unchanged.
- A completed NOT_APPLICABLE row displays “已完成”; do not say “已验证完成” or imply coverage evidence was measured.
- Incomplete, partial, failed, cancelled, missing and stale projections remain non-complete.
- Complete counts, filters, status tag and progress text all use the same completion predicate.

## Required evidence

1. Re-read exact base, Task Pack, Execution Pack and accepted claim.
2. Node24 syntax/type preflight and changed-file Prettier before CI.
3. Focused renderer test with behavior-level valid single-resource COMPLETE and collection COMPLETE cases, plus non-complete controls.
4. Typecheck and one aggregate `pnpm run ci:verify`.
5. Local Docker Woodpecker exact candidate SHA, Build ID, pipeline and exit codes.
6. Independent Exact-SHA review required.
7. Re-run real Electron/Core Seam single-resource COMPLETE fixture if available from #332; otherwise mark runtime recheck NOT_RUN.

No Core, domain contract, manager, IPC, Host, main, package, CI or manifest changes. No main/version merge, release/deployment or real side effects.
