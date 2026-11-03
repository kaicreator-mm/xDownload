# Baseline Rebind R1 — xDownload #333

Date: 2026-11-04

## Owner approval
Owner approval is recorded on xDownload #333 comment [6614278265](https://github.com/kaicreator-mm/xDownload/issues/333#issuecomment-6614278265).

## Exact refs
- Previous base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- Previous base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`
- Previous implementation: `f48a7e14567ae9d0a89a79c99bf83220961b97d5`
- New WIP base: `a3e1b22c200ef11a942dacc953e2bfecdc3db03c`
- New WIP tree: `0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7`
- Task Pack: blob `3e1fa992df6360d8896f0e007f439eefe4c8b83b` (unchanged, original two-path scope retained)

## Conflict check
The 13 commits between the old base and the new base do not touch either frozen source path. Both source base blobs are identical across the two bases:
- `apps/desktop-shell/src/renderer/renderer-main.ts`: `0a6b90dd6a1beab976459e1da431a5f324488f7f`
- `apps/desktop-shell/test/ux-r0-form-schema.test.ts`: `3e387ebda5889e6795965bd5d1cfaab6d2e4cb38`

Therefore the original implementation can be rebased without conflict or write-set expansion. This does not replace a local Git rebase, source validation or fresh review.

## Fresh gates
The old implementation's CI, Woodpecker and independent R1 are historical evidence only. They do not satisfy the new base. A fresh Local Builder claim bound to the rebound Execution Pack is required before source mutation. Re-run Node 24 syntax, changed-file Prettier, focused tests, typecheck, aggregate `pnpm run ci:verify`, local Docker Woodpecker, and Electron/Core Seam runtime fixture on the new exact candidate SHA. Then obtain fresh independent Exact-SHA review.

## Scope and prohibitions
The only source paths allowed are `renderer-main.ts` and `ux-r0-form-schema.test.ts`. No Product/L2, domain/Core/Host/IPC, manager, main, package, CI, main/version branch, release, deployment, Native Host, registry or real-download changes.
