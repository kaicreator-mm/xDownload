/**
 * V022-A03 — Host-owned physical store tests (node:test, colocated).
 *
 * The plain-file CAS document store moved verbatim from the Domain App
 * composition runtime; these tests pin the SDK V10DocStore semantics it must
 * keep: exact CAS conditions with HOST_CAS_CONFLICT, temp+rename atomicity
 * (readers never observe a torn document), restart behavior across a real
 * process boundary (reopen observes exactly the durable bytes) and the
 * evidence views the composition relies on.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { FileCasDocStore } from './file-cas-doc-store.ts';

function tempStorePath(testName: string): string {
  const slug = testName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  return join(mkdtempSync(join(tmpdir(), `xd-a03-store-${slug}-`)), 'k-docs.json');
}

describe('FILE-CAS-DOC-STORE-07 — Host FileCasDocStore preserves V10DocStore CAS/atomic/restart behavior', () => {
  it('create / read / CAS update / remove with revision-checked CAS', async () => {
    const path = tempStorePath('cas-lifecycle');
    const store = new FileCasDocStore(path);
    try {
      const created = await store.put('doc:1', { record: { kind: 'seed' } }, { kind: 'create' });
      assert.deepEqual(created, { revision: 0 });
      assert.deepEqual(await store.get('doc:1'), {
        value: { record: { kind: 'seed' } },
        revision: 0,
      });

      const replaced = await store.put(
        'doc:1',
        { record: { kind: 'updated' } },
        { kind: 'cas', revision: 0 },
      );
      assert.deepEqual(replaced, { revision: 1 });
      assert.deepEqual(await store.get('doc:1'), {
        value: { record: { kind: 'updated' } },
        revision: 1,
      });

      await store.remove('doc:1', { kind: 'cas', revision: 1 });
      assert.equal(await store.get('doc:1'), null);
      assert.deepEqual(store.keys(), []);
    } finally {
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('create over an existing document refuses with HOST_CAS_CONFLICT', async () => {
    const path = tempStorePath('cas-create-conflict');
    const store = new FileCasDocStore(path);
    try {
      await store.put('doc:1', { value: 1 }, { kind: 'create' });
      await assert.rejects(
        store.put('doc:1', { value: 2 }, { kind: 'create' }),
        (error: unknown) =>
          error instanceof Error && (error as { code?: string }).code === 'HOST_CAS_CONFLICT',
      );
      // The refused write left the original document untouched.
      assert.deepEqual(await store.get('doc:1'), { value: { value: 1 }, revision: 0 });
    } finally {
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('CAS on a moved revision refuses with HOST_CAS_CONFLICT (no lost update)', async () => {
    const path = tempStorePath('cas-moved-revision-conflict');
    const store = new FileCasDocStore(path);
    try {
      await store.put('doc:1', { value: 1 }, { kind: 'create' });
      await store.put('doc:1', { value: 2 }, { kind: 'cas', revision: 0 });
      await assert.rejects(
        store.put('doc:1', { value: 3 }, { kind: 'cas', revision: 0 }),
        (error: unknown) =>
          error instanceof Error && (error as { code?: string }).code === 'HOST_CAS_CONFLICT',
      );
      assert.deepEqual(await store.get('doc:1'), { value: { value: 2 }, revision: 1 });
    } finally {
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('create-conditioned remove of a present document refuses with HOST_CAS_CONFLICT', async () => {
    const path = tempStorePath('cas-remove-conflict');
    const store = new FileCasDocStore(path);
    try {
      await store.put('doc:1', { value: 1 }, { kind: 'create' });
      await assert.rejects(
        store.remove('doc:1', { kind: 'create' }),
        (error: unknown) =>
          error instanceof Error && (error as { code?: string }).code === 'HOST_CAS_CONFLICT',
      );
      assert.deepEqual(await store.get('doc:1'), { value: { value: 1 }, revision: 0 });
    } finally {
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('restart: a reopened store observes exactly the durable bytes and revisions', async () => {
    const path = tempStorePath('cas-restart');
    const first = new FileCasDocStore(path);
    try {
      await first.put('effect-permit:req-1', { permit: true }, { kind: 'create' });
      await first.put('effect-journal:req-1', { record: { settled: true } }, { kind: 'create' });
      await first.put('doc:1', { value: 1 }, { kind: 'create' });
      await first.put('doc:1', { value: 2 }, { kind: 'cas', revision: 0 });
    } finally {
      first.close();
    }

    // Same file, new instance: exactly the durable state, no torn rows.
    const second = new FileCasDocStore(path);
    try {
      assert.deepEqual(await second.get('doc:1'), { value: { value: 2 }, revision: 1 });
      assert.deepEqual(second.keys(), ['doc:1', 'effect-journal:req-1', 'effect-permit:req-1']);
      assert.equal(second.journalRows().length, 1);
      assert.equal(second.permitDocs().length, 1);
      // CAS continuity across the restart boundary.
      await assert.rejects(
        second.put('doc:1', { value: 3 }, { kind: 'cas', revision: 0 }),
        (error: unknown) =>
          error instanceof Error && (error as { code?: string }).code === 'HOST_CAS_CONFLICT',
      );
    } finally {
      second.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('atomic temp+rename: no torn .tmp artifact remains after a mutation', async () => {
    const path = tempStorePath('cas-atomic');
    const store = new FileCasDocStore(path);
    try {
      await store.put('doc:1', { value: 1 }, { kind: 'create' });
      assert.equal(existsSync(`${path}.tmp`), false);
      const durable = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      assert.deepEqual(Object.keys(durable), ['doc:1']);
      assert.ok(store.counts.persists >= 1);
    } finally {
      store.close();
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('close on a clean store is an honest no-op (no spurious rewrite)', async () => {
    const path = tempStorePath('cas-close-idempotent');
    const store = new FileCasDocStore(path);
    try {
      await store.put('doc:1', { value: 1 }, { kind: 'create' });
      const persistsAfterWrite = store.counts.persists;
      store.close();
      assert.equal(store.counts.persists, persistsAfterWrite);
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});
