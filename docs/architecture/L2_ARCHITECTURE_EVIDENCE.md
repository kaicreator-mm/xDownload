# xDownload — L2 Architecture Evidence

Status: `STAGE 2 CANDIDATE / NOT FROZEN`

Product release target: `v0.1.0`

Research date: `2026-10-02`

Starting version-branch baseline: `version/v0.1.0@1dca2687eac1e93a119736652007ce2e02720df6`

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

This document is **Architecture Evidence and a candidate architecture only**. It is not Architecture Freeze, Task DAG, implementation, executable Validation, Release Qualification, or Release PASS. Frozen Product semantics are unchanged.

---

## 1. Certainty vocabulary

This document separates the following claim types:

- **Frozen Product Fact** — authority comes from the Frozen Stage 1 PRD/Scope and cannot be changed here.
- **Architecture Evidence** — externally or repository-evidenced fact relevant to architecture.
- **Architecture Candidate Decision** — recommended design subject to independent review, required Research Demo evidence, and later Architecture Freeze.
- **Architecture UNKNOWN** — a material fact not yet sufficiently established.
- **Inference** — reasoned consequence of Product Facts + Architecture Evidence; not independently proven runtime behavior.
- **Future implementation detail** — intentionally not selected at L2 candidate level because it does not need to be an Architecture Fact yet.

---

# 2. Current-state findings

1. The repository is currently **planning/docs only**. At the Stage 2 starting tree there is no production runtime, package manifest, application module tree, persistence implementation, browser extension, downloader engine, media pipeline, CLI implementation, CI/toolchain, or executable architecture test harness.
2. `.dev-standard/PROJECT_OVERRIDES.md` explicitly records the structure profile as planning-stage and states that implementation layout/toolchain/platform requirements are not Frozen.
3. Stage 1 is Product/Scope `FROZEN`; Architecture Freeze is `NO`; Task DAG and implementation are `NOT STARTED`.
4. Therefore there is **no existing implementation architecture to preserve or pretend is proven**. Migration is a bootstrap from durable Product contracts into a new implementation structure.
5. The architecture must be derived from the Frozen semantics, especially the authoritative `AcquisitionContract`, immutable `requested_scope`, immutable `SelectionSnapshot`, lifecycle budgets, multi-dimensional result model, browser/session security boundary, S1–S6 support slices, and truthful crash/retry behavior.

---

# 3. Architecture drivers

## D1 — One authoritative Product semantics across three surfaces

**Frozen Product Fact:** Desktop UI, Browser Integration and CLI MUST project the same `AcquisitionContract` and final status semantics.

Architecture consequence: adapters cannot independently implement contract mutation, budget accounting, target membership, coverage, or terminal-result rules.

## D2 — Immutable scope and no-drift retry/resume

**Frozen Product Fact:** confirmed `requested_scope` and `continuation_scope` do not silently change; retry/resume reuses the same `SelectionSnapshot`; changed membership or authorization that changes permissible acquisition creates a successor identity.

Architecture consequence: contract/snapshot identity must be durable and must be separated from volatile execution locators such as redirect/CDN/signed URLs.

## D3 — Lifecycle budgets are authoritative state

**Frozen Product Fact:** `DiscoveryBudget`, `TransferBudget`, and `GlobalSafetyBudget` are lifecycle-scoped and are not replenished by restart/retry/repair.

Architecture consequence: budget reservation/consumption must be owned by one transactional authority rather than recomputed from UI state or per-worker local counters.

## D4 — Truthful multidimensional result semantics

**Frozen Product Fact:** a single `success` field is forbidden. `RequestFulfillmentStatus`, `TargetResolutionStatus`, `SelectionAcquisitionStatus`, `CoverageStatus`, `StopReason`, and `ValidationSummary` have independent meanings.

Architecture consequence: terminal state is derived centrally from canonical state/evidence. UI/CLI may render it but must not invent it.

## D5 — Bounded collection discovery, never crawler frontier

**Frozen Product Fact:** collection admission requires identifiable collection/membership, understandable scope, bounded continuation edges, and a hard stop; arbitrary recursive/frontier crawling is out of product scope.

Architecture consequence: discovery/navigation must be capability constrained and contract traceable. General-purpose unrestricted crawler APIs are not part of the core capability surface.

## D6 — Deterministic/template-first; AI is bounded fallback

**Frozen Product Fact:** deterministic direct path and known Recipe precede AI; model unavailability must not block ordinary supported paths.

Architecture consequence: LLM integration is an adapter behind deterministic validation/guardrails, not an executor with direct authority over scope, secrets, shell, filesystem, or unrestricted navigation.

## D7 — Browser observation plus local authorization/session boundary

**Frozen Product Fact:** Browser Integration observes current page/network/player context and may supply local authorization context, while raw credentials should remain in local broker/browser context where possible and must not become ordinary model input.

Architecture consequence: browser content/page data is untrusted input; secret material and observation metadata require separate handling paths and provenance.

## D8 — Protocol/media diversity inside one Product contract

**Frozen Product Fact:** S1–S6 include direct HTTP/file, browser handoff, direct media, HLS VOD, current-page collection, and explicit playlist/gallery collection.

Architecture consequence: one canonical task/result model can be shared, but protocol/media execution requires specialized adapters and validation strategies.

## D9 — Crash/restart/durability truth

**Frozen Product Fact:** retry/restart cannot reset budgets, change snapshot membership, duplicate accepted effects, or convert failure to success.

Architecture consequence: durable intent/state transitions and external side effects require explicit idempotency/recovery semantics.

## D10 — Local-first packaging without invented platform commitments

**Frozen Product Fact:** Desktop UI, Browser Integration and CLI are required product surfaces; exact OS/browser/toolchain matrix is not Frozen.

Architecture consequence: freeze stable internal contracts and local trust boundaries, but avoid freezing Electron/Tauri/.NET/Rust/Node/Python, specific OS IPC, or a browser-vendor matrix without later authority/evidence.

---

# 4. Architecture invariants

The following are candidate invariants derived directly from Frozen Product semantics and should become ADR/L2 Freeze candidates after required evidence closes:

1. **Canonical contract ownership:** only the Core Control Runtime may create/transition authoritative `AcquisitionContract`, `SelectionSnapshot`, budget ledger, canonical target/member identities, and terminal result state.
2. **Surface projection only:** Desktop, CLI and Browser adapters submit commands / observations and consume projections; they do not directly mutate authoritative lifecycle tables or derive independent terminal semantics.
3. **Scope ≠ budget:** budget counters can stop work but never create, broaden, narrow, or reinterpret `requested_scope`.
4. **Logical target ≠ locator:** stable target/member identity is distinct from mutable URL/redirect/CDN/signed locator material. A refreshed locator is acceptable only when provenance/evidence binds it to the same frozen target.
5. **Evidence is typed and provenance-bound:** candidate discovery evidence, user claims, authorization facts, transfer evidence, validation evidence and coverage evidence retain source identity and scope.
6. **Discovery cannot self-certify validation:** the same inference that proposes a target/membership claim cannot be the only validator of that semantic claim.
7. **Single authoritative budget mutation path:** every generated discovery action, transfer action, retry and model call that consumes a declared budget is reserved/accounted by the authoritative runtime before or atomically with dispatch.
8. **Idempotent effect identity:** external effects use stable operation/attempt/effect identifiers so restart/retry can distinguish already accepted work from work that must be retried.
9. **Fail-closed browser boundary:** messages originating from page/content-script context are treated as untrusted; privileged actions require schema validation, contract binding and origin/tab/provenance checks.
10. **Opaque auth reference:** canonical task state stores `AuthorizationContextRef`/capability identity and provenance, not reusable raw browser cookies/passwords/tokens as ordinary task payload.
11. **Recipe capability confinement:** Recipe execution can invoke only a finite typed capability set. No arbitrary shell, unrestricted JS, arbitrary filesystem access, unrestricted cookie export, host scanning, or arbitrary recursive navigation.
12. **AI cannot grant authority:** AI may propose candidate mappings/Recipe adaptations within predeclared bounds; deterministic guards validate them before any privileged action.
13. **Protocol adapters normalize into one result model:** direct HTTP, HLS/media and browser-mediated acquisition emit canonical attempt/evidence/validation records; they do not invent per-adapter final-success semantics.
14. **Accepted artifact requires validation:** an artifact is not committed to the accepted output set until required Transfer/Format/Media/Target validation for its slice passes.
15. **Platform implementation is replaceable:** Desktop framework, IPC transport, HTTP client and media tool remain behind stable ports until evidence/packaging constraints require a specific choice.

---

# 5. Architecture UNKNOWNs and dispositions

Material UNKNOWN count in this candidate: **9**.

| ID | Material Architecture UNKNOWN | Why it matters | Disposition | Current conclusion |
|---|---|---|---|---|
| U1 | How to prevent Desktop/CLI/Browser from creating divergent authority | Public contract, concurrency, status truth | `STATIC_EVIDENCE_SUFFICIENT` | One local authoritative Core Control Runtime with thin adapters is the candidate; shared-library-with-independent-writers is rejected. |
| U2 | Can a local SQLite + filesystem design preserve snapshot/budget/idempotency truth across real process death, restart and concurrent UI+CLI submission? | Durability, data integrity, failure semantics | `EXECUTABLE_DEMO_REQUIRED` | SQLite is the preferred candidate store, but the **application-level crash windows** are not proven by SQLite documentation. Research Demo required. |
| U3 | Can real browser integration provide observation + scoped session authorization through a local broker while limiting secret exposure and enforcing origin/contract binding? | Security/auth/public trust boundary | `EXECUTABLE_DEMO_REQUIRED` | Native messaging/WebExtension APIs make the seam plausible; real browser/host/session behavior is not sufficiently proven statically. Research Demo required. |
| U4 | Can current browser extension APIs observe the network/page metadata needed by the architecture without relying on general blocking interception? | Browser boundary/capability design | `STATIC_EVIDENCE_SUFFICIENT` | Chrome MV3 retains normal `webRequest` observation; host permissions are explicit. Candidate uses observation, not unrestricted request rewriting. |
| U5 | What semantics are safe for HTTP resume/retry, redirects and expiring URLs without target drift? | Correctness/retry semantics | `STATIC_EVIDENCE_SUFFICIENT` | Use validator-bound range resume (`If-Range`/strong identity where available); otherwise restart transfer. Redirect/locator refresh must remain provenance-bound to same target. |
| U6 | Does HLS VOD require a protocol/media-specific execution/validation boundary rather than pretending it is a single file transfer? | S4 correctness, budgets, validation | `STATIC_EVIDENCE_SUFFICIENT` | Yes. HLS playlists enumerate media segments/renditions; specialized HLS/media adapter is required under the same canonical contract/result model. |
| U7 | How can Recipe/AI adaptation remain useful without regaining arbitrary browser/shell authority? | Security, crawler boundary, deterministic fallback | `STATIC_EVIDENCE_SUFFICIENT` | Declarative Recipe schema + finite capability interpreter + deterministic validator; AI returns bounded proposals only. |
| U8 | Where should Evidence, coverage and terminal result derivation live so UI/CLI cannot diverge? | Public semantics/truthfulness | `STATIC_EVIDENCE_SUFFICIENT` | Typed evidence ledger + central result projector in Core Runtime. Surface-specific status derivation is rejected. |
| U9 | Must L2 freeze a particular desktop framework/runtime/IPC transport now? | Packaging/evolution | `STATIC_EVIDENCE_SUFFICIENT` | No. Product authority does not specify an OS/browser/toolchain matrix. Freeze the local authority/IPC/security contracts; choose concrete shell/runtime/IPC later behind those ports. |

`BLOCKED` material UNKNOWNs: **0**.

`ARCHITECTURE_CONTRADICTION`: **none found**. The Frozen Product contract appears architecturally achievable; required executable evidence concerns candidate mechanisms, not Product feasibility.

---

# 6. Candidate patterns and evidence

## 6.1 Runtime / control-plane decomposition

### Pattern A — UI-owned monolith

Desktop UI process owns discovery, transfers, persistence and result derivation; CLI/browser call or duplicate parts of it.

- Advantage: simplest initial executable.
- Failure mode: headless CLI and browser lifecycle become secondary; background downloads depend on UI lifecycle; duplicated status/budget semantics are likely.
- Product conflict risk: one authoritative contract across all surfaces becomes fragile.
- Disposition: **not recommended**.

### Pattern B — shared library embedded independently in Desktop and CLI, Browser writes shared state

- Advantage: code reuse without service lifecycle.
- Failure mode: multiple writers, process/version drift, duplicate scheduling, lock contention, and browser cannot safely become a direct persistence peer.
- Escape hatch: could work for read-only/shared pure domain libraries, but not as authority topology.
- Disposition: **use only for pure libraries; reject as authority topology**.

### Pattern C — local authoritative Core Control Runtime + thin adapters

Candidate topology:

```text
Desktop UI ─┐
CLI ────────┼── Local Command/Query Port ──> Core Control Runtime
Browser ─ Native Messaging/Broker ────────┘          │
                                                     ├─ Contract/Snapshot/Result domain
                                                     ├─ Scheduler + Budget Ledger
                                                     ├─ Discovery/Recipe Runtime
                                                     ├─ Transfer adapters
                                                     ├─ Validation/Media adapters
                                                     ├─ Evidence/Provenance ledger
                                                     └─ Persistence + Artifact Store
```

- Advantages: one mutable authority; CLI and UI can coexist; browser host is not the lifetime owner of downloads; future API/MCP can become another adapter without changing core semantics.
- Failure modes: service lifecycle/IPC versioning and local authentication must be engineered; a crashed authority can pause all work until restart.
- Escape hatch: the Core can initially be launched on demand by Desktop/CLI while retaining the same port boundary; no requirement for a permanent daemon.
- Disposition: **recommended candidate**.

Architecture Evidence:

- Chrome Native Messaging launches/communicates with a registered native host over stdio and restricts allowed extension origins. The transport is explicitly for JSON-style extension/native app communication, making it suitable for control metadata rather than download bytes.
- Mozilla Native Messaging similarly requires explicit `nativeMessaging` permission and an allow-listed extension ID, with stdio JSON messages. It cannot be called directly from content scripts; a background/privileged extension context mediates it.
- These sources support a narrow Browser Adapter/Broker seam and support keeping browser lifecycle separate from the acquisition runtime.

## 6.2 State ownership and durability

### Candidate ownership

Authoritative persistent state should include at least:

```text
Contract
ContractRevision / successor relation
SelectionSnapshot
RequestedMember / ConfirmedMember / SelectedTarget identity
AuthorizationContextRef metadata (not raw secret)
BudgetLedger + reservations/consumption
WorkItem / Attempt / Effect identity
Evidence records
Validation records
Artifact records + digests/provenance
TerminalResult projection inputs
Audit transition log
```

Large downloaded bytes remain on the filesystem/artifact store, not in the transactional database. The database owns **identity and state**, while staged/final file paths and digests bind filesystem effects back to canonical records.

### Persistence alternatives

**JSON/files only**

- Simple bootstrap.
- Weak multi-record atomicity and difficult UI+CLI concurrent mutation/recovery.
- Not recommended for authoritative lifecycle state.

**Embedded SQLite, single-host, single-writer control path**

- Official SQLite documentation provides atomic transactions; WAL supports concurrent readers with a writer on one host, while still allowing only one writer at a time.
- Fits local-first single-machine product and removes an external database service dependency.
- `BEGIN IMMEDIATE`/bounded busy handling can make writer contention explicit rather than implicit.
- WAL is a database state component and cannot be treated as an expendable temp file while open/recovering.
- Candidate: **preferred**, with the Core Runtime serializing authoritative writes.
- Limitation: SQLite guarantees database transaction properties, not xDownload's higher-level filesystem side-effect/idempotency protocol. That is U2 and requires Demo evidence.

**PostgreSQL/client-server database**

- Strong concurrency and future remote topology.
- Adds installation/service/credential/upgrade burden not demanded by the current local product.
- Escape hatch: state repository port and migration versioning should avoid making SQLite-specific SQL the public domain contract, allowing a future server mode to introduce another backend if Product scope changes.
- Not recommended for v0.1.0 local-first baseline.

### Candidate transaction rule

All authoritative lifecycle mutations occur through Core Runtime commands. A command transaction records:

1. command/idempotency identity;
2. precondition/current revision;
3. budget reservation/consumption delta;
4. state transition;
5. outbox/effect intent where an external action must occur;
6. provenance/audit event.

External network/file effects cannot be made atomically identical to a database commit. Therefore the architecture uses **recoverable at-least-once effect execution + idempotent acceptance**, not an unprovable exactly-once claim.

## 6.3 Browser observation / authorization boundary

Trust zones:

```text
Web page / content script      = untrusted input zone
Extension privileged context   = browser capability zone
Native messaging broker        = local secret/capability broker zone
Core Control Runtime           = authoritative task zone
AI provider                    = redacted/untrusted external reasoning dependency
```

Candidate rules:

- page/content-script messages are schema-validated and cannot directly request arbitrary privileged operations;
- extension privileges are minimum necessary and host-scoped/optional where feasible;
- network observation uses browser APIs and records tab/frame/request provenance;
- raw cookies/tokens/passwords are not durable Recipe data and are not ordinary Core/AI payload;
- `AuthorizationContextRef` is an opaque reference to a live/local capability context;
- when transfer requires browser session material, the Broker produces a scoped request capability or scoped ephemeral header/cookie material for the exact target/origin, never a whole-browser cookie dump;
- authorization inability is reported truthfully (`AUTH_REQUIRED`/`AUTH_FAILED`) rather than widening permissions or silently changing requested scope;
- sensitive material is redacted from logs/evidence; provenance records may store secret-free fingerprints/context IDs.

Official Chrome extension guidance explicitly treats content scripts as less trustworthy, recommends validating/sanitizing messages, and recommends limiting permissions. Chrome cookies access additionally requires the `cookies` permission plus matching host permissions, including partition-awareness. These facts support the boundary but do not prove real end-to-end session behavior; U3 remains Demo-required.

## 6.4 Download / media execution boundary

Recommended adapter model:

```text
Acquisition Executor Port
├── DirectHttpAdapter        # S1/S2/S3 where direct single-resource transfer applies
├── HlsVodAdapter            # S4
└── future protocol adapters # deferred Product slices only when authorized

Validation Ports
├── TransferValidator
├── FormatValidator
├── MediaValidator
├── TargetValidator
├── MembershipValidator
└── CoverageValidator
```

Collection discovery is not the transfer engine. It resolves/finalizes the frozen target set, then transfer adapters acquire those targets.

### Direct HTTP resume/retry

HTTP semantics provide byte ranges but servers may ignore `Range`. `If-Range` allows a client to resume only if a strong validator still matches the selected representation.

Candidate rule:

- preserve partial bytes only when representation identity is sufficiently validated;
- use strong validators where available;
- if server ignores range, validator changes, or target identity cannot be proven, restart rather than append incompatible bytes;
- redirect/CDN and signed-locator changes are locator changes, not permission to replace target identity;
- retry remains within the original effect/target identity and remaining Transfer/Global budgets.

### HLS VOD

RFC 8216 defines playlists that enumerate media segments and may reference variants/renditions. This is not equivalent to one opaque file transfer.

Candidate rule:

- parse/freeze selected manifest/rendition identity;
- segment requests are transfer effects and consume `TransferBudget`;
- validate playlist topology against supported S4 limits before download;
- unsupported encryption/track/mux topology fails closed as Product requires;
- media assembly/probe is behind an adapter (an FFmpeg-family tool is a viable implementation option, not Frozen Architecture here);
- final accepted output requires manifest/segment/format/media/target validation as applicable.

FFmpeg's `libavformat` documentation demonstrates a mature protocol/media demux/mux boundary and supports treating media processing as a specialized adapter rather than embedding media semantics in UI or orchestration.

## 6.5 Template / Recipe / AI boundary

Candidate Recipe structure:

```text
RecipeDefinition
├── recipe_id / schema_version
├── applicability_scope
├── matcher
├── parameter schema
├── allowed_capabilities[]
├── extraction rules
├── evidence rules
├── validation requirements
├── failure conditions
└── deterministic fallback
```

Candidate execution:

```text
contract + observation
→ deterministic matcher
→ Recipe capability plan
→ policy/guard validation
→ bounded capability execution
→ typed evidence
→ validation
```

AI fallback:

```text
redacted knowledge gap
+ bounded observations/candidates
+ Recipe schema/capability vocabulary
→ AI proposal
→ schema + policy + scope validator
→ deterministic capability execution OR reject/ask user
```

AI never receives authority to mutate requested scope, emit arbitrary shell, choose arbitrary navigation, persist credentials, or mark validation/coverage complete. Model output is a proposal subject to deterministic checks.

## 6.6 Status / evidence model

Recommended ownership:

- `EvidenceLedger`: immutable/append-oriented typed evidence records with provenance and claim scope.
- `ValidationRecord`: validator result bound to artifact/target/member/snapshot identity.
- `CoverageAccounting`: requested-reference accounting separate from authorization/access and selected/acquired subsets.
- `ResultProjector`: one deterministic domain component computes the six Product result dimensions.

UI and CLI receive the same projection plus explanation facts. Browser integration does not produce terminal result truth.

This design makes Product counterexamples such as “all selected targets succeeded but collection enumeration is unfinished” representable without lying: `SelectionAcquisitionStatus=COMPLETE` can coexist with `RequestFulfillmentStatus=PARTIAL/UNKNOWN` and non-complete coverage.

## 6.7 Concurrency / scheduling / budgets

Candidate scheduler model:

- Core Runtime is the only authoritative scheduler and budget writer.
- Desktop/CLI submit idempotent commands with client request IDs.
- scheduler creates durable work/effect IDs;
- worker concurrency is internal and bounded by per-task/global policies;
- each active generated discovery/transfer/model action obtains an authoritative budget reservation before dispatch;
- completion/retry releases or consumes reservation according to explicit policy;
- cancellation is a durable state transition, not only an in-memory signal;
- duplicate submit is deduplicated by command/contract identity rather than creating another acquisition silently;
- browser reattachment changes observation/session availability but not contract/snapshot identity;
- no separate process directly decrements budget counters in a private store.

Race classes requiring tests downstream:

- two clients submit same contract/command concurrently;
- cancellation races effect dispatch/completion;
- crash after budget reservation before effect dispatch;
- crash after external effect succeeds before durable acceptance;
- restart while partial HTTP/HLS artifact exists;
- browser session expires during transfer;
- collection observation changes while frozen snapshot remains active.

U2 Research Demo must cover the high-impact crash/recovery subset before Architecture Freeze.

## 6.8 Platform / packaging boundary

Architecture-driving facts:

- Browser Integration needs an installable extension plus a browser/native bridge or equivalent local handoff mechanism.
- CLI must work without Desktop UI lifecycle.
- long-running acquisition must not rely on a browser content script staying alive.
- local authority and artifact store must survive process restart.
- browser/native packaging needs platform-specific host registration/manifest installation.

Not yet proven / not frozen:

- Windows/macOS/Linux release matrix;
- Chromium/Firefox release matrix;
- Desktop shell framework;
- Core implementation language/runtime;
- exact local IPC (named pipe, Unix domain socket, loopback transport, framework IPC);
- installer/update mechanism;
- whether Core runs permanently, starts on demand, or uses a hybrid lifecycle.

The candidate therefore freezes **ports and ownership**, not vendor/framework choices. A future choice must satisfy the same trust, authority, restart and packaging invariants.

---

# 7. Decision matrix

| Area | Alternative | Evidence / strengths | Failure modes / trade-offs | Rollback / escape hatch | Candidate |
|---|---|---|---|---|---|
| Authority topology | UI-owned monolith | low initial complexity | CLI/browser lifecycle coupling; divergent semantics | extract Core service later, expensive | NO |
| Authority topology | shared library + multi-process direct state writes | code reuse | multi-writer races; browser trust; version skew | restrict library to pure domain logic | PARTIAL ONLY |
| Authority topology | local authoritative Core Runtime + thin adapters | one contract/status/budget authority; future API/MCP adapter path | IPC/lifecycle complexity | start on-demand; keep ports stable | **YES** |
| Persistence | JSON/files | easy bootstrap | weak transactional multi-record state/recovery | migrate to DB | NO |
| Persistence | SQLite + filesystem + single-writer Core | local, transactional, no external service; official WAL/atomicity evidence | app-level effect crash windows still unknown | repository abstraction; later backend migration | **YES, DEMO-GATED** |
| Persistence | PostgreSQL | powerful server concurrency | deployment/service burden not required by local product | future remote/server backend | DEFER |
| Browser auth | export whole cookie jar to Core/tool | easiest compatibility | excessive secret exposure, stale/partition context | none acceptable | NO |
| Browser auth | scoped extension/native broker + opaque auth refs | least authority, origin binding, local-only secret handling | real browser/session behavior must be proven | fail `AUTH_REQUIRED`; browser-specific adapter | **YES, DEMO-GATED** |
| Browser network | blocking interception as primary mechanism | broad control | MV3 restriction; unnecessary authority | observation-only APIs | NO |
| Browser network | observation + explicit handoff | aligns with Product; available in MV3 | host permission/corpus coverage limits | Recipe/user confirmation | **YES** |
| Transfer | one generic byte downloader for all slices | simple interface | HLS topology/segments/media validation do not fit | protocol adapters | NO |
| Transfer | canonical executor + protocol adapters | shared lifecycle with correct protocol semantics | more adapter contracts | external tools behind adapter | **YES** |
| Recipe | arbitrary JS/browser automation | flexible | crawler/security boundary escape | capability DSL | NO |
| Recipe | declarative capability model | auditable, bounded, testable | requires schema/versioning | extend finite capabilities via ADR | **YES** |
| AI | direct executor | fast prototyping | violates deterministic/security/status authority | convert output to proposal | NO |
| AI | bounded proposal adapter | model optional; deterministic validation | may return more `UNKNOWN`/user action | add validated Recipes | **YES** |
| Result truth | per-surface status derivation | local convenience | semantic divergence | central projector | NO |
| Result truth | canonical evidence + result projector | one truth, explainable | requires careful schema evolution | versioned projection rules | **YES** |

---

# 8. Recommended architecture candidate

## 8.1 Logical components

```text
apps/
  desktop/                 # future shell; presentation adapter only
  cli/                     # command/query adapter
  browser-extension/       # observation + explicit handoff
  native-browser-broker/   # narrow local browser/native trust bridge

core/
  contract-domain/         # AcquisitionContract, snapshots, identities
  result-domain/           # statuses, stop reasons, legal combinations
  evidence-domain/         # typed evidence/provenance
  scheduler/               # durable work/effect lifecycle + budgets
  discovery/               # bounded discovery orchestration
  recipe-runtime/          # declarative capability interpreter
  ai-adapter/              # bounded proposal interface
  acquisition-runtime/     # selected-target execution orchestration
  validation/              # target/transfer/format/media/membership/coverage

adapters/
  persistence-sqlite/      # candidate; gated by U2 Demo
  artifact-filesystem/
  http-direct/
  hls-media/
  browser-auth/
  model-provider/          # provider-specific, optional

contracts/
  local-command-query/
  recipe-schema/
  evidence-schema/
  persistence-migrations/
```

This is a responsibility map, not an instruction to create empty modules mechanically. Exact repository layout/language remains future implementation detail until Architecture Freeze/Task definition.

## 8.2 Command/query ownership

External adapters use a versioned local command/query contract such as:

```text
Commands:
  ProposeAcquisition
  ConfirmContract
  ConfirmSelection
  SubmitObservation
  StartAcquisition
  Pause / Resume
  Cancel
  RetryFailed
  AcceptTargetChange -> successor contract path only

Queries/subscriptions:
  GetContract
  GetSnapshot
  GetProgress
  GetResultProjection
  GetEvidenceExplanation
```

The browser does not receive a generic “run arbitrary action” command. Privileged browser operations use typed capability requests bound to contract/snapshot/tab/origin provenance.

## 8.3 Durable state machine shape

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

The Product's six terminal result dimensions remain the output contract; internal workflow state does not replace them.

Retries/restarts re-enter from durable state/effect records without changing contract/snapshot identity or resetting budgets.

## 8.4 Artifact commit protocol candidate

For each selected target:

1. durable effect/reservation identity created;
2. bytes written to task/member staging path;
3. transfer evidence and validators recorded;
4. required format/media/target validation runs;
5. accepted artifact digest/metadata recorded;
6. staged artifact promoted to final logical output using a recoverable file protocol;
7. durable accepted-artifact record and result projection updated.

Cross-resource exactly-once filesystem+DB atomicity is **not claimed**. Restart reconciliation uses effect IDs, stage/final path state, digests and accepted-artifact records. U2 Demo must prove the minimum crash windows needed to adopt this candidate.

---

# 9. Key ADR candidates

These are proposed ADR topics for later Architecture Freeze; they are not yet Frozen decisions.

- **ADR-001:** Local authoritative Core Control Runtime; surfaces are adapters.
- **ADR-002:** Contract/Snapshot/Result schema owned by pure domain layer and versioned independently of UI.
- **ADR-003:** SQLite as local authoritative metadata/state store, with serialized writer ownership; adoption gated by Research Demo U2.
- **ADR-004:** Filesystem artifact store separated from transactional metadata; recoverable staging/finalization protocol.
- **ADR-005:** Browser extension + native broker trust boundary with opaque `AuthorizationContextRef`; adoption gated by Research Demo U3.
- **ADR-006:** Protocol adapter architecture: direct HTTP and HLS/media are separate execution adapters under one acquisition port.
- **ADR-007:** Declarative Recipe capability interpreter; no arbitrary script/shell/navigation capability.
- **ADR-008:** AI is a bounded proposal adapter; deterministic policy/validation remains authoritative.
- **ADR-009:** Typed Evidence Ledger + canonical Result Projector own terminal truth.
- **ADR-010:** At-least-once recoverable external effects + idempotent acceptance; no exactly-once claim.
- **ADR-011:** Stable target identity separated from mutable access locator/authorization context.
- **ADR-012:** Exact Desktop framework/runtime/IPC and release platform matrix remain replaceable implementation choices until specific evidence/authority requires freezing them.

---

# 10. Data ownership / trust boundaries / synchronization model

| Data / authority | Canonical owner | Readers/producers | Synchronization rule |
|---|---|---|---|
| AcquisitionContract | Core Contract Domain + authoritative store | Desktop/CLI submit intent; Browser may supply observations | optimistic revision/idempotency check; successor identity for semantic change |
| SelectionSnapshot | Core Contract Domain | UI confirmation; discovery supplies evidence | immutable after confirmation |
| Requested/confirmed/selected identities | Core Contract Domain | Discovery/Recipe/Browser evidence | identity-based, never count-only |
| Budgets | Core Scheduler/Budget Ledger | all effect dispatchers consume via Core | transactional reservation/consumption; no private counters |
| Browser observations | Evidence Ledger | extension privileged context | append/provenance-bound; never direct authority mutation |
| Raw session secrets | Browser/Broker ephemeral secret zone | only scoped transfer/broker path | no ordinary persistence/AI/log export |
| AuthorizationContextRef | Core metadata | Browser/Broker issues/validates | opaque, revocable/expiring, provenance-bound |
| Transfer progress | Acquisition Runtime + store | protocol adapters | durable checkpoints only where safe; partial bytes separately staged |
| Evidence | Evidence Ledger | discovery, transfer, validators, user confirmation | append-oriented with claim subject/source |
| Final statuses | Result Projector | all surfaces | derived from canonical state/evidence only |
| Artifact bytes | Filesystem artifact store | transfer/validation | staged then accepted; digest/provenance bind to DB identity |
| Recipes | versioned Recipe store | matcher/AI proposal/promotion flow | schema validation + applicability/failure metadata; no embedded credentials |

Local adapters may cache read projections but caches are non-authoritative and disposable.

---

# 11. Failure, restart, retry, idempotency and consistency semantics

## 11.1 Core principles

- database commit success does not imply external network/file effect success;
- external effect success observed before crash does not imply durable acceptance;
- restart reconciliation must classify each effect as `NOT_DISPATCHED`, `IN_FLIGHT_UNKNOWN`, `PARTIAL_RECOVERABLE`, `SUCCEEDED_UNACCEPTED`, `ACCEPTED`, or terminal failure equivalent;
- uncertain effects are not silently counted twice or marked complete;
- retry reuses the same target/effect lineage and remaining lifecycle budgets;
- successor contract/snapshot is required for semantic target/scope change.

## 11.2 Network failure

Transient network failure may retry within policy/budgets. Retry does not change target identity. Signed/expiring locator refresh must prove same target; otherwise `TARGET_CHANGED`/`AUTH_REQUIRED`/failure path applies.

## 11.3 Crash after budget reservation before dispatch

On recovery, reconcile reservation with effect dispatch marker. A reservation may be released/reused only according to deterministic ledger rules; restart cannot mint a fresh budget.

## 11.4 Crash after bytes written before acceptance

Partial/staged artifact remains non-accepted. Recovery validates effect identity, target validators, current staged bytes/digest and safe resume conditions. Otherwise restart download within remaining budget.

## 11.5 Crash after external success before durable accepted record

Reconcile staging/final artifact via stable effect ID + digest/provenance. Do not blindly re-download and do not assume success solely from file existence/name.

## 11.6 Concurrent clients

Desktop and CLI may issue commands concurrently; authoritative state transitions are serialized/validated at Core. Duplicate client requests use idempotency keys/revision checks. Browser observations are append evidence and cannot override a frozen snapshot.

## 11.7 Cancellation

Cancellation writes durable intent and stops new dispatch. Already in-flight effects are reconciled truthfully; cancellation cannot rewrite a completed/validated artifact into a different target or create vacuous success.

---

# 12. Security / auth / secret boundary

Threat-relevant seams requiring independent review later:

1. page/content-script → extension privileged context;
2. extension → native messaging broker;
3. broker → Core/transfer adapter;
4. Core → external model provider;
5. Recipe → capability interpreter;
6. local IPC client → Core authority;
7. logs/evidence → persistent storage.

Candidate controls:

- explicit schema and size bounds for all browser/native/IPC messages;
- allow-listed extension identity/native host registration;
- least host/API permissions and optional permissions where feasible;
- tab/frame/origin/request provenance for browser observations;
- per-command contract/snapshot binding for privileged actions;
- secret redaction at logging boundary;
- no raw secret in Recipe, model prompt, reusable Knowledge, or generic Evidence payload;
- sensitive auth material held in-memory/local broker when possible and discarded on expiry/task completion;
- local IPC must authenticate same-install/same-user peer sufficiently to prevent arbitrary local web content from submitting privileged commands;
- Recipe capability interpreter denies unknown capabilities and arbitrary URLs/frontier navigation by default;
- AI output is data, never executable code/authority.

U3 Demo is required before adopting the browser auth bridge as Frozen Architecture.

---

# 13. Observability / provenance model

Every meaningful state/effect should expose a durable correlation chain:

```text
contract_id
snapshot_id
requested_member_id / selected_target_id
effect_id + attempt_id
recipe_id/version? / browser observation id?
authorization_context_ref (secret-free)
budget reservation/consumption record
evidence ids
validation ids
artifact id/digest
terminal result explanation
```

Recommended event classes:

- contract/snapshot lifecycle;
- scope/continuation decision;
- discovery candidate + provenance;
- membership/selection claim;
- browser observation provenance;
- auth-context acquire/expire/reject without secret payload;
- budget reserve/consume/release/exhaust;
- effect dispatch/retry/cancel/reconcile;
- transfer validator data (status/range/length/validator);
- format/media/target/membership/coverage validation;
- Recipe match/failure/fallback;
- AI proposal accepted/rejected reason;
- artifact staged/validated/accepted/reconciled;
- final result projection and explanation.

Logs alone are not authority. Canonical evidence/state records must be queryable for UI/CLI explanation and later Validation.

---

# 14. Migration / bootstrap plan from docs-only repository

No production code exists, so migration is staged bootstrap rather than refactor.

1. **Freeze-after-evidence only:** complete Research Demos U2/U3 and independent Architecture Review before L2 Freeze.
2. **Contract-first bootstrap:** create versioned Product-domain schemas/types for AcquisitionContract, SelectionSnapshot, identities, budgets, Evidence and result dimensions with Product counterexamples as contract fixtures.
3. **Core pure domain:** implement deterministic status/result/coverage rules independent of UI/network/database.
4. **Persistence + scheduler foundation:** implement selected authoritative store/effect ledger and recovery semantics using Research Demo conclusions.
5. **Local command/query seam:** expose adapter-neutral command/query port; add CLI first as a low-UI proof of shared authority.
6. **Direct acquisition slice:** S1 direct HTTP + validation + retry/resume semantics.
7. **Browser seam:** implement extension/native broker according to U3 evidence; add S2 and browser observation paths.
8. **Media/HLS adapter:** S3/S4 with specialized media validation.
9. **Collection discovery + Recipe runtime:** S5/S6 bounded membership/continuation with capability enforcement.
10. **Desktop shell:** consume the same command/query/result contracts; UI remains non-authoritative.
11. **Bounded AI adapter:** add only after deterministic/template path and Recipe validation boundary are executable; model-offline behavior must remain intact.
12. **Packaging/platform qualification:** choose and validate concrete supported platform matrix, installer/browser registration and real-host behavior downstream; do not backfill untested platform claims into L2.

This order is a migration/architecture dependency outline, **not a Task DAG**.

---

# 15. Architecture risks / open questions

- **R-A1 — crash window correctness:** DB + filesystem + network effects cannot be one atomic transaction. U2 must establish a recoverable protocol before Freeze.
- **R-A2 — browser auth leakage:** exporting a whole browser cookie jar would violate least-authority intent. U3 must prove a scoped broker path.
- **R-A3 — browser API differences:** Chrome/Firefox native-host manifest and extension behavior differ. The architecture must keep vendor-specific registration/adapters outside Core.
- **R-A4 — signed/short-lived locators:** locator refresh can accidentally become target substitution; evidence binding must be explicit.
- **R-A5 — HLS topology breadth:** Frozen S4 is intentionally basic; adapter must fail closed for unsupported encryption/multitrack/mux cases rather than expanding scope.
- **R-A6 — Recipe language creep:** adding arbitrary script/DOM execution would recreate a general web agent/crawler boundary. Capability additions require explicit security/architecture review.
- **R-A7 — evidence growth:** append-oriented provenance may grow quickly for segments/collections. Implementations may aggregate low-level events, but must retain enough identity/evidence for Product truth and audit.
- **R-A8 — SQLite busy/checkpoint behavior:** long readers or direct multi-process writes can degrade operation. Candidate avoids this by single-writer Core and short read transactions; U2 must test realistic contention/restart.
- **R-A9 — local IPC abuse:** browser/native/CLI adapters are privileged local clients. Concrete transport must include peer authorization and input bounds.
- **R-A10 — platform promise gap:** release platform/browser matrix remains outside current Product Freeze. Downstream planning must not claim cross-platform support until explicitly selected and validated.

---

# 16. Explicit Architecture Contradictions

**NONE identified.**

No evidence currently indicates that Frozen Product requirements are mutually contradictory or unachievable. The two executable UNKNOWNs concern how to implement durability and browser authorization safely; their failure should change the candidate architecture, not reopen Product scope unless a future Demo establishes a genuine Product contradiction.

---

# 17. Research Demo disposition

Two dedicated Research Demo Issues are required by ADS because the UNKNOWNs affect durability/security/failure semantics and static evidence is insufficient.

At this initial candidate checkpoint the Issue numbers are `PENDING_CREATION`; they will be inserted after dedicated Issues are created against this architecture-evidence baseline.

## RD-U2 — Durable ledger + filesystem crash/restart/idempotency

Required Evidence Strength: **E3**.

Hypothesis summary:

> With a real local SQLite store, real filesystem staging/finalization, two independent local clients and real process termination/restart, the candidate single-writer ledger can recover every tested crash window without silently changing `SelectionSnapshot`, replenishing/duplicating lifecycle budgets, or accepting more than one artifact/effect for the same frozen target identity.

Must test real SQLite, real OS process death/restart and real filesystem. Network/model can be deterministic local fakes because network/provider behavior is not the UNKNOWN.

## RD-U3 — Browser observation/auth broker least-authority seam

Required Evidence Strength: **E3**.

Hypothesis summary:

> With a real supported reference browser extension, real native messaging host and controlled authenticated origin, xDownload can bind current-page/network observations and a scoped authorization capability to the intended tab/origin/contract, successfully acquire an authorized test resource, reject unbound/cross-origin misuse, and keep raw session secret values out of Core durable state, logs, Recipe data and model-facing payloads.

Must use a real browser extension/native host/session; controlled web origin may be a deterministic local test server. This Demo proves a reference-browser seam, not a complete browser/OS support matrix.

---

# 18. Task DAG lane hints — candidate only, no DAG generated

These hints describe maximum-safe-parallelism boundaries **after** L2 Freeze. They are not Task DAG authority.

| Candidate lane | Stable inputs needed | Ownership / likely write set | Real serial dependencies | Convergence point |
|---|---|---|---|---|
| L-A Contract & result semantics | Frozen PRD + Frozen L2 schemas | canonical contracts/result/evidence types + contract fixtures | first foundation | shared domain package/contracts |
| L-B Persistence/recovery | Frozen schemas + RD-U2 result | store/migrations/effect ledger/recovery | depends on L-A and Demo U2 | Core Runtime integration |
| L-C Direct HTTP acquisition | Frozen acquisition/evidence ports | direct HTTP adapter + transfer validation | depends on L-A ports; can parallel B if persistence port is stable | Core Runtime integration |
| L-D Browser bridge/auth | Frozen browser/auth ports + RD-U3 result | extension/native broker/browser adapter | depends on L-A and Demo U3; independent of media implementation | browser integration convergence |
| L-E Recipe/discovery runtime | Frozen capability schema | matcher/interpreter/bounded discovery | depends on L-A capability/contracts | collection integration |
| L-F HLS/media | Frozen acquisition/validation ports | HLS/media adapter/validators | depends on L-A ports; can parallel C/D/E | media integration |
| L-G Scheduler/budgets | Frozen contracts + recovery model | scheduler/budget ledger/cancellation | depends on L-A; recovery mechanics converge with B | Core Runtime integration |
| L-H CLI adapter | local command/query contract | CLI only | after minimal command/query port | early end-to-end integration |
| L-I Desktop UI | local command/query/result contracts | Desktop presentation | can start after contracts stable; should not block core | UX integration |
| L-J AI adapter | Recipe capability contract + deterministic runtime | provider adapter/redaction/proposal validation | after E is stable; does not block ordinary paths | optional AI integration |
| L-K Validation corpora/harness | Frozen Product counterexamples + Frozen L2 | contract/integration/CJ fixtures | can begin alongside implementation once interfaces frozen | version validation |
| L-L Packaging/platform | selected implementation/toolchain | installer/native-host registration/platform packaging | after concrete runtime/shell exists | release candidate |

Candidate serial spine:

```text
Frozen L2 contracts
→ authoritative persistence/recovery + scheduler semantics
→ integrated Core Runtime
→ surface/protocol convergence
→ platform packaging/real-host validation
```

Safe parallelism exists around adapters and validators once shared contracts are stable. Do not create pseudo-parallel lanes that concurrently redefine the same contract/result/evidence schemas.

---

# 19. Evidence table

Research date/access date unless otherwise stated: `2026-10-02`.

| Source | Type / authority | Date/version relevance | Claim supported |
|---|---|---|---|
| Frozen PRD `docs/product/PRD-v0.4.2-review-candidate.md@65be7aae...` | Frozen Product authority | 2026-10-02 | authoritative contract/snapshot/budget/result/security/S1–S6 semantics |
| Stage 1 Freeze `docs/planning/STAGE1_PRODUCT_SCOPE_FREEZE.md` | project lifecycle authority | `version/v0.1.0` baseline | Product frozen; Architecture not frozen |
| ADS `prompts/L2_ARCHITECTURE_EVIDENCE.md@94cad2b...` | pinned process authority | v4.0.0 | L2 requirements, UNKNOWN disposition, lane hints |
| ADS `standards/ARCHITECTURE_RESEARCH_DEMO_STANDARD.md@94cad2b...` | pinned process authority | v4.0.0 | Demo trigger, E1/E2/E3, real boundary/failure evidence |
| SQLite — Write-Ahead Logging: https://www.sqlite.org/wal.html | official primary docs | current page; WAL available since SQLite 3.7.0 | same-host WAL; readers/writer concurrency; one writer; checkpoints; WAL persistent-state considerations |
| SQLite — Transactions: https://www.sqlite.org/lang_transaction.html | official primary docs | current page | multiple readers but one simultaneous writer; `SQLITE_BUSY`; transaction semantics |
| SQLite — Atomic Commit: https://www.sqlite.org/atomiccommit.html | official primary docs | current page | atomic DB transaction/crash robustness, while not proving xDownload filesystem/effect protocol |
| Chrome — Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging | official browser docs | current MV3-era docs | registered native host, allow-listed extension origin, stdio messaging; narrow browser/native seam |
| Chrome — webRequest API: https://developer.chrome.com/docs/extensions/reference/api/webRequest | official browser docs | current MV3-era docs | normal request observation remains available; blocking permission restricted; host permissions required |
| Chrome — cookies API: https://developer.chrome.com/docs/extensions/reference/api/cookies | official browser docs | current; includes partitioned cookies | cookie access requires `cookies` + host permissions; partition context matters |
| Chrome — extension messaging security: https://developer.chrome.com/docs/extensions/develop/concepts/messaging | official browser docs | current | content scripts are less trustworthy; validate/sanitize and limit privileged actions |
| Chrome — permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions | official browser docs | current | optional/host permissions and least-permission rationale |
| Mozilla MDN — Native messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging | official WebExtension platform docs | current | explicit `nativeMessaging`, allowed extension IDs, background-mediated native messaging, cross-browser differences |
| RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html | IETF/RFC primary standard | RFC 9110 (2022) | Range may be ignored; `If-Range` validator semantics; safe resume requires representation validation |
| RFC 8216 — HTTP Live Streaming: https://www.rfc-editor.org/rfc/rfc8216 | IETF/RFC primary standard | RFC 8216 (2017) | playlist/segment/rendition model supporting protocol-specific HLS boundary |
| FFmpeg Formats Documentation: https://ffmpeg.org/ffmpeg-formats.html | mature primary project docs | current docs | mature demux/mux/media adapter pattern; media processing has format-specific options/validation concerns |
| yt-dlp FAQ: https://github.com/yt-dlp/yt-dlp/wiki/FAQ | mature open-source implementation evidence | current repository wiki | browser-cookie acquisition is operationally possible but cookie export can expose broad sensitive state; supports scoped broker preference rather than whole-cookie persistence |

No source above is treated as proof that xDownload's own crash/auth design works. That distinction is why U2 and U3 require executable Research Demos.

---

# 20. What is NOT proven

This Stage 2 candidate does **not** prove:

- any production code exists;
- SQLite + filesystem recovery satisfies xDownload's application-level idempotency/budget invariants — U2 Demo pending;
- browser authorization/session handoff satisfies the least-authority design in a real browser — U3 Demo pending;
- a specific Desktop framework, runtime/language, IPC transport, installer, updater, or package format is suitable;
- Windows, macOS, Linux, Chromium, Firefox or any specific matrix is supported/release-ready;
- HLS works for arbitrary encryption, DRM, separate A/V, multi-audio/subtitle or complex topology outside Frozen S4;
- HTTP resume works when origin/CDN lacks compatible Range/validator behavior;
- any model/provider produces reliable Recipe adaptations;
- any specific concurrency/performance/throughput target;
- security hardening, penetration resistance or secret-store implementation beyond the candidate boundary;
- Product G0/G1/G2/G3 gates, Critical Journeys, Hidden Validation, package validation or Release Qualification;
- Architecture Freeze or Task DAG readiness.

---

# 21. Stage 2 candidate disposition

Current disposition: **`DEMO_REQUIRED`**.

Reason:

- material UNKNOWNs identified: `9`;
- `STATIC_EVIDENCE_SUFFICIENT`: `7`;
- `EXECUTABLE_DEMO_REQUIRED`: `2`;
- `BLOCKED`: `0`;
- `ARCHITECTURE_CONTRADICTION`: `0`;
- required Research Demo Issues: `PENDING_CREATION` at this initial checkpoint.

After the two Demo Issues are created, this document must be updated only to bind their Issue numbers/baseline references. The Demos themselves are separate tasks and MUST NOT be executed in this L2 Builder session.

Architecture Freeze remains `NO`. Task DAG and implementation remain `NOT STARTED`.
