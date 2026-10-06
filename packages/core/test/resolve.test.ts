import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  loadAsset,
  loadLibrary,
  loadProject,
  resolveAsset,
  rgbToOklab,
  type Td2dError,
} from '../src/index.ts';
import { CRATE, makeProject, writeJson } from './helpers/tmp.ts';

function resolve(
  config: Record<string, unknown> = {},
  asset: Record<string, unknown> = CRATE,
  setup?: (root: string) => void,
) {
  const root = makeProject(config, asset);
  setup?.(root);
  const project = loadProject(root);
  return resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
}

function failure(config: Record<string, unknown>, asset: Record<string, unknown>): Td2dError {
  try {
    resolve(config, asset);
  } catch (error) {
    return error as Td2dError;
  }
  throw new Error('expected resolution to fail');
}

describe('resolveAsset defaults', () => {
  it('applies built-in defaults to a minimal prop', () => {
    const { asset, warnings } = resolve();
    expect(asset.frame).toEqual({ width: 32, height: 32 });
    expect(asset.pixelsPerUnit).toBe(16);
    expect(asset.camera).toMatchObject({ preset: 'dimetric', pitch: 30, yawOffset: 45 });
    expect(asset.lighting.preset).toBe('studio-toon');
    expect(asset.directions.map((d) => [d.name, d.yaw])).toEqual([
      ['s', 0],
      ['w', 90],
      ['n', 180],
      ['e', 270],
    ]);
    expect(asset.render).toEqual({ supersample: 4, backend: 'playwright-swiftshader' });
    expect(asset.animation).toEqual({
      fps: 10,
      clips: {
        idle: {
          duration: 0.1,
          loop: true,
          fps: 10,
          frames: 1,
          times: [0],
          motion: false,
          interpolation: 'linear',
          keys: null,
          generator: null,
        },
      },
    });
    expect(asset.materials.wood).toEqual({
      color: '#a0693a',
      colorRef: null,
      shading: 'toon',
      bands: 3,
      emissive: '#000000',
      outline: true,
      opacity: 1,
    });
    expect(asset.sourceFile).toBe('assets/props/crate/asset.json');
    expect(warnings).toEqual([]);
  });

  it('uses type defaults for characters', () => {
    const { asset } = resolve({}, { ...CRATE, type: 'character' });
    expect(asset.frame).toEqual({ width: 32, height: 48 });
    expect(asset.directions).toHaveLength(8);
  });

  it('layers project defaults, type defaults and the asset in that order', () => {
    const { asset } = resolve(
      {
        defaults: { pixelsPerUnit: 24, frame: { width: 48, height: 48 }, camera: 'side' },
        typeDefaults: { prop: { pixelsPerUnit: 20 } },
      },
      { ...CRATE, frame: { width: 16, height: 16 } },
    );
    expect(asset.pixelsPerUnit).toBe(20);
    expect(asset.frame).toEqual({ width: 16, height: 16 });
    expect(asset.camera).toMatchObject({ preset: 'side', pitch: 0 });
  });

  it('merges partial presets on top of earlier overrides', () => {
    const { asset } = resolve({ defaults: { pixel: { alphaThreshold: 100 } } }, { ...CRATE, pixel: 'outlined' });
    expect(asset.pixel.preset).toBe('outlined');
    expect(asset.pixel.alphaThreshold).toBe(100);
    expect(asset.pixel.outline).toEqual({ color: '#1a1c2c', side: 'outside', width: 1 });
  });

  it('applies inline overrides after the named preset', () => {
    const { asset } = resolve(
      {},
      { ...CRATE, camera: { preset: 'isometric', groundMargin: 5 }, lighting: { shadows: { enabled: false } } },
    );
    expect(asset.camera).toMatchObject({ preset: 'isometric', pitch: 35.264, groundMargin: 5 });
    expect(asset.lighting.shadows).toEqual({ enabled: false, mapSize: 1024, bias: -0.0005, normalBias: 0.02 });
  });

  it('keeps the inherited preset name when an inline override has no preset', () => {
    const { asset } = resolve({}, { ...CRATE, camera: { pitch: 10 } });
    expect(asset.camera).toMatchObject({ preset: 'dimetric', pitch: 10, yawOffset: 45 });
  });

  it('replaces light arrays instead of merging them', () => {
    const { asset } = resolve({}, { ...CRATE, lighting: { lights: [{ type: 'ambient', intensity: 1 }] } });
    expect(asset.lighting.lights).toEqual([{ type: 'ambient', intensity: 1 }]);
  });

  it('uses project presets', () => {
    const { asset } = resolve({}, { ...CRATE, camera: 'low' }, (root) =>
      writeJson(root, 'presets/camera/low.json', {
        schemaVersion: '1.0.0',
        name: 'low',
        projection: 'orthographic',
        pitch: 10,
        yawOffset: 0,
        groundMargin: 0,
      }),
    );
    expect(asset.camera).toMatchObject({ preset: 'low', pitch: 10 });
  });

  it('shares project materials and lets asset materials win by name', () => {
    const shared = { defaults: { materials: { wood: { color: '#000000' }, trim: { color: '#ffffff' } } } };
    const { asset } = resolve(shared);
    expect(asset.materials.wood?.color).toBe('#a0693a');
    expect(asset.materials.trim?.color).toBe('#ffffff');
  });

  it('resolves palette colour references', () => {
    const { asset } = resolve(
      {},
      { ...CRATE, materials: { ...CRATE.materials, wood: { color: { palette: 'pico-8', index: 8 } } } },
    );
    expect(asset.materials.wood).toMatchObject({ color: '#ff004d', colorRef: { palette: 'pico-8', index: 8 } });
  });

  it('counts frames for looping and one-shot clips', () => {
    const { asset } = resolve(
      {},
      {
        ...CRATE,
        animation: {
          fps: 10,
          clips: { walk: { duration: 0.6 }, hit: { duration: 0.5, loop: false }, fast: { duration: 0.5, fps: 20 } },
        },
      },
    );
    expect(asset.animation.clips.walk?.frames).toBe(6);
    expect(asset.animation.clips.hit?.frames).toBe(6);
    expect(asset.animation.clips.fast?.frames).toBe(10);
  });

  it('marks mirrored directions', () => {
    const { asset } = resolve({}, { ...CRATE, directions: 'd8', mirror: ['e:w', 'ne:nw', 'se:sw'] });
    expect(asset.directions.filter((d) => d.mirrorOf).map((d) => `${d.name}:${d.mirrorOf}`)).toEqual([
      'ne:nw',
      'e:w',
      'se:sw',
    ]);
  });
});

describe('resolveAsset problems', () => {
  it('reports unknown presets at the referencing path, including project defaults', () => {
    const error = failure({ defaults: { lighting: 'moody' } }, { ...CRATE, camera: { preset: 'dimetrik' } });
    expect(error.code).toBe('E_PRESET_NOT_FOUND');
    expect(error.issues?.map((i) => [i.file, i.path])).toEqual([
      ['assets/props/crate/asset.json', 'camera.preset'],
      ['td2d.project.json', 'defaults.lighting'],
    ]);
  });

  it('resolves a ramp, dark to light, and takes the middle colour as the material colour', () => {
    const { asset } = resolve(
      {},
      {
        ...CRATE,
        materials: {
          ...CRATE.materials,
          wood: { ramp: ['#3A2214', { palette: 'pico-8', index: 9 }, '#E8B070'], outline: false },
        },
      },
    );
    expect(asset.materials.wood).toMatchObject({
      color: '#ffa300',
      colorRef: null,
      shading: 'toon',
      bands: 3,
      ramp: ['#3a2214', '#ffa300', '#e8b070'],
      outline: false,
    });
  });

  it('makes a ramp from hueShift that keeps the colour in full light and turns the shadows towards blue', () => {
    const { asset } = resolve(
      {},
      { ...CRATE, materials: { ...CRATE.materials, wood: { color: '#a0693a', hueShift: 40 } } },
    );
    const ramp = asset.materials.wood?.ramp as string[];
    expect(ramp).toHaveLength(3);
    expect(ramp[2]).toBe('#a0693a');
    const hue = (hex: string) => {
      const [, a, b] = rgbToOklab(...hexToRgb(hex));
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    const lightness = (hex: string) => rgbToOklab(...hexToRgb(hex))[0];
    expect(lightness(ramp[0] as string)).toBeLessThan(lightness(ramp[1] as string));
    expect(lightness(ramp[1] as string)).toBeLessThan(lightness(ramp[2] as string));
    // Orange sits near 60 degrees; towards blue-violet means a smaller hue, by 40 for the shadow and 20 half
    // way, within the rounding of dark 8-bit colours.
    expect(hue(ramp[0] as string)).toBeCloseTo(hue('#a0693a') - 40, -1);
    expect(hue(ramp[1] as string)).toBeCloseTo(hue('#a0693a') - 20, -1);
    const warm = resolve(
      {},
      { ...CRATE, materials: { ...CRATE.materials, wood: { color: '#a0693a', hueShift: -40 } } },
    );
    expect(hue(warm.asset.materials.wood?.ramp?.[0] as string)).toBeGreaterThan(hue('#a0693a'));
    const none = resolve({}, { ...CRATE, materials: { ...CRATE.materials, wood: { color: '#a0693a', hueShift: 0 } } });
    expect(none.asset.materials.wood?.ramp).toBeUndefined();
  });

  it('gives a part with its own colour a new ramp from that colour instead of the material ramp', () => {
    const { asset } = resolve(
      {},
      {
        ...CRATE,
        materials: { ...CRATE.materials, wood: { ramp: ['#000000', '#ffffff'], hueShift: undefined } },
        model: {
          parts: [
            { type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], color: '#ff0000' },
            { type: 'box', id: 'lid', material: 'wood', size: [1, 0.1, 1], position: [0, 1, 0] },
          ],
        },
      },
    );
    expect(asset.materials['wood~body']).toMatchObject({ color: '#ff0000', bands: 3 });
    expect(asset.materials['wood~body']?.ramp).toBeUndefined();
    expect(asset.materials.wood?.ramp).toEqual(['#000000', '#ffffff']);
  });

  it('rejects a ramp with flat shading, a mismatched bands count, a hueShift as well, or no colour at all', () => {
    const issues = (material: Record<string, unknown>) =>
      failure({}, { ...CRATE, materials: { ...CRATE.materials, wood: material } }).issues?.map((i) => [i.path, i.code]);
    expect(issues({ ramp: ['#000000', '#ffffff'], shading: 'flat' })).toEqual([
      ['materials.wood.shading', 'ramp_shading'],
    ]);
    expect(issues({ ramp: ['#000000', '#ffffff'], bands: 3 })).toEqual([['materials.wood.bands', 'ramp_bands']]);
    expect(issues({ ramp: ['#000000', '#ffffff'], hueShift: 10 })).toEqual([
      ['materials.wood.hueShift', 'ramp_hue_shift'],
    ]);
    expect(issues({ color: '#a0693a', hueShift: 10, shading: 'lambert' })).toEqual([
      ['materials.wood.shading', 'ramp_shading'],
    ]);
    expect(issues({ shading: 'toon' })).toEqual([['materials.wood.color', 'invalid_type']]);
    expect(issues({ ramp: ['#000000', { palette: 'pico-8', index: 99 }] })).toEqual([
      ['materials.wood.ramp[1].index', 'palette_index'],
    ]);
  });

  it('reports unknown materials and lists the defined ones', () => {
    const asset = { ...CRATE, model: { parts: [{ type: 'box', id: 'x', material: 'stone', size: [1, 1, 1] }] } };
    const error = failure({}, asset);
    expect(error.code).toBe('E_ASSET_INVALID');
    expect(error.issues?.[0]).toMatchObject({ path: 'model.parts[0].material', code: 'unknown_material' });
    expect(error.issues?.[0]?.message).toMatch(/Defined: wood, iron/);
  });

  it('reports duplicate part ids, bad palette indices and bad mirrors together', () => {
    const asset = {
      ...CRATE,
      directions: ['s', 'n'],
      mirror: ['e:w'],
      materials: { wood: { color: { palette: 'pico-8', index: 99 } }, iron: { color: '#5b6770' } },
      model: { parts: [CRATE.model.parts[0], { ...CRATE.model.parts[1], id: 'body' }] },
    };
    const codes = failure({}, asset)
      .issues?.map((i) => i.code)
      .sort();
    expect(codes).toEqual(['duplicate_part_id', 'palette_index', 'unknown_direction', 'unknown_direction']);
  });

  it('reports missing fixed palettes and required clips', () => {
    const error = failure({}, { ...CRATE, pixel: { palette: 'fixed:nope' }, acceptance: { requiredClips: ['walk'] } });
    expect(error.issues?.map((i) => i.path).sort()).toEqual(['acceptance.requiredClips[0]', 'pixel.palette']);
  });
});

describe('resolveAsset warnings', () => {
  it('warns about unused materials and thresholded opacity', () => {
    const asset = {
      ...CRATE,
      materials: { ...CRATE.materials, wood: { color: '#a0693a', opacity: 0.5 }, spare: { color: '#000000' } },
    };
    const { warnings } = resolve({}, asset);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['W_UNUSED_MATERIAL', 'materials.spare'],
      ['W_OPACITY_THRESHOLDED', 'materials.wood.opacity'],
    ]);
  });
});
