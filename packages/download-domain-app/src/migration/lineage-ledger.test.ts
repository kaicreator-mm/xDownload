/**
 * v0.2 T09 — single-authority lineage ledger tests (node:test, Node24).
 *
 * Covers the frozen acceptance: default partition (no migration), exclusive
 * claim, dual-writer refusal (both directions), kill-simulated restart
 * survival, UNKNOWN book that never auto-clears/auto-replays, and explicit
 * release/re-claim rollback semantics with new authorization. The physical
 * SQLite CAS sub-leg is NOT_PROVEN in this lane (better-sqlite3 unavailable —
 * see lineage-store.ts header); these tests run on the atomic plain-file CAS.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  DEFAULT_LINEAGE_OWNER,
  LineageLedger,
  LineageLedgerError,
  PlainFileLineageStore,
} from './index.ts';

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'xd-v02-t09-lineage-'));

function freshLedgerPath(name: string): string {
  return join(FIXTURE_ROOT, name, 'lineage-ledger.json');
}

const K_WRITER_A = { writerId: 'k:v0.2:writer-a', kind: 'new-k' } as const;
const K_WRITER_B = { writerId: 'k:v0.2:writer-b', kind: 'new-k' } as const;
const LEGACY_WRITER = { writerId: 'legacy-core:v0.1', kind: 'old-core' } as const;

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof LineageLedgerError, `expected LineageLedgerError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected a typed LineageLedgerError, none thrown');
}

after(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('default partition — old lineages stay old-core, no migration', () => {
  it('resolves unregistered lineages to the old-core default (new K must not write them)', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('default-partition') });
    assert.equal(DEFAULT_LINEAGE_OWNER, 'old-core');
    assert.equal(ledger.recordedOwnerOf('lineage-never-seen'), null);
    assert.equal(ledger.effectiveOwnerOf('lineage-never-seen'), 'old-core');
    assert.equal(
      codeOf(() => ledger.claimLineage({ lineageId: 'lineage-never-seen', writer: LEGACY_WRITER, authorization: 'auth:x' })),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });

  it('records a legacy lineage permanently and refuses the new-K claim on it', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('legacy-persist') });
    const record = ledger.registerLegacyLineage('old-v01-lineage-1');
    assert.equal(record.ownerKind, 'old-core');
    assert.equal(ledger.effectiveOwnerOf('old-v01-lineage-1'), 'old-core');
    assert.equal(
      codeOf(() => ledger.claimLineage({ lineageId: 'old-v01-lineage-1', writer: K_WRITER_A, authorization: 'auth:t09-a' })),
      'LINEAGE_PARTITION_VIOLATION',
    );
    // Idempotent re-registration converges on the same record.
    const again = ledger.registerLegacyLineage('old-v01-lineage-1');
    assert.equal(again.claimId, record.claimId);
  });

  it('refuses partition inversion: a claimed new-K lineage can never be re-registered as legacy', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('no-inversion') });
    ledger.claimLineage({ lineageId: 'new-k-lineage-1', writer: K_WRITER_A, authorization: 'auth:t09-claim-1' });
    assert.equal(
      codeOf(() => ledger.registerLegacyLineage('new-k-lineage-1')),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });

  it('legacy registration survives a restart and keeps refusing new-K claims', () => {
    const path = freshLedgerPath('legacy-restart');
    const first = LineageLedger.open({ path });
    first.registerLegacyLineage('old-v01-lineage-2');

    const reopened = LineageLedger.open({ path });
    assert.equal(reopened.effectiveOwnerOf('old-v01-lineage-2'), 'old-core');
    assert.equal(
      codeOf(() => reopened.claimLineage({ lineageId: 'old-v01-lineage-2', writer: K_WRITER_B, authorization: 'auth:t09-b' })),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });
});

describe('exclusive claim — one writer per new lineage', () => {
  it('CAS-creates the first claim and converges idempotently for the same writer', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('exclusive') });
    const claim = ledger.claimLineage({ lineageId: 'lineage-x', writer: K_WRITER_A, authorization: 'auth:t09-x1' });
    assert.equal(claim.state, 'owned');
    assert.equal(claim.ownerWriterId, K_WRITER_A.writerId);
    assert.equal(ledger.effectiveOwnerOf('lineage-x'), 'new-k');
    const reClaim = ledger.claimLineage({ lineageId: 'lineage-x', writer: K_WRITER_A, authorization: 'auth:t09-x2' });
    assert.equal(reClaim.claimId, claim.claimId);
  });

  it('refuses a second writer identity with WRITER_IDENTITY_CONFLICT (U02/N06 code)', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('dual-writer') });
    ledger.claimLineage({ lineageId: 'lineage-d', writer: K_WRITER_A, authorization: 'auth:t09-d1' });
    assert.equal(
      codeOf(() => ledger.claimLineage({ lineageId: 'lineage-d', writer: K_WRITER_B, authorization: 'auth:t09-d2' })),
      'WRITER_IDENTITY_CONFLICT',
    );
    assert.equal(ledger.effectiveOwnerOf('lineage-d'), 'new-k');
    assert.equal(ledger.claimFor('lineage-d')?.ownerWriterId, K_WRITER_A.writerId);
  });

  it('refuses claims/releases with malformed input without durable effect', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('malformed') });
    assert.equal(
      codeOf(() => ledger.claimLineage({ lineageId: 'ok-lineage', writer: K_WRITER_A, authorization: '' })),
      'LINEAGE_AUTHORIZATION_REQUIRED',
    );
    assert.equal(
      codeOf(() => ledger.claimLineage({ lineageId: 'bad id with spaces', writer: K_WRITER_A, authorization: 'auth:ok' })),
      'MALFORMED_LEDGER_INPUT',
    );
    assert.equal(ledger.recordedOwnerOf('ok-lineage'), null);
  });
});

describe('crash/restart — kill simulation by reopening the ledger file', () => {
  it('claims stay owned and authority is still enforced after a process boundary', () => {
    const path = freshLedgerPath('restart-claims');
    const first = LineageLedger.open({ path });
    first.claimLineage({ lineageId: 'lineage-crash', writer: K_WRITER_A, authorization: 'auth:t09-crash' });
    first.registerLegacyLineage('old-v01-crash');

    // Simulated kill: drop the instance, reopen the same durable file.
    const reopened = LineageLedger.open({ path });
    const claim = reopened.claimFor('lineage-crash');
    assert.equal(claim?.state, 'owned');
    assert.equal(claim?.ownerWriterId, K_WRITER_A.writerId);
    assert.equal(reopened.effectiveOwnerOf('lineage-crash'), 'new-k');
    assert.equal(reopened.effectiveOwnerOf('old-v01-crash'), 'old-core');
    // The second-writer refusal survives the restart too.
    assert.equal(
      codeOf(() => reopened.claimLineage({ lineageId: 'lineage-crash', writer: K_WRITER_B, authorization: 'auth:t09-other' })),
      'WRITER_IDENTITY_CONFLICT',
    );
  });

  it('fails closed on corrupt durable bytes', () => {
    const path = freshLedgerPath('corrupt');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json at all');
    assert.throws(() => LineageLedger.open({ path }), (error: unknown) => {
      return error instanceof Error && error.name === 'LineageStoreError';
    });
  });

  it('CAS conflict: a stale revision-0 save cannot overwrite durable state', () => {
    const path = freshLedgerPath('cas-conflict');
    // Create durable state at revision 1.
    const live = LineageLedger.open({ path });
    live.registerLegacyLineage('old-v01-stale');
    // A stale writer still holding the never-persisted revision-0 document
    // cannot overwrite the durable bytes.
    const ghost = new PlainFileLineageStore(path);
    assert.throws(
      () =>
        ghost.save({
          schemaVersion: 1,
          revision: 0,
          claims: {},
          unknownEffects: [],
          history: [],
        }),
      (error: unknown) => error instanceof Error && error.name === 'LineageStoreError',
    );
    // The durable state is untouched.
    assert.equal(LineageLedger.open({ path }).effectiveOwnerOf('old-v01-stale'), 'old-core');
  });
});

describe('UNKNOWN reconciliation book — record only, never auto-clear/replay', () => {
  it('records the UNKNOWN effect durably and keeps it pending across restarts', () => {
    const path = freshLedgerPath('unknown-restart');
    const first = LineageLedger.open({ path });
    first.claimLineage({ lineageId: 'lineage-u', writer: K_WRITER_A, authorization: 'auth:t09-u' });
    const record = first.recordUnknownEffect({
      lineageId: 'lineage-u',
      writerId: K_WRITER_A.writerId,
      effect: { phase: 'running', externalRef: 'ref:u-1', bytesAtKill: 4096 },
    });

    const reopened = LineageLedger.open({ path });
    const pending = reopened.listUnknownEffects();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.unknownId, record.unknownId);
    assert.equal(pending[0]?.resolvedAt, null);
    assert.equal(pending[0]?.resolution, null);
  });

  it('resolution requires a new authorization and is explicit-only, exactly once', () => {
    const path = freshLedgerPath('unknown-resolve');
    const ledger = LineageLedger.open({ path });
    const record = ledger.recordUnknownEffect({
      lineageId: 'lineage-u2',
      writerId: K_WRITER_A.writerId,
      effect: { externalRef: 'ref:u-2' },
    });
    // No authorization → refused.
    assert.equal(
      codeOf(() =>
        ledger.resolveUnknownEffect({ unknownId: record.unknownId, authorization: '', resolution: { outcome: 'superseded' } }),
      ),
      'LINEAGE_AUTHORIZATION_REQUIRED',
    );
    // Unknown id → refused typed.
    assert.equal(
      codeOf(() =>
        ledger.resolveUnknownEffect({ unknownId: 'unknown-nope', authorization: 'auth:t09-r', resolution: { outcome: 'verified' } }),
      ),
      'UNKNOWN_NOT_FOUND',
    );
    const resolved = ledger.resolveUnknownEffect({
      unknownId: record.unknownId,
      authorization: 'auth:t09-resolve-1',
      resolution: { outcome: 'verified-no-duplicate', verifiedBy: 'operator' },
    });
    assert.equal(resolved.resolvedAt !== null, true);
    assert.equal(resolved.resolvedWithAuthorization, 'auth:t09-resolve-1');
    // Second resolution → refused; record never deleted from the book.
    assert.equal(
      codeOf(() =>
        ledger.resolveUnknownEffect({ unknownId: record.unknownId, authorization: 'auth:t09-resolve-2', resolution: { outcome: 'again' } }),
      ),
      'UNKNOWN_ALREADY_RESOLVED',
    );
    assert.equal(ledger.listUnknownEffects().length, 0);
    assert.equal(ledger.listUnknownEffects({ includeResolved: true }).length, 1);
    assert.equal(ledger.listUnknownEffects({ includeResolved: true })[0]?.unknownId, record.unknownId);
  });
});

describe('rollback — new lineage release; old lineage immutable', () => {
  it('releases a new-K lineage by its owner, preserving the released record/history', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('release-new') });
    ledger.claimLineage({ lineageId: 'lineage-rl', writer: K_WRITER_A, authorization: 'auth:t09-rl1' });
    const released = ledger.releaseLineage({ lineageId: 'lineage-rl', writer: K_WRITER_A });
    assert.ok(released !== null);
    assert.equal(released.state, 'released');
    assert.equal(released.releasedAt !== null, true);
    // Record and history preserved; partition falls back to the default.
    assert.equal(ledger.claimFor('lineage-rl')?.state, 'released');
    assert.equal(ledger.effectiveOwnerOf('lineage-rl'), 'old-core');
    assert.ok(ledger.history().some((event) => event.kind === 'released' && event.lineageId === 'lineage-rl'));
    assert.ok(ledger.history().some((event) => event.kind === 'claimed' && event.lineageId === 'lineage-rl'));
  });

  it('refuses a foreign release and an old-lineage release', () => {
    const ledger = LineageLedger.open({ path: freshLedgerPath('release-refusals') });
    ledger.claimLineage({ lineageId: 'lineage-rr', writer: K_WRITER_A, authorization: 'auth:t09-rr' });
    assert.equal(
      codeOf(() => ledger.releaseLineage({ lineageId: 'lineage-rr', writer: K_WRITER_B })),
      'WRITER_IDENTITY_CONFLICT',
    );
    ledger.registerLegacyLineage('old-v01-rr');
    assert.equal(
      codeOf(() => ledger.releaseLineage({ lineageId: 'old-v01-rr', writer: LEGACY_WRITER })),
      'OLD_LINEAGE_IMMUTABLE',
    );
  });

  it('re-claim after release requires a NEW authorization (stale grant refused)', () => {
    const path = freshLedgerPath('reclaim');
    const first = LineageLedger.open({ path });
    first.claimLineage({ lineageId: 'lineage-rc', writer: K_WRITER_A, authorization: 'auth:t09-rc-1' });
    first.releaseLineage({ lineageId: 'lineage-rc', writer: K_WRITER_A });

    const reopened = LineageLedger.open({ path });
    assert.equal(
      codeOf(() => reopened.claimLineage({ lineageId: 'lineage-rc', writer: K_WRITER_A, authorization: 'auth:t09-rc-1' })),
      'STALE_AUTHORIZATION',
    );
    const reclaimed = reopened.claimLineage({ lineageId: 'lineage-rc', writer: K_WRITER_B, authorization: 'auth:t09-rc-2' });
    assert.equal(reclaimed.state, 'owned');
    assert.equal(reclaimed.claimId !== first.claimFor('lineage-rc')?.claimId, true);
    assert.equal(reopened.effectiveOwnerOf('lineage-rc'), 'new-k');
    assert.ok(reopened.history().some((event) => event.kind === 're-claimed' && event.lineageId === 'lineage-rc'));
  });
});
