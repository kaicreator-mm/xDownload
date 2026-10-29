# S2 Delivered Acquisition — declared v0.1.0 support limits (#95 R1 / PR #96 F04)

This record is the honest support-matrix entry for the installed S2 explicit-attachment
journey (PRD §28 S2, §31 CJ-02). It exists because the R0 implementation silently carried a
512 KiB hard cap plus whole-body buffering that the frozen Product never declared.

## Declared bound

**One explicit S2 attachment ≤ 64 MiB (67,108,864 bytes).**

The bound is derived from the actual budgets of every hop, not invented:

| Hop | Limit mechanism | Value |
| --- | --- | --- |
| Browser fetch (service worker) | `MAX_S2_ATTACHMENT_BYTES` (`s2-glue.ts`), enforced BEFORE unconsumed buffering: Content-Length pre-check, then while streaming | 64 MiB |
| Native Messaging delivery | bounded chunk frames of 786,432 raw bytes (1,048,576 base64 chars ≈ 1 MiB/message); host assembly cap `MAX_S2_ASSEMBLY_BYTES` enforced while staging | 64 MiB |
| Core seam wire | frozen L2 §12 bounds (maxPayloadBytes 786,432 / maxStringFieldLength 4096 / maxArrayLength 10,000) — never widened; the stream crosses as ≤224-string chunk commands (~688 KiB payload each) | frozen, unchanged |
| Core executor | `MAX_S2_DELIVERED_BYTES` (`s2-delivered.ts`), enforced on the staged stream before the durable lifecycle starts | 64 MiB |
| Lane transfer budget | `S2_BUDGET_PROFILE.transfer.maxBytes` (`s2-installed-lane.ts`), charged once at staging | 64 MiB |

## Why chunked delivery

The frozen seam wire bounds make a single EXECUTE_S2_ACQUISITION frame carry at most ~570 KiB
of raw bytes. R0 encoded that mechanical consequence as a silent product cap. R1 instead keeps
the frozen wire contract intact and delivers the stream as revision-ordered, journaled chunk
commands (`payload.chunk = {index, count}`); Core stages slabs all-or-nothing and starts the
canonical durable lifecycle only when the declared stream is complete. Journal replay after
restart rebuilds staged truth deterministically.

## Truthfulness rules (unchanged intent, now actually enforced)

- Oversize is a truthful user-visible failure (`ATTACHMENT_BOUND`) discovered before the body
  is buffered — never a silent truncation or an OOM.
- A partial stream produces no durable artifact truth; conflicting or malformed chunk framing
  rejects fail-closed.
- Target/Transfer/Format validation always runs on the assembled bytes (F01/F02); the digest
  is an optional strengthening anchor only, and the delivered bytes' own hash is never used as
  an independent oracle (C34).

## Out of scope (truthful non-claims)

- Attachments larger than 64 MiB are a declared v0.1.0 S2 limitation, not a silent one; the
  desktop/CLI direct-acquisition lane (S1) carries larger resources.
- Streaming to disk inside the browser lane (no whole-file staging anywhere) is not claimed:
  the native host and Core stage the assembled bytes in memory once each, bounded above.
