import type { DownloadJobProjection } from '../../src/index.ts';

export const v02JobProjectionFixture: DownloadJobProjection = {
  schemaIdentity: {
    schema: 'xdownload.domain-contracts',
    version: '1.0.0',
  },
  lineageId: 'lineage-001',
  owner: 'new-k',
  status: 'RUNNING',
  currentAttemptId: 'work-item-001#attempt-2',
  attempts: [
    {
      attemptId: 'work-item-001#attempt-1',
      sequence: 10,
      status: 'FAILED',
      error: {
        code: 'ETIMEDOUT',
        message: 'The remote endpoint timed out.',
      },
    },
    {
      attemptId: 'work-item-001#attempt-2',
      sequence: 20,
      status: 'RUNNING',
    },
  ],
  progress: {
    transferredBytes: 32768,
    totalBytes: { kind: 'UNKNOWN' },
  },
};
