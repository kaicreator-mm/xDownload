# T009 L3 Reference Pack — HLS VOD media adapter

Task: `T009` / Issue `#28`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select an HLS parser library or media tool and does not redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

Build deterministic synthetic HLS fixtures (small master/media playlists, short segments, deliberately truncated/missing/encrypted variants) so every suite in `TEST_MATRIX.yaml` has stable oracle identity without network access.

**Patterns to emulate:**

- `test.each` / table-driven cases for supported vs unsupported topology variants;
- decode tests from `unknown` playlist text/bytes, not only construction from already typed objects;
- fixture pairs proving both sides of locator rules: provenance-bound transition preserves identity; unrelated substitution rejects;
- budget-ledger-stub driven tests proving segment requests debit `TransferBudget` and never `DiscoveryBudget`;
- truncation/missing-segment mutation of a valid fixture proving non-acceptance;
- one fixture/oracle mapping for each applicable Product counterexample (C09, C15, C18, C22, C26, C27, C28, C29).

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`.

License fact: `vitest@4.1.11` is MIT-licensed at tag `v4.1.11`. It is already selected by T001; T009 does not introduce it.

### 1.2 Determinism rule for media tooling

If the assembly/probe port invokes external tooling in tests, the tool output consumed by assertions must be deterministic on the fixed fixtures. Prefer asserting typed validation evidence over raw tool stdout. Where exact tool determinism cannot be guaranteed, assert fail-closed classification rather than byte-exact output.

## 2. Contract / interface references

### 2.1 In-repo canonical contracts (primary)

`packages/domain-contracts` (`@xdownload/domain-contracts`), produced by the merged T002 PR, is the exact-base contract authority surface: `ids`, `scope`, `budget`, `evidence`, `contract`, `snapshot`, `result`, `slices` (`S4` = "HLS VOD Basic" in `SUPPORT_SLICE_IDS`), `ports` (`DomainGateway`, `TerminalResultProjection`), `decode`, `diagnostics`, `version`.

T009 binds against these exports; do not fork or re-declare competing vocabulary. If a required canonical concept is genuinely absent, stop and classify (`TASK_PACK_DEFECT`/`ARCHITECTURE_CONTRADICTION`) rather than inventing a parallel truth.

### 2.2 RFC 8216 — HTTP Live Streaming, 2nd edition

Per the frozen L2 standards table, RFC 8216 is the primary protocol standard for HLS playlist/segment/rendition structure. Use it as the parsing/validation reference for: master vs media playlists, variant/rendition attributes, media segment and playlist tags, discontinuity/encryption declarations, and version declarations.

Primary reference: `https://datatracker.ietf.org/doc/html/rfc8216`.

Use as design/protocol reference only; do not copy spec text into product source.

### 2.3 TypeScript discriminated unions for topology classification

Exact compiler on the base: `typescript@5.9.3` (strict, `noUncheckedIndexedAccess`). Model closed variant sets — playlist kinds, segment states, supported/unsupported topology reasons, validation verdicts — as exhaustively handled discriminants, while never treating static types as runtime validation of untrusted playlist bytes.

Primary references:

- TypeScript Handbook narrowing/discriminated unions: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions`
- exact source tag: `https://github.com/microsoft/TypeScript/tree/v5.9.3`

License fact: Apache-2.0 at tag `v5.9.3`; already selected by T001; T009 does not introduce it.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Parse, then bind, then plan, then validate

Recommended flow:

```text
unknown playlist bytes
→ structural/version decode
→ master/media playlist candidate
→ rendition binding to frozen logical target (immutable)
→ provenance-bound segment plan (locators descend from manifest only)
→ segment effects under TransferBudget semantics
→ assembly/probe via tooling port
→ typed manifest/segment/format/media/target validation evidence
→ canonical records (never local success verdicts)
```

### 3.2 Binding immutability and successor identity

Once the rendition binding is made for a frozen logical target, treat it like the T002 snapshot discipline: immutable for retry/resume; any substitution (different rendition, re-resolved manifest of a different identity) is a successor-identity event. This mirrors L2 invariant 4 and the T002 successor contract rule.

### 3.3 Budget accounting as a constraint lens

Segment/manifest requests are transfer effects: each debits `TransferBudget` through canonical budget semantics. C28 is the key tuple: DiscoveryBudget exhaustion does not touch the frozen-target transfer decision while Transfer/GlobalSafety budget remain; exhaustion stops work truthfully and retry inherits the remaining budget.

### 3.4 Fail-closed topology gate

Classify topology before transfer: encryption/key declarations, track/mux expectations, and post-processing needs are detected from the parsed playlist/rendition data and must gate admission. Anything outside basic S4 (non-DRM, simple topology) exits as truthful `UNSUPPORTED/FAILED` through the canonical result vocabulary before any byte transfer pretends correctness.

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Unknown/malformed playlist input

- unsupported playlist version or unknown authoritative tags → typed rejection;
- malformed required fields/duplicate segment identities → reject before binding or segment planning;
- never reinterpret unknown tags into "probably fine" transfer behavior.

### Missing/truncated/failed segments

- keep the effect lineage truthful: failed segment forbids acceptance;
- retry only within the frozen binding/segment plan with inherited budget;
- never normalize into a smaller-but-complete media claim.

### Unsupported topology

- reject as `UNSUPPORTED/FAILED`; no decryption attempt, no bypass, no silent generic transfer;
- record diagnostic facts without secrets.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T009 acceptance

| Acceptance concern | Reference pattern | Required T009 proof |
| --- | --- | --- |
| Master/media playlist selection | RFC 8216 playlist model + decode-first flow | binding success + malformed/unsupported-version rejection |
| Rendition provenance | L2 invariant 4 / T002 successor rules | immutable binding; provenance-bound locators only |
| Segment budget accounting | PRD §15 + C28 | segment requests debit TransferBudget; discovery budget never substitutes |
| Assembly/probe validation | L2 HLS VOD rules + tooling port | typed validation evidence before acceptance; count equality insufficient |
| Missing segment/truncation | failure-handling patterns | truthful failure on lineage; no false accept |
| Unsupported topology | PRD S4 + L2 A6 + C15 | fail-closed `UNSUPPORTED/FAILED`, no opaque-byte fallback |
| Canonical records | L2 invariant 17 + T002 vocabulary | no adapter-local success semantics |
| C09/C18/C22/C26/C27/C29 oracles | `TEST_MATRIX.yaml` | fixture/oracle mapping per counterexample |

## 6. Dependency/version/license facts

### Already pinned and recommended for T009 use

| Package | Exact version on bound base | License | T009 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | strict adapter/topology modeling |
| `vitest` | `4.1.11` | MIT | executable manifest/segment/media/negative tests |

Sources: root `package.json` on exact base; upstream exact-tag license files.

### New runtime dependency or external media tool

**None is recommended or pinned by this Reference Pack.** The exact base has no runtime dependencies. Under `F1_BOUNDED_IMPLEMENTATION` the Builder may implement bounded deterministic parsing in-repo, add a narrowly justified parser dependency, and/or invoke an external assembly/probe tool strictly behind the replaceable port. Any such choice must record exact name/version/license/provenance, must remain deterministic in tests, and must not become de facto Product/Architecture authority. Note that common media tooling suites carry LGPL/GPL-family licensing; record the exact build/license before introduction.

## 7. Do / Don't

### Do

- parse and validate playlists before any segment request;
- keep manifest/rendition binding immutable with successor identity for substitution;
- derive all segment/CDN locators from the selected manifest provenance;
- debit segment transfer through canonical `TransferBudget` semantics;
- fail closed on unsupported encryption/track/mux/post-processing topology;
- emit canonical effect/evidence/validation records only;
- use deterministic synthetic fixtures for all negative cases.

### Don't

- don't treat an HLS topology as one opaque file transfer;
- don't attempt decryption/DRM bypass;
- don't promise DASH/multi-audio/subtitle/separate A/V/mux support;
- don't accept media from segment counts, byte totals or budget exhaustion;
- don't let the media tool become architecture or project local success verdicts;
- don't store signed-URL secrets or key material as ordinary state;
- don't add a parser/tool dependency solely because it is popular;
- don't copy spec text or substantial external source into this repository.

## 8. Reuse / license risk

Risk is low if RFC 8216 and tooling docs are used as design/protocol reference only. Do not copy spec text, sample playlists with unclear provenance, or substantial external parser/tool source into T009. If a dependency or external tool is introduced, consume it under its own license and record exact provenance/version/license in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T009. The later Builder produces an exact candidate; T009 concern Validation must execute the manifest/segment/media/oracle matrix on that exact candidate; Fresh Independent Review is separately required because the task is `risk:high` and `review:required`.
