# @xdownload/cli — T013 CLI adapter

First-class automation surface (PRD §6.3) and thin command/query adapter over
the core seam (frozen L2 §8: `apps/cli` — command/query adapter only). The CLI
submits the closed v1 seam command vocabulary and renders Core-owned
`READ_PROJECTION` views; it never owns lifecycle truth.

- No private lifecycle store, scheduler, budget, selection or result semantics.
- No Core start/stop authority: the seam client never launches or stops the
  Core as a prerequisite (headless operation; no Desktop UI dependency).
- No locally derived status: every status value in the machine-readable output
  is projected verbatim from `READ_PROJECTION`; fields the v1 projection does
  not carry render as `null`, never as invented values.
- No scope/continuation/budget authority: contract payloads pass through the
  canonical `@xdownload/domain-contracts` decoders unchanged; defaults add
  nothing.

## Running

```text
node apps/cli/src/main.ts <command> [options]
xdownload help
```

Peer identity is the same-install/same-user pair the seam admits; the CLI
presents `SurfaceKind 'CLI'` and authorization is re-decided by the seam on
every frame (no local admission path).

## Commands

| Command  | Seam message         | Notes                                                          |
| -------- | -------------------- | -------------------------------------------------------------- |
| `submit` | `SUBMIT_CONTRACT`    | JSON payload via `--file`/`--stdin`; acceptance by default     |
| `status` | `READ_PROJECTION`    | Machine-readable PRD §27 status document                       |
| `wait`   | `READ_PROJECTION`    | Bounded polling until a terminal result is projected           |
| `cancel` | `CANCEL_LINEAGE`     | Requires explicit `--expected-revision`                        |
| `retry`  | `RETRY_FAILED_MEMBERS` | Explicit `--members` list only; the CLI computes no membership |
| `confirm`| `CONFIRM_SNAPSHOT`   | JSON snapshot payload via `--file`/`--stdin`                   |
| `batch`  | `SUBMIT_CONTRACT` xN | JSONL input; per-item identity/correlation and per-item result |

`PROJECT_TERMINAL_RESULT` is deliberately not exposed: terminal result truth
is Core-owned (T007); a user surface never authors results. Tests drive that
command through the seam harness directly.

## Machine-readable output

Every invocation writes exactly one JSON document to stdout (human notes go
to stderr). Document kinds: `xdownload.cli.status`, `.acceptance`,
`.rejection`, `.needs-user-action`, `.wait-timeout`, `.batch-result`,
`.error`.

The status document carries the exact PRD §27 required field set. Value
sources (render, never derive):

| PRD §27 field                  | Source                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| `contract_id`, `intent_type`   | projected contract view                                                    |
| `requested_scope`              | **absent (`null`)** — v1 `READ_PROJECTION` does not carry scope; rendered absent, never invented |
| `continuation_scope`           | **absent (`null`)** — same rule                                            |
| `snapshot_id?`                 | projected snapshot view when confirmed, else `null`                        |
| `requested_count_if_known`     | **absent (`null`)** — not carried by the v1 projection                     |
| `auth_accessible_count_if_known` | **absent (`null`)** — not carried by the v1 projection                   |
| `resolved_count`               | **absent (`null`)** — not carried by the v1 projection                     |
| `selected_count`               | cardinality of the projected `selectedMemberIds` identity list             |
| `validated_success_count`      | projected validation summary `passedCount` once terminal truth is projected |
| five PRD §16 dimension statuses + `StopReason` | projected terminal result, verbatim; `null` before projection |
| `needs_user_action`            | pure rendering of the projected `StopReason`: `true` iff `AUTH_REQUIRED`/`AUTH_FAILED`; `null` before terminal truth |

Verified-empty requests render `presentation.no_match_verified: true` with the
PRD §11/§18.5 phrase "No matching resources in the requested scope (verified)"
— never as download success. Submit acceptance documents carry the fixed note
"submit acceptance is not final acquisition success" (PRD §27).

### Non-interactive bounded behavior

The CLI is non-interactive by construction: it never prompts, never blocks on
confirmation and never fabricates one. A submitted contract whose selection
policy is `EXPLICIT_USER_SELECTION` (a fact of the operator's own payload)
produces the bounded `xdownload.cli.needs-user-action` document naming
`CONFIRM_SNAPSHOT` as the required user action. `wait`/`submit --wait` are
bounded by `--timeout-ms`; at the bound the `xdownload.cli.wait-timeout`
document is emitted without inventing a status.

## Exit codes

Semantics are fixed by PRD §27; the numbers are an F2 choice.

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Submit accepted without pending user action; status/cancel/retry/confirm read/accepted; wait-mode final success (projected `COMPLETE` request + `COMPLETE` acquisition) |
| 1    | Typed local input error before any envelope (usage, malformed/oversized payload)                 |
| 2    | Seam typed rejection — diagnostics projected verbatim; never a success                           |
| 3    | Bounded `NEEDS_USER_ACTION` state (non-interactive confirmation required)                        |
| 4    | Wait-mode final result does not represent a completed acquisition (includes verified-empty and `needs_user_action` terminal results) |
| 5    | Transport/connectivity failure (includes schema-incompatible responses the seam client drops fail-closed) |
| 6    | Bounded wait elapsed without a projected terminal result                                          |

Batch exit is the worst severity present: input errors (1) over seam
rejections (2) over pending user action (3) over full acceptance (0).

## Idempotency, retries and concurrency

Submit/cancel/retry/confirm accept an explicit `--request-id`. Replays reuse
the SAME idempotent identity so the seam's idempotency gate converges
duplicates (`converged: true`); the CLI never re-identifies a retry and never
keeps retry bookkeeping — a task retry is a `RETRY_FAILED_MEMBERS` command
whose member list the operator states explicitly and Core validates against
the recorded failed-member domain (C12). Concurrent CLI clients read the same
Core projection (C13). Reads are never cached: every `status` performs a fresh
`READ_PROJECTION`, so a stale view can never overwrite fresh truth.

## Transport

The CLI consumes the T004 `SeamClientTransport` port; the current binding is
the F1 loopback transport (same-host, framed, bounded). This does not freeze
the production transport (frozen L2 §6.9/ADR-012). Declared
`SEAM_MESSAGE_LIMITS` bounds are enforced client-side with the exported
constants before submission; oversized input is a typed local error.
