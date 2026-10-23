# S4 Core seam 1.2 closed command and capability contract — R1

**Status: REVIEW_REQUIRED (proposal only, not executable authority).**
**Issue:** #101; **base:** `version/v0.1.0@226f5d491f73cadc87e2deaacbc844f676a9a2d5`.
**Predecessors:** adopted #106 S4 L2, #140 installed command L2, #141 selection/network security L2. This document is their **exact missing seam codec and permission admission** for a limited v0.1 public-file slice. Neither frozen PRD nor original T002/T004/Task DAG changes.

## 1. Explicit decision / compatibility

Propose **three**, and only three, new closed command discriminants under `xdownload.core-seam@1.2.0`:

| Exact commandType | Network effect | Journalled responsibility |
| --- | --- | --- |
| `PREVIEW_S4_HLS_VOD` | Yes, **bounded read** of a public master and optionally one supported rendition playlist | Reserve preview budget and record preview provenance; **no artifact**, no acquisition terminal |
| `CONFIRM_S4_SELECTION` | No | Consume a Core-issued challenge and bind one explicitly displayed rendition to a confirmed snapshot |
| `EXECUTE_S4_SELECTED_HLS_VOD` | Yes, **durable acquisition** | Register **one** idempotent Core-owned member work/effect identity, then execute the existing T009 HLS + validated FFmpeg port |

`SUBMIT_CONTRACT`, `CONFIRM_SNAPSHOT` and existing 1.0/1.1 behavior retain identical meaning. New operations require parsed schema SemVer **major=1 and minor>=2** on *each* decoded command, not just an advertised `SUPPORTED_SEAM_MAJOR_VERSIONS=[1]`; old Core without the command must reject `UNKNOWN_COMMAND_TYPE`. Reject `1.2.0-beta` unless an independently reviewed canonical prerelease policy explicitly admits it; reject unrecognized future fields even when minor is greater. A 1.2 envelope MUST NOT enable reserved `CONFIRM_S3_CANDIDATE`/`EXECUTE_S3_SELECTED_MEDIA` or any generic HLS URL command. Query vocabulary remains `READ_PROJECTION`; no new privileged generic URL-read query.

### Admission order (common to all three)

1. Decode complete schema/shape and exact payload keys; forbid extra union fields, unknown command, malformed ID, bad revision, invalid kind or untrusted `peer`.
2. **Verify actual Core-side OS transport peer/session**, not presented `peer.userId` or claimed `surface='CLI'`; identity and same-logon facts come from an active `VerifiedPeerSessionPort`, independently approved/native-packaged Windows transport. On unsupported/nonverified transports return typed `UNSUPPORTED_TRANSPORT` **before journal or network**. Only installed local CLI same-user/same-logon is admitted for this first S4 carrier; `DESKTOP_UI`/extension and legacy TCP are forbidden, even when frame claims CLI.
3. Look up the already durable **accepted and confirmed** `SINGLE_RESOURCE` contract, exact immutable selection snapshot, target and single selected member, `continuationScope=NONE`, and current `expectedRevision`. For this initial v0.1 design, **preselection without accepted contract/snapshot is NOT_SUPPORTED**; remove ambiguity left in #141 about a caller-supplied preselection lineage. Core derives profile and trusted public-origin policy from its own pinned installation registry, **never from any submitted origin/host list**.
4. Resolve one of the closed payload variants below; only Core registry/ledger may mint challenge, preview, selected member/effect and budget record. No surface-supplied `confirmed`, arbitrary URL allowlist, OS SID, credentials, output pathname, tool invocation, media PASS, terminal `COMPLETE` or `forceSuccess`.

The existing `requestId`, `aggregateId`, `correlation.contractId/snapshotId`, `expectedRevision` and `issuedAt` are envelope-owned. Payload MUST NOT duplicate or contradict them. All intent/effect identities bind to a Core-derived stable hash over the durable contract/snapshot/member and exactly pinned selection. Reusing one `requestId` with identical intent replays the recorded acceptance/result; reusing it with different fields is a typed conflict **before a second effect**.

## 2. Closed payload shapes (wire JSON objects; no optional user authority)

These are **normative proposed fields** for an independently reviewed schema PR; field-name refinements require another exact-SHA L2 review, not opportunistic implementation.

```ts
type PreviewS4Payload = {
  snapshotId: string;          // must equal envelope correlation.snapshotId
  memberId: string;            // exactly the already-confirmed single member
  manifestUri: string;         // canonical credential-free public HTTPS *.m3u8
  mediaProfileId: 'BASIC_HLS_VOD_MPEGTS_H264_AAC_V1';
};

type ConfirmS4Payload = {
  snapshotId: string;
  memberId: string;
  previewId: string;           // Core-created, immutable and unexpired
  renditionKey: string;        // from this preview's Core-observed master
  confirmationChallenge: string; // Core-minted one-use opaque bearer
  displayedTupleDigest: string;  // checked against Core's own rendered tuple
};

type ExecuteS4Payload = {
  snapshotId: string;
  memberId: string;
  confirmedSelectionId: string; // Core-journalled successful CONFIRM, not caller proof
};
```

All strings bounded 1..128 **except** `manifestUri` ≤2048 and `confirmationChallenge` fixed encoding/entropy pinned by implementation. Exact primitive types, no nested maps or arbitrary unknown fields. `mediaProfileId` must match one Core registry entry and its exact revision/hash; `PreviewS4Payload` cannot submit custom media validation policy, per-domain budget, redirect host graph or `allowedOrigins`. Parsed canonical syntax via the reviewed pure `parsePublicHlsUriCandidate` (PR #142) is **only a lexical preflight**, never proof of permitted network destination. `expectedRevision` is a Core-verified optimistic CAS, not a user-asserted source-of-truth.

**Response** remains the frozen `SeamOutcome=ACCEPTED|REJECTED|PROJECTION` with Core-owned `READ_PROJECTION`. An `ACCEPTED` preview means the preview intent was durably registered, NOT that a rendition was fetched or confirmed. Renderable preview facts are returned only from the Core projection after actual independently observed playlist parsing, never an untrusted CLI preview upload. Typed rejection diagnostics include `UNSUPPORTED_ENVELOPE_VERSION`, `UNKNOWN_COMMAND_TYPE`, `ENVELOPE_MALFORMED`, `PEER_UNAUTHORIZED`, `STALE_REVISION`, `PREVIEW_REQUIRED`, `NEEDS_USER_ACTION`, `CHALLENGE_REPLAYED`, `AUTH_REQUIRED`, `SCOPE_DENIED`, `UNSUPPORTED_TRANSPORT`, `INSUFFICIENT_EVIDENCE`; actual names must be reconciled with existing `SeamDiagnostic` union and reviewed as one closed change, never invented dynamically. Core records durable reject/failure truth where an effect intent was accepted; malformed/unauthorized inputs fail before side effects.

## 3. PREVIEW — bounded journal-before-network, no download admission

A request is admissible only on the authenticated CLI session after the accepted snapshot and current revision check. Before any network read, Core CAS-journals a preview identity and **reserves bounded bytes/retries/time/redirect budget from T009**, with a stable `previewId`; the registry's allowed origin set and policy revision are internally pinned. The existing trusted T009 manifest port must receive these Core-owned bounds. The initial profile supports canonical public HTTPS manifests and selected basic single-rendition finite VOD media playlist only. **No credentials, signed query, cookies, HTML auth fallback, DRM, live reload or general site discovery**.

The preview result must store a secret-free immutable digest of (contract/snapshot/member/manifest source + actual master/rendition metadata + canonical selected ancestry + trusted policy/profile revision + allowed origin graph + Core authenticated session). Preview has short Core-enforced TTL (proposed maximum 120 seconds); Core expires it and revokes its derived confirmation challenge on restart or OS-session change. A rejected/missing/ambiguous master or unsupported topology produces typed `UNKNOWN/UNSUPPORTED/INSUFFICIENT_EVIDENCE`, no confirmable selection and no artifact/Transfer/Media PASS.

The trusted CLI displays **only Core-projected** supported variants, selected source, codec/width/height/bandwidth and bounded origin graph. It presents an explicit YES/NO prompt for **exactly** the selected `renditionKey`; non-interactive/EOF/timed-out/negative answer = `NEEDS_USER_ACTION` or declined, never auto-YES. Preview may not silently claim that selected segment URLs are public; those still require per-hop proof at execute time.

## 4. CONFIRM — explicit user gesture and Core-issued one-use challenge

Core stores a server-side challenge commitment generated from at least 128 bits of cryptographic random bytes, scoped to (Core install, OS-verified user and logon session, active connection, previewId, contract/snapshot/member, selected rendition, displayed digest, expected revision, expiry). Raw challenges must not enter persisted logs or error messages. A malicious same-user process may simulate local CLI input: **this is not strong human-presence attestation** and the product must not claim that it is.

Core refuses confirmation unless the challenge matches its exact pending commitment, preview and displayed tuple, is unexpired, is bound to the current authenticated OS session and unchanged scope, and the user interaction positively occurred via the trusted installed CLI. Consume the challenge *atomically* with a durable `confirmedSelectionId` record, marked one-use. A client-provided `confirmed:true` or echo of a user-authored hash without Core state **never suffices**. Duplicated identical requestId is replay of already recorded decision, not a second confirmation. After restart, **uncommitted** preview/challenge state is revoked; committed selections can be read only for the identical original effect scope and do not authorize a new separate work item.

## 5. EXECUTE — authoritative stable effect, origin validation and Media truth

Look up Core-owned `confirmedSelectionId` and immutable user-picked `renditionKey`; reject changed contract/member/manifest/variant/preview graph/policy, a later cancel, stale snapshot or expired authority. Core derives exactly one member `effectId/workItemId/artifactId`, CAS-journals its effect intent and budget debit **before** every outbound action, and delegates to the existing T009 selected-HLS engine. Cancellation wins over any late byte/probe callback. Retried/restarted identical accepted effect is an idempotent projection/reconcile, **not** a second debit or blind duplicate fetch.

Actual network permission is **a separate gate**, not granted by `parsePublicHlsUriCandidate` or an apparent FQDN. Per master/rendition/segment/redirect hop, intersect (1) pinned trusted-installation origin allowlist, (2) Core-observed immediate playlist ancestry and selected rendition graph, (3) user-confirmed bounded scope. Reject redirect host widening, query-bearing auth/signed URLs, unsupported ports/DRM/HLS encryption and private/link-local/loopback/metadata targets. Resolve and classify all A/AAAA/CNAME destinations, block IPv4/IPv6/IPv4-mapped reserved ranges, and ensure the **actual TLS-connected IP** equals a verified permitted resolved address for that exact hop (SNI/certificate hostname remains original authorized origin). If the HTTP stack cannot enforce connection-address pinning, refuse `UNSUPPORTED_TRANSPORT`; **Node global fetch with only a hostname string is not an acceptable production authorizer**. Production cannot enable localhost fixtures.

A `COMPLETE` terminal must follow durable actual target/transfer/format/media validation using the real bounded FFmpeg #138 port and the existing Core projector, including frame coverage; an accepted HTTP 200, playlist bytes, CLI `ACCEPTED` or confirmed selection can never claim successful acquisition. FFmpeg unavailability or ambiguous sparse/unsupported profile fails conservatively.

## 6. Review/proof matrix (required before code may use new authority)

- 1.0/1.1 attempted S4 opcode, unrecognized 1.2/1.3 extension keys, malformed payload, S3 opcode accidental unlock and downgrade from 1.2 accepted journal → old Core: refuse before effects.
- Caller-supplied peer claims CLI but OS token/session is absent, different logon, browser or legacy TCP: `PEER_UNAUTHORIZED/UNSUPPORTED_TRANSPORT`; no preview fetch.
- Forged install-origin policy, browser/model suggested CDN list, stale snapshot/member, wrong profile, reused requestId with differing payload: reject with no new budget/network.
- Preview budget exhausted, post-preview master/variant changed, restart mid-preview or challenge pending, end-of-file/headless/no user confirmation: no effect, no forged selection.
- Replay/reuse/cross-session challenge, expired challenge, inconsistent tuple hash, changed rendition and confirmation after cancellation: no committed effect.
- URL confusables, signed token query, encoded separator, private DNS A/AAAA, CNAME and rebinding between check/connect, HTTPS redirect to metadata or undeclared CDN: no outbound effect to denied destination; tests must prove actual connected IP binding with controlled DNS/HTTPS transport.
- Real 3-segment HLS success and injected corrupt, TS null/sparse/uniform-thinning, tool absent, crash between budget and media acceptance, late cancel: canonical verified or truthful failed/UNKNOWN terminal, never synthetic completion.
- Real packaged local CLI → OS-verified Core → HTTP/CDN/FFmpeg installed test → #100 Product G1; separately independent user #81 G0/G1a/b/c before Release.

**Dependency:** separate exact-SHA independent **L2/schema/security review of this proposal**, followed by bounded Contract/Codec PR, Core internal preview/confirm/execute authority PRs, shipped CLI UI PR, Windows/DNS/FFmpeg evidence and final qualification. This proposal **does not change `CORE_SEAM_SCHEMA_VERSION=1.1.0`, `COMMAND_TYPES`, the installed Core, transport or any frozen gate**.

`SCHEMA_FREEZE_READY=NO` pending independent reviewer. `S4_INSTALLED=NO`, `#100_PREFLIGHT=NO`, `RELEASE_PASS=NO`.
