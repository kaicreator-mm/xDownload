# v0.2.0 — Independent Release Qualification R1

```
TASK=v02-T21 (Issue #221)
RELEASE_QUALIFICATION=READY          (component-level claims CL-1..CL-4, frozen candidate bca81e2)
FROZEN_CANDIDATE=version/v0.2.0@bca81e224014194b0c15c186cfa4521f44fff572
QUALIFICATION_HEAD=af41bde (version/v0.2.0 tip; bca81e2..af41bde delta is docs-only — verified below)
OPERATOR_ID=zcode:xd-v02-t21-rq-controller-agent
WORKSTATION=xd-v02-t21-rq, branch task/v02-t21
ENV=Node v24.21.0 / win32 x64 10.0.26300 (Windows, Git Bash)
WRITE_SET=docs/release/v0.2.0/rq/** only
METHOD=all facts rebuilt fresh from GitHub (gh) and the local mirror
(git -C C:/xDev/kAiCreator/_mirror/xDownload.git, fetched 2026-10-29); no
implementation/validation session history consulted; every load-bearing claim below
was re-checked against primary sources (documents read in full, git diffs run, tests re-executed).
```

## 1. Verdict

**`RELEASE_QUALIFICATION_R1=READY`** for exactly the component-level claim set CL-1..CL-4 of
`docs/planning/v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md`, frozen at `bca81e2`. Within that declared
scope there is no unresolved blocker and the evidence chain is self-consistent end-to-end
(freeze lineage → four visible validations → hidden validation → closure → this qualification).

Scope wording (binding, per the amendment): this is a **component/workspace-level release** —
composition runtime + two workspace packages + bounded-authorization surface sources + lineage
authority partition. It is **not** an end-user product replacement; **v0.1 remains the released
product line**.

**`MAIN_INTEGRATION=PERMITTED` (T22 may merge `version/v0.2.0` → `main`)** under the conditions
in §5. The merge adds the component release on top of the v0.1 code base (v0.1.0 tip `195355d`
is the merge-base — verified, §4-E); it must not be presented as replacing the v0.1 product, and
the v0.1 release line continues from `version/v0.1.0` independently.

## 2. Claim–evidence consistency (spot-check A)

Each amended claim was traced to its PASS evidence in the four validation documents read in full
by this controller. No claim was found that exceeds what the evidence proves.

| Claim | PASS evidence segments (read verbatim by this controller) | Consistent |
| --- | --- | --- |
| CL-1 Domain App composition runtime (K-admitted, permit-gated, journal-truthful orchestration over the existing v0.1 engines; crash/restart/UNKNOWN/no-double-grant; cross-process durable readback) | `VALIDATION_CORE_R1` V1 (real-journey + crash/restart + second-process readback, EXIT=0), V2 (UNKNOWN append-only book + honest abort, EXIT=0), V4 (exactly-one permit/journal + dual-writer refusal, EXIT=0), item verdicts 1–4 PASS; `VALIDATION_PRODUCT_R1` §1 composition suites 42/42 all EXIT=0 (incl. `composition-runtime.test.ts` 8/8) | YES |
| CL-2 Two workspace packages, public exports, clean-consumer install, single-resolution graph, byte-identical v0.10.3 SDK pinning | `VALIDATION_PLATFORM_R1` §1 SDK sha256 4/4 vs #183 receipts, §2 `pnpm pack` + clean consumer install + exactly-9 `.pnpm` roots + lockfile integrity 4/4, §3 export smoke 12/12 over installed bytes, §5 zero-registry fallback (fail-closed 404 probe) | YES |
| CL-3 Bounded-authorization surface **sources** ready-to-wire: browser surface source-level fail-closed (T15 SOURCE_LEVEL=PASS); CLI adapter behavior-proven with CF-1 explicitly carried, NOT claimed source-clean | `VALIDATION_BROWSER_R1` §1 T08 suite 22/22 EXIT=0, §2 static confinement (payload whitelist, verbatim T01 gate, fail-closed seam enumeration, fixed pipeline order), §3 INSTALLED_SESSION=BLOCKED honestly recorded; `VALIDATION_CORE_R1` V5: CLI behavior tests 5/5 pass, import-allowlist scan FAIL recorded+attributed (CF-1), not washed | YES |
| CL-4 Lineage authority partition (old lineages v0.1-owned; new K lineages exclusively claimed; default = no migration) | `VALIDATION_CORE_R1` V4 G2 (partition holds both directions, `LINEAGE_PARTITION_VIOLATION`/`WRITER_IDENTITY_CONFLICT` typed refusals, new K cannot claim a recorded v0.1 lineage); `HIDDEN_INDEX_R1` category 11: 7/7 adversarial cases BLOCKED-CAUGHT; `CLOSURE_R1` §3 audit | YES |

Claim-bounding honesty verified: the amendment's own review focus (§5a "no claim exceeds what the
four validation documents actually prove") was re-checked independently here — every BLOCKED /
NOT_PROVEN / NOT_RUN verdict in the four documents lands outside the CL-1..CL-4 claims, and no
document relabels a lower-level result as a higher-level one (source ≠ installed; composition ≠
installed; readback ≠ concurrent multi-writer).

## 3. Frozen-candidate identity and post-freeze delta (spot-check B)

All diffs executed in the fetched mirror at `C:/xDev/kAiCreator/_mirror/xDownload.git`:

| Diff | Result |
| --- | --- |
| `git diff --name-only bca81e2..version/v0.2.0` (= af41bde, current tip) | exactly 3 files, all docs: `CANDIDATE_FREEZE_R2.md`, `HIDDEN_INDEX_R1.md`, `CLOSURE_R1.md` (+159/−0). Non-docs grep over the name list: zero matches |
| `git diff 7fa7210..bca81e2 -- packages apps tests build pnpm-lock.yaml package.json` | **0 lines** — the evidence head `7fa7210` (where T14–T17 executed) and the frozen candidate `bca81e2` are code-identical; the delta is validation docs/drivers/evidence logs (all under `docs/`) + the amendment |
| `git diff --name-only 15956b0..bca81e2` | only `docs/planning/v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md` (the reviewed PR #241 merge) |

Conclusion: the code the validators exercised is byte-identical to the frozen candidate, and
nothing but release records has landed since the freeze. Evidence-currentness holds without
trusting any intermediate claim.

## 4. Independent re-execution and cross-checks (spot-checks C, D, E, PoC anchor)

### C — Controller re-run on the exact frozen tree (workstation at af41bde, `git status` clean)

| Command (workstation root) | EXIT | Result |
| --- | --- | --- |
| `node --experimental-transform-types --test packages/download-domain-app/src/composition/composition-runtime.test.ts` | **0** | 8 tests / 8 pass / 0 fail (incl. gate-before-send zero-effect refusals, exactly-one-permit, idempotent replay, mid-flight abort, stop/reopen journal replay, digest-mismatch no-file) |
| `node --experimental-transform-types --test packages/download-domain-app/src/migration/lineage-ledger.test.ts` | **0** | 15 tests / 15 pass / 0 fail (T09 lineage authority/ledger semantics) |

Logs retained at `_tmp/t21-rq-smoke/` (outside the repo write set). The RQ controller has
personally touched the candidate; the composition and migration claim cores re-run green at the
qualification head.

### D — GitHub cross-check vs the closure ledger

- Milestone `v0.2.0` contains **exactly 22 issues, #201–#222**. States: #201–#220 CLOSED;
  #221 (this task) and #222 (T22 main integration) OPEN. This matches `CLOSURE_R1` §1
  row-for-row (T01–T20 done with evidence anchors, T21/T22 open in order). No stray or
  unclosed issue inside the milestone; no closed issue contradicts its CLOSURE outcome line.
- Issue **#242** (v0.2.1 intake, OPEN, not dispatched) carries the deferral ledger verbatim from
  amendment §2 rows 1–5 (installed CLI surface + CF-1; browser extension cutover; S4
  disposition; installed baselines; human G0/G1). The sixth amendment row (SQLite cross-process
  CAS) is correctly **absent** from #242 — the amendment itself marks it "standing boundary (not
  a gap)". The "must survive into v0.2.1 intake unchanged" requirement is currently satisfied.

### E — v0.1 zero impact

- `merge-base(version/v0.1.0, version/v0.2.0)` = `195355d` = the tip of `version/v0.1.0`;
  `git log version/v0.1.0 --not version/v0.2.0` = **0 commits**. The v0.2 line was cut from the
  v0.1 tip and nothing has been written to `version/v0.1.0` since.
- Subject scan of all `version/v0.1.0` commits for v0.2 markers yields 5 docs-only commits dated
  2026-10-01/02 referencing "PRD v0.2" (the PRD document version — pre-dating the v0.2.0 release
  line by four weeks; the FREEZE_RECEIPT and `version/v0.2.0` itself date from 2026-10-28/29).
  These are v0.1-era planning docs, not v0.2.0 release writes.
- `V01_RELEASE_IMPACT=NONE` (claimed in every review per CLOSURE §3) is corroborated
  structurally: no v0.2 commit reaches `version/v0.1.0`.

### PoC anchor (#183)

- `REVIEW_RESULT` comment `kaicreator-mm/xDownload#183@6480496090` fetched via API: actor
  `zcode:xdownload-199-independent-r1`, `status: "PASS"`, validation note records independent
  fresh-checkout review, 4/4 SDK tarball sha256 byte-identity vs a fresh pack from clean
  v0.10.3 (`061376f4` / tree `099cdc83`), test rerun EXIT=0 17/17.
- Follow-up `MERGE_RESULT` comment `6480675965`: reviewed head `2000532a` (delta review PASS,
  P0=0 P1=0 P2=0), merged experiment-only as `41a502e0` (tree `1d5c4411`). This matches the
  `FREEZE_RECEIPT_R1.md` POC_EVIDENCE line verbatim. The PoC→freeze→amendment→R2 chain is
  reconstructible from GitHub alone, as CLOSURE §5 requires.

## 5. Boundary dispositions (declared-out items: condition or not?)

Judged per the discipline: known boundaries are **not** release conditions when they are (a)
outside the declared claims, and (b) recorded and tracked somewhere the release chain obligates
a future owner to see them. All five below satisfy both; none blocks READY.

| # | Boundary | Disposition | Reasoning |
| --- | --- | --- | --- |
| 1 | CF-1 (CLI import-allowlist deterministic FAIL, pre-existing at T07 `f795e9e`) | Not a condition; carried known-defect note with a v0.2.1 owner disposition | CLI surface is not a CL-1..CL-4 claim (amendment §2 row 1, §3); the defect is recorded in three independent places the chain obligates reading (VALIDATION_CORE V5 with attribution, amendment §2/§3, #242 item 1); behavior tests of the same lane pass 5/5. It would become blocking only if a CLI-surface claim were ever derived from this release |
| 2 | SQLite cross-process CAS leg NOT_PROVEN | Not a condition; standing boundary per the recorded T13 no-native-driver decision | CL-1's cross-process wording is exactly "durable readback" (V1 R1/R3: second process reads durable bytes after a real stop) — NOT concurrent multi-writer locking; VALIDATION_CORE §3 states this boundary explicitly and the probe (V6, EXIT=0) shows the SQLite path fails closed. Consumers of CL-1 must stay within the file-CAS durability boundary as documented |
| 3 | INSTALLED_SESSION=BLOCKED (T15) and INSTALLED_LEVEL=BLOCKED (T16) | Not a condition; deferral tracked | Both BLOCKED verdicts are structural absence of an installable v0.2 surface (no transport wiring, no artifact, no pipe manifest — T15 §3; no CLI argv wiring, no dist — T16 §3), honestly recorded as BLOCKED, not PASS-laundered; amendment §2 rows 1–2 defer them to v0.2.1; #242 items 1–2 track them with the completion recipe |
| 4 | HUMAN_G0G1=NOT_RUN (T16) | Not a condition; deferral tracked | Human sessions are not agent-producible; amendment §2 row 5 defers to v0.2.1; #242 item 5 tracks. Nothing in CL-1..CL-4 invokes human-effort parity |
| 5 | S4 (HLS VOD Basic) has no implementation journey | Not a condition; disposition = NOT CLAIMED, owner decision deferred | T16 §1.1 records "no candidate implementation journey exists" and the amendment §2 row 3 records the disposition (implement or drop in v0.2.1, #242 item 3); the S3 media journey that IS claimed passes 9/9 (re-checked in VALIDATION_PRODUCT §1; S3 engine path per amendment). No S4 claim exists to be unproven |

Cosmetic observation (no action required for this release): `CLOSURE_R1` §2 contains the string
"evidence executed at `7fa81e2` lineage `7fa7210`" — the `7fa81e2` token is a typo for the
evidence head `7fa7210` (the code-identity those sentences assert was independently re-proven
here by diff in §3).

## 6. Scope and limitations of this qualification

1. **Scope**: READY covers exactly CL-1..CL-4 at composition/workspace/package level on
   `bca81e2` (+docs-only chain to `af41bde`). It does NOT qualify any installed end-user
   surface, CLI product path, packaged v0.2 artifact, browser session, human-effort parity,
   or S4 journey — all out of claims and deferred (#242).
2. **Platform**: the claim and this controller's re-run are Windows (win32 x64 10.0.26300) /
   Node v24.21.0 — matching the claimed platform (VALIDATION_PLATFORM §4). No other OS was
   exercised by anyone in the chain; non-Windows behavior is unproven (not claimed).
3. **Re-run depth**: this controller re-executed the two core claim lanes (composition
   runtime 8/8, lineage ledger 15/15, both EXIT=0). The full four-lane matrices (V1–V6,
   T08 suite, 5 composition suites, platform pack/consumer/smoke) were audited from their
   receipts, internal consistency, and identity to the frozen tree (§3) — not re-executed
   in full by this controller. The receipts carry real exits and retained logs; risk of
   receipt-only trust is bounded by the code-identity diff.
4. **Hidden validation**: auditable only through the public index (48 cases, 0 ESCAPED,
   12/12 probes EXIT=0, execution verified code-identical to `bca81e2`); case content is
   private by contract (`_tmp`, outside the repo). This qualification accepts the public
   index as the intended evidence surface of the T19 contract and notes that its raw logs
   are not independently re-checkable by design.
5. **Duration**: qualification is bound to the frozen identity; any code change after
   `bca81e2` invalidates it (the docs-only property of `bca81e2..tip` was verified at this
   head and must be re-asserted by T22 at merge time if the tip moves).

## 7. Decision

```
RELEASE_QUALIFICATION_R1=READY        (component-level scope CL-1..CL-4, candidate bca81e2)
MAIN_INTEGRATION=PERMITTED            (T22 may merge version/v0.2.0 → main)
```

Conditions attached to the permission (all already satisfied; restated for T22's execution):

- T22 must merge the frozen component release as recorded here — with the scope wording of the
  amendment (component-level; v0.1 remains the product line) preserved in the merge record; no
  end-user/product-replacement claim may be attached to the merge.
- If `version/v0.2.0` advances past `af41bde` before the merge, the docs-only property of the
  delta must be re-verified (any source-tree change requires a new freeze + requalification).
- The deferral ledger (#242) must survive unchanged into v0.2.1 intake, per the amendment's own
  requirement; CF-1 keeps its recorded owner disposition deadline there.
- No npm publication is authorized or assumed (CL-2/freeze-invariant wording stands; final
  published-package re-pin remains the A06 future checkpoint).

No issue was commented, nothing was merged, and no source was modified by this qualification
(write set: `docs/release/v0.2.0/rq/**` only).
