# xDownload v0.2.1 — Release Qualification R1

```yaml
status: DECIDED_R1
issue: 270
decision: CONDITIONAL
frozen_candidate_source: 52a39451dafd44ff3c2d03b93c95db78c3add126
frozen_candidate_zip_sha256: 9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718
frozen_candidate_content_hash: 87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9
decided_at: 2026-11-01
```

## Decision: **CONDITIONAL**

The machine-verifiable release claim set below is PASS on the immutable
frozen lineage. The qualification is CONDITIONAL because two human-owned
gates remain open by design and are explicitly NOT claimed; READY requires
the stated conditions. No release-blocking P0/P1 is open.

## 1. Rechecked lineage (this RQ, not inherited)

- Candidate: source `52a39451dafd44ff3c2d03b93c95db78c3add126`, zip
  `9ea81169…4f6e718`, content `87a257f5…` (150 files); every installed-path
  gate (T12–T16), the packaged-exe smoke, and the hidden runs bind to these
  exact hashes.
- Freeze integrity re-read: CANDIDATE_FREEZE_R1.md (d8e9ccd lineage) lists
  the same values; closure VERSION_CLOSURE_R1.md reconciles 16 rows; the
  never-green GitHub Actions baseline is disclosed and is not a gate
  (project policy: local Docker Woodpecker exact-SHA evidence).
- Hidden validation: HIDDEN_VALIDATION_R1.md — 9/9 adversarial case groups
  PASS, zero escaped release-blocking P0/P1.

## 2. The exact claim set (what v0.2.1 claims — nothing more)

1. **Installed CLI surface (win32-x64, Node 24.21.0):** the legacy v1
   commands and the explicit `--route v0.2` Domain App route work as
   documented on the packaged candidate — 31-case matrix with exit codes
   0–6 each proven, single-JSON stdout, diagnostics on stderr, no
   transport fallback; CF-1 EXIT=0; the v0.2 route reaches the K composition
   (ACCEPTED → real projection; typed refusals only, never
   V02_INTENT_VALIDATOR_UNAVAILABLE).
2. **Browser extension + Native Messaging Host (Chromium, host level):**
   real-Chrome S2 full chain with registration readback, artifact bytes ==
   oracle, CLI pipe readback; 7-negative fail-closed matrix; zero credential
   residue.
3. **HLS VOD journey (controlled):** real interactive selection→confirmation
   →bounded download with byte-exact artifact and media validation; live /
   no-ENDLIST / AES-128 / broken-segment cases refuse truthfully.
4. **Desktop shell (packaged Electron 45.1.0):** packaged exe boots against
   the installed Core/Host seam; truthful admission/control/recovery
   (cancel, restart recovery ×3), frozen 9-key renderer bridge, isolation +
   CSP + navigation guards rechecked, Host/Core mismatch fail-closed.
   Byte-level acquisition is CLI-surface-only (product-scope boundary,
   stated).
5. **Platform/install lifecycle:** clean install, upgrade from the prior
   56f9e16 candidate (refuses silent overwrite; documented sequence
   converges), uninstall (with the #289 P2 cleanliness residuals recorded),
   destination-root enforcement. win32-x64 + Node 24 only — nothing else
   claimed.
6. **Security posture:** hidden adversarial validation of path / identity /
   permission / recovery / duplicate / redirect / credential / renderer-IPC
   / lineage-owner families — zero escapes.

## 3. Conditions for READY

1. **T17 human G0/G1 sessions executed and independently reviewed** (owner
   hands, ≈30–45 min/person, protocol frozen in
   docs/validation/v0.2.1/human/). Until then NO G0/G1 claim exists; task
   PASS alone cannot infer one.
2. **T13 popup-level allow-permission positive** (owner click, ≈15 min,
   browser/EVIDENCE.md §9.1) — the single remaining browser-surface gap.
3. Optional (not READY-blocking, tracked): #289 uninstall cleanliness fix in
   a successor candidate; T19 hardening notes.

## 4. Not claimed (explicit)

Human effort parity (G0/G1); popup-level permission UX; desktop byte-level
acquisition; Linux/macOS/Firefox/Safari; auto-update; code signing; store
distribution; any AI feature (G1 = NOT_APPLICABLE_THIS_CANDIDATE, a
source-verified category finding); retry-success projection on the installed
path; filesystem-level read-only-directory refusal.

## 5. Consequence for T22

Per the frozen T22 contract ("protected merge only when the accepted RQ is
READY and explicitly permits integration"), a CONDITIONAL RQ does NOT permit
main integration. T22 records NOT_EXECUTED with this decision as the reason;
main stays at c29af4a4b89123997d03d5566ebe09ba83855fb0 and the version branch
remains the release home until a READY re-decision after §3.
