# xDownload v0.1 — S3/S4 HTTP transport implementation-only delta (R0)

**Status:** PROPOSED / INDEPENDENT_L2_REVIEW_REQUIRED / NOT_ADOPTED.
**Base:** `version/v0.1.0@f274ec3b96240a1e21217fc400b20e3be851b309`.
**Owner:** #101, implementation leaves #150 (S3) and #153 (S4), prerequisite network concern #149.
**Changed concern:** choice of HTTP/TLS implementation and associated URL/network policy **only**, not Product acceptance, operation vocabulary or authorization authority.

## 1. No Product, DAG, release or public API change

Keep PRD v0.4.2 §§28–32 **byte-identical**; it explicitly says Product freezes outcomes, not transport technology. S1–S6 remain REQUIRED. Keep frozen Task DAG, #101 decomposed issues, T019–T028, existing Core 1.2 command codecs, OS-verified peer admission, explicit user confirmation, journal-before-effect, Core single writer, bounded time/bytes/retries, Target/Transfer/Format/**Media** evidence, cancellation/replay/restart and real installed-path qualification unchanged. No new API, abstract scheduler, generic `execute(url)`, browser credential leak, auto-confirm or security gate. Prior source/CI and reviewed experimental pinned transport remain reusable and may be extracted optionally to kai-tools after v0.1.

## 2. Implementation choice: ordinary user-confirmed download, mature library first

For the **locally user-confirmed** plain public media/HLS lane only, prefer maintained Node HTTP client (`fetch`/Undici, or the already implemented T008 direct HTTP adapter where it suffices). Delegate standard TLS hostname/certificate chain validation, connection establishment, DNS, HTTP response streaming, Range and timeout mechanics to the maintained client. Do **not** write another socket/DNS pinning stack solely for local-download semantics.

**Minimum adapter controls:** require an already accepted, exact selected locator/manifest lineage and explicit current-CLI user consent under the existing Core 1.2 verified peer contract; normalize URLs with WHATWG URL; default plain HTTPS and reject user-info / dangerous schemes; keep declared HTTP request/response size, duration and redirect-hop caps; observe every redirect and prevent unconfirmed target/selection substitution or HTTPS downgrade; keep non-secret provenance (redact credential/query tokens before logs and persistence); reject HTML/login and mismatching/truncated bytes as truthful failures. A standard TLS verification failure is a network failure, not permission to disable certificate validation.

The existing closed S3 profile `PublicMediaSourceProfile` and HLS host/playlist ancestry policy may remain as **optional restricted network mode**, but a manually selected, confirmed public URL does **not** additionally require every domain to appear in a preinstalled administrator origin table, or fit `/media/<id>.<ext>`, or prove each resolved DNS address and the exact connected IP via a bespoke network implementation. Selected target identity/provenance and user-authorized redirect scope **still** control cross-source changes; do not turn consent into wildcard redirects. A normal CDN is supported when it is part of the explicitly confirmed/proven redirect/playlist lineage.

**Credential/signed URLs:** Product permits authorized context, but this delta does not automatically authorize arbitrary bearer query strings through Core/LLM/journal. Keep raw tokens/cookies confined to the existing browser-authorized broker or a separately authorized short-lived local adapter; do not add support here by weakening secret handling. Plain unsupported credentialed/signed cases return `AUTH_REQUIRED/UNSUPPORTED` truthfully until the relevant existing broker path is integrated.

## 3. S4 basic HLS implementation

Retain T009's finite VOD playlist/rendition selection and evidence identity, selected playlist provenance and per-member URL/segment count and budget tracking. Use the mature HTTP client for manifest/segment transport; use the existing FFmpeg/ffprobe port for final media processing/probe. A tested FFmpeg media transport may replace hand-written segment transport only if it can return equivalent source/rendition/segment provenance, bounded effects and Media/Target/Transfer/Format truth; otherwise use the current T009 plan+client streaming pipeline. No DRM/encrypted/live, invisible alternate tracks, or invented segment COMPLETE.

## 4. Threat/scope choice: keep strict mode optional for different actors

| Actor and permission | Default network policy |
| --- | --- |
| Local installed CLI; selected URI shown, user affirmatively confirms | Ordinary library-backed HTTPS/TLS with finite redirects and selected-resource provenance. A user-selected local/LAN target is a **separate explicit choice**, not implied by a public-only S3/S4 profile. |
| Webpage / Recipe / LLM proposal | **No authority to fetch** on its own. Only proposals; must enter the existing trusted Core/gesture selection contract. |
| Headless/unattended agent / server fetching URLs from untrusted third parties | **Not newly enabled by this delta.** Continue using existing optional restricted origin/SSRF-sensitive policy, or return UNSUPPORTED. |
| Authenticated browser-session download | Existing scoped privileged broker; no raw cookie/token exposure or new authority granted. |

Treat the following as nonblocking documented limitations, if they are **outside this selected v0.1 support path**: exotic IPv6/DNS transitions, hostile same-OS-user code acting as the CLI, arbitrary CDN/proxy extensions, high-security unattended SSRF mitigation, transport-specific edge behavior. Do **not** defer unauthorized command/file effects, credential exposure, incorrect download target, corrupt artifact acceptance or false COMPLETE.

## 5. Exact narrow L2 supersession on adoption

Upon independent PASS and owner adoption, **only** the following implementation requirements from existing S3/S4 successor documents are relaxed for the above local-confirmed *public noncredentialed* mode:

- `L2_S3_SELECTED_MEDIA_COMMAND_v0.1.0.md` §2.2: preinstalled origin/redirect lists and `^/media/...$` lexical path restriction are no longer mandatory **transport admission** for a fully user-confirmed selected locator; Core-selected identity, explicit redirect graph, secret-safe provenance and media checks remain required. Existing reviewed strict-mode implementation remains supported but not prerequisite for this ordinary mode.
- `L2_S4_SELECTION_SECURITY_PROFILE_v0.1.0.md` §4 and `L2_S4_SEAM12_CLOSED_COMMAND_CONTRACT_v0.1.0.md` §5: DNS-all-address public classification, DNS-to-socket connected-IP pin, custom SNI/socket binding and trusted-install origin registry are no longer mandatory in this local-confirmed mode; ordinary verified TLS, immutable selected playlist ancestry and explicit observed/confirmed CDN scope remain mandatory. The existing pinned transport remains an optional restricted profile and is not deleted.
- **S4 initial PREVIEW source bootstrap (resolves pre-existing Core origin-precedence contradiction):** For this exact **installed same-user CLI, noncredentialed public HTTPS** mode, this addendum also narrowly supersedes the trusted-installation origin-table prerequisite in `L2_S4_SELECTION_SECURITY_PROFILE_v0.1.0.md` §2 (preview-origin source), and `L2_S4_SEAM12_CLOSED_COMMAND_CONTRACT_v0.1.0.md` §1 (Core-installed registry / mandatory pre-existing canonical source record) and §3 (registry allowlist before preview). The installed local CLI provides the user-selected **exact public manifest URL** in the existing closed `PREVIEW_S4_HLS_VOD` operation; Core must first verify its real live same-user session, durable accepted contract + immutable confirmed snapshot, single selected member and target, expected revision and absence of conflicting Core source binding. Core then CAS-journals a **provisional, Core-owned immutable exact manifest selection and preview-budget reservation before its first HTTP read**, scoped to that accepted target and requestId. This is the authorized *metadata preview source selection*, **not** permission to download, not a caller-defined origin registry, and **not** the later confirmed rendition or one-use effect challenge. A second/conflicting URL or stale snapshot requires a new authorized selection/revision rather than silently changing the record. The supplied public manifest is checked by standard URL/HTTPS and secret-safe policy; the resulting master, rendition and segment origins must be independently observed through immediate playlist ancestry and remain bound to Core-recorded user selection and confirmed delivery scope per hop. Only the trusted local CLI can request this provisional read; browser/LLM/Recipe/headless submissions gain no authority. Any unsupported, authenticated, signed or unknown origin remains typed refusal. Preview `ACCEPTED` does not attest to a fetched playlist or completed download. The already-published 1.2 payload/response shapes, private Core challenge, consent gesture and journal semantics are unchanged.
- Any older S3/S4 wording requiring a **handwritten pinned network transport** for ordinary local user-confirmed download is interpreted subject to this section only. All command, journal, media and user consent requirements retain priority.

This is **not** a retrospective PASS, not a release-gate waiver, not a Product/Task DAG mutation, and not blanket authorization for browsers/AI to issue arbitrary URL fetches. If independent review identifies a hard contradiction in existing frozen authority, stop and route that **specific clause only** to the L2 owner rather than reopening all Product/L2.

## 6. Minimal adoption and implementation checks

1. Independent bounded Product/L2 reviewer checks **this file only**, validates §5's exact predecessor clauses and no new uncontrolled URL/file/effect authority; reports P0/P1/P2 and `L2_IMPL_DELTA_READY`.
2. After PASS and adoption, #150 implements **one** real user-facing S3 selected media download → durable Core terminal behind existing 1.2 authority using a mature HTTP client; prefer reusing existing S1 T008 helper rather than adding parallel transport. Test ordinary public HTTPS and allowed CDN redirect, refusal/timeout/media mismatch, cancel/restart and no false COMPLETE. Use one Windows real installed end-to-end canary.
3. #153 follows same choice for S4 basic finite HLS and existing FFmpeg. Reuse valid prior tests; only required changed concerns run scoped CI and real-host evidence.
4. Report `S3_INSTALLED/S4_INSTALLED=PASS|NOT_PROVEN` separately from PR/CI counts; #100, #81, T019–T028 remain the real installed and release gates.

**Explicit current state:** `L2_IMPL_DELTA_READY=NO_PENDING_REVIEW`; `S3_INSTALLED=NOT_PROVEN`; `S4_INSTALLED=NOT_PROVEN`; `RELEASE_PASS=NO`.
