# Download Domain App PoC — execution protocol

STATUS: PLAN_ONLY / NOT_EXECUTED
SOURCE_ANCHOR: xDownload version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2
RELATED: #183, future v0.2 #184, ADS #182

## Falsifiable hypothesis

Using only actual selected public DomainHarness APIs, a download Domain App can keep one authoritative K business state, allow an existing xDownload direct-acquisition engine to fetch a user-authorized fixture behind a permitted C/Host operation, and return a digest-backed terminal outcome. The transfer byte path never traverses Microkernel. If state authority or public SDK seams cannot support this, verdict is BLOCKED instead of a fabricated PASS.

## Required source identity and build

- Node >=24 clean checkout, exact SDK source SHA, public packed package hashes, real BUILD selection of K/S/B/C IDs and module hashes.
- **SDK version identity (2026-10-29): DomainHarness v0.10.3 has completed its CONDITIONAL GIT-SOURCE-ONLY release.** Pin immutable Git tag `v0.10.3` → real **main merge SHA `061376f4a023070f215f9feffad5c24d96d503cb`**, whose Git tree `099cdc831aef63befd62aaede7e7a853d1be468f` is byte-identical to independently qualified version candidate `7d571858bd6524ffd13a7985227183dbecb2924a`. Git release RQ is CONDITIONAL (P0=0/P1=0/P2=3), not unconditional `PASS`. **npm publication was not authorized and is NOT DONE; package manifests can still contain `0.10.2-rc.0`.** Therefore use locally built and packed public packages from the verified Git source SHA/tree on Node >=24; pin/hash actual consumed tarball bytes and prohibit silent registry/v0.10.2 fallback. Exact public clean-consumer qualification remains part of this xDownload PoC, **not** something transferred from upstream Full/Hidden or other consumers. Verify tag→commit→tree and package exports before the first run; a mismatch is BLOCKED, not shimmed or guessed.
- External BUILD/selected modules; runtime Microkernel load/send/query/subscribe; trusted Node Host configuration. No internal SDK shortcut.
- xDownload existing direct-acquisition, domain contracts, local bounded HTTP fixture, temporary authorized output directory; no new downloader or network security stack.

## Positive and negative evidence

| ID | Scenario | Acceptance |
| --- | --- | --- |
| P01 | Valid declared URL -> K admission -> C/Host -> existing download -> file digest | Real bytes, correct SHA256, truthful K-owned completion |
| P02 | No LLM Provider | Deterministic path remains functional |
| N01 | Missing K Permit / unselected C operation | Zero network and zero file effect |
| N02 | Replace authorized target/URL/output path | Reject with no scope widening |
| N03 | Duplicate command/effect after accepted result | No duplicate accepted artifact |
| N04 | Cancel/restart after external send or timeout | Truthful UNKNOWN/reconciliation; never fake success |
| N05 | Corrupt receipt, persistence identity or digest | Fail closed, no unauthorized journal clearing |
| N06 | Two business writers attempt same lineage | Reject or prove a single-authority mapping |
| N07 | Modified or unselected BUILD module | Reject before effect |
| N08 | Malformed/untrusted raw public `DomainApp.send` input before stable-Case / Effect Journal reservation | Trusted pre-send schema/intent/identity validation **before entering K**, zero Host effect and **zero poisoned persistent Effect Journal entry** for invalid request; subsequent valid same identity must not be blocked by earlier invalid attempt |
| M01 | Same fixture baseline engine vs K orchestration | Record real latency, CPU/memory and development complexity |

## Explicit known SDK consumer hazard (v0.10.3 conditional release boundary)

DomainHarness upstream [#1437](https://github.com/kaicreator-mm/domain-harness/issues/1437) documented an **unfixed** public raw-send ordering hazard: malformed stable-Case data can reserve/poison the K Effect Journal before the public path rejects it, causing later valid same-identity sends to return `ADMISSION_EFFECT_JOURNAL_CONFLICT/UNKNOWN`. **The Git v0.10.3 release does not fix this.** For the xDownload PoC, **never expose raw public send with unvalidated user/Recipe/Browser input**. Require a trusted *pre-send* validation gateway that checks schema, confirmed source/targetRef, immutable identity, output root and scope before calling public `send`, and explicitly test N08 invalid→valid same-identity with journal/readback and zero physical side effects. A gateway does not claim to repair an already poisoned foreign journal; if that is needed, classify as BLOCKED and file a real bounded SDK issue. Do not invent auto-retry/auto-clear.

## Authority decision

Existing core-scheduler and persistence-ledger are already authoritative for v0.1, so blindly wrapping them with a second K would be unsafe. The PoC must either demonstrate a single K ownership bridge with non-authoritative physical storage or explicitly report only a sandboxed learning result insufficient for production migration. Do not use a test-only fake K admission as real proof.

## ADS #1241 capability plan

A. WEB source mapping, ADR, pin staging and test protocol: PREPARED; no implementation permit implied.
B. Authorized single concern implementation/SDK compatibility under exact current issue/claim: PLANNED, not dispatched.
C. CI/LOCAL clean Node24 selected public SDK and real positive + tamper/permit negatives: NOT_RUN.
D. Independent Windows host/actual restart, scope, identity and cost tests when required: NOT_RUN.
E. Independent exact-SHA reviewer, P0/P1/P2 and terminal verdict: NOT_RUN.

Record SOURCE/SHA/TREE, SDK package hashes, selected K/S/B/C, OS/Node, fixture digest, operation journal/effect count, every command/EXIT, failure type, and what remained NOT_PROVEN. No public release validation transfer from this PoC.

## Gate

DOMAIN_APP_POC=PASS requires a real public clean SDK consumer, P01/P02/N01-N07 results and relevant host validation, followed by independent exact-SHA review. If any is unexecuted, final result remains NOT_RUN/BLOCKED. Never block v0.1 release because of this spike.