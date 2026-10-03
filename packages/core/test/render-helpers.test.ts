import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  alphaCoverage,
  clipTimes,
  encodePng,
  flipRows,
  frameKey,
  OUTPUT_MARKER,
  opaqueBounds,
  planSamples,
  prepareOutputDir,
  readPng,
  type Td2dError,
} from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

describe('frame helpers', () => {
  const frame = { width: 2, height: 2, rgba: new Uint8Array([1, 1, 1, 255, 2, 2, 2, 0, 3, 3, 3, 0, 4, 4, 4, 128]) };

  it('flips rows', () => {
    expect(Array.from(flipRows(frame.rgba, 2, 2))).toEqual([3, 3, 3, 0, 4, 4, 4, 128, 1, 1, 1, 255, 2, 2, 2, 0]);
  });

  it('measures coverage and bounds', () => {
    expect(alphaCoverage(frame.rgba)).toBe(0.5);
    expect(opaqueBounds(frame)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(opaqueBounds({ width: 2, height: 1, rgba: new Uint8Array(8) })).toBeNull();
  });

  it('round-trips PNG without changing pixels', async () => {
    const decoded = await readPng(await encodePng(frame));
    expect(decoded.width).toBe(2);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(frame.rgba));
  });

  it('encodes identical frames to identical bytes', async () => {
    expect(Buffer.compare(await encodePng(frame), await encodePng(frame))).toBe(0);
  });
});

describe('sample planning', () => {
  const directions = [
    { name: 's', yaw: 0 },
    { name: 'w', yaw: 90 },
  ];

  it('plans one rest-pose frame per direction without clips', () => {
    expect(planSamples({ directions, clips: [] })).toEqual([
      { key: 'static/s/000', clip: null, time: 0, yaw: 0 },
      { key: 'static/w/000', clip: null, time: 0, yaw: 90 },
    ]);
  });

  it('orders samples by clip, then direction, then frame', () => {
    const keys = planSamples({ directions, clips: [{ name: 'walk', times: [0, 0.1] }] }).map((s) => s.key);
    expect(keys).toEqual(['walk/s/000', 'walk/s/001', 'walk/w/000', 'walk/w/001']);
    expect(frameKey('idle', 'n', 12)).toBe('idle/n/012');
  });

  it('spaces looping clips without the end frame and one-shot clips with it', () => {
    expect(clipTimes(0.6, 6, true)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(clipTimes(0.5, 6, false)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(clipTimes(1, 1, true)).toEqual([0]);
  });
});

describe('prepareOutputDir', () => {
  it('creates a marked directory and reuses it', () => {
    const dir = join(tempDir(), 'out');
    expect(prepareOutputDir(dir)).toEqual({ created: true });
    writeFileSync(join(dir, 'frame.png'), 'x');
    expect(prepareOutputDir(dir)).toEqual({ created: false });
  });

  it('marks an empty existing directory', () => {
    const dir = tempDir();
    prepareOutputDir(dir);
    expect(readdirSync(dir)).toContain(OUTPUT_MARKER);
  });

  it('refuses directories with unrelated files', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'src'));
    try {
      prepareOutputDir(dir);
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_OUTPUT_DIR_NOT_EMPTY');
    }
  });
});
