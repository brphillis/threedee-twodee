import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findHistoryEntry,
  historyAssetIds,
  listHistory,
  loadProject,
  pruneHistory,
  recordHistory,
  showHistory,
  type Td2dError,
} from '../src/index.ts';
import { makeProject } from './helpers/tmp.ts';

const DAY = 86_400_000;

/** A project whose crate has five recorded generations, a day apart, and a deleted asset's history. */
function seeded() {
  const root = makeProject();
  const project = loadProject(root);
  const build = join(root, 'build', 'props', 'crate');
  mkdirSync(join(build, 'sheets'), { recursive: true });
  const start = Date.parse('2026-09-01T00:00:00.000Z');
  for (let i = 0; i < 5; i++) {
    writeFileSync(
      join(build, 'sheets', 'manifest.json'),
      JSON.stringify({
        sheets: [{ name: 'crate', width: 32, height: 128, layout: 'grid' }],
        cells: [{}, {}, {}, {}],
        clips: [{ name: 'idle', frames: 1 }],
      }),
    );
    writeFileSync(join(build, 'sheets', 'crate.png'), Buffer.alloc(100 * (i + 1)));
    writeFileSync(
      join(build, 'validation.json'),
      JSON.stringify({
        status: i === 4 ? 'warn' : 'pass',
        checks: i === 4 ? [{ id: 'jitter', status: 'warn', message: 'moves' }] : [],
      }),
    );
    recordHistory(project, 'props/crate', build, `${String(i).repeat(12)}${'f'.repeat(52)}`, new Date(start + i * DAY));
  }
  const gone = join(root, 'history', 'props', 'gone', '2026-08-01T00-00-00-000Z-aaaaaaaaaaaa', 'sheets');
  mkdirSync(gone, { recursive: true });
  writeFileSync(join(gone, 'manifest.json'), '{}');
  return { root, project, now: new Date(start + 4 * DAY + 3_600_000) };
}

describe('history', () => {
  it('finds entries by id, prefix, hash, latest and previous', () => {
    const { project } = seeded();
    const entries = listHistory(project, 'props/crate');
    expect(entries.map((e) => e.hash)).toEqual([
      '444444444444',
      '333333333333',
      '222222222222',
      '111111111111',
      '000000000000',
    ]);
    expect(findHistoryEntry(project, 'props/crate', 'latest').hash).toBe('444444444444');
    expect(findHistoryEntry(project, 'props/crate', 'previous').hash).toBe('333333333333');
    expect(findHistoryEntry(project, 'props/crate', '2222').hash).toBe('222222222222');
    expect(findHistoryEntry(project, 'props/crate', (entries[3] as { id: string }).id).hash).toBe('111111111111');
    expect(() => findHistoryEntry(project, 'props/crate', '2026-09-0')).toThrow(/matches 5/);
    expect(() => findHistoryEntry(project, 'props/crate', 'nope')).toThrow(/no history entry/);
    try {
      findHistoryEntry(project, 'props/none', 'latest');
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_USAGE');
      expect((error as Td2dError).message).toMatch(/has no history/);
    }
  });

  it('shows what an entry holds', () => {
    const { project } = seeded();
    const shown = showHistory(project, 'props/crate', 'latest');
    expect(shown).toMatchObject({
      hash: '444444444444',
      validation: 'warn',
      cells: 4,
      sheets: [{ name: 'crate', width: 32, height: 128, layout: 'grid' }],
      clips: [{ name: 'idle', frames: 1 }],
      checks: [{ id: 'jitter', status: 'warn', message: 'moves' }],
      generation: null,
    });
    expect(shown.bytes).toBeGreaterThan(500);
  });

  it('lists every asset with history, including deleted ones', () => {
    const { project } = seeded();
    expect(historyAssetIds(project)).toEqual(['props/crate', 'props/gone']);
  });

  it('prunes beyond --keep and older than --older-than, never the newest, and dry-runs', () => {
    const { project, now } = seeded();
    const dry = pruneHistory(project, ['props/crate'], { keep: 2, dryRun: true, now });
    expect(dry.removed.map((e) => e.hash)).toEqual(['222222222222', '111111111111', '000000000000']);
    expect(dry.dryRun).toBe(true);
    expect(listHistory(project, 'props/crate')).toHaveLength(5);
    // Older than 2.5 days: the entries from day 0 and day 1.
    const old = pruneHistory(project, ['props/crate'], { olderThanMs: 2.5 * DAY, now });
    expect(old.removed.map((e) => e.hash)).toEqual(['111111111111', '000000000000']);
    expect(old.kept).toBe(3);
    expect(old.bytes).toBeGreaterThan(0);
    for (const e of old.removed) expect(existsSync(join(project.root, e.dir))).toBe(false);
    // The newest entry survives any rule.
    const all = pruneHistory(project, ['props/crate', 'props/gone'], { keep: 1, olderThanMs: 0, now });
    expect(listHistory(project, 'props/crate').map((e) => e.hash)).toEqual(['444444444444']);
    expect(listHistory(project, 'props/gone')).toHaveLength(1);
    expect(all.kept).toBe(2);
    expect(() => pruneHistory(project, ['props/crate'], {})).toThrow('Say which entries to remove.');
  });
});
