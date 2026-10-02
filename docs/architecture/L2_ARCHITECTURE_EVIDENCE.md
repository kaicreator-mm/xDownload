# xDownload — L2 Architecture Evidence

Status: `STAGE 2 CANDIDATE / NOT FROZEN`

Product release target: `v0.1.0`  
Research date: `2026-10-02`  
Starting baseline: `version/v0.1.0@1dca2687eac1e93a119736652007ce2e02720df6`  
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

This artifact is **Architecture Evidence plus a candidate architecture**. It is not Architecture Freeze, Task DAG, implementation, executable Validation, Release Qualification, or Release PASS. Frozen Product semantics are unchanged.

---

## 1. Evidence vocabulary

Claims in this document use distinct certainty levels:

- **Frozen Product Fact** — authority comes from the Frozen Stage 1 Product/Scope and cannot be changed here.
- **Architecture Evidence** — repository, protocol, platform, official-source, or mature implementation evidence relevant to an architectural choice.
- **Architecture Candidate Decision** — recommended design that remains subject to required Demo evidence, independent Architecture Review, and a later separate Freeze decision.
- **Architecture UNKNOWN** — material architecture fact not yet sufficiently established.
- **Inference** — reasoned consequence of Product Facts and evidence, not independently proven runtime behavior.
- **Future implementation detail** — intentionally not frozen because current Product/Architecture evidence does not require selecting it yet.

---

# 2. Current-state findings

1. The repository is currently **planning/docs only**. At the Stage 2 starting tree there is no production runtime, application/package structure, persistence implementation, browser extension, downloader engine, media pipeline, CLI implementation, executable architecture harness, or established implementation toolchain.
2. `.dev-standard/PROJECT_OVERRIDES.md` explicitly records a planning-stage structure and says implementation layout/platform/toolchain are not Frozen.
3. Stage 1 Product/Scope is `FROZEN`; Architecture Freeze is `NO`; Task DAG and implementation are `NOT STARTED`.
4. Therefore there is no existing implementation architecture to preserve or falsely treat as proven. Stage 2 is a bootstrap from Frozen Product semantics.
5. Architecture must preserve the authoritative `AcquisitionContract`, immutable confirmed scope and `SelectionSnapshot`, lifecycle budgets, multidimensional terminal result truth, bounded collection boundary, browser/session security boundary, S1–S6 support slices, and crash/retry no-drift semantics.

---

# 3. Architecture Drivers

## D1 — One authoritative contract/result semantics across Desktop, Browser and CLI

**Frozen Product Fact:** all three surfaces project the same `AcquisitionContract` and final status semantics.

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

**Implication:** no general recursive crawler API in the privileged Core capability surface.

## D6 — Deterministic/template-first; bounded AI fallback

Model unavailability cannot block ordinary deterministic/template-supported work.

**Implication:** AI is a proposal adapter behind schema/policy/scope validation, never the source of authority.

## D7 — Browser observation plus local authorization boundary

The browser may provide page/network/player context and local authorization while raw credentials/tokens remain local where possible and do not become ordinary LLM/Recipe state.

**Implication:** observation metadata and sensitive credential material use separate trust paths.

## D8 — Multiple protocol/media execution modes under one Product contract

S1–S6 include direct HTTP/file, browser handoff, direct media, HLS VOD, current-page collection and explicit playlist/gallery collection.

**Implication:** share lifecycle/result contracts, but use protocol/media-specific execution and validation adapters.

## D9 — Crash/restart/retry truth

Restart/retry cannot reset budgets, drift snapshot membership, duplicate accepted effects, or rewrite an uncertain failure into success.

**Implication:** durable effect identity and explicit reconciliation semantics are architecture-level concerns.

## D10 — Local product surfaces without unsupported platform promises

Desktop, Browser Integration and CLI are required surfaces; exact OS/browser/runtime/framework matrix is not Frozen Product authority.

**Implication:** freeze ownership/contracts/trust boundaries first; keep framework, concrete IPC transport, packaging stack and platform matrix replaceable until supported by downstream evidence.

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
8. **Stable effect identity:** commands/work/effects/attempts use durable IDs so retry/restart can reconcile instead of blindly replaying.
9. **Fail-closed browser boundary:** page/content-script input is untrusted and cannot invoke privileged native/auth actions without schema + contract/origin/tab validation.
10. **Opaque authorization references:** canonical task state stores secret-free auth context identity/provenance, not reusable raw credentials as ordinary state.
11. **Recipe confinement:** Recipe execution uses a finite typed capability vocabulary; no arbitrary shell, unrestricted JS/filesystem/cookie export, host scanning or recursive navigation.
12. **AI cannot grant authority:** AI can propose bounded structured adaptations; deterministic Core policy decides whether they are executable.
13. **Protocol normalization:** direct HTTP, HLS/media and browser-mediated adapters emit canonical effect/evidence/validation records and do not invent their own success semantics.
14. **Accepted artifacts require validation:** transfer alone does not make an artifact accepted.
15. **Replaceable platform implementation:** shell/framework/IPC/client/media tooling remain behind stable ports until specific evidence requires freezing a choice.

---

# 5. Architecture UNKNOWNs and Dispositions

Material UNKNOWNs: **9**.

| ID | Material UNKNOWN | Architecture impact | Disposition | Candidate conclusion |
|---|---|---|---|---|
| U1 | How to prevent Desktop/CLI/Browser from becoming competing authorities | public contract, concurrency, result truth | `STATIC_EVIDENCE_SUFFICIENT` | Use one local authoritative Core Control Runtime with thin adapters. Shared libraries may hold pure domain logic, not multiple mutable authorities. |
| U2 | Can SQLite + filesystem preserve snapshot/budget/idempotency truth across real process death/restart and concurrent clients? | durability, data integrity, failure semantics | `EXECUTABLE_DEMO_REQUIRED` | SQLite is the preferred local store candidate, but xDownload's cross-DB/filesystem crash windows are not statically proven. Research Demo **#7**. |
| U3 | Can a real browser extension/native broker provide observation + scoped session authorization while limiting secret exposure and enforcing origin/contract binding? | security/auth/trust boundary | `EXECUTABLE_DEMO_REQUIRED` | WebExtension/native messaging APIs make the seam plausible, but the end-to-end real browser/session boundary must be executed. Research Demo **#8**. |
| U4 | Can current extension APIs supply the observation path without general blocking interception? | browser capability design | `STATIC_EVIDENCE_SUFFICIENT` | Current Chrome MV3 docs retain ordinary `webRequest` observation with host permissions; candidate requires observation, not unrestricted blocking rewrite. |
| U5 | What HTTP resume/retry rule avoids target drift? | correctness/retry | `STATIC_EVIDENCE_SUFFICIENT` | Resume only when representation identity is sufficiently validated; use `If-Range`/strong validator where available, otherwise restart safely. |
| U6 | Does HLS VOD need a specialized media/protocol adapter? | S4 correctness/budgets/validation | `STATIC_EVIDENCE_SUFFICIENT` | Yes. HLS is playlist/segment/rendition structured and cannot be treated as one opaque file transfer. |
| U7 | How can Recipe/AI adaptation stay bounded? | security/crawler boundary/deterministic fallback | `STATIC_EVIDENCE_SUFFICIENT` | Declarative Recipe schema + finite capability interpreter + deterministic validator; AI returns proposal data only. |
| U8 | Where do Evidence, coverage and final status live? | public semantics/explainability | `STATIC_EVIDENCE_SUFFICIENT` | Typed Evidence Ledger + canonical Result Projector in Core. Per-surface status derivation is rejected. |
| U9 | Must Stage 2 choose a concrete desktop framework/runtime/IPC now? | packaging/evolution | `STATIC_EVIDENCE_SUFFICIENT` | No. Freeze the local authority and communication/security contracts; leave concrete shell/runtime/IPC behind ports until downstream evidence. |

Disposition counts:

```text
MATERIAL_UNKNOWNS=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_DEMO_REQUIRED=2
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
```

No Architecture Contradiction is currently supported by evidence. The Frozen Product appears architecturally achievable; the remaining executable questions concern candidate implementation mechanisms.

---

# 6. Candidate Patterns + Evidence

## 6.1 Runtime / control-plane decomposition

### Alternative A — Desktop/UI-owned monolith

Benefits: lowest initial process/IPC complexity.

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

Failure modes/trade-offs: Core lifecycle, IPC versioning and local peer authentication add complexity; Core failure pauses work until restart.

Escape hatch: Core may initially be launched on demand rather than as a permanent daemon while preserving the same logical port boundary.

Disposition: **recommended candidate**.

Supporting platform evidence: Chrome and Mozilla Native Messaging provide explicit extension↔native-host seams with allow-listed extension identity and stdio message transport, supporting a narrow browser/native control boundary rather than using a content script as the acquisition runtime.

## 6.2 State ownership / persistence

Authoritative state candidate:

```text
AcquisitionContract + successor relation
SelectionSnapshot
requested / confirmed / selected identities
AuthorizationContextRef metadata
BudgetLedger + reservations/consumption
WorkItem / Attempt / Effect identity
Evidence + Validation records
Artifact records + digest/provenance
terminal projection inputs
transition/audit facts
```

Downloaded bytes belong in a filesystem artifact store; transactional metadata owns identity/state and binds files to durable effect/artifact records.

### JSON/files only

Easy to bootstrap, but weak for atomic multi-record mutation and concurrent UI+CLI recovery. **Not recommended as authority store**.

### SQLite + filesystem, Core-owned single writer

Official SQLite sources document transactional atomicity and same-host WAL behavior with concurrent readers and one writer. This fits a local-first product without introducing a server database.

Trade-off: database atomicity does not prove xDownload's application-level filesystem/network effect recovery. Therefore SQLite remains **candidate / Demo-gated by #7**.

### PostgreSQL/server database

Stronger server-oriented concurrency, but adds deployment/service/credential/upgrade burden not required by current Product scope. Preserve a state-repository boundary so a future remote/server Product version can adopt another backend without redefining domain contracts.

Disposition for v0.1.0 candidate: **SQLite + filesystem, gated by #7**.

## 6.3 Transaction/effect pattern

A canonical Core command transaction records:

1. command/idempotency identity;
2. expected/current revision;
3. budget reservation/consumption delta;
4. domain state transition;
5. durable effect/outbox intent where external work is required;
6. provenance/audit fact.

Network/file effects cannot be made atomically identical to a database commit. Candidate semantics are therefore **recoverable at-least-once external execution + idempotent acceptance/reconciliation**, never an unproven exactly-once claim.

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

- validate/schema-bound all page/content messages;
- least host/API permissions and optional permissions where practical;
- bind observation to tab/frame/origin/request provenance;
- persist opaque `AuthorizationContextRef`, not raw reusable cookie/password/token data;
- broker session material only for the exact authorized target/origin and task context;
- redact secrets at logs/evidence/model/Recipe boundaries;
- fail with `AUTH_REQUIRED` / `AUTH_FAILED` instead of widening authority.

Official Chrome messaging guidance treats content scripts as less trustworthy and recommends validation/sanitization; cookie access requires `cookies` plus matching host permissions and now includes partition-aware context. These support the boundary design but do not prove the real seam. **Issue #8 is required before Freeze**.

## 6.5 Download / media execution boundary

```text
AcquisitionExecutor
├── DirectHttpAdapter        # S1/S2/S3 where direct transfer applies
├── HlsVodAdapter            # S4
└── future protocol adapters # only if future Product scope authorizes

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

RFC 9110 permits servers to ignore Range and defines `If-Range` conditional resume behavior. Candidate rules:

- preserve partial bytes only when representation identity is sufficiently validated;
- use a strong validator where available;
- if the validator changes, Range is ignored incompatibly, or identity cannot be proven, restart rather than append incompatible bytes;
- redirect/CDN/signed-locator refresh is a locator change, not permission to replace logical target identity;
- retry consumes remaining Transfer/Global budgets and remains in the same effect/target lineage.

### HLS VOD

RFC 8216 models playlists that enumerate media segments/renditions, so S4 needs protocol-specific parsing, budgeting and validation.

Candidate rules:

- bind the selected manifest/rendition identity;
- segment requests count toward TransferBudget;
- fail closed on unsupported encryption/track/mux topology per Frozen Product;
- media assembly/probing stays behind an adapter (FFmpeg-family tooling is a viable implementation option, not Frozen here);
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
- `ResultProjector` — deterministic projection of the six Frozen result dimensions.

This allows, for example, selected acquisition to be `COMPLETE` while request fulfillment is `PARTIAL` and coverage is `TRUNCATED`, exactly as Frozen Product semantics require.

## 6.8 Concurrency / scheduling / budgets

Candidate scheduling rules:

- Core is the only authoritative scheduler and budget writer;
- clients use idempotent command/request identities;
- scheduler creates durable work/effect IDs;
- generated actions reserve budget before dispatch or as part of the same authoritative transition;
- completion/retry consumes/releases reservations deterministically;
- cancellation is durable, not just an in-memory signal;
- duplicate submit does not silently create another acquisition;
- browser reattachment changes observation/session availability, not frozen contract/snapshot identity.

High-impact race/crash cases are delegated to Demo #7 rather than claimed from static design.

## 6.9 Platform / packaging constraints

Architecture-driving facts:

- Browser Integration needs an installable extension plus native/local handoff seam or equivalent;
- CLI must not depend on Desktop UI lifetime;
- long-running acquisition must not depend on a page/content script remaining alive;
- authoritative state/artifacts must survive Core restart;
- browser/native host registration is platform-specific and must be packaged eventually.

Not currently Frozen/proven:

- Windows/macOS/Linux release matrix;
- Chromium/Firefox release matrix;
- Desktop shell/framework;
- Core language/runtime;
- exact local IPC transport;
- installer/updater mechanism;
- permanent daemon vs on-demand Core lifecycle.

---

# 7. Decision Matrix

| Area | Alternative | Strength | Failure/trade-off | Escape hatch | Candidate |
|---|---|---|---|---|---|
| Authority | UI monolith | simple start | CLI/browser coupling; divergent truth | extract Core later | NO |
| Authority | independent embedded runtimes | code reuse | multi-writer races/version skew | pure shared libraries only | NO for mutable authority |
| Authority | local authoritative Core + adapters | one contract/budget/result authority | IPC/lifecycle complexity | on-demand Core lifecycle | **YES** |
| Persistence | JSON/files | simple | weak atomic multi-record recovery | migrate later | NO |
| Persistence | SQLite + filesystem | local, transactional, no external service | app effect crash windows | backend abstraction | **YES, #7-gated** |
| Persistence | PostgreSQL | server concurrency | unnecessary service burden | future remote mode | DEFER |
| Browser auth | whole-cookie export | broad compatibility | excessive secret exposure/staleness | none acceptable | NO |
| Browser auth | scoped native broker + opaque ref | least authority/provenance | must prove real seam | fail auth + browser-specific adapter | **YES, #8-gated** |
| Browser network | blocking interception first | broad control | excessive authority/MV3 restrictions | observe + explicit handoff | NO |
| Browser network | observation + explicit handoff | matches Product | host permission/corpus limits | Recipe/user confirmation | **YES** |
| Transfer | one generic byte engine | simple | HLS/media topology mismatch | protocol adapters | NO |
| Transfer | canonical executor + adapters | common lifecycle + correct protocol semantics | more contracts | external tool behind adapter | **YES** |
| Recipe | arbitrary JS/automation | flexible | crawler/security escape | capability DSL | NO |
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
  persistence-sqlite/      # candidate, #7-gated
  artifact-filesystem/
  http-direct/
  hls-media/
  browser-auth/            # candidate, #8-gated
  model-provider/
```

This is a responsibility map, **not an implementation scaffold instruction**. No empty modules are authorized by this document.

External surfaces use a versioned local command/query contract. Representative semantics include proposing/confirming acquisitions, submitting observations, start/pause/resume/cancel/retry, and reading contract/snapshot/progress/result/evidence explanations. Exact wire format/transport remains future implementation detail.

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

Internal workflow state never replaces the Frozen six-dimensional terminal Product result.

---

# 9. Key ADR Candidates / Invariants

These are proposed later Architecture Freeze decisions, not Frozen facts now:

- **ADR-001** — one local authoritative Core Control Runtime; all Product surfaces are adapters.
- **ADR-002** — Contract/Snapshot/Result schema is Core-owned and versioned independently of UI.
- **ADR-003** — SQLite local metadata/state store with serialized authoritative writer; adoption gated by Demo #7.
- **ADR-004** — filesystem artifact store separated from transactional metadata with recoverable staging/finalization.
- **ADR-005** — Browser extension + native broker + opaque auth reference; adoption gated by Demo #8.
- **ADR-006** — Direct HTTP and HLS/media are distinct execution adapters behind one acquisition port.
- **ADR-007** — declarative Recipe capability interpreter; arbitrary scripting/navigation is not a Recipe capability.
- **ADR-008** — AI is proposal-only and cannot grant authority.
- **ADR-009** — typed Evidence Ledger and Result Projector own terminal truth.
- **ADR-010** — recoverable at-least-once external effects plus idempotent acceptance; no exactly-once claim.
- **ADR-011** — stable target identity is separate from mutable locator and authorization context.
- **ADR-012** — concrete Desktop/runtime/IPC/platform matrix remains replaceable until a later authorized decision.

---

# 10. Data Ownership / Trust Boundaries / Synchronization

| Data/authority | Canonical owner | Producers/readers | Synchronization rule |
|---|---|---|---|
| AcquisitionContract | Core Contract Domain + authoritative store | UI/CLI submit intent; Browser supplies observations | revision/idempotency checks; successor identity for semantic change |
| SelectionSnapshot | Core | confirmation/discovery evidence | immutable after confirmation |
| requested/confirmed/selected identities | Core | discovery/Recipe/browser evidence | identity correspondence, never count-only |
| budgets | Core Scheduler/Budget Ledger | all effect dispatchers | transactional reservation/consumption; no private writer |
| browser observations | Evidence Ledger | privileged extension | append/provenance-bound; not direct authority |
| raw session secrets | Browser/Broker ephemeral zone | scoped broker/transfer path only | no ordinary persistence/LLM/Recipe/log export |
| AuthorizationContextRef | Core metadata | broker issues/validates | opaque, scoped, expiring/revocable, provenance-bound |
| transfer progress | Acquisition Runtime + store | protocol adapters | durable checkpoints only when recovery-safe |
| Evidence | Evidence Ledger | discovery/transfer/validators/user claims | append-oriented typed claim records |
| terminal statuses | Result Projector | all surfaces read | derived only from canonical state/evidence |
| artifact bytes | Filesystem store | transfer/validation | staged then accepted; digest/provenance binds to DB identity |
| Recipes | versioned Recipe store | matcher/adaptation/promotion | schema/applicability/failure validation; no embedded credentials |

Read caches are disposable and never become authority.

---

# 11. Failure / Restart / Retry / Idempotency / Consistency Semantics

Core principles:

- a database commit does not prove an external network/file effect succeeded;
- external success observed before crash does not prove durable acceptance;
- uncertain effects are reconciled, not silently marked success or blindly duplicated;
- retry uses the same logical target/effect lineage and remaining budgets;
- target/scope semantic change requires a successor contract/snapshot.

Candidate recovery classes include `NOT_DISPATCHED`, `IN_FLIGHT_UNKNOWN`, `PARTIAL_RECOVERABLE`, `SUCCEEDED_UNACCEPTED`, `ACCEPTED`, and explicit terminal failure equivalents.

### Crash after budget reservation, before dispatch

Recovery reconciles reservation against durable dispatch/effect state. Restart cannot mint a fresh budget.

### Crash with staged/partial bytes

Staged bytes are not accepted output. Recovery validates target/effect identity and safe-resume conditions; otherwise it restarts within remaining budget.

### Crash after bytes succeed, before accepted record

Reconcile via effect ID + artifact digest/provenance; do not infer success from filename/file existence alone and do not blindly duplicate accepted effects.

### Concurrent UI/CLI clients

Core serializes/validates authoritative transitions. Duplicate requests use idempotency/revision rules. Browser observations cannot mutate a frozen snapshot.

### Cancellation

Cancellation is durable and prevents new dispatch where applicable. In-flight work is reconciled truthfully; cancellation does not create vacuous success.

These application-level rules are candidate semantics until Demo #7 supplies the required E3 evidence.

---

# 12. Security / Auth / Secret Boundary

Security-sensitive seams requiring later independent review include:

1. page/content script → privileged extension context;
2. extension → native messaging broker;
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
- contract/snapshot binding for privileged action;
- secret redaction before persistence/logging/model/Recipe paths;
- in-memory/local-broker handling of raw auth material where possible;
- local IPC peer authorization suitable for same-install/same-user operation;
- deny unknown Recipe capabilities and arbitrary crawler-like navigation;
- treat AI output as untrusted data, never executable authority.

Demo #8 is required before freezing the browser authorization seam.

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
budget reservation/consumption
evidence ids
validation ids
artifact id/digest
terminal result explanation
```

Required observable fact classes include contract/snapshot lifecycle, scope decision, discovery provenance, membership/selection claims, browser observations, auth-context acquire/expire/reject without secret payload, budget mutations/exhaustion, effect dispatch/retry/cancel/reconcile, transfer validators, semantic/media/coverage validation, Recipe match/fallback, AI proposal accept/reject reason, artifact staging/acceptance, and final result projection.

Logs are diagnostic; canonical durable state/evidence remains authority.

---

# 14. Migration / Bootstrap Plan from Docs-only Repository

This is an architecture migration sequence, **not a Task DAG**:

1. Execute Research Demos #7 and #8 independently and feed PASS/FAIL/BLOCKED evidence back into L2.
2. Perform fresh independent Architecture Review on the current post-demo L2 candidate.
3. Only after required evidence/review permits, execute a separate Architecture Freeze decision.
4. Bootstrap versioned Product-domain contracts/types and counterexample fixtures.
5. Implement pure deterministic result/coverage/domain rules.
6. Implement persistence/effect ledger and scheduler according to #7 evidence.
7. Establish adapter-neutral local command/query seam and CLI.
8. Add S1 direct HTTP acquisition/validation.
9. Implement browser/native seam according to #8 evidence, then S2/browser observations.
10. Add S3/S4 media/HLS adapter/validation.
11. Add S5/S6 bounded discovery + declarative Recipe runtime.
12. Add Desktop shell as a non-authoritative adapter.
13. Add bounded AI only after deterministic/Recipe path is executable and model-offline behavior is preserved.
14. Select/qualify concrete platform/browser packaging downstream without inventing untested support claims.

Steps 4–14 are future implementation guidance only and are not authorized by Issue #6.

---

# 15. Architecture Risks / Open Questions

- **A1 — DB/filesystem crash windows:** must be resolved by #7 before adopting the persistence/recovery candidate.
- **A2 — browser auth leakage:** whole-cookie export is too broad for the candidate trust model; #8 must prove a scoped reference-browser seam.
- **A3 — cross-browser differences:** native-host manifest/registration and extension APIs differ; vendor-specific details stay outside Core.
- **A4 — expiring/signed locators:** refresh can become accidental target substitution; provenance binding must be explicit.
- **A5 — HLS topology breadth:** S4 is basic; unsupported encryption/multitrack/mux topology must fail closed.
- **A6 — Recipe language creep:** arbitrary script/DOM automation could recreate a general web agent/crawler and requires architecture/security reconsideration.
- **A7 — evidence volume:** low-level segment/transfer events may need safe aggregation without losing identity/provenance needed for truth.
- **A8 — SQLite contention/checkpoint behavior:** single-writer Core and short reads are the candidate mitigation; #7 should exercise relevant real contention/restart cases.
- **A9 — local IPC abuse:** concrete IPC must authenticate/authorize local peers and apply strict input bounds.
- **A10 — platform promise gap:** no OS/browser matrix may be claimed until selected and validated downstream.

---

# 16. Explicit Architecture Contradictions

**NONE identified.**

No current evidence shows the Frozen Product requirements are mutually contradictory or unachievable. A future Demo FAIL should alter the candidate architecture first; only evidence that the Product contract itself is contradictory may trigger the ADS Product-reopen path.

---

# 17. Required Research Demo Evidence

The ADS Demo rule is triggered for exactly two material UNKNOWNs because each can change durability/security/failure semantics and static evidence is insufficient.

## Research Demo #7 — durable ledger + filesystem crash/restart/idempotency

Issue: `kaicreator-mm/xDownload#7`  
Dispatch baseline: `version/v0.1.0@44fd0fc7287b45735f069263c87486e6585fd7ae`  
Evidence Strength: **E3**  
Planned research branch: `research_v0.1.0-durable-ledger-recovery`

Falsifiable hypothesis summary:

> With real SQLite, real filesystem staging/finalization, two independent local clients and real process termination/restart, the candidate authoritative ledger can recover the specified crash windows without changing the frozen snapshot, replenishing/double-consuming lifecycle budgets, duplicating accepted artifact/effect identity, or silently converting uncertain work to success.

Real Under Test includes SQLite, filesystem and OS process death/restart. Unrelated network/model dependencies may be deterministic fakes. Positive, concurrent-duplicate, crash-before-dispatch, staged-partial, success-before-acceptance, finalization, retry/cancel and integrity-negative scenarios are specified in Issue #7.

**This L2 Builder does not execute #7.**

## Research Demo #8 — browser observation + scoped auth broker

Issue: `kaicreator-mm/xDownload#8`  
Dispatch baseline: `version/v0.1.0@44fd0fc7287b45735f069263c87486e6585fd7ae`  
Evidence Strength: **E3**  
Planned research branch: `research_v0.1.0-browser-auth-broker`

Falsifiable hypothesis summary:

> With a real reference browser extension, real native messaging host and controlled authenticated origin, xDownload can bind page/network observations and a scoped authorization capability to the intended tab/origin/contract, acquire the authorized resource, reject unbound/cross-origin misuse, and keep raw session secrets out of Core durable state, logs, Recipe data and model-facing payloads.

Real Under Test includes a real browser extension/session/native-host seam. Controlled local web origin/Core/model sinks may be deterministic. Positive auth handoff, observation, cross-origin misuse, malformed page input, host allow-list failure, secret non-propagation, session expiry and partition/context boundary scenarios are specified in Issue #8.

**This L2 Builder does not execute #8.**

A Demo PASS proves only its stated hypothesis and tested tuple. It does not prove multi-platform support, release readiness, arbitrary websites, scale/performance or broader security properties.

---

# 18. Task DAG Lane Hints — Candidate Only

No Task DAG is generated or Frozen by this section. These are only later decomposition hints after L2 Freeze.

| Candidate lane | Stable input | Ownership/write-set concept | Real serial dependency | Convergence |
|---|---|---|---|---|
| Contract/result semantics | Frozen Product + Frozen L2 schemas | canonical domain/evidence/result contracts | first foundation | shared contracts |
| Persistence/recovery | Frozen contracts + #7 result | store/migrations/effect ledger/recovery | contract foundation + Demo #7 | Core integration |
| Direct HTTP | acquisition/evidence ports | HTTP transfer + transfer validation | stable ports | Core integration |
| Browser/auth | browser/auth ports + #8 result | extension/native broker/auth adapter | stable contracts + Demo #8 | browser integration |
| Recipe/discovery | capability schema | matcher/interpreter/bounded discovery | stable contracts | collection integration |
| HLS/media | acquisition/validation ports | HLS/media adapter/validators | stable ports | media integration |
| Scheduler/budgets | contracts + #7 recovery semantics | scheduling/budget/cancel | contract foundation + recovery semantics | Core integration |
| CLI | command/query contract | CLI adapter only | minimal Core port | early end-to-end |
| Desktop | command/query/result contract | presentation only | stable UI-facing contracts | UX integration |
| AI | Recipe capability contract | redaction/provider/proposal validation | deterministic Recipe runtime | optional integration |
| Validation harness | Frozen Product counterexamples + Frozen L2 | fixtures/contract/CJ harness | contracts stable | version validation |
| Packaging/platform | selected runtime/shell | installer/native host/platform packaging | concrete implementation exists | release candidate |

Candidate serial spine:

```text
Frozen L2 contracts
→ authoritative persistence/recovery + scheduler semantics
→ integrated Core Runtime
→ protocol/surface convergence
→ platform packaging and real-host validation
```

Safe adapter/validation lanes may run in parallel only after the shared contracts they consume are Frozen. Multiple lanes must not concurrently redefine the same contract/result/evidence semantics.

---

# 19. Evidence Table

Research/access date for current external sources: `2026-10-02`, unless a protocol version/date is stated.

| Source | Type / authority | Relevance | Claim supported |
|---|---|---|---|
| Frozen PRD `docs/product/PRD-v0.4.2-review-candidate.md@65be7aae...` | Frozen Product authority | 2026-10-02 | Contract/snapshot/budget/result/security/S1–S6 semantics |
| `docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md` | project lifecycle authority | v0.1.0 Stage 1 checkpoint | Product frozen; Architecture not frozen |
| ADS `prompts/L2_ARCHITECTURE_EVIDENCE.md@94cad2b...` | pinned process authority | v4.0.0 | L2 content, UNKNOWN disposition, lane hints |
| ADS `standards/ARCHITECTURE_RESEARCH_DEMO_STANDARD.md@94cad2b...` | pinned process authority | v4.0.0 | Demo trigger, E1/E2/E3, real-boundary/failure evidence rules |
| https://www.sqlite.org/wal.html | SQLite official docs | current | same-host WAL, reader/writer concurrency, single writer, checkpoint/WAL state |
| https://www.sqlite.org/lang_transaction.html | SQLite official docs | current | transaction/writer semantics and `SQLITE_BUSY` behavior |
| https://www.sqlite.org/atomiccommit.html | SQLite official docs | current | DB atomicity/crash robustness; does not prove xDownload filesystem/effect protocol |
| https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging | Chrome official docs | current MV3-era | native host, allow-listed origins, stdio messaging boundary |
| https://developer.chrome.com/docs/extensions/reference/api/webRequest | Chrome official docs | current MV3-era | ordinary request observation remains available; host permission requirements |
| https://developer.chrome.com/docs/extensions/reference/api/cookies | Chrome official docs | current | cookie + host permission requirements; partition-aware cookie context |
| https://developer.chrome.com/docs/extensions/develop/concepts/messaging | Chrome official docs | current | content-script trust warning; validate/sanitize and limit privileged actions |
| https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions | Chrome official docs | current | least/optional/host permissions |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging | Mozilla/MDN platform docs | current | explicit nativeMessaging permission, allowed extension IDs, background mediation, cross-browser differences |
| https://www.rfc-editor.org/rfc/rfc9110.html | IETF primary standard | RFC 9110 (2022) | Range may be ignored; validator/`If-Range` semantics for safe resume |
| https://www.rfc-editor.org/rfc/rfc8216 | IETF primary standard | RFC 8216 (2017) | HLS playlist/segment/rendition model |
| https://ffmpeg.org/ffmpeg-formats.html | mature primary project docs | current | mature specialized format/demux/mux boundary supporting media adapter separation |
| https://github.com/yt-dlp/yt-dlp/wiki/FAQ | mature OSS implementation evidence | current | browser-cookie workflows are operationally possible; broad cookie export motivates scoped secret handling rather than durable whole-cookie state |
| xDownload Issue #7 | project-local executable evidence contract | created from L2 checkpoint `44fd0fc...` | U2 E3 durability/recovery evidence to be produced separately |
| xDownload Issue #8 | project-local executable evidence contract | created from L2 checkpoint `44fd0fc...` | U3 E3 browser/auth seam evidence to be produced separately |

Static sources are not treated as proof that xDownload's own recovery/auth implementation works; that distinction is exactly why #7 and #8 exist.

---

# 20. What Is NOT Proven

This L2 candidate does **not** prove:

- that any production implementation exists;
- that SQLite + filesystem recovery satisfies xDownload's application-level invariants — #7 remains unexecuted;
- that browser authorization/session handoff satisfies the candidate least-authority boundary in a real browser — #8 remains unexecuted;
- that a specific Desktop framework, language/runtime, IPC transport, installer or updater is suitable;
- any Windows/macOS/Linux or Chromium/Firefox release matrix;
- arbitrary HLS encryption/DRM/separate A/V/multi-audio/subtitle topology outside Frozen S4;
- HTTP resume where origin/CDN behavior lacks compatible validators/ranges;
- any model/provider's Recipe-adaptation reliability;
- any throughput, scale or performance target;
- full security hardening or penetration resistance;
- Product G0/G1/G2/G3 PASS, Critical Journey PASS, Hidden Validation, packaging Validation or Release Qualification;
- Architecture Freeze;
- Task DAG readiness;
- implementation readiness.

---

# 21. Stage 2 Candidate Disposition

```text
ADS_STAGE2_L2_EVIDENCE_RESULT=DEMO_REQUIRED
MATERIAL_UNKNOWNS=9
STATIC_EVIDENCE_SUFFICIENT=7
EXECUTABLE_DEMO_REQUIRED=2
BLOCKED_UNKNOWNS=0
ARCHITECTURE_CONTRADICTIONS=0
RESEARCH_DEMO_ISSUES=7,8
PRODUCT_SCOPE_FREEZE=FROZEN
ARCHITECTURE_FREEZE=NO
TASK_DAG_STARTED=NO
IMPLEMENTATION_STARTED=NO
PRODUCT_SEMANTICS_MUTATED=NO
VALIDATION_CLAIMED=NO
```

Next Stage 2 work is separate execution of Research Demo Issues #7 and #8. Their results must be incorporated into a successor/current L2 candidate, followed by a **fresh independent Architecture Review** before any separately authorized Architecture Freeze decision.
