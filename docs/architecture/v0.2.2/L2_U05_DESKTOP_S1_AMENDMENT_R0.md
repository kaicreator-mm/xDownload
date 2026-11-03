# U05 L2 Amendment R0 — Desktop S1 Command and Durable Job Index

> STATE: OWNER_AUTHORIZED_SCOPE / PENDING_INDEPENDENT_REVIEW / NOT_YET_FROZEN
> VERSION: xDownload v0.2.2
> PARENT: Issue #310
> OWNER AUTHORIZATION: #310 comment 6616747471
> WIP BASE OBSERVED: 4d2148b80976532cecfaddc111c7fdc94980a289
> FROZEN L2 BASE: docs/architecture/v0.2.0/L2_R0.md (unchanged)

## 1. Existing authority reused

The existing Core Runtime already installs the S1 direct-acquisition route through the Core Seam command `EXECUTE_S1_DIRECT_ACQUISITION`. It runs `driveS1DirectExecution` after the accepted-command journal commit and derives terminal truth from the existing scheduler, ledger, artifact store, validation and ResultProjector. U05 must reuse this path; it must not create a Desktop HTTP client or another execution authority.

Existing command sequence:

1. Desktop submits `SUBMIT_CONTRACT` with one `SINGLE_RESOURCE` contract and the existing confirmation/peer gates.
2. Desktop submits `EXECUTE_S1_DIRECT_ACQUISITION` with `snapshotId`, `memberId`, `artifactId` and delivery facts (`locatorUri`, `declaredRedirectHosts`, optional digest/content-type/total-byte fields omitted by U05).
3. Core commits the accepted execution intent to the existing SeamJournal.
4. Core Runtime drives the existing S1 pipeline through DirectHttpAdapter and the single authoritative lifecycle stores.
5. Desktop reads `READ_PROJECTION`; only Core projection facts update the manager row.

## 2. New read-only Core job index query

Add the closed query discriminant `LIST_S1_JOB_PROJECTIONS` to the existing legacy Core Seam query vocabulary. This is a read-only query, not a command or a second state store.

Request contract:

- The query is authorized by the existing per-frame `authorizePeer` same-install/same-user check.
- `aggregateId` is the reserved query subject `core:s1-job-index`; it is not a lineage ID and must be accepted only with the new query discriminant.
- The query carries no user-supplied peer scope, path, filter expression or arbitrary predicate.

Core derivation:

1. Read accepted-command entries from the existing `SeamJournal.replayAll()` history; do not create another index file or persistence authority.
2. Select only `EXECUTE_S1_DIRECT_ACQUISITION` command entries whose peer `installId` and `userId` exactly match the already-authorized query peer.
3. Deduplicate by `aggregateId` and resolve each identity through the current Core seam authority state.
4. Derive each row using the same `projectAggregate` implementation as `READ_PROJECTION`; never synthesize status or terminal facts.
5. Sort by the original accepted S1 command `issuedAt` descending, with `aggregateId` as a deterministic tie-breaker.
6. Return at most 200 projections plus `totalCount` and `truncated`. `truncated=true` means the UI must not claim complete history.
7. If a journal entry references an aggregate without a current projection, fail the query closed with a typed diagnostic; do not silently omit a corrupt/inconsistent record.

Response shape (inside the existing `SeamResponse.projection` field):

```ts
type S1JobIndexProjection = {
  readonly items: readonly SeamProjectionView[];
  readonly totalCount: number;
  readonly truncated: boolean;
};
```

Protocol compatibility:

- Add the query discriminant without changing existing `READ_PROJECTION` or `READ_JOB_PROJECTION` semantics.
- Bump `CORE_SEAM_SCHEMA_VERSION` from `1.3.0` to `1.4.0`; keep supported major version 1.
- Existing v1 clients/commands and the explicit v0.2 Domain App query route remain accepted unchanged.
- Add strict decode tests for the new query subject, unknown query fields, peer mismatch, empty index, duplicate command identities, truncated list and projection-binding integrity.

## 3. Desktop adapter contract

- Add one typed adapter method to request `LIST_S1_JOB_PROJECTIONS`.
- Validate the response object, `totalCount`, `truncated`, and every projection with the existing projection decoder/binding checks.
- Keep `READ_PROJECTION` as the authority for a single aggregate refresh, cancel and retry.
- Add one typed `executeS1Direct` method that sends the existing `EXECUTE_S1_DIRECT_ACQUISITION` command through the existing `SeamClient`.
- Default `declaredRedirectHosts` to the URL's own `host`, matching the CLI default; no implicit redirect-host widening.
- The S1 command must bind to the contract just accepted by the same Desktop interaction. Derive opaque snapshot/member/artifact identities once and preserve them across retry/reconnect for the same command request identity.
- Do not treat command acceptance as completion; the next projection refresh remains authoritative.

## 4. Desktop shell manager contract

- Replace the in-memory `Map` of session-only jobs as the source of task enumeration with the Core index query.
- Keep only the pending, unsubmitted preview in memory; accepted jobs are rediscovered from Core after restart.
- Reopen a row by aggregate ID and call `READ_PROJECTION`; no contract/scope facts are fabricated for a task created by another surface.
- Cancel/retry actions still call the existing adapter methods and are re-decided by Core.
- Remove per-download destination/outputRoot from manager IPC documents and active shell methods. No folder picker/reveal IPC remains in the U05 flow.
- Manager rows expose no artifact path unless Core later returns an explicitly typed, validated path. Current S1 projection exposes no such path.

## 5. Security and authority invariants

- Query is read-only and per-frame peer-authorized.
- Same-install/same-user scoping is derived from the verified peer, never from renderer-supplied filter fields.
- The existing SeamJournal is the only durable enumeration source; the Core projection is the only status source.
- No second K, scheduler, journal, ledger, SQLite store, HTTP transfer client or terminal-result projector.
- No new surface may write budget, result, validation, target evidence or artifact state.
- URL must pass existing HTTP(S) validation; redirect allowlist is the URL host only by default.
- Desktop may not display progress/ETA/bytes/complete/path that Core did not project.

## 6. Verification

- Core Seam unit tests: list query strict decode, same-user filtering, cross-user rejection, deduplication, stable order, empty list, >200 truncation and corrupted journal/projection mismatch fail-closed.
- Core integration tests: S1 accepted command appears in index, terminal projection refresh, duplicate command convergence, Core restart preserves index and projection.
- Desktop adapter tests: command sequence, command identity stability, projection verification and no acceptance-as-success.
- Desktop shell tests: session restart/reopen, cancel/retry routing, no per-download destination IPC, truthful empty/truncated history.
- Use only deterministic localhost fixtures. No real external download, Native Host, registry or production installation.
- Node 24 syntax and changed-file Prettier before CI; typecheck, aggregate `ci:verify`, local Docker Woodpecker exact SHA, and independent Exact-SHA review.

## 7. Explicit non-goals

- No per-download outputRoot, destination picker or reveal action.
- No S2–S6 additions.
- No new external provider, plugin, downloader, K, scheduler, journal, ledger, SQLite authority or transfer engine.
- No Product/L2 changes outside this U05 addendum.
- No main/version merge, release, tag or deployment.