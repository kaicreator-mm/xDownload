# S4 Core seam 1.2 closed command and capability contract — R1

**Status: REVIEW_REQUIRED / R2 DIFFERENCE REPAIR (proposal only; no executable authority).**
**Issue:** #101; **base:** `version/v0.1.0@226f5d491f73cadc87e2deaacbc844f676a9a2d5`.
**Predecessors:** adopted #106 S4 L2, #140 installed command L2, #141 selection/network security L2. This document is their **exact missing seam codec and permission admission** for a limited v0.1 public-file slice. Neither frozen PRD nor original T002/T004/Task DAG changes.

## 1. Explicit decision / compatibility

Propose **three**, and only three, new closed command discriminants under `xdownload.core-seam@1.2.0`:

| Exact commandType | Network effect | Journalled responsibility |
| --- | --- | --- |
| `PREVIEW_S4_HLS_VOD` | Yes, **bounded read** of a public master and optionally one supported rendition playlist | Reserve preview budget and record preview provenance; **no artifact**, no acquisition terminal |
| `CONFIRM_S4_SELECTION` | No | Consume a Core-issued challenge and bind one explicitly displayed rendition to a confirmed snapshot |
| `EXECUTE_S4_SELECTED_HLS_VOD` | Yes, **durable acquisition** | Register **one** idempotent Core-owned member work/effect identity, then execute the existing T009 HLS + validated FFmpeg port |

`SUBMIT_CONTRACT`, `CONFIRM_SNAPSHOT` and existing 1.0/1.1 behavior retain identical meaning. New operations require parsed schema SemVer **major=1 and minor>=2** on *each* decoded command, not just an advertised `SUPPORTED_SEAM_MAJOR_VERSIONS=[1]`; old Core without the command must reject `UNKNOWN_COMMAND_TYPE`. Reject `1.2.0-beta` unless an independently reviewed canonical prerelease policy explicitly admits it; reject unrecognized future fields even when minor is greater. A 1.2 envelope MUST NOT enable reserved `CONFIRM_S3_CANDIDATE`/`EXECUTE_S3_SELECTED_MEDIA` or any generic HLS URL command. Query vocabulary remains `READ_PROJECTION`; no new privileged generic URL-read query. The proposed 1.2 CONFIRM **private direct command-response extension** defined in §4 is explicitly a new closed response field and requires its own decoder/security review; it is NEVER part of the ordinary aggregate `PROJECTION`.

### Admission order (common to all three)

1. Decode complete schema/shape and exact payload keys; forbid extra union fields, unknown command, malformed ID, bad revision, invalid kind or untrusted `peer`.
2. **Verify actual Core-side OS transport peer/session and LIVE connection**, not presented `peer.userId` or claimed `surface='CLI'`; identity and same-logon facts come from an active `VerifiedPeerSessionPort`, independently approved/native-packaged Windows transport. The verified session check occurs **before requestId lookup, prior acceptance replay, query projection, response/challenge delivery, journal or network**; an old accepted ID gives no access over a new/unknown connection. On unsupported/nonverified transports return typed `UNSUPPORTED_TRANSPORT`. For v0.1, the trusted product workflow is installed CLI on the same OS user/logon session; **Windows cannot attest that the calling binary is actually the CLI or that a human clicked**, and the frame's surface=CLI is only a policy hint. The trust assumption is a local same-user user-operated process; a malicious same-user process can spoof that hint and consent. `DESKTOP_UI`/extension and legacy TCP are forbidden for this first 1.2 flow, even if the frame claims CLI; no strong human-presence guarantee is advertised.
3. Look up the already durable **accepted and confirmed** `SINGLE_RESOURCE` contract, exact immutable selection snapshot, target and single selected member, `continuationScope=NONE`, and current `expectedRevision`. The Core must additionally have a **Core-owned immutable canonical approved source-locator record** tied to that contractId/snapshotId/memberId/targetId: the preview `manifestUri` must match that EXACT absolute canonical URI, not merely the same host, path family, or trusted origin. This lookup/equality is required **before journal budget reservation and before any manifest fetch**. A default domain contract that lacks such an authoritative source record makes S4 return typed `PREVIEW_REQUIRED/UNSUPPORTED` without effect; creating a new source-selection snapshot is a **separate reviewed L2 transition** and cannot be invented inside PREVIEW. For this initial v0.1 design, preselection without accepted contract/snapshot or source binding is NOT_SUPPORTED. Core derives profile and trusted public-origin policy from its own pinned installation registry, **never from any submitted origin/host list**.
4. Resolve one of the closed payload variants below; only Core registry/ledger may mint challenge, preview, selected member/effect and budget record. No surface-supplied `confirmed`, arbitrary URL allowlist, OS SID, credentials, output pathname, tool invocation, media PASS, terminal `COMPLETE` or `forceSuccess`.

The existing `requestId`, `aggregateId`, `correlation.contractId/snapshotId`, `expectedRevision` and `issuedAt` are envelope-owned. Payload MUST NOT duplicate or contradict them. **R2 P1-01 whole-intent identity:** canonical digest for every 1.2 accepted entry covers schema identity and version, operation `commandType`, `aggregateId`, immutable correlation/lineage identifiers, `expectedRevision`, all closed canonical payload fields, and Core-verified install/user/logon-session/connection/authorization context; provenance `issuedAt` is included in the stable request identity (identical retries must replay it unchanged). It MUST NOT use only `stableStringify(payload)`. Order is decode+strict bounds → trusted OS/connection/session verification → canonical full-authoritative-intent comparison with prior requestId → revision/contract/source checks → side effects. Repeated identical ID and full intent under the SAME authenticated connection/session may converge to the previous recorded outcome; changed type, aggregate, revision, correlation, issuedAt, source, session/connection or payload is typed `IDEMPOTENCY_CONFLICT` before ANY replay/side effect. Pending/closed connections cannot retrieve prior private bearer responses. Legacy 1.0/1.1 accepted records carry only payload digests: on a requestId collision into 1.2, or on restart when the complete identity cannot be reconstructed, **fail closed with a typed conflict/UNKNOWN; never upgrade payload-only history to 1.2 authority**. Preserve legacy 1.0/1.1 replay behavior for old opcodes without retroactively reinterpreting the old journal. All effect/work identities are separately Core-derived from durable contract/snapshot/member/selection and CAS, never from a caller-selected hash.

## 2. Closed payload shapes (wire JSON objects; no optional user authority)

These are **normative proposed fields** for an independently reviewed schema PR; field-name refinements require another exact-SHA L2 review, not opportunistic implementation.

```ts
type PreviewS4Payload = {
  snapshotId: string;          // must equal envelope correlation.snapshotId
  memberId: string;            // exactly the already-confirmed single member
  manifestUri: string;         // canonical credential-free public HTTPS *.m3u8
  mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1';
};

type BeginConfirmS4Payload = {
  phase: 'BEGIN';               // same CONFIRM_S4_SELECTION opcode, NO new command
  snapshotId: string;
  memberId: string;
  previewId: string;           // Core-created, immutable and unexpired
  renditionKey: string;        // from this preview's Core-observed master
  displayedTupleDigest: string;  // checked against Core-owned preview tuple
};
type CommitConfirmS4Payload = {
  phase: 'COMMIT';
  snapshotId: string;
  memberId: string;
  previewId: string;
  renditionKey: string;
  displayedTupleDigest: string;
  confirmationChallenge: string; // from *private* BEGIN response on same pipe
};

type ExecuteS4Payload = {
  snapshotId: string;
  memberId: string;
  confirmedSelectionId: string; // Core-journalled successful CONFIRM, not caller proof
};
```

All strings bounded 1..128 **except** `manifestUri` ≤2048 and `confirmationChallenge` fixed encoding/entropy pinned by implementation. Exact primitive types, no nested maps or arbitrary unknown fields. `mediaProfileId` must match one Core registry entry and its exact revision/hash; `PreviewS4Payload` cannot submit custom media validation policy, per-domain budget, redirect host graph or `allowedOrigins`. Parsed canonical syntax via the reviewed pure `parsePublicHlsUriCandidate` (PR #142) is **only a lexical preflight**, never proof of permitted network destination. `expectedRevision` is a Core-verified optimistic CAS, not a user-asserted source-of-truth.

**Response** retains existing `SeamOutcome=ACCEPTED|REJECTED|PROJECTION` and the ordinary `READ_PROJECTION` aggregate projection **without** any raw challenge. One new **1.2-only closed, connection-private response extension** is necessary for `CONFIRM_S4_SELECTION` phase BEGIN; it is bound to the live verified Windows pipe connection (see §4). Old 1.0/1.1 `SeamResponse` serializers/decoders reject this new field and must never emit it to a legacy session. An `ACCEPTED` preview means the preview intent was durably registered, NOT that a rendition was fetched or confirmed. Renderable preview facts are returned only from the Core aggregate projection after actual independently observed playlist parsing, never an untrusted CLI preview upload. Typed rejection diagnostics include `UNSUPPORTED_ENVELOPE_VERSION`, `UNKNOWN_COMMAND_TYPE`, `ENVELOPE_MALFORMED`, `PEER_UNAUTHORIZED`, `STALE_REVISION`, `PREVIEW_REQUIRED`, `NEEDS_USER_ACTION`, `CHALLENGE_REPLAYED`, `AUTH_REQUIRED`, `SCOPE_DENIED`, `UNSUPPORTED_TRANSPORT`, `INSUFFICIENT_EVIDENCE`; actual names must be reconciled with existing `SeamDiagnostic` union and reviewed as one closed change, never invented dynamically. Core records durable reject/failure truth where an effect intent was accepted; malformed/unauthorized inputs fail before side effects.

## 3. PREVIEW — bounded journal-before-network, no download admission

A request is admissible only on the authenticated CLI session after the accepted snapshot and current revision check. Before any network read, Core CAS-journals a preview identity and **reserves bounded bytes/retries/time/redirect budget from T009**, with a stable `previewId`; the registry's allowed origin set and policy revision are internally pinned. The existing trusted T009 manifest port must receive these Core-owned bounds. The initial profile supports canonical public HTTPS manifests and selected basic single-rendition finite VOD media playlist only. **No credentials, signed query, cookies, HTML auth fallback, DRM, live reload or general site discovery**.

The preview result must store a secret-free immutable digest of (contract/snapshot/member/manifest source + actual master/rendition metadata + canonical selected ancestry + trusted policy/profile revision + allowed origin graph + Core authenticated session). Preview has short Core-enforced TTL (proposed maximum 120 seconds); Core expires it and revokes its derived confirmation challenge on restart or OS-session change. A rejected/missing/ambiguous master or unsupported topology produces typed `UNKNOWN/UNSUPPORTED/INSUFFICIENT_EVIDENCE`, no confirmable selection and no artifact/Transfer/Media PASS.

The trusted CLI displays **only Core-projected** supported variants, selected source, codec/width/height/bandwidth and bounded origin graph. It presents an explicit YES/NO prompt for **exactly** the selected `renditionKey`; non-interactive/EOF/timed-out/negative answer = `NEEDS_USER_ACTION` or declined, never auto-YES. Preview may not silently claim that selected segment URLs are public; those still require per-hop proof at execute time.

## 4. CONFIRM — explicit user gesture and Core-issued one-use challenge

**R2 P1-03 issuance and delivery route, explicit 1.2 wire change:** After actual preview result is complete and a verified same-session CLI has read the *secret-free* aggregate preview, the user selects a rendition key. The CLI sends `CONFIRM_S4_SELECTION` **phase BEGIN** (closed payload above) on its live OS-verified pipe. Core validates the exact immutable tuple, revision, selected rendition and current connection, then mints >=128 bits CSPRNG challenge and server-side pending commitment. BEGIN returns a **direct, unicast, connection-bound 1.2 command response** with the closed field `s4PrivateChallenge: { previewId, renditionKey, value, expiresAt }` **ONLY** to that verified pipe connection. It is an ephemeral response field, not a Core aggregate projection, ordinary `READ_PROJECTION`, state journal, audit log, process-global event, persistent replay buffer, or browser-surface response. `SeamResponse` 1.2 closed decoder, transport reply routing, length cap and redaction must be reviewed in the same schema implementation; no debug telemetry may serialize `value`. Existing `READ_PROJECTION` remains available for public, **secret-free** preview facts but never leaks a challenge. Nonverified/legacy TCP/browser/cross-session queries cannot read the challenge, even with an already accepted requestId. A duplicate BEGIN with identical ID can only return non-secret previous acceptance (no raw token replay); if the response is lost, the caller explicitly starts a fresh BEGIN with a fresh requestId, revoking the previous pending challenge. Never clone a raw token from the journal.

The installed CLI displays the bound preview tuple and asks for explicit affirmative consent *after* BEGIN returned a private token. If user refuses, times out, disconnects or is headless: zero COMMIT/EXECUTE. Affirmative selection sends `CONFIRM_S4_SELECTION` **phase COMMIT** on the SAME verified pipe, echoing that opaque token and exact displayed tuple. Core checks the commitment, the independently derived OS session/connection, same preview/selection, Core-authoritative source binding, contract snapshot/revision and expiry. Consume the pending token **atomically with** one durable `confirmedSelectionId` CAS record; reject an already-used/expired token for another requestId. An identical COMMIT retransmission after successful CAS is allowed only as a secret-free idempotent projection of the *same* accepted result; it never creates another confirmed selection. No raw bearer reaches durable state or error/projection. Client must redact the inbound COMMIT frame in transport tracing before logging. If the connection is lost before COMMIT, pending challenge is revoked and no result can be recovered by another connection.

**R2 P2-01 deterministic expiry/crash:** Core issues `expiresAt` using its clock with max 120s since BEGIN, pins `coreEpoch` and monotonic elapsed-time deadline. A challenge is invalid when `now >= expiresAt`, the monotonic TTL has elapsed, the process epoch changed, the connection terminated or cancellation committed. Conservative wall-clock rollback/uncertain monotonic reference also revokes pending token; expired BEGIN never extends TTL by retry. On restart, all pending/ephemeral bearer challenges are revoked. Persisted confirmed selections store only a secret-free commitment to the tuple and `confirmedAt/expiresAt/coreEpoch`; an UNUSED confirmed selection expires after <=120s, cannot be renewed implicitly or consumed in another session. `EXECUTE` atomically checks not expired/not cancelled and reserves **one** durable effect identity by CAS against `confirmedSelectionId`. Crash after COMMIT but before EXECUTE: exactly that committed selection may execute if it is still fresh, valid for the current authenticated connection/session policy and epoch; otherwise require a fresh preview/confirmation. Crash after effect reservation: replay only the same effect state, never re-reserve/debit/fetch blindly. Cancellation wins when its durable CAS is earlier; a late callback or duplicated COMMIT/EXECUTE cannot resurrect or mint new effects.

**R2 P2-02 trust boundary:** The Windows verified named pipe attests OS user/logon session and active peer connection, **not** the calling binary or physical human. Even if the frame claims `surface='CLI'`, a malicious same-user/same-session process can impersonate the UX. This public v0.1 local-user trust limitation must be disclosed in Product acceptance. No statement of OS-attested human gesture is allowed; stronger human presence would require a separate approved Windows trusted-dialog broker.

## 5. EXECUTE — authoritative stable effect, origin validation and Media truth

Look up Core-owned `confirmedSelectionId` and immutable user-picked `renditionKey`; reject changed contract/member/manifest/variant/preview graph/policy, a later cancel, stale snapshot, expired confirmation or invalid Core epoch/peer connection. The manifest source URI must remain exactly the approved Core-owned contract/snapshot/member source identity from PREVIEW, **not just the allowed host**. Core derives exactly one member `effectId/workItemId/artifactId`, CAS-journals its effect intent and budget debit **before** every outbound action, and delegates to the existing T009 selected-HLS engine. Cancellation wins over any late byte/probe callback. Retried/restarted identical accepted effect is an idempotent projection/reconcile, **not** a second debit or blind duplicate fetch.

Actual network permission is **a separate gate**, not granted by `parsePublicHlsUriCandidate` or an apparent FQDN. Per master/rendition/segment/redirect hop, intersect (1) pinned trusted-installation origin allowlist, (2) Core-observed immediate playlist ancestry and selected rendition graph, (3) user-confirmed bounded scope. Reject redirect host widening, query-bearing auth/signed URLs, unsupported ports/DRM/HLS encryption and private/link-local/loopback/metadata targets. Resolve and classify all A/AAAA/CNAME destinations, block IPv4/IPv6/IPv4-mapped reserved ranges, and ensure the **actual TLS-connected IP** equals a verified permitted resolved address for that exact hop (SNI/certificate hostname remains original authorized origin). If the HTTP stack cannot enforce connection-address pinning, refuse `UNSUPPORTED_TRANSPORT`; **Node global fetch with only a hostname string is not an acceptable production authorizer**. Production cannot enable localhost fixtures.

A `COMPLETE` terminal must follow durable actual target/transfer/format/media validation using the real bounded FFmpeg #138 port and the existing Core projector, including frame coverage; an accepted HTTP 200, playlist bytes, CLI `ACCEPTED` or confirmed selection can never claim successful acquisition. FFmpeg unavailability or ambiguous sparse/unsupported profile fails conservatively.

## 6. Review/proof matrix (required before code may use new authority)

- 1.0/1.1 attempted S4 opcode, unrecognized 1.2/1.3 extension keys, malformed payload, S3 opcode accidental unlock and downgrade from 1.2 accepted journal → old Core: refuse before effects.
- Caller-supplied peer claims CLI but OS token/session is absent, different logon, browser or legacy TCP: `PEER_UNAUTHORIZED/UNSUPPORTED_TRANSPORT`; no preview fetch.
- Forged install-origin policy, browser/model suggested CDN list, stale snapshot/member, wrong profile, SAME requestId/payload but altered commandType/aggregateId/schema/correlation/revision/issuedAt or actual verified session: typed conflict, no prior ACCEPTED replay and no new budget/network. Legacy payload-only journal vs 1.2 ID collision refuses.
- Preview budget exhausted, **same trusted host but changed manifest URI path**, manifest source not in immutable accepted snapshot, mismatched member/target, post-preview master/variant changed, restart mid-preview or challenge pending, end-of-file/headless/no user confirmation: no effect, no forged selection.
- Legacy TCP/browser/cross-session READ_PROJECTION attempt to obtain raw token, BEGIN repeated accepted ID replay, lost BEGIN response, cross-connection private response read, forged COMMIT/challenge substitution, replay/expiry/epoch restart, inconsistent tuple digest, changed rendition, crash after COMMIT before effect and confirmation after cancellation: no token leak, no duplicate committed effect.
- URL confusables, signed token query, encoded separator, private DNS A/AAAA, CNAME and rebinding between check/connect, HTTPS redirect to metadata or undeclared CDN: no outbound effect to denied destination; tests must prove actual connected IP binding with controlled DNS/HTTPS transport.
- Real 3-segment HLS success and injected corrupt, TS null/sparse/uniform-thinning, tool absent, crash between budget and media acceptance, late cancel: canonical verified or truthful failed/UNKNOWN terminal, never synthetic completion.
- Real packaged local CLI → OS-verified Core → HTTP/CDN/FFmpeg installed test → #100 Product G1; separately independent user #81 G0/G1a/b/c before Release.

**Dependency:** separate exact-SHA independent **L2/schema/security review of this proposal**, followed by bounded Contract/Codec PR, Core internal preview/confirm/execute authority PRs, shipped CLI UI PR, Windows/DNS/FFmpeg evidence and final qualification. This proposal **does not change `CORE_SEAM_SCHEMA_VERSION=1.1.0`, `COMMAND_TYPES`, the installed Core, transport or any frozen gate**.

`SCHEMA_FREEZE_READY=NO` pending independent reviewer. `S4_INSTALLED=NO`, `#100_PREFLIGHT=NO`, `RELEASE_PASS=NO`.
