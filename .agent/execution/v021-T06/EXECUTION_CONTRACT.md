# T06 Execution Contract — HLS VOD S4 K/Host integration

## 1. Authority and exact subject

Frozen authority:
- DAG blob: ecb2e31088c9e3895fad042401f737938c37628a
- Task Pack blob: c0cbed29ffa1a47cad5aed288aa262dd0dd549a8
- Product/L2/DAG reviewed subject: 07af78c3abee741196ff566a7f21fdfe15d71da7
- ADS: 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
- Product S4: PRD-v0.4.2 §28, S4 HLS VOD Basic REQUIRED; selected HLS VOD manifest, authorized context, provenance-bound CDN/segments, non-DRM simple topology, manifest/rendition/segment/final-media validation.
- Integration baseline after T01 closeout: version/v0.2.1@e71ff24c4d4e04e86bb7771c23309b55e4fb5a16, tree 5f2116fc5de75f92d8069d0ff5fbae6cae551a37
- T01 dependency: Issue #250 CLOSED; PR #272 merged as e71ff24c4d4e04e86bb7771c23309b55e4fb5a16.
- Native dependency readback: T06 #255 blocked_by #250; predecessor is closed. Preserve the edge as DAG history.

- Task Issue: #255 (v021-T06), risk high, independent review required.
- Task branch: task/v0.2.1-t06-hls-s4-k-host-integration, created from the exact integration baseline above.
- Exclusive Builder write set: packages/download-domain-app/src/integrations/s4-hls-vod*, packages/download-domain-app/src/integrations/index.ts, packages/download-domain-host/src/media/**, packages/hls-vod-adapter/**.
- This pack is subordinate to the frozen Product/L2/DAG/Task Pack and cannot add a new media engine or broaden S4 support.

## 2. Frozen Task Pack requirements

- Output: an explicit bounded S4 HLS VOD journey through selected K/Host, reusing the existing HLS engine and transfer-budget contract.
- Acceptance: controlled authorized HLS fixture, explicit variant/scope policy, real materialized output and applicable integrity checks; unsupported live/DRM/ambiguous cases refuse truthfully.
- Forbidden: no new media engine, DRM/access bypass, implicit playlist crawl or S4 claim from unit tests alone.

## 3. Existing seams to reuse

- packages/hls-vod-adapter/** is the existing HLS data plane: master/media playlist decode, rendition binding, segment planning, budget ledger, bounded async pipeline, integrity validation, assembly and pinned Host ports.
- packages/download-domain-host/src/media/media-acquisition-bridge.ts already owns HLS Host effects, permit gate, bounded manifest/segment reads, artifact materialization and canonical terminal envelope.
- packages/download-domain-host/src/media/media-permit.ts owns the exact-key media permit and transfer-budget binding.
- packages/download-domain-app/src/integrations/s3-media.ts is the existing K sealed-composition pattern for media.acquire; reuse the SDK source/tag pins and permit flow, but do not mislabel S4 as S3.
- packages/core-runtime/src/s4-selected-hls.ts and packages/core-seam/src/s4-seam12-payload.ts are read-only reference implementations for S4 preview/selection/execution semantics; T06 must not move Core authority into a surface or create a second Core path.
- Product §28 defines S4 as non-DRM supported simple topology with manifest/rendition/segment/final-media validation.

## 4. Required S4 journey

1. Provide a K-owned S4 journey that accepts only a selected HLS VOD manifest and an explicit selected rendition/variant. The selected manifest and rendition must be bound to one target and one finite scope.
2. Enforce an explicit variant policy: no silent "first variant" fallback when the user/confirmed intent has not selected one; missing, ambiguous or changed rendition refuses and requires a new confirmation.
3. Bind manifest, rendition, media playlist and segment locators through immediate playlist ancestry. Every segment/CDN locator must descend from the selected manifest/resource provenance and remain within trusted Host origin policy.
4. Use the existing Kernel permit + Host media permit path; bind request/lineage/target/scope/budget exactly. No surface-supplied permit, raw cookies, bearer headers or signed URL persistence.
5. Reuse the existing HLS adapter and one TransferBudget ledger. Manifest, playlist and segment requests consume the existing transfer budget. No second fetch engine, no hidden retry, no duplicate budget.
6. Validate manifest, selected rendition, media playlist, segment plan, assembled media and final artifact. A successful result requires real bytes materialized under the authorized output root and digest-backed evidence.
7. Reject live/ENDLIST-missing or unsupported topology, DRM/encryption, alternate/multi-track or post-processing requirements outside the frozen simple profile, invalid/mismatched variants, origin changes without provenance, oversize/timeouts and ambiguous inputs truthfully as UNSUPPORTED/FAILED/INSUFFICIENT_EVIDENCE.
8. Provide a deterministic controlled authorized HLS fixture and prove the real existing engine + Host bridge materializes a real file under the fixture lane. Keep installed packaged Host evidence NOT_PROVEN until T15/T16.

## 5. Contract boundary — do not mislabel S4

The frozen generic ConfirmedDownloadIntent contract currently admits S1/S3 and the existing media.acquire operation. Do not pass an S4 job through the generic intent as slice S3 or claim that S3 tests prove S4. Keep the S4-specific selection/variant binding explicit and exact-key validated within the T06 integration/Host seam, reusing the existing media.acquire Kernel/permit route where its contract fits. If a correct S4 K intent cannot be represented without changing a frozen public contract or adding an operation outside this write set, stop and report an ARCHITECTURE_CONTRADICTION for Owner/L2 routing; do not widen Product/L2 or forge S3 semantics.

## 6. Non-goals and stop conditions

- No new media engine, FFmpeg stack or HTTP/TLS stack.
- No DRM/encryption/access bypass, credential extraction, live stream reload, implicit playlist crawl or unbounded CDN discovery.
- No per-surface K instance, second scheduler/ledger or alternate effect authority.
- No changes to packages/domain-contracts/**, packages/core-seam/**, packages/core-runtime/**, app contract operation vocabulary, CLI/UI or packaging.
- Do not claim S4 complete from unit tests alone; actual controlled fixture materialization is required.
- Stop if existing Host origin pinning or permit contracts cannot safely express the selected S4 scope.

## 7. Verification

Pinned toolchain: Node 24.21.0, pnpm 12.8.1.
- Scoped HLS: pnpm exec vitest run packages/hls-vod-adapter/test packages/download-domain-host/src/media packages/download-domain-app/src/integrations/s4-hls-vod.test.ts
- Root: pnpm run ci:verify
- Required exact-HLS fixture: master → explicit rendition → media playlist → finite segments → assembled artifact; verify digest, output root and budget accounting.
- Negative: missing/ambiguous variant, changed playlist/identity, off-policy origin, live/no ENDLIST, DRM/encryption, malformed playlist, budget exhaustion, invalid permit, no file on refusal.
- Every result binds exact HEAD/tree, fixture identity, Node/pnpm, commands and exit codes. Independent Review is required.
