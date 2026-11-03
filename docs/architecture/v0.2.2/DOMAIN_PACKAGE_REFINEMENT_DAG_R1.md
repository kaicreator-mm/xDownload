# xDownload v0.2.2 — Domain Package Refinement DAG R1

> Parent: [#337](https://github.com/kaicreator-mm/xDownload/issues/337)  
> Plan: [DOMAIN_PACKAGE_REFINEMENT_IMPLEMENTATION_PLAN_R1.md](./DOMAIN_PACKAGE_REFINEMENT_IMPLEMENTATION_PLAN_R1.md)  
> Planning PR: [#336](https://github.com/kaicreator-mm/xDownload/pull/336)  
> Source audit baseline: \`wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334\`

## 1. DAG

\`\`\`mermaid
flowchart TD
    A00["A00 — Architecture Inventory & Authority Audit<br/>READ_ONLY"]
    A01["A01 — Domain Contracts & Dependency Decoupling"]
    A02["A02 — Domain App Refactoring"]
    A03["A03 — Domain Host Refactoring"]
    A04["A04 — Core Runtime Consolidation"]
    A05["A05 — Domain Knowledge & Workflow Mapping"]
    A06["A06 — Architecture Integration & Verification"]
    A07["A07 — Final Exact-SHA Review & Closure"]

    A00 --> A01
    A00 --> A05
    A01 --> A02
    A01 --> A03
    A02 --> A04
    A03 --> A04
    A04 --> A06
    A05 --> A06
    A06 --> A07
\`\`\`

## 2. Task matrix

| ID | Task | Depends on | Candidate exclusive write set | Execution mode |
|---|---|---|---|---|
| A00 | Architecture Inventory & Authority Audit | — | Read-only source; one audit report file | Web-first, read-only |
| A01 | Domain Contracts & Dependency Decoupling | A00 | \`packages/domain-contracts/**\`; explicitly listed App contract re-export files | Source implementation |
| A02 | Domain App Refactoring | A01 | \`packages/download-domain-app/**\`, excluding A01-owned contract files | Source implementation |
| A03 | Domain Host Refactoring | A01 | \`packages/download-domain-host/**\` | Source implementation |
| A04 | Core Runtime Consolidation | A02, A03 | \`packages/core-runtime/**\` and only explicitly listed consumer adapters | Single integration writer |
| A05 | Domain Knowledge & Workflow Mapping | A00 | \`docs/architecture/v0.2.2/domain-package/**\` | Documentation |
| A06 | Architecture Integration & Verification | A04, A05 | Dedicated architecture tests and validation evidence; exact paths frozen in its Task Pack | Verification |
| A07 | Final Exact-SHA Review & Closure | A06 | Read-only | Independent review |

## 3. Parallel lanes

### Lane 1 — Audit

A00 is the first gate. It has no source write permission. Its output must settle:
- App / Host / Contracts import graph;
- actual production composition roots and call sites;
- RouteLog CLAIM / ATTEMPT / OUTCOME semantics;
- K Effect Journal / Permit vs Core Seam Journal;
- whether T09 LineageLedger has an active production caller;
- physical store placement and recovery guarantees;
- exact source paths for the downstream Task Packs.

### Lane 2 — Neutral contracts and domain knowledge

After A00:
- A01 extracts only genuinely shared App/Host contracts.
- A05 documents glossary, authority, Workflow and Function/Tool boundaries.

A01 and A05 have disjoint write sets and may proceed in parallel.

### Lane 3 — App and Host

After A01:
- A02 removes App → Host imports and narrows the Domain App public API.
- A03 removes Host → App deep imports and implements neutral ports.

A02 and A03 may proceed in parallel. They must not edit each other's package roots, manifests, or owned contract files.

### Lane 4 — Core composition

A04 starts only after A02 and A03 are individually complete and their exact SHAs are read back. It is the sole writer for Core Runtime integration.

A04 must retain one production K and the current route-ownership semantics unless an explicitly reviewed migration decision says otherwise.

### Lane 5 — Verification and closure

A06 runs after A04 and A05. A07 independently reviews the final exact integration SHA and evidence.

## 4. Dispatch and merge gates

- A DAG edge is a dependency requirement, not an execution Claim.
- Every source Task needs its own Task Pack, exact current base, allowed write set, accepted ADS dispatch/Claim and JIT branch.
- Do not dispatch A02/A03 before A01's neutral contracts are frozen.
- Do not dispatch A04 before both A02 and A03 are complete.
- A05 may not rewrite source contracts or widen Product/L2.
- Do not merge any source Task to the WIP branch on a stale base.
- The current WIP SHA must be re-read before integration; re-run required checks on the actual integration SHA.
- \`main\`, \`version/v0.2.1\`, tags and release branches are out of scope.

## 5. Current state

| Task | State | Notes |
|---|---|---|
| A00 | Read-only audit complete; independent review pending | #338; report committed; no source mutation |
| A01 | Neutral-contract Task Pack narrowed; review pending; not dispatched | #335 |
| A02 | Not dispatched | Await A01 |
| A03 | Not dispatched | Await A01 |
| A04 | Not dispatched | Await A02 + A03 |
| A05 | Six documentation drafts committed; independent review pending | #339; docs-only; no source changes |
| A06 | Not dispatched | Await A04 + A05 |
| A07 | Not dispatched | Independent final review |

## 6. Separation from UI DAG

This architecture DAG is an adjacent engineering lane under the v0.2.2 successor. It does not renumber or replace the Owner-approved U00–U06 UI responsibility map in \`UI_TASK_DAG_R0.md\`.

The UI lane may continue in parallel. Before merging either lane, verify exact write-set disjointness and rebind each Task to the current WIP HEAD.
