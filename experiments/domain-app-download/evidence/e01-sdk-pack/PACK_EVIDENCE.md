# E01 — v0.10.3 Git-source SDK pack evidence

- Host: Windows 10.0.26300 x64, Git Bash; Node v24.21.0 (fnm), npm 10.34.5/pnpm 10.34.5
- SDK source: `kaicreator-mm/domain-harness` lightweight tag `v0.10.3`
  - commit `061376f4a023070f215f9feffad5c24d96d503cb` (main release merge)
  - tree  `099cdc831aef63befd62aaede7e7a853d1be468f`
  - worktree used for pack: `C:/xDev/kAiCreator/domain-harness/dh-v0103-xdpoc-pack`, `git status --porcelain` = empty (0 lines) at pack time → packed bytes are the exact tagged tree
- Manifest versions at tag remain `0.10.2-rc.0` (expected; npm publication NOT done) — tarball names reflect manifest versions, content identity is the Git tree above
- npm registry fallback: none used; tarballs packed from local Git worktree only

## Commands and exit

```
$ cd <sdk-worktree>/packages/contracts && npm pack --pack-destination <out>   ; EXIT=0
$ cd <sdk-worktree>/packages/microkernel && npm pack --pack-destination <out> ; EXIT=0
$ cd <sdk-worktree>/packages/host-node && npm pack --pack-destination <out>   ; EXIT=0
npm notice total files: 28   (contracts)
npm notice total files: 20   (microkernel)
npm notice total files: 32   (host-node)
```

`$ cd <sdk-worktree>/tooling/build && npm pack --pack-destination <out>       ; EXIT=0` (producer devDep; R1 F-05 alignment: `scripts/pack-sdk.mjs` packs all four into this directory)

## Tarball SHA256 (consumed by the clean consumer)

| package | file | sha256 |
| --- | --- | --- |
| @kaicreator/domain-harness-contracts | kaicreator-domain-harness-contracts-0.10.2-rc.0.tgz | 859c55e1a3da61c551cb97c245f4ad02bca680710e8ff045e43fcbd33d052238 |
| @kaicreator/domain-harness-microkernel | kaicreator-domain-harness-microkernel-0.10.2-rc.0.tgz | cd716f08f48e8e2715cad71e07294339c4e1682ccb312838cb8f10036ede59d6 |
| @kaicreator/domain-harness-host-node | kaicreator-domain-harness-host-node-0.10.2-rc.0.tgz | 3a0a11391936b8cfcdb4dc81136576ad5dd3f30e278168ae485f10abb275c4b8 |
| @kaicreator/domain-harness-build (external producer, devDep) | kaicreator-domain-harness-build-0.10.2-rc.0.tgz | c04c5ee24f20e420e73da9bb7a8d43d1d44248bdfa45990b2cd2f3101adca5b5 |

Clean-consumer install (this directory, tarball-only, `--legacy-peer-deps`):

```
$ npm install ./evidence/e01-sdk-pack/kaicreator-domain-harness-contracts-0.10.2-rc.0.tgz \
               ./evidence/e01-sdk-pack/kaicreator-domain-harness-microkernel-0.10.2-rc.0.tgz \
               ./evidence/e01-sdk-pack/kaicreator-domain-harness-host-node-0.10.2-rc.0.tgz --legacy-peer-deps
added 3 packages, and audited 4 packages in 1s   EXIT=0
$ npm install -D ./evidence/e01-sdk-pack/kaicreator-domain-harness-build-0.10.2-rc.0.tgz --legacy-peer-deps
EXIT=0
```

Public export introspection of the installed bytes (Node v24.21.0):
`microkernel: load, V10Error, V10BuildError, V10ActivationError, V10ExternalEffectError, V10PortDeniedError, V10MultiBQueryError`;
`host-node: activateGovernedV10Build, openSqliteCasStore, SqliteCasStore, InMemoryCasStore, createV10ScopedMemory, ExternalWorkCoordinator, PoisonRecoveryCoordinator, pinCandidateSource, ...`;
`build: buildV10App, projectSelectedComponents`.

Tarball copies are retained in this directory as evidence bytes.
