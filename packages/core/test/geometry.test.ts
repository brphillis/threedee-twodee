import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartDefinitionT } from '@td2d/schema';
import { PART_SCHEMAS } from '@td2d/schema';
import { BoxGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import {
  addGeometryPrimitive,
  addTd2dMaterial,
  buildModel,
  newDocument,
  readGlb,
  type Td2dError,
  TRIANGLE_LIMIT,
  writeGlb,
} from '../src/index.ts';
import { cubeGlb } from './fixtures/models.ts';
import { tempDir } from './helpers/tmp.ts';

const build = (parts: unknown[], projectRoot = '.') =>
  buildModel(
    { sourceFile: 'assets/x/asset.json', model: { parts: parts as PartDefinitionT[], imports: {} } },
    { projectRoot },
  );

/** Volume of a closed mesh by the divergence theorem, over every primitive in the GLB. */
async function volume(glb: Uint8Array, material?: string): Promise<number> {
  const doc = await readGlb(glb);
  let v = 0;
  for (const prim of doc.getRoot().listMeshes()[0]?.listPrimitives() ?? []) {
    if (material && prim.getMaterial()?.getName() !== material) continue;
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices()?.getArray() ?? [];
    const p = (i: number) => pos?.getElement(i, []) as number[];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [p(idx[t] as number), p(idx[t + 1] as number), p(idx[t + 2] as number)] as [
        number[],
        number[],
        number[],
      ];
      v +=
        ((a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0)) -
          (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0)) +
          (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0))) /
        6;
    }
  }
  return v;
}

describe('primitive parts', () => {
  it('builds every primitive schema example into a valid, closed (except planes) solid', async () => {
    for (const type of [
      'box',
      'cylinder',
      'cone',
      'sphere',
      'capsule',
      'torus',
      'plane',
      'wedge',
      'lathe',
      'extrude',
    ] as const) {
      const example = ((PART_SCHEMAS[type].meta()?.examples ?? []) as unknown[])[0];
      const built = await build([example]);
      expect(built.report.validator.errors, type).toBe(0);
      expect(built.report.parts[0]?.closed, type).toBe(type !== 'plane');
      expect(built.report.triangles, type).toBeGreaterThan(0);
    }
  });

  it('places each primitive with the documented size and orientation', async () => {
    const size = async (part: Record<string, unknown>) => (await build([{ id: 'p', material: 'm', ...part }])).report;
    expect((await size({ type: 'cone', radius: 0.3, height: 0.8 })).bounds).toEqual({
      min: [-0.3, -0.4, -0.3],
      max: [0.3, 0.4, 0.3],
    });
    expect((await size({ type: 'capsule', radius: 0.25, length: 0.6 })).size[1]).toBeCloseTo(1.1, 6);
    const torus = await size({ type: 'torus', radius: 0.4, tube: 0.1 });
    expect(torus.size[1]).toBeCloseTo(0.2, 6);
    expect(torus.size[0]).toBeCloseTo(1, 2);
    expect((await size({ type: 'wedge', size: [1, 0.5, 2] })).bounds).toEqual({
      min: [-0.5, -0.25, -1],
      max: [0.5, 0.25, 1],
    });
    expect(
      (
        await size({
          type: 'extrude',
          shape: [
            [0, 0],
            [1, 0],
            [0, 2],
          ],
          depth: 0.2,
        })
      ).bounds,
    ).toEqual({ min: [0, 0, -0.1], max: [1, 2, 0.1] });
    expect(
      (
        await size({
          type: 'lathe',
          profile: [
            [0, 0],
            [0.5, 0],
            [0.5, 1],
            [0, 1],
          ],
          segments: 32,
        })
      ).bounds.max[1],
    ).toBe(1);
  });

  it('slopes a wedge down towards the front', async () => {
    const doc = await readGlb((await build([{ type: 'wedge', id: 'w', material: 'm', size: [1, 1, 1] }])).glb);
    const pos = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getAttribute('POSITION');
    const tops: number[][] = [];
    for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
      const p = pos?.getElement(i, []) as number[];
      if ((p[1] ?? 0) > 0.49) tops.push(p);
    }
    expect(tops.every((p) => (p[2] ?? 0) < -0.49)).toBe(true);
  });

  it('rotates and scales about the pivot', async () => {
    const hinge = await build([
      {
        type: 'box',
        id: 'door',
        material: 'm',
        size: [1, 2, 0.1],
        pivot: [-0.5, -1, 0],
        position: [0, 0, 0],
        rotation: [0, 90, 0],
      },
    ]);
    expect(hinge.report.bounds.min[1]).toBeCloseTo(0, 6);
    // Rotating +90 degrees about Y maps the door's width (+X from the hinge) onto -Z.
    expect(hinge.report.bounds.max[2]).toBeCloseTo(0, 6);
    expect(hinge.report.bounds.min[2]).toBeCloseTo(-1, 6);
    expect(hinge.report.bounds.max[0]).toBeCloseTo(0.05, 6);
  });

  it('removes zero-area triangles from lathe poles', async () => {
    const built = await build([
      {
        type: 'lathe',
        id: 'v',
        material: 'm',
        profile: [
          [0, 0],
          [0.5, 0.5],
          [0, 1],
        ],
        segments: 8,
      },
    ]);
    expect(built.report.triangles).toBe(16);
  });
});

describe('groups', () => {
  it('apply their transform to every child', async () => {
    const built = await build([
      {
        type: 'group',
        id: 'g',
        position: [2, 0, 0],
        scale: 2,
        parts: [{ type: 'box', id: 'a', material: 'm', size: [1, 1, 1], position: [0, 0.5, 0] }],
      },
    ]);
    expect(built.report.bounds).toEqual({ min: [1, 0, -1], max: [3, 2, 1] });
  });
});

describe('CSG', () => {
  const box = { type: 'box', id: 'body', material: 'stone', size: [1, 1, 1] };
  const hole = { type: 'cylinder', id: 'hole', material: 'metal', radius: 0.3, height: 2, segments: 64 };

  it('subtracts within 1% of the analytic volume and keeps each operand material', async () => {
    const built = await build([{ type: 'csg', id: 'block', op: 'subtract', parts: [box, hole] }]);
    expect(built.report.validator.errors).toBe(0);
    expect(Object.keys(built.report.materials)).toEqual(['metal', 'stone']);
    const v = await volume(built.glb);
    expect(Math.abs(v - (1 - Math.PI * 0.09)) / (1 - Math.PI * 0.09)).toBeLessThan(0.01);
    expect(built.report.parts).toEqual([expect.objectContaining({ id: 'block', type: 'csg', closed: true })]);
  });

  it('unions, intersects and hulls', async () => {
    const shifted = { ...box, id: 'b2', position: [0.5, 0, 0] };
    expect(await volume((await build([{ type: 'csg', id: 'u', op: 'union', parts: [box, shifted] }])).glb)).toBeCloseTo(
      1.5,
      4,
    );
    expect(
      await volume((await build([{ type: 'csg', id: 'i', op: 'intersect', parts: [box, shifted] }])).glb),
    ).toBeCloseTo(0.5, 4);
    const apart = { ...box, id: 'b3', position: [2, 0, 0] };
    expect(await volume((await build([{ type: 'csg', id: 'h', op: 'hull', parts: [box, apart] }])).glb)).toBeCloseTo(
      3,
      4,
    );
  });

  it('accepts groups as operands and applies the CSG transform to the result', async () => {
    const built = await build([
      {
        type: 'csg',
        id: 'c',
        op: 'subtract',
        position: [0, 0.5, 0],
        parts: [
          box,
          {
            type: 'group',
            id: 'g',
            parts: [
              { ...hole, id: 'h1', radius: 0.1, position: [0.25, 0, 0] },
              { ...hole, id: 'h2', radius: 0.1, position: [-0.25, 0, 0] },
            ],
          },
        ],
      },
    ]);
    expect(built.report.bounds.min[1]).toBeCloseTo(0, 6);
    expect(await volume(built.glb)).toBeCloseTo(1 - 2 * Math.PI * 0.01, 2);
  });

  it('names an open operand with E_PART_NOT_MANIFOLD', async () => {
    const error = (await build([
      {
        type: 'csg',
        id: 'c',
        op: 'subtract',
        parts: [box, { type: 'plane', id: 'sheet', material: 'stone', size: [2, 2] }],
      },
    ]).catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_PART_NOT_MANIFOLD');
    expect(error.message).toMatch(/"sheet"/);
    expect(error.issues?.[0]?.path).toBe('model.parts[0].parts[1]');
  });
});

describe('imports', () => {
  async function project() {
    const root = tempDir();
    mkdirSync(join(root, 'assets/x'), { recursive: true });
    writeFileSync(join(root, 'assets/x/cube.glb'), await cubeGlb());
    return root;
  }

  it('maps glTF materials, aligns the base to the origin and applies units', async () => {
    const root = await project();
    const built = await build(
      [
        {
          type: 'import',
          id: 'c',
          src: 'assets/x/cube.glb',
          material: 'fallback',
          materialMap: { iron: 'metal' },
          units: 2,
          align: 'base',
        },
      ],
      root,
    );
    expect(Object.keys(built.report.materials)).toEqual(['fallback', 'metal']);
    expect(built.report.bounds).toEqual({ min: [-1, 0, -1], max: [1, 2, 1] });
  });

  it('centres or keeps the origin when asked, and reports unknown nodes', async () => {
    const root = await project();
    expect(
      (await build([{ type: 'import', id: 'c', src: 'assets/x/cube.glb', material: 'm', align: 'centre' }], root))
        .report.bounds.min[1],
    ).toBeCloseTo(-0.5, 6);
    expect(
      (await build([{ type: 'import', id: 'c', src: 'assets/x/cube.glb', material: 'm', align: 'origin' }], root))
        .report.bounds.min[1],
    ).toBeCloseTo(0, 6);
    const error = (await build(
      [{ type: 'import', id: 'c', src: 'assets/x/cube.glb', material: 'm', select: ['lid'] }],
      root,
    ).catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_IMPORT_FAILED');
    expect(error.message).toMatch(/no node named "lid".*Nodes: cube/);
  });

  it('keeps vertex colours from imported files and pads other parts of the material with white', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'assets/x'), { recursive: true });
    const doc = newDocument();
    const material = addTd2dMaterial(doc, {
      name: 'paint',
      color: '#ffffff',
      shading: 'toon',
      bands: 3,
      emissive: '#000000',
      outline: false,
    });
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      'color',
      new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5), 3),
    );
    const mesh = doc.createMesh('m');
    addGeometryPrimitive(doc, mesh, geometry, material);
    doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
    writeFileSync(join(root, 'assets/x/painted.glb'), await writeGlb(doc));
    const built = await build(
      [
        { type: 'import', id: 'p', src: 'assets/x/painted.glb', material: 'm' },
        { type: 'box', id: 'plain', material: 'm', size: [1, 1, 1], position: [2, 0.5, 0] },
      ],
      root,
    );
    const prim = (await readGlb(built.glb)).getRoot().listMeshes()[0]?.listPrimitives()[0];
    const colours = prim?.getAttribute('COLOR_0');
    expect(colours?.getCount()).toBe(prim?.getAttribute('POSITION')?.getCount());
    const values = new Set<number>();
    if (colours)
      for (let i = 0; i < colours.getCount(); i++) values.add((colours.getElement(i, []) as number[])[0] as number);
    expect([...values].sort()).toEqual([0.5, 1]);
  });

  it('rejects files that are not GLB', async () => {
    const root = await project();
    writeFileSync(join(root, 'assets/x/bad.glb'), 'not a glb');
    expect(
      (
        (await build([{ type: 'import', id: 'c', src: 'assets/x/bad.glb', material: 'm' }], root).catch(
          (e: unknown) => e,
        )) as Td2dError
      ).code,
    ).toBe('E_IMPORT_FAILED');
  });
});

describe('limits and warnings', () => {
  it('rejects models over the triangle limit and warns above the budget', async () => {
    const dense = {
      type: 'sphere',
      id: 's',
      material: 'm',
      radius: 1,
      position: [0, 1, 0],
      widthSegments: 256,
      heightSegments: 128,
    };
    const error = (await build([dense]).catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_MODEL_TOO_COMPLEX');
    expect(error.message).toMatch(new RegExp(String(TRIANGLE_LIMIT)));
    const busy = await build([{ ...dense, widthSegments: 128, heightSegments: 100 }]);
    expect(busy.warnings.map((w) => w.code)).toEqual(['W_TRIANGLE_BUDGET']);
  });

  it('warns when geometry goes below the ground', async () => {
    expect(
      (await build([{ type: 'box', id: 'b', material: 'm', size: [1, 1, 1] }])).warnings.map((w) => w.code),
    ).toEqual(['W_MODEL_BELOW_GROUND']);
  });
});
