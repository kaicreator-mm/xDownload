# xDownload — Product Intent / Authority Correction R3

> 2026-11-11 · [devkit #5](https://github.com/kaicreator-mm/devkit/issues/5) · `SOURCE_REVIEWED_CANDIDATE` not G1 accepted. Research pinned to [`e904f08c478b15147b1c07fbe53c610d2d81851f`](https://github.com/kaicreator-mm/xDownload/tree/e904f08c478b15147b1c07fbe53c610d2d81851f); Product source [docs/product/PRD-v0.4.1-review-candidate.md](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/docs/product/PRD-v0.4.1-review-candidate.md) blob `86170bd4a41bcc049b180ac513ef7bf7bba64bf3`. Retain R0/R1/R2 for history; **this R3 supersedes the conflicting R2 interpretation**. No product code or release behavior modified.

## SC01 source authority correction

`PRD-v0.4.1-review-candidate.md` carries **PRD document revision v0.4.1**, says **initial product release target v0.1.0**, and explicitly has `Product Freeze: NO`, `Architecture Freeze: NO`, `Implementation: NOT STARTED` as of 2026-10-02. This is a **historical Stage 1 candidate** and must not be mistaken for a current released xDownload v0.4.1 or for a statement that subsequent v0.2.x code does not exist.

Repo `main@e904f08c478b15147b1c07fbe53c610d2d81851f` contains real `packages/domain-contracts/src/contract.ts`, `packages/domain-contracts/test/contract-scope.test.ts` and other v0.2 implementation. They are fixed source behavior, not automatically proof of release/cross-browser qualification. R1 referred to later v0.2.2 review gaps; the *current authoritative version Product/L1 and integration PR* needs an exact-Git crosscheck before G1/G2 acceptance.

## G1 candidate goal (stable across PRD, subject to current review)

User has explicit authorized resource or finite collection → Discover → Select → Acquire → Validate → Organize, with no unbounded crawler exploration. Prioritize correctness/truthful result over automation; support desktop browser interaction and bounded automation.

## G2/G3/G4 narrow sourceable claim scope

- AcquisitionIntent/RequestedScope and successor contract for changed request; explicit continuation permission, not arbitrary crawler.
- Provider/source authorization and version/scope; network HTTP success is not file quality or rights clearance.
- Recipe/SitePattern applicability/versioning and truthful multidimensional outcome; actual real site data requires permission/freshness review.
- **Do not use Stage 1 candidate's 'NOT STARTED' as a current implementation fact**, nor claim Current Product Freeze from it.

## G5 next gate

Locate present v0.2.x effective Product Owner freeze + active review/integration exact SHA, then build a current-source DOC_CODE_TEST matrix, check real collection/extension/native host cases, and keep any real environment gates explicit. Until then `PRODUCT_AUTHORITY_RESOLUTION=PENDING`, `EXTRACTION_READY=NO`.

## Review verdict

`G1=SOURCE_AUDIT_AMENDMENT_PENDING_INDEPENDENT_REVIEW`，`G2=BUSINESS_FLOW_REASSESS`，`G3=DOMAIN_OWNER_REASSESS`，`G4=KNOWLEDGE_SCOPE_REASSESS`，`G5=NOT_READY`。这是基于固定 Product 文本的修正，不意味着正式 Element/SAP/Graph/DIS 消费成功。
