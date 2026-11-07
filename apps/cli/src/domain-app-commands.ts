/**
 * v0.2 T07 — CLI command adapter to one selected Domain App's public facade.
 *
 * Maps the four CLI command semantics onto the frozen public facade calls:
 * - submit → `facade.send(V10PublicIntent)` naming one canonical T01
 *   operation (`DOWNLOAD_OPERATIONS` — the adapter invents no operation id);
 * - cancel → `facade.send(V10PublicIntent)` with the bounded cancel intent
 *   type;
 * - status → `facade.query(V10ScopedSnapshotQuery)` (single, exact-key);
 * - query (multi) → `facade.query(selectors[])`, answers projected
 *   per-entry, a refusal scoped to its own index and never masking others.
 *
 * Faithfulness rules (frozen acceptance): receipts and snapshots are
 * projected verbatim through the pure status projector — UNKNOWN stays
 * UNKNOWN (never success), FAILED/CANCELLED stay terminal non-success,
 * errors are reported as documents (never swallowed); no kernel-internal
 * type, store key or deployment identity is exported.
 *
 * The download Domain App kernel owns all intent-input validation (typed
 * refusal codes cross unchanged); this adapter only bounds what it owns:
 * identifier grammar, exact intent shapes and the selector count bound.
 */

import { randomUUID } from 'node:crypto';

import { DOWNLOAD_OPERATIONS, type DownloadOperationId } from '@xdownload/download-domain-app';

import { CLI_ID_PATTERN, CliInputError } from './args.ts';
import {
  DOMAIN_APP_FACADE_KEYS,
  extractCodedFailure,
  isDomainAppFacadeLike,
  type DomainAppFacade,
  type V10PublicIntent,
  type V10ScopedSnapshotAnswer,
  type V10ScopedSnapshotManyAnswer,
  type V10ScopedSnapshotQuery,
} from './domain-app-facade.ts';
import {
  projectReceiptStatus,
  projectSnapshotStatus,
  type DomainAppStatusProjection,
  type DomainAppUnknownReason,
  type DomainAppUserStatus,
} from './domain-app-status.ts';
import { ACCEPTANCE_NOTE, CLI_OUTPUT_SCHEMA, EXIT } from './render.ts';

/** Re-exported so callers can reference the port keys without importing the SDK mirror. */
export { DOMAIN_APP_FACADE_KEYS };
export type { DomainAppFacade };

/** The one cancel intent type this adapter emits (bounded; kernel-validated). */
export const DOMAIN_APP_CANCEL_INTENT_TYPE = 'download.cancel';

/** Upper bound for one multi-target query (fail closed on unbounded input). */
export const MAX_QUERY_SELECTORS = 16;

export interface DomainAppSubmitCommand {
  readonly kind: 'submit';
  readonly operation: DownloadOperationId;
  readonly instanceKey: string;
  readonly messageId?: string;
  readonly input: Record<string, unknown>;
}

export interface DomainAppCancelCommand {
  readonly kind: 'cancel';
  readonly instanceKey: string;
  readonly messageId?: string;
  readonly reason?: string;
}

export interface DomainAppStatusCommand {
  readonly kind: 'status';
  readonly workflowId: string;
  readonly instanceKey: string;
  readonly businessPackageId?: string;
}

export interface DomainAppQueryManyCommand {
  readonly kind: 'query-many';
  readonly selectors: readonly DomainAppStatusCommand[];
}

export type DomainAppCommandInput =
  | DomainAppSubmitCommand
  | DomainAppCancelCommand
  | DomainAppStatusCommand
  | DomainAppQueryManyCommand;

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CLI_ID_PATTERN.test(value)) {
    throw new CliInputError('USAGE', `--${field} is not a valid identifier`, [
      {
        code: 'ENVELOPE_MALFORMED',
        path: field,
        message: `expected an identifier matching ${String(CLI_ID_PATTERN)}`,
      },
    ]);
  }
  return value;
}

function requirePlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliInputError('USAGE', `--${field} must be a plain JSON object`, [
      { code: 'ENVELOPE_MALFORMED', path: field, message: 'a plain object payload is required' },
    ]);
  }
  return value as Record<string, unknown>;
}

/** Generated idempotent command identity (explicit ids are honored verbatim). */
export function makeMessageId(): string {
  return `msg-${randomUUID()}`;
}

/**
 * Map a submit command onto the exact public intent shape: exactly the four
 * frozen keys, the operation id taken verbatim from the canonical T01
 * vocabulary.
 */
export function mapSubmitIntent(command: DomainAppSubmitCommand): V10PublicIntent {
  if (!DOWNLOAD_OPERATIONS.includes(command.operation)) {
    throw new CliInputError(
      'USAGE',
      'submit operation is outside the canonical v0.2 operation vocabulary',
      [
        {
          code: 'ENVELOPE_MALFORMED',
          path: 'operation',
          message: `expected one of ${DOWNLOAD_OPERATIONS.join(' | ')}`,
        },
      ],
    );
  }
  return {
    intentType: command.operation,
    instanceKey: requireIdentifier(command.instanceKey, 'instance-key'),
    messageId:
      command.messageId === undefined
        ? makeMessageId()
        : requireIdentifier(command.messageId, 'message-id'),
    input: requirePlainRecord(command.input, 'input'),
  };
}

/**
 * Map a cancel command onto the exact public intent shape. The optional
 * bounded reason is the adapter's only added input field; the kernel owns
 * whether and how the cancel intent is admitted.
 */
export function mapCancelIntent(command: DomainAppCancelCommand): V10PublicIntent {
  let input: Record<string, unknown> = {};
  if (command.reason !== undefined) {
    if (
      typeof command.reason !== 'string' ||
      command.reason.length === 0 ||
      command.reason.length > 256
    ) {
      throw new CliInputError('USAGE', 'cancel reason must be a bounded string (<= 256 chars)', [
        { code: 'ENVELOPE_MALFORMED', path: 'reason', message: 'reason must be 1..256 characters' },
      ]);
    }
    input = { reason: command.reason };
  }
  return {
    intentType: DOMAIN_APP_CANCEL_INTENT_TYPE,
    instanceKey: requireIdentifier(command.instanceKey, 'instance-key'),
    messageId:
      command.messageId === undefined
        ? makeMessageId()
        : requireIdentifier(command.messageId, 'message-id'),
    input,
  };
}

/** Map a status command onto the exact public scoped-snapshot selector. */
export function mapStatusQuery(command: DomainAppStatusCommand): V10ScopedSnapshotQuery {
  const selector: V10ScopedSnapshotQuery = {
    workflowId: requireIdentifier(command.workflowId, 'workflow-id'),
    instanceKey: requireIdentifier(command.instanceKey, 'instance-key'),
  };
  return command.businessPackageId === undefined
    ? selector
    : {
        ...selector,
        businessPackageId: requireIdentifier(command.businessPackageId, 'business-package-id'),
      };
}

/** Map a multi-target query onto the exact public selector list (1..16). */
export function mapQueryManySelectors(
  command: DomainAppQueryManyCommand,
): readonly V10ScopedSnapshotQuery[] {
  if (!Array.isArray(command.selectors) || command.selectors.length === 0) {
    throw new CliInputError('USAGE', 'query-many requires at least one selector', [
      {
        code: 'ENVELOPE_MALFORMED',
        path: 'selectors',
        message: 'selectors must be a non-empty array',
      },
    ]);
  }
  if (command.selectors.length > MAX_QUERY_SELECTORS) {
    throw new CliInputError(
      'USAGE',
      `query-many accepts at most ${String(MAX_QUERY_SELECTORS)} selectors`,
      [{ code: 'ENVELOPE_MALFORMED', path: 'selectors', message: 'selector count bound exceeded' }],
    );
  }
  return command.selectors.map((selector) => mapStatusQuery(selector));
}

/** The shared user-readable status fields of every projected document. */
export interface DomainAppStatusFields {
  readonly status: DomainAppUserStatus;
  readonly raw_status: string | null;
  readonly terminal: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly unknown_reason: DomainAppUnknownReason | null;
}

function statusFields(projection: DomainAppStatusProjection): DomainAppStatusFields {
  return {
    status: projection.status,
    raw_status: projection.rawStatus,
    terminal: projection.terminal,
    error: projection.error,
    unknown_reason: projection.unknownReason,
  };
}

/** Send receipt projection (submit and cancel): acceptance is never final success. */
export interface DomainAppSentDocument extends DomainAppStatusFields {
  readonly document: 'xdownload.cli.domain-app.sent';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly intent_type: string;
  readonly instance_key: string;
  readonly message_id: string;
  readonly note: typeof ACCEPTANCE_NOTE;
}

/** Single scoped-snapshot status projection. */
export interface DomainAppStatusDocument extends DomainAppStatusFields {
  readonly document: 'xdownload.cli.domain-app.status';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly workflow_id: string;
  readonly instance_key: string;
  readonly business_package_id: string | null;
}

/** One truthfully correlated multi-query entry. */
export type DomainAppMultiAnswerView =
  | ({ readonly index: number; readonly answered: true } & DomainAppStatusDocument)
  | {
      readonly index: number;
      readonly answered: false;
      readonly code: string;
      readonly message: string;
    };

/** Multi scoped-snapshot projection (refusals stay scoped to their index). */
export interface DomainAppMultiStatusDocument {
  readonly document: 'xdownload.cli.domain-app.query-multi';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly answers: readonly DomainAppMultiAnswerView[];
}

/** Facade error projection (typed public codes stay verbatim; never swallowed). */
export interface DomainAppErrorDocument {
  readonly document: 'xdownload.cli.domain-app.error';
  readonly schema: typeof CLI_OUTPUT_SCHEMA;
  readonly code: string;
  readonly message: string;
  /** true: SDK public typed error identity; false: untyped unexpected throw. */
  readonly coded: boolean;
}

export type DomainAppOutcome =
  | { readonly kind: 'sent'; readonly document: DomainAppSentDocument }
  | { readonly kind: 'status'; readonly document: DomainAppStatusDocument }
  | { readonly kind: 'query-many'; readonly document: DomainAppMultiStatusDocument }
  | { readonly kind: 'error'; readonly document: DomainAppErrorDocument };

function sentDocument(
  intent: V10PublicIntent,
  projection: DomainAppStatusProjection,
): DomainAppSentDocument {
  return {
    document: 'xdownload.cli.domain-app.sent',
    schema: CLI_OUTPUT_SCHEMA,
    intent_type: intent.intentType,
    instance_key: intent.instanceKey,
    message_id: intent.messageId,
    note: ACCEPTANCE_NOTE,
    ...statusFields(projection),
  };
}

function statusDocument(
  command: DomainAppStatusCommand,
  projection: DomainAppStatusProjection,
): DomainAppStatusDocument {
  return {
    document: 'xdownload.cli.domain-app.status',
    schema: CLI_OUTPUT_SCHEMA,
    workflow_id: command.workflowId,
    instance_key: command.instanceKey,
    business_package_id: command.businessPackageId ?? null,
    ...statusFields(projection),
  };
}

function multiAnswerView(
  answer: V10ScopedSnapshotManyAnswer,
  command: DomainAppStatusCommand,
): DomainAppMultiAnswerView {
  if (answer.status === 'refused') {
    return { index: answer.index, answered: false, code: answer.code, message: answer.message };
  }
  return {
    index: answer.index,
    answered: true,
    ...statusDocument(command, projectSnapshotStatus(answer.snapshot)),
  };
}

/**
 * Execute one CLI command against the injected public facade port. Facade
 * errors become error documents (typed public codes verbatim); nothing is
 * ever swallowed. Input mapping errors (`CliInputError`) propagate before
 * any facade call, matching the CLI's USAGE exit semantics.
 */
export async function executeDomainAppCommand(
  facade: DomainAppFacade,
  command: DomainAppCommandInput,
): Promise<DomainAppOutcome> {
  if (!isDomainAppFacadeLike(facade)) {
    return {
      kind: 'error',
      document: {
        document: 'xdownload.cli.domain-app.error',
        schema: CLI_OUTPUT_SCHEMA,
        code: 'FACADE_PORT_MISMATCH',
        message: 'the injected facade does not implement the public DomainApp facade port',
        coded: false,
      },
    };
  }
  try {
    switch (command.kind) {
      case 'submit': {
        // Map exactly once: the defaulted messageId must be the one sent.
        const intent = mapSubmitIntent(command);
        return {
          kind: 'sent',
          document: sentDocument(intent, projectReceiptStatus(await facade.send(intent))),
        };
      }
      case 'cancel': {
        const intent = mapCancelIntent(command);
        return {
          kind: 'sent',
          document: sentDocument(intent, projectReceiptStatus(await facade.send(intent))),
        };
      }
      case 'status': {
        const answer: V10ScopedSnapshotAnswer = await facade.query(mapStatusQuery(command));
        return {
          kind: 'status',
          document: statusDocument(command, projectSnapshotStatus(answer.snapshot)),
        };
      }
      case 'query-many': {
        const answers = await facade.query(mapQueryManySelectors(command));
        return {
          kind: 'query-many',
          document: {
            document: 'xdownload.cli.domain-app.query-multi',
            schema: CLI_OUTPUT_SCHEMA,
            answers: answers.map((answer) => {
              const selector = command.selectors[answer.index];
              // A non-correlated answer index is projected against no
              // selector: it becomes a scoped refusal, never a guess.
              return selector === undefined
                ? {
                    index: answer.index,
                    answered: false,
                    code: 'ANSWER_INDEX_UNCORRELATED',
                    message:
                      'multi-query answer index does not correlate to any requested selector',
                  }
                : multiAnswerView(answer, selector);
            }),
          },
        };
      }
    }
  } catch (thrown) {
    const coded = extractCodedFailure(thrown);
    return {
      kind: 'error',
      document: {
        document: 'xdownload.cli.domain-app.error',
        schema: CLI_OUTPUT_SCHEMA,
        code: coded === null ? 'UNEXPECTED_ERROR' : coded.code,
        message:
          coded === null
            ? thrown instanceof Error
              ? thrown.message
              : String(thrown)
            : coded.message,
        coded: coded !== null,
      },
    };
  }
}

/**
 * Exit code per the frozen CLI table: a send whose receipt already
 * projects terminal non-success exits TERMINAL_NON_SUCCESS; a typed public
 * facade refusal exits REJECTED; an untyped throw exits TRANSPORT;
 * otherwise SUCCESS (the document — never the exit code — carries the
 * status truth, including UNKNOWN).
 */
export function domainAppExitCode(outcome: DomainAppOutcome): number {
  switch (outcome.kind) {
    case 'sent':
    case 'status':
      return outcome.document.status === 'FAILED' || outcome.document.status === 'CANCELLED'
        ? EXIT.TERMINAL_NON_SUCCESS
        : EXIT.SUCCESS;
    case 'query-many': {
      if (outcome.document.answers.some((answer) => !answer.answered)) {
        return EXIT.REJECTED;
      }
      return outcome.document.answers.some(
        (answer) =>
          answer.answered && (answer.status === 'FAILED' || answer.status === 'CANCELLED'),
      )
        ? EXIT.TERMINAL_NON_SUCCESS
        : EXIT.SUCCESS;
    }
    case 'error':
      return outcome.document.coded ? EXIT.REJECTED : EXIT.TRANSPORT;
  }
}
