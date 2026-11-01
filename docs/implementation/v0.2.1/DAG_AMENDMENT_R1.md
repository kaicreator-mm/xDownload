# xDownload v0.2.1 — DAG Amendment R1 (minimal successor admission)

```yaml
status: ADMITTED_PENDING_MERGE
amendment_id: v021-DAG-AMENDMENT-R1
triage_issue: 284
successor_issue: 285
source_baseline: version/v0.2.1@56f9e16d8d7afb29b2a493c07bdf4f886a0bf445
amended_by: "owner direction (2026-11-01 session), recorded in #284 issuecomment-6553144081"
frozen_reference: "docs/implementation/v0.2.1/TASK_DAG_R0.md + TASK_PACKS_R0.md @ planning/v0.2.1-user-release@1cffd6445308ac78fa2f9e4489af579f0deb32ef (Task Packs blob c0cbed29ffa1a47cad5aed288aa262dd0dd549a8; same-commit DAG blob ecb2e31088c9e3895fad042401f737938c37628a)"
frozen_files_edited: NONE
tasks_added: 1
tasks_reopened: 0
claims: NONE
```

## Purpose

Close the P1 release-path gap found by #284: the composed Windows x64 installer
ships exactly four artifacts (cli, core, extension, native-host) and therefore
contains no packaged Electron executable, while the frozen T14 contract
(#263) requires a **real packaged Electron executable** running against the
installed Core/Host seam. This amendment admits exactly ONE architecture-preserving
successor of T09 and nothing else. The frozen Product/L2/DAG files are NOT
edited; this additive amendment is the sole additional authority.

## Added task — T09-R1 (successor of T09; Issue #285)

- **Depends on:** T09 #258 (CLOSED; merged as 56f9e16), #284 admission record.
- **Blocks (additive edges):** T14 #263, T16 #265, T18 #267.
- **Risk:** critical. **Review:** independent exact-SHA required.
- **Exclusive write set:** `build/**; installers/**; scripts/install-host/**; apps/desktop-shell/package.json`.
- **Output:** the packaged desktop artifact — the existing apps/desktop-shell
  shell and the pinned Electron 45.1.0 — inside the audited Windows x64
  installer payload, with per-artifact identity, allowlist and SHA256SUMS
  coverage, plus a real packaged-executable launch/IPC/renderer smoke on
  Windows x64 (win32-gated in CI exactly like T09's real-compose suite; real
  evidence recorded on #285).
- **Acceptance:** #284 items 1–3 and 5, verbatim:
  1. Reuse the existing Electron shell and pinned Electron 45.1.0 to produce
     one deterministic, installable Windows x64 desktop artifact, integrated
     with the existing one Core/Host and the existing secure preload — never a
     second daemon/kernel.
  2. Add the executable and required runtime bytes to the selected installer
     allowlist and hash/closed-tree audit; ship no tests, build evidence,
     unversioned dependencies or source secrets.
  3. Add exact-SHA package composition and real packaged-executable
     launch/IPC/renderer smoke on Windows x64; a standalone source Electron
     smoke does not satisfy this gate; fail-closed behavior and user identity
     on Core/Host mismatch are preserved.
  4. (5) Independent exact-SHA review + local Docker Woodpecker Node24
     evidence; merge to `version/v0.2.1` only; T14 #263 and T16 #265 updated
     with the corrected installer artifact SHA/paths.
- **Forbidden:** reopening T09's closed scope; touching `apps/desktop-shell/src/**`
  runtime semantics; a second Core/K or new trust boundary/persistence owner;
  non-Windows platform claims; edits to the frozen planning artifacts.

## Edge materialization note

The original 22-task DAG's 63 edges are native GitHub dependencies
(TASK_ISSUE_MATERIALIZATION_R2, bidirectional readback PASS). No public API
mutation exists to add further native dependency edges (`addIssueDependency`
is unavailable via GraphQL/REST), so T09-R1's additive edges are authoritative
in THIS document and cross-referenced in comments on #263/#265/#267. The
frozen 63 native edges are unchanged.

## Amendment rules

- This amendment merges to `version/v0.2.1` BEFORE any T09-R1 source write
  (admission-first; #284 explicitly withholds a source-write grant from the
  triage issue alone).
- T09-R1 requires its own accepted single-writer JIT `DISPATCH_CLAIMED` on the
  exact current version/v0.2.1 head before mutating source.
- No other task, write set, platform claim or frozen artifact is affected by
  this amendment. Any further scope change requires a new amendment.
