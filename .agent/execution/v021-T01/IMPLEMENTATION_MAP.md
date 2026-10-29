# T01 Implementation Map

The Builder scope is limited to the two packages named in the frozen Task Pack. Existing domain result, scope, seam envelope, projection, scheduler, intent and migration-ledger contracts must be inspected and reused. Consumer apps, runtime, scheduler, persistence, Host and transfer paths are read-only.

The domain contract package owns stable job, attempt, progress, error and lineage-owner projection schemas and strict decoders. The Core seam package owns the explicit v0.2 route, typed read-only provider boundary, response/refusal mapping and backward-compatible envelope decoding. Both test suites consume one shared parity fixture.

Do not change package manifests, lockfiles, UI, runtime composition, scheduler state, persistence, network transfer or release files.