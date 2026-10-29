/**
 * v0.2 T07 — pure status projector tests (node:test, colocated in the T07
 * write set, mirroring the T01 contract-test pattern).
 *
 * Focus: the FAITHFUL projection contract — a status this adapter does not
 * recognize is UNKNOWN with the raw word preserved, never success, never
 * terminal; FAILED/CANCELLED stay terminal non-success with a bounded error
 * pair; only documented public field names are ever read.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  projectReceiptStatus,
  projectSnapshotStatus,
  DOMAIN_APP_STATUS_VOCABULARY,
} from './domain-app-status.ts';

describe('domain-app status vocabulary', () => {
  it('is the closed five-word set', () => {
    assert.deepEqual(
      [...DOMAIN_APP_STATUS_VOCABULARY],
      ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'],
    );
  });
});

describe('projectSnapshotStatus', () => {
  it('projects the recognized terminal words with terminal flags', () => {
    assert.deepEqual(projectSnapshotStatus({ status: 'SUCCEEDED' }), {
      status: 'SUCCEEDED',
      rawStatus: 'SUCCEEDED',
      terminal: true,
      error: null,
      unknownReason: null,
    });
    assert.equal(projectSnapshotStatus({ status: 'FAILED' }).terminal, true);
    assert.equal(projectSnapshotStatus({ status: 'CANCELLED' }).terminal, true);
  });

  it('projects accepted/pending as non-terminal RUNNING (A05: accepted/running are not terminal)', () => {
    for (const word of ['ACCEPTED', 'PENDING', 'RUNNING']) {
      const projection = projectSnapshotStatus({ status: word });
      assert.equal(projection.status, 'RUNNING');
      assert.equal(projection.terminal, false);
    }
  });

  it('projects FAILED with the bounded typed error pair when decodable', () => {
    assert.deepEqual(
      projectSnapshotStatus({
        status: 'FAILED',
        error: { code: 'HOST_FAULT_INJECTED', message: 'disk full' },
      }).error,
      {
        code: 'HOST_FAULT_INJECTED',
        message: 'disk full',
      },
    );
  });

  it('never invents an error pair: malformed/absent error fields stay null on FAILED', () => {
    assert.equal(projectSnapshotStatus({ status: 'FAILED' }).error, null);
    assert.equal(projectSnapshotStatus({ status: 'FAILED', error: 'boom' }).error, null);
    assert.equal(
      projectSnapshotStatus({ status: 'FAILED', error: { code: 7, message: 'x' } }).error,
      null,
    );
  });

  it('never projects an UNKNOWN as success or terminal', () => {
    for (const snapshot of [
      undefined,
      null,
      'succeeded',
      42,
      [],
      { status: 'OK' },
      { status: 'succeeded' },
      {},
      { status: 7 },
    ]) {
      const projection = projectSnapshotStatus(snapshot);
      assert.equal(
        projection.status,
        'UNKNOWN',
        `snapshot ${JSON.stringify(snapshot) ?? String(snapshot)} must stay UNKNOWN`,
      );
      assert.equal(projection.terminal, false);
    }
  });

  it('preserves unrecognized status words verbatim as rawStatus', () => {
    assert.equal(projectSnapshotStatus({ status: 'WEIRD_STATE' }).rawStatus, 'WEIRD_STATE');
    assert.equal(
      projectSnapshotStatus({ status: 'WEIRD_STATE' }).unknownReason,
      'unrecognized_status_word',
    );
  });

  it('reports the bounded unknown reasons', () => {
    assert.equal(projectSnapshotStatus('garbage').unknownReason, 'source_not_a_plain_object');
    assert.equal(projectSnapshotStatus({}).unknownReason, 'status_field_missing');
    assert.equal(projectSnapshotStatus({ status: 7 }).unknownReason, 'status_field_not_a_string');
    assert.equal(
      projectSnapshotStatus({ status: 'NOPE' }).unknownReason,
      'unrecognized_status_word',
    );
    assert.equal(projectSnapshotStatus({ status: 'SUCCEEDED' }).unknownReason, null);
  });

  it('ignores error fields on non-FAILED projections', () => {
    assert.equal(
      projectSnapshotStatus({ status: 'SUCCEEDED', error: { code: 'X', message: 'y' } }).error,
      null,
    );
  });
});

describe('projectReceiptStatus', () => {
  it('reads the documented receipt status field `kind`', () => {
    assert.equal(projectReceiptStatus({ kind: 'RUNNING' }).status, 'RUNNING');
    assert.equal(projectReceiptStatus({ kind: 'SUCCEEDED' }).status, 'SUCCEEDED');
    assert.equal(projectReceiptStatus({ kind: 'CANCELLED' }).status, 'CANCELLED');
  });

  it('does not read the snapshot field name from a receipt', () => {
    const projection = projectReceiptStatus({ status: 'SUCCEEDED' });
    assert.equal(projection.status, 'UNKNOWN');
    assert.equal(projection.unknownReason, 'status_field_missing');
  });

  it('projects a FAILED receipt with its bounded error pair, else UNKNOWN faithfully', () => {
    const failed = projectReceiptStatus({
      kind: 'FAILED',
      error: { code: 'HOST_KEY_EXISTS', message: 'dupe' },
    });
    assert.equal(failed.status, 'FAILED');
    assert.deepEqual(failed.error, { code: 'HOST_KEY_EXISTS', message: 'dupe' });
    const opaque = projectReceiptStatus({ arbitrary: 'shape' });
    assert.equal(opaque.status, 'UNKNOWN');
    assert.equal(opaque.terminal, false);
  });
});
