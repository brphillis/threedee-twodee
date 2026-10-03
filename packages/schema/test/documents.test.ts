import { describe, expect, it } from 'vitest';
import {
  AssetDefinition,
  CameraPreset,
  DirectionSpec,
  issuesFromZod,
  LightingPreset,
  PaletteDefinition,
  PaletteMode,
  PixelPreset,
  ProjectConfig,
} from '../src/index.ts';

const crate = {
  schemaVersion: '1.0.0',
  id: 'props/crate',
  type: 'prop',
  frame: { width: 32, height: 32 },
  camera: 'dimetric',
  directions: ['s', 'w', 'n', 'e'],
  materials: { wood: { color: '#a0693a', shading: 'toon', bands: 3 } },
  model: { parts: [{ type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] }] },
  animation: { fps: 10, clips: { idle: { duration: 0.1 } } },
};

function issuesOf(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return issuesFromZod(result.error as never);
}

describe('AssetDefinition', () => {
  it('accepts the crate example', () => {
    expect(AssetDefinition.safeParse(crate).success).toBe(true);
  });

  it('accepts every documented example', () => {
    const examples = AssetDefinition.meta()?.examples as unknown[];
    for (const ex of examples) expect(AssetDefinition.safeParse(ex).success).toBe(true);
  });

  it('reports the path of a wrongly typed field', () => {
    const issues = issuesOf(AssetDefinition, { ...crate, frame: { width: '32', height: 32 } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('frame.width');
    expect(issues[0]?.code).toBe('invalid_type');
  });

  it('reports unknown properties with their full path', () => {
    const issues = issuesOf(AssetDefinition, { ...crate, frame: { width: 32, height: 32, depth: 3 }, colour: 'red' });
    const paths = issues.map((i) => i.path).sort();
    expect(paths).toEqual(['colour', 'frame.depth']);
    expect(issues.every((i) => i.code === 'unknown_property')).toBe(true);
  });

  it('reports errors inside a part using the part index', () => {
    const bad = structuredClone(crate) as Record<string, unknown> & { model: { parts: Record<string, unknown>[] } };
    bad.model.parts.push({ type: 'box', id: 'lid', material: 'wood', size: [1, 1] });
    const issues = issuesOf(AssetDefinition, bad);
    expect(issues[0]?.path).toBe('model.parts[1].size');
  });

  it('reports an unknown part type at the type field', () => {
    const bad = structuredClone(crate) as { model: { parts: Record<string, unknown>[] } };
    bad.model.parts[0] = { type: 'cube', id: 'x', material: 'wood' };
    const issues = issuesOf(AssetDefinition, bad);
    expect(issues[0]?.path).toBe('model.parts[0].type');
  });

  it('narrows preset-or-object unions to the object branch', () => {
    const issues = issuesOf(AssetDefinition, { ...crate, camera: { preset: 'dimetric', pitchh: 30 } });
    expect(issues).toEqual([{ path: 'camera.pitchh', message: 'Unknown property "pitchh"', code: 'unknown_property' }]);
  });

  it('requires model parts and a schema version', () => {
    const { schemaVersion: _v, model: _m, ...rest } = crate;
    const paths = issuesOf(AssetDefinition, rest)
      .map((i) => i.path)
      .sort();
    expect(paths).toEqual(['model', 'schemaVersion']);
  });
});

describe('other documents', () => {
  it('accepts a minimal project config', () => {
    expect(ProjectConfig.safeParse({ schemaVersion: '1.0.0', name: 'demo' }).success).toBe(true);
  });

  it('rejects project paths that escape the project', () => {
    const issues = issuesOf(ProjectConfig, { schemaVersion: '1.0.0', name: 'demo', paths: { build: '../out' } });
    expect(issues[0]?.path).toBe('paths.build');
    const abs = issuesOf(ProjectConfig, { schemaVersion: '1.0.0', name: 'demo', paths: { assets: '/etc' } });
    expect(abs[0]?.path).toBe('paths.assets');
  });

  it('validates palette modes', () => {
    for (const ok of ['none', 'fixed:endesga-32', 'auto:2', 'auto:16', 'auto:256']) {
      expect(PaletteMode.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['auto:1', 'auto:257', 'fixed:', 'fixed:Bad', 'palette']) {
      expect(PaletteMode.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('validates direction specs', () => {
    expect(DirectionSpec.safeParse('d8').success).toBe(true);
    expect(DirectionSpec.safeParse(['s', 'n']).success).toBe(true);
    expect(DirectionSpec.safeParse([{ name: 'front', yaw: 0 }]).success).toBe(true);
    expect(DirectionSpec.safeParse('d5').success).toBe(false);
    expect(DirectionSpec.safeParse(['south']).success).toBe(false);
  });

  it('accepts preset examples', () => {
    const cam = CameraPreset.meta()?.examples as unknown[];
    expect(CameraPreset.safeParse(cam[0]).success).toBe(true);
    expect(
      LightingPreset.safeParse({
        schemaVersion: '1.0.0',
        name: 'flat',
        space: 'camera',
        lights: [{ type: 'ambient', intensity: 1 }],
        shadows: { enabled: false, mapSize: 1024, bias: 0, normalBias: 0 },
      }).success,
    ).toBe(true);
    expect(PixelPreset.safeParse({ schemaVersion: '1.0.0', name: 'crisp', alphaThreshold: 160 }).success).toBe(true);
    expect(
      PaletteDefinition.safeParse({ schemaVersion: '1.0.0', name: 'bw', colors: ['#000000', '#ffffff'] }).success,
    ).toBe(true);
  });
});
