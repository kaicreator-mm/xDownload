# xDownload v0.2.1 — Candidate Freeze R1

```yaml
status: FROZEN_R1_PENDING_REVIEW
freeze_issue: 267
candidate_source_revision: 52a39451dafd44ff3c2d03b93c95db78c3add126
candidate_installer_zip_sha256: 9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718
candidate_installer_content_hash: 87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9
candidate_installer_files: 150
frozen_at: 2026-11-01
claims: "installed-journey claims listed below; nothing else is claimed"
```

Typographical note: the T18 claim comment's evidence prose garbled the content
hash ("87a39451-note-87a257f5"); the authoritative value is
`87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9` as bound by
T12–T16 evidence and the installer identity sidecar.

## The immutable candidate

- **Source revision:** `52a39451dafd44ff3c2d03b93c95db78c3add126` (the last
  commit that alters any shipped byte; every later `version/v0.2.1` commit is
  validation/release documentation about this candidate).
- **Windows x64 installer:** zip sha256 `9ea81169…4f6e718`, content hash
  `87a257f5…360e9` over 150 files, per-artifact contentHash:
  cli `35414eab…ca5d7`, core `2c057fd4…711da8`, desktop `63752077…be6a74`,
  extension `1257a8cb…bee86`, native-host `631f8926…d3389`; desktop executable
  `c579acaa…143c` (Electron 45.1.0 win32-x64, vendored verbatim).
- Toolchain identity (declared): node 24.21.0, pnpm 12.8.1, esbuild 0.25.12;
  K mechanism bytes sealed and SHA256SUMS-self-verified inside the core
  artifact (T02-R1).

## Gate board (post-freeze visibility)

| Gate | Issue | Outcome | Evidence anchor |
|---|---|---|---|
| T10 docs | #259 | PASS (P1 example fix applied; examples re-run on the candidate) | PR #283 @ af146ae; WP #114/#115 |
| T12 CLI installed | #261 | PASS — 31-case matrix, exit codes 0–6, CF-1 EXIT=0, live v0.2 route proven installed | PR #294 @ 661dca7; WP #122 |
| T13 Browser/Host | #262 | PASS host-level — real Chrome 156, registration readback, S2 full chain, 7-negative fail-closed matrix, privacy zero hits | PR #295 @ e754df8; WP #119 |
| T14 Desktop | #263 | PASS — packaged exe vs installed Core/Host seam; 18 PASS / 4 NOT_PROVEN / 0 FAIL | PR #297 @ bddbed2; WP #125 |
| T15 HLS | #264 | PASS — 7/7 scenarios incl. real interactive VOD download with byte-exact artifact and honest refusal states | PR #296 @ df83007; WP #123 |
| T16 Platform | #265 | PASS — hash binding, clean install, upgrade from the prior 56f9e16 candidate, uninstall, permission negatives; win32-x64+Node24 only | PR #298 @ c22299e; WP #126 |
| T17 Human study | #266 | DELIVERABLE COMPLETE; sessions NOT_RUN (human-owned) | PR #299 @ 2365dec; WP #128 |

## Explicit exclusions and open NOT_PROVEN items (no silent PASS)

1. **T13 popup-level allow-permission positive** — NOT_PROVEN_HUMAN_REQUIRED
   (activeTab cannot be synthesized via CDP; owner procedure in
   docs/validation/v0.2.1/browser/EVIDENCE.md §9.1).
2. **T17 human G0/G1 sessions** — NOT_RUN; protocol frozen before data; the
   only legal upgrade is real sessions → forms → RESULTS → independent
   review. No G0 claim is made by this freeze. G1 = NOT_APPLICABLE_THIS_CANDIDATE
   (source-verified category finding).
3. **T14 acquisition reachability of the DESKTOP_UI surface** — byte-level
   acquisition is CLI-surface-only on this candidate (unseeded trusted media
   registry + desktop adapter SUBMIT_CONTRACT-only); the desktop manager is a
   truthful admission/control plane. Recorded as a product-scope boundary.
4. **T16 read-only-destination filesystem-level refusal** — NOT_PROVEN at the
   FS level (admission converges at the binding fence per the same unseeded-
   registry deployment fact); in-root success and `..`-escape refusal proven.
5. **T12 retry-success projection** — unreachable on the installed path
   (failing members only arise post-terminal; LATE_COMMAND immutability
   proven instead).
6. **#289 uninstall cleanliness (P2)** — G3 typed EPERM with Core running
   (documented order converges) and G4 dangling broker.json residue; both
   reproduced and recorded; deferred (v0.2.2 candidate or owner direction).
7. **T09-R1 review P2 residuals** — packaged-tree debug.log hygiene, lazy
   zip-header shorthand, cross-platform zip-equality unit test.
8. **Unseated platform surfaces** — Linux/macOS/Firefox/Safari/updater/signing
   are NOT_TESTED and not claimed (T16 §7, support-matrix).

## Blocking P0/P1 ledger

- #284 P1 (packaged Electron absent) — RESOLVED by T09-R1 (#285/PR #288 @ a9a49cd).
- #287 P1 (packaged Core lacked the v0.2 route) — RESOLVED by T02-R1 (#291/PR #293 @ 52a3945).
- Review-tier P1s (docs wording) — all fixed in-branch before their merges.
- **Open blocking P0/P1 at freeze: NONE.**

## Freeze rules

- This lineage (52a3945 + evidence-only commits) is the sole v0.2.1 release
  candidate. T19 Hidden runs against the frozen installer bytes; T20 closure
  reconciles this board; T21 RQ decides READY/CONDITIONAL/BLOCKED/FAIL.
- Any new source change requires a new amendment and a re-run of the affected
  gates; nothing in this freeze may be silently widened.
