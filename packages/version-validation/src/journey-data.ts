/**
 * The frozen CJ-01..CJ-09 Critical Journey harness definitions as raw
 * decodable data (frozen PRD §31). Plain objects so every load exercises the
 * fail-closed decode path.
 */

import { deepFreeze } from '@xdownload/domain-contracts';

function statuses(
  requestFulfillment: string,
  targetResolution: string,
  selectionAcquisition: string,
  coverage: string,
  stopReason: string,
  validationSummary: {
    readonly status: string;
    readonly passedCount: number;
    readonly failedCount: number;
  },
): unknown {
  return {
    requestFulfillment,
    targetResolution,
    selectionAcquisition,
    coverage,
    stopReason,
    validationSummary,
  };
}

const VALIDATED = { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 } as const;
const NOT_PERFORMED = { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 } as const;

const RECORDS: readonly unknown[] = deepFreeze([
  {
    journeyId: 'CJ-01',
    title:
      'Direct file: paste/click direct URL → resolve → acquire → validate → COMPLETE (model offline must not block)',
    prdRef: 'PRD-§31/CJ-01',
    corpusRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s1-direct-file' },
    requiredSupportSlices: ['S1'],
    expectedStop: 'NONE',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'NOT_APPLICABLE',
      'NONE',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-01' },
    scopeInvariants: {},
  },
  {
    journeyId: 'CJ-02',
    title:
      'Browser explicit attachment: current page → select attachment → local auth context → acquire → validate target/file',
    prdRef: 'PRD-§31/CJ-02',
    corpusRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s2-attachment' },
    requiredSupportSlices: ['S2'],
    expectedStop: 'NONE',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'NOT_APPLICABLE',
      'NONE',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-02' },
    scopeInvariants: {},
  },
  {
    journeyId: 'CJ-03',
    title:
      'Current-page media: observe → candidate set → AUTO/ASSISTED confirmation → acquire supported media → validate',
    prdRef: 'PRD-§31/CJ-03',
    corpusRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s3-current-page-media' },
    requiredSupportSlices: ['S3'],
    expectedStop: 'USER_SELECTION_COMPLETE',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'NOT_APPLICABLE',
      'USER_SELECTION_COMPLETE',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-03' },
    scopeInvariants: {},
  },
  {
    journeyId: 'CJ-04',
    title:
      'Current-page collection R01: snapshot → show scope + continuation (default NONE) → confirm → freeze → batch acquire → per-member validation → coverage result',
    prdRef: 'PRD-§31/CJ-04',
    corpusRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s5-current-page-collection' },
    requiredSupportSlices: ['S5'],
    expectedStop: 'USER_SCOPE_REACHED',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'VERIFIED_COMPLETE',
      'USER_SCOPE_REACHED',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-04' },
    scopeInvariants: { continuationScope: 'NONE' },
  },
  {
    journeyId: 'CJ-05',
    title:
      'Explicit playlist/gallery: identify → membership basis → declared scope → enumerate declared edges → snapshot → acquire → coverage validation (truthful PARTIAL/TRUNCATED when declared natural end not exhausted)',
    prdRef: 'PRD-§31/CJ-05',
    corpusRef: { corpusId: 'corpus.natural', taskCaseId: 'natural/s6-playlist' },
    requiredSupportSlices: ['S6'],
    expectedStop: 'NATURAL_COLLECTION_END',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'VERIFIED_COMPLETE',
      'NATURAL_COLLECTION_END',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-05' },
    scopeInvariants: { declaredNaturalEndTruthful: true },
  },
  {
    journeyId: 'CJ-06',
    title:
      'Retry/resume: existing snapshot → retry original targets only → no target replacement, scope expansion or budget reset',
    prdRef: 'PRD-§31/CJ-06',
    corpusRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/retry-failed-members' },
    requiredSupportSlices: ['S5'],
    expectedStop: 'USER_SCOPE_REACHED',
    expectedResultStatuses: statuses(
      'COMPLETE',
      'RESOLVED',
      'COMPLETE',
      'VERIFIED_COMPLETE',
      'USER_SCOPE_REACHED',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-06' },
    scopeInvariants: { retryOriginalTargetsOnly: true },
  },
  {
    journeyId: 'CJ-07',
    title:
      'Model unavailable: direct/template-supported paths continue; unresolved hard case returns NEEDS_USER_ACTION / UNKNOWN / UNSUPPORTED',
    prdRef: 'PRD-§31/CJ-07',
    corpusRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/model-unavailable' },
    requiredSupportSlices: ['S3'],
    expectedStop: 'UNSUPPORTED',
    expectedResultStatuses: statuses(
      'UNSATISFIED',
      'BLOCKED',
      'NOT_STARTED',
      'UNKNOWN',
      'UNSUPPORTED',
      NOT_PERFORMED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-07' },
    scopeInvariants: {},
  },
  {
    journeyId: 'CJ-08',
    title:
      'Site/template mismatch: fail closed from stale assumptions → bounded repair/user confirmation → never silently reuse stale target/membership claims',
    prdRef: 'PRD-§31/CJ-08',
    corpusRef: { corpusId: 'corpus.hard', taskCaseId: 'hard/site-template-mismatch' },
    requiredSupportSlices: ['S5'],
    expectedStop: 'NO_PROGRESS',
    expectedResultStatuses: statuses(
      'UNSATISFIED',
      'BLOCKED',
      'NOT_STARTED',
      'UNKNOWN',
      'NO_PROGRESS',
      NOT_PERFORMED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-08' },
    scopeInvariants: {},
  },
  {
    journeyId: 'CJ-09',
    title:
      'Authorization-limited whole collection R02: account requested members → preserve requested_scope → separate accessible/inaccessible accounting → acquire authorized subset only → §17.2 tuple when 18/16 canonical conditions hold',
    prdRef: 'PRD-§31/CJ-09',
    corpusRef: {
      corpusId: 'corpus.collection',
      taskCaseId: 'collection/explicit-playlist-continuation',
    },
    requiredSupportSlices: ['S6'],
    expectedStop: 'AUTH_REQUIRED',
    expectedResultStatuses: statuses(
      'PARTIAL',
      'RESOLVED',
      'COMPLETE',
      'VERIFIED_COMPLETE',
      'AUTH_REQUIRED',
      VALIDATED,
    ),
    truthSource: { kind: 'PRE_REGISTERED_INDEPENDENT_MANUAL_ORACLE', ref: 'PRD-§31/CJ-09' },
    scopeInvariants: { preserveRequestedScope: true },
  },
]);

/**
 * The pre-registered CJ-01..CJ-09 journey definitions, in canonical id order.
 */
export function journeyRegistryRecords(): readonly unknown[] {
  return RECORDS;
}
