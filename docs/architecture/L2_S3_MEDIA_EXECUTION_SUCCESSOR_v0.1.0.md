# S3 successor — Core-executed direct media and installed selection (v0.1.0)

**Authority:** #105; **state:** PROPOSED, not adopted. **Frozen subject:** `version/v0.1.0@0d9fd0bb6c5c3cb735e7feedd148228f15d8bc78`. **Upstream:** #100 installed-path audit, #101 S1 proposed implementation, #103 S1-only authority successor. **Product invariant:** frozen PRD §§13, 14, 20–22, 28 S3, 29, 31; frozen L2 architecture and T008/T015/T017.

## Adoption decision requested

Permit a **narrow Core-owned S3 direct-media execution carrier**, specialized from already-proven T008 direct HTTP and T015 single authority, only *after* the S1 authority #103 is reviewed and adopted. **S1 approval does not implicitly authorize S3.** All public command additions or changed authority semantics require their own exact-SHA independent L2 review; this draft alone authorizes no implementation.

Supported: explicit downloadable video/audio file, user-chosen media identity or one unambiguous, independently grounded candidate, no required external audio/video merge. Not supported: ambiguous track topology passed as one file, DASH/separate A/V, DRM, generic page crawling, auto-following unconfirmed candidates. Any user selection is scoped to a confirmed contract/snapshot; model suggestions may rank candidates but cannot prove media content or write Core truth.

## Proposed typed transition / trust boundary

1. Installed surface observes or receives **explicit media URL(s)** and displays source/variant identity (container/type if known, quality/track claims and source provenance). Expose `AUTO` only if supported identity is unambiguous and sufficiently evidenced; otherwise `ASSISTED` or `MANUAL_SELECTION`. User may select one candidate or confirm a bounded group without retyping hashes.
2. The **existing** `CONFIRM_SNAPSHOT` Core command (not an invented `CONFIRM_SELECTION` opcode) confirms the selected member/variant identity against the accepted AcquisitionContract; a *separately reviewed* S3 execution carrier will bind that immutable snapshot to the selected direct URL and authorized redirect hosts. An unselected candidate or late source variant is **not** transfer-authorized. No new scope or host inferred after confirmation. Media delivery has two explicit lanes: (a) for public, self-contained media URLs, the existing T008 direct HTTP port can run with no browser credential; (b) for browser-session-bound media, Core owns scheduling/validation but byte delivery must use a narrowly scoped privileged Native Messaging broker capability bound to the selected member, snapshot, origin/redirect host graph, authorization partition and expiry. The broker returns secret-free byte/provenance receipts; it cannot decide selection, acceptance, Media validation or terminal truth. Reusing the S2 browser handoff without a reviewed S3 Media-validation path is not S3 support. If the existing broker lacks a scoped S3 byte-delivery port, first adopt a separate narrowly reviewed broker contract and host integration before implementing authenticated S3. Browser auth stays in the privileged broker; no raw cookie/token or reusable signed locator enters CLI/Core/model/Recipe/logs.
3. Core receives a *closed S3-specific* execution envelope: accepted contract+snapshot+member+artifact identities, selected direct locator with bounded host graph, optional genuinely independent publisher SHA, applicable **nonempty** media assertions/MediaPolicy and honest expected total/Content-Type if known. Peer and contract/scope revision must be bound and checked. No new generic `execute(url)` operation.
4. Core durably journals the execution intent and reserves work item/budget **before external I/O**; only then dispatches the selected bounded lane: `DirectHttpAdapter` in `slice=S3` for credential-free direct media, or the **separately authorized privileged broker byte-delivery port** for session-bound media. Both lanes feed the identical Core-owned Target/Transfer/Format/**Media** validation and acceptance path; the broker never marks validation passed. Transfer/Format/Target **and Media** are independently evaluated; the existing `validateMedia` signature checks are *not sufficient by themselves* when no signatures exist or track/container claims require structural probe. Failed/unknown Media is never all-passed. Emit evidence basis `PUBLISHED_SHA256` vs `REQUESTED_LOCATOR_PROVENANCE` without pretending the latter verifies byte identity.
5. The one authoritative Core writer stages/accepts bytes after checks, records canonical artifact hash for durability, and derives exact frozen terminal tuple via the T007 projector. A command `ACCEPTED` or HTTP 200 alone never signals a successful download. Cancellation, retry budgets, recoverable runtime errors and journal replay inherit reviewed #103 and frozen L2; terminal accepted artifact never re-downloaded after restart.

## Minimum negative matrix

| Counterexample | Required behavior |
|---|---|
| Wrong candidate / variant selected after confirmation | Reject substitution, require new selection/contract |
| No media policy/probe result when media is required | Fail closed or truthful unsupported/unknown; no vacuous Media PASS |
| Expected track/signature absent / corrupt MP4 or audio | Media FAILED, no COMPLETE |
| User-known SHA mismatch | Target FAILED, never promote downloaded hash to external oracle |
| Redirect to undeclared CDN host / altered origin | Reject before transfer, no silent policy widening |
| HTML login/error masquerading as media | Format FAILED and truthful auth state |
| Unbound auth/cookie or untrusted extension command | Fail closed, no raw-secret export |
| Late cancellation/retry, duplicate request, restart during transfer | Respect Core precedence, one accepted artifact/effect, bounded remaining budgets |
| Media with separate A/V, DRM, unsupported tracks | `UNSUPPORTED` / frozen legal failure tuple, never fake mux |

## Adoption and validation

**Contract authority #105 fresh review → independent S3 Core implementation concern → independent shipped UX selection concern → real installed user-to-Core E2E → #100 source reachability → future T019/T020/T021/T023 exact-candidate validation → #81 genuine human G0/G1c**. Reuse T008 validation fixtures and the existing T012 `ai-proposal` only for suggestion (no fabricated independent oracles). Distinguish real human S3 semantic confirmation from model/fixture actions.

**Boundaries:** original Product/L2/DAG and Task Packs remain byte-identical. This document is a proposed successor only; no release gate, Product PASS or compatibility guarantee.
