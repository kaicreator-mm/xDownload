# T013 Implementation Map — exact base `f5ac137f94438a591fd6781c5b758be6c375233a`

This map records seams that exist on the exact integration base. It does not freeze a new Product/L2 module layout and does not authorize downstream implementations.

## Existing repository seams

| Exact current path | Exact-base fact | T013 use / constraint |
| --- | --- | --- |
| `packages/core-seam/` | T004 (issue #23, merge `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2`) — `@xdownload/core-seam`, the versioned local command/query authority boundary: the CLI's consumption contract | The ONLY channel for CLI command submission and status reads. See row-level detail below. |
| `packages/core-seam/src/client.ts` | `createSeamClient({ transport, target, peer, maxReconnectAttempts })` → `submitCommand` / `submitQuery` / `close()`; reconnect re-submits with the SAME idempotent `requestId`; never starts/stops Core as an authority prerequisite; never caches authoritative state | The CLI's client behavior layer builds directly on this; do not fork a second client with private retry/reconnect semantics. |
| `packages/core-seam/src/envelope.ts` | `CORE_SEAM_SCHEMA_ID 'xdownload.core-seam'` @ `1.0.0`, supported majors `[1]`; closed v1 command vocabulary `SUBMIT_CONTRACT`, `CONFIRM_SNAPSHOT`, `CANCEL_LINEAGE`, `RETRY_FAILED_MEMBERS`, `PROJECT_TERMINAL_RESULT`; closed query vocabulary `READ_PROJECTION`; `CommandEnvelope` (`requestId`, `aggregateId`, `expectedRevision`, `correlation`, `issuedAt`, `payload`), `QueryEnvelope`, `SeamResponse` (`ACCEPTED`/`REJECTED`/`PROJECTION`, `acceptance.revision`/`.converged`, `currentRevision`, `projection`, `diagnostics`) | Defines submit vs acceptance-vs-result separation, cancel/retry routing vocabulary and machine-readable status reads. Unknown discriminants reject — the CLI must not invent command types. |
| `packages/core-seam/src/peer.ts` | `SURFACE_KINDS = ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION']`; `PeerIdentity` (install/user); authorization re-decided per frame, never per process lifetime | The CLI presents `SurfaceKind 'CLI'`; identity handling stays with the seam — no CLI-local admission path. |
| `packages/core-seam/src/diagnostics.ts` | `SeamDiagnostic` reuses the exact `ValidationDiagnostic` shape of `@xdownload/domain-contracts`; seam-only codes (`PEER_UNAUTHORIZED`, `UNSUPPORTED_ENVELOPE_VERSION`, `PAYLOAD_TOO_LARGE`, `UNKNOWN_COMMAND_TYPE`, ...) extend, never replace, the vocabulary; payload decode failures surface domain diagnostics verbatim | The CLI's exit/diagnostics projection renders these verbatim; never reword, swallow or reinterpret into success. |
| `packages/core-seam/src/bounds.ts` | `SEAM_MESSAGE_LIMITS` (`maxFrameBytes` 1 MiB, `maxPayloadBytes` 768 KiB, `maxDepth` 32, ...) — declared wire contract, pre-decode enforcement | Batch input sizing and error reporting must respect/expose these bounds; the CLI cannot lift them. |
| `packages/core-seam/src/transport.ts` / `transport-loopback.ts` | Transport-neutral frame codec (4-byte BE length prefix + UTF-8 JSON, `MAX_FRAME_BYTES` enforced) + F1 concrete loopback TCP transport (`node:net`, loopback-only bind, no anonymous path) | The CLI consumes `SeamClientTransport`/`SeamListenTarget` ports; loopback transport is available (and is the concern-test harness transport) without freezing it as the production transport (frozen L2 §6.9). |
| `packages/core-seam/src/projection.ts` | Read side: deep-frozen canonical views (`ContractProjectionView`, `SnapshotProjectionView`, `LineageProjectionView`, `SeamProjectionView` incl. terminal result "present only once projected"); per-surface status derivation rejected; terminal truth not rewritable | Source of truth for the PRD §27 machine-readable status fields; the CLI renders views, never derives statuses. |
| `packages/core-seam/src/server.ts`, `src/state.ts`, `src/ids.ts` | Authority pipeline (authorization → bounds → version → decode → idempotency → revision → payload decode → transition/read → response); seam-layer ids nominally distinct from domain ids | Reference only. The CLI is never a server-side writer; seam ids never substitute for domain identity in payloads. |
| `packages/core-seam/test/transport-loopback.test.ts` (+ `helpers.ts`) | In-process harness: `createCoreSeamServer` + loopback server/client transports + `createSeamClient` + `stampPeer` over a real local socket | Reusable pattern for T013 concern tests exercising the CLI adapter end-to-end without Desktop or external services. |
| `packages/domain-contracts/` | T002 + T007 (issue #26, merge `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`) — `@xdownload/domain-contracts`: canonical vocabulary (`AcquisitionContract`, `SelectionSnapshot`, scopes, budgets, evidence/validation, multidimensional `TerminalResult`, `result-projector`), runtime decoders (`decode.ts`, `version.ts`), `ValidationDiagnostic` | Canonical payload construction before envelope submission and the semantics behind status rendering; the CLI consumes, never redefines, this vocabulary. |
| `packages/persistence-ledger/` (T005), `packages/core-scheduler/` (T006), `packages/direct-acquisition/` (T008), `packages/browser-auth-broker/`, `packages/browser-observation/` (T010), `packages/discovery-recipe/` (T011) | Core-side/surface-side lanes behind or beside the seam | Out of T013 reach. The CLI must not import or depend on any of them directly. |
| `apps/browser-extension/` | Existing app under the `apps/*` workspace seam (T010 surface) | Precedent for CLI placement under `apps/*`; frozen L2 §8 logical map slots the CLI as `apps/cli/` — command/query adapter only. |
| `pnpm-workspace.yaml` | admits `packages/*` and `apps/*` | CLI app/package belongs under the existing `apps/*` seam. |
| `package.json` | root private ESM workspace; Node `24.21.0`, pnpm `12.8.1`; TypeScript/Vitest/ESLint/Prettier are dev dependencies; no CLI-related scripts yet | Modify only if narrowly necessary for T013 wiring (e.g. a bin/script). Do not broaden scripts into product execution authority. |
| `tsconfig.json` | strict TS, `noUncheckedIndexedAccess`; includes `packages/*/src/**`, `packages/*/test/**`, `apps/*/src/**` — but NOT `apps/*/test/**` | Known bounded wiring gap: CLI tests under `apps/cli/test/**` need a narrow `include` addition directly required by T013. |
| `vitest.config.ts` | Node environment; includes only `packages/*/test/**/*.test.ts` | Known bounded wiring gap: CLI concern tests need a narrow `include` addition (e.g. `apps/*/test/**/*.test.ts`) directly required by T013. |
| `eslint.config.js` / Prettier | root lint/format authority from T001 | CLI code must remain compatible; any edit must be tooling-only and directly necessary. |
| `docs/product/PRD-v0.4.2-review-candidate.md` | frozen Product semantics; §6.3 CLI first-class automation surface; §27 CLI Contract (acceptance/result separation, machine-readable field set, non-interactive `NEEDS_USER_ACTION`, exit semantics); §384-area resolved-scope display rule; §742-area verified-empty rendering rule | Read-only authority for WHAT the CLI must expose. |
| `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md` | frozen L2 blob `5f6865974a4f2dbe78062c26e66d6a24af43d4a7`; invariant 2 thin surfaces; single authority across surfaces (§663, §719–721 concurrent UI/CLI clients); CLI-must-not-depend-on-Desktop-lifetime (§487); adapter table row "CLI → CLI adapter only, minimal Core port, early end-to-end" (§885) | Read-only authority for HOW THIN the CLI must be. |
| `docs/implementation/v0.1.0/task-packs/T013_cli-adapter.md` | frozen T013 WHAT blob `b8f335d09b4a0aa4608fb755b6a1745e1ace29c0` | Read-only task authority. |
| `.agent/execution/T013/` | this JIT pack | Guidance/evidence only. Never ship as product content; not implementation source. |

## Current absence facts that matter

At the bound base there is **no** `apps/cli/`, no CLI entry point, no CLI-specific wiring in root scripts, and no packaged/composed production Core Control Runtime process for the CLI to connect to. T004 ships the authority server and transports as library packages, not a launched product daemon; durable production composition remains a downstream "Core integration" lane (L2 adapter table). T013 therefore builds the thin adapter and proves it against the seam via the same in-process/loopback composition the core-seam tests use, without inventing a Core daemon manager, service installer, or CLI-owned Core lifecycle authority.

This absence is not permission to invent later architecture. T013 stops at CLI parsing/presentation/client behavior, its golden/contract tests and CLI docs.

## Suggested bounded decomposition — non-authoritative F2 choice

The Builder may choose the exact layout under `apps/*`. Whatever is chosen should keep these concerns explicit:

- argv/batch-input parsing → canonical payload construction via `@xdownload/domain-contracts` decoders;
- envelope assembly + submission via `createSeamClient` (idempotent identity, reconnect convergence);
- projection read + golden machine-readable rendering (PRD §27 fields);
- exit-code/diagnostics projection (`SeamDiagnostic`/`ValidationDiagnostic` verbatim, non-success never success);
- non-interactive `NEEDS_USER_ACTION` bounded state;
- concern tests mapping to `TEST_MATRIX.yaml` (in-process seam server + loopback transport harness).

Do not add persistence, scheduling, discovery, transfer, media, browser or Desktop behavior; do not wrap the seam behind a second "compatibility" API that could fork contract semantics.

## Dependency decision seam

The exact base has no runtime dependencies in root `package.json`; Node built-ins (`node:util` `parseArgs`, `node:net`, `node:process`) cover CLI parsing/transport/exit concerns on the pinned Node `24.21.0`. Under F2 the Builder may add a narrowly justified CLI dependency only with exact package/version/license/provenance recorded, and Review must check the library does not become de facto Product/Architecture authority. The JIT pack intentionally does not preselect a library.

## Expected test placement seam

Root `vitest.config.ts` currently discovers only `packages/*/test/**/*.test.ts`; CLI concern tests need the narrow include wiring noted above. Tests should cover:

- golden machine-readable output fixtures (PRD §27 field set, deterministic serialization);
- submit acceptance vs final result separation (including submit-success-then-terminal-failure and vice versa);
- non-interactive bounded behavior (`NEEDS_USER_ACTION`, no indefinite blocking, typed errors);
- batch input (per-item identity/correlation, partial failure isolation);
- cancel/retry routing (`CANCEL_LINEAGE`/`RETRY_FAILED_MEMBERS` through the seam; duplicate convergence via idempotent identity; no surface-local precedence);
- diagnostics/exit projection (typed rejections rendered verbatim, non-success exits stable);
- no-private-lifecycle-authority negatives (no surface-side status derivation, no scope mutation via defaults/retry/batch, no Desktop lifetime dependency);
- applicable C-oracle renderings at surface level (see `TEST_MATRIX.yaml`).

No real network, filesystem persistence, browser, media transfer or Desktop harness belongs in T013 concern tests.

## Exact-base currentness rule

Before Builder claim, re-check:

- `version/v0.1.0` remains the manifest base or pack staleness has been explicitly classified/rebound;
- T013 branch descends from the manifest base;
- frozen Task Pack/ADS identities still match (`b8f335d09b4a0aa4608fb755b6a1745e1ace29c0` / `94cad2b0487e8a552c66d6bcd1cba36b7779383d`);
- all six core artifacts and `REFERENCE_PACK.md` exist exactly once;
- no competing Builder claim/dispatch has already won admission.
