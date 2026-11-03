/**
 * V022-A03 — Host-owned physical K document store (plain-file CAS).
 *
 * Moved verbatim from the Domain App composition runtime (T11 lane) behind
 * the Host package: the trusted Host owns every physical adapter, the App
 * keeps only domain contracts and policy. The SDK `V10DocStore` semantics
 * are preserved exactly — keyed multi-document CAS (get/put/remove/keys),
 * exact create/replace conditions with `HOST_CAS_CONFLICT`, whole-document
 * temp+rename persistence on every conditional write, sorted-key durable
 * snapshot, restart-safe reads (a real process boundary observes exactly the
 * durable bytes) and an idempotent close.
 *
 * The Host package does not declare a direct DomainHarness contracts
 * dependency (package manifests are A04's sole write set), so the store
 * implements a narrowly scoped STRUCTURAL port (`HostDocStore`) that mirrors
 * the SDK `V10DocStore` shape; A04 proves assignability against the public
 * SDK type at the Core composition call site. Nothing here relies on
 * node_modules hoisting.
 *
 * Store choice write-up (carried from the T11 lane): the T09 `LineageStore`
 * seam is a single-document lineage-authority shape, not a keyed
 * V10DocStore, so it cannot back the K docs port; the real SQLite leg stays
 * NOT_PROVEN exactly as the T09 lane recorded it (no driver, no mock
 * admission). Single-process-safe by construction; cross-process writers
 * are NOT its claim (one-writer-per-runtime is the composition's guarantee).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Exact-key conditional write, structurally identical to the SDK condition. */
export type HostDocWriteCondition =
  { readonly kind: 'create' } | { readonly kind: 'replace'; readonly revision: number };

/** One durable document row (value + monotonic CAS revision). */
export interface HostDocRow {
  readonly value: unknown;
  readonly revision: number;
}

/**
 * The narrow structural K document-store port the Host store implements:
 * identical member names and arities to the SDK `V10DocStore` public shape.
 */
export interface HostDocStore {
  get(key: string): Promise<HostDocRow | null>;
  put(key: string, value: unknown, condition: HostDocWriteCondition): Promise<{ revision: number }>;
  remove(key: string, condition: HostDocWriteCondition): Promise<void>;
  keys(): readonly string[];
}

export interface FileCasDocStoreCounts {
  reads: number;
  writes: number;
  removes: number;
  persists: number;
}

export class FileCasDocStore implements HostDocStore {
  readonly path: string;
  readonly counts: FileCasDocStoreCounts = { reads: 0, writes: 0, removes: 0, persists: 0 };
  private readonly docs: Map<string, HostDocRow>;
  /** True when the in-memory map holds writes not yet on disk. */
  private dirty = false;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.docs = existsSync(path)
      ? new Map(
          Object.entries(JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, HostDocRow>),
        )
      : new Map();
  }

  async get(key: string): Promise<HostDocRow | null> {
    this.counts.reads += 1;
    const row = this.docs.get(key);
    return row === undefined ? null : { value: row.value, revision: row.revision };
  }

  async put(
    key: string,
    value: unknown,
    condition: HostDocWriteCondition,
  ): Promise<{ revision: number }> {
    this.counts.writes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(new Error(`CAS conflict on ${key}: document already exists`), {
          code: 'HOST_CAS_CONFLICT',
        });
      }
      this.docs.set(key, { value, revision: 0 });
      this.persist();
      return { revision: 0 };
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(
          `CAS conflict on ${key}: revision moved (expected ${condition.revision}, held ${existing === undefined ? 'absent' : existing.revision})`,
        ),
        { code: 'HOST_CAS_CONFLICT' },
      );
    }
    this.docs.set(key, { value, revision: condition.revision + 1 });
    this.persist();
    return { revision: condition.revision + 1 };
  }

  async remove(key: string, condition: HostDocWriteCondition): Promise<void> {
    this.counts.removes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(
          new Error(`CAS conflict on ${key}: create-conditioned remove refuses a present document`),
          { code: 'HOST_CAS_CONFLICT' },
        );
      }
      return;
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(`CAS conflict on ${key}: revision moved (expected ${condition.revision})`),
        {
          code: 'HOST_CAS_CONFLICT',
        },
      );
    }
    this.docs.delete(key);
    this.persist();
  }

  keys(): readonly string[] {
    return [...this.docs.keys()].sort();
  }

  /** Durable K effect-journal rows currently persisted (restart evidence). */
  journalRows(): readonly { key: string; record: unknown }[] {
    return this.keys()
      .filter((key) => key.includes('effect-journal:'))
      .map((key) => {
        const value = this.docs.get(key)?.value as { record?: unknown } | undefined;
        return { key, record: value?.record ?? value };
      });
  }

  /** Durable K effect-permit documents currently persisted (permit evidence). */
  permitDocs(): readonly { key: string; value: unknown }[] {
    return this.keys()
      .filter((key) => key.includes('effect-permit:'))
      .map((key) => ({ key, value: this.docs.get(key)?.value }));
  }

  private persist(): void {
    this.counts.persists += 1;
    this.dirty = false;
    const snapshot = JSON.stringify(
      Object.fromEntries([...this.docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    );
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, snapshot);
    renameSync(temporary, this.path);
  }

  /**
   * Flush and seal the durable file (idempotent). Every mutation already
   * persisted itself synchronously, so this only writes when the map holds
   * unpersisted state — a second `close` on an already-clean store (double
   * stop, teardown after the workspace vanished) is an honest no-op, never
   * a spurious write to a vanished directory.
   */
  close(): void {
    if (this.dirty) this.persist();
  }
}
