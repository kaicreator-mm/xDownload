# Task Pack R1 — Desktop command acknowledgement, reconciliation and terminal action gating

> TASK_PACK_STATE: INDEPENDENT_REVIEW_REQUIRED
> Task: #378
> Parent acceptance: #310
> Findings: #317 (P1), #319 (P2)
> Task ID: V022-U05-COMMAND-ACK-TERMINAL-ACTIONS-01
> Version: xDownload v0.2.2
> ADS: v4.18.0 / 2c395c55569fe2edf3f4135f12d3d069e526d0b7
> WIP integration target: wip/v0.2.2-ui-rebuild-r0

## 1. Why this task exists

The latest integrated WIP is:

- HEAD: 9d344bad27f3f687188a9ed021a54c95a188003f
- Tree: 6ee458c2fc03f9aff5149967aa37d64ec53eed67
- Woodpecker push Pipeline #56: SUCCESS at that exact SHA.
- U05 disconnect freshness #367 / PR #376 is closed after independent Exact-SHA R2 PASS, six packaged Windows acceptance scenarios plus one reviewer-repair regression, and post-merge WIP Pipeline #56 SUCCESS.

The U05 parent #310 remains OPEN / NOT_COUNTED for exactly two remaining Desktop action-contract defects:

- #317 P1: the adapter records command envelopes before transport. A lost response can be mistaken for Core acceptance because the manager uses the attempt ledger. A previous accepted/attempted command can also contaminate a later interaction. The ambiguous case must preserve the exact envelope and requestId and reconcile through Core idempotency.
- #319 P2: the renderer enables Cancel when terminal detail is absent, even for CANCELLED or TERMINAL lineages, and exposes Retry on TERMINAL lineages when failed-member facts remain. Core rejects those commands.

These two findings share Desktop adapter/manager/renderer ownership. They are one single-writer implementation task; do not run independent writers against manager-state.ts or manager.ts.

This is an implementation repair inside the frozen v0.2.2 Product/L2 scope. No Product/L2 amendment is required.

## 2. Exact base and frozen inputs

Repository: kaicreator-mm/xDownload

- Source branch / integration target: wip/v0.2.2-ui-rebuild-r0
- Exact base HEAD: 9d344bad27f3f687188a9ed021a54c95a188003f
- Exact base Tree: 6ee458c2fc03f9aff5149967aa37d64ec53eed67
- Post-integration Woodpecker Pipeline #56: SUCCESS.
- Frozen Product/L2 and U05 DAG: unchanged; read current canonical refs before execution.
- Related integrated reconnect/freshness dependencies: #370 / PR #372 and #367 / PR #376 are already integrated.

No source mutation is permitted until this Task Pack receives independent PACK_PASS and a generation-1 CAS DISPATCH_CLAIMED binds the exact current base/tree, the reviewed Task Pack, the execution manifest and the exclusive write set below.

## 3. Required behavior — command delivery

### 3.1 Attempt and acknowledgement are different facts

- An envelope added to an attempt/debug ledger is not proof of delivery or acceptance.
- A local validation/guard that prevents submitCommand from being invoked is NOT_ATTEMPTED; it must not create a command attempt or accepted signal.
- Only a valid Core response with outcome ACCEPTED establishes accepted command delivery.
- A valid Core response with outcome REJECTED establishes an acknowledged rejection; surface the Core diagnostics verbatim.
- Once submitCommand has been invoked, a transport exception is ambiguous because the command may have reached Core. Report SUBMISSION_UNKNOWN / RECONCILIATION_REQUIRED. Do not report success or definitive non-delivery.
- Interaction results must carry an explicit delivery disposition and bind it to commandType, aggregateId and requestId. Do not infer it from cumulative history length or presence in sentCommandEnvelopes().
- Keep attempt history for diagnostics, but maintain an independent acknowledgement record. Any compatibility field named routed must be true only when the current command has a valid Core ACCEPTED response; rejected and unknown commands are not accepted/routed.

### 3.2 Exact identity and reconciliation

- Preserve the exact immutable command envelope after an ambiguous transport failure, including requestId, aggregateId, expectedRevision, payload and commandType.
- Reconciliation must re-submit the exact envelope/requestId through the existing Core Seam idempotency path. Never mint a replacement requestId while the previous disposition remains unknown.
- A second unrelated command must not be sent while one command remains unknown.
- Reconciliation is explicit and visible. Reuse the existing Desktop refresh/re-entry or pending-confirmation interaction where sufficient; do not add a new IPC authority or protocol solely for this repair.
- If Core remains unavailable, preserve UNKNOWN and keep controls blocked. If Core returns ACCEPTED or REJECTED for the exact request, clear the pending unknown state and refresh the authoritative projection.
- Keep Core as the only authority for accepted state, job projection, progress, terminal truth and retry identity domain. No local durable job/acceptance ledger.

### 3.3 Two-stage Add flow

The Desktop Add action consists of SUBMIT_CONTRACT followed by EXECUTE_S1_DIRECT_ACQUISITION. They must be modeled as two separate command dispositions.

- If SUBMIT_CONTRACT is UNKNOWN, retain the preview and exact contract envelope. The visible action must say the submission is unknown and offer reconciliation of that same envelope. Do not execute S1 yet.
- When the exact SUBMIT_CONTRACT envelope is later acknowledged ACCEPTED, continue the already-confirmed Add sequence with one S1 command. Do not create a second contract identity.
- If SUBMIT_CONTRACT is ACCEPTED but EXECUTE_S1_DIRECT_ACQUISITION is UNKNOWN, consume/clear the preview because the contract is already accepted, retain the exact S1 envelope, and expose reconciliation. Do not resubmit the contract or create a second S1 request identity.
- If either stage is REJECTED, surface the typed rejection and never represent that stage as accepted.
- A prior accepted command in the adapter's cumulative history must never make a later command look accepted.

### 3.4 Cancel and Retry

- Cancel and Retry use the same explicit delivery dispositions as Add.
- If their transport response is ambiguous, keep the exact command envelope and requestId; do not mint a second control command.
- After exact-envelope reconciliation, read the fresh Core projection. The projection, not the command attempt, determines the displayed state.
- While any command is UNKNOWN, disable unrelated/new Add, Cancel and Retry actions. Keep the explicit reconciliation path available.

## 4. Required behavior — Core-terminal action gating

Canonical Core lineage status vocabulary is ACTIVE | CANCELLED | TERMINAL.

- Cancel is enabled only when the row is present, lineageStatus is ACTIVE and terminal is null.
- Retry is enabled only when lineageStatus is ACTIVE or CANCELLED and the existing Core-derived retry.available is true.
- TERMINAL rows never expose Retry, even when failed-member facts remain.
- CANCELLED rows never expose Cancel.
- TERMINAL-without-detail, terminal-present, absent-projection and unknown-status rows expose neither action.
- Do not broaden, re-derive or guess the retry identity domain.
- Do not use the legacy CLOSED fixture as a substitute for canonical Core TERMINAL.

## 5. Renderer and shell contract

- Add a typed delivery document/state that exposes only status + command identity (commandType, aggregateId, requestId); never expose command payload or secrets.
- The action response and subsequent list response must let the renderer distinguish UNKNOWN from REJECTED, ACCEPTED and NOT_ATTEMPTED.
- UNKNOWN must render explicit SUBMISSION_UNKNOWN / RECONCILIATION_REQUIRED wording, including the requestId needed to identify the pending logical command.
- Do not render any accepted notice unless the corresponding current command is ACCEPTED.
- Preserve the U05 stale/unavailable/fresh snapshot semantics introduced by #367.
- Disable all unrelated command controls while UNKNOWN. A preview retained for an UNKNOWN SUBMIT_CONTRACT may offer only exact-envelope reconciliation; a consumed preview after UNKNOWN S1 must not reappear.
- No new IPC method, preload bridge, query protocol, authority, persistent local store or Product/L2 field is permitted unless Task Pack review finds it indispensable; if so, stop and amend this pack before Claim/source mutation.

## 6. Exact exclusive write set

The proposed single-writer set is exactly:

1. apps/desktop/src/adapter.ts
2. apps/desktop-shell/src/main/manager.ts
3. apps/desktop-shell/src/main/shell-contract.ts
4. apps/desktop-shell/src/renderer/manager-state.ts
5. apps/desktop-shell/src/renderer/renderer-main.ts
6. apps/desktop/test/core-disconnect.test.ts
7. apps/desktop-shell/test/manager.test.ts
8. apps/desktop-shell/test/manager-view.test.ts

The independent Task Pack reviewer must verify all eight paths are necessary and sufficient. If another path is required, do not silently expand the set: amend this Task Pack, obtain fresh PACK_PASS and then materialize the Claim.

Forbidden paths and effects:

- All paths outside the eight-path write set.
- Core Seam, Core Runtime, Domain Contracts, Host, SDK, Browser, CLI, build scripts.
- preload/IPC implementation, package manifests, pnpm-lock.yaml, CI/Woodpecker configuration.
- Product/L1, L2, K/S, permission, query protocol, new authority or persistence design.
- main, version/v0.2.1, tag, release, deployment.
- Native Host, HKCU/registry, real external downloads, production installation or external network byte requests.

## 7. Required regression matrix

### Delivery and identity

1. A pre-send local guard refusal is NOT_ATTEMPTED; it produces no accepted notice or confirmed row. If submitCommand was invoked and transport then failed, classify it UNKNOWN.
2. Request may have reached Core but response is lost: explicit UNKNOWN; exact envelope and requestId retained.
3. Exact-envelope reconciliation after Core reconnect: same requestId, same aggregate, same payload; Core idempotency converges; no second logical command.
4. Core ACCEPTED response: current action is accepted and only then appears in the acknowledged ledger.
5. Core REJECTED response: current action is rejected with typed diagnostics; it never appears as accepted.
6. Previous successful command followed by a later failed command: later action remains UNKNOWN/REJECTED/NOT_ATTEMPTED as applicable; prior history cannot contaminate it.
7. Duplicate confirmation while SUBMIT_CONTRACT is unknown reuses the same envelope/requestId and does not execute S1 until acceptance.
8. SUBMIT_CONTRACT accepted + S1 unknown: preview is consumed, exact S1 envelope retained, no duplicate contract or S1 identity.
9. Cancel and Retry ambiguous delivery follow the same state machine; a different command is refused while UNKNOWN.
10. Reconciliation accepted/rejected result refreshes the Core projection; no status or terminal fact is inferred from the acknowledgement alone.

### Action availability

11. ACTIVE + no terminal: Cancel enabled; Retry only when retry.available.
12. CANCELLED + no terminal: Cancel disabled; Retry only when retry.available.
13. TERMINAL + no terminal detail: Cancel and Retry disabled.
14. TERMINAL + terminal detail: Cancel and Retry disabled.
15. TERMINAL + retry.available=true: Retry remains disabled.
16. Unknown lineage status, absent projection and terminal-present rows: both actions disabled.
17. While a pending command is UNKNOWN, unrelated Add/Cancel/Retry actions are disabled; only the exact reconciliation path remains available.

### Integration regression

18. Preserve #367 stale projection handling, same-client Core restart recovery, empty-index recovery, no fake progress/ETA, no fabricated count, and no stale-success styling.
19. Preserve existing U05 S1 bytes/digest, durable history, peer identity isolation, replay convergence and no-second-GET acceptance.
20. No real external download, Native Host or registry side effect.

## 8. Validation and independent review

- Node 24 syntax check on all changed TypeScript/JavaScript files before CI.
- Changed-file Prettier check before CI.
- Focused: apps/desktop/test/core-disconnect.test.ts, apps/desktop-shell/test/manager.test.ts and apps/desktop-shell/test/manager-view.test.ts (plus any exact affected adapter suite discovered in source).
- pnpm run typecheck.
- pnpm run ci:verify.
- tools/task-check.sh (if absent, record NOT_AVAILABLE; do not create it).
- Local Docker Woodpecker .woodpecker/xd-ui-r0-verify.yaml; assert git rev-parse HEAD equals CI_COMMIT_SHA, record Pipeline/Build ID and step exit codes.
- Packaged Windows acceptance with disposable Desktop/Core/Host process state and localhost-only fixture. Exercise unavailable-before-send, ambiguous response loss, exact-ID reconciliation, accepted/rejected, both Add stages, Cancel/Retry and terminal gating. No external network download.
- Fresh independent Exact-SHA review after the final Builder receipt. Re-read HEAD/tree/base, full diff, Task Pack blob, manifest blob, Claim, local gates and Woodpecker evidence.
- If review finds defects, reviewer repairs directly inside the same eight paths, updates exact SHA/tree and repeats every affected gate plus independent review. Do not hand the repair back as a separate task.

Builder owns implementation, bounded repair and local validation continuously. Do not create a standalone LOCAL_VALIDATION task. Independent review remains a separate exact-SHA gate.

## 9. Closure and integration

Close #378, #317 and #319 only when the source review, all exact-SHA gates and packaged Windows acceptance pass. Parent #310 / U05 root remains OPEN until these results are reconciled with the positive S1 and #367 freshness evidence.

WIP integration requires fresh independent Exact-SHA PASS and a fresh WIP base readback. No main/version, tag, release or deployment is authorized by this Task Pack.
