/**
 * T002 lifecycle budget domains — constraints only, never scope.
 *
 * DiscoveryBudget / TransferBudget / GlobalSafetyBudget are distinct domains
 * (PRD §15): they stop work but cannot define, enlarge, narrow or redefine
 * requested scope. Retry/restart/resume/repair inherit remaining budgets and
 * never imply replenishment. The durable budget ledger belongs to the Core
 * scheduler; this layer makes illegal reinterpretations rejectable.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { type EffectId } from './ids.ts';
import { asRecord, rejectRawSecretFields, rejectUnknownFields, requireInteger } from './decode.ts';

export type BudgetDomain = 'discovery' | 'transfer' | 'global_safety';

export interface DiscoveryBudget {
  readonly domain: 'discovery';
  readonly maxGeneratedRequests?: number;
  readonly maxNavigationActions?: number;
  readonly maxModelCalls?: number;
}

export interface TransferBudget {
  readonly domain: 'transfer';
  readonly maxBytes?: number;
  readonly maxSegments?: number;
  readonly maxActiveTransferMs?: number;
  readonly maxRetryTransferRequests?: number;
}

export interface GlobalSafetyBudget {
  readonly domain: 'global_safety';
  readonly maxTotalGeneratedRequests?: number;
  readonly maxModelCostUnits?: number;
  readonly maxActiveElapsedMs?: number;
}

export type LifecycleBudget = DiscoveryBudget | TransferBudget | GlobalSafetyBudget;

/** All three lifecycle budget domains; a budget profile is always complete. */
export interface BudgetProfile {
  readonly discovery: DiscoveryBudget;
  readonly transfer: TransferBudget;
  readonly globalSafety: GlobalSafetyBudget;
}

export interface ConsumedBudget {
  readonly discovery: {
    readonly generatedRequests: number;
    readonly navigationActions: number;
    readonly modelCalls: number;
  };
  readonly transfer: {
    readonly bytes: number;
    readonly segments: number;
    readonly activeTransferMs: number;
    readonly retryTransferRequests: number;
  };
  readonly globalSafety: {
    readonly totalGeneratedRequests: number;
    readonly modelCostUnits: number;
    readonly activeElapsedMs: number;
  };
}

export interface DomainBudgetRemaining {
  readonly exhausted: boolean;
  readonly perLimit: Readonly<Record<string, number>>;
}

export interface BudgetRemaining {
  readonly discovery: DomainBudgetRemaining;
  readonly transfer: DomainBudgetRemaining;
  readonly globalSafety: DomainBudgetRemaining;
}

const BUDGET_KEYS_BY_DOMAIN: Readonly<Record<BudgetDomain, readonly string[]>> = Object.freeze({
  discovery: ['domain', 'maxGeneratedRequests', 'maxNavigationActions', 'maxModelCalls'],
  transfer: [
    'domain',
    'maxBytes',
    'maxSegments',
    'maxActiveTransferMs',
    'maxRetryTransferRequests',
  ],
  global_safety: ['domain', 'maxTotalGeneratedRequests', 'maxModelCostUnits', 'maxActiveElapsedMs'],
});

function decodeOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: ValidationDiagnostic[],
): number | undefined {
  if (!(key in record) || record[key] === undefined) {
    return undefined;
  }
  const value = requireInteger(record, key, path);
  if (!value.ok) {
    diagnostics.push(...value.diagnostics);
    return undefined;
  }
  if (value.value < 0) {
    diagnostics.push(
      diagnostic('MALFORMED_REQUIRED_FIELD', `${path}.${key}`, 'budget limits must be >= 0'),
    );
    return undefined;
  }
  return value.value;
}

/** Decode one lifecycle budget; the `domain` discriminant is mandatory and unknown domains fail closed. */
export function decodeLifecycleBudget(value: unknown): DomainValidationResult<LifecycleBudget> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'budget'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'budget'), diagnostics);
  const domain = record['domain'];
  if (typeof domain !== 'string' || !['discovery', 'transfer', 'global_safety'].includes(domain)) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'budget.domain',
        `unknown budget domain '${String(domain)}'; discovery/transfer/global_safety are the only lifecycle budget domains`,
        'PRD-§15',
      ),
    );
    return fail(diagnostics);
  }
  pushAll(
    rejectUnknownFields(record, BUDGET_KEYS_BY_DOMAIN[domain as BudgetDomain]!, 'budget'),
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  const budgetPath = 'budget';
  if (domain === 'discovery') {
    const budget: DiscoveryBudget = {
      domain: 'discovery',
      maxGeneratedRequests: decodeOptionalPositiveInteger(
        record,
        'maxGeneratedRequests',
        budgetPath,
        diagnostics,
      ),
      maxNavigationActions: decodeOptionalPositiveInteger(
        record,
        'maxNavigationActions',
        budgetPath,
        diagnostics,
      ),
      maxModelCalls: decodeOptionalPositiveInteger(
        record,
        'maxModelCalls',
        budgetPath,
        diagnostics,
      ),
    };
    if (diagnostics.length > 0) {
      return fail(diagnostics);
    }
    return ok(deepFreeze(budget));
  }
  if (domain === 'transfer') {
    const budget: TransferBudget = {
      domain: 'transfer',
      maxBytes: decodeOptionalPositiveInteger(record, 'maxBytes', budgetPath, diagnostics),
      maxSegments: decodeOptionalPositiveInteger(record, 'maxSegments', budgetPath, diagnostics),
      maxActiveTransferMs: decodeOptionalPositiveInteger(
        record,
        'maxActiveTransferMs',
        budgetPath,
        diagnostics,
      ),
      maxRetryTransferRequests: decodeOptionalPositiveInteger(
        record,
        'maxRetryTransferRequests',
        budgetPath,
        diagnostics,
      ),
    };
    if (diagnostics.length > 0) {
      return fail(diagnostics);
    }
    return ok(deepFreeze(budget));
  }
  const budget: GlobalSafetyBudget = {
    domain: 'global_safety',
    maxTotalGeneratedRequests: decodeOptionalPositiveInteger(
      record,
      'maxTotalGeneratedRequests',
      budgetPath,
      diagnostics,
    ),
    maxModelCostUnits: decodeOptionalPositiveInteger(
      record,
      'maxModelCostUnits',
      budgetPath,
      diagnostics,
    ),
    maxActiveElapsedMs: decodeOptionalPositiveInteger(
      record,
      'maxActiveElapsedMs',
      budgetPath,
      diagnostics,
    ),
  };
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(budget));
}

/**
 * Decode the complete budget profile (PRD §15). The three slot keys are
 * authoritative and every decoded slot's `domain` discriminant must
 * correspond to its slot: a mismatched or contradictory discriminant fails
 * closed and is never silently recast or overwritten.
 */
export function decodeBudgetProfile(value: unknown): DomainValidationResult<BudgetProfile> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'budgetProfile'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectRawSecretFields(record, 'budgetProfile'), diagnostics);
  pushAll(
    rejectUnknownFields(record, ['discovery', 'transfer', 'globalSafety'], 'budgetProfile'),
    diagnostics,
  );
  for (const key of ['discovery', 'transfer', 'globalSafety']) {
    if (!(key in record) || record[key] === undefined) {
      diagnostics.push(
        diagnostic(
          'MISSING_REQUIRED_FIELD',
          `budgetProfile.${key}`,
          'budget profile requires discovery, transfer and globalSafety domains',
        ),
      );
    }
  }
  let discovery: DiscoveryBudget | undefined;
  const decodedDiscovery = unwrap(decodeLifecycleBudget(record['discovery']), diagnostics);
  if (decodedDiscovery !== undefined) {
    if (decodedDiscovery.domain === 'discovery') {
      discovery = decodedDiscovery;
    } else {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'budgetProfile.discovery.domain',
          `budget slot 'discovery' requires the discovery domain; got declared domain '${decodedDiscovery.domain}'`,
          'PRD-§15',
        ),
      );
    }
  }
  let transfer: TransferBudget | undefined;
  const decodedTransfer = unwrap(decodeLifecycleBudget(record['transfer']), diagnostics);
  if (decodedTransfer !== undefined) {
    if (decodedTransfer.domain === 'transfer') {
      transfer = decodedTransfer;
    } else {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'budgetProfile.transfer.domain',
          `budget slot 'transfer' requires the transfer domain; got declared domain '${decodedTransfer.domain}'`,
          'PRD-§15',
        ),
      );
    }
  }
  const globalSafetyRaw = record['globalSafety'];
  const globalSafetyRecord = unwrap(
    asRecord(globalSafetyRaw, 'budgetProfile.globalSafety'),
    diagnostics,
  );
  let globalSafety: GlobalSafetyBudget | undefined;
  if (globalSafetyRecord !== undefined) {
    const declaredDomain = globalSafetyRecord['domain'];
    if (declaredDomain !== undefined && declaredDomain !== 'global_safety') {
      diagnostics.push(
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'budgetProfile.globalSafety.domain',
          `budget slot 'globalSafety' declared domain '${String(declaredDomain)}'; a contradictory domain discriminant is rejected, never silently overwritten`,
          'PRD-§15',
        ),
      );
    } else {
      const decoded = decodeLifecycleBudget({ ...globalSafetyRecord, domain: 'global_safety' });
      const budget = unwrap(decoded, diagnostics);
      if (budget !== undefined && budget.domain === 'global_safety') {
        globalSafety = budget;
      }
    }
  }
  if (
    diagnostics.length > 0 ||
    discovery === undefined ||
    transfer === undefined ||
    globalSafety === undefined
  ) {
    return fail(
      diagnostics.length > 0
        ? diagnostics
        : [
            diagnostic(
              'MISSING_REQUIRED_FIELD',
              'budgetProfile',
              'budget profile requires discovery, transfer and globalSafety domains',
            ),
          ],
    );
  }
  return ok(deepFreeze({ discovery, transfer, globalSafety }));
}

/**
 * Inherited remaining budget after consumption. Every domain remains bounded
 * by its original limits — remaining is capped at zero, never replenished
 * (PRD §15.4, counterexample C13/C28).
 */
export function budgetRemaining(profile: BudgetProfile, consumed: ConsumedBudget): BudgetRemaining {
  return deepFreeze({
    discovery: domainRemaining(
      {
        generatedRequests: profile.discovery.maxGeneratedRequests,
        navigationActions: profile.discovery.maxNavigationActions,
        modelCalls: profile.discovery.maxModelCalls,
      },
      {
        generatedRequests: consumed.discovery.generatedRequests,
        navigationActions: consumed.discovery.navigationActions,
        modelCalls: consumed.discovery.modelCalls,
      },
    ),
    transfer: domainRemaining(
      {
        bytes: profile.transfer.maxBytes,
        segments: profile.transfer.maxSegments,
        activeTransferMs: profile.transfer.maxActiveTransferMs,
        retryTransferRequests: profile.transfer.maxRetryTransferRequests,
      },
      {
        bytes: consumed.transfer.bytes,
        segments: consumed.transfer.segments,
        activeTransferMs: consumed.transfer.activeTransferMs,
        retryTransferRequests: consumed.transfer.retryTransferRequests,
      },
    ),
    globalSafety: domainRemaining(
      {
        totalGeneratedRequests: profile.globalSafety.maxTotalGeneratedRequests,
        modelCostUnits: profile.globalSafety.maxModelCostUnits,
        activeElapsedMs: profile.globalSafety.maxActiveElapsedMs,
      },
      {
        totalGeneratedRequests: consumed.globalSafety.totalGeneratedRequests,
        modelCostUnits: consumed.globalSafety.modelCostUnits,
        activeElapsedMs: consumed.globalSafety.activeElapsedMs,
      },
    ),
  });
}

function domainRemaining(
  limits: Record<string, number | undefined>,
  consumed: Record<string, number>,
): DomainBudgetRemaining {
  const perLimit: Record<string, number> = {};
  let exhausted = false;
  let hasAnyLimit = false;
  for (const [limitKey, limit] of Object.entries(limits)) {
    if (limit === undefined) {
      continue;
    }
    hasAnyLimit = true;
    const used = consumed[limitKey] ?? 0;
    perLimit[limitKey] = Math.max(0, limit - used);
    if (limit - used <= 0) {
      exhausted = true;
    }
  }
  if (!hasAnyLimit) {
    exhausted = false;
  }
  return { exhausted, perLimit: deepFreeze(perLimit) };
}

/** DiscoveryBudget exhausted → no new discovery/navigation actions (PRD §15.4). */
export function canStartNewDiscoveryWork(remaining: BudgetRemaining): boolean {
  return !remaining.discovery.exhausted && !remaining.globalSafety.exhausted;
}

/**
 * Already-frozen selected targets MAY continue transfer when DiscoveryBudget
 * is exhausted, provided TransferBudget and GlobalSafetyBudget remain
 * (PRD §15.4, counterexample C28).
 */
export function canTransferAfterDiscoveryExhaustion(remaining: BudgetRemaining): boolean {
  return !remaining.transfer.exhausted && !remaining.globalSafety.exhausted;
}

/**
 * Effect identity deduplication semantics (counterexample C13): the same
 * effect identity must never be allocated twice; retry/restart reconcile by
 * lineage instead of blindly replaying allocation.
 */
export function assertNoDuplicateAllocation(
  allocated: readonly EffectId[],
  next: EffectId,
): DomainValidationResult<void> {
  if (allocated.includes(next)) {
    return fail([
      diagnostic(
        'DUPLICATE_ALLOCATION',
        'effectId',
        `effect '${next}' is already allocated; budget/effects cannot be double-allocated`,
        'C13',
      ),
    ]);
  }
  return ok(undefined);
}

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}

function pushAll(result: DomainValidationResult<void>, diagnostics: ValidationDiagnostic[]): void {
  if (!result.ok) {
    diagnostics.push(...result.diagnostics);
  }
}
