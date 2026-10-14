import { describe, expect, it } from 'vitest';
import { bindLocator, makeLogicalTargetId, unwrapOrThrow } from '@xdownload/domain-contracts';
import {
  CoreRuntimeFlowError,
  executeSelectedHlsAcquisition,
  type FlowRuntime,
  type SelectedHlsFlowInput,
} from '../src/index.ts';

const manifestUri = 'https://cdn.example.test/master.m3u8';
const logicalTargetId = unwrapOrThrow(makeLogicalTargetId('hls-core-admission-001'));
const manifestLocator = unwrapOrThrow(
  bindLocator({ kind: 'direct', uri: manifestUri }, logicalTargetId, {
    binding: 'SELECTED_RESOURCE_PROVENANCE',
    originLocatorUri: manifestUri,
  }),
);
const masterText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",RESOLUTION=640x360',
  'v360/index.m3u8',
].join('\n');
const mediaText = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:5',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4.0,',
  'part-01.ts',
  '#EXTINF:4.0,',
  'part-02.ts',
  '#EXT-X-ENDLIST',
].join('\n');

function validInput(): SelectedHlsFlowInput {
  return {
    seed: {
      contractId: 'hls-contract-001',
      snapshotId: 'hls-snapshot-001',
      targetId: logicalTargetId,
      authorizationContextRef: 'hls-auth-001',
      budgetProfile: {},
    },
    commandId: 'hls-command-001',
    memberId: 'hls-member-001',
    artifactId: 'hls-artifact-001',
    selection: {
      logicalTargetId,
      manifestLocator,
      masterText,
      selectedRenditionUri: 'https://cdn.example.test/v360/index.m3u8',
      mediaText,
    },
    fetcher: {
      fetcherId: 'should-never-transfer',
      fetch() {
        throw new Error('unexpected segment HTTP effect');
      },
    },
    assemblyPort: {
      toolId: 'should-never-assemble',
      assembleAndProbe() {
        throw new Error('unexpected media assembly');
      },
    },
    recordedAt: '2026-10-15T00:00:00.000Z',
  };
}

// A valid Core start would call scheduler.submitLineage. Invalid selection
// must reject through domain diagnostics *before* it ever reaches this port.
const blockedRuntime = {
  scheduler: {
    submitLineage() {
      throw new Error('SCHEDULER_EFFECT_STARTED');
    },
  },
} as unknown as FlowRuntime;

describe('S4 selected Core entrypoint pre-effect authority', () => {
  it('denies a selected rendition that was never declared in the frozen master', () => {
    expect(() =>
      executeSelectedHlsAcquisition(blockedRuntime, {
        ...validInput(),
        selection: {
          ...validInput().selection,
          selectedRenditionUri: 'https://cdn.example.test/other/index.m3u8',
        },
      }),
    ).toThrowError(CoreRuntimeFlowError);
  });

  it('denies a changed logical target before any journal or fetch', () => {
    try {
      executeSelectedHlsAcquisition(blockedRuntime, {
        ...validInput(),
        seed: { ...validInput().seed, targetId: 'different-target-001' },
      });
      throw new Error('bad lineage was admitted');
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRuntimeFlowError);
      expect((error as CoreRuntimeFlowError).step).toBe('selected-hls-target');
    }
  });

  it('denies non-VOD and encrypted segments before the Core scheduler', () => {
    for (const alteredMedia of [
      mediaText.replace('#EXT-X-ENDLIST', ''),
      mediaText.replace(
        '#EXTINF:4.0,',
        '#EXT-X-KEY:METHOD=AES-128,URI="private.key"\n#EXTINF:4.0,',
      ),
    ]) {
      try {
        executeSelectedHlsAcquisition(blockedRuntime, {
          ...validInput(),
          selection: { ...validInput().selection, mediaText: alteredMedia },
        });
        throw new Error('unsupported media was admitted');
      } catch (error) {
        expect(error).toBeInstanceOf(CoreRuntimeFlowError);
        expect((error as CoreRuntimeFlowError).step).toBe('selected-hls-preflight');
      }
    }
  });

  it('a valid frozen rendition reaches the existing single Core scheduler (not a new engine)', () => {
    expect(() => executeSelectedHlsAcquisition(blockedRuntime, validInput())).toThrow(
      'SCHEDULER_EFFECT_STARTED',
    );
  });
});
