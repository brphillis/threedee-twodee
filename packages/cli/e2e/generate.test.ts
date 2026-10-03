import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonSchemaFor } from '@td2d/schema';
import Ajv2020 from 'ajv/dist/2020.js';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CLI, run, runJson, tempDir } from './helpers.ts';

interface Result {
  assetId: string;
  status: string;
  outputs: Record<string, string>;
  validation: { status: string } | null;
  cache: { hits: number; misses: number };
  stages: { name: string; status: string }[];
  durationMs: number;
}

async function project(): Promise<string> {
  const root = join(tempDir(), 'game');
  expect((await run(['init', root], { cwd: tempDir() })).exitCode).toBe(0);
  return root;
}

const results = (envelope: { data?: unknown }) => (envelope.data as { results: Result[] }).results;

describe('td2d generate', () => {
  it('runs the full pipeline from a fresh project, then reuses everything', async () => {
    const root = await project();
    const cold = await runJson(['generate', 'props/crate'], { cwd: root });
    expect(cold.exitCode, cold.stderr).toBe(0);
    const [r] = results(cold.envelope);
    expect(r).toMatchObject({
      assetId: 'props/crate',
      status: 'ok',
      validation: { status: 'pass' },
      cache: { hits: 0, misses: 9 },
    });
    expect(r?.outputs).toMatchObject({
      sheet: 'build/props/crate/sheets/crate.png',
      data: 'build/props/crate/sheets/crate.json',
      manifest: 'build/props/crate/sheets/manifest.json',
      validation: 'build/props/crate/validation.json',
    });
    const ajv = new Ajv2020.default({ strict: false });
    const validAseprite = ajv.compile(jsonSchemaFor('aseprite-sheet') as object);
    expect(
      validAseprite(JSON.parse(readFileSync(join(root, r?.outputs.data ?? ''), 'utf8'))),
      JSON.stringify(validAseprite.errors),
    ).toBe(true);
    const validManifest = ajv.compile(jsonSchemaFor('manifest') as object);
    expect(validManifest(JSON.parse(readFileSync(join(root, r?.outputs.manifest ?? ''), 'utf8')))).toBe(true);
    const meta = await sharp(join(root, r?.outputs.sheet ?? '')).metadata();
    expect([meta.width, meta.height]).toEqual([32, 128]);
    console.log(`cold generate: ${r?.durationMs} ms in-process, ${cold.envelope.durationMs} ms command`);

    const warm = await runJson(['generate'], { cwd: root });
    expect(results(warm.envelope)[0]?.cache).toEqual({ hits: 9, misses: 0 });
    console.log(`warm generate: ${warm.envelope.durationMs} ms command`);
    expect(cold.envelope.durationMs).toBeLessThan(10_000);
    expect(warm.envelope.durationMs).toBeLessThan(2_000);

    const forced = await runJson(['generate', '--force'], { cwd: root });
    expect(results(forced.envelope)[0]?.cache).toEqual({ hits: 0, misses: 9 });
    const dry = await runJson(['generate', '--dry-run', '--from', 'sheet'], { cwd: root });
    expect(
      results(dry.envelope)[0]
        ?.stages.filter((s) => s.status === 'would-run')
        .map((s) => s.name),
    ).toEqual(['sheet', 'validate', 'export']);
  });

  it('exits 5 when sprites fail validation, and 3 for an invalid definition', async () => {
    const root = await project();
    const file = join(root, 'assets/props/crate/asset.json');
    const asset = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...asset, acceptance: { maxColors: 2 } }));
    const failing = await runJson(['generate'], { cwd: root });
    expect(failing.exitCode).toBe(5);
    expect(failing.envelope.error?.code).toBe('E_VALIDATION_FAILED');
    expect(existsSync(join(root, 'build/props/crate/sheets/crate.png'))).toBe(true);

    writeFileSync(file, JSON.stringify({ ...asset, frame: { width: 'big', height: 32 } }));
    const invalid = await runJson(['generate'], { cwd: root });
    expect([invalid.exitCode, invalid.envelope.error?.code, invalid.envelope.error?.issues?.[0]?.path]).toEqual([
      3,
      'E_ASSET_INVALID',
      'frame.width',
    ]);
  });

  it('reprocesses pixels from cached renders and writes an indexed PNG for a fixed palette', async () => {
    const root = await project();
    expect((await run(['generate'], { cwd: root })).exitCode).toBe(0);
    const file = join(root, 'assets/props/crate/asset.json');
    const original = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    // A palette and dither change leaves the framing alone, so the renders are reused.
    writeFileSync(
      file,
      JSON.stringify({ ...original, pixel: { palette: 'fixed:pico-8', dither: 'bayer-4', ditherStrength: 0.35 } }),
    );
    const processed = await runJson(['process', 'props/crate'], { cwd: root });
    expect(processed.exitCode, processed.stderr).toBe(0);
    const [r] = results(processed.envelope);
    expect(Object.fromEntries(r?.stages.map((s) => [s.name, s.status]) ?? [])).toMatchObject({
      model: 'cached',
      render: 'cached',
      pixel: 'ran',
      sheet: 'ran',
      export: 'ran',
    });
    const sheet = readFileSync(join(root, r?.outputs.sheet ?? ''));
    expect(sheet[25]).toBe(3);
    const manifest = JSON.parse(readFileSync(join(root, r?.outputs.manifest ?? ''), 'utf8')) as {
      palette: { mode: string; name: string; colors: string[] };
    };
    expect(manifest.palette).toMatchObject({ mode: 'fixed:pico-8', name: 'pico-8' });
    expect(manifest.palette.colors).toHaveLength(16);
    const report = JSON.parse(readFileSync(join(root, r?.outputs.validation ?? ''), 'utf8')) as {
      checks: { id: string; status: string }[];
    };
    expect(report.checks.find((c) => c.id === 'palette')?.status).toBe('pass');

    const frame = await runJson(['inspect', 'props/crate', '--frame', 'idle/s/000'], { cwd: root });
    const data = frame.envelope.data as { colors: string[]; centroid: { x: number; y: number } };
    expect(data.colors.every((c) => manifest.palette.colors.includes(c))).toBe(true);
    expect(data.centroid.x).toBeGreaterThan(12);
    expect(data.centroid.x).toBeLessThan(20);

    // An outside outline needs a pixel more room, which moves the ground line, so it renders again.
    writeFileSync(file, JSON.stringify({ ...original, pixel: 'pico-8' }));
    const outlined = await runJson(['process', 'props/crate'], { cwd: root });
    expect(outlined.exitCode, outlined.stderr).toBe(0);
    expect(
      Object.fromEntries(results(outlined.envelope)[0]?.stages.map((s) => [s.name, s.status]) ?? []),
    ).toMatchObject({
      model: 'cached',
      plan: 'ran',
      render: 'ran',
    });
  });

  it('inspects, previews and lists history', async () => {
    const root = await project();
    await run(['generate'], { cwd: root });
    const inspect = await runJson(['inspect', 'props/crate'], { cwd: root });
    expect(inspect.envelope.data).toMatchObject({
      assetId: 'props/crate',
      frame: { width: 32, height: 32 },
      directions: ['s', 'w', 'n', 'e'],
      validation: { status: 'pass' },
    });
    const frame = await runJson(['inspect', 'props/crate', '--frame', 'idle/s/000'], { cwd: root });
    expect(frame.envelope.data).toMatchObject({ key: 'idle/s/000', width: 32, height: 32 });
    const badFrame = await runJson(['inspect', 'props/crate', '--frame', 'walk/s/000'], { cwd: root });
    expect(badFrame.exitCode).toBe(2);

    const preview = await runJson(['preview', 'props/crate', '--scale', '4'], { cwd: root });
    expect(preview.envelope.data).toMatchObject({ file: 'build/props/crate/preview.png', width: 128, height: 512 });
    const out = join(tempDir(), 'p.png');
    expect((await runJson(['preview', 'props/crate', '--out', out], { cwd: root })).exitCode).toBe(0);
    expect((await runJson(['preview', 'props/crate', '--out', out], { cwd: root })).exitCode).toBe(2);
    expect((await runJson(['preview', 'props/crate', '--out', out, '--overwrite'], { cwd: root })).exitCode).toBe(0);

    const history = await runJson(['history', 'list', 'props/crate'], { cwd: root });
    expect((history.envelope.data as { entries: unknown[] }).entries).toHaveLength(1);

    const notGenerated = await runJson(['inspect', 'props/crate'], { cwd: await project() });
    expect([notGenerated.exitCode, notGenerated.envelope.error?.code]).toEqual([2, 'E_NOT_GENERATED']);
  });

  it('builds and inspects the model, and renders an asset id', async () => {
    const root = await project();
    const model = await runJson(['model', 'inspect', 'props/crate'], { cwd: root });
    expect(model.envelope.data).toMatchObject({
      glb: 'build/props/crate/rig/model.glb',
      report: { triangles: 24, validator: { errors: 0 } },
      bones: [],
      clips: [{ name: 'idle', source: 'rest', animated: false }],
    });
    const render = await runJson(['render', 'props/crate'], { cwd: root });
    expect(results(render.envelope)[0]?.stages.find((s) => s.name === 'pixel')?.status).toBe('skipped');
    expect(existsSync(join(root, 'build/props/crate/renders/idle/s/000.png'))).toBe(true);
    const both = await runJson(['render', 'props/crate', '--glb', 'x.glb'], { cwd: root });
    expect(both.exitCode).toBe(2);
  });
});

describe('td2d viewer', () => {
  it('serves the generated sheet with its cells and stops on SIGINT', async () => {
    const root = await project();
    await run(['generate'], { cwd: root });
    const child = spawn(process.execPath, [CLI, 'viewer', '--port', '0', '--json'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const url = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      child.stderr.on('data', (d: Buffer) => {
        buffer += d.toString();
        const match = /"url":"(http:[^"]+)"/.exec(buffer);
        if (match?.[1]) resolve(match[1]);
      });
      child.on('exit', () => reject(new Error(`viewer exited early: ${buffer}`)));
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await page.waitForSelector('[data-asset="props/crate"]');
      expect(await page.locator('[data-asset]').count()).toBe(1);
      await page.click('[data-asset="props/crate"]');
      await page.waitForSelector('[data-sheet-loaded="true"]');
      expect(await page.locator('[data-selected-cell]').textContent()).toBe(
        '32 x 128, 4 cells. Click a cell to select it.',
      );
      const detail = (await (await fetch(`${url}api/assets/props/crate`)).json()) as { manifest: { cells: unknown[] } };
      expect(detail.manifest.cells).toHaveLength(4);
    } finally {
      await browser.close();
    }
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', resolve);
      child.kill('SIGINT');
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).data).toMatchObject({ url, stopped: true });
  });
});
