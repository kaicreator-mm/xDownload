# T11 Execution Contract — Validation harness and controlled fixtures

## 1. Authority and exact subject

Frozen authority:
- DAG blob: ecb2e31088c9e3895fad042401f737938c37628a
- Task Pack blob: c0cbed29ffa1a47cad5aed288aa262dd0dd549a8
- Product/L2/DAG reviewed subject: 07af78c3abee741196ff566a7f21fdfe15d71da7
- ADS: 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
- Integration baseline after T01 closeout: version/v0.2.1@e71ff24c4d4e04e86bb7771c23309b55e4fb5a16, tree 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 dependency: Issue #250 CLOSED; PR #272 merged as e71ff24c4d4e04e86bb7771c23309b55e4fb5a16.
- Native dependency readback: T11 #260 blocked_by #250; predecessor is closed. Preserve the edge as DAG history.

- Task Issue: #260 (v021-T11), risk high, independent review required.
- Task branch: task/v0.2.1-t11-validation-harness-controlled-fixtures, created from the exact integration baseline above.
- Exclusive Builder write set: tests/v0.2.1/** only.
- This pack creates validation fixtures/harnesses; it does not implement production behavior or claim installed gates.

## 2. Frozen Task Pack requirements

- Output: reusable direct/HLS fixtures and corpora for restart, cancel, UNKNOWN, duplicate, changed validator, bad path, permission, Host mismatch, corrupt output, owner conflict and redaction.
- Acceptance: real Host/network/file effects where required; fakes are labelled and never substitute for installed gates.
- Forbidden: no secrets, arbitrary internet dependency or tests that silently clear UNKNOWN.

## 3. Fixture architecture

Create a version-scoped test harness under tests/v0.2.1/** with:
- deterministic fixture registry and stable case IDs;
- controlled loopback HTTP servers for direct and HLS manifests/playlists/segments;
- temporary-directory artifact roots for real local file writes, digest checks and cleanup;
- reusable restart/cancel/duplicate/owner-conflict/redaction scenario definitions;
- explicit fixture classification: REAL_LOOPBACK_NETWORK, REAL_TEMP_FILESYSTEM, INJECTED_FAILURE_FAKE, PURE_CONTRACT.
- each case records whether it performs real network/file effects, which module it exercises, expected terminal truth, cleanup behavior and secret-redaction expectations.

No arbitrary public internet, credentials, real user directories, real browser profiles, production Host endpoints or secrets.

## 4. Required scenario corpus

1. Restart/recovery: durable accepted effect is replayed/reconciled without duplicate external transfer or duplicate accepted artifact.
2. Cancel: preflight and mid-stream cancellation stop subsequent work; partial bytes remain partial and never become COMPLETE.
3. UNKNOWN: missing/ambiguous authoritative state remains UNKNOWN; no fixture helper or assertion converts UNKNOWN to zero/success.
4. Duplicate: same idempotency identity converges; conflicting duplicate rejects; no duplicate file/materialization.
5. Changed validator: strong ETag/range change forces safe restart; no cross-representation append.
6. Bad path: traversal, drive/root confusion, separators and symlink/containment escapes reject before network/file effect.
7. Permission: denied write/rename/parent access yields typed failure and no accepted artifact.
8. Host mismatch: permit/intent/Host identity mismatch rejects before network/file effect.
9. Corrupt output: digest or final media validation mismatch leaves no accepted artifact.
10. Owner conflict: old-core/new-k conflict or unknown ownership refuses; no dual writer.
11. Redaction: bearer-like query, cookie/token or private path values do not enter durable event, fixture report or logs.

## 5. Real-vs-fake evidence rules

- REAL_LOOPBACK_NETWORK uses a real local listener and real HTTP client; it proves deterministic transport behavior only, not public internet or installed user network.
- REAL_TEMP_FILESYSTEM writes to a unique temporary directory, reads back bytes and verifies digest/atomic rename; it proves local filesystem behavior only.
- INJECTED_FAILURE_FAKE is a controlled injected error (e.g. permission denied/disk-full simulation) and must be labelled FAKE in fixture metadata and evidence. It cannot satisfy a real installed filesystem gate.
- PURE_CONTRACT tests validate decoders/policies only and cannot satisfy network, file, Host or installed gates.
- Installed Host, Windows packaging, browser and user workflow gates remain NOT_PROVEN until the designated T14/T15/T16/T17 owners provide exact installed evidence.

## 6. Non-goals and stop conditions

- No production source changes; no changes outside tests/v0.2.1/**.
- No arbitrary internet, third-party credentials, tokens, cookies or user profile data.
- No fake substituted for a required real Host/network/file effect.
- No test helper that automatically resolves, clears or downgrades UNKNOWN.
- No self-validation of another task's implementation; fixture creation is concern-level only.
- If a scenario needs source changes outside this test write set, record the exact missing contract and route to the owning Task; do not patch production code here.

## 7. Verification

Pinned toolchain: Node 24.21.0, pnpm 12.8.1.
- Scoped: pnpm exec vitest run tests/v0.2.1
- Root: pnpm run ci:verify
- All fixtures must clean up temporary directories and close loopback servers in finally/afterAll.
- Record case ID, fixture classification, exact task HEAD/tree, Node/pnpm, command and exit code.
- Independent Review is required; real-effect claims must cite the real loopback/temp-file evidence and remain distinct from installed gates.
