import { describe, expect, it } from 'vitest';
import { loadProject, validateConfig } from '../src/index.ts';
import { CRATE, makeProject, writeJson } from './helpers/tmp.ts';

describe('validateConfig', () => {
  it('passes a valid project', () => {
    const report = validateConfig(loadProject(makeProject()));
    expect(report.status).toBe('pass');
    expect(report.summary).toEqual({ assets: 1, passed: 1, failed: 0 });
  });

  it('reports each failing asset with its issues and keeps going', () => {
    const root = makeProject();
    writeJson(root, 'assets/a/asset.json', { ...CRATE, frame: { width: 0, height: 1 } });
    writeJson(root, 'assets/b/asset.json', { ...CRATE, camera: 'nope' });
    const report = validateConfig(loadProject(root));
    expect(report.status).toBe('fail');
    expect(report.summary).toEqual({ assets: 3, passed: 1, failed: 2 });
    expect(report.assets.map((a) => [a.id, a.status, a.errorCode])).toEqual([
      ['a', 'fail', 'E_ASSET_INVALID'],
      ['b', 'fail', 'E_PRESET_NOT_FOUND'],
      ['props/crate', 'pass', undefined],
    ]);
    expect(report.assets[0]?.issues[0]?.path).toBe('frame.width');
  });

  it('validates only the requested ids', () => {
    const root = makeProject();
    writeJson(root, 'assets/a/asset.json', { nope: true });
    expect(validateConfig(loadProject(root), ['props/crate']).status).toBe('pass');
  });

  it('fails when project presets are invalid and warns when there are no assets', () => {
    const root = makeProject();
    writeJson(root, 'presets/pixel/bad.json', { schemaVersion: '1.0.0', name: 'bad', alphaThreshold: 999 });
    const report = validateConfig(loadProject(root));
    expect(report.status).toBe('fail');
    expect(report.library.issues[0]).toMatchObject({ file: 'presets/pixel/bad.json', path: 'alphaThreshold' });
  });
});
