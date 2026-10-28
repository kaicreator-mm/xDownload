# POC_RESULT_R0 — xDownload #183 DomainHarness v0.10.3 download PoC (builder evidence)

**Status: BUILDER EVIDENCE ONLY — NOT a self-marked PASS.** Verdict ownership is the
independent exact-SHA reviewer per the Task Pack (`POC_LOCAL_AGENT_HANDOFF_R0.md`
@ `git-blob-sha1:5b2499ffe4e6668819d4cbccd22896f0e80661f9`). Everything below is
reproducible from the committed tree: `cd experiments/domain-app-download && npm ci && npm test`.

## Identity bindings (all read back live)

| Subject | Value |
| --- | --- |
| Experiment base | `experiment/ads-v418-poc@944be4f5cbea503b6fd2700aba1f3997a614e2b1` (worktree branch `research/domain-app-poc-183`) |
| Accepted Builder claim | `DISPATCH_CLAIMED` #183@6479150968, dispatch `xd183-research-poc-builder-20261028T1955Z`, generation 1, `SINGLE_WRITER_ADMISSION`, key `kaicreator-mm/xDownload#183:builder:__default__` |
| SDK source | `kaicreator-mm/domain-harness` tag `v0.10.3` → commit `061376f4a023070f215f9feffad5c24d96d503cb`, tree `099cdc831aef63befd62aaede7e7a853d1be468f` |
| npm publication | NOT done; manifests `0.10.2-rc.0`; registry never consulted (tarball-only install) |
| Packed SDK tarballs (SHA256 in `evidence/e01-sdk-pack/PACK_EVIDENCE.md`) | contracts `859c55e1…`, microkernel `cd716f08…`, host-node `3a0a1139…`, build `c04c5ee2…` |
| Sealed app | appId `app:xdownload-download-poc`, buildId `xdownload-i183-poc-v1`, subjectDigest `3d79758d9199b700c53c48ab0902b2001e0c0340263708a56d2573d875e68e13`, closure digest `5a36a20b5cde1b390a549bf530abdd087f238c388e47fa3149fb5bcf6c40c774` (4 modules: K `v08-kernel-mechanism@v0.10.0` + S `standard-sdk@v08.1.0.0` + B `business-download@0.1.0` + C `capability-acquisition@0.1.0` externalEffect) |
| Runtime | Windows 10.0.26300 x64, Node v24.21.0 (fnm), vitest 4.1.11; store = caller-owned atomic-JSON CAS (`PlainFileDocStore`) |

## Selected public SDK surface actually exercised (no internal imports anywhere)

`@kaicreator/domain-harness-build`: `buildV10App`, `V10_TARGET_PROFILE`; `@kaicreator/domain-harness-host-node`:
`v10BuildPackageClosureDigest`; `@kaicreator/domain-harness-microkernel`: `load`, `DomainApp.send/query/subscribe/stop`,
`V10Error` family; error vocabularies observed: `INTENT_UNSEALED`, `V10_EFFECT_PERMIT_REQUIRED`,
`V10_EXTERNAL_ENVELOPE_INVALID`, `QUERY_NOT_FOUND`, facade masking code `HOST_DOC_READ_FAILED`.
K internals observed through public receipts only: effect journal rows under
`v010-k02:…:v08-kernel:effect-journal:turn:<workflow>:<instance>:message:<messageId>/effect/<n>`
with `status: started → completed | failed`, one-time Effect Permit mint/consume, external-effect
gate re-read (`attest.effectPermit`), idempotent replay (`idempotentReplay: true`), resolver
`llmAvoided: true` / `modelCallEvidence.status: unsupported`.

## Matrix results (final run `evidence/final-run/poc-matrix-final.txt`, `FINAL_EXIT=0`, 17/17)

| ID | Result | Key observed evidence |
| --- | --- | --- |
| E01 | PASS | tarball-only clean install `npm ci` EXIT=0; public export introspection; producer sealed 4-module BUILD on Node 24 |
| P01 | PASS | admitted receipt (`effects[0].disposition=executed`, `phase=terminal`, ok output with `fileSha256`), materialized file digest == confirmed SHA256, K state `requested→acquired`, async subscribe delivered `kind=admitted` event on idempotent replay, journal rows `completed` |
| P02 | PASS | manifest has no provider surface; `receipt.admitted.resolver.llmAvoided=true`, `modelCallEvidence.status=unsupported`; same deterministic file/journey |
| N01 | PASS | route-less intent refused typed (`INTENT_UNSEALED`) with zero network/file/bridge calls; missing-bridge C dispatch recorded an honest failed effect row with zero physical effect (no fixture request, no file) |
| N02 | PASS | gateway refuses host swap (`GATEWAY_SCOPE_HOST`) and output-root swap (`GATEWAY_SCOPE_ROOT`) with `sendCallCount=0`; adapter refuses out-of-scope redirect hop (allowedRedirectHosts) with zero file |
| N03 | PASS | same messageId+input replay: `idempotentReplay=true`, one accepted artifact, zero new journal/bridge/file effects |
| N04 | PASS | abort at fixture request: no file, no auto-redownload (`acquireCalls=1`), truthful non-success receipt; explicit new-identity re-send succeeds; real stop/reopen of the durable store keeps journal rows and stays idempotent |
| N05 | PASS | digest mismatch → no file, journal never deleted; K-recorded `fileSha256` evidence exposes on-disk tampering |
| N06 | PASS | second writer identity on same artifact lineage refused (`WRITER_IDENTITY_CONFLICT`) by the Host one-writer CAS claim; exactly one file |
| N07 | PASS | Host pre-load sealed-BUILD verification refuses altered module bytes (`SEALED_BUILD_MODULE_ALTERED`); `buildV10App` refuses a route to an unselected capability |
| N08 | PASS | malformed request rejected by the pre-send gateway BEFORE `send` (`sendCallCount=0`, zero network, zero journal row); same stable identity then completes the normal K/Host path |
| M01 | MEASURED | same 4096-byte fixture: direct adapter ≈2 ms, K-orchestrated ≈17–24 ms (overhead ≈15–20 ms, dominated by K admission/journal doc writes; final run: 2.0ms vs 18.9ms) |

## What is NOT proven (UNKNOWN / carried forward)

- **U01/U02 (K vs legacy Core authority):** the PoC proves option-B mechanics — a sandboxed
  K-owned lifecycle with the existing `DirectHttpAdapter` behind the C/Host gate and a
  Host-enforced single-writer partition (N06). It does NOT prove production migration,
  durability equivalence to `CoreScheduler`/`AuthoritativeLedgerWriter`, or a compatibility
  bridge (ADR option A). No v0.1 code path was touched.
- **Already-poisoned journal recovery (upstream #1437):** the gateway prevents NEW poisoning
  (N08) but repairs nothing; `PoisonRecoveryCoordinator` was not exercised. Recovery stays
  outside this PoC per the Task Pack.
- **Rich SQLite store / multi-process CAS:** not exercised (better-sqlite3 peer skipped);
  durability across restart was proven on the atomic-JSON CAS store instead.
- **Governed deployment activation (`activateGovernedV10Build`) and production BUILD
  governance:** not exercised; the PoC uses direct `load` plus a Host-side sealed-BUILD
  integrity check (N07).
- **Real HTTPS, large files, resume (ValidatedResume), HLS lane:** out of the bounded fixture
  scope; `DirectHttpAdapter` capabilities were used as-is.
- M01 numbers are single-machine single-run observations, not a performance qualification.

## Raw-send hazard note (N08 context)

With the trusted gateway bypassed (probe observation during development, debug-instrumented
copy), a route-valid intent whose C dispatch throws does leave a `started/failed` journal row —
consistent with upstream #1437's hazard class for stable identities. This PoC's N08 gateway
prevents new poisoning; it does not re-qualify the unfixed upstream behavior.

## Verdict routing

`DOMAIN_APP_POC=CANDIDATE_PASS_PENDING_INDEPENDENT_REVIEW` (builder must not self-mark PASS).
Independent R1: exact-SHA source review + re-run of `npm ci && npm test` in this directory.
`V0.1_RELEASE_IMPACT=NONE`; no v0.2 freeze input is claimed by this file.
