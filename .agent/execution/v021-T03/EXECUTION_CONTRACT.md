# T03 Execution Contract — Transfer reliability and safe files

## 1. Authority and exact subject

Frozen authority:
- DAG blob: ecb2e31088c9e3895fad042401f737938c37628a
- Task Pack blob: c0cbed29ffa1a47cad5aed288aa262dd0dd549a8
- Product/L2/DAG reviewed subject: 07af78c3abee741196ff566a7f21fdfe15d71da7
- ADS: 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
- Integration baseline after T01 closeout: version/v0.2.1@e71ff24c4d4e04e86bb7771c23309b55e4fb5a16, tree 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 dependency: Issue #250 CLOSED; PR #272 merged as e71ff24c4d4e04e86bb7771c23309b55e4fb5a16.
- Native dependency readback: T03 #252 blocked_by #250; predecessor is closed. Preserve the edge as DAG history.

- Task Issue: #252 (v021-T03), risk critical, independent review required.
- Frozen Task Pack: docs/implementation/v0.2.1/TASK_PACKS_R0.md@planning/v0.2.1-user-release@1cffd6445308ac78fa2f9e4489af579f0deb32ef#blob:c0cbed29ffa1a47cad5aed288aa262dd0dd549a8
- Task branch: task/v0.2.1-t03-transfer-reliability-safe-files, created from the exact integration baseline above.
- Exclusive Builder write set: packages/direct-acquisition/** only.
- This pack is subordinate to the frozen Product/L2/DAG/Task Pack; it does not amend them.

## 2. Frozen Task Pack requirements

- Output: bounded transient retry within existing budgets; resume only with range support and stable remote/local identity; safe partial-file identity; filename/path sanitation; collision policy; atomic finalize after validation.
- Acceptance: timeout/reset/disk-full/redirect/changed-validator/path traversal/collision/partial-corruption tests; no false COMPLETE, no duplicate accepted artifact; same-host direct-transfer baseline recorded.
- Forbidden: no new HTTP/TLS stack, unbounded retry, blind append, automatic UNKNOWN replay or new ledger authority.

## 3. Existing seams to reuse

- packages/direct-acquisition/src/direct-http-adapter.ts: current single-target transfer, redirect guard, cancellation, byte streaming and canonical outcome projection.
- identity.ts: strong-ETag resume planning and range-response classification.
- integrity.ts: transfer/format/target/media validation; transfer never alone accepts an artifact.
- port.ts: canonical request, partial-state, transfer budget and outcome types.
- Existing tests: budgets-retry.test.ts, resume-validators.test.ts, redirects-locator.test.ts, integrity.test.ts, s3-guarded-transport.test.ts.
- Reuse the existing authoritative TransferBudgetLedgerPort; do not create another ledger or reset budget across attempts.

## 4. Required bounded implementation and evidence

1. Prove retry is bounded by existing TransferBudget and retry request counters; no hidden retry loop and no new allocation on retry.
2. Resume only when a strong validator and supported range response prove identity. Changed validator, weak/missing validator, unsolicited 206, invalid Content-Range or range mismatch must restart safely or refuse; never append uncertain bytes.
3. Timeout, connection reset, mid-stream failure and cancellation preserve partial/UNKNOWN truth and never emit COMPLETE from incomplete bytes.
4. Redirects remain within the frozen single-target delivery graph and the existing maximum-hop policy; no locator or scope widening.
5. Partial state is bound to the same effect/target lineage. Corrupt or mismatched partial state must not be accepted as a completed artifact.
6. Keep file-system ownership in the existing Host bridge. DirectHttpAdapter returns bytes/outcome; packages/download-domain-host/src/direct/direct-acquisition-bridge.ts owns path containment and temp+rename materialization and is OUTSIDE this Task write set. Do not edit Host files from T03. Disk-full/atomic-materialization cross-layer proof must be supplied by the T11 fixture lane or explicitly reported as an upstream boundary gap; do not fake a disk write inside this package.
7. Record a same-host direct-transfer baseline using deterministic local fixture traffic; identify fixture, byte size, elapsed measurement method and toolchain. Do not use arbitrary public internet sources.

## 5. Non-goals and stop conditions

- No new HTTP/TLS client or redirect stack.
- No unbounded retry, blind append, budget replenishment, silent target replacement or automatic UNKNOWN replay.
- No Host, Core runtime, persistence, CLI, Desktop, Browser, manifest/lockfile or product scope changes.
- If an acceptance item requires a path outside packages/direct-acquisition/**, stop and route evidence to T11 or request a scoped Task amendment; never widen the write set.
- Do not claim installed Windows, real Host or disk-full PASS from unit tests.

## 6. Verification

Pinned toolchain: Node 24.21.0, pnpm 12.8.1.
- Scoped: pnpm exec vitest run packages/direct-acquisition/test
- Root: pnpm run ci:verify
- Read-only cross-layer regression: pnpm exec vitest run packages/download-domain-host/src/direct
- Every result must bind exact task HEAD/tree, exact base, Node/pnpm, fixture identity, commands and exit codes.
- Independent Reviewer must re-read exact HEAD and aggregate diff. Builder cannot self-review.
