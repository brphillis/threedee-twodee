import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetOf, assetOfPath, type ChangeWatcher, debounce, ignoredPath, watchBuild } from '../src/server/watch.ts';

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('flushes once, 100 ms after the last push, with everything collected', () => {
    vi.useFakeTimers();
    const flushed: string[][] = [];
    const d = debounce<string>(100, (items) => flushed.push([...items].sort()));
    d.push('a');
    vi.advanceTimersByTime(60);
    d.push('b');
    d.push('a');
    vi.advanceTimersByTime(99);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([['a', 'b']]);
    d.push('c');
    vi.advanceTimersByTime(100);
    expect(flushed).toEqual([['a', 'b'], ['c']]);
  });

  it('drops pending items when cancelled', () => {
    vi.useFakeTimers();
    const flushed: unknown[] = [];
    const d = debounce<string>(100, (items) => flushed.push(items));
    d.push('a');
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(flushed).toEqual([]);
  });
});

describe('assetOfPath', () => {
  it('maps files under build/ to their asset id', () => {
    expect(assetOfPath('props/crate/sheets/crate.png')).toBe('props/crate');
    expect(assetOfPath('characters/knight/generation.json')).toBe('characters/knight');
    expect(assetOfPath('a/b/c/sheets/manifest.json')).toBe('a/b/c');
    expect(assetOfPath('props/crate/renders/s.png')).toBe('*');
    expect(assetOfPath('batch-report.json')).toBe('*');
  });
});

describe('assetOf', () => {
  it('finds the asset build directory by its marker, wherever the change is inside it', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-watch-')));
    try {
      mkdirSync(join(root, 'props', 'crate', 'renders'), { recursive: true });
      writeFileSync(join(root, 'props', 'crate', '.td2d-output'), '');
      expect(assetOf(root, 'props/crate/renders/s.png')).toBe('props/crate');
      expect(assetOf(root, 'props/crate/renders')).toBe('props/crate');
      expect(assetOf(root, 'props/crate')).toBe('props/crate');
      expect(assetOf(root, 'props/other/sheets/x.png')).toBe('props/other');
      expect(assetOf(root, 'index.json')).toBe('*');
      expect(ignoredPath('props/crate/.partial')).toBe(true);
      expect(ignoredPath('props/crate/.partial/sheets/a.png')).toBe(true);
      expect(ignoredPath('props/crate/sheets/a.png.tmp')).toBe(true);
      expect(ignoredPath('props/crate/sheets/a.png')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('watchBuild', () => {
  const dirs: string[] = [];
  const watchers: ChangeWatcher[] = [];
  afterEach(async () => {
    for (const w of watchers.splice(0)) await w.close();
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  for (const mode of ['native', 'poll'] as const) {
    it(`reports the changed asset once per burst (${mode})`, async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-watch-')));
      dirs.push(root);
      mkdirSync(join(root, 'props', 'crate', 'sheets'), { recursive: true });
      mkdirSync(join(root, 'props', 'crate', '.partial'), { recursive: true });
      writeFileSync(join(root, 'props', 'crate', '.td2d-output'), '');
      const events: string[][] = [];
      watchers.push(await watchBuild(root, mode, (assets) => events.push(assets), 100));
      // chokidar needs its first scan, and macOS replays events from just before the watch
      // started (the directories made above): let both settle, then start counting.
      await new Promise((r) => setTimeout(r, 400));
      events.length = 0;
      const started = performance.now();
      // Like a regeneration: staged files, then outputs replaced, then other outputs removed.
      writeFileSync(join(root, 'props', 'crate', '.partial', 'ignored.json'), 'x');
      for (let i = 0; i < 10; i++) writeFileSync(join(root, 'props', 'crate', 'sheets', 'manifest.json'), String(i));
      mkdirSync(join(root, 'props', 'crate', 'renders'));
      writeFileSync(join(root, 'props', 'crate', 'renders', 's.png'), 'x');
      rmSync(join(root, 'props', 'crate', '.partial'), { recursive: true });
      while (events.length === 0 && performance.now() - started < 3000) await new Promise((r) => setTimeout(r, 10));
      await new Promise((r) => setTimeout(r, 250));
      expect(events).toEqual([['props/crate']]);
      expect(performance.now() - started).toBeLessThan(3000);
    });
  }

  it('starts watching a build directory created after the watcher', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-watch-')));
    dirs.push(root);
    const build = join(root, 'build');
    const events: string[][] = [];
    watchers.push(await watchBuild(build, 'native', (assets) => events.push(assets), 50));
    mkdirSync(join(build, 'props', 'crate', 'sheets'), { recursive: true });
    const started = performance.now();
    while (events.length === 0 && performance.now() - started < 3000) await new Promise((r) => setTimeout(r, 20));
    expect(events[0]).toEqual(['*']);
  });
});
