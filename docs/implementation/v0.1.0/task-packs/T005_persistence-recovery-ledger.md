# T005 — SQLite persistence, durable ledger and recovery

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement production SQLite + filesystem authoritative persistence, schema/migrations, stable command/work/effect/artifact lineage, lifecycle-budget facts, staged/materialized/finalized/accepted distinctions and deterministic DB/filesystem reconciliation.

## Authority / dependency
Frozen L2 ADR-003/004/010/013 and #7 evidence limits; exact dependency `T002`.

## Owned boundary
Persistence adapter, migrations, filesystem artifact store, recovery/reconciliation. One authoritative writer path only.

## Forbidden scope
No exactly-once claim; no host-power-loss guarantee; no DB-only final success; no new acceptance after durable cancel-before-accept; no PostgreSQL/server expansion.

## Acceptance / Validation
Real SQLite/filesystem process-kill/restart tests; DB-first/FS-first recovery; migration forward/backward safety as designed; digest/provenance binding; missing/corrupt bytes never become success; duplicate effects/artifacts converge.

## Policy
`review:required`; `risk:critical`; L3 `required`; local real-host Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Any need to alter cancellation/acceptance semantics → Architecture Amendment. Close with exact schema/migration/recovery evidence; broader durability remains unproven.
