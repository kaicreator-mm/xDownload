/**
 * V022-A03 — Host plain-file lineage store tests (node:test, colocated).
 *
 * The physical T09 adapter moved verbatim from the Domain App migration
 * lane; these tests pin the behavior the dormant policy port relies on:
 * schema/revision fail-closed checks, typed LINEAGE_CAS_CONFLICT /
 * MALFORMED_LEDGER_DOC error codes, tmp+rename atomic persistence and
 * restart behavior across a real process boundary.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  LineageStoreError,
  PlainFileLineageStore,
  type HostLineageLedgerDoc,
} from './plain-file-lineage-store.ts';

function tempLedgerPath(testName: string): string {
  const slug = testName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  return join(mkdtempSync(join(tmpdir(), `xd-a03-lineage-${slug}-`)), 'lineage.json');
}

function emptyDoc(): HostLineageLedgerDoc {
  return { schemaVersion: 1, revision: 0, claims: {}, unknownEffects: [], history: [] };
}

describe('T09-PLAIN-FILE-STORE-08 — Host PlainFileLineageStore preserves schema/revision/typed errors (dormant)', () => {
  it('create at revision 0 persists atomically and returns the advanced revision', () => {
    const path = tempLedgerPath('create');
    const store = new PlainFileLineageStore(path);
    try {
      const persisted = store.save(emptyDoc());
      assert.equal(persisted.revision, 1);
      // The durable bytes are exactly the persisted document (tmp+rename left
      // no artifact behind and no torn JSON exists).
      const onDisk = JSON.parse(readFileSync(path, 'utf8')) as HostLineageLedgerDoc;
      assert.equal(onDisk.schemaVersion, 1);
      assert.equal(onDisk.revision, 1);
      assert.deepEqual(onDisk.claims, {});
      assert.deepEqual(onDisk.unknownEffects, []);
      assert.deepEqual(onDisk.history, []);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('load on a missing file returns null (no ledger yet)', () => {
    const path = tempLedgerPath('load-missing');
    const store = new PlainFileLineageStore(path);
    try {
      assert.equal(store.load(), null);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('save on a moved durable revision refuses with typed LINEAGE_CAS_CONFLICT', () => {
    const path = tempLedgerPath('cas-conflict');
    const store = new PlainFileLineageStore(path);
    try {
      const first = store.save(emptyDoc());
      assert.throws(
        () => store.save(emptyDoc()),
        (error: unknown) =>
          error instanceof LineageStoreError && error.code === 'LINEAGE_CAS_CONFLICT',
      );
      // The durable document is unchanged after the refused save.
      assert.equal(store.load()?.revision, first.revision);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('create against revision != 0 on a missing file refuses with LINEAGE_CAS_CONFLICT', () => {
    const path = tempLedgerPath('create-nonzero');
    const store = new PlainFileLineageStore(path);
    try {
      assert.throws(
        () =>
          store.save({
            schemaVersion: 1,
            revision: 3,
            claims: {},
            unknownEffects: [],
            history: [],
          }),
        (error: unknown) =>
          error instanceof LineageStoreError && error.code === 'LINEAGE_CAS_CONFLICT',
      );
      assert.equal(store.load(), null);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('restart: a reopened store observes exactly the durable ledger and continues the CAS chain', () => {
    const path = tempLedgerPath('restart');
    const first = new PlainFileLineageStore(path);
    let persisted: HostLineageLedgerDoc;
    try {
      persisted = first.save(emptyDoc());
      first.save({
        ...persisted,
        claims: {
          'lineage-1': {
            lineageId: 'lineage-1',
            ownerKind: 'new-k',
            ownerWriterId: 'k:v0.2:run-1',
            state: 'owned',
            claimId: 'claim-1',
            authorization: 'auth-1',
            claimedAt: '2026-11-04T00:00:00Z',
          },
        },
      });
    } finally {
      // Note: `first` holds no in-memory state — durability is file-bound.
    }

    const second = new PlainFileLineageStore(path);
    try {
      const loaded = second.load();
      assert.ok(loaded);
      assert.equal(loaded.revision, 2);
      assert.equal(loaded.claims['lineage-1']?.state, 'owned');
      // CAS continuity across the process boundary.
      assert.throws(
        () => second.save({ ...emptyDoc() }),
        (error: unknown) =>
          error instanceof LineageStoreError && error.code === 'LINEAGE_CAS_CONFLICT',
      );
      const advanced = second.save(loaded);
      assert.equal(advanced.revision, 3);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('malformed durable bytes refuse with typed MALFORMED_LEDGER_DOC (fail closed, no auto-clear)', () => {
    const path = tempLedgerPath('malformed');
    const store = new PlainFileLineageStore(path);
    try {
      writeFileSync(path, '{ not json', 'utf8');
      assert.throws(
        () => store.load(),
        (error: unknown) =>
          error instanceof LineageStoreError && error.code === 'MALFORMED_LEDGER_DOC',
      );

      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 2,
          revision: 0,
          claims: {},
          unknownEffects: [],
          history: [],
        }),
        'utf8',
      );
      assert.throws(
        () => store.load(),
        (error: unknown) =>
          error instanceof LineageStoreError && error.code === 'MALFORMED_LEDGER_DOC',
      );
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});
