/**
 * Phase 6 experiments Q4 and Q5, and Q7 repeated with real clips. Run with `pnpm experiments`.
 * Images and metrics go to docs/roadmaps/assets/phase-6/; the conclusions recorded in
 * docs/roadmaps/phase-6.md are asserted at the end of each experiment.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateAssets,
  loadProject,
  oklabDistanceSq,
  opaqueColours,
  type RgbaImage,
  readPng,
  rgbToOklab,
} from '../../src/index.ts';
import { tempDir, writeJson } from '../helpers/tmp.ts';

const REPO = join(import.meta.dirname, '../../../..');
const OUT = join(REPO, 'docs/roadmaps/assets/phase-6');
const METRICS = join(OUT, 'metrics.json');
const metrics: Record<string, unknown> = {};
const pad = (n: number) => String(n).padStart(3, '0');
const round = (n: number, d = 3) => Number(n.toFixed(d));

const knight = () =>
  JSON.parse(readFileSync(join(REPO, 'examples/characters/assets/characters/knight/asset.json'), 'utf8')) as Record<
    string,
    unknown
  > & { animation: { clips: Record<string, unknown> } };

/** A copy of the characters example with these knight variants, generated. */
async function generateVariants(variants: Record<string, Record<string, unknown>>) {
  const dir = join(tempDir(), 'characters');
  cpSync(join(REPO, 'examples/characters'), dir, {
    recursive: true,
    filter: (src) => !/[/\\](build|history|expected|assets|\.td2d[/\\]cache)$/.test(src),
  });
  for (const [id, asset] of Object.entries(variants))
    writeJson(dir, `assets/${id}/asset.json`, { ...asset, id, acceptance: { maxJitter: 2 } });
  const project = loadProject(dir);
  const results = await generateAssets({ project, history: false });
  for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  return {
    sprite: (id: string, key: string) =>
      readPng(join(project.paths.build, id, 'sprites', `${key}.png`)) as Promise<RgbaImage>,
  };
}

async function writeRows(file: string, rows: readonly (readonly RgbaImage[])[], scale = 4) {
  const w = Math.max(...rows.flatMap((r) => r.map((i) => i.width)));
  const h = Math.max(...rows.flatMap((r) => r.map((i) => i.height)));
  const cols = Math.max(...rows.map((r) => r.length));
  const gap = 2;
  const width = cols * (w + gap) + gap;
  const height = rows.length * (h + gap) + gap;
  const canvas = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) canvas.set([0x56, 0x6c, 0x86, 255], p * 4);
  for (const [r, row] of rows.entries()) {
    for (const [c, img] of row.entries()) {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.rgba[i + 3] !== 0)
            canvas.set(img.rgba.subarray(i, i + 4), ((gap + r * (h + gap) + y) * width + gap + c * (w + gap) + x) * 4);
        }
      }
    }
  }
  await sharp(Buffer.from(canvas), { raw: { width, height, channels: 4 } })
    .resize(width * scale, height * scale, { kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, file));
}

/** Pixels that differ in alpha or colour between two sprites. */
function changed(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const aOn = a.rgba[i + 3] !== 0;
    const bOn = b.rgba[i + 3] !== 0;
    if (
      aOn !== bOn ||
      (aOn && (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2]))
    )
      n++;
  }
  return n;
}

describe('phase 6 experiments', () => {
  beforeAll(() => mkdirSync(OUT, { recursive: true }));
  afterAll(() => {
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(readFileSync(METRICS, 'utf8')) as Record<string, unknown>;
    } catch {
      previous = {};
    }
    writeFileSync(METRICS, `${JSON.stringify({ ...previous, ...metrics }, null, 2)}\n`);
  });

  it('Q4: step against linear interpolation of a key-pose walk at 10 fps', async () => {
    const base = knight();
    // Four key poses (contact, passing, contact, passing) taken from the walk-cycle generator.
    const { generateKeys, resolveRig, loadLibrary } = await import('../../src/index.ts');
    const rig = resolveRig([{ file: undefined, path: 'rig', value: 'humanoid-basic' }], loadLibrary(), []);
    const generator = (base.animation.clips.walk as { generator: Record<string, unknown> }).generator;
    const keys = generateKeys(generator as never, rig, 0.8, [0, 0.2, 0.4, 0.6]);
    const variant = (interpolation: 'step' | 'linear') => ({
      ...base,
      directions: ['s', 'w'],
      animation: { fps: 10, clips: { walk: { duration: 0.8, interpolation, keys } } },
    });
    const run = await generateVariants({
      'characters/generated': {
        ...base,
        directions: ['s', 'w'],
        animation: { fps: 10, clips: { walk: base.animation.clips.walk } },
      },
      'characters/step': variant('step'),
      'characters/linear': variant('linear'),
    });
    const result: Record<string, unknown> = {};
    const rows: RgbaImage[][] = [];
    for (const name of ['step', 'linear', 'generated']) {
      const perDirection = [];
      for (const dir of ['s', 'w']) {
        const frames = await Promise.all(
          Array.from({ length: 8 }, (_, k) => run.sprite(`characters/${name}`, `walk/${dir}/${pad(k)}`)),
        );
        const reference = await Promise.all(
          Array.from({ length: 8 }, (_, k) => run.sprite('characters/generated', `walk/${dir}/${pad(k)}`)),
        );
        const steps = frames.map((f, k) => changed(f, frames[(k + 1) % 8] as RgbaImage));
        const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
        perDirection.push({
          dir,
          meanChange: round(mean, 1),
          maxChange: Math.max(...steps),
          stillFrames: steps.filter((s) => s === 0).length,
          changeSpread: round(Math.sqrt(steps.reduce((a, s) => a + (s - mean) ** 2, 0) / steps.length) / mean),
          offReference: round(frames.reduce((a, f, k) => a + changed(f, reference[k] as RgbaImage), 0) / 8, 1),
        });
        if (dir === 'w') rows.push(frames);
      }
      result[name] = { perDirection };
    }
    await writeRows('q4-interpolation.png', rows, 3);
    metrics.q4 = {
      fixture:
        'the knight, a walk keyed with four poses from the walk-cycle generator (contact, passing, contact, passing), 8 frames at 10 fps, views s and w; "generated" is the generator itself, exact at every frame',
      metric:
        'pixels changed from each frame to the next (mean, max, spread = std/mean, frames identical to the next), and mean pixels differing from the generated walk',
      rows: 'q4-interpolation.png rows (view w): step, linear, generated',
      ...result,
    };
    const w = (name: string) =>
      (
        result[name] as {
          perDirection: { meanChange: number; stillFrames: number; changeSpread: number; offReference: number }[];
        }
      ).perDirection[1] as {
        meanChange: number;
        stillFrames: number;
        changeSpread: number;
        offReference: number;
      };
    // Step holds each key for two frames, so half the frames do not move and the rest jump.
    expect(w('step').stillFrames).toBe(4);
    expect(w('linear').stillFrames).toBe(0);
    expect(w('linear').changeSpread).toBeLessThan(w('step').changeSpread);
    expect(w('linear').offReference).toBeLessThan(w('step').offReference);
  });

  it('Q5: rigid parts against skinning on an elbow bend at 32 px', async () => {
    const arm = (skin: 'rigid' | 'nearest-bone' | 'two-bone-blend') => ({
      schemaVersion: '1.0.0',
      type: 'prop',
      frame: { width: 32, height: 32 },
      pixelsPerUnit: 26,
      directions: ['s'],
      camera: { preset: 'side', groundMargin: 2 },
      rig: {
        bones: [
          { name: 'shoulder', parent: null, position: [0, 1, 0] },
          { name: 'elbow', parent: 'shoulder', position: [0, -0.5, 0] },
        ],
      },
      materials: { skin: { color: '#e8b796', shading: 'toon' }, sleeve: { color: '#3b5dc9', shading: 'toon' } },
      model: {
        parts:
          skin === 'rigid'
            ? [
                {
                  type: 'capsule',
                  id: 'upper',
                  bone: 'shoulder',
                  material: 'sleeve',
                  radius: 0.08,
                  length: 0.36,
                  position: [0, 0.76, 0],
                  heightSegments: 12,
                },
                {
                  type: 'capsule',
                  id: 'lower',
                  bone: 'elbow',
                  material: 'skin',
                  radius: 0.08,
                  length: 0.36,
                  position: [0, 0.26, 0],
                  heightSegments: 12,
                },
              ]
            : [
                {
                  type: 'capsule',
                  id: 'upper',
                  skin,
                  skinBones: ['shoulder', 'elbow'],
                  material: 'sleeve',
                  radius: 0.08,
                  length: 0.36,
                  position: [0, 0.76, 0],
                  heightSegments: 12,
                },
                {
                  type: 'capsule',
                  id: 'lower',
                  skin,
                  skinBones: ['shoulder', 'elbow'],
                  material: 'skin',
                  radius: 0.08,
                  length: 0.36,
                  position: [0, 0.26, 0],
                  heightSegments: 12,
                },
              ],
      },
      animation: {
        clips: {
          bend: {
            duration: 1,
            loop: false,
            sampleTimes: [0, 0.25, 0.5, 0.75, 1],
            keys: [
              { t: 0, pose: {} },
              { t: 1, pose: { elbow: { rotation: [0, 0, 120] } } },
            ],
          },
        },
      },
    });
    const dir = join(tempDir(), 'arms');
    writeJson(dir, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'arms' });
    for (const mode of ['rigid', 'nearest-bone', 'two-bone-blend'] as const)
      writeJson(dir, `assets/arms/${mode}/asset.json`, arm(mode));
    const project = loadProject(dir);
    const results = await generateAssets({ project, history: false });
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    const sprite = (mode: string, k: number) =>
      readPng(join(project.paths.build, 'arms', mode, 'sprites', 'bend', 's', `${pad(k)}.png`)) as Promise<RgbaImage>;
    const rows: RgbaImage[][] = [];
    const result: Record<string, unknown> = {};
    for (const mode of ['rigid', 'nearest-bone', 'two-bone-blend']) {
      const frames = await Promise.all([0, 1, 2, 3, 4].map((k) => sprite(mode, k)));
      rows.push(frames);
      const rigid = await Promise.all([0, 1, 2, 3, 4].map((k) => sprite('rigid', k)));
      const area = (img: RgbaImage) => img.rgba.filter((_, i) => i % 4 === 3 && img.rgba[i] !== 0).length;
      result[mode] = {
        pixelsDifferentFromRigid: frames.map((f, k) => changed(f, rigid[k] as RgbaImage)),
        area: frames.map(area),
        coloursPerSprite: frames.map((f) => opaqueColours(f).length),
      };
    }
    await writeRows('q5-skinning.png', rows, 4);
    metrics.q5 = {
      fixture:
        'an arm of two capsules 0.52 m long (sleeve and skin), the same geometry in every mode, on a two-bone rig, bent 0, 30, 60, 90 and 120 degrees at the elbow, 32 x 32 side view at 26 px/m',
      metric: 'pixels differing from the rigid arm at each angle, opaque area, colours per sprite',
      rows: 'q5-skinning.png rows: rigid, nearest-bone, two-bone-blend',
      ...result,
    };
    const diff = (mode: string) => (result[mode] as { pixelsDifferentFromRigid: number[] }).pixelsDifferentFromRigid;
    // At rest all three are nearly the same; the differences are at the elbow and grow with the angle.
    // At 32 px skinning changes only a handful of pixels around the elbow, of about 100 opaque ones.
    expect(diff('rigid')).toEqual([0, 0, 0, 0, 0]);
    expect(Math.max(...diff('nearest-bone'))).toBeLessThanOrEqual(5);
    expect(Math.max(...diff('two-bone-blend'))).toBeLessThanOrEqual(20);
    expect(diff('two-bone-blend')[0]).toBe(0);
  });

  it('Q7 again: per-asset against per-clip palettes on the knight clips', async () => {
    const base = knight();
    const variant = (scope: 'asset' | 'clip') => ({
      ...base,
      directions: ['s'],
      pixel: { downscale: 'box', palette: 'auto:8', paletteScope: scope },
    });
    const run = await generateVariants({
      'characters/reference': { ...base, directions: ['s'], pixel: { downscale: 'box' } },
      'characters/asset': variant('asset'),
      'characters/clip': variant('clip'),
    });
    const keys = ['idle/s/000', 'idle/s/005', 'walk/s/000', 'walk/s/002', 'attack/s/000', 'attack/s/003'];
    const result: Record<string, unknown> = {};
    const rows: RgbaImage[][] = [];
    for (const scope of ['asset', 'clip']) {
      const sprites = await Promise.all(keys.map((k) => run.sprite(`characters/${scope}`, k)));
      const reference = await Promise.all(keys.map((k) => run.sprite('characters/reference', k)));
      let error = 0;
      let n = 0;
      for (const [k, img] of sprites.entries()) {
        const ref = reference[k] as RgbaImage;
        for (let i = 0; i < img.rgba.length; i += 4) {
          if (img.rgba[i + 3] === 0) continue;
          error += Math.sqrt(
            oklabDistanceSq(
              rgbToOklab(img.rgba[i] as number, img.rgba[i + 1] as number, img.rgba[i + 2] as number),
              rgbToOklab(ref.rgba[i] as number, ref.rgba[i + 1] as number, ref.rgba[i + 2] as number),
            ),
          );
          n++;
        }
      }
      // idle and attack both start at the rest pose, so their first frames should match.
      result[scope] = {
        meanError: round(error / n, 4),
        restPoseChangedPixels: changed(sprites[0] as RgbaImage, sprites[4] as RgbaImage),
      };
      rows.push(sprites);
    }
    await writeRows('q7-knight-palettes.png', rows, 3);
    metrics.q7knight = {
      fixture: 'the knight, idle, walk and attack, south view, box downscale, auto:8',
      metric:
        'mean Oklab error against the unquantised sprites of six frames; pixels that differ between the rest-pose first frames of idle and attack',
      rows: 'q7-knight-palettes.png rows: asset, clip (idle 0, idle 5, walk 0, walk 2, attack 0, attack 3)',
      ...result,
    };
    const r = (s: string) => result[s] as { meanError: number; restPoseChangedPixels: number };
    expect(r('asset').restPoseChangedPixels).toBe(0);
    expect(r('clip').restPoseChangedPixels).toBeGreaterThan(0);
    // Real clips share most colours, so separate palettes buy almost no accuracy.
    expect(Math.abs(r('clip').meanError - r('asset').meanError)).toBeLessThan(0.005);
  });
});
