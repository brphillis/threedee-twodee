import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findProjectRoot,
  listAssetLocations,
  loadAsset,
  loadProject,
  openProject,
  type Td2dError,
} from '../src/index.ts';
import { CRATE, makeProject, tempDir, writeJson } from './helpers/tmp.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Td2dError).code;
  }
  return 'none';
}

describe('project loading', () => {
  it('finds the project root from a nested directory', () => {
    const root = makeProject();
    const nested = join(root, 'assets', 'props');
    expect(findProjectRoot(nested)).toBe(root);
    expect(openProject({ cwd: nested }).root).toBe(root);
  });

  it('reports a missing project', () => {
    const dir = tempDir();
    expect(findProjectRoot(dir)).toBeUndefined();
    expect(codeOf(() => openProject({ cwd: dir }))).toBe('E_PROJECT_NOT_FOUND');
    expect(codeOf(() => openProject({ cwd: dir, explicitRoot: '.' }))).toBe('E_PROJECT_NOT_FOUND');
  });

  it('validates the project file', () => {
    const root = tempDir();
    writeJson(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'x', defaults: { camera: 7 } });
    try {
      loadProject(root);
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_PROJECT_INVALID');
      expect((error as Td2dError).issues?.[0]?.path).toBe('defaults.camera');
    }
  });

  it('resolves default and custom paths', () => {
    const root = makeProject({ paths: { assets: 'defs', presets: ['p1', 'p2'] } });
    const project = loadProject(root);
    expect(project.paths.assets).toBe(join(root, 'defs'));
    expect(project.paths.build).toBe(join(root, 'build'));
    expect(project.paths.cache).toBe(join(root, '.td2d', 'cache'));
    expect(project.paths.presets).toEqual([join(root, 'p1'), join(root, 'p2')]);
  });

  it('lists assets sorted by id and skips hidden directories', () => {
    const root = makeProject();
    writeJson(root, 'assets/a/asset.json', CRATE);
    writeJson(root, 'assets/.hidden/x/asset.json', CRATE);
    mkdirSync(join(root, 'assets', 'empty'));
    expect(listAssetLocations(loadProject(root)).map((l) => l.id)).toEqual(['a', 'props/crate']);
  });

  it('flags directories that are not valid ids', () => {
    const root = makeProject();
    writeJson(root, 'assets/Bad Name/asset.json', CRATE);
    const project = loadProject(root);
    const bad = listAssetLocations(project).find((l) => l.id === 'Bad Name');
    expect(bad?.idValid).toBe(false);
    expect(codeOf(() => loadAsset(project, bad as never))).toBe('E_ASSET_INVALID');
  });

  it('checks a declared id against the directory', () => {
    const root = makeProject({}, { ...CRATE, id: 'props/box' });
    try {
      loadAsset(loadProject(root), 'props/crate');
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).issues?.[0]?.path).toBe('id');
    }
  });

  it('reports unknown and malformed asset ids', () => {
    const project = loadProject(makeProject());
    expect(codeOf(() => loadAsset(project, 'props/nope'))).toBe('E_ASSET_NOT_FOUND');
    expect(codeOf(() => loadAsset(project, '../x'))).toBe('E_USAGE');
  });
});
