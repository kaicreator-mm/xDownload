# T03 Review Checklist

- Verify PR base and exact HEAD/tree against the accepted T03 JIT Claim.
- Verify every changed path is inside packages/direct-acquisition/**.
- Reuse the existing transfer budget ledger; no second ledger or retry budget reset.
- Verify strong-validator/range resume and changed-validator restart.
- Verify reset/timeout/cancel/partial corruption never project false COMPLETE.
- Verify redirects remain within the declared single-target graph.
- Verify no new HTTP/TLS stack, unbounded retry, blind append or automatic UNKNOWN replay.
- Verify Host materialization/path/disk-full behavior was not moved into this package.
- Run scoped and root verification with Node 24.21.0 / pnpm 12.8.1.
- Record same-host direct-transfer baseline and fixture identity.
- Record P0/P1/P2 and PASS/BLOCK on exact SHA; no self-review.
