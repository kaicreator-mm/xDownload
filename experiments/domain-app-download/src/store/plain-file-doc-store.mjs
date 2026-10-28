/**
 * Caller-owned durable V10DocStore for the #183 PoC (Tiny-pattern plain CAS).
 *
 * One JSON file, atomic temp+rename persistence on every conditional write,
 * exact V10DocStore shape (get/put/remove/keys). Reopening the file after a
 * real process boundary observes the same durable bytes, which is what the
 * restart/cancel/UNKNOWN tests rely on. This is Host application code — it
 * implements the public store contract from
 * @kaicreator/domain-harness-contracts; it imports nothing from the SDK.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class PlainFileDocStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.docs = existsSync(path)
      ? new Map(Object.entries(JSON.parse(readFileSync(path, "utf8"))))
      : new Map();
    this.counts = { reads: 0, writes: 0, removes: 0 };
  }

  async get(key) {
    this.counts.reads += 1;
    const row = this.docs.get(key);
    return row === undefined ? null : { value: row.value, revision: row.revision };
  }

  async put(key, value, condition) {
    this.counts.writes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === "create") {
      if (existing !== undefined) {
        throw Object.assign(new Error(`CAS conflict on ${key}: document already exists`), {
          code: "HOST_CAS_CONFLICT",
        });
      }
      this.docs.set(key, { revision: 0, value });
      this.persist();
      return { revision: 0 };
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(
          `CAS conflict on ${key}: revision moved (expected ${condition.revision}, held ${existing === undefined ? "absent" : existing.revision})`,
        ),
        { code: "HOST_CAS_CONFLICT" },
      );
    }
    this.docs.set(key, { revision: condition.revision + 1, value });
    this.persist();
    return { revision: condition.revision + 1 };
  }

  async remove(key, condition) {
    this.counts.removes += 1;
    const existing = this.docs.get(key);
    if (condition.kind === "create") {
      if (existing !== undefined) {
        throw Object.assign(
          new Error(`CAS conflict on ${key}: create-conditioned remove refuses a present document`),
          { code: "HOST_CAS_CONFLICT" },
        );
      }
      return;
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(`CAS conflict on ${key}: revision moved (expected ${condition.revision})`),
        { code: "HOST_CAS_CONFLICT" },
      );
    }
    this.docs.delete(key);
    this.persist();
  }

  keys() {
    return [...this.docs.keys()].sort();
  }

  count(likePattern = "%") {
    const pattern = likePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
    const matcher = new RegExp(`^${pattern}$`);
    return this.keys().filter((key) => matcher.test(key)).length;
  }

  /** Durable journal rows: every K effect-journal row currently persisted. */
  journalRows() {
    return this.keys()
      .filter((key) => key.includes("effect-journal"))
      .map((key) => ({ key, row: this.docs.get(key)?.value }));
  }

  persist() {
    const snapshot = JSON.stringify(
      Object.fromEntries([...this.docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    );
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, snapshot);
    renameSync(temporary, this.path);
  }

  close() {
    this.persist();
  }
}
