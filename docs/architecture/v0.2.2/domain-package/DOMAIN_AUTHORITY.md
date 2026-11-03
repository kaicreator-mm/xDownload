# xDownload Domain Authority Map

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00: #338 · A05: #339

## Authority matrix

| Concern | Current authority | Supporting mechanism | Must not be confused with |
|---|---|---|---|
| Business intent and confirmation | Domain App / Business package | confirmDownload intent and exact-key validators | Agent Tool or Host direct call |
| Workflow policy | Business package | download-acquisition and s4-hls-vod definitions | UI Journey |
| External-effect admission/settlement | DomainHarness K | Effect Journal and Permit | Core Seam Journal or RouteLog |
| Physical Direct/HLS effect | Trusted Host handler | DirectAcquisitionBridge / Media bridge after permit validation | Domain App or UI |
| Accepted command / response replay | Core Seam | FileBackedSeamJournal and Seam replay | K effect truth |
| New-K route ownership | Current Core RouteLog CLAIM | FileBackedDomainAppRouteLog.isClaimed feeds resolveLineageOwner | T09 LineageLedger (not wired in audited Core path) |
| Route attempt history | Core RouteLog ATTEMPT | Durable attempt append before K send | K effect settlement |
| Route outcome view | Core RouteLog OUTCOME | Derived from K receipt | K Effect Journal |
| Old-core/new-k migration policy | T09 LineageLedger module | Explicit claims, release and UNKNOWN resolution | Current active Core route ownership unless wired by a reviewed migration |
| K document persistence | Current FileCasDocStore implementation | SDK V10DocStore port | T09 LineageStore |
| Core lifecycle / budget / recovery | Existing Core Scheduler and AuthoritativeLedgerWriter | Core Runtime and persistence-ledger | Domain App migration ledger |

## Current new-K route ownership

At the A00 baseline, Core route:
1. Reads the legacy ownership fact from the old Core Seam state/projection.
2. Reads the new-K ownership fact from RouteLog CLAIM.
3. Calls resolveLineageOwner.
4. Refuses ambiguity/conflict before a claim append or K send.
5. Appends CLAIM and ATTEMPT durably before sending to the one K.
6. Records OUTCOME from the K receipt path.

Therefore RouteLog CLAIM currently participates in the active new-K route ownership decision. Do not describe the entire RouteLog as a disposable read model.

## T09 LineageLedger status

T09 contains meaningful migration policy:
- old-core/new-k owner partition;
- authorized claim/re-claim and explicit release;
- UNKNOWN effect book;
- explicit authorized UNKNOWN resolution;
- history records.

But the audited Core route does not import or instantiate T09 LineageLedger. The module is exported from App but has no confirmed production caller in the inspected Core composition path.

Decision:
- Preserve its policy and tests while deciding whether it remains a supported module.
- Do not wire it into production as a second owner.
- Do not delete it based only on lack of current call sites.
- If it is retained, its physical PlainFileLineageStore adapter belongs behind a Host-owned physical storage boundary; policy remains in App.
- Any future switch from RouteLog CLAIM to T09 must be a separately reviewed atomic migration with restart/replay/UNKNOWN evidence.

## Physical store boundaries

- FileCasDocStore: active SDK V10DocStore filesystem adapter currently located in App; move behind Host injection.
- PlainFileLineageStore: physical adapter for the T09 module; no active production caller found in A00.
- FileBackedSeamJournal: Core transport durability; keep separate.
- FileBackedDomainAppRouteLog: Core route ownership/attempt/outcome durability; keep separate.

## UNKNOWN and recovery rules

- Never infer success from accepted/running.
- A crash while an effect is in flight must remain UNKNOWN unless durable K evidence proves a terminal result.
- Do not clear T09 UNKNOWN automatically.
- Do not replay a physical effect without the exact K permit/effect identity.
- Do not create a second business writer for a Lineage.

## Proof status

- Source ownership and call-path observations: SOURCE_AUDITED at A00 baseline.
- Multi-process SQLite CAS: NOT_PROVEN.
- Local Windows/Docker/Woodpecker behavior for the architecture refactor: NOT_RUN.
- Any later implementation claim must cite its own exact SHA and actual validation evidence.