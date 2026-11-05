# Task Pack R1 — Core Seam failed-connect recovery

> TASK_PACK_STATE: INDEPENDENT_REVIEW_REQUIRED
> Task: #370
> Parent acceptance: #367 (PR #369)
> Parent integration: #310
> Task ID: `V022-CORE-SEAM-FAILED-CONNECT-RECOVERY-01`
> Version: xDownload v0.2.2
> ADS: v4.18.0 / `2c395c55569fe2edf3f4135f12d3d069e526d0b7`
> Integration target: `wip/v0.2.2-ui-rebuild-r0`

## 1. Why this task exists

The packaged Windows U05 disconnect/recovery acceptance for #367 proves that the Desktop renderer correctly marks cached S1 projections stale after Core loss. The recovery half remains FAIL: after the Core endpoint restarts on the same port and durable root, the same Desktop/Core Seam client remains unable to refresh.

The real packaged evidence and same-client diagnostic are recorded in #367 comment #6656210063. The diagnostic observes that `transport.connect()` is called once across two requests after the first connection rejection; both requests reuse the same rejected promise even after the endpoint is accepting connections.

This is a bounded Core Seam client lifecycle defect. It is independent of #367's renderer freshness Task Pack and must not expand #367's four-path write set.

## 2. Exact source diagnosis

Repository: `kaicreator-mm/xDownload`

Exact inspected integration base:
- Branch: `wip/v0.2.2-ui-rebuild-r0`
- HEAD: `39e5a9b5fdb61e2f0ee8f7d58e640861ee77baaa`
- Tree: `6cb4dea0181870ff5045e869f517083721b496fb`

Source:
- `packages/core-seam/src/client.ts`, blob `badf264166f9166e98e343269730811d35b90d5d`
- `packages/core-seam/test/lifecycle-restart.test.ts`, blob `009b5e2324196b61df3df995355de861d8e686f9`

In `ensureConnection()`, the `connecting` variable caches the promise returned by `transport.connect(...).then(successHandler)`. The success handler clears `connecting`; the rejection path does not. Once a connect attempt rejects, `connecting` retains the rejected promise. Subsequent requests return that same rejection and never invoke `transport.connect()` again. The existing restart tests create a new client after restart and therefore do not exercise a single client surviving a failed initial connect.

## 3. Required behavior

1. A rejected transport connection attempt must release the cached in-flight `connecting` promise so a later request can make a fresh connection attempt.
2. Clear the promise only if it is still the same attempt (`connecting === attempt`); an older completion must never clear a newer in-flight connection.
3. Successful connection behavior and listener registration remain unchanged.
4. Preserve the exact serialized request frame, requestId, aggregate identity and peer identity across the existing bounded reconnect/replay loop.
5. Do not mint a new requestId, change the idempotency model, claim exactly-once delivery, or turn a transport failure into a Core rejection/acceptance.
6. Preserve the public SeamClient API, transport abstraction, Core authority, close semantics, timeout cleanup and current retry bound/default.

## 4. Exact baseline and exclusive write set

Exact integration base:
- Branch: `wip/v0.2.2-ui-rebuild-r0`
- HEAD: `39e5a9b5fdb61e2f0ee8f7d58e640861ee77baaa`
- Tree: `6cb4dea0181870ff5045e869f517083721b496fb`

Exact two-path write set:
1. `packages/core-seam/src/client.ts`
2. `packages/core-seam/test/lifecycle-restart.test.ts`

The source branch and Execution Pack must start from the exact base above. The only permitted source changes are the two listed paths.

Forbidden: Desktop renderer/manager/adapter, Core runtime/server, Host, CLI, transport implementation, IPC, protocol/envelope schema, peer identity, DomainHarness, SDK, package manifests, lockfile, CI, Product/L2, any third source/test path, main/version/tag/release/deployment, Native Host/registry, external downloads or production installation.

## 5. Required regression coverage

A. **Same-client recovery after initial connection refusal**
- Reserve a loopback port and release it so the initial target is unavailable.
- Wrap the loopback client transport with a connect-attempt counter; create one SeamClient with bounded reconnect attempts set to zero for deterministic first-attempt failure.
- Submit a command with a fixed requestId; assert the request rejects because the endpoint is unavailable and connect-attempt count is exactly one.
- Start a Core Seam server on the same host/port and same test journal.
- Submit the exact same command envelope through the SAME SeamClient instance.
- Assert the second call increments connect-attempt count to exactly two, returns Core ACCEPTED, and the Core accepted-command count is exactly one.

B. **Same identity remains idempotent**
- Replay the exact same command envelope/requestId through the recovered client.
- Assert the Core returns its converged accepted result and accepted-command count remains one.

C. **Existing lifecycle behavior**
- Keep current Core restart/re-submit, connection-loss, timeout, close, listener, and peer-scope tests passing.
- Do not weaken or remove existing tests.

D. **Concurrency/cleanup safety**
- Preserve single-flight connection establishment for concurrent requests.
- Use identity-checked cleanup so a settled attempt cannot clear a different in-flight attempt.
- No unhandled rejection is introduced by cleanup.

## 6. Claim, validation and review

- Task Pack branch: `planning/v0.2.2-core-seam-reconnect-r1`
- Source branch: `task/v0.2.2-core-seam-reconnect-r1`
- Execution branch: `execution/v0.2.2-core-seam-reconnect-r1`
- Execution manifest: `.agent/execution/V022-CORE-SEAM-FAILED-CONNECT-RECOVERY-01/MANIFEST.yaml`
- Required generation-1 CAS `DISPATCH_CLAIMED` must bind this Task Pack, manifest, exact base/tree and exact two-path write set and be read back before source mutation.
- Builder owns implementation, repair and local validation continuously; no separate LOCAL_VALIDATION task.
- Node v24 syntax/preflight and changed-file Prettier before tests/CI.
- Focused Core Seam test suite, `pnpm run typecheck`, aggregate `pnpm run ci:verify`, `tools/task-check.sh`, exact-SHA local Docker Woodpecker SUCCESS.
- Run the real same-client loopback regression on the exact candidate SHA; report request IDs, connect-attempt count, accepted-command count, and exact HEAD/tree.
- Independent Exact-SHA source review after final candidate. Any reviewer repair remains within the two-path write set; rerun all SHA-bound gates after repair.
- Then re-run the packaged Windows U05 disconnect/recovery acceptance from #367 against the integrated WIP candidate. This Task's unit tests do not replace the packaged Windows gate.

## 7. Closure and delivery boundaries

No merge to `main`, no `version/v0.2.1` changes, no tag, release, deployment, Native Host/registry mutation, external network download, or production install.

#370 may close only after the exact two-path candidate passes all required automated gates and independent Exact-SHA review. #367/#310 remain open until the separate packaged Windows disconnect/recovery acceptance passes.
