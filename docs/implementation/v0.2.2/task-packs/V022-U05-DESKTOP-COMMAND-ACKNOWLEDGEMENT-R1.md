# Task Pack R1 — V022-U05 Desktop Command Acknowledgement & Action Availability

> TASK_PACK_STATE: PROPOSED_FOR_INDEPENDENT_REVIEW
> Parent/root: xDownload #310 (U05 integrated Desktop acceptance)
> Primary defect: xDownload #317 (P1 attempt-vs-Core-acknowledgement)
> Bundled related defect: xDownload #319 (P2 terminal Cancel/Retry availability)
> Superseded related finding: xDownload #320 (reveal authority removed from current WIP; closed as superseded)
> Version: v0.2.2 successor
> Integration target: `wip/v0.2.2-ui-rebuild-r0` only
> Exact source base: `9d344bad27f3f687188a9ed021a54c95a188003f`
> Base Tree: `6ee458c2fc03f9aff5149967aa37d64ec53eed67`

## 1. Goal

Remove false Desktop success claims at the Core command boundary. An attempted command is not a Core acknowledgement. When a request may have reached Core but its response is lost, the Desktop must expose `SUBMISSION_UNKNOWN / RECONCILIATION_REQUIRED`, retain and replay the exact command envelope/requestId through the existing Core Seam idempotency path, and never mint a replacement request identity while the old disposition is unknown.

At the same time, align visible Cancel/Retry availability with the canonical Core lineage state so the UI does not offer actions Core must reject.

This is a bounded Desktop adapter/manager/renderer correction. It does not add a new Core protocol, K, journal, persistence store, IPC channel, permission, Product/L2 capability or download engine.

## 2. Exact baseline and governance

- Repository: `kaicreator-mm/xDownload`
- Parent: #310
- Primary bug: #317
- Bundled related bug: #319
- WIP branch: `wip/v0.2.2-ui-rebuild-r0`
- Exact base HEAD: `9d344bad27f3f687188a9ed021a54c95a188003f`
- Exact base Tree: `6ee458c2fc03f9aff5149967aa37d64ec53eed67`
- Planning branch: `planning/v0.2.2-u05-command-ack-r1`
- Execution profile: Web Builder implementation + Local Builder environment gates
- Review: independent Task Pack review before Claim; fresh independent Exact-SHA source review after implementation
- Risk: HIGH (false acknowledgement at user confirmation boundary)

## 3. Frozen exclusive write set

Only these eight paths may change:

1. `apps/desktop/src/adapter.ts`
2. `apps/desktop-shell/src/main/manager.ts`
3. `apps/desktop-shell/src/main/shell-contract.ts`
4. `apps/desktop-shell/src/renderer/manager-state.ts`
5. `apps/desktop-shell/src/renderer/renderer-main.ts`
6. `apps/desktop/test/core-disconnect.test.ts`
7. `apps/desktop-shell/test/manager.test.ts`
8. `apps/desktop-shell/test/manager-view.test.ts`

No other paths are permitted. In particular, do not edit Core Seam protocol/client, Product/L2, package manifests, lockfile, Browser Popup, reveal/IPC authority, CI, SDK/vendor or Native Host files.

## 4. Required implementation

### 4.1 Separate attempt from acknowledgement

- Preserve an explicit per-interaction attempted-command record for diagnostics.
- `InteractionOutcome.routed` and the shell action document's `routed` flag must mean that a valid Core response acknowledged admission; they must never be derived from a pre-send/cumulative attempt ledger.
- Add an explicit delivery state with at least `NOT_ATTEMPTED`, `ACKNOWLEDGED`, `REJECTED`, and `UNKNOWN`.
- A typed Core rejection remains `REJECTED`; a transport failure after submission invocation is `UNKNOWN`, never success and never a definitive non-delivery claim.
- `sentCommandEnvelopes()` may remain diagnostic attempt history, but manager success decisions must not inspect it.

### 4.2 Preserve idempotent identity and reconcile

- Contract confirmation must retain the exact `SUBMIT_CONTRACT` envelope while delivery is unknown. A repeat confirmation replays the exact same envelope/requestId through the existing SeamClient retry/idempotency path.
- The manager must not route `EXECUTE_S1_DIRECT_ACQUISITION` unless `SUBMIT_CONTRACT` is Core-acknowledged.
- The existing pre-send retained S1 envelope must be reused after an unknown S1 result. Keep the manager's add preview in an explicit reconciliation stage until the same S1 request is acknowledged or definitively rejected; the next confirmation action must replay the exact S1 envelope rather than resubmit the contract or mint a new requestId.
- Cancel and Retry must retain an unresolved exact envelope per aggregate/action. Repeating the same action replays the same envelope/requestId. A different control action must be refused while another control's disposition remains unknown.
- The Core Seam client's existing bounded reconnect loop already re-sends the same serialized frame/requestId. Reuse it; do not add a second retry loop, request-ID generator, local durable store, journal or reconciliation protocol.
- Unknown state must be visible as `SUBMISSION_UNKNOWN / RECONCILIATION_REQUIRED`. Do not render “accepted by Core”, create a confirmed row from an attempt, clear an unresolved preview, or invite a fresh command identity.
- Discarding an unresolved add preview must be disabled/refused until the same request's disposition is reconciled.

### 4.3 Align action availability with Core lineage state (#319)

- Cancel is enabled only for a present row with `lineageStatus === 'ACTIVE'` and no terminal projection.
- Retry is enabled only for a present `ACTIVE` or `CANCELLED` row when the existing Core-derived retry domain is available.
- `TERMINAL` rows must not expose Cancel or Retry, even if a stale/legacy retry summary says available.
- Do not change or broaden retry member identity derivation.

### 4.4 Action-level acknowledgement semantics

- Apply acknowledgement-only `routed` semantics consistently to every Desktop adapter command path that returns `InteractionOutcome`; `attempted` is a separate diagnostic list.
- For the shell Add action, `ManagerActionDocument.routed=true` only when both the contract submission and S1 execution have valid Core acknowledgements. A contract acknowledgement followed by S1 UNKNOWN or REJECTED is not a successful Add action.
- Add a typed `deliveryState` to the shell action document and a small main-process preview stage (READY / CONTRACT_UNKNOWN / S1_UNKNOWN) to the existing preview document. This is data on existing IPC documents, not a new IPC method/channel.
- If contract submission is UNKNOWN, keep the preview in CONTRACT_UNKNOWN and replay the exact contract envelope on the next confirmation.
- If contract submission is acknowledged but S1 is UNKNOWN, keep the preview in S1_UNKNOWN; the next confirmation attaches the same aggregate and replays the exact retained S1 envelope only.
- If S1 is definitively REJECTED, surface the Core rejection, do not claim Add success, and do not resubmit the already-acknowledged contract. Any visible row must come only from the fresh Core index.
- The renderer must label reconciliation explicitly (not “Confirm” as if a new command), keep the unresolved preview, and disable Discard while disposition is unknown. The action notice must state `SUBMISSION_UNKNOWN / RECONCILIATION_REQUIRED`.
- For Cancel/Retry, action-level `routed=true` only for a Core-acknowledged control response; UNKNOWN remains false and must not produce an accepted notice.

## 5. Required regression matrix

1. Core unavailable before Add confirmation: no acknowledged command, no accepted notice, no confirmed job row; explicit typed unknown/refusal state.
2. Core accepts `SUBMIT_CONTRACT` but the response is dropped: first UI result is unknown; a repeat uses the identical serialized envelope/requestId; Core converges to one aggregate, not two.
3. A prior successful command followed by a new failed attempt: cumulative diagnostic history cannot make the new interaction appear acknowledged.
4. Core typed rejection: `REJECTED`, rejection details preserved, no accepted notice and no S1 command.
5. Contract acknowledgement followed by S1 response loss: preview enters S1 reconciliation stage; repeat reuses the exact S1 envelope/requestId and does not resubmit the contract.
6. Cancel transport loss after possible delivery: unknown, no false accepted notice; same-action retry uses same requestId; a different action is refused until reconciliation.
7. Retry transport loss after possible delivery: same semantics as Cancel.
8. Successful Core acknowledgement: existing accepted behavior remains; projection remains the only source of task status/terminal truth.
9. #319 matrix: ACTIVE / CANCELLED / TERMINAL (including TERMINAL with missing terminal detail and TERMINAL with retryable failed-member facts); only the allowed states expose controls.
10. Renderer unknown-state notice, preview label and discard/confirm enabled state agree with the main-process delivery state.
11. Contract ACK + S1 typed REJECTED is not an accepted Add; the contract is not resubmitted, rejection remains visible, and any row comes only from the fresh Core index.

Use the real Core Seam path for the lost-response test: a transport wrapper may forward a command to the real disposable Core and drop the first response, then allow the exact same request frame to be replayed. Assert exact requestId/frame identity and exactly one accepted logical command. Do not simulate “accepted” by mutating renderer state.

## 6. Validation and evidence

The Builder owns implementation, repair and source-level validation in one continuous work unit. No standalone LOCAL_VALIDATION task is to be dispatched.

1. Re-read the exact WIP base/tree and this reviewed Task Pack before source mutation.
2. Publish/read back an accepted generation-1 CAS `DISPATCH_CLAIMED` bound to this Task Pack, base/tree and eight-path write set.
3. Node 24.21.0 syntax check every changed JS/TS file.
4. Changed-file Prettier check before tests/CI.
5. Focused tests:
   - `apps/desktop/test/core-disconnect.test.ts`
   - `apps/desktop-shell/test/manager.test.ts`
   - `apps/desktop-shell/test/manager-view.test.ts`
6. `pnpm run typecheck`.
7. `pnpm run ci:verify`.
8. `tools/task-check.sh` if present; otherwise record `NOT_AVAILABLE`, do not create it.
9. Local Docker Woodpecker `.woodpecker/xd-ui-r0-verify.yaml`; assert the checked-out HEAD equals `CI_COMMIT_SHA`, record actual pipeline/build ID, step names and exit codes.
10. Packaged Windows acceptance with a disposable Core and localhost-only fixture:
    - Core-down-before-confirm does not report acceptance;
    - lost response/reconciliation keeps the same request identity and produces at most one logical submission;
    - Cancel/Retry controls reflect canonical Core facts;
    - no real external download, production Core, installer, registry or Native Host side effect.
11. Write full exact-SHA/tree/base evidence and every gate's PASS/FAIL/NOT_RUN result to #317.

Any source repair stays inside the eight paths; after every new commit, re-read HEAD/tree and rerun all affected gates on the final SHA.

## 7. Dependencies and sequencing

- This Task is sequenced after U05 disconnect freshness #367 / PR #376, now integrated at WIP `9d344bad27f3f687188a9ed021a54c95a188003f`.
- #317 and #319 are bundled because their action-state behavior shares the same adapter/manager/renderer owner paths; one Builder/Reviewer lane prevents concurrent writes.
- #320 is excluded and closed as superseded because the current WIP removed the reveal method, IPC channel, preload bridge and renderer action.
- Do not start another task writing these eight paths until this task is integrated or explicitly stopped.

## 8. Forbidden

- No new K/Ks, Core Seam command/query, request identity or retry protocol.
- No fabricated accepted state, progress, ETA, bytes, terminal status or task row.
- No local durable authority/store, journal or duplicate Core state.
- No reveal capability, destination picker, new IPC method or preload bridge.
- No Product/L2/Domain Package/SDK/vendor/package manifest/lockfile change.
- No real external download, production install, Native Host/registry, main/version, tag, release or deployment.
- No WIP merge until local gates and fresh independent Exact-SHA review pass; integration is WIP-only and must be revalidated at the exact merged SHA.
