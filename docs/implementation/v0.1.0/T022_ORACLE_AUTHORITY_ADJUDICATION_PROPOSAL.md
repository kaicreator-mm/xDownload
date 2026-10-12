# T022 / #80 — Frozen-authority and T003 oracle successor adjudication

Status: **PROPOSAL / NOT APPROVED / NOT A FREEZE**  
Candidate witness: `version/v0.1.0@bc16d9b62e5585eef4d9dda7100f3be2261360e3`, tree `00cd35f126df21b56af9b89fb32e1237fadd223f`  
ADS pin: `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`  
Inputs: #80, T022/#41 validation terminal #6004819670, Frozen PRD blob `6e95583529afad6c6485cdbbe45539a2145ef4c6`, T003 registry `journey-data.ts@3f208bc4afe81f8acfb4eb4daa180a749730a063`, T007 projector `result-projector.ts@909045e63966b965262c6b248d8986dffe2c2d0d`.

## 1. Authority provenance

Frozen PRD §31/CJ-08 requires fail-closed stale-site/template handling, bounded repair/user confirmation and no silent reuse of stale target or membership claims. **PRD does not freeze a complete six-dimensional CJ-08 result tuple.** The exact expected value `UNSATISFIED/BLOCKED/NOT_STARTED/UNKNOWN/NO_PROGRESS + NOT_PERFORMED(0/0)` occurs in T003's `journey-data.ts` (downstream validation registration). T007's `BLOCKED` resolution corresponds to an explicit AUTH_FAILED, AUTH_REQUIRED or UNSUPPORTED pre-resolution cause; its NO_PROGRESS logic is separate. The expected combined tuple therefore cannot arise from the tested composition.

T022 executed three CJ-08 behavior legs: typed MEMBERSHIP_DRIFT rejection; CONTINUATION_UNCLOSABLE/NEXT_CONTROL_MISSING without acquisition; and stale RECIPE_REPLAY/ASK_USER without delivery. These facts support the PRD fail-closed behavior, but they **do not convert the original tuple comparison into a PASS**.

## 2. Count-domain mismatch

T003 reuses `VALIDATED={ALL_PASSED,passedCount:1,failedCount:0}` across single- and multi-member journeys. T007's authoritative `validationSummaryFrom` counts **selected members** with required validation facts; the T022 executions report three or four validated members where the fixture expected one.

PRD §32.1's **one user task** is the G0/G1 denominator unit, not the terminal `ValidationSummary.passedCount` unit. Mixing these domains is a downstream oracle/data registration defect unless independent adjudication finds a contradictory Product requirement.

## 3. Proposed minimal normative disposition (requires fresh independent review)

1. `PRODUCT_REOPEN_REQUIRED=NO`, subject to fresh authority review. Frozen PRD §§16–19, 31–35 and §37 remain byte-identical. No loosening of result truth, fail-closed rules, denominator or required G0/G1 gates.
2. `L2_AMENDMENT_REQUIRED=NO`, absent a newly demonstrated Architecture contradiction.
3. `T003_SUCCESSOR_ORACLE_REQUIRED=YES`. Add a separate **successor** version of the T003 oracle/fixture contract, retaining the original frozen/historical registration as evidence. CJ-08 should have pre-registered **behavioral no-silent-acquisition predicates** for rejected pre-terminal cases, with a legally producible terminal tuple only if a terminal genuinely exists. Do not fabricate a terminal or lower a substantive failure into a success.
4. Derive selected-member validation counts from **pre-exposure frozen fixture membership identities**, not from retrospectively observed successful counts. Keep task-level Gate denominator distinct from member-level terminal summaries. Exercise 1-, 3-, 4-, failure and partial cases as negative/positive controls.
5. Protocol succession due to **C33 / PRD §32.1**: old Phase B has already been seen, so the old T022 8/9 run cannot be rescored to 9/9. After an authorized review and new exact-subject oracle/protocol freeze, run a truly independent new Phase B with fresh task identities/truth. Freeze baseline selection before this new exposure.
6. Any changed implementation or test bytes yield a new candidate SHA. Run the affected concern gates on exact successor HEAD; converge one T019 successor candidate and re-run T020–T023 exact-subject gates. Preserve old evidence with its original SHAs.

## 4. Independent blocker, not resolved by this proposal

G0 is REQUIRED and G1a/G1b/G1c are conditionally REQUIRED by the Frozen PRD. T022 has `INSUFFICIENT_EVIDENCE` due to missing real conventional-baseline/human-effort comparisons. This concern is **#81** and must be measured honestly; no fixture substitution or waiver by a scheduler. A protocol successor for CJ-08 **does not** make G0/G1 PASS.

## 5. Review and acceptance gates

Independent reviewer must verify frozen blob identities and T003/T007 exact files, adjudicate whether Product reopening is actually unnecessary, and return one of:

- `AUTHORITY_DECISION=PASS_ORACLE_SUCCESSOR_NO_PRODUCT_REOPEN`;
- `AUTHORITY_DECISION=PRODUCT_REOPEN_REQUIRED`;
- `AUTHORITY_DECISION=CHANGES_REQUESTED`.

If PASS: authorize bounded T003 successor oracle issue/PR without changing Frozen PRD/L2; require immutable expected-result/protocol checkpoint **before** any successor Phase B. If reopening is required: use formal Stage 1 Product/Scope reopen and successor freeze first, then propagate to L2/DAG as necessary.

No new T022 Validation PASS or T024 Candidate Freeze is claimed by this document.
