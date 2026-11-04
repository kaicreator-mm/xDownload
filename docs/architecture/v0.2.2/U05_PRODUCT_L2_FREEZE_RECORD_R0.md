# U05 Desktop S1 — Product/L2 Freeze Record R0

> FREEZE_STATE: OWNER_APPROVED / FROZEN
> VERSION: xDownload v0.2.2
> PARENT: #310
> TECHNICAL_REVIEW: PR #350 comment 6618552452 — PASS, P0=0/P1=0/P2=0
> OWNER_FREEZE_AUTHORIZATION: ChatGPT Owner authorization received 2026-11-04

## 1. Immutable approved baseline

The Owner approved freezing the following exact Product/L2 amendment contents. These source blobs are the immutable scope baseline; this record does not rewrite or normalize them.

- Planning HEAD at approval: `2ca7b4f6d503667d41ae15458ef2e4ef2eb143e3`
- Product: `docs/planning/v0.2.2/PRODUCT_U05_DESKTOP_S1_AMENDMENT_R0.md` — blob `d4edc5d477c14cdb30cc29b31c15a98237232ae9`
- L2: `docs/architecture/v0.2.2/L2_U05_DESKTOP_S1_AMENDMENT_R0.md` — blob `2b984b859acdba4e5cc9b85813fbbb4c29eea288`
- Frozen v0.2.0 Product baseline remains unchanged.
- Frozen v0.2.0 L2 baseline remains unchanged.

The preparation-state text inside the two immutable amendment documents is superseded by this Owner Freeze Record. No Product/L2 semantic change is made after the approved blobs.

## 2. Frozen capability boundary

- Desktop S1 single-resource HTTP(S) direct acquisition reuses existing `SUBMIT_CONTRACT`, `EXECUTE_S1_DIRECT_ACQUISITION`, and Core Runtime S1 driver.
- Durable S1 history is a read-only Core Seam query over the existing accepted-command journal and Core projections.
- Query subject is exactly `core:s1-job-index`; query requires seam schema 1.4.0+ within supported major 1.
- Query is same-install/same-user scoped from the verified peer; no renderer-provided scope/filter.
- `totalCount` is post-peer-filter and post-aggregate-deduplication; `truncated` is exactly `totalCount > items.length`; latest 200 entries are returned in reverse durable journal order.
- Core projection is the only source of status/terminal facts; no synthetic progress, ETA, byte totals, completion, artifact path or reveal.
- Core-configured output root only. No per-download `outputRoot`, destination field, picker, shell-owned destination or reveal action.
- S1 only. S2–S6 are excluded.
- No second downloader, transfer engine, K, Scheduler, Journal, Ledger, SQLite store or persistence authority.

## 3. Implementation governance

- U05 implementation DAG and exclusive write sets are frozen in `U05_DESKTOP_S1_IMPLEMENTATION_DAG_R0.md`.
- Each source task has its own Task Pack and GitHub Task Issue.
- Each Local Builder must publish its own accepted ADS `DISPATCH_CLAIMED` against the current exact base and exact write set before mutation.
- Node 24 syntax and changed-file Prettier are required before CI; typecheck, aggregate `pnpm run ci:verify`, local Docker Woodpecker and independent Exact-SHA review are required.
- Task T03 remains dependency-gated until T01 and T02 are independently reviewed and Owner-integrated to WIP; it must rebind its Task Pack and Claim to that new exact WIP base.
- Each WIP integration requires separate explicit Owner authorization after independent review.

## 4. Explicit exclusions

No `main`, `version/v0.2.1`, tag, Release, deployment, production install, real external download, Native Host, registry or permission side effect is authorized by this freeze.

```ini
U05_PRODUCT_L2_FROZEN=YES
PRODUCT_APPROVED_BLOB=d4edc5d477c14cdb30cc29b31c15a98237232ae9
L2_APPROVED_BLOB=2b984b859acdba4e5cc9b85813fbbb4c29eea288
TASK_DAG_FROZEN=YES
SOURCE_IMPLEMENTATION=NOT_DISPATCHED
LOCAL_BUILDER_CLAIM_REQUIRED=YES
INDEPENDENT_EXACT_SHA_REVIEW_REQUIRED=YES
WIP_INTEGRATION_OWNER_AUTH_REQUIRED=YES
MAIN_VERSION_RELEASE_DEPLOYMENT=NOT_AUTHORIZED
```