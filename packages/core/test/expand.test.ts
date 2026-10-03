import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forEachLeaf, loadAsset, loadLibrary, loadProject, resolveAsset, type Td2dError } from '../src/index.ts';
import { cubeGlb } from './fixtures/models.ts';
import { makeProject, writeJson } from './helpers/tmp.ts';

const wood = { wood: { color: '#a0693a' }, iron: { color: '#5b6770' } };
const asset = (parts: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0',
  type: 'prop',
  materials: wood,
  model: { parts },
  ...extra,
});
const post = {
  schemaVersion: '1.0.0',
  name: 'post',
  params: { height: { type: 'number', default: 1, min: 0.2 }, label: { type: 'string', default: 'p' } },
  parts: [
    { type: 'box', id: '${label}', material: 'wood', size: [0.1, '${height}', 0.1], position: [0, '${height / 2}', 0] },
  ],
};

function resolveWith(parts: unknown[], setup?: (root: string) => void, extra?: Record<string, unknown>) {
  const root = makeProject({}, asset(parts, extra));
  writeJson(root, 'components/post.json', post);
  setup?.(root);
  const project = loadProject(root);
  return resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
}
function failure(parts: unknown[], setup?: (root: string) => void): Td2dError {
  try {
    resolveWith(parts, setup);
  } catch (error) {
    return error as Td2dError;
  }
  throw new Error('expected failure');
}
const leafIds = (parts: Parameters<typeof forEachLeaf>[0]) => {
  const ids: string[] = [];
  forEachLeaf(parts, (p) => ids.push(p.id));
  return ids;
};

describe('components', () => {
  it('expands a component into a group with substituted, prefixed parts', () => {
    const { asset: a } = resolveWith([
      { type: 'component', id: 'gate', component: 'post', params: { height: 1.4 }, position: [1, 0, 0] },
    ]);
    expect(a.model.parts).toEqual([
      {
        type: 'group',
        id: 'gate',
        position: [1, 0, 0],
        parts: [{ type: 'box', id: 'gate-p', material: 'wood', size: [0.1, 1.4, 0.1], position: [0, 0.7, 0] }],
      },
    ]);
  });

  it('applies defaults, remaps materials and contributes component materials', () => {
    const { asset: a } = resolveWith(
      [{ type: 'component', id: 'g', component: 'post', materials: { wood: 'iron' } }],
      (root) =>
        writeJson(root, 'components/post.json', {
          ...post,
          materials: { wood: { color: '#000000' }, extra: { color: '#ffffff' } },
        }),
    );
    const [box] = (a.model.parts[0] as { parts: { material: string; size: number[] }[] }).parts;
    expect(box?.material).toBe('iron');
    expect(box?.size[1]).toBe(1);
    expect(a.materials.extra?.color).toBe('#ffffff');
  });

  it('reports unknown, missing and out-of-range parameters at the instance', () => {
    const error = failure([{ type: 'component', id: 'g', component: 'post', params: { heigth: 2, height: 0.1 } }]);
    expect(error.code).toBe('E_COMPONENT_INVALID');
    expect(error.issues?.map((i) => i.path).sort()).toEqual([
      'model.parts[0].params.height',
      'model.parts[0].params.heigth',
    ]);
  });

  it('reports invalid substituted parts in the component file', () => {
    const error = failure([{ type: 'component', id: 'g', component: 'bad' }], (root) =>
      writeJson(root, 'components/bad.json', {
        schemaVersion: '1.0.0',
        name: 'bad',
        parts: [{ type: 'box', id: 'x', material: 'wood', size: [1, '${0 - 1}', 1] }],
      }),
    );
    expect(error.issues?.[0]).toMatchObject({ file: 'components/bad.json', path: 'parts[0].size[1]' });
  });

  it('detects cycles and reports missing components', () => {
    const cycle = failure([{ type: 'component', id: 'g', component: 'a' }], (root) => {
      writeJson(root, 'components/a.json', {
        schemaVersion: '1.0.0',
        name: 'a',
        parts: [{ type: 'component', id: 'x', component: 'b' }],
      });
      writeJson(root, 'components/b.json', {
        schemaVersion: '1.0.0',
        name: 'b',
        parts: [{ type: 'component', id: 'y', component: 'a' }],
      });
    });
    expect(cycle.code).toBe('E_COMPONENT_CYCLE');
    expect(cycle.issues?.[0]?.message).toMatch(/a > b > a/);
    expect(failure([{ type: 'component', id: 'g', component: 'ghost' }]).code).toBe('E_COMPONENT_NOT_FOUND');
  });

  it('limits nesting depth to 8', () => {
    const error = failure([{ type: 'component', id: 'g', component: 'c0' }], (root) => {
      for (let i = 0; i < 10; i++)
        writeJson(root, `components/c${i}.json`, {
          schemaVersion: '1.0.0',
          name: `c${i}`,
          parts: [{ type: 'component', id: `k${i}`, component: `c${i + 1}` }],
        });
    });
    expect(error.code).toBe('E_COMPONENT_CYCLE');
    expect(error.issues?.[0]?.message).toMatch(/more than 8 deep/);
  });
});

describe('modifiers and ids', () => {
  it('repeats parts with offsets and rotations', () => {
    const { asset: a } = resolveWith([
      {
        type: 'box',
        id: 'post',
        material: 'wood',
        size: [0.1, 1, 0.1],
        repeat: { count: 3, offset: [0.5, 0, 0], rotation: [0, 10, 0] },
      },
    ]);
    expect(a.model.parts.map((p) => [p.id, p.position, p.rotation])).toEqual([
      ['post-0', [0, 0, 0], [0, 0, 0]],
      ['post-1', [0.5, 0, 0], [0, 10, 0]],
      ['post-2', [1, 0, 0], [0, 20, 0]],
    ]);
    expect(leafIds(a.model.parts)).toEqual(['post-0', 'post-1', 'post-2']);
  });

  it('mirrors across each listed axis with a negative scale', () => {
    const { asset: a } = resolveWith([
      { type: 'box', id: 'leg', material: 'wood', size: [0.1, 1, 0.1], position: [0.4, 0.5, 0.4], mirror: ['x', 'z'] },
    ]);
    expect(leafIds(a.model.parts)).toEqual(['leg', 'leg-mx', 'leg-mz', 'leg-mx-mz']);
    expect(a.model.parts.map((p) => p.scale)).toEqual([undefined, [-1, 1, 1], [1, 1, -1], [1, 1, -1]]);
  });

  it('gives a part colour its own material variant and keeps geometry colour-free', () => {
    const { asset: a } = resolveWith([
      { type: 'box', id: 'lid', material: 'wood', size: [1, 1, 1], color: { palette: 'pico-8', index: 8 } },
    ]);
    expect(a.materials['wood~lid']).toMatchObject({ color: '#ff004d', shading: 'toon' });
    expect((a.model.parts[0] as { color?: unknown }).color).toEqual({ palette: 'pico-8', index: 8 });
  });

  it('checks ids and materials after expansion, inside groups and CSG', () => {
    const error = failure([
      { type: 'box', id: 'a', material: 'wood', size: [1, 1, 1] },
      { type: 'group', id: 'g', parts: [{ type: 'box', id: 'a', material: 'stone', size: [1, 1, 1] }] },
    ]);
    expect(error.issues?.map((i) => [i.path, i.code])).toEqual([
      ['model.parts[1].parts[0].id', 'duplicate_part_id'],
      ['model.parts[1].parts[0].material', 'unknown_material'],
    ]);
  });

  it('drops hidden parts', () => {
    const { asset: a } = resolveWith([
      { type: 'box', id: 'a', material: 'wood', size: [1, 1, 1] },
      { type: 'box', id: 'b', material: 'iron', size: [1, 1, 1], visible: false },
    ]);
    expect(leafIds(a.model.parts)).toEqual(['a']);
  });
});

describe('imports', () => {
  it('hashes imported files relative to the asset directory', async () => {
    const glb = await cubeGlb();
    const { asset: a } = resolveWith(
      [{ type: 'import', id: 'cube', src: 'import/cube.glb', material: 'wood' }],
      (root) => {
        mkdirSync(join(root, 'assets/props/crate/import'));
        writeFileSync(join(root, 'assets/props/crate/import/cube.glb'), glb);
      },
    );
    expect(Object.keys(a.model.imports)).toEqual(['assets/props/crate/import/cube.glb']);
    expect((a.model.parts[0] as { src: string }).src).toBe('assets/props/crate/import/cube.glb');
  });

  it('reports missing files and paths that leave the project', () => {
    expect(failure([{ type: 'import', id: 'c', src: 'nope.glb', material: 'wood' }]).code).toBe('E_IMPORT_FAILED');
    expect(
      failure([{ type: 'import', id: 'c', src: '../../../../etc/hosts', material: 'wood' }]).issues?.[0]?.message,
    ).toMatch(/outside the project|does not exist/);
  });
});
