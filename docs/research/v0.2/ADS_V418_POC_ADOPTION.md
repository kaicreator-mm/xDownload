# ADS v4.18.0 staged adoption for the xDownload Domain App experiment

STATUS: STAGED_UNREVIEWED
ISSUE: #182
EXPERIMENT_BASE: xDownload@195355d03b847825ce5acf78c73e06f7386e11e2
ADS_VERSION: 4.18.0
ADS_QUALIFIED_MERGED_MAIN: 2c395c55569fe2edf3f4135f12d3d069e526d0b7
ADS_RQ: https://github.com/kaicreator-mm/ai-development-standard/issues/1327
ADS_INTEGRATION_PR: https://github.com/kaicreator-mm/ai-development-standard/pull/1335

## Scope and fact preservation

The experiment/ads-v418-poc branch pins .dev-standard/VERSION to a qualified ADS 4.18.0 immutable integration commit. This is a scoped research adoption only.

The frozen xDownload version/v0.1.0 branch remains pinned to ADS 4.0.0 at 94cad2b0487e8a552c66d6bcd1cba36b7779383d. No change to frozen PRD/L2/Task DAG, original Task Claims, Reviews, CI results, release gates or main is authorized by this experiment. Current moving ADS main may include later non-normative intake. ADS v4.19 is NOT an adopted standard.

## Compatibility assessment

| Component | Initial decision | Evidence to resolve |
| --- | --- | --- |
| v0.1 Frozen PRD/L2/DAG/Task Packs | PRESERVE | Existing source/history remains original ADS 4.0 |
| Existing GitHub Tasks, Claims, Events, Review | HISTORICAL_ONLY | New standard cannot retroactively change old authority |
| Branch .dev-standard/VERSION | STAGED | Pinned ADS 4.18.0 + exact qualified main commit |
| AGENTS.md | COMPATIBLE_SOURCE | It resolves the exact standard via .dev-standard/VERSION |
| .dev-standard/PROJECT_OVERRIDES.md | ADAPTATION_REQUIRED | Stale pre-implementation and CI-disabled prose; cannot reuse as live v0.2 status |
| GitHub native blocked_by and Task Claim | NOT_PROVEN | Must read actual graph and accepted Claim before implementation |
| Woodpecker / Windows Node24 qualification | NOT_PROVEN | Must be separately demonstrated, no CI/result transfer |
| DomainHarness v0.10.3 public consumer | NOT_PROVEN | Candidate not assumed published; exact packed SDK and clean consumer needed |
| Independent adoption R1 | PENDING | Reviewer must check exact diff and origin |

## Follow-up gates

1. An independent reviewer checks pin identity, project override compatibility, historical evidence preservation, source diff and P0/P1/P2.
2. Any actual PoC implementation obtains separately authorized source scope and native Task/Claim currentness; planning branch does not dispatch implementation.
3. Future v0.2 version branch must adopt ADS using its own pin/review and updated project overrides, rather than inheriting this research branch as Release evidence.
4. No adoption PR from this branch may be merged into version/v0.1.0.

## Rollback

Delete or abandon the isolated experiment branch. The immutable version/v0.1.0 and main branches remain unaffected. Never claim ADS upgrade changed a historical release.