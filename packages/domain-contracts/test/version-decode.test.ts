/**
 * TEST_MATRIX suite `schema-versioning` + the required negative decode cases.
 */
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_CONTRACTS_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_MAJOR_VERSIONS,
  assertContractTransition,
  assertExplicitVersionTransition,
  assertSnapshotImmutable,
  currentSchemaIdentity,
  decodeAcquisitionContract,
  decodeContinuationScope,
  decodeLifecycleBudget,
  decodeRequestedScope,
  decodeSchemaIdentity,
  decodeTerminalResult,
  deriveSuccessorContract,
  makeContractId,
  validateTerminalResult,
} from '../src/index.ts';
import {
  confirmedSnapshot,
  decodeOk,
  expectCode,
  rawCollectionContract,
  rawSingleResourceContract,
  rawTerminalResult,
  schemaIdentity,
} from './helpers.ts';

describe('schema-versioning: explicit version at boundaries', () => {
  it('stamps canonical values with the current explicit schema identity', () => {
    expect(currentSchemaIdentity()).toEqual({
      schema: 'xdownload.domain-contracts',
      version: DOMAIN_CONTRACTS_SCHEMA_VERSION,
    });
    const contract = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
    expect(contract.schemaIdentity).toEqual(schemaIdentity('1.0.0'));
  });

  it('decodes known compatible versions deterministically', () => {
    for (const version of ['1.0.0', '1.2.9']) {
      expect(decodeOk(decodeSchemaIdentity(schemaIdentity(version)))).toEqual(
        schemaIdentity(version),
      );
      const a = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
      const b = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
      expect(a).toEqual(b);
    }
    expect(SUPPORTED_SCHEMA_MAJOR_VERSIONS).toEqual([1]);
  });

  it('fails closed on unknown or incompatible versions', () => {
    expectCode(decodeSchemaIdentity(schemaIdentity('2.0.0')), 'UNSUPPORTED_SCHEMA_VERSION');
    expectCode(
      decodeSchemaIdentity({ schema: 'xdownload.domain-contracts' }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      decodeSchemaIdentity({ schema: 'other.schema', version: '1.0.0' }),
      'UNKNOWN_SCHEMA_IDENTITY',
    );
    expectCode(decodeSchemaIdentity(schemaIdentity('1.0')), 'MALFORMED_REQUIRED_FIELD');
  });

  it('rejects canonical values whose boundary version is missing or unsupported', () => {
    const missing = rawSingleResourceContract();
    delete missing['schemaIdentity'];
    expectCode(decodeAcquisitionContract(missing), 'MALFORMED_REQUIRED_FIELD');
    expectCode(
      decodeAcquisitionContract(
        rawSingleResourceContract({ schemaIdentity: schemaIdentity('3.1.4') }),
      ),
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });

  it('explicit transitions allow same-major and reject different-major without mutating history', () => {
    expect(decodeOk(assertExplicitVersionTransition('1.0.0', '1.1.0'))).toBeUndefined();
    const rejected = assertExplicitVersionTransition('1.0.0', '2.0.0');
    expectCode(rejected, 'INCOMPATIBLE_VERSION_TRANSITION', 'schema-versioning');
    // historical identity is never rewritten: the 1.0.0 stamp remains intact
    const contract = decodeOk(decodeAcquisitionContract(rawSingleResourceContract()));
    expect(contract.schemaIdentity).toEqual(schemaIdentity('1.0.0'));
  });
});

describe('negative decode cases (TEST_MATRIX)', () => {
  it('malformed-required-field: missing requestedTarget', () => {
    const raw = rawSingleResourceContract();
    delete raw['requestedTarget'];
    expectCode(decodeAcquisitionContract(raw), 'MISSING_REQUIRED_FIELD');
  });

  it('unknown-authoritative-enum-value: unknown automation mode', () => {
    expectCode(
      decodeAcquisitionContract(rawSingleResourceContract({ automationMode: 'WARP_DRIVE' })),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('unsupported-schema-version', () => {
    expectCode(
      decodeAcquisitionContract(rawCollectionContract({ schemaIdentity: schemaIdentity('9.9.9') })),
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });

  it('incompatible-version-transition', () => {
    expectCode(
      assertExplicitVersionTransition('1.0.0', '2.0.0'),
      'INCOMPATIBLE_VERSION_TRANSITION',
    );
  });

  it('duplicate-logical-identity-with-conflicting-semantics', () => {
    expectCode(
      decodeRequestedScope({
        kind: 'explicit_member_set',
        memberIds: ['member-001', 'member-001'],
      }),
      'DUPLICATE_IDENTITY',
    );
    expectCode(makeContractId(''), 'MALFORMED_REQUIRED_FIELD');
  });

  it('membership-count-equal-identity-set-different', () => {
    const original = confirmedSnapshot();
    const drifted = confirmedSnapshot({
      snapshotId: 'snapshot-001',
      requestedMemberBasis: {
        kind: 'EXPLICIT_IDENTITIES',
        memberIds: ['member-001', 'member-002', 'member-009'],
      },
      selectedMemberIds: ['member-001', 'member-002', 'member-009'],
      selectionClaims: [
        {
          kind: 'BATCH',
          confirmationType: 'CONFIRM_SELECTION',
          memberRefs: ['member-001', 'member-002', 'member-009'],
        },
      ],
    });
    expectCode(assertSnapshotImmutable(original, drifted), 'MEMBERSHIP_DRIFT');
  });

  it('continuation-added-after-confirmation-without-successor', () => {
    const confirmed = decodeOk(decodeAcquisitionContract(rawCollectionContract()));
    const mutated = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({ continuationScope: { kind: 'DECLARED_BATCH_COUNT', count: 2 } }),
      ),
    );
    expectCode(assertContractTransition(confirmed, mutated), 'SCOPE_MUTATION');
    // the same change through a successor identity is legal
    const successor = decodeOk(
      deriveSuccessorContract(
        confirmed,
        { continuationScope: mutated.continuationScope },
        'CONTINUATION_ADDITION',
      ),
    );
    expect(decodeOk(assertContractTransition(confirmed, successor))).toBeUndefined();
  });

  it('budget-used-as-scope', () => {
    expectCode(
      decodeRequestedScope({ kind: 'discovery', domain: 'discovery', maxGeneratedRequests: 5 }),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(
      decodeLifecycleBudget({ kind: 'single_resource', targetId: 'target-file-001' }),
      'UNKNOWN_ENUM_VALUE',
    );
    expectCode(decodeContinuationScope({ kind: 'UNTIL_BUDGET_EXHAUSTED' }), 'UNKNOWN_ENUM_VALUE');
  });

  it('auth-context-used-to-rewrite-requested-scope', () => {
    const confirmed = decodeOk(decodeAcquisitionContract(rawCollectionContract()));
    const rewritten = decodeOk(
      decodeAcquisitionContract(
        rawCollectionContract({ authorizationContextRef: 'authctx/other-999' }),
      ),
    );
    expectCode(assertContractTransition(confirmed, rewritten), 'SCOPE_MUTATION');
    // decoding never rewrote the requested scope: identity stays identical
    expect(rewritten.requestedScope).toEqual(confirmed.requestedScope);
  });

  it('invalid-result-status-combination: rejected at the semantic layer, never normalized', () => {
    const result = decodeOk(
      decodeTerminalResult(
        rawTerminalResult({
          targetResolution: 'PARTIAL',
          coverage: 'VERIFIED_COMPLETE',
        }),
      ),
    );
    expectCode(
      validateTerminalResult(result, {
        intentType: 'COLLECTION',
        scopeKind: 'entire_supported_collection',
        selectedMemberCount: 3,
      }),
      'INVALID_RESULT_COMBINATION',
    );
  });

  it('raw-secret-field-in-canonical-public-contract', () => {
    expectCode(
      decodeAcquisitionContract(rawSingleResourceContract({ cookie: 'session=attacker-value' })),
      'RAW_SECRET_FIELD',
    );
    expectCode(
      decodeAcquisitionContract(rawSingleResourceContract({ authorization: 'Bearer raw-token' })),
      'RAW_SECRET_FIELD',
    );
  });
});
