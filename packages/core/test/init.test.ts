import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initProject, listProjectTemplates, loadProject, type Td2dError, validateConfig } from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as Td2dError).code;
  }
  return 'none';
}

describe('initProject', () => {
  it('lists the starter template', () => {
    expect(listProjectTemplates()).toContain('starter');
  });

  it('creates a project that validates', () => {
    const dir = join(tempDir(), 'game');
    const result = initProject({ dir, name: 'My Game' });
    expect(result.files).toEqual(
      expect.arrayContaining([
        'td2d.project.json',
        '.gitignore',
        'assets/props/crate/asset.json',
        '.td2d/schemas/asset.schema.json',
      ]),
    );
    expect(existsSync(join(dir, 'gitignore'))).toBe(false);
    const project = loadProject(dir);
    expect(project.config.name).toBe('My Game');
    expect(validateConfig(project).status).toBe('pass');
  });

  it('names the project after its directory by default', () => {
    const dir = join(tempDir(), 'forest-tiles');
    expect(initProject({ dir }).name).toBe('forest-tiles');
  });

  it('refuses to overwrite any existing file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'README.md'), 'mine');
    try {
      initProject({ dir });
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_INIT_CONFLICT');
      expect((error as Td2dError).details?.conflicts).toEqual(['README.md']);
    }
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('mine');
    expect(existsSync(join(dir, 'td2d.project.json'))).toBe(false);
  });

  it('refuses to initialise an existing project and unknown templates', () => {
    const dir = tempDir();
    initProject({ dir });
    expect(codeOf(() => initProject({ dir }))).toBe('E_PROJECT_EXISTS');
    expect(codeOf(() => initProject({ dir: tempDir(), template: 'nope' }))).toBe('E_TEMPLATE_NOT_FOUND');
  });
});
