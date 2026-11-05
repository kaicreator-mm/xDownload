# xDownload Domain Glossary

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00: #338 · A05: #339

| Term | Meaning | Boundary / caution |
|---|---|---|
| Domain App | DomainHarness-built application package containing K/S/B/C declarations, Business Intents, schemas, domain rules and Workflow definitions | Not the physical Host runtime or production composition root |
| Business Intent | Explicit user-confirmed business request, currently including confirmDownload | Not an Agent Tool or raw Host call |
| K | DomainHarness Kernel that governs admission, workflow execution and external effects | One production K; no surface-local K |
| S | DomainHarness state/schema declaration surface used by the selected application | Not a separate runtime or database |
| B | Business package defining business policy and Workflow behavior | Does not own physical effects or Journal |
| C Operation | Declared capability operation invoked by K under its effect governance | Not synonymous with Agent Tool |
| Host | Trusted implementation environment for C handlers, ports and physical resources | Must not import deep Domain App source or create another K |
| targetRef | Opaque bounded handle resolved only by trusted Host registry | Never parse it as URL, path or arbitrary locator |
| Permit | K-issued authorization context binding a specific external effect to its durable control turn | Host must fail closed without a valid permit |
| Effect | K-governed external operation with durable identity and settlement | Accepted/running is not terminal success |
| EffectEnvelope | Typed Host return envelope with accepted, running or terminal phase | Only terminal outcome settles the effect |
| MaterializedEvidence | Bounded evidence that a trusted Host materialized output, including digest, bytes and path | Must match confirmed output-root scope and actual bytes |
| Lineage | Durable identity for a download/business execution across retries, restart and projections | Ownership must be unique; do not infer ownership from a UI row |
| RouteLog CLAIM | Durable new-K route ownership fact used by current Core route | Not merely a disposable projection |
| RouteLog ATTEMPT | Durable record of an admitted route attempt | Does not replace K Effect Journal |
| RouteLog OUTCOME | Route-side result derived from K receipt | Not the authoritative K effect record |
| Core Seam Journal | Durable accepted command/response transport journal | Transport acceptance/replay, not business effect authority |
| K Effect Journal | Kernel-owned durable external effect lifecycle | Authoritative for K external-effect admission and settlement |
| UNKNOWN | Execution result cannot be safely proven after interruption or incomplete evidence | Never auto-clear or reinterpret as success |
| Coverage | Explicit statement of which declared members were resolved/verified | Counts, page limits and timeouts do not prove complete coverage |
| NOT_APPLICABLE | A dimension does not apply to a particular result shape | Not equivalent to UNKNOWN or VERIFIED_COMPLETE |
| Workflow Definition | Declarative states, transitions, guards and effect intents owned by B | K executes it; UI journey does not replace it |
| UI Journey | User-facing interaction sequence such as discover, select, confirm and submit | Must not become a second business state machine |
| Function | A named code entrypoint or exported pure/runtime function | Exporting a function does not make it a Tool |
| Tool | Explicitly exposed, permissioned interface for an external actor/Agent | No Agent Tool is currently introduced by this refactor |
| Core Query | Query served by the Core/Seam read model | Do not invent SDK Query/Subscription support |
| Subscription | A stream contract that must be explicitly supported by the SDK/Seam | A typed refusal must remain honest if unsupported |

## Normative distinctions

1. Business Intent ≠ C Operation ≠ Agent Tool.
2. Function export ≠ Tool.
3. Workflow Definition ≠ Workflow Execution ≠ UI Journey.
4. RouteLog OUTCOME ≠ K Effect Journal truth.
5. UNKNOWN ≠ FAILED or SUCCEEDED.
6. NOT_APPLICABLE ≠ VERIFIED_COMPLETE.
7. Physical Host adapter ≠ Domain App policy.