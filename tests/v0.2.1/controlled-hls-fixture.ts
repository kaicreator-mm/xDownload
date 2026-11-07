import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSyntheticSegmentBytes } from '../../packages/hls-vod-adapter/src/assemble.ts';

const SEGMENT_DURATIONS = [4, 4, 3.5] as const;

export interface ControlledHlsFixture {
  readonly origin: string;
  readonly requests: string[];
  readonly segmentBytes: readonly Uint8Array[];
  stop(): Promise<void>;
}

/**
 * Real 127.0.0.1 HTTP fixture for one finite, single-rendition HLS VOD.
 * Segment bytes are synthetic adapter fixtures, not production media.
 */
export async function startControlledHlsFixture(): Promise<ControlledHlsFixture> {
  const requests: string[] = [];
  const segmentBytes = SEGMENT_DURATIONS.map((durationSeconds) =>
    createSyntheticSegmentBytes({ durationSeconds, codecClass: 'xdv1-video' }),
  );
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="xdv1-video",RESOLUTION=1280x720',
    'variant-720p.m3u8',
    '',
  ].join('\n');
  const media = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    ...SEGMENT_DURATIONS.flatMap((duration, index) => [
      '#EXTINF:' + String(duration) + ',segment-' + String(index),
      'segment-' + String(index) + '.ts',
    ]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
  let server: Server | undefined;
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push(path);
    if (path === '/master.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end(master);
      return;
    }
    if (path === '/variant-720p.m3u8') {
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end(media);
      return;
    }
    const match = /^\/segment-(\d+)\.ts$/.exec(path);
    if (match !== null) {
      const bytes = segmentBytes[Number(match[1])];
      if (bytes === undefined) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'video/mp2t',
        'content-length': String(bytes.byteLength),
      });
      response.end(Buffer.from(bytes));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const origin = 'http://127.0.0.1:' + String(address.port);
  return {
    origin,
    requests,
    segmentBytes,
    async stop() {
      server?.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        if (server === undefined) {
          resolve();
          return;
        }
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server = undefined;
      });
    },
  };
}
