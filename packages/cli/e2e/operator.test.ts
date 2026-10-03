import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, run, runJson, tempDir } from './helpers.ts';

async function generatedTwice(): Promise<string> {
  const root = tempDir();
  expect((await runJson(['init', 'p'], { cwd: root })).exitCode).toBe(0);
  const cwd = join(root, 'p');
  expect((await runJson(['generate', 'props/crate'], { cwd })).exitCode).toBe(0);
  const file = join(cwd, 'assets/props/crate/asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as { materials: { wood: { color: string } } };
  asset.materials.wood.color = '#3e8948';
  writeFileSync(file, JSON.stringify(asset));
  expect((await runJson(['generate', 'props/crate'], { cwd })).exitCode).toBe(0);
  return cwd;
}

describe('history show and prune', () => {
  it('shows entries by name and prunes all but the newest', async () => {
    const cwd = await generatedTwice();
    const list = await runJson(['history', 'list', 'props/crate'], { cwd });
    const entries = (list.envelope.data as { entries: { id: string; hash: string }[] }).entries;
    expect(entries).toHaveLength(2);
    const shown = await runJson(['history', 'show', 'props/crate', 'previous'], { cwd });
    expect(shown.envelope.data).toMatchObject({ id: entries[1]?.id, cells: 4, validation: 'pass' });
    const byHash = await runJson(
      ['history', 'show', 'props/crate', (entries[0] as { hash: string }).hash.slice(0, 6)],
      { cwd },
    );
    expect((byHash.envelope.data as { id: string }).id).toBe(entries[0]?.id);
    const unsure = await runJson(['history', 'prune'], { cwd });
    expect([unsure.exitCode, unsure.envelope.error?.code]).toEqual([2, 'E_USAGE']);
    const dry = await runJson(['history', 'prune', '--keep', '1', '--dry-run'], { cwd });
    expect(dry.envelope.data).toMatchObject({ dryRun: true, kept: 1 });
    const pruned = await runJson(['history', 'prune', '--keep', '1'], { cwd });
    expect((pruned.envelope.data as { removed: unknown[] }).removed).toHaveLength(1);
    expect(
      ((await runJson(['history', 'list', 'props/crate'], { cwd })).envelope.data as { entries: unknown[] }).entries,
    ).toHaveLength(1);
  }, 120_000);
});

describe('explain and completion', () => {
  it('explains codes and lists them all', async () => {
    const cwd = tempDir();
    const one = await runJson(['explain', 'w_frame_clipped'], { cwd });
    expect(one.envelope.data).toMatchObject({ code: 'W_FRAME_CLIPPED', kind: 'warning' });
    const human = await run(['explain', 'E_PART_NOT_MANIFOLD'], { cwd });
    expect(human.stdout).toMatch(/^E_PART_NOT_MANIFOLD \(error, exit code 3\)/);
    expect(human.stdout).toMatch(/docs\/guide\/troubleshooting\.md#models-components-and-imports/);
    const all = await runJson(['explain', '--list'], { cwd });
    expect((all.envelope.data as { codes: unknown[] }).codes.length).toBeGreaterThan(60);
    const bad = await runJson(['explain', 'E_NOPE'], { cwd });
    expect([bad.exitCode, bad.envelope.error?.code]).toEqual([2, 'E_USAGE']);
  });

  it('prints completion scripts a shell can load', async () => {
    const cwd = tempDir();
    const bash = await run(['completion', 'bash'], { cwd });
    expect(bash.exitCode).toBe(0);
    // The printed script defines the completion function in a real bash.
    const out = execFileSync('bash', ['-c', `eval "$(${process.execPath} ${CLI} completion bash)"; type -t _td2d`], {
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('function');
    const bad = await runJson(['completion', 'powershell'], { cwd });
    expect([bad.exitCode, bad.envelope.error?.code]).toEqual([2, 'E_USAGE']);
  });
});
