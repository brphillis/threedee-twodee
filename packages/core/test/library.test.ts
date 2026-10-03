import { describe, expect, it } from 'vitest';
import { BASE_SETTINGS, builtinLibrary, loadLibrary, loadProject } from '../src/index.ts';
import { makeProject, writeJson } from './helpers/tmp.ts';

const strip = ({ $schema: _a, schemaVersion: _b, name: _c, description: _d, ...rest }: Record<string, unknown>) => rest;

describe('built-in library', () => {
  const lib = builtinLibrary();

  it('loads every built-in preset kind and palette', () => {
    expect([...lib.presets.camera.keys()].sort()).toEqual([
      'dimetric',
      'isometric',
      'side',
      'three-quarter',
      'top',
      'top-down-45',
    ]);
    expect([...lib.presets.lighting.keys()].sort()).toEqual(['flat', 'studio-rim', 'studio-toon', 'world-sun']);
    expect([...lib.palettes.keys()].sort()).toEqual(['aap-64', 'db32', 'endesga-32', 'pico-8', 'resurrect-64']);
  });

  it('has palettes with the documented colour counts', () => {
    const counts = Object.fromEntries([...lib.palettes].map(([k, v]) => [k, v.data.colors.length]));
    expect(counts).toEqual({ 'aap-64': 64, db32: 32, 'endesga-32': 32, 'pico-8': 16, 'resurrect-64': 64 });
  });

  it('keeps the default presets identical to the base settings', () => {
    expect(strip(lib.presets.camera.get('dimetric')?.data as never)).toEqual(BASE_SETTINGS.camera);
    expect(strip(lib.presets.lighting.get('studio-toon')?.data as never)).toEqual(BASE_SETTINGS.lighting);
    expect(strip(lib.presets.pixel.get('default')?.data as never)).toEqual(BASE_SETTINGS.pixel);
    expect(strip(lib.presets.sheet.get('grid')?.data as never)).toEqual(BASE_SETTINGS.sheet);
    expect(strip(lib.presets.export.get('default')?.data as never)).toEqual(BASE_SETTINGS.export);
  });

  it('uses pitch asin(1/2) for 2:1 dimetric and atan(1/sqrt 2) for true isometric', () => {
    expect(lib.presets.camera.get('dimetric')?.data.pitch).toBeCloseTo((Math.asin(0.5) * 180) / Math.PI, 3);
    expect(lib.presets.camera.get('isometric')?.data.pitch).toBeCloseTo((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 3);
  });
});

describe('project library', () => {
  it('adds project presets and warns when one replaces a built-in', () => {
    const root = makeProject();
    writeJson(root, 'presets/camera/dimetric.json', {
      schemaVersion: '1.0.0',
      name: 'dimetric',
      projection: 'orthographic',
      pitch: 30,
      yawOffset: 45,
      groundMargin: 1,
    });
    writeJson(root, 'presets/pixel/crisp.json', { schemaVersion: '1.0.0', name: 'crisp', alphaThreshold: 200 });
    const lib = loadLibrary(loadProject(root));
    expect(lib.presets.camera.get('dimetric')?.source).toBe('project');
    expect(lib.presets.pixel.get('crisp')?.file).toBe('presets/pixel/crisp.json');
    expect(lib.warnings.map((w) => w.code)).toEqual(['W_PRESET_SHADOWS_BUILTIN']);
    expect(lib.issues).toEqual([]);
  });

  it('reports invalid preset files and name mismatches without throwing', () => {
    const root = makeProject();
    writeJson(root, 'presets/camera/bad.json', {
      schemaVersion: '1.0.0',
      name: 'bad',
      projection: 'perspective',
      pitch: 30,
      yawOffset: 0,
      groundMargin: 0,
    });
    writeJson(root, 'presets/sheet/other.json', { schemaVersion: '1.0.0', name: 'different' });
    writeJson(root, 'palettes/tiny.json', { schemaVersion: '1.0.0', name: 'tiny', colors: [] });
    const lib = loadLibrary(loadProject(root));
    const byFile = Object.fromEntries(lib.issues.map((i) => [i.file, i.path]));
    expect(byFile).toEqual({
      'presets/camera/bad.json': 'projection',
      'presets/sheet/other.json': 'name',
      'palettes/tiny.json': 'colors',
    });
    expect(lib.presets.camera.has('bad')).toBe(false);
  });
});
