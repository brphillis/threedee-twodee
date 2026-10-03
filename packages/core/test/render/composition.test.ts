import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AssetGenerateResult,
  flipHorizontal,
  generateAssets,
  initProject,
  loadProject,
  opaqueBounds,
  opaqueColours,
  type RgbaImage,
  readPng,
} from '../../src/index.ts';
import { tempDir } from '../helpers/tmp.ts';

async function generateAsset(
  asset: Record<string, unknown>,
): Promise<{ dir: string; result: AssetGenerateResult; sprite: (key: string) => Promise<RgbaImage> }> {
  const dir = join(tempDir(), 'p');
  initProject({ dir });
  writeFileSync(
    join(dir, 'assets/props/crate/asset.json'),
    JSON.stringify({ schemaVersion: '1.0.0', type: 'prop', ...asset }),
  );
  const [result] = await generateAssets({ project: loadProject(dir), history: false });
  if (!result) throw new Error('no result');
  return { dir, result, sprite: (key) => readPng(join(dir, 'build/props/crate/sprites', `${key}.png`)) };
}

const D8 = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
const sphere = {
  materials: { m: { color: '#a0693a', bands: 3 } },
  model: {
    parts: [
      {
        type: 'sphere',
        id: 'ball',
        material: 'm',
        radius: 0.5,
        position: [0, 0.5, 0],
        widthSegments: 32,
        heightSegments: 24,
      },
    ],
  },
};

function histogram(img: RgbaImage): Map<string, number> {
  const h = new Map<string, number>();
  for (let i = 0; i < img.rgba.length; i += 4) {
    if (img.rgba[i + 3] === 0) continue;
    const key = `${img.rgba[i]},${img.rgba[i + 1]},${img.rgba[i + 2]}`;
    h.set(key, (h.get(key) ?? 0) + 1);
  }
  return h;
}

describe('direction invariance', () => {
  it('keeps a sphere’s bounding box within 1 px across all eight directions', async () => {
    const { sprite } = await generateAsset({ ...sphere, directions: 'd8' });
    const boxes = await Promise.all(D8.map(async (d) => opaqueBounds(await sprite(`idle/${d}/000`))));
    const first = boxes[0];
    for (const b of boxes) {
      expect(Math.abs((b?.x ?? 0) - (first?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((b?.y ?? 0) - (first?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((b?.w ?? 0) - (first?.w ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((b?.h ?? 0) - (first?.h ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('shades a sphere the same in every direction with camera-locked lights (histograms within 2%)', async () => {
    const { sprite } = await generateAsset({ ...sphere, directions: 'd8', pixel: { bleed: false } });
    const all = await Promise.all(D8.map(async (d) => histogram(await sprite(`idle/${d}/000`))));
    const total = (h: Map<string, number>) => [...h.values()].reduce((a, b) => a + b, 0);
    const base = all[0] as Map<string, number>;
    for (const h of all) {
      let diff = 0;
      for (const key of new Set([...base.keys(), ...h.keys()]))
        diff += Math.abs((base.get(key) ?? 0) - (h.get(key) ?? 0));
      expect(diff / 2 / total(base)).toBeLessThanOrEqual(0.02);
    }
  });

  it('changes the lit side with direction when lights are fixed in the world', async () => {
    const { sprite } = await generateAsset({ ...sphere, directions: 'd4', lighting: 'world-sun' });
    const s = histogram(await sprite('idle/s/000'));
    const n = histogram(await sprite('idle/n/000'));
    expect([...s.keys()].sort()).not.toEqual([...n.keys()].sort());
  });
});

describe('lighting', () => {
  it('shows three distinct bands on the dimetric crate: top, left and right faces', async () => {
    const { sprite } = await generateAsset({
      directions: 'd1',
      materials: { wood: { color: '#a0693a' } },
      model: { parts: [{ type: 'box', id: 'b', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] }] },
    });
    const img = await sprite('idle/s/000');
    const at = (x: number, y: number) =>
      Array.from(img.rgba.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)).join(',');
    const b = opaqueBounds(img);
    if (!b) throw new Error('blank');
    const cx = b.x + Math.floor(b.w / 2);
    const top = at(cx, b.y + 3);
    const left = at(b.x + 3, b.y + Math.floor(b.h * 0.65));
    const right = at(b.x + b.w - 4, b.y + Math.floor(b.h * 0.65));
    expect(new Set([top, left, right]).size).toBe(3);
    const lum = (s: string) =>
      s
        .split(',')
        .map(Number)
        .reduce((a, v) => a + v, 0);
    expect(lum(top)).toBeGreaterThan(lum(left));
    expect(lum(left)).toBeGreaterThan(lum(right));
  });

  it('draws the ground shadow of an elevated box only when asked', async () => {
    const box = {
      directions: 'd1',
      frame: { width: 48, height: 48 },
      materials: { m: { color: '#3e8948' } },
      model: { parts: [{ type: 'box', id: 'b', material: 'm', size: [0.6, 0.6, 0.6], position: [0, 0.9, 0] }] },
    };
    const shadowColour = '#1a1c2c';
    const without = await generateAsset(box);
    expect(opaqueColours(await without.sprite('idle/s/000'))).not.toContain(shadowColour);
    const withShadow = await generateAsset({
      ...box,
      lighting: { preset: 'studio-toon', groundShadow: { enabled: true, color: shadowColour } },
    });
    const img = await withShadow.sprite('idle/s/000');
    expect(opaqueColours(img)).toContain(shadowColour);
    let shadowRows = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (img.rgba[i + 3] && img.rgba[i] === 0x1a && img.rgba[i + 1] === 0x1c && img.rgba[i + 2] === 0x2c) {
          shadowRows = Math.max(shadowRows, y);
          break;
        }
      }
    }
    // The box floats 0.6 m up, so its shadow lies on the ground well below its lowest visible pixel.
    expect(shadowRows).toBeGreaterThan((opaqueBounds(await without.sprite('idle/s/000'))?.y ?? 0) + 10);
  });
});

describe('composition', () => {
  it('fits pixelsPerUnit automatically, records it, and keeps the model inside the frame', async () => {
    const { dir, result, sprite } = await generateAsset({ ...sphere, pixelsPerUnit: 'auto', directions: 'd4' });
    expect(result.warnings.map((w) => w.code)).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(dir, 'build/props/crate/sheets/manifest.json'), 'utf8'));
    expect(manifest.pixelsPerUnit).toBeGreaterThan(16);
    expect(Number.isInteger(manifest.pixelsPerUnit)).toBe(true);
    const b = opaqueBounds(await sprite('idle/s/000'));
    expect(b?.x).toBeGreaterThanOrEqual(1);
    expect(b?.y).toBeGreaterThanOrEqual(1);
  });

  it('warns with W_COMPOSITION_GROUND when a model floats above the ground', async () => {
    const { result } = await generateAsset({
      ...sphere,
      model: { parts: [{ ...sphere.model.parts[0], position: [0, 0.9, 0] }] },
    });
    expect(result.warnings.map((w) => w.code)).toContain('W_COMPOSITION_GROUND');
  });

  it('makes mirrored directions exact flips without rendering them', async () => {
    const asymmetric = {
      directions: 'd8',
      mirror: ['e:w', 'ne:nw', 'se:sw'],
      materials: { m: { color: '#a0693a' }, nose: { color: '#be4a2f' } },
      model: {
        parts: [
          { type: 'box', id: 'b', material: 'm', size: [0.6, 0.6, 0.6], position: [0, 0.3, 0] },
          { type: 'box', id: 'n', material: 'nose', size: [0.15, 0.15, 0.3], position: [0.15, 0.3, 0.4] },
        ],
      },
    };
    const { dir, sprite } = await generateAsset(asymmetric);
    const plan = JSON.parse(readFileSync(join(dir, 'build/props/crate/plan.json'), 'utf8'));
    expect(plan.samples.map((s: { key: string }) => s.key.split('/')[1])).toEqual(['s', 'sw', 'w', 'nw', 'n']);
    for (const [target, source] of [
      ['e', 'w'],
      ['ne', 'nw'],
      ['se', 'sw'],
    ]) {
      expect((await sprite(`idle/${target}/000`)).rgba).toEqual(
        flipHorizontal(await sprite(`idle/${source}/000`)).rgba,
      );
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'build/props/crate/sheets/manifest.json'), 'utf8'));
    expect(
      manifest.cells.filter((c: { mirrored: boolean }) => c.mirrored).map((c: { direction: string }) => c.direction),
    ).toEqual(['ne', 'e', 'se']);
  });
});
