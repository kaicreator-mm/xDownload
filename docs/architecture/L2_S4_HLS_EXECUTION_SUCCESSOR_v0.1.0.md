# S4 successor — Core-owned basic HLS VOD execution (v0.1.0)

**Authority:** #106; **state:** PROPOSED, not adopted. **Frozen subject:** `version/v0.1.0@0d9fd0bb6c5c3cb735e7feedd148228f15d8bc78`. **Context:** #100 installed S4 entrypoint FAIL; #103 is S1-only authority, not HLS approval. **Frozen scope:** PRD §§14–16, 20–22, 28 S4, 29, 31; L2 single Core authority and T009/T015/T017 implementation intent.

## Decision requested

Approve a narrowly typed **HLS VOD acquisition workflow carrier** that reuses existing T009 ports from `packages/hls-vod-adapter/src/{playlist,bind,topology,plan,budget,acquire,assemble,validate,pipeline}.ts`, composed into the **single durable Core authority** and a real installed browser/CLI selection path. The library's `executeHlsVodAcquisition` returning a canonical typed outcome is not by itself production user execution or artifact acceptance. A separate exact-SHA architecture review is required before any implementation dispatch; #103 S1 direct-file execution does not pre-authorize HLS opcodes.

## Supported topology and user request

Supported: confirmed **non-DRM simple HLS VOD**, one independently evidenced selected manifest and supported rendition, deterministic finite media segments, supported local assembly and final-media probe. Must reject unsupported `EXT-X-KEY` encryption/DRM, separate A/V and subtitle/multi-audio topologies requiring additional mux, live/indefinite playlists, and unbounded navigation; do not reclassify them as a direct opaque file success. The user selects or confirms a source/rendition via installed surface; model/Recipe proposals cannot expand scope or certify the manifest.

## Proposed Core-owned execution sequence

1. Surface passes only a confirmed **manifest URL + rendition identity + member/contract/snapshot references** and an explicitly bounded list of authorized manifest/segment CDN hosts. Browser-scoped auth context is resolved in the privileged zone; no raw cookie/token/signed secret exported to Core, model or durable Recipe. A changed manifest/rendition/scope requires re-confirmation and successor snapshot where material.
2. Core validates the closed execution command, peer, immutable scope, budget and authorization binding; journals intent, creates durable work item and reserves budget before any active generated requests. Only Core schedules manifest parse, media/rendition selection, segment plan and acquisition; never a competing browser-local scheduler.
3. Use T009 `playlist`, `bind`, `topology`, `plan`, `budget` ports to parse master/media playlist and freeze exact rendition/segment identities and order. Manifest identity, segment sequence/byterange and allowed-host graph are explicit; unaccounted or altered segments do not silently count as accepted.
4. Fetch only planned segments under **TransferBudget + GlobalSafetyBudget**, including retry/resume budget and bytes. No unrestricted DASH/recursive site frontier. External media assembly tool is a bounded capability, with reproducible inputs/version and no arbitrary shell command from templates or user URLs; validate produced media via actual probe, topology and final artifact checks.
5. T009 `validate` and frozen PRD §22 require **Target, Transfer, Format, Media** checks of manifest, segment set and assembled media as applicable; missing segment, unsupported encryption/topology or unverifiable final media must produce truthful FAILED/UNSUPPORTED/UNKNOWN. A valid playlist or count-equal segments alone never establishes final media correctness. Only the authoritative Core ledger can accept durable bytes and project the exact terminal.
6. Restart/cancel/retry must reconcile manifest/segments/assembled bytes and Core budget reservations from durable facts. Replaying journaled intent is not permission to re-download accepted segments or double-charge. Corrupt/missing media files, incomplete segments or changed rendition cannot be considered `COMPLETE`.

## Required negative battery

| Counterexample | Required truth |
|---|---|
| Live playlist / no VOD closure | UNSUPPORTED or UNKNOWN, no false natural-end |
| Unsupported encryption/DRM or separate A/V | UNSUPPORTED, no silent decryption/mux claim |
| Master/rendition swap after confirmation | Block wrong target, new selection authority required |
| Segment absent/truncated/byterange mismatch | Transfer/Media failure, no accepted artifact |
| Segment URL leaves declared host graph | Deny, no scope expansion or credential export |
| Manifest says 12 segments, one invalid | Not complete even when request count reaches 12 |
| Assembly/probe fails or final media malformed | Media/Format FAILED, no COMPLETE |
| Crash between segment acceptance and assembly | Durable resume/reconcile, no duplicate effect/budget |
| User cancels then retry/late completion arrives | Core cancellation precedence and truthful terminal |
| HLS browser auth expires | AUTH_REQUIRED/AUTH_FAILED appropriately, no raw secret leak |

## Implementation and release gating

**#106 separate independent L2 review and adoption → bounded Core HLS integration PR → separately bounded installed surface flow → independent real host ffmpeg/browser+Native Messaging E2E (manifest/segment/media/oracle) → #100 journey verification → exact-candidate T019/T020/T021/T023 → #81 genuine human effort Product Gate**. S3 and S4 implementation may proceed in independent worktrees **only once their respective contracts have been reviewed** and file-level write sets do not conflict with the Core authority seam.

No Product scope reduction, no transfer of old candidate PASS, and no creation of a 29th frozen Task. **RELEASE_PASS=NO** until full closure.
