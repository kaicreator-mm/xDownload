# Research Demo Report — Issue #7 Durable Ledger + Filesystem Recovery

## Identity

- Research Issue: `#7`
- Baseline SHA: `44fd0fc7287b45735f069263c87486e6585fd7ae`
- Consumed dependency SHAs: `version/v0.1.0@44fd0fc7287b45735f069263c87486e6585fd7ae`; ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`
- Tested research harness HEAD: `5ed0cb63f30103786c8de7a74a265ed0378173a2`
- Final research HEAD: recorded in the terminal Issue #7 closeout after this report/evidence commit, because a commit cannot embed its own resulting SHA.
- Evidence Strength: `E3`
- Environment/runtime/toolchain: Linux `6.18.44` x86_64, glibc `2.41`, Python `3.13.5`, SQLite `3.46.1`, local overlay filesystem. The mount reports `fsync=volatile`; this Demo proves real process-death/reopen semantics only, not host power-loss durability.

## Hypothesis

If the authoritative local runtime uses a real SQLite store, real filesystem staging/finalization, real process termination/restart, and two independent local clients, then every tested crash window must recover without changing the frozen SelectionSnapshot, replenishing or double-consuming lifecycle budgets, accepting more than one artifact/effect for the same frozen target identity, or silently converting uncertain/failed work into success; and the durable budget/effect/artifact counters after recovery must equal the expected ledger values.

## Result

`PASS`

## Expected vs Actual

| Item | Expected | Actual | Status |
|---|---|---|---|
| S1 positive reopen | 1 effect, 1 accepted artifact, same snapshot, correct remaining budgets | effect=1, accepted=1, snapshot digest unchanged, SQLite integrity `ok`, budgets consumed once | PASS |
| S2 concurrent duplicate | two client processes converge on one lineage/effect; no double budget/artifact | client PIDs `1423/1424`; one `created=true`, one `false`; same lineage; effect=1; accepted=1 | PASS |
| S3 kill after reservation | restart without replenishment/double charge; at most one effect | SIGKILL PID `1448`, restart `1460`; effect=1; accepted=1; budgets consumed once | PASS |
| S4 kill after partial stage | partial bytes never accepted; restart resumes/revalidates | SIGKILL PID `1474`, restart `1486`; accepted=1 only after recovery; staging=0 | PASS |
| S5 kill after complete stage pre-accept | no blind duplicate; validation precedes acceptance | SIGKILL PID `1500`, restart `1512`; effect=1; accepted=1 | PASS |
| S6 filesystem/DB boundary | both candidate orderings converge truthfully | fs-first `RECOVERED_FS_FIRST`; db-first `RECOVERED_DB_FIRST`; each effect=1, accepted=1 | PASS |
| S7 cancel/retry + restart | same target/lineage, no budget reset, no second effect | durable `CANCELLED`, retry on same lineage, cancel_count=1, effect=1, accepted=1 | PASS |
| S8 corrupt staged bytes | fail closed, accepted count remains zero, reason observable | `FAILED_INTEGRITY`, `DIGEST_MISMATCH`, accepted=0, staging=1, terminal=`FAILED` | PASS |

## Observed Evidence

- Contract: `contract-e3-001`
- Snapshot: `snapshot-e3-001`
- Target: `target-e3-001`
- Snapshot digest: `5b6057ea887124721be73f4a0ac661b371a94fe7122aefb48b54b1cc84af7c4a`
- Expected/accepted artifact digest: `f7d2387a8c103e5dcd80da42141156061b33e73d462f811256e1133219fd8b07`
- Initial budgets: Discovery `3`, Transfer `2`, GlobalSafety `4`.
- Successful scenarios after recovery: reserved `0`; consumed `1` each; remaining Discovery `2`, Transfer `1`, GlobalSafety `3`.
- S8 preserves the same budget truth while rejecting the bad artifact: accepted `0`; actual corrupt digest `00283f10b3d8394d1f8efede36a214984f4da9464a0f5e125edf40ef465f1c69`.
- Every reopened database reported `PRAGMA integrity_check = ok`.
- Hard-kill markers were recorded for S3, S4, S5, both S6 orderings, S7, and S8, with a distinct fresh runtime PID after restart.
- Exact command: `python3 tests/architecture-durability/run_demo.py`
- Exit code: `0`
- Raw condensed evidence: `docs/experiments/issue-7-e3-evidence.json`
- Executed blob identities: client `f5c3084ff2bbfb15f9819b175352d527404efdca`; fixture `74b669c8ffb5af70023cd85510d835144d5d89d9`; runner `0bafbf9ecb2f9be8ec53c589ad2016f461cc505b`; runtime `3be7e26473f65989b7cfe70818f7919c53f673a7`; store `e7da7bcb1dc4d55809993453c48afb09fa1e3541`.

## Scenario Results

### Positive

S1 proves clean shutdown/reopen does not change snapshot identity, budget truth, effect count, accepted artifact identity, or digest.

### Boundary

S2 proves two independent client processes/connections submitting the same idempotency key converge to one logical lineage. S6 proves both tested filesystem/DB finalization windows can be reconciled when terminal success is derived only from a materialized validated artifact.

### Negative / Fail Closed

S8 uses deterministic wrong bytes, kills after complete staging, reopens SQLite/filesystem, and deterministically rejects the staged artifact with `DIGEST_MISMATCH`. No accepted artifact exists and terminal state is `FAILED`.

### Failure / Recovery

S3–S7 use real OS `SIGKILL` process death and fresh runtime processes. Reservation, partial staging, complete staging, filesystem-first finalization, DB-first pending acceptance, and cancellation/retry states survive reopen without budget replenishment or duplicate effect execution.

## Real Under Test

- Python OS processes with hard `SIGKILL` death/restart.
- SQLite `3.46.1` database files and WAL behavior on the local filesystem.
- Same-host filesystem staging, fsync, rename/finalization, reopen, digest validation and reconciliation.
- Unix-domain-socket command boundary to a separate authoritative runtime process.
- Two independent client processes/connections in S2.

## Deterministic Fakes

- Fixed acquisition contract/snapshot/target identity.
- Deterministic local byte producer and expected SHA-256 digest.
- Fixed lifecycle budget values.
- No external HTTP/provider/LLM/browser dependency.

## What was proven

- For the tested single-host Linux process-death windows, a SQLite-backed authoritative ledger plus filesystem staging can preserve immutable snapshot identity, non-replenishing lifecycle budget truth, stable effect lineage and single accepted-artifact identity.
- Concurrent duplicate client submission can be serialized/idempotently bound to one lineage through the authoritative runtime.
- Partial/complete staged bytes can be reconciled after real process death without being silently treated as accepted.
- Filesystem-first and DB-first pending-finalization windows can both converge if acceptance/materialization state is explicit and terminal success requires a validated materialized artifact.
- Digest mismatch remains a durable observable failure and does not become success after restart.

## What was NOT proven

- Host power loss, kernel panic, storage-controller failure, torn writes outside SQLite guarantees, or power-loss behavior of this overlay filesystem.
- Windows/macOS behavior, NTFS/APFS semantics, installer/service lifecycle, or a multi-platform matrix.
- Real network/CDN/HTTP resume behavior, browser integration/auth, HLS/media breadth, or external provider behavior.
- Performance, load, large artifacts, long-running concurrency, distributed/multi-host operation, security hardening, or production schema/migration compatibility.
- Production readiness, Architecture Freeze, Task DAG readiness, Release Qualification, or Release PASS.

## Findings

### KEEP

- Single authoritative local runtime as the only lifecycle-state writer.
- SQLite transactional ledger for snapshot/budget/command/effect/artifact identity.
- Stable idempotency/effect lineage across restart/retry.
- Filesystem staging plus digest/provenance validation before terminal success.

### ADAPT

- L2 should make `accepted` versus `materialized/finalized` state explicit and derive terminal success only from the latter.
- Recovery classification should be a first-class observable (`RECOVERED_FS_FIRST`, `RECOVERED_DB_FIRST`, integrity failure, cancel/retry lineage).
- Cancellation precedence versus automatic recovery should be defined explicitly; the Demo uses a deliberate deferred-recovery window so a durable cancel can win before retry.
- Production durability policy must state whether process-death durability is sufficient or whether power-loss durability requires stronger filesystem/platform evidence.

### DROP

- Any design that treats a SQLite commit alone as atomic with external filesystem effects.
- Any design that reports DB acceptance as final success while the accepted file is missing/unmaterialized.
- Any retry path that allocates a new target/effect identity or replenishes lifecycle budgets for the same frozen lineage.

## Architecture Implications

The evidence supports closing L2 UNKNOWN `U2` for the tested claim: the candidate local SQLite + filesystem approach is viable for single-host process-death/restart and concurrent local submissions when it includes stable lineage/effect identity, transactional budget accounting, staged artifact validation, explicit acceptance/materialization state, and deterministic reconciliation. This report is Architecture Evidence only; it does not itself freeze L2.

## Architecture Contradiction

`NONE`

No Frozen Product contradiction was observed. The tested candidate mechanism satisfied the required frozen crash/retry invariants within the stated environment and scope.

## Production Seams / Follow-up Issues

- No additional production seam was required to complete this Research Demo, so no new follow-up Issue was opened from the Demo itself.
- Production implementation remains downstream of Architecture Freeze and Task DAG, and must revalidate these invariants in the chosen production runtime/filesystem/platform tuple.
- If L2 later requires host power-loss guarantees, create a separate E3 platform/storage Research Demo rather than expanding this Issue retroactively.

## Reusable Reference Artifacts

- validated contracts/schemas: minimal ledger identities and accepted/materialized distinction in `tests/architecture-durability/store.py`.
- fixtures/scenarios: deterministic frozen snapshot/target/budgets in `tests/architecture-durability/fixture.py`.
- reference tests: S1–S8 in `tests/architecture-durability/run_demo.py`.
- failure/recovery semantics: `tests/architecture-durability/runtime.py` plus `docs/experiments/issue-7-e3-evidence.json`.

The research harness is reference evidence, not production code and must not be merged blindly into production.

## Closeout Statement

Evidence for Issue #7 is complete for the stated E3 process-death/restart hypothesis. Completion is **Evidence complete**, not Feature complete.
