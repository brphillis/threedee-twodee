/// <reference lib="dom" />
import { type ChildProcess, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonSchemaFor } from '@td2d/schema';
import Ajv2020 from 'ajv/dist/2020.js';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJson } from './helpers.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function serve(sheets: string): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [join(REPO, 'examples/engines/serve.ts'), sheets, '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (match) resolve(match[1] as string);
    });
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
  return { url, child };
}

describe('engine example pages', () => {
  let root: string;
  let suiteDir: string;
  const servers: ChildProcess[] = [];
  const browser = chromium.launch({ args: SWIFTSHADER });

  beforeAll(async () => {
    // One project for the whole suite: the helpers' temp directories are removed after each test.
    suiteDir = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-engines-')));
    root = join(suiteDir, 'characters');
    cpSync(join(REPO, 'examples/characters'), root, {
      recursive: true,
      filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
    });
    const generated = await runJson(['generate', 'characters/knight', 'characters/knight-packed'], { cwd: root });
    expect(generated.exitCode, generated.stderr).toBe(0);
    const exported = await runJson(['export', 'characters/knight', '--format', 'aseprite-json,pixi,phaser-atlas'], {
      cwd: root,
    });
    expect(exported.exitCode, exported.stderr).toBe(0);
    const stages = (exported.envelope.data as { results: { stages: { name: string; status: string }[] }[] }).results[0]
      ?.stages;
    expect(Object.fromEntries(stages?.map((s) => [s.name, s.status]) ?? [])).toMatchObject({
      render: 'cached',
      sheet: 'cached',
      export: 'ran',
    });
  }, 120_000);

  afterAll(async () => {
    for (const s of servers) s.kill();
    await (await browser).close();
    rmSync(suiteDir, { recursive: true, force: true });
  });

  async function play(page: 'phaser' | 'pixi', asset: string, query = '') {
    const { url, child } = await serve(join(root, 'build', asset, 'sheets'));
    servers.push(child);
    const tab = await (await browser).newPage();
    const errors: string[] = [];
    tab.on('pageerror', (e) => errors.push(e.message));
    await tab.goto(`${url}/${page}.html?clip=walk_s${query}`);
    await tab.waitForFunction(
      () => {
        const state = (window as unknown as { td2d: { ready: boolean; frames: string[]; error: string | null } }).td2d;
        return state.error !== null || (state.ready && new Set(state.frames).size >= 3);
      },
      undefined,
      { timeout: 30_000 },
    );
    const state = await tab.evaluate(
      () =>
        (
          window as unknown as {
            td2d: { frames: string[]; error: string | null; pivot?: { custom: boolean; x: number; y: number } };
          }
        ).td2d,
    );
    await tab.close();
    expect(state.error, `${page} ${asset}`).toBeNull();
    expect(errors).toEqual([]);
    return state;
  }

  it('plays walk_s in Phaser from the Aseprite JSON, on a grid sheet and on a trimmed packed sheet', async () => {
    const { frames } = await play('phaser', 'characters/knight');
    expect(new Set(frames).size).toBeGreaterThanOrEqual(3);
    // Index frame names, as load.aseprite and createFromAseprite expect, are the walk_s frames.
    for (const f of frames) expect(Number(f)).toBeGreaterThanOrEqual(80);
    expect(new Set((await play('phaser', 'characters/knight-packed')).frames).size).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('plays walk_s in Phaser from the multi-atlas and its animation configs, with the pivot on every frame', async () => {
    const state = await play('phaser', 'characters/knight-packed', '&format=multiatlas');
    expect(new Set(state.frames).size).toBeGreaterThanOrEqual(3);
    for (const f of state.frames) expect(f).toMatch(/^walk\/s\/\d{3}$/);
    const manifest = JSON.parse(
      readFileSync(join(root, 'build/characters/knight-packed/sheets/manifest.json'), 'utf8'),
    ) as {
      pivot: { normalized: { x: number; y: number } };
    };
    expect(state.pivot).toEqual({ custom: true, x: manifest.pivot.normalized.x, y: manifest.pivot.normalized.y });
  }, 120_000);

  it('writes every export format, each matching its committed JSON Schema', () => {
    const sheets = join(root, 'build/characters/knight-packed/sheets');
    const manifest = JSON.parse(readFileSync(join(sheets, 'manifest.json'), 'utf8')) as {
      files: Record<string, string[]>;
      cells: unknown[];
    };
    expect(Object.keys(manifest.files).sort()).toEqual([
      'aseprite-json',
      'frames',
      'gif-preview',
      'godot-spriteframes',
      'manifest',
      'phaser-atlas',
      'pixi',
      'sheets',
    ]);
    expect(manifest.files.frames).toHaveLength(manifest.cells.length);
    expect(manifest.files['gif-preview']).toEqual([
      'knight-packed-idle.gif',
      'knight-packed-walk.gif',
      'knight-packed-attack.gif',
    ]);
    const ajv = new Ajv2020.default({ strict: false });
    const check = (schema: string, file: string) => {
      const validate = ajv.compile(jsonSchemaFor(schema) as object);
      expect(
        validate(JSON.parse(readFileSync(join(sheets, file), 'utf8'))),
        `${file}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    };
    check('manifest', 'manifest.json');
    for (const f of manifest.files['aseprite-json'] ?? []) check('aseprite-sheet', f);
    for (const f of manifest.files.pixi ?? []) check('pixi-sheet', f);
    for (const f of manifest.files['phaser-atlas'] ?? []) check('phaser-atlas', f);
    expect(
      readFileSync(join(sheets, 'knight-packed.tres'), 'utf8').startsWith('[gd_resource type="SpriteFrames" format=3]'),
    ).toBe(true);
  });

  it('loads the PixiJS spritesheet and plays walk_s, on a grid sheet and on a trimmed packed sheet', async () => {
    expect(new Set((await play('pixi', 'characters/knight')).frames).size).toBeGreaterThanOrEqual(3);
    expect(new Set((await play('pixi', 'characters/knight-packed')).frames).size).toBeGreaterThanOrEqual(3);
  }, 120_000);
  // Runs last: it changes the knight's sheet settings.
  it('lays out sheets again from cached sprites with td2d sheet, and lists cells with inspect --cells', async () => {
    const file = join(root, 'assets/characters/knight/asset.json');
    const asset = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...asset, sheet: { split: 'clip' } }));
    const sheet = await runJson(['sheet', 'characters/knight'], { cwd: root });
    expect(sheet.exitCode, sheet.stderr).toBe(0);
    const stages = (sheet.envelope.data as { results: { stages: { name: string; status: string }[] }[] }).results[0]
      ?.stages;
    expect(Object.fromEntries(stages?.map((s) => [s.name, s.status]) ?? [])).toMatchObject({
      render: 'cached',
      pixel: 'cached',
      sheet: 'ran',
      export: 'ran',
    });
    const cells = await runJson(['inspect', 'characters/knight', '--cells'], { cwd: root });
    const data = cells.envelope.data as {
      sheets: { name: string }[];
      cells: { key: string; sheet: string; offset: { x: number } }[];
    };
    expect(data.sheets.map((s) => s.name)).toEqual(['knight-idle', 'knight-walk', 'knight-attack']);
    expect(data.cells.find((c) => c.key === 'walk/s/000')).toMatchObject({
      sheet: 'knight-walk',
      offset: { x: 0, y: 0 },
    });
    expect(data.cells).toHaveLength(192);
    const bad = await runJson(['export', 'characters/knight', '--format', 'unity'], { cwd: root });
    expect([bad.exitCode, bad.envelope.error?.code]).toEqual([2, 'E_USAGE']);
  }, 120_000);
});
