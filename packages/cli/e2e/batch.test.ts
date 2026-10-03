import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BatchReport } from '@td2d/schema';
import { describe, expect, it } from 'vitest';
import { CLI, runJson, tempDir } from './helpers.ts';

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples');

function copy(example: string) {
  const root = join(tempDir(), example);
  cpSync(join(EXAMPLES, example), root, {
    recursive: true,
    filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
  });
  return root;
}

/** Make props/fence name a material that does not exist. */
function breakFence(root: string, broken = true) {
  const file = join(root, 'assets/props/fence/asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as { model: { parts: { material?: string }[] } };
  const original = (asset.model.parts[0] as { material?: string }).material;
  if (broken) (asset.model.parts[0] as { material?: string }).material = 'unobtainium';
  writeFileSync(file, JSON.stringify(asset));
  return original;
}
const report = (root: string) =>
  BatchReport.parse(JSON.parse(readFileSync(join(root, 'build/batch-report.json'), 'utf8')));

describe('td2d batch', () => {
  it('continues past a broken asset with --continue-on-error, exits 6 and keeps the other outputs', async () => {
    const root = copy('props');
    const file = join(root, 'assets/props/fence/asset.json');
    const original = readFileSync(file, 'utf8');
    breakFence(root);
    const run = await runJson(['batch', '--filter', 'props/*', '--continue-on-error', '--concurrency', '3'], {
      cwd: root,
    });
    expect(run.exitCode, run.stderr).toBe(6);
    expect(run.envelope.error?.code).toBe('E_BATCH_PARTIAL');
    const r = report(root);
    expect(r.status).toBe('partial');
    expect(r.totals).toEqual({ ok: 7, warn: 0, failed: 1, skipped: 0 });
    expect(r.assets.find((a) => a.assetId === 'props/fence')).toMatchObject({
      status: 'failed',
      error: { code: 'E_ASSET_INVALID' },
    });
    for (const a of r.assets.filter((x) => x.status === 'ok'))
      expect(existsSync(join(root, a.outputs?.sheet ?? 'missing'))).toBe(true);
    expect(r.options).toMatchObject({ filter: 'props/*', concurrency: 3, continueOnError: true });

    // Fix the asset and resume: only the failed asset runs.
    writeFileSync(file, original);
    const resumed = await runJson(['batch', '--resume', 'build/batch-report.json', '--continue-on-error'], {
      cwd: root,
    });
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    const after = report(root);
    expect(after.options.resumedFrom).toBe('build/batch-report.json');
    expect(after.assets.filter((a) => a.skipped === 'resumed')).toHaveLength(7);
    expect(after.assets.find((a) => a.assetId === 'props/fence')?.status).toBe('ok');
  });

  it('stops at the first failure by default and exits 4', async () => {
    const root = copy('props');
    breakFence(root);
    const run = await runJson(['batch', '--concurrency', '1'], { cwd: root });
    expect(run.exitCode, run.stderr).toBe(4);
    expect(run.envelope.error?.code).toBe('E_BATCH_FAILED');
    const r = report(root);
    expect(r.status).toBe('failed');
    const order = r.assets.map((a) => a.assetId);
    const after = order.slice(order.indexOf('props/fence') + 1);
    for (const id of after)
      expect(r.assets.find((a) => a.assetId === id)).toMatchObject({ status: 'skipped', skipped: 'stopped' });
    expect(r.assets.find((a) => a.assetId === 'props/barrel')?.status).toBe('ok');
  });

  it('runs a manifest with per-asset overrides and rejects unknown assets', async () => {
    const root = copy('props');
    writeFileSync(
      join(root, 'release.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        assets: [{ id: 'props/barrel', overrides: { pixel: 'pico-8' } }, { id: 'props/crate-notched' }],
      }),
    );
    const run = await runJson(['batch', '--manifest', 'release.json'], { cwd: root });
    expect(run.exitCode, run.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(root, 'build/props/barrel/sheets/manifest.json'), 'utf8')) as {
      palette: { name: string };
    };
    expect(manifest.palette.name).toBe('pico-8');
    expect(report(root).assets.map((a) => a.assetId)).toEqual(['props/barrel', 'props/crate-notched']);
    writeFileSync(
      join(root, 'bad.json'),
      JSON.stringify({ schemaVersion: '1.0.0', assets: [{ id: 'props/nothing' }] }),
    );
    const bad = await runJson(['batch', '--manifest', 'bad.json'], { cwd: root });
    expect(bad.envelope.error?.code).toBe('E_ASSET_NOT_FOUND');
    writeFileSync(
      join(root, 'bad.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        assets: [{ id: 'props/barrel', overrides: { pixel: { palette: 7 } } }],
      }),
    );
    const invalid = await runJson(['batch', '--manifest', 'bad.json'], { cwd: root });
    expect(invalid.exitCode).toBe(4);
    expect(report(root).assets[0]?.error).toMatchObject({ code: 'E_ASSET_INVALID' });
  });

  it('exits 130 within 3 seconds of SIGINT, leaves no browser behind, and the next run completes', async () => {
    const root = copy('characters');
    const tag = `batch-test-${process.pid}-${Date.now()}`;
    const child = spawn(process.execPath, [CLI, 'batch', '--concurrency', '2', '--json'], {
      cwd: root,
      env: { ...process.env, TD2D_RUN_TAG: tag },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const rendering = new Promise<void>((resolve) => {
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        if (/"event":"item:done","stage":"render"/.test(stderr)) resolve();
      });
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    await rendering;
    const sent = Date.now();
    child.kill('SIGINT');
    const code = await exited;
    expect(Date.now() - sent).toBeLessThan(3000);
    expect(code).toBe(130);
    const processes = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' });
    expect(processes.includes(`--td2d-run=${tag}`)).toBe(false);
    const cancelled = report(root);
    expect(cancelled.status).toBe('cancelled');
    const next = await runJson(['batch'], { cwd: root });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(report(root).totals.ok).toBe(2);
    expect(readdirSync(join(root, '.td2d/tmp'))).toEqual([]);
    for (const id of ['knight', 'knight-packed'])
      expect(existsSync(join(root, 'build/characters', id, '.partial'))).toBe(false);
  }, 120_000);
});
