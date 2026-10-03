import { describe, expect, it } from 'vitest';
import { hexToLinear, probeModelGlb, readGlb, srgbToLinear } from '../src/index.ts';
import { armGlb, cubeGlb } from './fixtures/models.ts';

describe('colour conversion', () => {
  it('converts sRGB to linear', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect(hexToLinear('#ff8000')).toEqual([1, expect.closeTo(0.2158, 3), 0]);
  });
});

describe('GLB writing', () => {
  it('stores td2d shading in material extras and colours in linear space', async () => {
    const doc = await readGlb(await cubeGlb());
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName())).toEqual(['wood', 'iron']);
    expect(materials[1]?.getExtras()).toEqual({ td2d: { shading: 'toon', bands: 2, outline: true } });
    expect(materials[0]?.getBaseColorFactor()[0]).toBeCloseTo(srgbToLinear(0xa0 / 255), 6);
    expect(doc.getRoot().listMeshes()[0]?.listPrimitives()).toHaveLength(2);
  });

  it('writes skins and animations', async () => {
    const doc = await readGlb(await armGlb());
    expect(
      doc
        .getRoot()
        .listSkins()[0]
        ?.listJoints()
        .map((j) => j.getName()),
    ).toEqual(['root', 'tip']);
    expect(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
    ).toEqual(['wave']);
    const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
    expect(prim?.getAttribute('JOINTS_0')?.getComponentType()).toBe(5123);
  });

  it('builds the doctor probe once and reuses it', async () => {
    expect(await probeModelGlb()).toBe(await probeModelGlb());
  });
});
