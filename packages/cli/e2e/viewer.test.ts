/// <reference lib="dom" />
import { type ChildProcess, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLI, runJson } from './helpers.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const CLIENT = join(REPO, 'apps', 'viewer', 'dist', 'client');
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** TD2D_DOCS_IMAGES=1 writes the viewer guide's screenshots. */
const DOCS_IMAGES = process.env.TD2D_DOCS_IMAGES === '1' ? join(REPO, 'docs', 'guide', 'images', 'viewer') : null;
const KNIGHT = 'characters/knight';

/** Start `td2d viewer` and wait for the URL it logs. */
async function startViewer(cwd: string, extra: string[] = []): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [CLI, 'viewer', '--port', '0', '--json', ...extra], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let err = '';
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
      const match = /"url":"([^"]+)"/.exec(err);
      if (match) resolve(match[1] as string);
    });
    child.on('exit', (code) => reject(new Error(`viewer exited with ${code}: ${err}`)));
  });
  return { url, child };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

/** A plain static file server: no API routes and no fallback page, like any web host. */
function staticServer(root: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] as string)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server }),
    ),
  );
}

async function shot(page: Page, name: string) {
  if (!DOCS_IMAGES) return;
  mkdirSync(DOCS_IMAGES, { recursive: true });
  await page.screenshot({ path: join(DOCS_IMAGES, `${name}.png`) });
}

const attr = (page: Page, selector: string, name: string) => page.locator(selector).first().getAttribute(name);

describe('web viewer', () => {
  let suiteDir: string;
  let root: string;
  let browser: Browser;
  let viewer: { url: string; child: ChildProcess };
  const errors: string[] = [];

  beforeAll(async () => {
    suiteDir = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-viewer-e2e-')));
    root = join(suiteDir, 'characters');
    cpSync(join(REPO, 'examples/characters'), root, {
      recursive: true,
      filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
    });
    const generated = await runJson(['generate', KNIGHT], { cwd: root });
    expect(generated.exitCode, generated.stderr).toBe(0);
    viewer = await startViewer(root);
    browser = await chromium.launch({ args: SWIFTSHADER });
  }, 180_000);

  afterAll(async () => {
    viewer?.child.kill();
    await browser?.close();
    rmSync(suiteDir, { recursive: true, force: true });
  });

  async function open(path = ''): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${viewer.url}${path}`);
    return page;
  }

  it('lists the asset, opens it, and moves between every tab with the keyboard', async () => {
    const page = await open();
    await page.waitForSelector(`[data-asset="${KNIGHT}"]`);
    await page.waitForSelector('.layout[data-status="live"]');
    await page.waitForSelector(`[data-thumbnail="${KNIGHT}"][data-loaded="true"]`);
    await shot(page, 'library');
    await page.click(`[data-asset="${KNIGHT}"]`);
    await page.waitForSelector('[data-sheet-loaded="true"]');
    expect(page.url()).toContain('#/asset/characters%2Fknight/sheet');
    const tabs = ['sheet', 'animation', 'metadata', 'validation', 'history', 'compare', 'model'];
    for (const [i, tab] of tabs.entries()) {
      await page.keyboard.press(String(i + 1));
      await page.waitForSelector(`[data-tab-body="${tab}"]`);
    }
    await page.keyboard.press('?');
    await page.waitForSelector('[data-help]');
    await shot(page, 'shortcuts');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-help]', { state: 'detached' });
    await page.keyboard.press('Escape');
    await page.waitForSelector(`[data-asset="${KNIGHT}"]`);
    await page.close();
    expect(errors).toEqual([]);
  }, 60_000);

  it('shows the sheet with cell outlines and reads out hovered pixels', async () => {
    const page = await open(`#/asset/${encodeURIComponent(KNIGHT)}/sheet`);
    await page.waitForSelector('[data-sheet-loaded="true"]');
    const canvas = page.locator('.pixel-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    const [panX, panY] = ((await canvas.getAttribute('data-pan')) ?? '0,0').split(',').map(Number) as [number, number];
    const zoom = Number(await canvas.getAttribute('data-zoom'));
    // The pivot of the first cell is inside the sprite: its pixel is opaque.
    const manifest = JSON.parse(readFileSync(join(root, 'build', KNIGHT, 'sheets', 'manifest.json'), 'utf8')) as {
      pivot: { x: number; y: number };
    };
    await page.mouse.move(
      box.x + panX + (manifest.pivot.x + 0.5) * zoom,
      box.y + panY + (manifest.pivot.y - 2 + 0.5) * zoom,
    );
    await page.waitForSelector(`[data-readout][data-x="${manifest.pivot.x}"]`);
    expect(await attr(page, '[data-readout]', 'data-hex')).toMatch(/^#[0-9a-f]{6}$/);
    await page.mouse.click(box.x + panX + 4 * zoom, box.y + panY + 4 * zoom);
    await page.waitForSelector('[data-selected-cell="idle/s/000"]');
    await shot(page, 'sheet');
    await page.close();
  }, 60_000);

  it('plays the walk cycle and steps through frames', async () => {
    const page = await open(`#/asset/${encodeURIComponent(KNIGHT)}/animation`);
    await page.waitForSelector('[data-current-key]');
    await page.selectOption('select[aria-label="Clip"]', 'walk');
    const seen = new Set<string>();
    const started = Date.now();
    while (Date.now() - started < 2500 && seen.size < 8) {
      seen.add((await attr(page, '[data-current-key]', 'data-current-key')) ?? '');
      await page.waitForTimeout(30);
    }
    expect(seen.size).toBe(8);
    await page.keyboard.press(' ');
    await page.waitForSelector('.animation-tab[data-playing="false"]');
    const before = Number(await attr(page, '.animation-tab', 'data-frame'));
    await page.keyboard.press('.');
    await page.waitForSelector(`.animation-tab[data-frame="${(before + 1) % 8}"]`);
    await page.keyboard.press('d');
    await page.waitForSelector('[data-direction-grid]');
    expect(await page.locator('canvas[data-direction]').count()).toBe(8);
    await shot(page, 'animation');
    await page.close();
  }, 60_000);

  it('shows metadata with palette counts and stage timings, and validation', async () => {
    const page = await open(`#/asset/${encodeURIComponent(KNIGHT)}/metadata`);
    await page.waitForSelector('[data-swatch]');
    const counts = await page
      .locator('[data-swatch]')
      .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.count)));
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(Number(await attr(page, '[data-stages]', 'data-stages'))).toBe(9);
    await shot(page, 'metadata');
    await page.goto(`${viewer.url}#/asset/${encodeURIComponent(KNIGHT)}/validation`);
    await page.waitForSelector('[data-checks]', { state: 'attached' });
    const validation = JSON.parse(readFileSync(join(root, 'build', KNIGHT, 'validation.json'), 'utf8')) as {
      checks: { status: string }[];
    };
    const issues = validation.checks.filter((c) => c.status !== 'pass').length;
    expect(Number(await attr(page, '[data-checks]', 'data-checks'))).toBe(issues);
    if (issues === 0) await page.getByText(`All ${validation.checks.length} checks passed.`).waitFor();
    await page.close();
  }, 60_000);

  it('loads model.glb into the 3D view', async () => {
    const page = await open(`#/asset/${encodeURIComponent(KNIGHT)}/model`);
    await page.waitForSelector('.model-tab[data-model-loaded="true"]', { timeout: 30_000 });
    expect(Number(await attr(page, '.model-tab', 'data-meshes'))).toBeGreaterThan(10);
    await page.selectOption('select[aria-label="Model clip"]', 'walk');
    await page.waitForTimeout(300);
    await shot(page, 'model');
    await page.close();
  }, 60_000);

  it('updates the library within a second of a regeneration and compares it with the previous one', async () => {
    const page = await open();
    await page.waitForSelector(`[data-asset="${KNIGHT}"]`);
    const before = await attr(page, `[data-asset="${KNIGHT}"]`, 'data-generated');
    const file = join(root, 'assets', KNIGHT, 'asset.json');
    const asset = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...asset, materials: { tabard: { color: '#b03030' } } }, null, 2));
    const generated = await runJson(['generate', KNIGHT], { cwd: root });
    expect(generated.exitCode, generated.stderr).toBe(0);
    const finished = Date.now();
    await page.waitForFunction(
      ([id, old]) => document.querySelector(`[data-asset="${id}"]`)?.getAttribute('data-generated') !== old,
      [KNIGHT, before] as const,
      { timeout: 5000, polling: 20 },
    );
    const updated = Date.now();
    const elapsed = updated - finished;
    // Outputs land before the CLI exits (it then shuts its browser down), so also measure from
    // the last output file written.
    const lastWrite = Math.max(
      ...['sheets/manifest.json', 'generation.json', 'validation.json'].map(
        (f) => statSync(join(root, 'build', KNIGHT, f)).mtimeMs,
      ),
    );
    console.log(
      `live reload: library updated ${elapsed} ms after td2d generate exited, ${Math.round(updated - lastWrite)} ms after the last output was written`,
    );
    expect(elapsed).toBeLessThan(1000);
    expect(updated - lastWrite).toBeLessThan(1000);
    // Compare defaults to the previous generation against the current build.
    await page.goto(`${viewer.url}#/asset/${encodeURIComponent(KNIGHT)}/compare`);
    await page.waitForSelector('.compare-tab[data-changed-pixels]:not([data-changed-pixels=""])', { timeout: 30_000 });
    const changed = Number(await attr(page, '.compare-tab', 'data-changed-pixels'));
    expect(changed).toBeGreaterThan(0);
    const cli = await runJson(['compare', KNIGHT], { cwd: root });
    const data = cli.envelope.data as { changedPixels: number; changedCells: number };
    expect(changed).toBe(data.changedPixels);
    expect(Number(await attr(page, '.compare-tab', 'data-changed-cells'))).toBe(data.changedCells);
    await shot(page, 'compare');
    for (const mode of ['swipe', 'blink', 'heat-map']) {
      await page.click(`[data-compare-mode="${mode}"]`);
      await page.waitForSelector(`.compare-tab[data-mode="${mode}"]`);
      if (mode === 'heat-map') await shot(page, 'compare-heat-map');
    }
    await page.goto(`${viewer.url}#/asset/${encodeURIComponent(KNIGHT)}/history`);
    await page.waitForSelector('[data-history]');
    expect(Number(await attr(page, '[data-history]', 'data-history'))).toBeGreaterThanOrEqual(3);
    await shot(page, 'history');
    await page.close();
    expect(errors).toEqual([]);
  }, 180_000);

  it('serves the same viewer as a static site written by td2d index', async () => {
    const indexed = await runJson(['index'], { cwd: root });
    expect(indexed.exitCode, indexed.stderr).toBe(0);
    expect(indexed.envelope.data).toMatchObject({ outDir: 'build', assets: 1 });
    expect((indexed.envelope.data as { historyEntries: number }).historyEntries).toBeGreaterThanOrEqual(2);
    const { url, server } = await staticServer(join(root, 'build'));
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForSelector(`[data-asset="${KNIGHT}"]`);
      expect(await attr(page, '.layout', 'data-mode')).toBe('static');
      expect(await attr(page, '.layout', 'data-status')).toBe('static');
      await page.click(`[data-asset="${KNIGHT}"]`);
      await page.waitForSelector('[data-sheet-loaded="true"]');
      await page.goto(`${url}#/asset/${encodeURIComponent(KNIGHT)}/compare`);
      await page.waitForSelector('.compare-tab[data-changed-pixels]:not([data-changed-pixels=""])', {
        timeout: 30_000,
      });
      expect(Number(await attr(page, '.compare-tab', 'data-changed-pixels'))).toBeGreaterThan(0);
      await page.goto(`${url}#/asset/${encodeURIComponent(KNIGHT)}/model`);
      await page.waitForSelector('.model-tab[data-model-loaded="true"]', { timeout: 30_000 });
      await page.close();
    } finally {
      server.close();
    }
    expect(errors).toEqual([]);
  }, 120_000);

  it('keeps the main bundle under 600 KB gzipped, with three.js only in the lazy 3D chunk', () => {
    const manifest = JSON.parse(readFileSync(join(CLIENT, '.vite', 'manifest.json'), 'utf8')) as Record<
      string,
      { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean }
    >;
    const entry = Object.entries(manifest).find(([, c]) => c.isEntry);
    if (!entry) throw new Error('no entry chunk');
    // Everything the page loads before any lazy import: the entry and its static imports.
    const eager = new Set<string>();
    const visit = (key: string) => {
      if (eager.has(key)) return;
      eager.add(key);
      for (const i of manifest[key]?.imports ?? []) visit(i);
    };
    visit(entry[0]);
    const files = [...eager].flatMap((k) => [manifest[k]?.file as string, ...(manifest[k]?.css ?? [])]);
    const gzipped = files.reduce((n, f) => n + gzipSync(readFileSync(join(CLIENT, f))).length, 0);
    expect(gzipped).toBeLessThan(600 * 1024);
    const lazy = Object.entries(manifest).filter(([k]) => !eager.has(k));
    expect(lazy.some(([k]) => k.includes('ModelTab'))).toBe(true);
    // A glTF extension name survives minification: the loader must not be in the eager chunks.
    for (const f of files.filter((f) => f.endsWith('.js')))
      expect(readFileSync(join(CLIENT, f), 'utf8')).not.toContain('KHR_draco_mesh_compression');
    const model = lazy.find(([k]) => k.includes('ModelTab'))?.[1].file as string;
    expect(readFileSync(join(CLIENT, model), 'utf8')).toContain('KHR_draco_mesh_compression');
  });

  it('explains a port that is already in use', async () => {
    const busy = await staticServer(root);
    try {
      const port = new URL(busy.url).port;
      const result = await runJson(['viewer', '--port', port], { cwd: root });
      expect([result.exitCode, result.envelope.error?.code]).toEqual([2, 'E_USAGE']);
      expect(result.envelope.error?.hint).toMatch(/--port 0/);
    } finally {
      busy.server.close();
    }
  });

  it('runs without watching when asked', async () => {
    const quiet = await startViewer(root, ['--no-watch']);
    try {
      const page = await browser.newPage();
      await page.goto(quiet.url);
      await page.waitForSelector('.layout[data-status="off"]');
      await page.close();
    } finally {
      quiet.child.kill();
    }
  }, 60_000);
});
