/**
 * v0.2 T09 — single-authority lineage ledger tests (node:test, Node24).
 *
 * Covers the frozen acceptance: default partition (no migration), exclusive
 * claim, dual-writer refusal (both directions), kill-simulated restart
 * survival, UNKNOWN book that never auto-clears/auto-replays, and explicit
 * release/re-claim rollback semantics with new authorization.
 *
 * V022-A04 R2 (review P2 closure): every open injects its store through the
 * domain-facing `LineageStore` port — the App owns no physical store
 * anymore. The injected fixture below is a TEST-SCOPED plain-file CAS
 * implementing exactly the revision-checked tmp+rename contract the port
 * documents (the same contract the Host-owned dormant store implements);
 * it exists only so the colocated ledger suite keeps honest durability
 * evidence without the App owning production physical storage. The
 * Host-store injection proof (structural assignability + typed error
 * mapping across the distinct App/Host `LineageStoreError` constructors)
 * lives at the Core composition boundary
 * (packages/core-runtime/test/domain-app-route.test.ts, A04 R2 block).
 *
 * The physical SQLite CAS sub-leg stays NOT_PROVEN in this lane (see
 * lineage-store.ts header for the real probe record).
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  DEFAULT_LINEAGE_OWNER,
  LineageLedger,
  LineageLedgerError,
  LineageStoreError,
  type LineageLedgerDoc,
  type LineageStore,
} from './index.ts';
import { PlainFileLineageStore } from './lineage-store.ts';

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'xd-v02-t09-lineage-'));

function freshLedgerPath(name: string): string {
  return join(FIXTURE_ROOT, name, 'lineage-ledger.json');
}

/**
 * Test-scoped physical fixture (A04 R2): the plain-file CAS contract the
 * `LineageStore` port documents — one JSON file, tmp+rename persistence,
 * revision compared against the durable bytes on every save (create only
 * accepted at revision 0 against a missing file). It throws the APP's own
 * `LineageStoreError` (this package's constructor), which is the one
 * injected-store path the frozen ledger maps in `commit()`; the
 * cross-constructor Host mapping is the Core composition-boundary proof.
 * Single-process-safe by construction; cross-process writers are NOT
 * proven here (same-process kill-simulation only).
 */
class FixturePlainFileLineageStore implements LineageStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): LineageLedgerDoc | null {
    if (!existsSync(this.path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
    } catch {
      throw new LineageStoreError(
        'MALFORMED_LEDGER_DOC',
        `lineage ledger at ${this.path} is not valid JSON; failing closed`,
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (parsed as { revision?: unknown }).revision !== 'number' ||
      typeof (parsed as { claims?: unknown }).claims !== 'object' ||
      (parsed as { claims?: unknown }).claims === null ||
      !Array.isArray((parsed as { unknownEffects?: unknown }).unknownEffects) ||
      !Array.isArray((parsed as { history?: unknown }).history)
    ) {
      throw new LineageStoreError(
        'MALFORMED_LEDGER_DOC',
        `lineage ledger at ${this.path} does not match schema version 1; failing closed`,
      );
    }
    return parsed as LineageLedgerDoc;
  }

  save(next: LineageLedgerDoc): LineageLedgerDoc {
    const onDisk = this.load();
    if (onDisk === null) {
      if (next.revision !== 0) {
        throw new LineageStoreError(
          'LINEAGE_CAS_CONFLICT',
          `create refused: ledger file absent but incoming revision is ${next.revision} (expected 0)`,
        );
      }
    } else if (onDisk.revision !== next.revision) {
      throw new LineageStoreError(
        'LINEAGE_CAS_CONFLICT',
        `CAS conflict on ${this.path}: durable revision ${onDisk.revision}, incoming revision ${next.revision}`,
      );
    }
    const persisted: LineageLedgerDoc = { ...next, revision: next.revision + 1 };
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(persisted, null, 2));
    renameSync(temporary, this.path);
    return persisted;
  }
}

/** Every open in this suite injects the fixture store (no App default). */
function openLedger(path: string): LineageLedger {
  return LineageLedger.open({ path, store: new FixturePlainFileLineageStore(path) });
}

const K_WRITER_A = { writerId: 'k:v0.2:writer-a', kind: 'new-k' } as const;
const K_WRITER_B = { writerId: 'k:v0.2:writer-b', kind: 'new-k' } as const;
const LEGACY_WRITER = { writerId: 'legacy-core:v0.1', kind: 'old-core' } as const;

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(
      error instanceof LineageLedgerError,
      `expected LineageLedgerError, got ${String(error)}`,
    );
    return error.code;
  }
  assert.fail('expected a typed LineageLedgerError, none thrown');
}

after(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('physical store ownership — A04 R2 (review P2)', () => {
  it('the removed App default refuses closed with an explicit injection instruction', () => {
    assert.throws(
      () => new PlainFileLineageStore(freshLedgerPath('shim-refusal')),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'Error' &&
        error.message.startsWith('LINEAGE_STORE_INJECTION_REQUIRED') &&
        error.message.includes('OpenLineageLedgerOptions.store'),
    );
  });

  it('a ledger opened with an injected store persists and reopens durably', () => {
    const path = freshLedgerPath('injected-store');
    const first = openLedger(path);
    first.claimLineage({
      lineageId: 'lineage-injected',
      writer: K_WRITER_A,
      authorization: 'auth:t09-injected',
    });
    const reopened = openLedger(path);
    assert.equal(reopened.effectiveOwnerOf('lineage-injected'), 'new-k');
  });
});

describe('default partition — old lineages stay old-core, no migration', () => {
  it('resolves unregistered lineages to the old-core default (new K must not write them)', () => {
    const ledger = openLedger(freshLedgerPath('default-partition'));
    assert.equal(DEFAULT_LINEAGE_OWNER, 'old-core');
    assert.equal(ledger.recordedOwnerOf('lineage-never-seen'), null);
    assert.equal(ledger.effectiveOwnerOf('lineage-never-seen'), 'old-core');
    assert.equal(
      codeOf(() =>
        ledger.claimLineage({
          lineageId: 'lineage-never-seen',
          writer: LEGACY_WRITER,
          authorization: 'auth:x',
        }),
      ),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });

  it('records a legacy lineage permanently and refuses the new-K claim on it', () => {
    const ledger = openLedger(freshLedgerPath('legacy-persist'));
    const record = ledger.registerLegacyLineage('old-v01-lineage-1');
    assert.equal(record.ownerKind, 'old-core');
    assert.equal(ledger.effectiveOwnerOf('old-v01-lineage-1'), 'old-core');
    assert.equal(
      codeOf(() =>
        ledger.claimLineage({
          lineageId: 'old-v01-lineage-1',
          writer: K_WRITER_A,
          authorization: 'auth:t09-a',
        }),
      ),
      'LINEAGE_PARTITION_VIOLATION',
    );
    // Idempotent re-registration converges on the same record.
    const again = ledger.registerLegacyLineage('old-v01-lineage-1');
    assert.equal(again.claimId, record.claimId);
  });

  it('refuses partition inversion: a claimed new-K lineage can never be re-registered as legacy', () => {
    const ledger = openLedger(freshLedgerPath('no-inversion'));
    ledger.claimLineage({
      lineageId: 'new-k-lineage-1',
      writer: K_WRITER_A,
      authorization: 'auth:t09-claim-1',
    });
    assert.equal(
      codeOf(() => ledger.registerLegacyLineage('new-k-lineage-1')),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });

  it('legacy registration survives a restart and keeps refusing new-K claims', () => {
    const path = freshLedgerPath('legacy-restart');
    const first = openLedger(path);
    first.registerLegacyLineage('old-v01-lineage-2');

    const reopened = openLedger(path);
    assert.equal(reopened.effectiveOwnerOf('old-v01-lineage-2'), 'old-core');
    assert.equal(
      codeOf(() =>
        reopened.claimLineage({
          lineageId: 'old-v01-lineage-2',
          writer: K_WRITER_B,
          authorization: 'auth:t09-b',
        }),
      ),
      'LINEAGE_PARTITION_VIOLATION',
    );
  });
});

describe('exclusive claim — one writer per new lineage', () => {
  it('CAS-creates the first claim and converges idempotently for the same writer', () => {
    const ledger = openLedger(freshLedgerPath('exclusive'));
    const claim = ledger.claimLineage({
      lineageId: 'lineage-x',
      writer: K_WRITER_A,
      authorization: 'auth:t09-x1',
    });
    assert.equal(claim.state, 'owned');
    assert.equal(claim.ownerWriterId, K_WRITER_A.writerId);
    assert.equal(ledger.effectiveOwnerOf('lineage-x'), 'new-k');
    const reClaim = ledger.claimLineage({
      lineageId: 'lineage-x',
      writer: K_WRITER_A,
      authorization: 'auth:t09-x2',
    });
    assert.equal(reClaim.claimId, claim.claimId);
  });

  it('refuses a second writer identity with WRITER_IDENTITY_CONFLICT (U02/N06 code)', () => {
    const ledger = openLedger(freshLedgerPath('dual-writer'));
    ledger.claimLineage({
      lineageId: 'lineage-d',
      writer: K_WRITER_A,
      authorization: 'auth:t09-d1',
    });
    assert.equal(
      codeOf(() =>
        ledger.claimLineage({
          lineageId: 'lineage-d',
          writer: K_WRITER_B,
          authorization: 'auth:t09-d2',
        }),
      ),
      'WRITER_IDENTITY_CONFLICT',
    );
    assert.equal(ledger.effectiveOwnerOf('lineage-d'), 'new-k');
    assert.equal(ledger.claimFor('lineage-d')?.ownerWriterId, K_WRITER_A.writerId);
  });

  it('refuses claims/releases with malformed input without durable effect', () => {
    const ledger = openLedger(freshLedgerPath('malformed'));
    assert.equal(
      codeOf(() =>
        ledger.claimLineage({ lineageId: 'ok-lineage', writer: K_WRITER_A, authorization: '' }),
      ),
      'LINEAGE_AUTHORIZATION_REQUIRED',
    );
    assert.equal(
      codeOf(() =>
        ledger.claimLineage({
          lineageId: 'bad id with spaces',
          writer: K_WRITER_A,
          authorization: 'auth:ok',
        }),
      ),
      'MALFORMED_LEDGER_INPUT',
    );
    assert.equal(ledger.recordedOwnerOf('ok-lineage'), null);
  });
});

describe('crash/restart — kill simulation by reopening the ledger file', () => {
  it('claims stay owned and authority is still enforced after a process boundary', () => {
    const path = freshLedgerPath('restart-claims');
    const first = openLedger(path);
    first.claimLineage({
      lineageId: 'lineage-crash',
      writer: K_WRITER_A,
      authorization: 'auth:t09-crash',
    });
    first.registerLegacyLineage('old-v01-crash');

    // Simulated kill: drop the instance, reopen the same durable file.
    const reopened = openLedger(path);
    const claim = reopened.claimFor('lineage-crash');
    assert.equal(claim?.state, 'owned');
    assert.equal(claim?.ownerWriterId, K_WRITER_A.writerId);
    assert.equal(reopened.effectiveOwnerOf('lineage-crash'), 'new-k');
    assert.equal(reopened.effectiveOwnerOf('old-v01-crash'), 'old-core');
    // The second-writer refusal survives the restart too.
    assert.equal(
      codeOf(() =>
        reopened.claimLineage({
          lineageId: 'lineage-crash',
          writer: K_WRITER_B,
          authorization: 'auth:t09-other',
        }),
      ),
      'WRITER_IDENTITY_CONFLICT',
    );
  });

  it('fails closed on corrupt durable bytes', () => {
    const path = freshLedgerPath('corrupt');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json at all');
    assert.throws(
      () => openLedger(path),
      (error: unknown) => {
        return error instanceof Error && error.name === 'LineageStoreError';
      },
    );
  });

  it('CAS conflict: a stale revision-0 save cannot overwrite durable state', () => {
    const path = freshLedgerPath('cas-conflict');
    // Create durable state at revision 1.
    const live = openLedger(path);
    live.registerLegacyLineage('old-v01-stale');
    // A stale writer still holding the never-persisted revision-0 document
    // cannot overwrite the durable bytes (fixture store = the injected
    // physical CAS contract).
    const ghost = new FixturePlainFileLineageStore(path);
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
    assert.equal(openLedger(path).effectiveOwnerOf('old-v01-stale'), 'old-core');
  });
});

describe('UNKNOWN reconciliation book — record only, never auto-clear/replay', () => {
  it('records the UNKNOWN effect durably and keeps it pending across restarts', () => {
    const path = freshLedgerPath('unknown-restart');
    const first = openLedger(path);
    first.claimLineage({ lineageId: 'lineage-u', writer: K_WRITER_A, authorization: 'auth:t09-u' });
    const record = first.recordUnknownEffect({
      lineageId: 'lineage-u',
      writerId: K_WRITER_A.writerId,
      effect: { phase: 'running', externalRef: 'ref:u-1', bytesAtKill: 4096 },
    });

    const reopened = openLedger(path);
    const pending = reopened.listUnknownEffects();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.unknownId, record.unknownId);
    assert.equal(pending[0]?.resolvedAt, null);
    assert.equal(pending[0]?.resolution, null);
  });

  it('resolution requires a new authorization and is explicit-only, exactly once', () => {
    const path = freshLedgerPath('unknown-resolve');
    const ledger = openLedger(path);
    const record = ledger.recordUnknownEffect({
      lineageId: 'lineage-u2',
      writerId: K_WRITER_A.writerId,
      effect: { externalRef: 'ref:u-2' },
    });
    // No authorization → refused.
    assert.equal(
      codeOf(() =>
        ledger.resolveUnknownEffect({
          unknownId: record.unknownId,
          authorization: '',
          resolution: { outcome: 'superseded' },
        }),
      ),
      'LINEAGE_AUTHORIZATION_REQUIRED',
    );
    // Unknown id → refused typed.
    assert.equal(
      codeOf(() =>
        ledger.resolveUnknownEffect({
          unknownId: 'unknown-nope',
          authorization: 'auth:t09-r',
          resolution: { outcome: 'verified' },
        }),
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
        ledger.resolveUnknownEffect({
          unknownId: record.unknownId,
          authorization: 'auth:t09-resolve-2',
          resolution: { outcome: 'again' },
        }),
      ),
      'UNKNOWN_ALREADY_RESOLVED',
    );
    assert.equal(ledger.listUnknownEffects().length, 0);
    assert.equal(ledger.listUnknownEffects({ includeResolved: true }).length, 1);
    assert.equal(
      ledger.listUnknownEffects({ includeResolved: true })[0]?.unknownId,
      record.unknownId,
    );
  });
});

describe('rollback — new lineage release; old lineage immutable', () => {
  it('releases a new-K lineage by its owner, preserving the released record/history', () => {
    const ledger = openLedger(freshLedgerPath('release-new'));
    ledger.claimLineage({
      lineageId: 'lineage-rl',
      writer: K_WRITER_A,
      authorization: 'auth:t09-rl1',
    });
    const released = ledger.releaseLineage({ lineageId: 'lineage-rl', writer: K_WRITER_A });
    assert.ok(released !== null);
    assert.equal(released.state, 'released');
    assert.equal(released.releasedAt !== null, true);
    // Record and history preserved; partition falls back to the default.
    assert.equal(ledger.claimFor('lineage-rl')?.state, 'released');
    assert.equal(ledger.effectiveOwnerOf('lineage-rl'), 'old-core');
    assert.ok(
      ledger
        .history()
        .some((event) => event.kind === 'released' && event.lineageId === 'lineage-rl'),
    );
    assert.ok(
      ledger
        .history()
        .some((event) => event.kind === 'claimed' && event.lineageId === 'lineage-rl'),
    );
  });

  it('refuses a foreign release and an old-lineage release', () => {
    const ledger = openLedger(freshLedgerPath('release-refusals'));
    ledger.claimLineage({
      lineageId: 'lineage-rr',
      writer: K_WRITER_A,
      authorization: 'auth:t09-rr',
    });
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
    const first = openLedger(path);
    first.claimLineage({
      lineageId: 'lineage-rc',
      writer: K_WRITER_A,
      authorization: 'auth:t09-rc-1',
    });
    first.releaseLineage({ lineageId: 'lineage-rc', writer: K_WRITER_A });

    const reopened = openLedger(path);
    assert.equal(
      codeOf(() =>
        reopened.claimLineage({
          lineageId: 'lineage-rc',
          writer: K_WRITER_A,
          authorization: 'auth:t09-rc-1',
        }),
      ),
      'STALE_AUTHORIZATION',
    );
    const reclaimed = reopened.claimLineage({
      lineageId: 'lineage-rc',
      writer: K_WRITER_B,
      authorization: 'auth:t09-rc-2',
    });
    assert.equal(reclaimed.state, 'owned');
    assert.equal(reclaimed.claimId !== first.claimFor('lineage-rc')?.claimId, true);
    assert.equal(reopened.effectiveOwnerOf('lineage-rc'), 'new-k');
    assert.ok(
      reopened
        .history()
        .some((event) => event.kind === 're-claimed' && event.lineageId === 'lineage-rc'),
    );
  });
});
