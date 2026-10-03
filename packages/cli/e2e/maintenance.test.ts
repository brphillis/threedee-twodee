import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { run, runJson, tempDir } from './helpers.ts';

async function project(): Promise<string> {
  const root = join(tempDir(), 'game');
  expect((await run(['init', root], { cwd: tempDir() })).exitCode).toBe(0);
  return root;
}

describe('td2d compare and td2d cache', () => {
  it('compares a build with the previous generation cell by cell and writes a diff image', async () => {
    const root = await project();
    expect((await run(['generate'], { cwd: root })).exitCode).toBe(0);
    const none = await runJson(['compare', 'props/crate'], { cwd: root });
    expect([none.exitCode, none.envelope.error?.code]).toEqual([2, 'E_USAGE']);
    const file = join(root, 'assets/props/crate/asset.json');
    const asset = JSON.parse(readFileSync(file, 'utf8')) as { materials: Record<string, { color: string }> };
    (asset.materials.wood as { color: string }).color = '#3e8948';
    writeFileSync(file, JSON.stringify(asset));
    expect((await run(['generate'], { cwd: root })).exitCode).toBe(0);
    const compared = await runJson(['compare', 'props/crate', '--out', 'diff.png'], { cwd: root });
    expect(compared.exitCode, compared.stderr).toBe(0);
    const data = compared.envelope.data as {
      cells: number;
      changedCells: number;
      changedPixels: number;
      added: string[];
      diffImage: string;
      changes: { key: string; pixels: number }[];
    };
    expect(data.cells).toBe(4);
    expect(data.changedCells).toBe(4);
    expect(data.changedPixels).toBeGreaterThan(100);
    expect(data.added).toEqual([]);
    const meta = await sharp(join(root, data.diffImage)).metadata();
    expect(meta.height).toBeGreaterThan(4 * 32 * 4);
    const history = await runJson(['history', 'list', 'props/crate'], { cwd: root });
    const entries = (history.envelope.data as { entries: { id: string }[] }).entries;
    const same = await runJson(['compare', 'props/crate', '--against', entries[0]?.id as string], { cwd: root });
    expect((same.envelope.data as { changedCells: number }).changedCells).toBe(0);
  });

  it('reports cache size and cleans it by age and entirely', async () => {
    const root = await project();
    expect((await run(['generate'], { cwd: root })).exitCode).toBe(0);
    const stats = await runJson(['cache', 'stats'], { cwd: root });
    const data = stats.envelope.data as { entries: number; groups: { kind: string; group: string; entries: number }[] };
    expect(data.entries).toBeGreaterThan(9);
    // Four samples, each a PNG and a .json sidecar.
    expect(data.groups.find((g) => g.kind === 'item' && g.group === 'render')?.entries).toBe(8);
    expect(existsSync(join(root, '.td2d/cache/index.json'))).toBe(true);
    const young = await runJson(['cache', 'clean', '--older-than', '1d'], { cwd: root });
    expect((young.envelope.data as { removed: number }).removed).toBe(0);
    const all = await runJson(['cache', 'clean', '--all'], { cwd: root });
    expect((all.envelope.data as { remaining: number }).remaining).toBe(0);
    expect((await runJson(['cache', 'clean'], { cwd: root })).exitCode).toBe(2);
    // The build stays, and the next run renders again from scratch.
    expect(existsSync(join(root, 'build/props/crate/sheets/crate.png'))).toBe(true);
    const again = await runJson(['generate'], { cwd: root });
    expect(
      (again.envelope.data as { results: { items: { render: { rendered: number } } }[] }).results[0]?.items.render
        .rendered,
    ).toBe(4);
  });
});
