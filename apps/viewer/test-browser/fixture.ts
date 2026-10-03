// Writes a small synthetic build for the viewer's browser tests: known pixels, so tests can
// assert exact colours, palette indices and differences. Runs in Node (vitest globalSetup).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { GenerationRecordT, ManifestT, ValidationReportT } from '@td2d/schema';
import type { AssetDetail, HistoryDetail, ViewerIndex } from '../src/server/types.ts';
import { BIG, CLIPS, DIRECTIONS, FRAME, HISTORY_ENTRY, PALETTE, spritePixel } from './fixture-data.ts';

export * from './fixture-data.ts';

export const FIXTURE_DIR = join(import.meta.dirname, 'fixtures-out');
/** The fixture directory as the browser test server serves it. */
export const FIXTURE_URL = '/apps/viewer/test-browser/fixtures-out';

const HASH = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function build(changed: boolean) {
  const rows = CLIPS.flatMap((c, ci) => DIRECTIONS.map((d, di) => ({ clip: c, ci, d, di })));
  const columns = Math.max(...CLIPS.map((c) => c.frames));
  const width = columns * FRAME.width;
  const height = rows.length * FRAME.height;
  const rgba = new Uint8Array(width * height * 4);
  const cells: ManifestT['cells'] = [];
  rows.forEach((row, r) => {
    for (let f = 0; f < row.clip.frames; f++) {
      const key = `${row.clip.name}/${row.d}/${String(f).padStart(3, '0')}`;
      cells.push({
        key,
        clip: row.clip.name,
        direction: row.d,
        index: f,
        sheet: 'hero',
        x: f * FRAME.width,
        y: r * FRAME.height,
        w: FRAME.width,
        h: FRAME.height,
        trimmed: false,
        offset: { x: 0, y: 0 },
        mirrored: false,
      });
      for (let y = 0; y < FRAME.height; y++) {
        for (let x = 0; x < FRAME.width; x++) {
          let colour = spritePixel(row.ci, row.di, f, x, y);
          // The history entry's walk/s/001 has three body pixels in yellow instead.
          if (changed && key === 'walk/s/001' && y >= 3 && y <= 5 && x === 1) colour = PALETTE[3] as string;
          if (!colour) continue;
          const i = ((r * FRAME.height + y) * width + f * FRAME.width + x) * 4;
          rgba.set([...rgb(colour), 255], i);
        }
      }
    }
  });
  return { png: png(width, height, rgba), width, height, cells };
}

function manifest(generatedAt: string, sheet: { width: number; height: number }, cells: ManifestT['cells']): ManifestT {
  return {
    schemaVersion: '1.0.0',
    generator: { name: 'td2d', version: '0.0.0' },
    assetId: 'test/hero',
    assetHash: HASH('a'),
    generatedAt,
    frame: FRAME,
    pivot: { x: 4, y: 7, normalized: { x: 0.5, y: 7 / 8 } },
    pixelsPerUnit: 16,
    camera: { preset: 'dimetric', pitch: 30, yawOffset: 45, groundMargin: 1 },
    directions: DIRECTIONS.map((name, i) => ({ name, yaw: i * 45, mirrorOf: null })),
    palette: { mode: 'fixed', name: 'test-5', colors: PALETTE },
    clips: CLIPS.map((c) => ({
      name: c.name,
      fps: c.fps,
      frames: c.frames,
      loop: c.loop,
      motion: false,
      durationMs: (c.frames * 1000) / c.fps,
    })),
    sheets: [{ name: 'hero', image: 'hero.png', data: null, width: sheet.width, height: sheet.height, layout: 'grid' }],
    cells,
    files: { sheets: ['hero.png'], manifest: ['manifest.json'] },
    stages: { model: HASH('b'), sheet: HASH('c') },
    validation: { status: 'warn', warnings: 1, errors: 0, report: '../validation.json' },
  };
}

function validation(generatedAt: string): ValidationReportT {
  return {
    schemaVersion: '1.0.0',
    generator: { name: 'td2d', version: '0.0.0' },
    assetId: 'test/hero',
    generatedAt,
    status: 'warn',
    checks: [
      { id: 'coverage', status: 'pass', message: 'Every frame has opaque pixels.' },
      {
        id: 'pivot-drift',
        status: 'warn',
        message: 'The pivot drifts in 2 frames.',
        frames: ['walk/s/001', 'walk/n/002'],
      },
    ],
  };
}

function generation(finishedAt: string, exportHash: string): GenerationRecordT {
  return {
    schemaVersion: '1.0.0',
    generator: { name: 'td2d', version: '0.0.0' },
    assetId: 'test/hero',
    assetHash: HASH('a'),
    startedAt: finishedAt,
    finishedAt,
    durationMs: 1234,
    status: 'warn',
    backend: { id: 'playwright-swiftshader', version: '1', renderer: 'SwiftShader' },
    stages: [
      { name: 'render', hash: HASH('d'), cached: false, durationMs: 1000 },
      { name: 'export', hash: exportHash, cached: false, durationMs: 12 },
    ],
    outputs: [],
    warnings: [],
  };
}

export interface Fixture {
  readonly detail: AssetDetail;
  readonly history: HistoryDetail;
  readonly index: ViewerIndex;
  /** URL of a 4096 x 4096 sheet. */
  readonly big: string;
}

export function writeFixture(): Fixture {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const now = '2026-10-02T12:00:00.000Z';
  const before = '2026-10-01T12:00:00.000Z';
  const current = build(false);
  const old = build(true);
  const assetDir = join(FIXTURE_DIR, 'build', 'test', 'hero');
  const entryDir = join(FIXTURE_DIR, 'history', 'test', 'hero', HISTORY_ENTRY);
  for (const [dir, b, at] of [
    [assetDir, current, now],
    [entryDir, old, before],
  ] as const) {
    mkdirSync(join(dir, 'sheets'), { recursive: true });
    writeFileSync(join(dir, 'sheets', 'hero.png'), b.png);
    writeFileSync(join(dir, 'sheets', 'manifest.json'), JSON.stringify(manifest(at, b, b.cells)));
  }
  const files = `${FIXTURE_URL}/build/test/hero`;
  const detail: AssetDetail = {
    id: 'test/hero',
    files,
    manifest: manifest(now, current, current.cells),
    validation: validation(now),
    generation: generation(now, HASH('e')),
    resolved: null,
    model: null,
    history: [
      {
        id: HISTORY_ENTRY,
        createdAt: before,
        hash: '0123456789ab',
        validation: 'warn',
        files: `${FIXTURE_URL}/history/test/hero/${HISTORY_ENTRY}`,
      },
    ],
  };
  const history: HistoryDetail = {
    id: 'test/hero',
    entry: HISTORY_ENTRY,
    files: `${FIXTURE_URL}/history/test/hero/${HISTORY_ENTRY}`,
    manifest: manifest(before, old, old.cells),
    validation: validation(before),
    generation: generation(before, `sha256:0123456789ab${'f'.repeat(52)}`),
  };
  const summary = (id: string, validationStatus: 'pass' | 'warn' | 'fail', tags: string[], generatedAt: string) => ({
    id,
    generatedAt,
    frame: FRAME,
    pivot: detail.manifest.pivot,
    files,
    sheets: 1,
    thumbnail: { image: `${files}/sheets/hero.png`, x: 0, y: 0, w: 8, h: 8, offset: { x: 0, y: 0 } },
    cells: current.cells.length,
    directions: DIRECTIONS,
    clips: CLIPS.map((c) => c.name),
    tags,
    type: 'character',
    validation: validationStatus,
    warnings: validationStatus === 'warn' ? 1 : 0,
    errors: validationStatus === 'fail' ? 1 : 0,
  });
  const index: ViewerIndex = {
    mode: 'server',
    project: { name: 'fixture' },
    generatedAt: now,
    assets: [
      summary('test/hero', 'warn', ['hero', 'humanoid'], now),
      summary('props/crate', 'pass', ['prop'], '2026-09-30T12:00:00.000Z'),
      summary('props/barrel', 'fail', ['prop'], '2026-10-02T11:00:00.000Z'),
    ],
  };
  // A large sheet for the visible-region test: a gradient, so any drawn region is identifiable.
  const big = new Uint8Array(BIG.width * BIG.height * 4);
  for (let y = 0; y < BIG.height; y++)
    for (let x = 0; x < BIG.width; x++) big.set([x & 255, y & 255, (x >> 8) * 16, 255], (y * BIG.width + x) * 4);
  writeFileSync(join(FIXTURE_DIR, 'big.png'), png(BIG.width, BIG.height, big));
  const fixture: Fixture = { detail, history, index, big: `${FIXTURE_URL}/big.png` };
  writeFileSync(join(FIXTURE_DIR, 'fixture.json'), JSON.stringify(fixture));
  return fixture;
}

export default function setup(): void {
  writeFixture();
}
