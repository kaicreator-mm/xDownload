# T11 Review Checklist

- Verify exact base/HEAD/tree and write set tests/v0.2.1/** only.
- Confirm every fixture has a stable case ID and REAL/FAKE/PURE classification.
- Confirm controlled HTTP listeners are loopback-only and always closed.
- Confirm real filesystem tests use temp directories and clean up.
- Confirm restart/duplicate tests do not create a second accepted artifact.
- Confirm cancel/reset preserve partial/UNKNOWN truth.
- Confirm changed validator never appends across representations.
- Confirm bad path, permission, Host mismatch and corrupt output fail closed.
- Confirm owner conflict refuses and no dual writer is possible.
- Confirm redaction checks cover logs/events/evidence without exposing secrets.
- Confirm fake injected failures are never substituted for installed gates.
- Run scoped and root tests on Node 24.21.0 / pnpm 12.8.1; record exact SHA and results.
- Record P0/P1/P2 and PASS/BLOCK; no self-review.
