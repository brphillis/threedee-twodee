import type { ClipKeyT } from '@td2d/schema';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  bakeTimes,
  boneWorldRest,
  buildModel,
  buildRig,
  clipKeys,
  EASINGS,
  generateAssets,
  generateKeys,
  loadAsset,
  loadLibrary,
  loadProject,
  posedPositions,
  posedPositionsByNode,
  quaternionFrom,
  readGlb,
  resolveAsset,
  resolveRig,
  sampleKeys,
  skinWeights,
  swapSide,
  type Td2dError,
} from '../src/index.ts';
import { makeProject, writeJson } from './helpers/tmp.ts';

const library = loadLibrary();

/** A small figure on the humanoid rig: a pelvis, a chest and one leg mirrored to the other side. */
function figure(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0',
    type: 'character',
    rig: 'humanoid-basic',
    materials: { cloth: { color: '#3b5dc9' }, skin: { color: '#e8b796' } },
    model: {
      parts: [
        { type: 'box', id: 'pelvis', bone: 'hips', material: 'cloth', size: [0.3, 0.15, 0.2], position: [0, 0.92, 0] },
        { type: 'box', id: 'torso', bone: 'chest', material: 'cloth', size: [0.36, 0.4, 0.22], position: [0, 1.3, 0] },
        {
          type: 'group',
          id: 'leg',
          bone: 'leftUpperLeg',
          mirror: 'x',
          parts: [
            { type: 'box', id: 'thigh', material: 'cloth', size: [0.12, 0.4, 0.12], position: [0.1, 0.69, 0] },
            {
              type: 'box',
              id: 'shin',
              bone: 'leftLowerLeg',
              material: 'skin',
              size: [0.1, 0.44, 0.1],
              position: [0.1, 0.26, 0],
            },
          ],
        },
      ],
    },
    ...extra,
  };
}

function resolveFigure(asset: Record<string, unknown>) {
  const root = makeProject({}, asset);
  const project = loadProject(root);
  return resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
}

function failure(asset: Record<string, unknown>): Td2dError {
  try {
    resolveFigure(asset);
  } catch (error) {
    return error as Td2dError;
  }
  throw new Error('expected resolution to fail');
}

describe('swapSide', () => {
  it('swaps left and right in VRM and kebab-case names, and leaves other names alone', () => {
    expect(swapSide('leftUpperArm')).toBe('rightUpperArm');
    expect(swapSide('rightFoot')).toBe('leftFoot');
    expect(swapSide('front-left-upper')).toBe('front-right-upper');
    expect(swapSide('left')).toBe('right');
    expect(swapSide('leftover')).toBe('leftover');
    expect(swapSide('hips')).toBe('hips');
  });
});

describe('easing', () => {
  it('starts at 0, ends at 1 and never goes backwards', () => {
    for (const [name, f] of Object.entries(EASINGS)) {
      if (name === 'step') continue;
      expect(f(0)).toBeCloseTo(0, 12);
      expect(f(1)).toBeCloseTo(1, 12);
      for (let i = 1; i <= 20; i++) expect(f(i / 20)).toBeGreaterThanOrEqual(f((i - 1) / 20) - 1e-12);
    }
    expect(EASINGS['ease-in'](0.5)).toBe(0.25);
    expect(EASINGS['ease-out'](0.5)).toBe(0.75);
    expect(EASINGS['ease-in-out'](0.25)).toBe(0.125);
    expect(EASINGS['ease-in-out-sine'](0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('resolveRig', () => {
  const layer = (value: unknown, path = 'rig') => ({ file: 'a.json', path, value: value as never });

  it('loads a preset with parents before children', () => {
    const rig = resolveRig([layer('humanoid-basic')], library, []);
    expect(rig?.preset).toBe('humanoid-basic');
    expect(rig?.bones).toHaveLength(15);
    const seen = new Set<string>();
    for (const b of rig?.bones ?? []) {
      if (b.parent !== null) expect(seen.has(b.parent)).toBe(true);
      seen.add(b.name);
    }
    const world = boneWorldRest(rig as NonNullable<typeof rig>);
    expect(new Vector3().setFromMatrixPosition(world.get('head') as Matrix4).toArray()).toEqual(
      [0, 1.57, 0].map((v) => expect.closeTo(v, 9)),
    );
  });

  it('scales, overrides and adds bones by name across layers', () => {
    const rig = resolveRig(
      [
        layer('humanoid-basic', 'typeDefaults.character.rig'),
        layer({
          scale: 0.5,
          bones: [
            { name: 'hips', position: [0, 0.6, 0] },
            { name: 'sword', parent: 'rightLowerArm', position: [0, -0.2, 0.05] },
          ],
        }),
      ],
      library,
      [],
    );
    const bones = new Map(rig?.bones.map((b) => [b.name, b]));
    expect(bones.get('hips')?.position).toEqual([0, 0.6, 0]);
    expect(bones.get('spine')?.position).toEqual([0, 0.06, 0]);
    expect(bones.get('sword')).toMatchObject({ parent: 'rightLowerArm', position: [0, -0.2, 0.05] });
    expect(rig?.bones.at(-1)?.name).toBe('sword');
  });

  it('starts again from a preset named in a later layer, and none removes the rig', () => {
    expect(
      resolveRig([layer({ bones: [{ name: 'a', parent: null }] }), layer('humanoid-basic')], library, [])?.bones,
    ).toHaveLength(15);
    expect(resolveRig([layer('humanoid-basic'), layer('none')], library, [])).toBeNull();
  });

  it('reports unknown presets, missing parents, several roots and cycles', () => {
    const run = (values: unknown[]) => {
      const issues: { path: string; code?: string; message: string }[] = [];
      resolveRig(
        values.map((v) => layer(v)),
        library,
        issues as never,
      );
      return issues;
    };
    expect(run(['skeleton'])[0]).toMatchObject({ path: 'rig', code: 'preset_not_found' });
    expect(run([{ bones: [{ name: 'a' }] }])[0]).toMatchObject({ path: 'rig.bones[0].parent', code: 'missing_parent' });
    expect(
      run([
        {
          bones: [
            { name: 'a', parent: null },
            { name: 'b', parent: null },
          ],
        },
      ])[0]?.message,
    ).toMatch(/2 root bones/);
    expect(
      run([
        {
          bones: [
            { name: 'a', parent: null },
            { name: 'b', parent: 'zz' },
          ],
        },
      ])[0],
    ).toMatchObject({ code: 'unknown_bone' });
    expect(
      run([
        {
          bones: [
            { name: 'a', parent: null },
            { name: 'b', parent: 'c' },
            { name: 'c', parent: 'b' },
          ],
        },
      ])[0]?.message,
    ).toMatch(/cycle/);
  });
});

describe('resolving rigged assets', () => {
  it('gives every leaf its bone, inherited from groups and swapped on the mirrored copy', () => {
    const { asset } = resolveFigure(figure());
    const leaves = new Map<string, { bone?: string }>();
    const walk = (parts: readonly { id: string; type: string; bone?: string; parts?: unknown[] }[]) => {
      for (const p of parts) {
        if (p.type === 'group') walk(p.parts as never);
        else leaves.set(p.id, p);
      }
    };
    walk(asset.model.parts as never);
    expect(leaves.get('thigh')?.bone).toBe('leftUpperLeg');
    expect(leaves.get('shin')?.bone).toBe('leftLowerLeg');
    expect(leaves.get('thigh-mx')?.bone).toBe('rightUpperLeg');
    expect(leaves.get('shin-mx')?.bone).toBe('rightLowerLeg');
    expect(asset.rig?.bones).toHaveLength(15);
  });

  it('rejects bones that are not in the rig and bones without a rig', () => {
    const unknown = failure(
      figure({ model: { parts: [{ type: 'box', id: 'b', bone: 'tail', material: 'cloth', size: [1, 1, 1] }] } }),
    );
    expect(unknown.code).toBe('E_ASSET_INVALID');
    expect(unknown.issues?.[0]).toMatchObject({ path: 'model.parts[0].bone', code: 'unknown_bone' });
    const noRig = failure({ ...figure(), rig: undefined });
    expect(noRig.issues?.some((i) => i.code === 'no_rig')).toBe(true);
  });

  it('reports a bone set on a CSG operand', () => {
    const error = failure(
      figure({
        model: {
          parts: [
            {
              type: 'csg',
              id: 'c',
              op: 'subtract',
              bone: 'chest',
              parts: [
                { type: 'box', id: 'a', material: 'cloth', size: [1, 1, 1] },
                { type: 'box', id: 'b', bone: 'head', material: 'cloth', size: [0.5, 2, 0.5] },
              ],
            },
          ],
        },
      }),
    );
    expect(error.issues?.[0]).toMatchObject({ code: 'bone_in_csg' });
  });

  it('checks clip keys, generators and sample times against the rig', () => {
    const bad = failure(
      figure({
        animation: {
          clips: {
            wave: {
              duration: 1,
              keys: [
                { t: 0, pose: { tail: { rotation: [1, 0, 0] } } },
                { t: 1.5, pose: {} },
              ],
            },
            walk: { duration: 1, generator: { type: 'walk-cycle', bones: { hips: 'pelvis' } } },
            shot: { duration: 0.5, sampleTimes: [0.2, 0.1] },
          },
        },
      }),
    );
    const paths = bad.issues?.map((i) => i.path);
    expect(paths).toContain('animation.clips.wave.keys[0].pose.tail');
    expect(paths).toContain('animation.clips.wave.keys[1].t');
    expect(paths).toContain('animation.clips.walk.generator.bones.hips');
    expect(paths).toContain('animation.clips.shot.sampleTimes[1]');
    const noRig = failure({
      ...figure(),
      rig: undefined,
      model: { parts: [{ type: 'box', id: 'b', material: 'cloth', size: [1, 1, 1] }] },
      animation: { clips: { walk: { duration: 1, generator: { type: 'walk-cycle' } } } },
    });
    expect(noRig.issues?.[0]?.message).toMatch(/needs a rig/);
  });

  it('resolves sample times, interpolation and keys, and warns about durations that are not whole frames', () => {
    const { asset, warnings } = resolveFigure(
      figure({
        animation: {
          fps: 10,
          clips: {
            idle: { duration: 0.4 },
            hit: {
              duration: 0.3,
              loop: false,
              interpolation: 'step',
              keys: [{ t: 0, pose: { chest: { rotation: [10, 0, 0] } } }],
            },
            odd: { duration: 0.65 },
            custom: { duration: 1, sampleTimes: [0, 0.25, 0.9] },
          },
        },
      }),
    );
    const clips = asset.animation.clips;
    expect(clips.idle).toMatchObject({
      frames: 4,
      times: [0, 0.1, 0.2, 0.3],
      interpolation: 'linear',
      keys: null,
      generator: null,
    });
    expect(clips.hit).toMatchObject({ frames: 4, times: [0, 0.1, 0.2, 0.3], interpolation: 'step' });
    expect(clips.custom?.times).toEqual([0, 0.25, 0.9]);
    expect(warnings.find((w) => w.code === 'W_CLIP_FRAME_PERIOD')).toMatchObject({
      path: 'animation.clips.odd.duration',
    });
  });
});

describe('sampleKeys', () => {
  const keys: ClipKeyT[] = [
    { t: 0, pose: { a: { rotation: [0, 0, 0], translation: [0, 0, 0] } } },
    { t: 1, pose: { a: { rotation: [0, 90, 0], translation: [1, 0, 0] } }, easing: 'ease-in' },
    { t: 2, pose: {} },
  ];
  const clip = { duration: 4, loop: true, interpolation: 'linear' as const };

  it('interpolates linearly, eases, and treats bones missing from a key as at rest', () => {
    expect(sampleKeys(keys, 0.5, clip).get('a')?.translation.x).toBeCloseTo(0.5, 12);
    const r = sampleKeys(keys, 0.5, clip).get('a')?.rotation as Quaternion;
    expect(r.angleTo(quaternionFrom([0, 45, 0]))).toBeLessThan(1e-9);
    expect(sampleKeys(keys, 1.5, clip).get('a')?.translation.x).toBeCloseTo(0.75, 12);
  });

  it('holds keys with step interpolation', () => {
    expect(sampleKeys(keys, 0.99, { ...clip, interpolation: 'step' }).get('a')?.translation.x).toBe(0);
    expect(sampleKeys(keys, 1, { ...clip, interpolation: 'step' }).get('a')?.translation.x).toBe(1);
  });

  it('wraps a looping clip from its last key to its first, and holds a one-shot clip', () => {
    const shifted: ClipKeyT[] = [
      { t: 1, pose: { a: { translation: [0, 0, 0] } } },
      { t: 2, pose: { a: { translation: [1, 0, 0] } } },
    ];
    // Looping, 4 s: from the key at 2 s the clip runs back to the first key, repeated at 5 s.
    expect(sampleKeys(shifted, 3.5, clip).get('a')?.translation.x).toBeCloseTo(0.5, 12);
    expect(sampleKeys(shifted, 0.5, clip).get('a')?.translation.x).toBeCloseTo(1 / 6, 12);
    expect(sampleKeys(shifted, 0.5, { ...clip, loop: false }).get('a')?.translation.x).toBe(0);
    expect(sampleKeys(shifted, 3.5, { ...clip, loop: false }).get('a')?.translation.x).toBe(1);
  });

  it('bakes at the sample times and the clip end', () => {
    expect(bakeTimes({ times: [0, 0.1, 0.2, 0.3], duration: 0.4 })).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(bakeTimes({ times: [0, 0.5, 1], duration: 1 })).toEqual([0, 0.5, 1]);
  });
});

describe('generators', () => {
  const rig = resolveRig([{ file: undefined, path: 'rig', value: 'humanoid-basic' }], library, []);
  const times = [0, 0.2, 0.4, 0.6];

  it('walk-cycle swings the legs in opposition, bends the swinging knee and drops the hips at full stride', () => {
    const keys = generateKeys({ type: 'walk-cycle' }, rig, 0.8, times);
    expect(keys.map((k) => k.t)).toEqual(times);
    const full = keys[1]?.pose as Record<string, { rotation?: number[]; translation?: number[] }>;
    expect(full.leftUpperLeg?.rotation).toEqual([-25, 0, 0]);
    expect(full.rightUpperLeg?.rotation).toEqual([25, 0, 0]);
    expect(full.hips?.translation).toEqual([0, -0.03, 0]);
    expect(full.leftUpperArm?.rotation).toEqual([20, 0, 0]);
    const passing = keys[0]?.pose as typeof full;
    expect(passing.leftLowerLeg?.rotation).toEqual([30, 0, 0]);
    expect(passing.rightLowerLeg?.rotation).toEqual([0, 0, 0]);
    expect(passing.hips?.translation).toEqual([0, 0, 0]);
    const custom = generateKeys({ type: 'walk-cycle', stride: 40, bob: 0.1, armSwing: 0 }, rig, 0.8, times)[1]
      ?.pose as typeof full;
    expect(custom.leftUpperLeg?.rotation).toEqual([-40, 0, 0]);
    expect(custom.hips?.translation).toEqual([0, -0.1, 0]);
  });

  it('bob, spin and idle-breathe move their targets, and fall back to the whole model without a rig', () => {
    expect(generateKeys({ type: 'bob', height: 0.2 }, null, 1, [0, 0.5])[1]?.pose).toEqual({
      root: { translation: [0, 0.2, 0] },
    });
    expect(generateKeys({ type: 'spin' }, null, 1, [0, 0.25, 0.5])[2]?.pose).toEqual({
      root: { rotation: [0, 180, 0] },
    });
    expect(generateKeys({ type: 'spin', turns: -1, axis: 'z', bone: 'head' }, rig, 1, [0.25])[0]?.pose).toEqual({
      head: { rotation: [0, 0, -90] },
    });
    const breath = generateKeys({ type: 'idle-breathe' }, rig, 1, [0.5])[0]?.pose as Record<
      string,
      { rotation?: number[]; translation?: number[] }
    >;
    expect(breath.chest).toEqual({ rotation: [-2, 0, 0], translation: [0, 0.01, 0] });
    expect(breath.leftUpperArm?.translation).toEqual([0, -0.005, 0]);
  });

  it('turns a resolved generator clip into keys at its sample times', () => {
    const { asset } = resolveFigure(
      figure({ animation: { clips: { walk: { duration: 0.8, generator: { type: 'walk-cycle' } } } } }),
    );
    const clip = asset.animation.clips.walk as NonNullable<(typeof asset.animation.clips)['walk']>;
    expect(clipKeys(clip, asset.rig).map((k) => k.t)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });
});

describe('skinWeights', () => {
  const rig = resolveRig([{ file: undefined, path: 'rig', value: 'humanoid-basic' }], library, []) as NonNullable<
    ReturnType<typeof resolveRig>
  >;
  // Mid-thigh, beside the knee (off the bone axis), mid-shin, at the shoulder.
  const points = [0.1, 0.7, 0, 0.16, 0.48, 0, 0.1, 0.25, 0, 0.2, 1.3, 0];

  it('sums every vertex to 1, with one bone for nearest-bone and two for two-bone-blend', () => {
    const bones = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftUpperArm'];
    for (const mode of ['nearest-bone', 'two-bone-blend'] as const) {
      const { joints, weights } = skinWeights(points, rig, bones, mode);
      for (let i = 0; i < 4; i++) {
        const w = Array.from(weights.subarray(i * 4, i * 4 + 4));
        expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        for (let k = 0; k < 4; k++) if (w[k] === 0) expect(joints[i * 4 + k]).toBe(0);
        if (mode === 'nearest-bone') expect(w.filter((x) => x > 0)).toHaveLength(1);
      }
      // Mid-thigh follows the upper leg; a point at the arm follows the arm.
      expect(bones[joints[0] as number]).toBe('leftUpperLeg');
      expect(bones[joints[12] as number]).toBe('leftUpperArm');
    }
    const blend = skinWeights(points, rig, bones, 'two-bone-blend');
    // At the knee the upper and lower leg share the vertex.
    expect(blend.weights[4]).toBeGreaterThan(0.3);
    expect(blend.weights[5]).toBeGreaterThan(0.3);
  });
});

describe('buildRig', () => {
  async function rigged(asset: Record<string, unknown>) {
    const { asset: resolved } = resolveFigure(asset);
    const model = await buildModel(resolved);
    const built = await buildRig(model.glb, resolved);
    return { resolved, model, built, doc: await readGlb(built.glb) };
  }

  it('keeps a rig-less, unanimated model byte for byte', async () => {
    const { model, built } = await rigged({
      schemaVersion: '1.0.0',
      type: 'prop',
      materials: { a: { color: '#ffffff' } },
      model: { parts: [{ type: 'box', id: 'b', material: 'a', size: [1, 1, 1] }] },
    });
    expect(Buffer.compare(Buffer.from(built.glb), Buffer.from(model.glb))).toBe(0);
    expect(built.report.bones).toEqual([]);
  });

  it('writes valid glTF with one node per bone, parts under their bones and one animation per animated clip', async () => {
    const { built, doc, model } = await rigged(
      figure({
        animation: {
          clips: {
            idle: { duration: 0.5 },
            walk: { duration: 0.8, generator: { type: 'walk-cycle' } },
            nod: {
              duration: 1,
              keys: [
                { t: 0, pose: {} },
                { t: 0.5, pose: { head: { rotation: [20, 0, 0] } } },
              ],
            },
          },
        },
      }),
    );
    expect(built.report.validator.errors).toBe(0);
    const animations = doc.getRoot().listAnimations();
    expect(animations.map((a) => a.getName()).sort()).toEqual(['nod', 'walk']);
    const walk = animations.find((a) => a.getName() === 'walk');
    expect(walk?.listSamplers()[0]?.getInput()?.getMax([0])[0]).toBeCloseTo(0.8, 6);
    expect(walk?.listSamplers()[0]?.getInterpolation()).toBe('LINEAR');
    expect(built.report.clips.find((c) => c.name === 'idle')).toMatchObject({ source: 'rest', animated: false });
    const hips = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'hips');
    expect(hips?.listChildren().map((n) => n.getName())).toContain('part:hips');
    // At rest every vertex is where the model put it.
    const rest = posedPositions(doc, null, 0);
    const before = posedPositions(await readGlb(model.glb), null, 0);
    expect(rest.length).toBe(before.length);
    const sorted = (a: Float64Array) =>
      Array.from(a)
        .map((v) => Math.round(v * 1e5))
        .sort((x, y) => x - y);
    expect(sorted(rest)).toEqual(sorted(before));
  });

  it('moves rigid parts with their bones and children with their parents', async () => {
    const { doc } = await rigged(
      figure({
        animation: {
          clips: {
            kick: {
              duration: 1,
              loop: false,
              keys: [
                { t: 0, pose: {} },
                { t: 1, pose: { leftUpperLeg: { rotation: [-90, 0, 0] } } },
              ],
            },
          },
        },
      }),
    );
    const at = (t: number) => posedPositionsByNode(doc, 'kick', t);
    const lowest = (values: Float64Array | undefined) => {
      let z = Number.NEGATIVE_INFINITY;
      for (let i = 2; i < (values?.length ?? 0); i += 3) z = Math.max(z, (values as Float64Array)[i] as number);
      return z;
    };
    // Kicking forward 90 degrees puts the shin out in front (+Z), level with the hip.
    expect(lowest(at(0).get('part:leftLowerLeg'))).toBeLessThan(0.1);
    expect(lowest(at(1).get('part:leftLowerLeg'))).toBeGreaterThan(0.6);
    expect(lowest(at(1).get('part:rightLowerLeg'))).toBeLessThan(0.1);
  });

  it('skins parts that span a joint with inverse bind matrices that keep the rest pose', async () => {
    const { built, doc } = await rigged(
      figure({
        model: {
          parts: [
            {
              type: 'box',
              id: 'pelvis',
              bone: 'hips',
              material: 'cloth',
              size: [0.3, 0.15, 0.2],
              position: [0, 0.92, 0],
            },
            {
              type: 'cylinder',
              id: 'leg',
              skin: 'two-bone-blend',
              skinBones: ['leftUpperLeg', 'leftLowerLeg'],
              material: 'skin',
              radius: 0.06,
              height: 0.8,
              position: [0.1, 0.5, 0],
              heightSegments: 16,
            },
          ],
        },
        animation: {
          clips: {
            bend: {
              duration: 1,
              loop: false,
              keys: [
                { t: 0, pose: {} },
                { t: 1, pose: { leftLowerLeg: { rotation: [90, 0, 0] } } },
              ],
            },
          },
        },
      }),
    );
    expect(built.report.validator.errors).toBe(0);
    expect(built.report.attachments.find((a) => a.node === 'skin:leg')).toMatchObject({
      skin: 'two-bone-blend',
      joints: ['leftUpperLeg', 'leftLowerLeg'],
    });
    const skin = doc.getRoot().listSkins()[0];
    const ibm = skin?.getInverseBindMatrices()?.getArray() as Float32Array;
    const knee = new Matrix4().fromArray(Array.from(ibm.slice(16, 32)));
    expect(new Vector3(0.1, 0.48, 0).applyMatrix4(knee).length()).toBeLessThan(1e-6);
    const rest = posedPositionsByNode(doc, 'bend', 0).get('skin:leg') as Float64Array;
    const bent = posedPositionsByNode(doc, 'bend', 1).get('skin:leg') as Float64Array;
    let maxZ = 0;
    for (let i = 2; i < bent.length; i += 3) maxZ = Math.max(maxZ, Math.abs((bent[i] as number) - (rest[i] as number)));
    expect(maxZ).toBeGreaterThan(0.2);
    // The top of the leg, near the hip, stays put.
    for (let i = 0; i < rest.length; i += 3)
      if ((rest[i + 1] as number) > 0.85)
        expect(Math.abs((bent[i + 2] as number) - (rest[i + 2] as number))).toBeLessThan(0.02);
  });

  it('warns when a clip turns a bone past its limits', async () => {
    const { built } = await rigged(
      figure({
        animation: {
          clips: {
            snap: {
              duration: 1,
              keys: [
                { t: 0, pose: {} },
                { t: 0.5, pose: { leftLowerLeg: { rotation: [-40, 0, 0] } } },
              ],
            },
          },
        },
      }),
    );
    expect(built.warnings[0]).toMatchObject({ code: 'W_CLIP_BONE_LIMIT', path: 'animation.clips.snap' });
    expect(built.warnings[0]?.message).toMatch(/leftLowerLeg to x = -40/);
  });

  it('animates a rig-less prop through a root node', async () => {
    const { built, doc } = await rigged({
      schemaVersion: '1.0.0',
      type: 'prop',
      materials: { a: { color: '#ffffff' } },
      model: { parts: [{ type: 'box', id: 'b', material: 'a', size: [1, 0.2, 0.2], position: [0, 0.5, 0] }] },
      animation: { clips: { spin: { duration: 1, generator: { type: 'spin' } } } },
    });
    expect(built.report.clips[0]).toMatchObject({ name: 'spin', animated: true, bones: ['root'] });
    const quarter = posedPositions(doc, 'spin', 0.25);
    let maxZ = 0;
    for (let i = 2; i < quarter.length; i += 3) maxZ = Math.max(maxZ, Math.abs(quarter[i] as number));
    expect(maxZ).toBeCloseTo(0.5, 5);
  });
});

describe('rig presets in projects', () => {
  it('loads project rig presets and reports invalid ones', () => {
    const root = makeProject({}, figure({ rig: 'pole' }));
    writeJson(root, 'presets/rig/pole.json', {
      schemaVersion: '1.0.0',
      name: 'pole',
      bones: [
        { name: 'base', parent: null },
        { name: 'top', parent: 'base', position: [0, 1, 0] },
      ],
    });
    writeJson(root, 'presets/rig/bad.json', { schemaVersion: '1.0.0', name: 'bad', bones: [{ name: 'Bad Name' }] });
    const project = loadProject(root);
    const lib = loadLibrary(project);
    expect(lib.rigs.get('pole')?.source).toBe('project');
    expect(lib.issues.some((i) => i.file === 'presets/rig/bad.json')).toBe(true);
    expect(new Quaternion().angleTo(quaternionFrom(undefined))).toBe(0);
  });
});

describe('walk-cycle foot contact', () => {
  /** Legs with feet on the humanoid rig: thigh, shin and a foot box resting on the ground. */
  function walker(generator: Record<string, unknown>) {
    return figure({
      frame: { width: 32, height: 48 },
      pixelsPerUnit: 20,
      directions: ['w'],
      model: {
        parts: [
          {
            type: 'box',
            id: 'pelvis',
            bone: 'hips',
            material: 'cloth',
            size: [0.3, 0.15, 0.2],
            position: [0, 0.92, 0],
          },
          {
            type: 'group',
            id: 'leg',
            mirror: 'x',
            parts: [
              {
                type: 'box',
                id: 'thigh',
                bone: 'leftUpperLeg',
                material: 'cloth',
                size: [0.12, 0.42, 0.12],
                position: [0.1, 0.69, 0],
              },
              {
                type: 'box',
                id: 'shin',
                bone: 'leftLowerLeg',
                material: 'skin',
                size: [0.1, 0.4, 0.1],
                position: [0.1, 0.28, 0],
              },
              {
                type: 'box',
                id: 'foot',
                bone: 'leftFoot',
                material: 'skin',
                size: [0.1, 0.08, 0.2],
                position: [0.1, 0.04, 0.03],
              },
            ],
          },
        ],
      },
      animation: { clips: { walk: { duration: 0.8, generator: { type: 'walk-cycle', ...generator } } } },
    });
  }
  const plan = async (asset: Record<string, unknown>) => {
    const root = makeProject({}, asset);
    const [result] = await generateAssets({ project: loadProject(root), history: false, to: 'plan' });
    return result as NonNullable<typeof result>;
  };

  it('keeps a foot on the ground with matching stride and bob', async () => {
    const ok = await plan(walker({ stride: 25, bob: 0.08 }));
    expect(ok.warnings.filter((w) => w.code === 'W_CLIP_FOOT_CONTACT')).toEqual([]);
  });

  it('warns when the stride is too large for the bob, and suggests a bob', async () => {
    const result = await plan(walker({ stride: 45, bob: 0.03 }));
    const warning = result.warnings.find((w) => w.code === 'W_CLIP_FOOT_CONTACT');
    expect(warning).toMatchObject({ path: 'animation.clips.walk.generator' });
    expect(warning?.message).toMatch(/above the ground/);
    const suggested = Number(/bob to about ([0-9.]+)/.exec(warning?.hint ?? '')?.[1]);
    expect(suggested).toBeGreaterThan(0.1);
    const fixed = await plan(walker({ stride: 45, bob: suggested }));
    expect(fixed.warnings.filter((w) => w.code === 'W_CLIP_FOOT_CONTACT')).toEqual([]);
  });
});
