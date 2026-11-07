# xDownload v0.2.1 — Qualified main Integration R1

```yaml
status: NOT_EXECUTED_R1
issue: 271
rq_decision: CONDITIONAL (RELEASE_QUALIFICATION_R1.md, merge ff1c418)
main_head_at_record: c29af4a4b89123997d03d5566ebe09ba83855fb0
version_branch_head_at_record: ff1c418913a8027abc594202d14ee93419b3fee3
recorded_at: 2026-11-01
```

## Decision: **NOT_EXECUTED** — integration not permitted by the accepted RQ

The frozen T22 contract reads: *"protected merge only when the accepted RQ
is READY and explicitly permits integration; no npm publication or
additional release claim is inferred."* The accepted Release Qualification
R1 decision is **CONDITIONAL**, not READY, and explicitly states (§5) that a
CONDITIONAL RQ does not permit main integration. Therefore:

- No qualified integration PR was created against `main`.
- No merge, no npm publication, no tag, no release claim was made.
- `main` remains at `c29af4a4b89123997d03d5566ebe09ba83855fb0`
  (re-read at record time — unchanged since the v0.2.0 integration).
- `version/v0.2.1` remains the release home at
  `ff1c418913a8027abc594202d14ee93419b3fee3`, carrying the frozen candidate
  (52a3945 lineage), all validation evidence and the full release-document
  chain (freeze → hidden → closure → RQ → this record).

## Base/diff re-read (contract requirement)

- Frozen candidate: source `52a39451dafd44ff3c2d03b93c95db78c3add126`, zip
  sha256 `9ea81169…4f6e718`, content `87a257f5…` (150 files).
- `main…version/v0.2.1` diff at record time consists of the v0.2.1 task
  implementations (T01–T11, T09-R1, T02-R1), documentation (T10), validation
  evidence (T12–T17) and release records (amendments, T18–T21, this record);
  a future integration under a READY RQ would carry exactly this lineage.

## Conditions to reopen T22

1. Execute the T17 human G0/G1 sessions (owner hands; protocol at
   `docs/validation/v0.2.1/human/PROTOCOL.md`) and obtain independent review
   of the results.
2. Execute the T13 popup-level allow-permission positive (owner click;
   procedure at `docs/validation/v0.2.1/browser/EVIDENCE.md` §9.1).
3. A successor RQ decision of READY that explicitly permits integration
   (re-decide on the same frozen candidate; only documentation-level gates
   change).
4. Optional, non-blocking: the #289 cleanliness successor and T19 hardening
   notes may land as a v0.2.2 candidate; they do not gate this lineage's
   machine-verifiable claims.

With those conditions met, a new integration record (R2) executes the
protected merge and reads back the exact `main` result. Until then,
v0.2.1 stays a **conditionally qualified release on the version branch**.
