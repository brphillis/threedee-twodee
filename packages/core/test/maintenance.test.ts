import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_SETTINGS,
  CACHE_INDEX,
  cacheStats,
  cleanCache,
  cleanStaleTemp,
  createImage,
  createWorkerPool,
  ItemCache,
  listCacheEntries,
  loadProject,
  parseDuration,
  parseSize,
  processFrames,
  StageCache,
  type Td2dError,
} from '../src/index.ts';
import { makeProject, tempDir } from './helpers/tmp.ts';

const DAY = 86_400_000;

/** A cache with three stage entries and two items, used at known times. */
function seeded() {
  const root = join(tempDir(), 'cache');
  const stages = new StageCache(root);
  const now = Date.now();
  const make = (stage: string, hash: string, bytes: number, ageMs: number) => {
    const tmp = join(tempDir(), `${stage}-${hash}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'out.bin'), Buffer.alloc(bytes));
    const dir = stages.commit(tmp, { stage, hash, createdAt: new Date().toISOString(), durationMs: 1, data: {} });
    const t = new Date(now - ageMs);
    utimesSync(join(dir, 'meta.json'), t, t);
  };
  make('render', 'aa11', 1000, 3 * DAY);
  make('render', 'bb22', 2000, 2 * 3_600_000);
  make('pixel', 'cc33', 500, 10 * DAY);
  const items = new ItemCache(root);
  const old = items.put('render', 'dd44', Buffer.alloc(300));
  const t = new Date(now - 2 * DAY);
  utimesSync(old, t, t);
  items.put('render', 'ee55', Buffer.alloc(100));
  return root;
}

describe('sizes and durations', () => {
  it('parses sizes and durations, and rejects the rest with a hint', () => {
    expect(parseSize('5GB')).toBe(5 * 1024 ** 3);
    expect(parseSize('1.5 mb')).toBe(1572864);
    expect(parseSize(42)).toBe(42);
    expect(parseDuration('1d')).toBe(DAY);
    expect(parseDuration('12h')).toBe(DAY / 2);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('2w')).toBe(14 * DAY);
    for (const bad of ['5 gigs', '-1MB']) expect(() => parseSize(bad)).toThrow(/not a size/);
    try {
      parseDuration('soon');
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).hint).toMatch(/12h/);
    }
  });
});

describe('cache maintenance', () => {
  it('lists stage entries and items, least recently used first, with their sizes', () => {
    const root = seeded();
    const entries = listCacheEntries(root);
    expect(entries.map((e) => `${e.kind}:${e.group}`)).toEqual([
      'stage:pixel',
      'stage:render',
      'item:render',
      'stage:render',
      'item:render',
    ]);
    const stats = cacheStats(root, entries);
    expect(stats.entries).toBe(5);
    expect(stats.groups.find((g) => g.kind === 'stage' && g.group === 'render')?.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(3900);
  });

  it('removes only entries older than the limit', () => {
    const root = seeded();
    const dry = cleanCache(root, { olderThanMs: DAY, dryRun: true });
    expect(dry).toMatchObject({ removed: 3, dryRun: true, remaining: 2 });
    expect(listCacheEntries(root)).toHaveLength(5);
    const result = cleanCache(root, { olderThanMs: DAY });
    expect(result.removed).toBe(3);
    const left = listCacheEntries(root);
    expect(left.map((e) => e.path).sort()).toEqual(['items/render/ee/ee55.png', 'render/bb/bb22'].sort());
    const index = JSON.parse(readFileSync(join(root, CACHE_INDEX), 'utf8')) as { entries: { path: string }[] };
    expect(index.entries.map((e) => e.path).sort()).toEqual(left.map((e) => e.path).sort());
  });

  it('removes the least recently used entries until the cache fits, or everything', () => {
    const root = seeded();
    const result = cleanCache(root, { maxBytes: 2500 });
    expect(result.remainingBytes).toBeLessThanOrEqual(2500);
    expect(listCacheEntries(root).map((e) => e.path)).toContain('items/render/ee/ee55.png');
    expect(existsSync(join(root, 'pixel/cc/cc33'))).toBe(false);
    expect(cleanCache(root, { all: true }).remaining).toBe(0);
  });

  it('marks a stage entry as used when it is read', () => {
    const root = seeded();
    // Entries written moments ago can share the read's millisecond: age them by a second, so the
    // test asks only whether reading makes an entry the most recent.
    const second = new Date(Date.now() - 1000);
    for (const e of listCacheEntries(root))
      if (e.lastUsed > second) utimesSync(join(root, e.path, e.kind === 'stage' ? 'meta.json' : ''), second, second);
    new StageCache(root).read('pixel', 'cc33');
    expect(listCacheEntries(root).at(-1)?.path).toBe('pixel/cc/cc33');
  });
});

describe('temporary directories', () => {
  it('removes the temporary directories of runs that are gone and keeps live ones', () => {
    const project = loadProject(makeProject());
    const tmp = join(project.root, '.td2d', 'tmp');
    const dir = (name: string, owner?: object) => {
      mkdirSync(join(tmp, name), { recursive: true });
      if (owner) writeFileSync(join(tmp, name, 'owner.json'), JSON.stringify(owner));
    };
    dir('crashed', { pid: 2 ** 22 + 12345 });
    dir('ownerless');
    dir('live', { pid: process.ppid });
    expect(cleanStaleTemp(project).sort()).toEqual(['crashed', 'ownerless']);
    expect(existsSync(join(tmp, 'live'))).toBe(true);
  });

  it('touching a file the asset does not use changes no stage hash', async () => {
    const root = makeProject();
    const { planStageHashes, loadAsset, loadLibrary, resolveAsset } = await import('../src/index.ts');
    const hashes = () => {
      const project = loadProject(root);
      return planStageHashes(resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project)).asset);
    };
    const before = hashes();
    mkdirSync(join(root, 'components'), { recursive: true });
    writeFileSync(
      join(root, 'components', 'unused.json'),
      JSON.stringify({ schemaVersion: '1.0.0', name: 'unused', parts: [] }),
    );
    writeFileSync(join(root, 'notes.txt'), 'scratch');
    expect(hashes()).toEqual(before);
  });
});

describe('worker pool', () => {
  const frames = Array.from({ length: 64 }, (_, i) => {
    const image = createImage(32, 32);
    for (let p = 0; p < 32 * 32; p++)
      if ((p + i) % 3) image.rgba.set([(p * 7 + i) % 256, (p * 3) % 256, i * 4, 255], p * 4);
    return { key: `walk/s/${String(i).padStart(3, '0')}`, clip: 'walk', image };
  });
  const settings = {
    ...BASE_SETTINGS.pixel,
    palette: 'fixed:x',
    outline: { color: '#000000', side: 'outside' as const, width: 1 },
  };
  const palette = ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff'];

  it('processes frames in worker threads exactly as inline', async () => {
    const pool = createWorkerPool(2);
    try {
      const pooled = await pool.pixel({ frames, supersample: 2, settings, fixedPalette: palette, perFrame: true });
      const inline = processFrames(frames, 2, settings, palette);
      for (const s of pooled.sprites)
        expect(
          Buffer.compare(
            Buffer.from(s.image.rgba),
            Buffer.from((inline.sprites.get(s.key) as { rgba: Uint8Array }).rgba),
          ),
        ).toBe(0);
    } finally {
      await pool.close();
    }
  });

  it('stops work when cancelled', async () => {
    const pool = createWorkerPool(2);
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      pool.pixel({ frames, supersample: 2, settings, fixedPalette: palette, perFrame: true }, controller.signal),
    ).rejects.toThrow();
    await pool.destroy();
  });
});
