import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AssetGenerateResult,
  type GenerateOptions,
  generateAssets,
  loadProject,
  PlaywrightBackend,
  parseFrameSelector,
  type RenderBackend,
  type Td2dError,
  Td2dError as Td2dErrorClass,
} from '../../src/index.ts';
import { tempDir } from '../helpers/tmp.ts';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'characters');

/**
 * A copy of the characters example. The scale and ground margin are fixed at the values the
 * example fits, because a fitted scale changes every frame whenever an edit changes the reach.
 */
function knightProject() {
  const dir = join(tempDir(), 'characters');
  cpSync(EXAMPLE, dir, {
    recursive: true,
    filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
  });
  const file = join(dir, 'assets/characters/knight/asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...asset, pixelsPerUnit: 37, camera: { preset: 'dimetric', groundMargin: 8 } }));
  return dir;
}

async function generate(dir: string, extra: Partial<GenerateOptions> = {}): Promise<AssetGenerateResult> {
  const [result] = await generateAssets({
    project: loadProject(dir),
    ids: ['characters/knight'],
    history: false,
    ...extra,
  });
  if (!result) throw new Error('no result');
  return result;
}

const statuses = (r: AssetGenerateResult) => Object.fromEntries(r.stages.map((s) => [s.name, s.status]));
const edit = (dir: string, change: (asset: Record<string, unknown>) => void) => {
  const file = join(dir, 'assets/characters/knight/asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  change(asset);
  writeFileSync(file, JSON.stringify(asset));
};

describe('build directories on a rerun', () => {
  it('leaves unchanged stage directories in place, and repairs files changed by hand', async () => {
    const dir = knightProject();
    const build = join(dir, 'build/characters/knight');
    const record = () =>
      JSON.parse(readFileSync(join(build, 'generation.json'), 'utf8')) as {
        outputs: { path: string; sha256: string; bytes: number }[];
      };
    const sha = (file: string) =>
      `sha256:${createHash('sha256')
        .update(readFileSync(join(build, file)))
        .digest('hex')}`;
    expect((await generate(dir)).status).toBe('ok');
    const first = record();
    const render = 'renders/walk/s/000.png';
    const sprite = 'sprites/walk/s/001.png';
    const inodes = (files: string[]) => files.map((f) => statSync(join(build, f)).ino);
    const before = inodes([render, sprite, 'model/model.glb', 'rig/model.glb']);

    // Unchanged: the same files stay where they are, and the record lists the same outputs.
    const warm = await generate(dir);
    expect(Object.values(statuses(warm)).every((s) => s === 'cached')).toBe(true);
    expect(inodes([render, sprite, 'model/model.glb', 'rig/model.glb'])).toEqual(before);
    expect(record().outputs).toEqual(first.outputs);

    // A render overwritten, a sprite deleted and a stray file added: all three are put right.
    writeFileSync(join(build, render), 'not a png');
    rmSync(join(build, sprite));
    writeFileSync(join(build, 'sprites/stray.png'), 'stray');
    await generate(dir);
    const entry = (path: string) => first.outputs.find((o) => o.path === path)?.sha256;
    expect(sha(render)).toBe(entry(render));
    expect(sha(sprite)).toBe(entry(sprite));
    expect(existsSync(join(build, 'sprites/stray.png'))).toBe(false);
    expect(record().outputs).toEqual(first.outputs);
    // The model was untouched, so it stayed in place throughout.
    expect(inodes(['model/model.glb'])).toEqual([before[2]]);
  }, 120_000);
});

describe('item caches', () => {
  it('rerenders only the samples whose pose a clip edit changed', async () => {
    const dir = knightProject();
    const cold = await generate(dir);
    expect(cold.status).toBe('ok');
    expect(cold.items.render).toEqual({ rendered: 192, reused: 0 });
    // The cut at 0.3 s lies between keys at 0.2 s and 0.5 s: the attack frames at 0.3 s and
    // 0.4 s change in all 8 directions; the frames at 0, 0.1, 0.2 and 0.5 s do not.
    edit(dir, (a) => {
      const attack = (
        a.animation as { clips: { attack: { keys: { pose: Record<string, { rotation: number[] }> }[] } } }
      ).clips.attack;
      (attack.keys[2]?.pose.rightUpperArm as { rotation: number[] }).rotation = [-40, 0, 0];
    });
    const warm = await generate(dir);
    expect(statuses(warm)).toMatchObject({ model: 'cached', rig: 'ran', plan: 'ran', render: 'ran', pixel: 'ran' });
    const affected = 2 * 8;
    expect(warm.items.render).toEqual({ rendered: affected, reused: 192 - affected });
    expect(warm.items.pixel).toEqual({ processed: affected, reused: 192 - affected });
  });

  it('reruns the right stages and items for material, camera and palette changes', async () => {
    const dir = knightProject();
    await generate(dir);
    edit(dir, (a) => {
      a.materials = { tabard: { color: '#b13e53', shading: 'toon' } };
    });
    const material = await generate(dir);
    expect(statuses(material)).toMatchObject({ model: 'cached', rig: 'cached', plan: 'cached', render: 'ran' });
    expect(material.items.render).toEqual({ rendered: 192, reused: 0 });
    edit(dir, (a) => {
      a.pixel = { palette: 'fixed:endesga-32' };
    });
    const palette = await generate(dir);
    expect(statuses(palette)).toMatchObject({ render: 'cached', pixel: 'ran' });
    expect(palette.items.render).toEqual({ rendered: 0, reused: 192 });
    expect(palette.items.pixel).toEqual({ processed: 192, reused: 0 });
    edit(dir, (a) => {
      a.camera = { preset: 'isometric', groundMargin: 8 };
    });
    const camera = await generate(dir);
    expect(statuses(camera)).toMatchObject({ model: 'cached', rig: 'cached', plan: 'ran', render: 'ran' });
    expect(camera.items.render).toEqual({ rendered: 192, reused: 0 });
    // Back to the first camera with another material: the render stage runs again, and each
    // sample's own key now depends only on its new material and pose.
    edit(dir, (a) => {
      a.camera = { preset: 'dimetric', groundMargin: 8 };
      a.materials = {};
    });
    const back = await generate(dir);
    expect(statuses(back)).toMatchObject({ plan: 'cached', render: 'cached' });
  });

  it('renders only filtered frames and restores the rest, and refuses a filter the cache cannot complete', async () => {
    const cold = knightProject();
    const error = (await generate(cold, { filter: { frames: [parseFrameSelector('walk/s/0-1')] } }).catch(
      (e: unknown) => e,
    )) as Td2dError;
    expect(error.code).toBe('E_PARTIAL_PLAN');
    expect(error.hint).toMatch(/without --frames/);
    const dir = knightProject();
    await generate(dir);
    const filtered = await generate(dir, { filter: { frames: [parseFrameSelector('walk/s/0-1')] }, from: 'render' });
    expect(filtered.status).toBe('ok');
    expect(filtered.items.render).toEqual({ rendered: 2, reused: 190 });
  });
});

/** A backend that crashes on its first render, or on every render. */
function crashing(always: boolean) {
  let calls = 0;
  const real = new PlaywrightBackend();
  return (): RenderBackend => ({
    id: real.id,
    start: (signal) => real.start(signal),
    stop: () => real.stop(),
    async render(job, sink, options) {
      calls++;
      if (always || calls === 1) {
        await real.stop();
        throw new Td2dErrorClass('E_BACKEND_CRASHED', 'The headless browser crashed while rendering: simulated.');
      }
      return real.render(job, sink, options);
    },
  });
}

describe('backend crashes', () => {
  it('restarts the browser once and records W_BACKEND_RESTARTED', async () => {
    const dir = knightProject();
    const result = await generate(dir, { createBackend: crashing(false) });
    expect(result.status).toBe('warn');
    expect(result.warnings.map((w) => w.code)).toContain('W_BACKEND_RESTARTED');
    expect(result.items.render).toEqual({ rendered: 192, reused: 0 });
  });

  it('fails with E_BACKEND_CRASHED when the restart crashes too', async () => {
    const error = (await generate(knightProject(), { createBackend: crashing(true) }).catch(
      (e: unknown) => e,
    )) as Td2dError;
    expect(error.code).toBe('E_BACKEND_CRASHED');
  });

  it('reports a real renderer crash as E_BACKEND_CRASHED', async () => {
    const backend = new PlaywrightBackend();
    await backend.start();
    const page = (backend as unknown as { page: { goto(url: string): Promise<unknown> } }).page;
    await page.goto('chrome://crash').catch(() => undefined);
    const error = (await backend
      .render({ model: { glb: new Uint8Array(4) }, scene: {} as never, samples: [] }, () => undefined)
      .catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_BACKEND_CRASHED');
    await backend.stop();
  });
});
