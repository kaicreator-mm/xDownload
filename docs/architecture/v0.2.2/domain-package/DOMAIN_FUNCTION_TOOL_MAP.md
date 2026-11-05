# xDownload Function / Tool Boundary Map

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00: #338 · A05: #339

## Classification

| Surface | Current example | Classification | Tool? |
|---|---|---|---|
| Business package endpoint | getPolicy() | DomainHarness Business endpoint | No |
| BUILD producer | buildDownloadDomainApp() | Domain App BUILD function | No |
| Domain assembly helper | sealS4HlsComposition(), sealMediaComposition() | BUILD/composition function | No |
| Business Intent | confirmDownload | User-confirmed domain intent | No |
| C Operation | acquisition.acquire | K-governed external capability operation | No |
| C Operation | media.acquire | K-governed external capability operation | No |
| Host handler | DirectAcquisitionBridge | Trusted Host function implementing C | No |
| Host handler | acquireSelectedHlsVod() | Trusted Host function implementing C | No |
| Semantic functions | evaluateRecipe(), selectTarget() | Pure deterministic domain functions | No |
| Domain Journey | submitConfirmedDownload(), runS2DiscoveryJourney() | Domain orchestration functions | No |
| Core command | DOMAIN_APP_SEND through Core Seam | Transport command | No |
| Core query | READ_JOB_PROJECTION | Core-owned read projection | No |
| SDK Query/Subscription | K Query/Subscription API | Only where explicitly supported by pinned SDK | No |
| Agent Tool Adapter | Not currently implemented | Future explicitly permissioned adapter | Not present |

## Normative distinction

- A JavaScript export is a Function, not automatically a Tool.
- A Business Intent expresses a domain request; a Tool is an external actor's controlled entrypoint.
- A C Operation is a K-governed capability; it is not directly callable by UI or Agent.
- A Host handler implements the C Operation after K permit validation.
- Core READ_JOB_PROJECTION is a Core read model; it must not be mislabeled as an SDK K Query.
- A typed refusal for unsupported Subscription must remain a refusal; do not synthesize streaming behavior.

## Current Agent Tool status

No Agent Tool is added by the v0.2.2 architecture refinement.

If a future Agent Tool is approved, its path must be:

\`\`\`text
Agent
  -> explicitly permissioned Tool Adapter
  -> Business Intent
  -> K admission / Workflow
  -> C Operation
  -> trusted Host handler after Permit
\`\`\`

The Tool Adapter must define:
- actor identity and authorization;
- exact input schema and no-widening rules;
- confirmation requirements;
- bounded output/evidence;
- denial and UNKNOWN behavior;
- audit identity and replay semantics.

It must not expose Host bridges, private Journal, raw locator, filesystem paths or Permit minting.