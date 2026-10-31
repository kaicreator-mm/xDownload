export type FixtureClassification =
  | 'REAL_LOOPBACK_NETWORK'
  | 'REAL_TEMP_FILESYSTEM'
  | 'INJECTED_FAILURE_FAKE'
  | 'PURE_CONTRACT';

export interface V021ScenarioCase {
  readonly id: string;
  readonly required: true;
  readonly classifications: readonly FixtureClassification[];
  readonly evidencePaths: readonly string[];
  readonly expectedTruth: string;
  readonly installedGate: 'NOT_PROVEN' | 'SEPARATE_GATE_REQUIRED';
}

export const V021_SCENARIO_CORPUS: readonly V021ScenarioCase[] = [
  {
    id: 'restart-replay-no-duplicate-effect',
    required: true,
    classifications: ['REAL_LOOPBACK_NETWORK', 'REAL_TEMP_FILESYSTEM'],
    evidencePaths: ['packages/core-runtime/test/process-restart.test.ts'],
    expectedTruth: 'recovery re-derives durable state and does not repeat an accepted effect',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'cancel-mid-transfer-remains-partial',
    required: true,
    classifications: ['REAL_LOOPBACK_NETWORK'],
    evidencePaths: ['packages/direct-acquisition/test/cancel-abort.test.ts'],
    expectedTruth: 'abort stops the socket and partial bytes never become COMPLETE',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'unknown-is-not-zero-or-success',
    required: true,
    classifications: ['PURE_CONTRACT'],
    evidencePaths: ['packages/domain-contracts/test/job-projection.test.ts'],
    expectedTruth: 'unknown total and UNKNOWN status remain explicit and non-terminal',
    installedGate: 'NOT_PROVEN',
  },
  {
    id: 'duplicate-command-single-effect',
    required: true,
    classifications: ['REAL_LOOPBACK_NETWORK', 'REAL_TEMP_FILESYSTEM'],
    evidencePaths: ['packages/core-runtime/test/duplicate-command.test.ts'],
    expectedTruth: 'same idempotency identity converges to one accepted lineage and one artifact',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'changed-validator-never-appends',
    required: true,
    classifications: ['REAL_LOOPBACK_NETWORK'],
    evidencePaths: ['packages/direct-acquisition/test/resume-validators.test.ts'],
    expectedTruth: 'changed or missing representation identity cannot append old partial bytes',
    installedGate: 'NOT_PROVEN',
  },
  {
    id: 'bad-path-and-containment-escape',
    required: true,
    classifications: ['REAL_TEMP_FILESYSTEM'],
    evidencePaths: ['packages/download-domain-host/src/direct/direct-acquisition-bridge.test.ts'],
    expectedTruth: 'invalid paths are refused and output remains under the authorized root',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'permission-and-disk-full-failure',
    required: true,
    classifications: ['INJECTED_FAILURE_FAKE'],
    evidencePaths: ['tests/v0.2.1/controlled-fixtures.test.ts'],
    expectedTruth: 'injected publication failures leave no accepted artifact; real OS failure remains NOT_PROVEN',
    installedGate: 'NOT_PROVEN',
  },
  {
    id: 'host-permit-mismatch-zero-effects',
    required: true,
    classifications: ['PURE_CONTRACT', 'REAL_LOOPBACK_NETWORK'],
    evidencePaths: ['packages/download-domain-host/src/media/media-acquisition-bridge.test.ts'],
    expectedTruth: 'mismatched Host/request/lineage permit refuses before network and file effects',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'corrupt-output-not-accepted',
    required: true,
    classifications: ['REAL_TEMP_FILESYSTEM'],
    evidencePaths: [
      'packages/download-domain-host/src/direct/direct-acquisition-bridge.test.ts',
      'packages/download-domain-host/src/media/media-acquisition-bridge.test.ts',
    ],
    expectedTruth: 'digest or final media validation mismatch leaves no accepted artifact',
    installedGate: 'SEPARATE_GATE_REQUIRED',
  },
  {
    id: 'lineage-owner-conflict-refused',
    required: true,
    classifications: ['PURE_CONTRACT'],
    evidencePaths: ['packages/domain-contracts/test/job-projection.test.ts'],
    expectedTruth: 'ambiguous or conflicting old-Core/new-K facts return typed REFUSED',
    installedGate: 'NOT_PROVEN',
  },
  {
    id: 'secret-redaction-at-exit-sinks',
    required: true,
    classifications: ['PURE_CONTRACT'],
    evidencePaths: [
      'packages/browser-observation/test/sink-redaction.test.ts',
      'packages/ai-proposal/test/secret-redaction.test.ts',
    ],
    expectedTruth: 'raw secrets and sentinel values do not cross durable/model/log sinks',
    installedGate: 'NOT_PROVEN',
  },
] as const;

export function isFixtureClassification(value: string): value is FixtureClassification {
  return (
    value === 'REAL_LOOPBACK_NETWORK' ||
    value === 'REAL_TEMP_FILESYSTEM' ||
    value === 'INJECTED_FAILURE_FAKE' ||
    value === 'PURE_CONTRACT'
  );
}
