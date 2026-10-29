/**
 * T10 S1–S6 released-slice baseline: machine-readable descriptors plus the
 * fail-closed loader that binds them to the live canonical registry.
 *
 * Two trust levels, labeled honestly per slice:
 *  - S1 `FULL_ORACLE` — the direct journey is asserted end-to-end against
 *    real loopback bytes and the frozen terminal vocabulary.
 *  - S2–S6 `DESCRIPTOR_REGISTRY_MATCH` — the descriptor is proven consistent
 *    with the canonical support-slice registry and the frozen operation
 *    vocabulary; the journey itself is NOT exercised (explicit `gap`).
 *
 * The installed-baseline binding (release SHA + real install) is owned by
 * the version Validation lanes and stays NOT_PROVEN here by design.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCOPE_PRIMITIVES,
  SUPPORT_SLICE_IDS,
  DOWNLOAD_OPERATIONS,
  decodeSupportSliceRef,
  supportSliceRepresentations,
} from './contracts.ts';

export type OracleLevel = 'FULL_ORACLE' | 'DESCRIPTOR_REGISTRY_MATCH';
export type CoverageExpectation =
  'NOT_APPLICABLE' | 'NOT_APPLICABLE_DESCRIPTOR' | 'REQUESTED_SCOPE_ACCOUNTING_DESCRIPTOR';
export type InstalledBaselineStatus = 'NOT_PROVEN_DESCRIPTOR_ONLY';

export interface CoverageDimensionDescriptor {
  readonly expectation: CoverageExpectation;
  readonly basis: string;
}

export interface IntentVocabularyDescriptor {
  readonly t01IntentSlice: string | null;
  readonly t01OperationVocabulary: readonly string[];
}

export interface BudgetSemanticsDescriptor {
  readonly forbiddenAsComplete: readonly string[];
  readonly note: string;
}

export interface OracleDescriptor {
  readonly level: OracleLevel;
  readonly harness: string;
  readonly assertions: readonly string[];
  readonly gap?: string | undefined;
}

export interface InstalledBaselineDescriptor {
  readonly status: InstalledBaselineStatus;
  readonly owner: string;
  readonly requiredValidation: string;
}

/** Frozen S1 terminal vocabulary the executable projection must reproduce. */
export interface TerminalVocabularyDescriptor {
  readonly requestFulfillment: string;
  readonly targetResolution: string;
  readonly selectionAcquisition: string;
  readonly coverage: string;
  readonly stopReason: string;
  readonly validationSummary: {
    readonly status: string;
    readonly passedCount: number;
    readonly failedCount: number;
  };
}

/** Allowed honest non-completion values (subset membership, never exhaustive). */
export interface HonestFailureVocabularyDescriptor {
  readonly requestFulfillment: readonly string[];
  readonly selectionAcquisition: readonly string[];
  readonly stopReason: readonly string[];
}

export interface SliceBaselineDescriptor {
  readonly sliceId: string;
  readonly title: string;
  readonly surfaceClass: string;
  readonly defaultContinuation: { readonly kind: string };
  readonly requiredValidationLayers: readonly string[];
  readonly scopePrimitive: string;
  readonly coverageDimension: CoverageDimensionDescriptor;
  readonly intentVocabulary: IntentVocabularyDescriptor;
  readonly budgetSemantics: BudgetSemanticsDescriptor;
  readonly oracle: OracleDescriptor;
  readonly installedBaseline: InstalledBaselineDescriptor;
  /** Only FULL_ORACLE slices carry an executable terminal expectation. */
  readonly terminalVocabulary?: TerminalVocabularyDescriptor;
  readonly honestFailureVocabulary?: HonestFailureVocabularyDescriptor;
}

export interface SliceBaseline {
  readonly schema: string;
  readonly baselineId: string;
  readonly baselineVersion: number;
  readonly frozenPack: string;
  readonly installedBaselineStatus: string;
  readonly honestyNote: string;
  readonly slices: readonly SliceBaselineDescriptor[];
}

const TOP_LEVEL_KEYS = [
  'schema',
  'baselineId',
  'baselineVersion',
  'frozenPack',
  'canonicalVocabularySource',
  'installedBaselineStatus',
  'honestyNote',
  'slices',
] as const;

const SLICE_KEYS = [
  'sliceId',
  'title',
  'surfaceClass',
  'defaultContinuation',
  'requiredValidationLayers',
  'scopePrimitive',
  'coverageDimension',
  'intentVocabulary',
  'budgetSemantics',
  'terminalVocabulary',
  'honestFailureVocabulary',
  'oracle',
  'installedBaseline',
] as const;

/** Loader-local refusal type; loader errors must be exhaustive, never partial. */
class BaselineFormatError extends Error {}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BaselineFormatError(`${where} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  keys: readonly string[],
  allowed: readonly string[],
  where: string,
): void {
  for (const key of keys) {
    if (!allowed.includes(key)) {
      throw new BaselineFormatError(`${where} has unknown field '${key}' (no-widening decode)`);
    }
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BaselineFormatError(`${where} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new BaselineFormatError(`${where} must be an array of strings`);
  }
  return value;
}

/** Decode the baseline document fail-closed (unknown fields refused). */
export function decodeSliceBaseline(input: unknown): SliceBaseline {
  const top = requireObject(input, 'baseline');
  rejectUnknownKeys(Object.keys(top), TOP_LEVEL_KEYS, 'baseline');
  const slicesRaw = top['slices'];
  if (!Array.isArray(slicesRaw)) {
    throw new BaselineFormatError('baseline.slices must be an array');
  }
  const slices = slicesRaw.map((entry, index) =>
    decodeSliceDescriptor(entry, `slices[${String(index)}]`),
  );
  return {
    schema: requireString(top['schema'], 'baseline.schema'),
    baselineId: requireString(top['baselineId'], 'baseline.baselineId'),
    baselineVersion: requireInteger(top['baselineVersion'], 'baseline.baselineVersion'),
    frozenPack: requireString(top['frozenPack'], 'baseline.frozenPack'),
    installedBaselineStatus: requireString(
      top['installedBaselineStatus'],
      'baseline.installedBaselineStatus',
    ),
    honestyNote: requireString(top['honestyNote'], 'baseline.honestyNote'),
    slices,
  };
}

function requireInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new BaselineFormatError(`${where} must be a safe integer`);
  }
  return value;
}

function decodeSliceDescriptor(input: unknown, where: string): SliceBaselineDescriptor {
  const record = requireObject(input, where);
  rejectUnknownKeys(Object.keys(record), SLICE_KEYS, where);
  const sliceId = requireString(record['sliceId'], `${where}.sliceId`);
  const layers = requireStringArray(
    record['requiredValidationLayers'],
    `${where}.requiredValidationLayers`,
  );
  const coverage = requireObject(record['coverageDimension'], `${where}.coverageDimension`);
  const intent = requireObject(record['intentVocabulary'], `${where}.intentVocabulary`);
  const budget = requireObject(record['budgetSemantics'], `${where}.budgetSemantics`);
  const oracle = requireObject(record['oracle'], `${where}.oracle`);
  const installed = requireObject(record['installedBaseline'], `${where}.installedBaseline`);
  const continuation = requireObject(record['defaultContinuation'], `${where}.defaultContinuation`);
  const oracleGap = oracle['gap'];
  return {
    sliceId,
    title: requireString(record['title'], `${where}.title`),
    surfaceClass: requireString(record['surfaceClass'], `${where}.surfaceClass`),
    defaultContinuation: {
      kind: requireString(continuation['kind'], `${where}.defaultContinuation.kind`),
    },
    requiredValidationLayers: layers,
    scopePrimitive: requireString(record['scopePrimitive'], `${where}.scopePrimitive`),
    coverageDimension: {
      expectation: requireString(
        coverage['expectation'],
        `${where}.coverageDimension.expectation`,
      ) as CoverageExpectation,
      basis: requireString(coverage['basis'], `${where}.coverageDimension.basis`),
    },
    intentVocabulary: {
      t01IntentSlice:
        intent['t01IntentSlice'] === null
          ? null
          : requireString(intent['t01IntentSlice'], `${where}.intentVocabulary.t01IntentSlice`),
      t01OperationVocabulary: requireStringArray(
        intent['t01OperationVocabulary'],
        `${where}.intentVocabulary.t01OperationVocabulary`,
      ),
    },
    budgetSemantics: {
      forbiddenAsComplete: requireStringArray(
        budget['forbiddenAsComplete'],
        `${where}.budgetSemantics.forbiddenAsComplete`,
      ),
      note: requireString(budget['note'], `${where}.budgetSemantics.note`),
    },
    oracle: {
      level: requireString(oracle['level'], `${where}.oracle.level`) as OracleLevel,
      harness: requireString(oracle['harness'], `${where}.oracle.harness`),
      assertions: requireStringArray(oracle['assertions'], `${where}.oracle.assertions`),
      gap: oracleGap === undefined ? undefined : requireString(oracleGap, `${where}.oracle.gap`),
    },
    installedBaseline: {
      status: requireString(
        installed['status'],
        `${where}.installedBaseline.status`,
      ) as InstalledBaselineStatus,
      owner: requireString(installed['owner'], `${where}.installedBaseline.owner`),
      requiredValidation: requireString(
        installed['requiredValidation'],
        `${where}.installedBaseline.requiredValidation`,
      ),
    },
    terminalVocabulary: decodeTerminalVocabulary(
      record['terminalVocabulary'],
      `${where}.terminalVocabulary`,
    ),
    honestFailureVocabulary: decodeHonestFailureVocabulary(
      record['honestFailureVocabulary'],
      `${where}.honestFailureVocabulary`,
    ),
  };
}

function decodeTerminalVocabulary(
  value: unknown,
  where: string,
): TerminalVocabularyDescriptor | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = requireObject(value, where);
  const summary = requireObject(record['validationSummary'], `${where}.validationSummary`);
  return {
    requestFulfillment: requireString(record['requestFulfillment'], `${where}.requestFulfillment`),
    targetResolution: requireString(record['targetResolution'], `${where}.targetResolution`),
    selectionAcquisition: requireString(
      record['selectionAcquisition'],
      `${where}.selectionAcquisition`,
    ),
    coverage: requireString(record['coverage'], `${where}.coverage`),
    stopReason: requireString(record['stopReason'], `${where}.stopReason`),
    validationSummary: {
      status: requireString(summary['status'], `${where}.validationSummary.status`),
      passedCount: requireInteger(summary['passedCount'], `${where}.validationSummary.passedCount`),
      failedCount: requireInteger(summary['failedCount'], `${where}.validationSummary.failedCount`),
    },
  };
}

function decodeHonestFailureVocabulary(
  value: unknown,
  where: string,
): HonestFailureVocabularyDescriptor | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = requireObject(value, where);
  return {
    requestFulfillment: requireStringArray(
      record['requestFulfillment'],
      `${where}.requestFulfillment`,
    ),
    selectionAcquisition: requireStringArray(
      record['selectionAcquisition'],
      `${where}.selectionAcquisition`,
    ),
    stopReason: requireStringArray(record['stopReason'], `${where}.stopReason`),
  };
}

/** Load and decode the frozen baseline JSON shipped with this harness. */
export function loadSliceBaseline(): SliceBaseline {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '..', 'baselines', 'slices-s1-s6.baseline.json'), 'utf8');
  return decodeSliceBaseline(JSON.parse(raw) as unknown);
}

export interface RegistryMatchResult {
  readonly ok: boolean;
  readonly mismatches: readonly string[];
}

/**
 * Cross-check every descriptor against the LIVE canonical registry: the
 * canonical S1–S6 set, slice id, title, surface class, default continuation
 * and required validation layers must match decodeSupportSliceRef exactly;
 * scope primitives and the operation vocabulary must stay in their frozen
 * enums. Registry drift against the baseline fails here — loudly.
 */
export function assertBaselineMatchesRegistry(baseline: SliceBaseline): RegistryMatchResult {
  const mismatches: string[] = [];
  const descriptorIds = baseline.slices.map((slice) => slice.sliceId);
  if (descriptorIds.length !== SUPPORT_SLICE_IDS.length) {
    mismatches.push(
      `descriptor count ${String(descriptorIds.length)} != canonical slice count ${String(SUPPORT_SLICE_IDS.length)}`,
    );
  }
  for (const sliceId of SUPPORT_SLICE_IDS) {
    if (!descriptorIds.includes(sliceId)) {
      mismatches.push(`canonical slice '${sliceId}' has no descriptor`);
    }
  }
  const canonical = supportSliceRepresentations();
  for (const descriptor of baseline.slices) {
    const ref = decodeSupportSliceRef({ sliceId: descriptor.sliceId });
    if (!ref.ok) {
      mismatches.push(`descriptor '${descriptor.sliceId}' is not a canonical slice id`);
      continue;
    }
    const live = canonical.find((slice) => slice.sliceId === descriptor.sliceId);
    if (live === undefined) {
      mismatches.push(`descriptor '${descriptor.sliceId}' missing from live registry listing`);
      continue;
    }
    if (descriptor.title !== live.title) {
      mismatches.push(
        `'${descriptor.sliceId}' title drift: descriptor '${descriptor.title}' vs registry '${live.title}'`,
      );
    }
    if (descriptor.surfaceClass !== live.surfaceClass) {
      mismatches.push(
        `'${descriptor.sliceId}' surfaceClass drift: '${descriptor.surfaceClass}' vs '${live.surfaceClass}'`,
      );
    }
    if (descriptor.defaultContinuation.kind !== live.defaultContinuation.kind) {
      mismatches.push(
        `'${descriptor.sliceId}' defaultContinuation drift: '${descriptor.defaultContinuation.kind}' vs '${live.defaultContinuation.kind}'`,
      );
    }
    if (
      descriptor.requiredValidationLayers.length !== live.requiredValidationLayers.length ||
      descriptor.requiredValidationLayers.some(
        (layer, index) => layer !== live.requiredValidationLayers[index],
      )
    ) {
      mismatches.push(
        `'${descriptor.sliceId}' requiredValidationLayers drift: [${descriptor.requiredValidationLayers.join(', ')}] vs [${live.requiredValidationLayers.join(', ')}]`,
      );
    }
    if (!SCOPE_PRIMITIVES.includes(descriptor.scopePrimitive as never)) {
      mismatches.push(
        `'${descriptor.sliceId}' scopePrimitive '${descriptor.scopePrimitive}' is outside the frozen scope vocabulary`,
      );
    }
    for (const operation of descriptor.intentVocabulary.t01OperationVocabulary) {
      if (!(DOWNLOAD_OPERATIONS as readonly string[]).includes(operation)) {
        mismatches.push(
          `'${descriptor.sliceId}' names operation '${operation}' outside the frozen v0.2 vocabulary`,
        );
      }
    }
    if (descriptor.intentVocabulary.t01IntentSlice !== null) {
      const declared = descriptor.intentVocabulary.t01IntentSlice;
      if (declared !== descriptor.sliceId) {
        mismatches.push(`'${descriptor.sliceId}' declares T01 intent slice '${declared}'`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** The only slice whose journey oracle is executable at this stage. */
export function fullOracleSlices(baseline: SliceBaseline): readonly SliceBaselineDescriptor[] {
  return baseline.slices.filter((slice) => slice.oracle.level === 'FULL_ORACLE');
}

/** Descriptor-level slices must carry an explicit, non-empty honesty gap. */
export function descriptorOnlySlices(baseline: SliceBaseline): readonly SliceBaselineDescriptor[] {
  return baseline.slices.filter((slice) => slice.oracle.level === 'DESCRIPTOR_REGISTRY_MATCH');
}
