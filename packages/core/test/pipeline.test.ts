import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  hashValue,
  loadAsset,
  loadLibrary,
  loadProject,
  planStageHashes,
  resolveAsset,
  StageCache,
  sha256Tag,
} from '../src/index.ts';
import { CRATE, makeProject, tempDir } from './helpers/tmp.ts';

describe('hashing', () => {
  it('ignores key order and notices value changes', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
    expect(sha256Tag('')).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('stage cache', () => {
  it('commits entries atomically and reads them back', () => {
    const cache = new StageCache(join(tempDir(), 'cache'));
    expect(cache.read('model', 'ab12')).toBeUndefined();
    const tmp = join(tempDir(), 'work');
    mkdirSync(tmp);
    writeFileSync(join(tmp, 'model.glb'), 'x');
    const dir = cache.commit(tmp, { stage: 'model', hash: 'ab12', createdAt: 'now', durationMs: 1, data: { n: 1 } });
    expect(dir).toBe(cache.entryDir('model', 'ab12'));
    expect(cache.read('model', 'ab12')?.meta.data).toEqual({ n: 1 });
  });
});

describe('stage hashes', () => {
  function hashesFor(asset: Record<string, unknown>) {
    const project = loadProject(makeProject({}, asset));
    return planStageHashes(resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project)).asset);
  }
  const base = hashesFor(CRATE);
  const changed = (asset: Record<string, unknown>) => {
    const next = hashesFor(asset);
    return Object.keys(base).filter((k) => base[k as keyof typeof base] !== next[k as keyof typeof next]);
  };

  it('are stable for identical input', () => {
    expect(hashesFor(CRATE)).toEqual(base);
  });

  it('keep geometry and planning when only a colour changes', () => {
    expect(changed({ ...CRATE, materials: { ...CRATE.materials, wood: { color: '#ff0000' } } })).toEqual([
      'resolve',
      'render',
      'pixel',
      'sheet',
      'validate',
      'export',
    ]);
  });

  it('rebuild everything downstream of a geometry change', () => {
    const parts = [{ ...CRATE.model.parts[0], size: [1, 2, 1] }, CRATE.model.parts[1]];
    expect(changed({ ...CRATE, model: { parts } })).toEqual([
      'resolve',
      'model',
      'rig',
      'plan',
      'render',
      'pixel',
      'sheet',
      'validate',
      'export',
    ]);
  });

  it('only redo the sheet onwards for a layout change, and only export for an export change', () => {
    expect(changed({ ...CRATE, sheet: { padding: 2 } })).toEqual(['resolve', 'sheet', 'validate', 'export']);
    expect(changed({ ...CRATE, export: { formats: ['aseprite-json', 'manifest', 'frames'] } })).toEqual([
      'resolve',
      'export',
    ]);
  });

  it('rerig without rebuilding geometry when a clip changes', () => {
    const animation = {
      clips: {
        idle: {
          duration: 0.4,
          keys: [
            { t: 0, pose: {} },
            { t: 0.2, pose: { root: { rotation: [0, 30, 0] } } },
          ],
        },
      },
    };
    expect(changed({ ...CRATE, animation })).toEqual([
      'resolve',
      'rig',
      'plan',
      'render',
      'pixel',
      'sheet',
      'validate',
      'export',
    ]);
  });

  it('replan without rebuilding geometry when the camera changes', () => {
    expect(changed({ ...CRATE, camera: 'isometric' })).toEqual([
      'resolve',
      'plan',
      'render',
      'pixel',
      'sheet',
      'validate',
      'export',
    ]);
  });
});
