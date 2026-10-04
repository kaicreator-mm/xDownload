/**
 * T005 ledger reader — typed queries over the durable facts.
 *
 * Readers never mutate. They are the seam surfaces/adapters use to observe
 * durable truth (frozen L2 §10: surfaces are readers/submitters, never a
 * second writer).
 */

import {
  budgetRemaining,
  type BudgetRemaining,
  type ConsumedBudget,
} from '@xdownload/domain-contracts';
import type { LedgerDatabase } from './connection.ts';
import { PersistenceError } from './errors.ts';
import {
  decodeArtifactRow,
  decodeBudgetEntryRow,
  decodeEffectRow,
  decodeFactStream,
  decodeWorkItemRow,
  type ArtifactRow,
  type BudgetEntryRow,
  type EffectRow,
  type TransitionFact,
  type WorkItemRow,
} from './rows.ts';

const BUDGET_CONSUMED_KEYS = {
  discovery: ['generatedRequests', 'navigationActions', 'modelCalls'],
  transfer: ['bytes', 'segments', 'activeTransferMs', 'retryTransferRequests'],
  global_safety: ['totalGeneratedRequests', 'modelCostUnits', 'activeElapsedMs'],
} as const;

export function isKnownBudgetLimitKey(
  domain: 'discovery' | 'transfer' | 'global_safety',
  limitKey: string,
): boolean {
  return (BUDGET_CONSUMED_KEYS[domain] as readonly string[]).includes(limitKey);
}

export class LedgerReader {
  protected readonly db: LedgerDatabase;

  constructor(db: LedgerDatabase) {
    this.db = db;
  }

  workItem(workItemId: string): WorkItemRow | undefined {
    const row = this.db.queryGet('SELECT * FROM work_items WHERE work_item_id = ?', workItemId);
    return row === undefined ? undefined : decodeWorkItemRow(row);
  }

  requireWorkItem(workItemId: string): WorkItemRow {
    const row = this.workItem(workItemId);
    if (row === undefined) {
      throw new PersistenceError(
        'MALFORMED_LEDGER_ROW',
        `work item '${workItemId}' is not present in the ledger`,
        { path: 'work_items.work_item_id' },
      );
    }
    return row;
  }

  workItems(): readonly WorkItemRow[] {
    return this.db
      .queryAll('SELECT * FROM work_items ORDER BY work_item_id')
      .map((row) => decodeWorkItemRow(row));
  }

  effect(workItemId: string): EffectRow | undefined {
    const row = this.db.queryGet('SELECT * FROM effects WHERE work_item_id = ?', workItemId);
    return row === undefined ? undefined : decodeEffectRow(row);
  }

  facts(workItemId: string): readonly TransitionFact[] {
    return decodeFactStream(
      this.db.queryAll(
        'SELECT * FROM transition_facts WHERE work_item_id = ? ORDER BY fact_seq ASC',
        workItemId,
      ),
      workItemId,
    );
  }

  artifact(workItemId: string, artifactId: string): ArtifactRow | undefined {
    const row = this.db.queryGet(
      'SELECT * FROM artifacts WHERE work_item_id = ? AND artifact_id = ?',
      workItemId,
      artifactId,
    );
    return row === undefined ? undefined : decodeArtifactRow(row);
  }

  artifacts(workItemId: string): readonly ArtifactRow[] {
    return this.db
      .queryAll('SELECT * FROM artifacts WHERE work_item_id = ? ORDER BY artifact_id', workItemId)
      .map((row) => decodeArtifactRow(row));
  }

  budgetEntries(workItemId: string): readonly BudgetEntryRow[] {
    return this.db
      .queryAll('SELECT * FROM budget_entries WHERE work_item_id = ? ORDER BY entry_id', workItemId)
      .map((row) => decodeBudgetEntryRow(row));
  }

  /**
   * Durable remaining budgets recomputed from ledger rows only — restart
   * never replenishes and nothing outside the rows participates (PRD §15.4;
   * L2 invariant 7).
   */
  budgetRemaining(workItemId: string): BudgetRemaining {
    const workItem = this.requireWorkItem(workItemId);
    const consumed: {
      discovery: Record<string, number>;
      transfer: Record<string, number>;
      global_safety: Record<string, number>;
    } = {
      discovery: {},
      transfer: {},
      global_safety: {},
    };
    for (const entry of this.budgetEntries(workItemId)) {
      const bucket = consumed[entry.domain];
      if (bucket === undefined) {
        continue;
      }
      const current = bucket[entry.limitKey] ?? 0;
      const delta = entry.kind === 'RESERVATION_RELEASE' ? -entry.amount : entry.amount;
      bucket[entry.limitKey] = Math.max(0, current + delta);
    }
    const consumedBudget: ConsumedBudget = {
      discovery: {
        generatedRequests: consumed.discovery['generatedRequests'] ?? 0,
        navigationActions: consumed.discovery['navigationActions'] ?? 0,
        modelCalls: consumed.discovery['modelCalls'] ?? 0,
      },
      transfer: {
        bytes: consumed.transfer['bytes'] ?? 0,
        segments: consumed.transfer['segments'] ?? 0,
        activeTransferMs: consumed.transfer['activeTransferMs'] ?? 0,
        retryTransferRequests: consumed.transfer['retryTransferRequests'] ?? 0,
      },
      globalSafety: {
        totalGeneratedRequests: consumed.global_safety['totalGeneratedRequests'] ?? 0,
        modelCostUnits: consumed.global_safety['modelCostUnits'] ?? 0,
        activeElapsedMs: consumed.global_safety['activeElapsedMs'] ?? 0,
      },
    };
    return budgetRemaining(workItem.budgetProfile, consumedBudget);
  }
}
