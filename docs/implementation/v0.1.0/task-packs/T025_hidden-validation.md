# T025 — Hidden Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Execute the authorized hidden/adversarial validation pack after Candidate Freeze on the exact frozen candidate without changing the subject.

## Dependency
Exact dependency `T024`.

## Boundary / forbidden scope
Independent Validation only; no production-code repair, no disclosure-driven test oracle mutation, no transfer of visible-gate PASS to hidden scenarios, and no candidate mutation during Hidden Validation. Private fixtures remain private.

## Acceptance / Validation
Before execution, re-check that frozen `candidate_sha`, `candidate_tree` and `candidate_ref` still identify the declared candidate. Bind the run to the private hidden pack identity, revision and checksum without exposing fixture payloads, plus the exact environment and validator identity required by applicable validation authority. Run hidden normal/boundary/negative scenarios against that immutable subject and preserve failure evidence. Where relevant, classify and disposition escaped defects, `HIDDEN_PACK_BLIND_SPOT`, `PACK_DEFECT`, or other applicable release-standard defect classes; distinguish pack defects from product defects. Any product/content repair routes to an explicit successor candidate and affected visible gates/freeze before another Hidden run.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; independent Hidden Validator; freedom `F0_MECHANICAL`.

## Closeout
Durable PASS/FAIL/BLOCKED evidence bound to the frozen candidate SHA/tree/ref, hidden pack identity/revision/checksum, and applicable environment/validator identity; include public-safe defect/blind-spot/pack disposition when relevant. No Closure/Release claim.
