# xDownload — L2 Architecture Evidence

Status: `STAGE 2 CANDIDATE / READY_FOR_ARCH_REREVIEW / NOT FROZEN`

Product release target: `v0.1.0`  
Successor research date: `2026-10-02`  
Successor starting baseline: `version/v0.1.0@d0a63666bf11b53dc7d8c48aae75b138035827a5`  
Initial L2 candidate checkpoint used to dispatch Research Demos: `44fd0fc7287b45735f069263c87486e6585fd7ae`

Frozen Product/Scope authority:

- `docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md`
- `docs/product/PRD-v0.4.2-review-candidate.md` reviewed source commit `65be7aaeabe7ead5544bbc9e7d6e16a805412025`
- `docs/product/L1_PRODUCT_EVIDENCE.md`

ADS authority:

- standard version `4.0.0`
- pinned revision `94cad2b0487e8a552c66d6bcd1cba36b7779383d`
- `prompts/L2_ARCHITECTURE_EVIDENCE.md`
- `standards/DEVELOPMENT_WORKFLOW.md` Stage 2
- `standards/ARCHITECTURE_RESEARCH_DEMO_STANDARD.md`

Research Demo authority consumed by this successor:

- Issue #7 terminal comment `5953990637`, result `PASS`, final research HEAD `4adbe7c587920383a654e020de757e2de657c312`, exact executable harness `5ed0cb63f30103786c8de7a74a265ed0378173a2`
- Issue #8 terminal comment `5954331493`, result `PASS`, final research HEAD `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`, final tree `486fb32577ac89f41276614611a7ef582ab68a15`

Bounded repair authority:

- Fresh Independent Architecture Review Issue #10 terminal comment `5955027193`
- review result `NEEDS_REVISION`; Architecture Freeze eligible `NO`
- sole blocker `AR-F01`, severity `P1`, class `L2_CONTRACT_REPAIR`
- no new Research Demo required and no Frozen Product contradiction identified
- this revision repairs only cancellation-vs-recovery / acceptance precedence and directly necessary cross-references; the 9-concern evidence-disposition accounting is unchanged

Before the original successor mutation, `version/v0.1.0`, `research_v0.1.0-durable-ledger-recovery`, and `research_v0.1.0-browser-auth-broker` were re-read and remained exactly at the identities above. Before this bounded repair, `version/v0.1.0` was re-read at `03f42c870281d6e9317317db47a2076b318d4894` / tree `1f1c8f37b86af2b867b1c26479a521c3090e4e07`, matching Issue #11's required starting baseline. No research branch was merged into the version branch.

This artifact is **Architecture Evidence plus an evidence-supported candidate architecture**. It is not Architecture Freeze, Task DAG, implementation, executable production Validation, Release Qualification, or Release PASS. Frozen Product semantics are unchanged.

---

## 1. Evidence vocabulary

Claims in this document use distinct certainty levels:

- **Frozen Product Fact** — authority comes from the Frozen Stage 1 Product/Scope and cannot be changed here.
- **Architecture Evidence** — repository, protocol, platform, official-source, or exact executable research evidence relevant to an architectural choice.
- **Architecture Candidate Decision** — recommended design that remains subject to fresh independent Architecture Review and a later separate Freeze decision.
- **Architecture UNKNOWN** — material architecture fact not yet sufficiently established.
- **Resolved by static evidence** — an original material concern whose needed architecture conclusion is supported without a new executable demo.
- **Resolved by executable evidence** — an original material concern whose needed architecture conclusion is now supported by exact-SHA Research Demo evidence, scoped to what that Demo proved.
- **Inference** — reasoned consequence of Product Facts and evidence, not independently proven production behavior.
- **Future implementation detail** — intentionally not frozen because current Product/Architecture evidence does not require selecting it yet.

---

# 2. Current-state findings

1. The version branch remains a planning/docs checkpoint. No production runtime, package topology, downloader engine, browser integration, persistence implementation, CLI implementation, installer, or release artifact exists on `version/v0.1.0`.
2. Stage 1 Product/Scope is `FROZEN`; Architecture Freeze is `NO`; Task DAG and production implementation are `NOT STARTED`.
3. The two Research Demo branches are isolated executable evidence branches. They do not establish production implementation and are not integration branches.
4. Issue #7 supplies real E3 evidence for the candidate durability/idempotency seam on one tested Linux process-death/reopen tuple.
5. Issue #8 supplies real E3 evidence for the candidate browser observation/scoped-auth seam on one tested Chromium/Linux tuple.
6. No Research Demo result contradicts the Frozen Product contract. No new material Architecture UNKNOWN was discovered by consuming those results.
7. The candidate architecture must continue to preserve the authoritative `AcquisitionContract`, immutable confirmed scope and `SelectionSnapshot`, non-replenishing lifecycle budgets, truthful multidimensional terminal result, bounded collection boundary, browser/session security boundary, S1–S6 support slices, and crash/retry no-drift semantics.
8. Issue #10 found one bounded L2 ambiguity (`AR-F01`): automatic recovery could otherwise race a durable user cancellation and permit opposite acceptance outcomes from identical durable facts. This revision resolves that ambiguity normatively without changing Frozen Product semantics or claiming new executable proof.

---

# 3. Architecture Drivers

## D1 — One authoritative contract/result semantics across Desktop, Browser and CLI

**Frozen Product Fact:** all three surfaces project the same `AcquisitionContract` and final result semantics.

**Architecture implication:** adapters cannot independently mutate authoritative scope, membership, budget, coverage, or terminal state.

## D2 — Immutable scope and snapshot identity

Confirmed `requested_scope` / `continuation_scope` cannot silently change; retry/resume uses the same snapshot; re-enumeration or material authorization/scope change requires a successor contract/snapshot.

**Implication:** stable target/member identity must be separated from volatile locators such as redirects, CDN URLs and expiring signed URLs.

## D3 — Lifecycle budget truth

`DiscoveryBudget`, `TransferBudget`, and `GlobalSafetyBudget` are lifecycle-scoped and cannot be replenished by restart/retry/repair.

**Implication:** reservation/consumption needs one durable authority, not per-surface or per-worker private counters.

## D4 — Multidimensional terminal truth

A single `success` flag is forbidden. Request fulfillment, target resolution, selected acquisition, coverage, stop reason and validation remain distinct.

**Implication:** terminal projection belongs in one deterministic Core domain component.

## D5 — Explicit bounded discovery; no crawler frontier

Collection membership/navigation must remain traceable to the confirmed contract and bounded continuation semantics.

**Implication:** no general recursive crawler API belongs in the privileged Core capability surface.

## D6 — Deterministic/template-first; bounded AI fallback

Model unavailability cannot block ordinary deterministic/template-supported work.

**Implication:** AI is a proposal adapter behind schema/policy/scope validation, never the source of authority.

## D7 — Browser observation plus local authorization boundary

The browser may provide page/network/player context and local authorization while raw credentials/tokens remain local where possible and do not become ordinary LLM/Recipe/Core durable state.

**Implication:** observation metadata and sensitive credential material use separate trust paths.

## D8 — Multiple protocol/media execution modes under one Product contract

S1–S6 include direct HTTP/file, browser handoff, direct media, HLS VOD, current-page collection and explicit playlist/gallery collection.

**Implication:** share lifecycle/result contracts while using protocol/media-specific execution and validation adapters.

## D9 — Crash/restart/retry truth

Restart/retry cannot reset budgets, drift snapshot membership, duplicate accepted effects, or rewrite uncertain/failed work into success. A durable cancellation must also have a deterministic precedence boundary against automatic reconciliation/acceptance.

**Implication:** durable effect lineage, explicit control-transition order and database/filesystem reconciliation are architecture-level concerns.

## D10 — Local product surfaces without unsupported platform promises

Desktop, Browser Integration and CLI are required surfaces; exact OS/browser/runtime/framework matrix is not Frozen Product authority.

**Implication:** freeze ownership/contracts/trust boundaries first; keep framework, concrete IPC transport, packaging stack and broader platform matrix replaceable until supported by downstream evidence.

---

# 4. Architecture Invariants

Candidate invariants for later L2 Freeze consideration:

1. **Canonical authority:** only the Core Control Runtime creates/transitions authoritative Contract, Snapshot, budget ledger, target/member identities and terminal-result inputs.
2. **Thin surfaces:** Desktop, CLI and Browser submit commands/observations and read projections; they do not own lifecycle truth.
3. **Scope is not budget:** budget exhaustion may stop work but cannot define, broaden, narrow or reinterpret requested scope.
4. **Logical target is not locator:** redirects/CDN/signed URLs may change only when evidence binds the locator to the same frozen logical target.
5. **Typed evidence:** discovery, user claims, authorization, transfer, validation and coverage retain explicit claim subject, provenance and scope.
6. **Discovery cannot self-certify:** discovery inference alone cannot validate the same semantic claim.
7. **One budget mutation path:** generated discovery, transfer, retry and model actions consume budget through the authoritative ledger.
8. **Stable effect lineage:** commands/work/effects/attempts use durable IDs so retry/restart can reconcile instead of blindly replaying.
9. **DB state is not filesystem truth:** transactional acceptance metadata and artifact materialization/finalization are distinct and must be reconciled.
10. **No DB-only final success:** an `accepted` database state alone cannot imply final success when validated bytes are absent or not materialized.
11. **Fail-closed browser boundary:** page/content-script input is untrusted and cannot invoke privileged native/auth actions without schema/size plus contract/origin/target/provenance validation.
12. **Opaque authorization references:** canonical task state stores secret-free auth context identity/provenance, not reusable raw credentials as ordinary state.
13. **Authorization binding:** privileged auth use binds exact origin, target, contract, snapshot and provenance, plus partition context where relevant.
14. **Native host allow-list is independent authority:** Native Messaging `allowed_origins` remains a separate platform-enforced boundary and must not be bypassed with unrestricted fallback IPC.
15. **Recipe confinement:** Recipe execution uses a finite typed capability vocabulary; no arbitrary shell, unrestricted JS/filesystem/cookie export, host scanning or recursive navigation.
16. **AI cannot grant authority:** AI can propose bounded structured adaptations; deterministic Core policy decides whether they are executable.
17. **Protocol normalization:** direct HTTP, HLS/media and browser-mediated adapters emit canonical effect/evidence/validation records and do not invent their own success semantics.
18. **Accepted artifacts require validation:** transfer alone does not make an artifact accepted.
19. **Replaceable platform implementation:** shell/framework/IPC/client/media tooling remain behind stable ports until specific evidence requires freezing a choice.
20. **Cancellation acceptance cutoff:** for a frozen target/effect lineage, if durable `USER_CANCELLED` authority is committed before durable acceptance, automatic recovery/reconciliation MUST NOT later create acceptance for already-staged, already-completed, validated, materialized, or otherwise externally successful-but-unaccepted bytes. Reconciliation may establish truthful facts and preserve/quarantine/clean up bytes, but only a later explicit retry/resume control transition may reopen acceptance processing on the same frozen Contract/Snapshot/target/effect lineage and remaining budgets. If durable acceptance was committed before cancellation, cancellation cannot retroactively revoke that accepted identity; bounded reconciliation may still establish required materialization/finalization truth for the already-accepted effect.

---

# 5. Architecture concerns and evidence dispositions

Original material concerns tracked: **9**.  
Current unresolved material Architecture UNKNOWNs: **0**.

## 5.1 Resolved by static evidence

| ID | Material concern | Architecture impact | Disposition | Candidate conclusion |
|---|---|---|---|---|
| U1 | How to prevent Desktop/CLI/Browser from becoming competing authorities | public contract, concurrency, result truth | `STATIC_EVIDENCE_SUFFICIENT` | Use one local authoritative Core Control Runtime with thin adapters. Shared libraries may hold pure domain logic, not multiple mutable authorities. |
| U4 | Can current extension APIs supply the observation path without general blocking interception? | browser capability design | `STATIC_EVIDENCE_SUFFICIENT` | Ordinary request observation is sufficient for the required observation role; blocking rewrite is not the default authority model. |
| U5 | What HTTP resume/retry rule avoids target drift? | correctness/retry | `STATIC_EVIDENCE_SUFFICIENT` | Resume only when representation identity is sufficiently validated; use `If-Range`/strong validator where available, otherwise restart safely. |
| U6 | Does HLS VOD need a specialized media/protocol adapter? | S4 correctness/budgets/validation | `STATIC_EVIDENCE_SUFFICIENT` | Yes. HLS is playlist/segment/rendition structured and cannot be treated as one opaque file transfer. |
| U7 | How can Recipe/AI adaptation stay bounded? | security/crawler boundary/deterministic fallback | `STATIC_EVIDENCE_SUFFICIENT` | Declarative Recipe schema + finite capability interpreter + deterministic validator; AI returns proposal data only. |
| U8 | Where do Evidence, coverage and final status live? | public semantics/explainability | `STATIC_EVIDENCE_SUFFICIENT` | Typed Evidence Ledger + canonical Result Projector in Core. Per-surface status derivation is rejected. |
| U9 | Must Stage 2 choose a concrete desktop framework/runtime/IPC now? | packaging/evolution | `STATIC_EVIDENCE_SUFFICIENT` | No. Freeze authority and communication/security contracts while leaving concrete shell/runtime/IPC behind replaceable ports. |

## 5.2 Resolved by executable evidence

### U2 — durability / idempotency

Disposition: `EXECUTABLE_EVIDENCE_SUFFICIENT` for the tested claim.

Authority:

- Issue #7 terminal comment `5953990637`
- final research HEAD `4adbe7c587920383a654e020de757e2de657c312`
- exact executable harness tested `5ed0cb63f30103786c8de7a74a265ed0378173a2`
- report `docs/experiments/issue-7-durable-ledger-recovery-report.md` at the final research HEAD

Evidence-supported conclusion:

- one authoritative lifecycle writer + SQLite transactional ledger + staged filesystem + stable effect lineage is executable for the tested Linux process-death/restart tuple;
- lifecycle budgets were not replenished or double-consumed across the tested kill/restart windows;
- two independent duplicate clients converged to one lineage, one effect and one accepted artifact;
- recovery must distinguish transactional DB state from filesystem staging/materialization/finalization;
- `accepted` DB state alone cannot imply final success when bytes are missing/unmaterialized;
- deterministic recovery classifications and digest/provenance reconciliation are required architecture behavior.

Evidence limit: the execution filesystem reported `fsync=volatile`; this proves **process-death/reopen**, not host power-loss/kernel panic/storage-controller durability. That limitation remains an explicit architecture risk and does not become an unresolved blocker because Frozen Product currently requires truthful crash/restart/retry semantics without a separately frozen host-power-loss guarantee.

Issue #7 deliberately deferred automatic reconciliation in S7 so durable cancellation could win before an explicit retry, and its closeout listed cancellation precedence as `ADAPT`. It therefore supports stable lineage/non-replenishing-budget/restart mechanics but does **not** itself prove a universal cancellation precedence rule. The cancellation cutoff in this revision is a normative L2 decision consistent with that evidence, not a newly claimed executable proof.

### U3 — browser observation / scoped auth boundary

Disposition: `EXECUTABLE_EVIDENCE_SUFFICIENT` for the tested claim.

Authority:

- Issue #8 terminal comment `5954331493`
- final research HEAD `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`
- final tree `486fb32577ac89f41276614611a7ef582ab68a15`
- report `docs/experiments/browser-auth-broker-e3-report.md` at the final research HEAD

Evidence-supported conclusion:

- a real Chromium MV3 extension + `webRequest` observation + real Native Messaging host + scoped local broker seam is executable for the tested Chromium 144/Linux tuple;
- Core-facing state can use an opaque `AuthorizationContextRef` while raw browser-session secret material remains inside the browser/broker secret zone for the tested flow;
- binding must include exact origin, target, contract, snapshot and observation provenance, with partition context included when browser state is partition-aware;
- page/content input is untrusted and must be schema/size checked before any privileged/native/auth action;
- Native Messaging `allowed_origins` is independently enforced by Chromium and remains part of the least-authority boundary;
- cross-origin/unbound/wrong-partition reuse can fail closed before unauthorized acquisition;
- session expiry can produce truthful `auth_required` behavior without silently widening scope or changing target identity.

Evidence limit: Firefox/Safari, Windows/macOS Native Host registration/packaging, extension-store distribution/signing/update, arbitrary third-party authenticated sites, production credential-vault behavior and production packaging are **NOT proven**.

## 5.3 Counts

```text
MATERIAL_CONCERNS_TRACKED=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_EVIDENCE_SUFFICIENT=2
EXECUTABLE_DEMO_REQUIRED=0
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
CURRENT_UNRESOLVED_ARCHITECTURE_UNKNOWNS=0
```

No Architecture Contradiction is supported by current evidence.

---

# 6. Candidate Patterns + Evidence

## 6.1 Runtime / control-plane decomposition

### Alternative A — Desktop/UI-owned monolith

Benefits: low initial process/IPC complexity.

Failure modes: CLI and browser become secondary, background work depends on UI lifecycle, status/budget logic tends to duplicate, and a headless automation surface becomes awkward.

Disposition: **reject as authority topology**.

### Alternative B — shared library embedded in Desktop and CLI with direct shared-store writes

Benefits: code reuse and fewer explicit service boundaries.

Failure modes: multiple writers, duplicate scheduling, process/version drift, lock contention and an unsafe path for Browser Integration to become a persistence peer.

Disposition: pure domain libraries may be shared, but **reject independent mutable authorities**.

### Alternative C — local authoritative Core Control Runtime + adapters

```text
Desktop UI ─┐
CLI ────────┼── Local Command/Query Port ──> Core Control Runtime
Browser ─ Native Messaging/Broker ────────┘          │
                                                     ├─ Contract/Snapshot/Result
                                                     ├─ Scheduler/Budget Ledger
                                                     ├─ Discovery/Recipe Runtime
                                                     ├─ Transfer adapters
                                                     ├─ Validation/media adapters
                                                     ├─ Evidence/Provenance
                                                     └─ Persistence + Artifact Store
```

Benefits: one mutable authority, UI/CLI coexistence, browser lifecycle does not own transfers, and deferred REST/MCP/SDK can later become adapters without changing core Product semantics.

Trade-offs: Core lifecycle, local IPC versioning and peer authorization add complexity; Core failure pauses work until restart.

Escape hatch: the Core may initially be launched on demand rather than as a permanent daemon while preserving the same logical authority boundary.

Disposition: **recommended evidence-supported candidate**.

## 6.2 State ownership / persistence

Authoritative state candidate:

```text
AcquisitionContract + successor relation
SelectionSnapshot
requested / confirmed / selected identities
AuthorizationContextRef metadata
BudgetLedger + reservations/consumption
WorkItem / Attempt / Effect lineage
Evidence + Validation records
Artifact staging/materialization/acceptance records + digest/provenance
terminal projection inputs
transition/audit facts
```

Downloaded bytes belong in a filesystem artifact store; transactional metadata owns identity/state and binds files to durable effect/artifact records.

### JSON/files only

Simple to bootstrap but weak for atomic multi-record mutation and concurrent UI+CLI recovery. **Not recommended as authority store**.

### SQLite + filesystem, Core-owned authoritative writer

Static SQLite evidence establishes database transaction/WAL behavior. Research Demo #7 additionally proves the xDownload candidate pattern across the tested process-death/reopen crash windows when DB state and filesystem materialization are explicitly reconciled.

Candidate rules promoted from the Demo:

- stable command/effect lineage;
- transactional lifecycle-budget accounting;
- explicit staged vs materialized/finalized vs accepted state;
- digest/provenance validation before terminal success;
- deterministic recovery classification;
- no assumption that a DB commit is atomic with filesystem/network effects.

Disposition for v0.1.0 candidate: **SQLite + filesystem is evidence-supported for the tested process-death/reopen claim, pending Architecture Review/Freeze**.

A host-power-loss durability guarantee is not claimed.

### PostgreSQL/server database

Adds a server/service/credential/upgrade burden not required by current Product scope. Preserve a state-repository boundary so a future remote/server Product version can adopt another backend without redefining domain contracts.

Disposition: **defer**.

## 6.3 Transaction/effect pattern

A canonical Core command transaction records:

1. command/idempotency identity;
2. expected/current revision;
3. budget reservation/consumption delta;
4. domain state transition;
5. durable effect intent/state where external work is required;
6. provenance/audit fact.

External effects cannot be atomically identical to a database commit. Candidate semantics remain **recoverable at-least-once external execution + idempotent acceptance/reconciliation**, never an unproven exactly-once claim.

Research Demo #7 supports that pattern for the tested single-host process-death/reopen tuple.

## 6.4 Browser/auth boundary

Trust zones:

```text
Page/content script          = untrusted input
Privileged extension context = browser capability zone
Native broker                = local secret/capability zone
Core Control Runtime         = authoritative task zone
External model               = redacted external reasoning dependency
```

Candidate controls:

- schema/size-bound all page/content messages before privilege;
- least host/API permissions and optional permissions where practical;
- bind observation to tab/frame/origin/request provenance;
- bind auth capability to exact origin/target/contract/snapshot/provenance and optional partition context;
- persist opaque `AuthorizationContextRef`, not raw reusable cookie/password/token data;
- retain Native Messaging `allowed_origins` as a separate platform boundary;
- no fallback from rejected Native Messaging to unrestricted local IPC;
- redact secrets at logs/evidence/model/Recipe/Core-durable boundaries;
- fail with truthful `AUTH_REQUIRED` / `AUTH_FAILED` semantics instead of widening authority.

Research Demo #8 supports this seam for Chromium 144/Linux only. Cross-browser/OS packaging and production vault behavior remain downstream concerns.

## 6.5 Download / media execution boundary

```text
AcquisitionExecutor
├── DirectHttpAdapter
├── HlsVodAdapter
└── future protocol adapters only if future Product scope authorizes

Validation
├── TransferValidator
├── FormatValidator
├── MediaValidator
├── TargetValidator
├── MembershipValidator
└── CoverageValidator
```

Collection discovery resolves/finalizes the frozen target set; it is not the byte-transfer engine.

### HTTP resume/retry

Candidate rules:

- preserve partial bytes only when representation identity is sufficiently validated;
- use a strong validator/`If-Range` where available;
- if identity cannot be proven or the validator changes incompatibly, restart instead of appending uncertain bytes;
- redirect/CDN/signed-locator refresh is a locator change, not permission to replace logical target identity;
- retry consumes remaining lifecycle budgets and remains in the same logical target/effect lineage.

### HLS VOD

Candidate rules:

- bind selected manifest/rendition identity;
- segment requests count toward TransferBudget;
- fail closed on unsupported encryption/track/mux topology per Frozen Product;
- media assembly/probing stays behind an adapter;
- final acceptance requires applicable manifest/segment/format/media/target validation.

## 6.6 Template / Recipe / AI boundary

Candidate Recipe model:

```text
RecipeDefinition
├── recipe_id / schema_version
├── applicability_scope
├── matcher
├── parameter schema
├── allowed_capabilities[]
├── extraction/evidence rules
├── validation requirements
├── failure conditions
└── deterministic fallback
```

Execution:

```text
contract + observations
→ deterministic matcher
→ capability plan
→ policy/scope validation
→ bounded execution
→ typed evidence
→ independent validation
```

AI fallback:

```text
redacted knowledge gap + bounded observations + Recipe schema
→ structured AI proposal
→ schema/policy/scope validator
→ deterministic capability execution OR reject/ask user
```

AI cannot mutate confirmed scope, emit arbitrary shell code, choose arbitrary navigation, persist secrets, or mark coverage/validation complete.

## 6.7 Status/evidence model

Candidate Core ownership:

- `EvidenceLedger` — append-oriented typed claims with provenance/scope;
- `ValidationRecord` — validator output bound to artifact/target/member/snapshot;
- `CoverageAccounting` — requested-scope accounting separated from authorization-accessible and selected/acquired subsets;
- `ResultProjector` — deterministic projection of the Frozen result dimensions.

Per-surface status derivation remains rejected.

## 6.8 Concurrency / scheduling / budgets

Candidate scheduling rules:

- Core is the only authoritative scheduler, cancellation-order and budget writer;
- clients use idempotent command/request identities;
- scheduler creates durable work/effect IDs;
- generated actions reserve/consume budget through authoritative transitions;
- cancellation is a durable ordered control transition, not just an in-memory signal;
- once durable cancellation is authoritative for a still-unaccepted lineage, it suppresses all **new** discovery/transfer/retry dispatch and automatic acceptance, while permitting bounded reconciliation required to determine truthful pre-existing durable/external facts;
- post-cancel reconciliation may inspect DB/filesystem/effect state and may run non-expansive validation over already-present bytes when needed for classification, but such validation cannot override the cancellation acceptance cutoff;
- duplicate submit does not silently create another acquisition;
- explicit retry/resume after cancellation is a new authorized control transition on the same frozen Contract/SelectionSnapshot/target/effect lineage; it inherits remaining budgets, cannot create a duplicate accepted effect, and may reuse already-staged bytes only after ordinary identity/provenance/validation rules succeed;
- browser reattachment changes observation/session availability, not frozen contract/snapshot identity;
- Desktop UI, CLI and Browser-triggered cancellation all submit to the same Core transition and therefore cannot obtain different precedence semantics.

Research Demo #7 supplies positive evidence for duplicate-client convergence and tested restart/cancel/retry windows; it does not prove high-load or multi-host concurrency and does not itself define the universal cancellation precedence now made normative by this L2 repair.

## 6.9 Platform / packaging constraints

Architecture-driving facts:

- Browser Integration needs an installable extension plus native/local handoff seam or equivalent;
- CLI must not depend on Desktop UI lifetime;
- long-running acquisition must not depend on a page/content script remaining alive;
- authoritative state/artifacts must survive Core process restart;
- browser/native-host registration is platform-specific and must be packaged eventually.

Not currently Frozen/proven:

- Windows/macOS/Linux release matrix;
- Chromium/Firefox/Safari release matrix;
- Desktop shell/framework;
- Core language/runtime;
- exact production local IPC transport;
- installer/updater mechanism;
- permanent daemon vs on-demand Core lifecycle;
- production credential vault implementation.

The Unix-domain-socket command boundary used by Research Demo #7 and the Linux Native Messaging registration used by #8 are research harness choices/evidence, not production framework/IPC/packaging decisions.

---

# 7. Decision Matrix

| Area | Alternative | Strength | Failure/trade-off | Escape hatch | Candidate |
|---|---|---|---|---|---|
| Authority | UI monolith | simple start | CLI/browser coupling; divergent truth | extract Core later | NO |
| Authority | independent embedded runtimes | code reuse | multi-writer races/version skew | pure shared libraries only | NO for mutable authority |
| Authority | local authoritative Core + adapters | one contract/budget/result authority | IPC/lifecycle complexity | on-demand Core lifecycle | **YES** |
| Persistence | JSON/files | simple | weak atomic multi-record recovery | migrate later | NO |
| Persistence | SQLite + filesystem | local, transactional, no external service; #7 executable evidence | host-power-loss still unproven; reconciliation required | backend abstraction + separate storage Demo if required | **YES, evidence-supported candidate** |
| Persistence | PostgreSQL | server concurrency | unnecessary service burden | future remote mode | DEFER |
| Browser auth | whole-cookie export | broad compatibility | excessive secret exposure/staleness | none acceptable | NO |
| Browser auth | scoped native broker + opaque ref | least authority/provenance; #8 executable evidence | cross-browser/OS packaging still unproven | browser-specific adapter + truthful auth failure | **YES, evidence-supported candidate** |
| Browser network | blocking interception first | broad control | excessive authority/platform restrictions | observe + explicit handoff | NO |
| Browser network | observation + explicit handoff | matches Product and #8 observed path | host permission/corpus limits | Recipe/user confirmation | **YES** |
| Transfer | one generic byte engine | simple | HLS/media topology mismatch | protocol adapters | NO |
| Transfer | canonical executor + adapters | common lifecycle + protocol correctness | more contracts | external tooling behind adapter | **YES** |
| Recipe | arbitrary JS/automation | flexible | crawler/security escape | finite capability model | NO |
| Recipe | declarative finite capabilities | auditable/testable | schema/versioning work | controlled ADR capability extension | **YES** |
| AI | direct executor | fast prototype | violates authority/security | proposal-only | NO |
| AI | bounded proposal adapter | optional/model-offline safe | more UNKNOWN/user-action outcomes | promote validated Recipes | **YES** |
| Result | per-surface derivation | convenient locally | semantic divergence | central projector | NO |
| Result | evidence + central projector | one truth/explainability | careful schema evolution | versioned projections | **YES** |

---

# 8. Recommended Architecture Candidate

Logical responsibility map:

```text
apps/
  desktop/                 # presentation adapter
  cli/                     # command/query adapter
  browser-extension/       # observation + explicit handoff
  native-browser-broker/   # narrow browser/native trust bridge

core/
  contract-domain/         # contract/snapshot/identity
  result-domain/           # statuses/stop/legal combinations
  evidence-domain/         # typed evidence/provenance
  scheduler/               # work/effect lifecycle + budgets
  discovery/               # bounded discovery orchestration
  recipe-runtime/          # declarative capabilities
  ai-adapter/              # bounded proposals only
  acquisition-runtime/     # selected-target execution
  validation/              # transfer/format/media/target/membership/coverage

adapters/
  persistence-sqlite/      # candidate supported by #7 evidence
  artifact-filesystem/
  http-direct/
  hls-media/
  browser-auth/            # candidate supported by #8 evidence
  model-provider/
```

This is a responsibility map, **not an implementation scaffold instruction**. No empty modules are authorized by this document.

External surfaces use a versioned local command/query contract. Exact wire format/transport remains future implementation detail.

Candidate lifecycle:

```text
DRAFT_INTENT
→ RESOLVING
→ NEEDS_USER_ACTION? / RESOLVED
→ CONTRACT_CONFIRMED
→ SNAPSHOT_FROZEN
→ ACQUIRING
→ VALIDATING
→ TERMINAL
```

Internal workflow state never replaces the Frozen multidimensional terminal Product result.

---

# 9. Key ADR Candidates / Invariants

These are proposed later Architecture Freeze decisions, not Frozen facts now:

- **ADR-001** — one local authoritative Core Control Runtime; all Product surfaces are adapters.
- **ADR-002** — Contract/Snapshot/Result schema is Core-owned and versioned independently of UI.
- **ADR-003** — SQLite local metadata/state ledger plus filesystem artifact store, with one authoritative lifecycle writer and explicit reconciliation; supported by #7 for the tested process-death/reopen tuple.
- **ADR-004** — filesystem artifact staging/materialization/finalization is distinct from transactional metadata; DB-only acceptance never implies final success when bytes are absent.
- **ADR-005** — Browser extension + Native Messaging broker + opaque `AuthorizationContextRef`, with exact authority binding; supported by #8 for the tested Chromium/Linux tuple.
- **ADR-006** — Direct HTTP and HLS/media are distinct execution adapters behind one acquisition port.
- **ADR-007** — declarative Recipe capability interpreter; arbitrary scripting/navigation is not a Recipe capability.
- **ADR-008** — AI is proposal-only and cannot grant authority.
- **ADR-009** — typed Evidence Ledger and Result Projector own terminal truth.
- **ADR-010** — recoverable at-least-once external effects plus idempotent acceptance/reconciliation; no exactly-once claim.
- **ADR-011** — stable target identity is separate from mutable locator and authorization context.
- **ADR-012** — concrete Desktop/runtime/IPC/platform matrix remains replaceable until a later authorized decision.
- **ADR-013** — durable cancellation has a single Core-owned acceptance cutoff: cancel-before-accept blocks automatic later acceptance; accept-before-cancel is not retroactively revoked; bounded reconciliation may establish truth on either side of the cutoff; explicit retry/resume alone may reopen processing on the same frozen lineage and remaining budgets.

---

# 10. Data Ownership / Trust Boundaries / Synchronization

| Data/authority | Canonical owner | Producers/readers | Synchronization rule |
|---|---|---|---|
| AcquisitionContract | Core Contract Domain + authoritative store | UI/CLI submit intent; Browser supplies observations | revision/idempotency checks; successor identity for semantic change |
| SelectionSnapshot | Core | confirmation/discovery evidence | immutable after confirmation |
| requested/confirmed/selected identities | Core | discovery/Recipe/browser evidence | identity correspondence, never count-only |
| budgets | Core Scheduler/Budget Ledger | all effect dispatchers | transactional reservation/consumption; no private writer |
| cancellation/retry control order | Core Scheduler/authoritative store | Desktop/CLI/Browser commands; recovery reads | durable total order against acceptance; no surface-local precedence |
| browser observations | Evidence Ledger | privileged extension | append/provenance-bound; not direct authority |
| raw session secrets | Browser/Broker secret zone | scoped broker/transfer path only | no ordinary Core persistence/LLM/Recipe/log export |
| AuthorizationContextRef | Core metadata | broker issues/validates | opaque; exact origin/target/contract/snapshot/provenance binding; optional partition context; expiring/revocable |
| transfer progress | Acquisition Runtime + store | protocol adapters | durable checkpoints only when recovery-safe |
| Evidence | Evidence Ledger | discovery/transfer/validators/user claims | append-oriented typed claim records |
| terminal statuses | Result Projector | all surfaces read | derived only from canonical state/evidence |
| artifact bytes | Filesystem store | transfer/validation | staged then materialized/validated/accepted; digest/provenance binds to DB identity |
| Recipes | versioned Recipe store | matcher/adaptation/promotion | schema/applicability/failure validation; no embedded credentials |

Read caches are disposable and never become authority.

---

# 11. Failure / Restart / Retry / Idempotency / Consistency Semantics

Core principles:

- a database commit does not prove an external network/file effect succeeded;
- an `accepted` DB state does not prove final success if the validated artifact bytes are absent;
- external success observed before crash does not prove durable acceptance;
- uncertain effects are reconciled, not silently marked success or blindly duplicated;
- retry uses the same logical target/effect lineage and remaining budgets;
- target/scope semantic change requires a successor contract/snapshot;
- recovery records must distinguish DB state from filesystem staging/materialization/finalization;
- cancellation, acceptance and explicit retry/resume are durable Core-owned transitions with one deterministic order; adapter arrival time or process restart cannot redefine that order.

Candidate recovery classes may include `NOT_DISPATCHED`, `IN_FLIGHT_UNKNOWN`, `PARTIAL_RECOVERABLE`, `SUCCEEDED_UNACCEPTED`, explicit filesystem-first/DB-first reconciliation, `ACCEPTED`, and explicit terminal failure equivalents. Exact production names remain a downstream contract detail; the semantic distinctions are the architecture requirement.

## 11.1 Normative cancellation / reconciliation / acceptance precedence — AR-F01 repair

For each frozen selected target/effect lineage, the Core authoritative store establishes a durable order among:

```text
dispatch intent / dispatch observed
external bytes partial or complete
validation state
filesystem staging/materialization/finalization
acceptance
USER_CANCELLED
explicit retry/resume
```

The normative cutoff is **durable acceptance**:

1. **Cancellation committed before durable acceptance:** the lineage becomes cancellation-authoritative for automatic work. No restart, discovery of staged/finalized bytes, validation PASS, external-effect completion, filesystem materialization, or reconciliation classification may create a new accepted artifact while that cancellation remains authoritative.
2. **Acceptance committed before cancellation:** the accepted identity remains accepted. Cancellation does not retroactively revoke it. Recovery may perform bounded idempotent reconciliation needed to establish whether the already-accepted artifact is actually materialized/finalized; if required bytes cannot be established, the Product result still cannot claim success merely from DB acceptance.
3. **Reconciliation is allowed after cancellation, but not promotion:** Core may read authoritative DB state, inspect already-present filesystem state, reconcile whether an external effect may have occurred, compute digest/provenance, and run local/non-expansive validation necessary to classify truth. These actions cannot cross the acceptance cutoff or start new acquisition/discovery work.
4. **New dispatch is suppressed:** while durable cancellation is authoritative, Core MUST NOT start a new network/media/discovery transfer, retry external effect, add a member/target, refresh scope, or allocate fresh lifecycle budget for that lineage.
5. **Unaccepted bytes after cancellation:** bytes that are staged, complete, validated, materialized or finalized but lack pre-cancel durable acceptance remain **unaccepted**. They may be retained as staged/quarantined/recovery evidence or become cleanup-eligible according to later implementation policy; they MUST NOT be silently exposed as an accepted Product artifact.
6. **Explicit retry/resume is distinct from automatic recovery:** a later explicit retry/resume command may supersede the cancellation stop for execution while preserving the same Frozen `AcquisitionContract`, `SelectionSnapshot`, selected target identity and effect lineage. It inherits the remaining Discovery/Transfer/GlobalSafety budgets, cannot replenish them, and cannot create a duplicate accepted effect. If already-present bytes still satisfy identity/provenance/validation requirements, retry/resume may reuse them without forcing a second external effect.
7. **Single authority across surfaces:** Desktop UI, CLI and Browser-triggered cancellation all resolve through the same Core transition. No surface may locally choose “recovery wins” or “cancel wins”.

### Required counterexample normalization

Given:

> Core dispatched an acquisition; bytes are fully staged; process dies before validation/acceptance; while Core is down, cancellation becomes durably authoritative; on restart, valid staged bytes are discovered.

Required architecture outcome:

- restart reconciliation may inspect the staged artifact, bind it to the existing frozen target/effect lineage, compute digest/provenance and, if useful for truthful classification, perform local validation;
- because durable cancellation precedes durable acceptance, automatic acceptance is forbidden;
- the staged bytes remain unaccepted/quarantined-or-cleanup-eligible evidence, not a silently successful artifact;
- if no selected target had already been accepted, current projection is `SelectionAcquisitionStatus = CANCELLED` and `StopReason = USER_CANCELLED`; the request cannot be projected `COMPLETE` solely because valid bytes happen to exist;
- only a later explicit retry/resume may reopen processing on the same lineage and remaining budgets; if it reuses the valid staged bytes, no duplicate external effect is required or permitted merely because the process restarted.

This removes the Issue #10 counterexample where identical durable facts could legally yield either `COMPLETE` or `CANCELLED` through implementation choice.

### Cancel timing matrix

| Durable facts when cancellation becomes authoritative | Allowed recovery/reconciliation | Acceptance/result consequence |
|---|---|---|
| Cancel before dispatch | Record cancellation; release/reconcile any reservation according to durable dispatch facts; no external dispatch | No artifact may be accepted from that cancelled execution; with no prior selected fulfillment, `SelectionAcquisitionStatus=CANCELLED`, `StopReason=USER_CANCELLED` |
| Cancel after dispatch but before bytes complete | Determine whether the effect started/partially staged; preserve evidence; no automatic new/resume dispatch | Partial/staged bytes remain unaccepted; zero prior accepted selected targets → `CANCELLED`; explicit retry/resume may continue same lineage within remaining budgets |
| Cancel after bytes complete but before validation | Inspect/digest/classify existing bytes; local validation may run only as bounded reconciliation | Validation PASS cannot override cancellation; bytes remain unaccepted unless a later explicit retry/resume reopens processing |
| Cancel after validation but before durable acceptance | Preserve validation/evidence if still valid; no automatic acceptance | Validated bytes remain unaccepted; current cancelled projection applies until explicit retry/resume |
| Cancel after durable acceptance | Preserve accepted identity; reconcile materialization/finalization if necessary; suppress only still-unaccepted/new work | Accepted target stays accepted. Overall `SelectionAcquisitionStatus` is `COMPLETE` if every identity in frozen `S` is already accepted, otherwise `PARTIAL` when some but not all are accepted and cancellation stops the remainder; `StopReason=USER_CANCELLED` only when cancellation actually causes the remaining lifecycle to stop |
| Cancel arrives after the entire Acquisition is already terminal | No mutation of terminal Product truth; command may be recorded/rejected as late | Existing terminal result remains unchanged; no retroactive `USER_CANCELLED` rewrite |
| Explicit retry/resume after cancellation | Reuse same Contract/Snapshot/target/effect lineage, reconcile existing bytes, dispatch only if needed and budget allows | May progress again under ordinary validation/acceptance rules; no new target identity, no budget reset, no duplicate accepted effect |

### Product status projection for cancellation cases

The Frozen Product dimensions remain independent. Cancellation sets `StopReason = USER_CANCELLED` **only when cancellation is the reason remaining work stopped**. Projection is deterministic from canonical facts:

- `SelectionAcquisitionStatus = CANCELLED` when cancellation stops the frozen selected set before any selected target is durably accepted.
- `SelectionAcquisitionStatus = PARTIAL` when one or more, but fewer than all, identities in frozen `S` were durably accepted before the cancellation cutoff.
- `SelectionAcquisitionStatus = COMPLETE` remains valid when every identity in frozen `S` was already durably accepted before cancellation; cancellation cannot downgrade completed selected acquisition.
- `RequestFulfillmentStatus = COMPLETE` is permitted only if the original immutable requested scope was already fully fulfilled under Frozen Product rules. Otherwise cancellation yields `PARTIAL` when some requested fulfillment was durably achieved, `UNSATISFIED` when none was achieved and the request is known not fulfilled, or retains `UNKNOWN` only when the Frozen Product evidence model genuinely cannot determine requested-scope fulfillment. Cancellation itself does not fabricate `COMPLETE` or erase existing fulfillment truth.
- `TargetResolutionStatus` and `CoverageStatus` continue to project from their own Frozen Product evidence. Cancellation does not erase already-proven resolution/coverage and does not upgrade unknown/truncated coverage.

### Crash after budget reservation, before dispatch

Recovery reconciles reservation against durable dispatch/effect state. Restart cannot mint a fresh budget. #7 executed this class with real process death and preserved one eventual effect without budget replenishment.

### Crash with staged/partial bytes

Staged bytes are not accepted output. Recovery validates target/effect identity and safe-resume conditions; otherwise it restarts within remaining budget when no cancellation cutoff forbids automatic dispatch. #7 showed partial staging did not become silent success.

### Crash after bytes succeed, before accepted record

Reconcile via effect ID + artifact digest/provenance; do not infer success from filename/file existence alone and do not blindly duplicate accepted effects. If durable cancellation became authoritative before acceptance, reconciliation may classify/validate the bytes but cannot accept them automatically.

### Crash around DB/filesystem finalization ordering

Both DB-first and filesystem-first windows require deterministic reconciliation. #7 observed `RECOVERED_DB_FIRST` and `RECOVERED_FS_FIRST` paths converging without duplicate effect/artifact identity. If acceptance was durably committed before cancellation, bounded finalization/materialization reconciliation may continue; if cancellation was committed first and acceptance is absent, filesystem presence does not authorize acceptance.

### Concurrent UI/CLI-style clients

Core serializes/validates authoritative transitions. Duplicate requests use idempotency/revision rules. #7 showed two independent duplicate clients converging to one lineage/effect/artifact for the tested tuple. The same authoritative transition order applies to Desktop, CLI and Browser cancellation commands.

### Cancellation / retry

Cancellation is durable, suppresses new dispatch and automatic acceptance while authoritative, and survives restart. A later explicit retry/resume may reopen processing only on the same frozen target/effect lineage with remaining budgets and no duplicate accepted effect. #7 exercised one such cancellation/retry sequence with deliberate deferred recovery; this L2 supplies the normative precedence that the Demo intentionally left as `ADAPT`.

### Durability limit

The #7 environment proved process-death/reopen only. If a future Frozen requirement demands host power-loss guarantees, a separate E3 storage/platform Research Demo is required; this L2 does not silently upgrade the current evidence.

---

# 12. Security / Auth / Secret Boundary

Security-sensitive seams requiring later independent review include:

1. page/content script → privileged extension context;
2. extension → Native Messaging broker;
3. broker → Core/transfer adapter;
4. Core → external model provider;
5. Recipe → capability interpreter;
6. local IPC client → Core authority;
7. logs/evidence → durable storage.

Candidate controls:

- schema/size bounds on browser/native/IPC messages;
- allow-listed extension/native-host identity;
- least host/API permissions;
- tab/frame/origin/request provenance;
- exact target/contract/snapshot binding for privileged action;
- optional partition-context binding where browser state is partition-aware;
- secret redaction before persistence/logging/model/Recipe/Core durable paths;
- local browser/broker handling of raw auth material where possible;
- local IPC peer authorization suitable for same-install/same-user operation;
- deny unknown Recipe capabilities and arbitrary crawler-like navigation;
- treat AI output as untrusted data, never executable authority;
- truthful auth failure on expiry rather than scope/target widening;
- do not bypass Native Messaging `allowed_origins` with unrestricted local IPC fallback.

#8 proves the browser/native/auth seam is executable for Chromium 144/Linux and that the tested raw sentinel did not propagate to Core/durable/log/Recipe/model sinks. It does **not** prove production credential-vault design, arbitrary third-party auth, cross-browser parity, cross-OS host registration, extension-store distribution, or complete production security hardening.

---

# 13. Observability / Provenance Model

A meaningful acquisition should be explainable through a durable correlation chain such as:

```text
contract_id
snapshot_id
requested_member_id / selected_target_id
effect_id / attempt_id
recipe_id/version or browser observation id
authorization_context_ref (secret-free)
authorization binding provenance / optional partition context
budget reservation/consumption
evidence ids
validation ids
artifact staging/materialization/acceptance state
artifact id/digest
recovery classification
control transition sequence/revision (cancel / accept / retry-resume)
terminal result explanation
```

Required observable fact classes include contract/snapshot lifecycle, scope decision, discovery provenance, membership/selection claims, browser observations, auth-context acquire/expire/reject without secret payload, budget mutations/exhaustion, effect dispatch/retry/cancel/reconcile, durable cancellation-vs-acceptance ordering, explicit retry/resume reopening, DB/filesystem recovery classification, transfer validators, semantic/media/coverage validation, Recipe match/fallback, AI proposal accept/reject reason, artifact staging/materialization/acceptance, and final result projection.

Logs are diagnostic; canonical durable state/evidence remains authority.

---

# 14. Migration / Bootstrap Plan from Docs-only Repository

This is architecture sequencing guidance only, **not a Task DAG and not implementation authorization**:

1. Dispatch a **fresh independent Architecture Re-Review** against the exact post-repair L2 subject, specifically verifying `AR-F01` closure without Product mutation.
2. If Re-Review requests changes, repair only the bounded architecture artifact and obtain a fresh exact-subject review as required.
3. Only after sufficient evidence and required review may a separate Architecture Freeze decision be performed.
4. Only after Architecture Freeze may a Task DAG be generated/materialized.
5. Downstream implementation can then bootstrap versioned Product-domain contracts/types and counterexample fixtures.
6. Implement pure deterministic result/coverage/domain rules before adapter-specific behavior.
7. Implement persistence/effect ledger and scheduler according to the #7-promoted invariants plus the frozen cancellation/acceptance ordering, while choosing the actual production runtime/tooling separately.
8. Establish adapter-neutral local command/query seam and CLI.
9. Add direct HTTP acquisition/validation.
10. Implement the browser/native seam according to #8-promoted invariants, with platform-specific packaging decisions made downstream.
11. Add media/HLS and bounded discovery/Recipe paths.
12. Add Desktop presentation adapter and bounded AI proposal path without changing Core authority.
13. Qualify concrete platform/browser packaging through later Validation without inventing untested support claims.

Steps 5–13 are non-binding implementation guidance and do not create Tasks in this Stage 2 successor.

---

# 15. Architecture Risks / Open Questions

These are risks/implementation decisions, not unresolved material Architecture UNKNOWNs blocking review:

- **A1 — host power-loss durability:** #7 proves process-death/reopen only; stronger power-loss guarantees need a separate E3 storage/platform proof if later required.
- **A2 — production persistence schema/migration:** #7 validates semantic invariants, not a production schema or migration strategy.
- **A3 — cross-browser / cross-OS browser integration:** #8 proves Chromium 144/Linux only; Firefox/Safari and Windows/macOS registration/packaging remain unproven.
- **A4 — production credential vault:** #8 validates least-authority capability separation, not the production vault/lifetime/storage mechanism.
- **A5 — expiring/signed locators:** refresh can become accidental target substitution; provenance binding must remain explicit.
- **A6 — HLS topology breadth:** S4 is basic; unsupported encryption/multitrack/mux topology must fail closed.
- **A7 — Recipe language creep:** arbitrary script/DOM automation could recreate a general web agent/crawler and would require architecture/security reconsideration.
- **A8 — evidence volume:** low-level segment/transfer events may need safe aggregation without losing identity/provenance needed for truth.
- **A9 — local IPC abuse:** concrete production IPC must authenticate/authorize local peers and apply strict input bounds.
- **A10 — platform promise gap:** no OS/browser release matrix may be claimed until selected and validated downstream.

---

# 16. Explicit Architecture Contradictions

**NONE identified.**

Neither Research Demo found a Frozen Product contradiction. The candidate mechanisms satisfied their stated hypotheses within the exact tested environments and limits. A later technical failure should first alter the candidate architecture; only evidence that the Frozen Product contract itself is contradictory may trigger the ADS Product-reopen path.

---

# 17. Research Demo Evidence Incorporated

## Research Demo #7 — durable ledger + filesystem crash/restart/idempotency

- Issue: `kaicreator-mm/xDownload#7`
- terminal comment: `5953990637`
- result: `PASS`
- baseline: `44fd0fc7287b45735f069263c87486e6585fd7ae`
- tested executable harness: `5ed0cb63f30103786c8de7a74a265ed0378173a2`
- final research HEAD: `4adbe7c587920383a654e020de757e2de657c312`
- Evidence Strength: `E3`
- tested tuple: Linux `6.18.44` x86_64 / Python `3.13.5` / SQLite `3.46.1` / real local SQLite+filesystem / separate process `SIGKILL`+restart / two independent clients
- narrow proof: process-death/reopen recovery, stable snapshot/budgets/effect lineage/accepted artifact identity, explicit DB/filesystem reconciliation
- mandatory limitation: not host power-loss durability, not Windows/macOS, not production schema/migrations/performance/release readiness; cancellation precedence was explicitly an `ADAPT` item rather than a universally proven rule

## Research Demo #8 — browser observation + scoped auth broker

- Issue: `kaicreator-mm/xDownload#8`
- terminal comment: `5954331493`
- result: `PASS`
- baseline: `44fd0fc7287b45735f069263c87486e6585fd7ae`
- final research HEAD: `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`
- final tree: `486fb32577ac89f41276614611a7ef582ab68a15`
- Evidence Strength: `E3`
- tested tuple: Linux `6.18.44` x86_64 / Chromium `144.0.7559.96` / Python `3.13.5` / real MV3 extension + `webRequest` + cookie/partition context + Native Messaging host + controlled auth origin
- narrow proof: scoped opaque auth capability, provenance binding, content validation, `allowed_origins` enforcement, secret non-propagation in tested sinks, truthful auth expiry, partition-context discrimination
- mandatory limitation: not Firefox/Safari, not Windows/macOS registration/packaging, not browser-store distribution, not production vault/arbitrary websites/release readiness

Both research branches remain evidence/reference material. This successor promotes validated invariants and limitations only; it does not copy or merge research fixtures into production.

---

# 18. Task DAG Lane Hints — Candidate Only

No Task DAG is generated or Frozen by this section. These are only later decomposition hints after L2 Freeze.

| Candidate lane | Stable input | Ownership/write-set concept | Real serial dependency | Convergence |
|---|---|---|---|---|
| Contract/result semantics | Frozen Product + Frozen L2 schemas | canonical domain/evidence/result contracts | first foundation | shared contracts |
| Persistence/recovery | Frozen contracts + #7-promoted invariants + cancellation cutoff | store/migrations/effect ledger/recovery/reconciliation | contract foundation; shared cancellation state machine with scheduler | Core integration |
| Direct HTTP | acquisition/evidence ports | HTTP transfer + transfer validation | stable ports | Core integration |
| Browser/auth | browser/auth ports + #8-promoted invariants | extension/native broker/auth adapter | stable contracts | browser integration |
| Recipe/discovery | capability schema | matcher/interpreter/bounded discovery | stable contracts | collection integration |
| HLS/media | acquisition/validation ports | HLS/media adapter/validators | stable ports | media integration |
| Scheduler/budgets | contracts + #7 recovery semantics + cancellation cutoff | scheduling/budget/cancel/retry control order | contract foundation; shared cancellation state machine with recovery | Core integration |
| CLI | command/query contract | CLI adapter only | minimal Core port | early end-to-end |
| Desktop | command/query/result contract | presentation only | stable UI-facing contracts | UX integration |
| AI | Recipe capability contract | redaction/provider/proposal validation | deterministic Recipe runtime | optional integration |
| Validation harness | Frozen Product counterexamples + Frozen L2 | fixtures/contract/CJ harness | contracts stable | version validation |
| Packaging/platform | selected runtime/shell | installer/native host/platform packaging | concrete implementation exists | release candidate |

Candidate serial spine:

```text
Frozen L2 contracts
→ authoritative persistence/recovery + scheduler/cancellation semantics
→ integrated Core Runtime
→ protocol/surface convergence
→ platform packaging and real-host validation
```

Safe adapter/validation lanes may run in parallel only after shared contracts they consume are Frozen. Persistence/recovery and scheduler/budgets must consume one shared cancellation-vs-acceptance state-machine contract and must not independently redefine precedence. Multiple lanes must not concurrently redefine the same contract/result/evidence semantics.

---

# 19. Evidence Table

| Source | Type / authority | Relevance | Claim supported |
|---|---|---|---|
| Frozen PRD `docs/product/PRD-v0.4.2-review-candidate.md@65be7aaeabe7ead5544bbc9e7d6e16a805412025` | Frozen Product authority | Stage 1 reviewed source | Contract/snapshot/budget/result/security/S1–S6 semantics |
| `docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md` | project lifecycle authority | v0.1.0 Stage 1 checkpoint | Product frozen; Architecture not frozen |
| ADS `prompts/L2_ARCHITECTURE_EVIDENCE.md@94cad2b0487e8a552c66d6bcd1cba36b7779383d` | pinned process authority | v4.0.0 | L2 content, UNKNOWN disposition, lane hints |
| ADS `standards/ARCHITECTURE_RESEARCH_DEMO_STANDARD.md@94cad2b0487e8a552c66d6bcd1cba36b7779383d` | pinned process authority | v4.0.0 | Demo trigger, exact identity, real-boundary/failure evidence rules |
| SQLite WAL / transaction / atomic commit official documentation | static primary technical evidence | carried from initial L2 research | local transaction/WAL semantics; insufficient alone for cross-DB/filesystem application recovery |
| Chrome Native Messaging / `webRequest` / cookies / messaging / permissions official documentation | static primary platform evidence | carried from initial L2 research | browser observation, native host, permission/trust primitives; insufficient alone for end-to-end xDownload auth seam |
| RFC 9110 | primary protocol standard | HTTP resume/retry | Range / `If-Range` identity rules |
| RFC 8216 | primary protocol standard | HLS | playlist/segment/rendition structure |
| Issue #7 terminal `5953990637`, final HEAD `4adbe7c587920383a654e020de757e2de657c312`, tested harness `5ed0cb63f30103786c8de7a74a265ed0378173a2` | project-local exact-SHA E3 executable evidence | current and rechecked before mutation | U2 process-death/reopen durability/idempotency/reconciliation; stable cancellation/retry lineage and budgets, but universal precedence remained `ADAPT` |
| Issue #10 terminal `5955027193` | fresh independent Architecture Review authority | exact L2 predecessor `03f42c870281d6e9317317db47a2076b318d4894` | identifies `AR-F01` as the sole P1 L2 contract blocker and requires deterministic cancellation/recovery precedence; no new Demo required |
| Issue #8 terminal `5954331493`, final HEAD `b5fbbe1ef22414cacfede5fdb9d1aac1f858e5cb`, tree `486fb32577ac89f41276614611a7ef582ab68a15` | project-local exact-SHA E3 executable evidence | current and rechecked before mutation | U3 real Chromium/native broker least-authority seam |

The executable evidence is intentionally not generalized beyond its tested tuples. The `AR-F01` rule is a normative architecture decision constrained by Frozen Product semantics and existing evidence, not an executable-evidence overclaim.

---

# 20. What Is NOT Proven

This L2 successor does **not** prove:

- that any production implementation exists;
- host power-loss/kernel-panic/storage-controller durability for SQLite + filesystem;
- Windows/macOS persistence/filesystem behavior;
- a production SQLite schema, migration mechanism or production runtime choice;
- Firefox/Safari parity or Windows/macOS Native Messaging registration/packaging;
- extension-store distribution/signing/update;
- arbitrary third-party authenticated-site behavior;
- a production credential-vault implementation;
- that a specific Desktop framework, language/runtime, IPC transport, installer or updater is suitable;
- arbitrary HLS encryption/DRM/separate A/V/multi-audio/subtitle topology outside Frozen S4;
- HTTP resume where origin/CDN behavior lacks compatible validators/ranges;
- any model/provider's Recipe-adaptation reliability;
- throughput, scale, high-load concurrency or distributed/multi-host behavior;
- full production security hardening or penetration resistance;
- universal cancellation precedence as an independently executable-tested Product implementation; this repair defines the candidate L2 rule for later implementation/Validation rather than claiming #7 proved it;
- Product G0/G1/G2/G3 PASS, Critical Journey PASS, Hidden Validation, packaging Validation or Release Qualification;
- Architecture Freeze;
- Task DAG generation/readiness;
- implementation or release readiness.

---

# 21. Review-readiness checks

Before marking this bounded repair ready for re-review, the following were checked:

1. Architecture Facts/Decisions remain traceable to Frozen Product plus static evidence or exact Research Demo evidence.
2. #7 limitations explicitly preserve the distinction between process-death/reopen and host power-loss durability.
3. #8 limitations explicitly preserve cross-browser, cross-OS, store-distribution and production-vault gaps.
4. U2/U3 remain recorded as resolved by executable evidence; no new Research Demo requirement was invented.
5. The candidate remains `NOT FROZEN`.
6. No Task DAG was generated.
7. No production framework/runtime/IPC choice was added from the research harnesses.
8. No research branch was merged or copied wholesale into `version/v0.1.0`.
9. Frozen Product semantics were not modified.
10. The 9 concern dispositions and zero unresolved material UNKNOWN accounting were not changed.
11. `AR-F01` now has one Core-owned cancellation-vs-recovery/validation/acceptance/finalization order, one normalized counterexample outcome, explicit same-lineage retry/resume semantics, and deterministic Product-status projection rules.
12. No self-review, Architecture Freeze, Task DAG, implementation or executable production Validation was performed by this repair.

---

# 22. Stage 2 Bounded Repair Disposition

```text
ADS_STAGE2_L2_REPAIR_RESULT=READY_FOR_REREVIEW
SOURCE_REVIEW_ISSUE=10
SOURCE_REVIEW_COMMENT=5955027193
BLOCKER=AR-F01
AR_F01_STATUS=CLOSED_CANDIDATE
MATERIAL_CONCERNS_TRACKED=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_EVIDENCE_SUFFICIENT=2
EXECUTABLE_DEMO_REQUIRED=0
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
PRODUCT_SCOPE_FREEZE=FROZEN
ARCHITECTURE_FREEZE=NO
TASK_DAG_STARTED=NO
IMPLEMENTATION_STARTED=NO
PRODUCT_SEMANTICS_MUTATED=NO
SELF_REVIEW=NO
```

Next Stage 2 action is a **fresh independent Architecture Re-Review** on the exact resulting L2 subject. This Builder session stops before self-review, Architecture Freeze, Task DAG generation or production implementation.