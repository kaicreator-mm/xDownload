# T01 Review Checklist

- Verify exact task branch HEAD and diff against the frozen integration base.
- Confirm every changed file is inside the frozen Builder write set.
- Confirm job, attempt, progress, error and owner projections use strict deterministic decoders.
- Confirm unknown total is not zero and has no percentage or ETA.
- Confirm the v0.2 route is explicit and legacy protocol decoding remains compatible.
- Confirm missing provider and ambiguous owner fail closed with typed refusal.
- Confirm existing no-widening intent validation is reused without changing its package.
- Confirm invalid input cannot reach journal, command acceptance or external effect.
- Confirm shared cross-surface parity fixtures are identical.
- Confirm no runtime, scheduler, persistence, UI, Host or transfer implementation was added.
- Verify with Node 24.21.0 and pnpm 12.8.1; record exact HEAD and full test results.
- Record independent P0/P1/P2 and PASS/BLOCK for the exact SHA.