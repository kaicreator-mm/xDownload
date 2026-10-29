/**
 * The frozen PRD §33 experiment corpora as raw decodable data: Natural,
 * Collection, Hard and Holdout, with deterministic task cases tagged by the
 * canonical support slices (PRD §28) and linked to the C01–C34 oracles
 * (PRD §35) and CJ-01..CJ-09 journeys (PRD §31).
 *
 * Definitions are plain (untrusted-shaped) objects so every load exercises
 * the fail-closed decode path. All fixtures are registered controlled
 * resources; nothing here requires live-network truth.
 */

import { deepFreeze } from '@xdownload/domain-contracts';

const RECORDS: readonly unknown[] = deepFreeze([
  {
    corpusId: 'corpus.natural',
    title: 'Natural Corpus — ordinary in-scope tasks across S1–S6',
    purpose: 'ORDINARY_IN_SCOPE_TASKS_ACROSS_S1_S6',
    taskCases: [
      {
        taskCaseId: 'natural/s1-direct-file',
        title: 'Direct HTTP/HTTPS file acquisition',
        supportSlices: ['S1'],
        scopeKind: 'single_resource',
        fixtures: ['fixture/s1-direct-report'],
        linkedOracleIds: ['C16'],
        linkedJourneyIds: ['CJ-01'],
      },
      {
        taskCaseId: 'natural/s2-attachment',
        title: 'Browser download handoff / explicit current-page attachment',
        supportSlices: ['S2'],
        scopeKind: 'single_resource',
        fixtures: ['fixture/s2-page-attachment'],
        linkedOracleIds: ['C27', 'C29'],
        linkedJourneyIds: ['CJ-02'],
      },
      {
        taskCaseId: 'natural/s3-current-page-media',
        title: 'Current-page media candidate set with confirmation',
        supportSlices: ['S3'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s3-media-file'],
        linkedOracleIds: ['C09', 'C26', 'C34'],
        linkedJourneyIds: ['CJ-03'],
      },
      {
        taskCaseId: 'natural/s4-hls-vod',
        title: 'Selected HLS VOD manifest with segment continuation',
        supportSlices: ['S4'],
        scopeKind: 'single_resource',
        fixtures: ['fixture/s4-hls-manifest'],
        linkedOracleIds: ['C28'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'natural/s5-current-page-collection',
        title: 'Confirmed current-page membership snapshot batch',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C08', 'C25'],
        linkedJourneyIds: ['CJ-04'],
      },
      {
        taskCaseId: 'natural/s6-playlist',
        title: 'Explicit playlist with validated natural end',
        supportSlices: ['S6'],
        scopeKind: 'entire_supported_collection',
        fixtures: ['fixture/s6-playlist-members'],
        linkedOracleIds: ['C04'],
        linkedJourneyIds: ['CJ-05'],
      },
      {
        taskCaseId: 'natural/g0-confirmation-set',
        title: 'G0 confirmation set covering all §32.1 outcome classes',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C32', 'C33'],
        linkedJourneyIds: [],
      },
    ],
  },
  {
    corpusId: 'corpus.collection',
    title: 'Collection Corpus — current-page, gallery, playlist and continuation',
    purpose: 'CURRENT_PAGE_GALLERY_PLAYLIST_AND_CONTINUATION',
    taskCases: [
      {
        taskCaseId: 'collection/current-page-attachments',
        title: 'Current-page attachments with explicit member selection',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C05', 'C11', 'C30'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'collection/explicit-gallery',
        title: 'Explicit gallery with member detail/CDN edges',
        supportSlices: ['S6'],
        scopeKind: 'entire_supported_collection',
        fixtures: ['fixture/s6-playlist-members'],
        linkedOracleIds: ['C01', 'C07', 'C18'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'collection/explicit-playlist-continuation',
        title: 'Explicit playlist including a supported declared continuation case',
        supportSlices: ['S6'],
        scopeKind: 'entire_supported_collection',
        fixtures: ['fixture/s6-playlist-members'],
        linkedOracleIds: ['C03', 'C10', 'C14', 'C17', 'C23'],
        linkedJourneyIds: ['CJ-09'],
      },
      {
        taskCaseId: 'collection/large-member-set',
        title: 'Explicit 150-member set under the global safety cap',
        supportSlices: ['S6'],
        scopeKind: 'explicit_member_set',
        fixtures: ['fixture/s6-large-member-set'],
        linkedOracleIds: ['C02'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'collection/admission-frontier-probe',
        title: 'Collection admission probe for arbitrary-frontier rejection',
        supportSlices: ['S6'],
        scopeKind: 'entire_supported_collection',
        fixtures: ['fixture/s6-playlist-members'],
        linkedOracleIds: ['C06'],
        linkedJourneyIds: [],
      },
    ],
  },
  {
    corpusId: 'corpus.hard',
    title: 'Hard Corpus — deterministic/template path insufficient or ambiguous',
    purpose: 'DETERMINISTIC_TEMPLATE_PATH_INSUFFICIENT',
    taskCases: [
      {
        taskCaseId: 'hard/dash-separate-av',
        title: 'DASH/separate-A/V topology requiring unsupported mux',
        supportSlices: ['S4'],
        scopeKind: 'single_resource',
        fixtures: ['fixture/s3-media-file'],
        linkedOracleIds: ['C15'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'hard/auth-limited-collection',
        title: 'Authorization failure yielding no resolved targets',
        supportSlices: ['S6'],
        scopeKind: 'entire_supported_collection',
        fixtures: ['fixture/s6-playlist-members'],
        linkedOracleIds: ['C24'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'hard/insufficient-evidence',
        title: 'Confirmation outcome without independent truth available',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C22'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'hard/restart-repair-concurrency',
        title: 'Restart/repair with UI+CLI concurrency on inherited budgets',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C13'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'hard/retry-failed-members',
        title: 'Retry restricted to original failed members',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C12'],
        linkedJourneyIds: ['CJ-06'],
      },
      {
        taskCaseId: 'hard/site-template-mismatch',
        title: 'Site/template mismatch requiring bounded repair and revalidation',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s5-current-page-members'],
        linkedOracleIds: ['C20'],
        linkedJourneyIds: ['CJ-08'],
      },
      {
        taskCaseId: 'hard/model-unavailable',
        title: 'Model unavailable: direct/template paths continue, hard case fails closed',
        supportSlices: ['S3'],
        scopeKind: 'current_page',
        fixtures: ['fixture/s3-media-file'],
        linkedOracleIds: [],
        linkedJourneyIds: ['CJ-07'],
      },
    ],
  },
  {
    corpusId: 'corpus.holdout',
    title: 'Holdout Corpus — new pages/sessions/profile states for generalization',
    purpose: 'NEW_PAGES_SESSIONS_FOR_GENERALIZATION',
    taskCases: [
      {
        taskCaseId: 'holdout/new-session-generalization',
        title: 'New-session generalization probe for prior task-local selection',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/holdout-new-session-members'],
        linkedOracleIds: ['C31'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'holdout/ai-parity-comparison',
        title: 'AI vs non-AI parity under identical Tools/Auth/Budget/Context',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/holdout-new-session-members'],
        linkedOracleIds: ['C19'],
        linkedJourneyIds: [],
      },
      {
        taskCaseId: 'holdout/shared-knowledge-account',
        title: 'Shared knowledge applied on an independent user account',
        supportSlices: ['S5'],
        scopeKind: 'current_page',
        fixtures: ['fixture/holdout-new-session-members'],
        linkedOracleIds: ['C21'],
        linkedJourneyIds: [],
      },
    ],
  },
]);

/**
 * The four frozen PRD §33 corpus definitions, in canonical id order.
 */
export function corpusRegistryRecords(): readonly unknown[] {
  return RECORDS;
}
