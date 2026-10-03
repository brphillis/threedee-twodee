import { describe, expect, it } from 'vitest';
import { autoGroundMargin, buildModel, partMatrix, readGlb, type Td2dError, worldPositions } from '../src/index.ts';

const asset = (parts: unknown[]) =>
  ({ sourceFile: 'assets/x/asset.json', model: { parts } }) as Parameters<typeof buildModel>[0];
const box = { type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] };

describe('buildModel', () => {
  it('builds a valid GLB with one primitive per material and name-only materials', async () => {
    const built = await buildModel(
      asset([
        box,
        { type: 'sphere', id: 'knob', material: 'iron', radius: 0.1, position: [0, 1.1, 0] },
        { ...box, id: 'lid', position: [0, 1.5, 0] },
      ]),
    );
    expect(built.report.validator).toMatchObject({ available: true, errors: 0 });
    const doc = await readGlb(built.glb);
    const prims = doc.getRoot().listMeshes()[0]?.listPrimitives() ?? [];
    expect(prims.map((p) => p.getMaterial()?.getName())).toEqual(['iron', 'wood']);
    expect(Object.keys(built.report.materials)).toEqual(['iron', 'wood']);
    expect(built.report.materials.wood?.triangles).toBe(24);
    expect(built.report.bounds).toEqual({ min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] });
  });

  it('keeps hard edges when welding a box', async () => {
    const built = await buildModel(asset([box]));
    expect(built.report.vertices).toBe(24);
    expect(built.report.triangles).toBe(12);
  });

  it('builds every primitive type with the expected bounds', async () => {
    const report = async (part: Record<string, unknown>) =>
      (await buildModel(asset([{ id: 'p', material: 'm', ...part }]))).report;
    expect((await report({ type: 'cylinder', radius: 0.5, height: 2, position: [0, 1, 0] })).bounds.max[1]).toBeCloseTo(
      2,
      6,
    );
    expect((await report({ type: 'sphere', radius: 0.25 })).size[1]).toBeCloseTo(0.5, 6);
    expect((await report({ type: 'plane', size: [2, 1] })).size).toEqual([2, 0, 1]);
  });

  it('applies scale, then rotation in degrees, then translation', async () => {
    const built = await buildModel(
      asset([{ ...box, size: [2, 1, 1], rotation: [0, 90, 0], scale: [1, 1, 3], position: [1, 0, 0] }]),
    );
    expect(built.report.size[0]).toBeCloseTo(3, 6);
    expect(built.report.size[2]).toBeCloseTo(2, 6);
    expect(built.report.bounds.min[0]).toBeCloseTo(-0.5, 6);
  });

  it('keeps outward winding for mirrored parts', async () => {
    const built = await buildModel(asset([{ ...box, scale: [-1, 1, 1] }]));
    expect(built.report.validator.errors).toBe(0);
    expect(partMatrix({ scale: [-1, 1, 1] }).determinant()).toBeLessThan(0);
  });

  it('skips hidden parts and rejects a model with none visible', async () => {
    const built = await buildModel(asset([box, { ...box, id: 'ghost', material: 'glass', visible: false }]));
    expect(Object.keys(built.report.materials)).toEqual(['wood']);
    await expect(buildModel(asset([{ ...box, visible: false }]))).rejects.toMatchObject({ code: 'E_ASSET_INVALID' });
  });

  it('rejects a cylinder without a radius at the part path', async () => {
    const error = (await buildModel(asset([box, { type: 'cylinder', id: 'c', material: 'm', height: 1 }])).catch(
      (e: unknown) => e,
    )) as Td2dError;
    expect(error.issues?.[0]?.path).toBe('model.parts[1].radius');
  });

  it('produces identical bytes for identical input', async () => {
    const a = await buildModel(asset([box]));
    const b = await buildModel(asset([box]));
    expect(Buffer.compare(Buffer.from(a.glb), Buffer.from(b.glb))).toBe(0);
  });
});

describe('autoGroundMargin', () => {
  const scene = {
    frame: { width: 32, height: 32 },
    supersample: 4,
    pixelsPerUnit: 16,
    camera: { pitch: 30, yawOffset: 45 },
  };

  it('leaves room for the footprint in front of the pivot', async () => {
    const positions = worldPositions(await readGlb((await buildModel(asset([box]))).glb));
    // A unit box seen from its corner reaches sqrt(0.5) * sin(30) metres below the pivot: 5.66 pixels.
    expect(autoGroundMargin(positions, [0, 90, 180, 270], scene)).toBe(7);
  });

  it('needs only one pixel when nothing is in front of the pivot', () => {
    expect(autoGroundMargin(Float64Array.from([0, 0, 0, 0, 1, 0]), [0], scene)).toBe(1);
    expect(
      autoGroundMargin(Float64Array.from([0, 0, 0.5]), [0], { ...scene, camera: { pitch: 0, yawOffset: 0 } }),
    ).toBe(1);
  });

  it('grows with pitch and scale', () => {
    const corner = Float64Array.from([0, 0, 1]);
    expect(autoGroundMargin(corner, [0], { ...scene, camera: { pitch: 90, yawOffset: 0 } })).toBe(17);
    expect(autoGroundMargin(corner, [0], { ...scene, pixelsPerUnit: 32, camera: { pitch: 30, yawOffset: 0 } })).toBe(
      17,
    );
  });
});
