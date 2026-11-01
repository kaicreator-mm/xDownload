# xDownload v0.2.1 — Hidden Validation R1

```yaml
status: COMPLETE_R1
issue: 268
frozen_candidate_source: 52a39451dafd44ff3c2d03b93c95db78c3add126
frozen_candidate_zip_sha256: 9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718
executed: 2026-11-01
executor: "independent adversarial session (not the builder of any candidate component)"
verdict: "9/9 case groups PASS — zero escaped release-blocking P0/P1"
claims: "hidden adversarial results only; visible-test summaries are not substituted"
```

## Scope and method

Adversarial probes executed directly against the FROZEN installer payload
(read-only finalval worktree; install-id `t19h`), 225 recorded steps across
nine case groups (path / identity / permission / recovery / duplicate /
redirect / credential / renderer-IPC / lineage-owner). The seam pipe speaks a
4-byte big-endian length-prefixed frame protocol; plain `net` clients are
silently dropped by OS-verified admission (proven: EPIPE, zero server
response), so impersonation cases were sent through a koffi `CreateFileW`
raw-pipe client (`SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION`, mirroring
`win-ipc.ts`) — the OS layer proves only same-user/same-logon-session, so the
envelope identity fields were fully attacker-controlled, as designed.

Full per-case findings, the environment record and all 12 replayable drivers
are committed under `raw/` next to this document.

## Result matrix

| # | Case group | Verdict | Key evidence |
|---|---|---|---|
| 1 | path | PASS | literal `..` in any separator form → `OUTPUT_ROOT_ESCAPED` before effect; relative/UNC/513-char roots → `MALFORMED`; NTFS reserved names/Unicode dots/case/symlink roots stopped by the trusted-registry fence (`CONTRACT_BINDING_MISMATCH`, zero file/network effect); extra intent fields → `SCOPE_WIDENING_REFUSED`; leak scan 0 hits |
| 2 | identity | PASS | every malformed/wrong identity → `PEER_IDENTITY_REJECTED`; S3-surface gates → `ADMISSION_REJECTED`; second Core on the same pipe → exit 5 `TRANSPORT_REFUSED`, first Core unharmed |
| 3 | permission | PASS | unauthorized/missing/malformed broker origins refused (exit 2, no fallback); a tampered `--config` passes local origin checks but every frame still fails closed (the platform boundary is the Chromium manifest, as designed); Core down → instant `TRANSPORT` exit 5, no hangs |
| 4 | recovery | PASS | real `taskkill` at 10s of a 4 MiB transfer: no partial artifact materialized; after restart `TERMINAL/UNKNOWN/NOT_STARTED` — no fabricated COMPLETE, terminal truth not rewritten |
| 5 | duplicate/concurrency | PASS | legacy same-id replay → `IDEMPOTENCY_CONFLICT` (strict, non-converging — recorded as-is); v0.2 same-id converges (`converged:true`), different lineage converges to the original acceptance (frozen semantics, no second effect); same lineage + new requestId → attempt #2 |
| 6 | redirect | PASS | cross-host undeclared redirect not followed; declared host followed to COMPLETE; redirect loop cut at exactly 5 hops; malformed/excess declarations → CLI USAGE |
| 7 | credential | PASS | query-token/userinfo/fragment/explicit-port/public-http/IP-host manifests rejected at every layer; zero credential residue across the persistent tree (only hits are the attacker's own artifacts) |
| 8 | renderer IPC (packaged exe, CDP) | PASS | node globals all undefined; `window.open` and `location.href` external navigation blocked (target count and URL unchanged); CSP `default-src 'none'` enforced, inline script not executed |
| 9 | lineage-owner | PASS | bidirectional `LINEAGE_OWNER_CONFLICT` before effect (including a K-side already-FAILED lineage); fresh lineages unaffected |

## Escaped release-blocking P0/P1

**Zero.** Four informational notes recorded in `raw/findings.md`, all
consistent with frozen semantics or hardening suggestions — notably (a) the
legacy `SUBMIT_CONTRACT` accepts a contract id of the form
`contract-a/../../evil` (ID_PATTERN permits `/`; measured zero path effect —
artifact ids are derived, non-path keys — recorded as a hardening note), and
(b) `SUBMIT_CONTRACT` carries no surface gate (matches frozen code).

## Reproducibility

`raw/drivers/*.mjs` re-run the case groups against any copy of the frozen
payload; `raw/findings.md` carries the per-case verdicts with evidence lines;
`raw/env-record.json` records the environment and the post-run cleanliness
check (no listeners on 49651/49652/49661, no `xdownload.exe` leftovers).
