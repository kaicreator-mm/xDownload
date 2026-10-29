# S4 installed selected-HLS command — narrow proposed authority successor (v0.1.0)

**Status:** PROPOSED / not implemented / independent L2 review required.
**Owner:** #101, after the adopted #106 S4 HLS flow successor and PR #138 host-only Media port.
**Base:** `version/v0.1.0@d7935163189a281f123b7fc4801b7a263c0f4987`.
**Frozen:** Product PRD-v0.4.2 §28 S4; L2 single-Core authority; immutable T002 scope; original T004 seam 1.0 and adopted 1.1 S1.
**Scope:** the *one* missing public user → Core selected-HLS command contract. This document grants NO implementation, browser auth, generic crawling, or new release evidence.

## 1. Decision requested

Approve a **closed** Core seam 1.2+ command `EXECUTE_S4_SELECTED_HLS_VOD`, issued only by a user-facing installed surface after an explicit manifest/rendition confirmation. It registers a Core-owned durable effect intent; its `ACCEPTED` response is never terminal acquisition success. Frozen T004 1.0 and 1.1 command semantics remain byte-for-byte readable; older Core implementations reject the 1.2-only opcode before mutation, even if the major version matches. A 1.2 envelope carrying any other unknown opcode remains rejected. The S3 1.2 reserved candidate/execute pair is **not** implicitly enabled by this contract.

Do not silently reuse `EXECUTE_S1_DIRECT_ACQUISITION` (opaque direct file) for an HLS manifest; successful manifest bytes are not a validated media artifact. Do not expose `executeSelectedHlsFromAuthorizedManifestsAsync()` directly as a CLI API: the existing flow is a host-private Core component, not a journalled surface command.

## 2. Frozen intent and supported caller

The operator performs an explicit installed `xdownload hls --manifest <url> --rendition <stable-id> [--allow-host <host> ...]` gesture and sees the selected source/rendition/topology before confirming. CLI syntax is **proposed**, not yet shipped; UI only collects a decision, not terminal truth. The Core recognizes a canonical submitted `SINGLE_RESOURCE` acquisition contract, an immutable current selection snapshot (confirmed via existing authorised snapshot machinery), the exact target/contract/revision and a continuation scope of `NONE`. Selection mismatch, stale snapshot, or changed source requires new confirmation and cannot inherit consent.

For **first v0.1 public-file slice only**, permit credential-free HTTPS HLS manifests and finite declared hosts. No raw cookies, Authorization headers, bearer strings, browser session data, task JSON secrets, HTML-derived permission expansion or untrusted template-provided executable media tool. Deny user-info, query/fragment credentials, mixed-content redirects, undeclared CDN hops, private-network/localhost destinations unless explicitly allowed by already adopted origin-security authority (no implicit exception). Authenticated or signed-CDN HLS is **NOT_SUPPORTED by this new command yet**: route a separately reviewed privileged browser/Native-Messaging broker capability, with origin/contract/snapshot/segment/expiry bounds and no raw auth material into Core. The public-file command must not become an unaudited Core authenticated fetcher.

The trusted installed Core peer must be positively authenticated by the approved transport policy (no caller-asserted SID, surface or loopback address). **Dependency:** Windows verified pipe #139 is not review-adopted yet; any decision reusing that capability is conditional on its independent security PASS and deployed native bridge. This S4 contract does not borrow future S3 1.2 authority merely because both share a version.

## 3. Proposed closed payload / validation order

A candidate payload must bind exactly the following semantic facts; names/codec will be finalised only in the reviewed implementation contract/schema:

1. `contractId`, `snapshotId`, `logicalTargetId`, `expectedAggregateRevision` and `requestId` (versioned seam envelope, nonempty, mutually consistent with accepted immutable contract).
2. One approved canonical `manifestLocator` with a selected absolute HTTPS URI, its immutable target identity, and bounded `declaredManifestHosts`; the selected `renditionUri` / stable variant discriminator shown to the user and bound to the fetched master.
3. Exact approved `declaredSegmentHosts` (possibly distinct CDN), maximum bytes/segments/retries/time, finite TransferBudget and GlobalSafetyBudget, plus a stable supported HLS profile identifier and version.
4. One Core-verifiable user decision reference bound to the *exact* displayed manifest/rendition/scope/revision and installed peer session; a mere CLI-supplied `confirmed:true`, echoed nonce, PID or self-hash is NOT proof.

No source can supply canonical final EvidenceRecords, result projector values, force-SUCCESS bits, arbitrary filesystem output paths, a shell command, or dynamically widening hosts. The Core refuses malformed/unknown keys before acceptance and separately refuses denied profile/peer/selection/contract/revision. Repeated identical requestId returns the same journalled acceptance/terminal truth; different payload under one requestId conflicts. A reconnection or restart must revalidate durable facts, not manufacture a new authorization.

**Authority sequence:** decode version/peer/shape → inspect accepted contract and frozen snapshot → verify actual host/session user confirmation + declared origin graph + per-domain/global budget → commit accepted command and effect identity to durable Core journal/ledger → only then fetch the manifest, parse/verify selected master/rendition, bound selected media playlist, plan segment identities, charge each outbound byte/retry → actual format/media probe and Core canonical projection. No surface, browser popup, Recipe, model or helper has parallel effect scheduling or may assert `COMPLETE`. A replay or cancellation must not re-spend accepted budget, re-fetch accepted segments or reopen cancelled authority.

## 4. Required behaviour and counterexamples

| Case | Required durable result |
| --- | --- |
| CLI to old 1.0/1.1 Core; 1.2 S4 command with forged CLI surface | typed version/authorization refusal before journal |
| Contract/Snapshot/target/variant changed after confirmation | typed immutable binding refusal, no external effect |
| Non-HTTPS/private/undeclared CDN/redirect or signed URL without approved broker | scope/authorization refusal, never leak credentials |
| Live playlist, missing VOD closure, encryption/DRM, separate A/V/mux | UNSUPPORTED / UNKNOWN, never opaque-file fallback |
| Corrupt, absent, truncated or duplicate fragment / byterange mismatch | Transfer + Media failure, never accepted selected media |
| FFmpeg unavailable, probe inconclusive, sparse/cadence-damaged segments | INSUFFICIENT_EVIDENCE → no Media PASS or COMPLETE |
| Manifest fetch fails/throws after durable begin | durable failure, no orphaned Core work item |
| Worker crashes after budget debit, before accepted segment commit | bounded reconcile, never blind duplicate charge or receipt |
| User cancels before a late successful fetch/probe callback | cancellation precedence, no terminal resurrection |
| Auth-required/expired origin appears during otherwise public task | explicit AUTH_REQUIRED or blocked outcome; no secret export |

Observations must map from the real installed CLI/user action through the actual packaged Core host, approved manifest/segment transport and selected-HLS Core runtime; a direct unit-test call into the host-private flow is NOT an installed-product test. For a completed artifact, verify actual durable bytes and independent Target/Transfer/Format/Media evidence and authoritative terminal. A green CLI `ACCEPTED` is only intent admission.

## 5. Release / implementation DAG

Independent exact-SHA **L2 contract review** → one narrow Core command/schema and replay/negative tests PR (depends on #139 transport admission if used) → one Core host wiring + bounded public manifest/segment and host media tool concern → one installed CLI confirmation/selection concern → exact-SHA independent code reviews and real installed Windows/HTTP/FFmpeg qualification → #100 product reachability → T019–T028 and #81 genuine human G0/G1.

The implementation must pick and pin the actual existing `@xdownload/hls-vod-adapter` supported profile and Media port, and declare packaging/version/tool availability before any success claim. Source-only, fixture-only and CI-only checks must not be promoted to user-path/Release PASS. `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md`, the frozen PRD, and `docs/implementation/v0.1.0/TASK_DAG.md` remain unchanged.

**L2_S4_PUBLIC_COMMAND_REVIEW=PENDING; S4_INSTALLED=NO; #100_PREFLIGHT=NO; RELEASE_PASS=NO.**
