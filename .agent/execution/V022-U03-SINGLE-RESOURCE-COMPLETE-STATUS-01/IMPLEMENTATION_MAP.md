# Implementation Map — exact base 9e3ccd382311619e60b8d2a7373e8a7d34733334

| Path | Base blob | Current responsibility | Bounded correction |
|---|---|---|---|
| `apps/desktop-shell/src/renderer/renderer-main.ts` | `0a6b90dd6a1beab976459e1da431a5f324488f7f` | `verifiedComplete` predicate drives failed classification, complete count/filter, status tag and progress label. | Treat valid NOT_APPLICABLE single-resource coverage as complete only when every other authoritative completion dimension passes; show honest “已完成”. |
| `apps/desktop-shell/test/ux-r0-form-schema.test.ts` | `3e387ebda5889e6795965bd5d1cfaab6d2e4cb38` | Renderer containment and completion-dimension source assertions. | Add behavior-level predicate/label tests for single-resource and collection COMPLETE plus negative controls. |

## Read-only contract evidence

- `packages/domain-contracts/src/result.ts` blob `042d8bd9059d9d927c247e46f27642fe86ed106e`, lines 445–448: direct single-resource results must use coverage `NOT_APPLICABLE`.
- #326 real Electron/Core Seam result (comment 6594634490): valid single-resource COMPLETE was accepted by Core but shown as “ended · not completed” and counted as failed.
- The domain contract, main-process projection and Core remain outside the write set.
