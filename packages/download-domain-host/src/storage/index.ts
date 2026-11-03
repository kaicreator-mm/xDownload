/**
 * @xdownload/download-domain-host / src/storage — v0.2.2 V022-A03 public face.
 *
 * Host-owned physical durable stores. The K document CAS moves here from the
 * Domain App composition runtime (A03); the dormant T09 plain-file lineage
 * store lives in ../migration. Consumers import only these named exports.
 */
export {
  FileCasDocStore,
  type FileCasDocStoreCounts,
  type HostDocRow,
  type HostDocStore,
  type HostDocWriteCondition,
} from './file-cas-doc-store.ts';
