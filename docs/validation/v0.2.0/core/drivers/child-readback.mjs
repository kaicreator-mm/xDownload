/**
 * T14 validation-core driver support — cross-process readback probe.
 *
 * Spawned by v01-crash-restart-replay.test.ts AFTER the parent stopped the
 * download runtime. It is a REAL second process: it re-opens the durable
 * FileCasDocStore file left behind and reports what it observes, both as raw
 * durable bytes (JSON.parse of the file) and through the public
 * FileCasDocStore reopen path used by the composition itself.
 *
 * stdout is one JSON line: { raw, store }. Exit code 0 on success, non-zero
 * on any failure (never coerced by the parent).
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const storePath = process.argv[2];
if (typeof storePath !== 'string' || storePath.length === 0) {
  console.error('usage: child-readback.mjs <storePath>');
  process.exit(2);
}

try {
  const rawText = readFileSync(storePath, 'utf8');
  const raw = JSON.parse(rawText);
  const rawKeys = Object.keys(raw).sort();

  const { FileCasDocStore } = await import('@xdownload/download-domain-app');
  const store = new FileCasDocStore(storePath);
  const journal = store.journalRows();
  const permits = store.permitDocs();

  process.stdout.write(
    `${JSON.stringify({
      raw: { keyCount: rawKeys.length, keys: rawKeys },
      store: {
        keyCount: store.keys().length,
        journalCount: journal.length,
        journalJson: journal.map(({ key, record }) => JSON.stringify({ key, record })).sort(),
        permitCount: permits.length,
        permitKeys: permits.map(({ key }) => key).sort(),
        counts: { ...store.counts },
      },
    })}\n`,
  );
  process.exit(0);
} catch (error) {
  console.error('child-readback failed:', error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
}
