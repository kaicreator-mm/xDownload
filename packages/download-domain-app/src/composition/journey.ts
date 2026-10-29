/**
 * v0.2 T11 — the one authoritative download journey over the assembled
 * runtime (integration-direct lane).
 *
 * `submitConfirmedDownload` is the ONLY path from a caller-confirmed intent
 * to a physical acquisition:
 *
 *   1. T01 GATE BEFORE SEND — the candidate is sealed through the canonical
 *      `confirmDownloadRequest` no-widening validation (exact field set,
 *      opaque targetRef, bounded sizes). A refused intent never reaches K;
 *      nothing exists yet, so there is nothing to retry.
 *   2. K SEND — one `DomainApp.send` of the sealed public intent. The K's
 *      external Effect Permit gate mints the LIVE one-time permit, journals
 *      the effect and dispatches the sealed direct C module, which reaches
 *      the pinned T04 bridge exactly once (attempt 0).
 *   3. TERMINAL UNWRAP — the effect output is normalized through the T01
 *      envelope grammar (A05: accepted/running are never completion);
 *      `await:'terminal'` makes any non-terminal phase an honest failure.
 *   4. EVIDENCE VERIFICATION — a terminal-ok output is checked against the
 *      T01 materialized-evidence grammar (digest shape, positive bytes, path
 *      containment inside the confirmed root) AND against the real bytes on
 *      disk (re-read + re-hash must reproduce the evidence digest and byte
 *      count). Mismatch is a failed journey, never a completed one.
 *   5. NO RETRY, EVER — UNKNOWN or failed terminal outcomes are surfaced
 *      verbatim as typed results (or thrown typed refusals); the journey
 *      performs zero re-sends, zero repair and zero journal clearing.
 *
 * Cancellation: the caller's AbortSignal is bridged onto the runtime's
 * per-request controller, which the pinned T04 bridge forwards verbatim to
 * the existing DirectHttpAdapter. An aborted transfer settles as a truthful
 * non-completed journey (no file, honest error); a NEW authorized submission
 * under a fresh identity is the caller's explicit decision — never an
 * automatic redownload.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { V10PublicIntent } from '@kaicreator/domain-harness-contracts';
import {
  normalizeEffectEnvelope,
  validateMaterializedEvidence,
  type ConfirmedDownloadIntent,
  type EffectEnvelope,
  type MaterializedEvidence,
} from '../contracts/index.ts';
import { confirmDownloadRequest } from '../business/composition.ts';
import type { DownloadRuntime } from './runtime.ts';

/** Structural views over the dynamic public K receipt (send result). */
interface KEffectView {
  readonly disposition?: string;
  readonly output?: unknown;
}

interface KReceiptView {
  readonly status?: string;
  readonly idempotentReplay?: boolean;
  readonly admitted?: {
    readonly effects?: readonly KEffectView[];
    readonly resolver?: { readonly llmAvoided?: boolean };
  };
}

export interface SubmitConfirmedDownloadOptions {
  /** Explicit occurrence message id; defaults to `msg-<requestId>`. */
  readonly messageId?: string;
  /**
   * Caller cancellation. Aborted before send: zero-effect refused journey.
   * Aborted mid-transfer: the signal is forwarded verbatim to the bridge and
   * the transfer settles truthfully non-completed.
   */
  readonly signal?: AbortSignal;
}

/** A truthful journey outcome; `failed` is final and never auto-retried. */
export type SubmissionOutcome =
  | {
      readonly status: 'completed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly evidence: MaterializedEvidence;
      /** The kernel-minted permit identity the one dispatch ran under. */
      readonly permitEffectId: string;
      readonly terminal: EffectEnvelope;
      readonly receipt: Record<string, unknown>;
    }
  | {
      /** Idempotent replay of an already-settled occurrence: zero new effects. */
      readonly status: 'replayed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly receipt: Record<string, unknown>;
    }
  | {
      readonly status: 'failed';
      readonly confirmed: ConfirmedDownloadIntent;
      readonly error: { readonly code: string; readonly message: string };
      /** The typed terminal envelope when one existed (null = never ran). */
      readonly terminal: EffectEnvelope | null;
      readonly receipt: Record<string, unknown> | null;
      /** True when the failure is the caller's own cancellation. */
      readonly aborted: boolean;
    };

/**
 * Run the confirmed download journey end-to-end. Typed refusals thrown by
 * the gate (`CONFIRMED_INTENT_INVALID`) and by the K facade (route-less
 * intents, effect-fault admissions) propagate verbatim — the journey never
 * catches them into a retry.
 */
export async function submitConfirmedDownload(
  runtime: DownloadRuntime,
  candidate: unknown,
  options: SubmitConfirmedDownloadOptions = {},
): Promise<SubmissionOutcome> {
  // (1) T01 gate before send — no-widening; a refusal never reaches K.
  const { confirmed, intent } = confirmDownloadRequest(candidate, { messageId: options.messageId });

  if (options.signal?.aborted === true) {
    return failed(confirmed, {
      code: 'SUBMISSION_ABORTED',
      message: 'the caller aborted the submission before send; zero effects were created',
    }, null, null, true);
  }

  // Cancellation plumbing: bridge the caller's signal onto the runtime's
  // per-request controller (the pinned bridge forwards it to the adapter).
  const controller = runtime.beginSubmission(confirmed.requestId);
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  let receipt: Record<string, unknown> | null = null;
  try {
    // (2) One K send; at most one permit; at most one bridge dispatch.
    receipt = await runtime.app.send(intent as V10PublicIntent);
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
    runtime.settleSubmission(confirmed.requestId);
  }

  const view = receipt as KReceiptView;

  // Idempotent replay of the same occurrence: K re-delivers the settled
  // receipt and runs no effect — surface that truthfully.
  if (view.idempotentReplay === true) {
    return { status: 'replayed', confirmed, receipt };
  }

  // (3) Terminal unwrap through the T01 envelope grammar.
  const effect = view.admitted?.effects?.[0];
  if (effect === undefined) {
    return failed(
      confirmed,
      { code: 'EFFECT_ENVELOPE_MISSING', message: 'the admitted receipt carries no external effect envelope' },
      null,
      receipt,
      false,
    );
  }
  const normalized = normalizeEffectEnvelope(effect.output);
  if (!normalized.ok) {
    return failed(
      confirmed,
      {
        code: normalized.diagnostics[0]?.code ?? 'EFFECT_ENVELOPE_INVALID',
        message: normalized.diagnostics[0]?.message ?? 'effect output is not a T01 envelope',
      },
      null,
      receipt,
      false,
    );
  }
  const terminal: EffectEnvelope = normalized.value;
  if (terminal.phase !== 'terminal') {
    // await:'terminal' — an accepted/running ACK can never settle success.
    return failed(
      confirmed,
      { code: 'EFFECT_NOT_TERMINAL', message: `effect settled at phase '${terminal.phase}' under await:'terminal'` },
      terminal,
      receipt,
      false,
    );
  }
  if (terminal.outcome.ok === false) {
    return failed(confirmed, terminal.outcome.error, terminal, receipt, controller.signal.aborted);
  }

  // (4) Evidence verification — grammar, then real bytes on disk.
  const output = terminal.outcome.output;
  const permitEffectId = output['permitEffectId'];
  if (typeof permitEffectId !== 'string' || permitEffectId.length === 0) {
    return failed(
      confirmed,
      { code: 'EVIDENCE_PERMIT_IDENTITY_MISSING', message: 'the terminal output carries no permit effect identity' },
      terminal,
      receipt,
      false,
    );
  }
  const evidenceCheck = validateMaterializedEvidence(
    {
      fileSha256: output['fileSha256'],
      bytesWritten: output['bytesWritten'],
      artifactPath: output['artifactPath'],
      stopReason: output['stopReason'],
    },
    confirmed.outputRootScope,
  );
  if (!evidenceCheck.ok) {
    return failed(
      confirmed,
      {
        code: evidenceCheck.diagnostics[0]?.code ?? 'EVIDENCE_INVALID',
        message: evidenceCheck.diagnostics[0]?.message ?? 'materialized evidence refused by the T01 grammar',
      },
      terminal,
      receipt,
      false,
    );
  }
  const evidence = evidenceCheck.value;
  let onDisk: Buffer;
  try {
    onDisk = readFileSync(evidence.artifactPath);
  } catch (error) {
    return failed(
      confirmed,
      {
        code: 'EVIDENCE_FILE_UNREADABLE',
        message: `evidence verification failed reading ${evidence.artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
      },
      terminal,
      receipt,
      false,
    );
  }
  const onDiskDigest = createHash('sha256').update(onDisk).digest('hex');
  if (onDiskDigest !== evidence.fileSha256 || onDisk.byteLength !== evidence.bytesWritten) {
    return failed(
      confirmed,
      {
        code: 'EVIDENCE_DIGEST_MISMATCH',
        message: `artifact on disk (${onDiskDigest}, ${onDisk.byteLength} bytes) does not reproduce the terminal evidence (${evidence.fileSha256}, ${evidence.bytesWritten} bytes)`,
      },
      terminal,
      receipt,
      false,
    );
  }

  return { status: 'completed', confirmed, evidence, permitEffectId, terminal, receipt };
}

function failed(
  confirmed: ConfirmedDownloadIntent,
  error: { code: string; message: string },
  terminal: EffectEnvelope | null,
  receipt: Record<string, unknown> | null,
  aborted: boolean,
): SubmissionOutcome {
  return { status: 'failed', confirmed, error, terminal, receipt, aborted };
}
