# xDownload PRD v0.4 Review Candidate

Status: Review Candidate

- Product Freeze: NO
- Architecture Freeze: NO
- L2 eligibility: NO
- Implementation: NOT STARTED

## Purpose

v0.4 is a contract-hardening revision after the v0.3 Fresh Independent Adversarial Review. It does not expand product scope. It converts remaining ambiguous product semantics into deterministic contracts before Product Freeze review.

## Product Thesis

xDownload is a targeted resource acquisition tool.

Core value:

```
Discover
Select
Acquire
Validate
Organize
```

xDownload is not a general crawler, website indexer, scraping platform, or autonomous web agent.

## Core Principles

### Minimum Necessary Intelligence

Execution priority:

```
Deterministic path
  -> Known Acquisition Template
  -> Template + User Confirmation
  -> LLM-assisted adaptation
  -> Bounded exploration
  -> Unsupported
```

### Minimum Necessary Interaction

User participation is a normal product mode, not a failure mode.

Supported modes:

- AUTO
- ASSISTED
- MANUAL_SELECTION

## Acquisition Contract

All tasks are represented by:

```
AcquisitionIntent
        |
AcquisitionContract
        |
Execution
        |
Validation
        |
Result
```

Intent types:

- SingleResourceIntent
- CollectionIntent

## Collection Admission Contract

Collection acquisition requires:

1. Identifiable CollectionIdentity
2. Observable or user-declared Membership relation
3. Understandable user Scope
4. Explicit stopping condition

Forbidden:

- arbitrary URL frontier
- recursive site discovery
- autonomous collection expansion
- continuous crawling

## Target Sets

The system MUST distinguish:

```
CandidateSet
    -> ConfirmedMemberSet
    -> SelectedTargetSet
    -> AcquiredValidatedSet
```

Discovery does not prove target correctness.

## Selection Snapshot

After selection confirmation, the following are frozen:

- collection identity
- requested scope
- member identities
- selection reason
- profile context
- authorization context
- version marker

Retry may only operate on frozen targets.

Silent replacement or expansion is forbidden.

## Status Model

### RequestFulfillmentStatus

Represents whether the user request was satisfied:

- COMPLETE
- PARTIAL
- UNSATISFIED
- UNKNOWN

### SelectionAcquisitionStatus

Represents execution of SelectedTargetSet:

- COMPLETE
- PARTIAL
- FAILED
- EMPTY

### CoverageStatus

Coverage MUST bind to:

```
CollectionIdentity
+ RequestedScope
+ AuthorizationContext
+ SnapshotVersion
```

Values:

- VERIFIED_COMPLETE
- VERIFIED_SUBSET
- UNKNOWN
- TRUNCATED

## Evidence Model

Evidence must declare the claim it supports:

- RESOURCE_IDENTITY
- MEMBERSHIP
- SELECTION
- QUALITY
- AUTHORIZATION
- TRANSFER
- FORMAT
- MEDIA
- COVERAGE

User confirmation may prove selection or identity confirmation, but does not automatically prove:

- original quality
- complete collection
- media correctness

Discovery evidence and validation evidence must remain independent.

## Budget Model

Budgets are separated:

### DiscoveryBudget

Controls exploration and candidate discovery.

### TransferBudget

Controls download transfer resources.

### GlobalSafetyBudget

Controls total lifecycle resource usage.

Retry, restart, repair and entry points inherit lifecycle budgets.

## Support Slice Contract

Every supported capability must define:

- identity
- authentication
- redirects
- cross-origin behavior
- resource model
- validation rules
- failure behavior

Unspecified capability is unsupported or experimental.

## Template-first Acquisition

Recipe is defined as:

```
Template
+
Matcher
+
Parameters
+
Evidence Rules
+
Validation Rules
+
Applicability Scope
```

Recipes are not arbitrary browser automation scripts.

## Human Assisted Acquisition

User confirmations are typed:

- CONFIRM_RESOURCE_IDENTITY
- CONFIRM_MEMBERSHIP
- CONFIRM_SELECTION
- CONFIRM_QUALITY
- ACCEPT_TARGET_CHANGE

Task-level user choices cannot automatically become reusable knowledge.

## Knowledge Promotion

Reusable knowledge requires:

- cross-task validation
- scope definition
- evidence
- failure behavior

Local Verified Knowledge must not silently generalize user selections.

## Experiment Protocol

Each Gate must freeze:

- sample unit
- inclusion rules
- exclusion rules
- primary metric
- denominator
- UNKNOWN handling
- abandonment handling
- truth source
- isolation rule
- modification invalidation rule

Process:

```
Exploration
 -> Frozen Confirmation Protocol
 -> Independent Confirmation
```

## Gate Structure

G1 Collection Increment is split:

- G1a Batch
- G1b Navigation
- G1c Semantic Selection
- G1d Organization

Collection value must not be attributed without controlled comparison.

## Counterexample Corpus

Inherited:

- C01-C34

Status:

NOT RUN

## Review Scope

This document is for Fresh Independent Product Re-Review only.

It does not authorize:

- Product Freeze
- L2 Architecture
- Implementation
- Release
- Merge
