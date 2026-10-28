# Download Domain App PoC — execution protocol

STATUS: PLAN_ONLY / NOT_EXECUTED
SOURCE_ANCHOR: xDownload version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2
RELATED: #183, future v0.2 #184, ADS #182

## Falsifiable hypothesis

Using only actual selected public DomainHarness APIs, a download Domain App can keep one authoritative K business state, allow an existing xDownload direct-acquisition engine to fetch a user-authorized fixture behind a permitted C/Host operation, and return a digest-backed terminal outcome. The transfer byte path never traverses Microkernel. If state authority or public SDK seams cannot support this, verdict is BLOCKED instead of a fabricated PASS.

## Required source identity and build

- Node >=24 clean checkout, exact SDK source SHA, public packed package hashes, real BUILD selection of K/S/B/C IDs and module hashes.
- v0.10.3 only after qualified public consumer; otherwise exact released v0.10.2 with documented feature delta or BLOCKED.
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
| M01 | Same fixture baseline engine vs K orchestration | Record real latency, CPU/memory and development complexity |

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