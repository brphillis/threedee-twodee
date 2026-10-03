import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createAsset,
  initProject,
  listAssetTemplates,
  loadProject,
  type Td2dError,
  validateConfig,
} from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

function project() {
  const dir = tempDir();
  initProject({ dir });
  return loadProject(dir);
}

describe('createAsset', () => {
  const templates = listAssetTemplates();

  it('ships box, cylinder, sphere and character-blockout templates', () => {
    expect(templates.map((t) => t.name)).toEqual(['box', 'character-blockout', 'cylinder', 'sphere']);
  });

  it.each(templates.map((t) => t.name))('creates a valid asset from the %s template', (template) => {
    const p = project();
    const result = createAsset(p, `test/${template}`, { template });
    expect(result.file).toBe(`assets/test/${template}/asset.json`);
    expect(result.warnings).toEqual([]);
    expect(validateConfig(p, [`test/${template}`]).status).toBe('pass');
  });

  it('writes a schema reference relative to the asset', () => {
    const p = project();
    createAsset(p, 'a/b/c', { description: 'Deep' });
    const written = JSON.parse(readFileSync(join(p.root, 'assets/a/b/c/asset.json'), 'utf8'));
    expect(written.$schema).toBe('../../../../.td2d/schemas/asset.schema.json');
    expect(written).toMatchObject({ id: 'a/b/c', schemaVersion: '1.0.0', description: 'Deep' });
  });

  it('refuses existing ids, invalid ids and unknown templates', () => {
    const p = project();
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as Td2dError).code;
      }
      return 'none';
    };
    expect(codeOf(() => createAsset(p, 'props/crate'))).toBe('E_ASSET_EXISTS');
    expect(codeOf(() => createAsset(p, 'Props/Bad'))).toBe('E_USAGE');
    expect(codeOf(() => createAsset(p, 'props/x', { template: 'teapot' }))).toBe('E_TEMPLATE_NOT_FOUND');
  });
});
