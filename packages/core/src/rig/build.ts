import type { Document, Node } from '@gltf-transform/core';
import type { ClipKeyT, ResolvedAssetT, ResolvedRigT, WarningT } from '@td2d/schema';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Td2dError } from '../errors.ts';
import type { Logger } from '../logger.ts';
import { validateGlb } from '../model/build.ts';
import { readGlb, writeGlb } from '../model/gltf.ts';
import { animatedBones, bakeTimes, clipKeys, sampleKeys } from './clips.ts';
import { MODEL_ROOT } from './generators.ts';
import { boneWorldRest, eulerDegrees, quaternionFrom, round6 } from './math.ts';

export interface RigReport {
  readonly bones: readonly { name: string; parent: string | null; world: [number, number, number] }[];
  readonly attachments: readonly {
    node: string;
    bone: string | null;
    skin: 'rigid' | 'nearest-bone' | 'two-bone-blend';
    joints: readonly string[];
    vertices: number;
  }[];
  readonly clips: readonly {
    name: string;
    source: 'keys' | 'generator' | 'rest';
    interpolation: 'linear' | 'step';
    duration: number;
    animated: boolean;
    bones: readonly string[];
    bakedTimes: number;
    keys: readonly ClipKeyT[];
  }[];
  readonly validator: { readonly available: boolean; readonly errors: number; readonly warnings: number };
}

export interface BuiltRig {
  readonly glb: Uint8Array;
  readonly report: RigReport;
  readonly warnings: readonly WarningT[];
}

const v3 = (v: Vector3): [number, number, number] => [round6(v.x), round6(v.y), round6(v.z)];

/** Width of the blend between two bones, as a fraction of the shorter bone's length. */
export const BLEND_ZONE = 0.15;

/** Shortest distance from a point to the segment a-b. */
function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const len = ab.lengthSq();
  const u = len === 0 ? 0 : Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / len));
  return p.distanceTo(a.clone().addScaledVector(ab, u));
}

/**
 * Joint indices and weights for a skinned mesh. Each bone is the set of segments from its
 * joint to its children's joints; a leaf bone continues its parent's direction for its
 * parent's length. nearest-bone gives each
 * vertex to its nearest bone. two-bone-blend shares a vertex between its two nearest bones
 * only near the joint between them: the second bone's weight falls from one half, where both
 * bones are equally near, to zero once it is further away than the first by more than
 * BLEND_ZONE times the shorter bone's length. Away from joints a vertex follows one bone
 * fully, so limbs keep their length and shape.
 */
export function skinWeights(
  positions: Float32Array | number[],
  rig: ResolvedRigT,
  candidates: readonly string[],
  mode: 'nearest-bone' | 'two-bone-blend',
): { joints: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>; weights: Float32Array<ArrayBuffer> } {
  const rest = boneWorldRest(rig);
  const head = (name: string) => new Vector3().setFromMatrixPosition(rest.get(name) as Matrix4);
  const segments = candidates.map((name) => {
    const a = head(name);
    const children = rig.bones.filter((b) => b.parent === name).map((b) => head(b.name));
    if (children.length > 0) return children.map((c) => [a, c] as const);
    // A leaf bone carries on in its parent's direction for its parent's length, so a hand or
    // forearm at the end of a chain has an extent and is not tied with the bone before it.
    const parent = rig.bones.find((b) => b.name === name)?.parent;
    if (!parent) return [[a, a] as const];
    const end = a.clone().add(a.clone().sub(head(parent)));
    return [[a, end] as const];
  });
  const lengths = segments.map((segs) => Math.max(...segs.map(([a, b]) => a.distanceTo(b))));
  const count = positions.length / 3;
  const joints = candidates.length > 255 ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  const p = new Vector3();
  for (let i = 0; i < count; i++) {
    p.set(positions[i * 3] as number, positions[i * 3 + 1] as number, positions[i * 3 + 2] as number);
    const ranked = segments
      .map((segs, k) => ({ k, d: Math.min(...segs.map(([a, b]) => segmentDistance(p, a, b))) }))
      .sort((x, y) => x.d - y.d || x.k - y.k);
    const first = ranked[0] as { k: number; d: number };
    const second = ranked[1];
    if (mode === 'nearest-bone' || !second || first.d < 1e-9) {
      joints[i * 4] = first.k;
      weights[i * 4] = 1;
      continue;
    }
    const shorter = Math.min(
      ...[lengths[first.k] as number, lengths[second.k] as number].filter((l) => l > 0),
      Number.POSITIVE_INFINITY,
    );
    const zone = Number.isFinite(shorter) ? BLEND_ZONE * shorter : 0;
    const x = zone > 0 ? Math.min(1, (second.d - first.d) / zone) : 1;
    const w2 = 0.5 * (1 - x * x * (3 - 2 * x));
    if (w2 <= 0) {
      joints[i * 4] = first.k;
      weights[i * 4] = 1;
      continue;
    }
    const w1 = 1 - w2;
    joints[i * 4] = first.k;
    joints[i * 4 + 1] = second.k;
    weights[i * 4] = w1;
    weights[i * 4 + 1] = 1 - w1;
  }
  return { joints, weights };
}

function restOf(rig: ResolvedRigT | null, name: string): { t: Vector3; r: Quaternion } {
  const bone = rig?.bones.find((b) => b.name === name);
  return bone
    ? { t: new Vector3(...bone.position), r: quaternionFrom(bone.rotation) }
    : { t: new Vector3(), r: new Quaternion() };
}

/**
 * Add the rig and clips to a built model. Bones become glTF nodes; rigid parts become children
 * of their bones, offset by the inverse of the bone's rest transform so they stay where the
 * model put them; skinned parts get a skin. Each clip is baked at its sample times and its end
 * into one glTF animation, so the renderer only samples, with no easing of its own. A model
 * without a rig whose clips move "root" gets a root node around it.
 */
export async function buildRig(
  modelGlb: Uint8Array,
  asset: Pick<ResolvedAssetT, 'id' | 'rig' | 'animation' | 'sourceFile'>,
  logger?: Logger,
): Promise<BuiltRig> {
  const rig = asset.rig;
  const clips = Object.entries(asset.animation.clips).map(([name, clip]) => ({
    name,
    clip,
    keys: clipKeys(clip, rig),
  }));
  const doc: Document = await readGlb(modelGlb);
  const root = doc.getRoot();
  const scene =
    root.getDefaultScene() ?? (root.listScenes()[0] as NonNullable<ReturnType<typeof root.getDefaultScene>>);
  const warnings: WarningT[] = [];
  const attachments: RigReport['attachments'][number][] = [];
  const animate = clips.some((c) => c.keys.length > 0);
  const summary = (animated: Set<string>): RigReport['clips'] =>
    clips.map(({ name, clip, keys }) => ({
      name,
      source: clip.keys ? 'keys' : clip.generator ? 'generator' : 'rest',
      interpolation: clip.interpolation,
      duration: clip.duration,
      animated: animated.has(name),
      bones: animatedBones(keys),
      bakedTimes: keys.length > 0 ? bakeTimes(clip).length : 0,
      keys,
    }));

  if (!rig && !animate) {
    for (const node of scene.listChildren())
      attachments.push({ node: node.getName(), bone: null, skin: 'rigid', joints: [], vertices: vertexCount(node) });
    return {
      glb: modelGlb,
      report: {
        bones: [],
        attachments,
        clips: summary(new Set()),
        validator: { available: true, errors: 0, warnings: 0 },
      },
      warnings,
    };
  }

  // Bones, or a single root node around the whole model.
  const bones = new Map<string, Node>();
  const rest = rig ? boneWorldRest(rig) : new Map([[MODEL_ROOT, new Matrix4()]]);
  if (rig) {
    for (const bone of rig.bones) {
      const node = doc
        .createNode(bone.name)
        .setTranslation([...bone.position])
        .setRotation(quaternionFrom(bone.rotation).toArray() as [number, number, number, number])
        .setExtras({ td2d: { bone: bone.name } });
      if (bone.parent === null) scene.addChild(node);
      else (bones.get(bone.parent) as Node).addChild(node);
      bones.set(bone.name, node);
    }
  } else {
    const node = doc.createNode(MODEL_ROOT).setExtras({ td2d: { bone: MODEL_ROOT } });
    scene.addChild(node);
    bones.set(MODEL_ROOT, node);
  }
  const rootBone = rig ? (rig.bones[0]?.name as string) : MODEL_ROOT;

  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  for (const node of [...scene.listChildren()]) {
    if (!node.getMesh()) continue;
    const name = node.getName();
    const extras =
      (node.getExtras() as { td2d?: { bone?: string | null; skin?: string; skinBones?: string[] | null } }).td2d ?? {};
    const skin = (extras.skin ?? 'rigid') as RigReport['attachments'][number]['skin'];
    if (skin === 'rigid') {
      const bone = name === 'model' ? rootBone : (extras.bone ?? rootBone);
      const offset = (rest.get(bone) as Matrix4).clone().invert();
      const t = new Vector3();
      const r = new Quaternion();
      const s = new Vector3();
      offset.decompose(t, r, s);
      scene.removeChild(node);
      node
        .setTranslation(t.toArray() as [number, number, number])
        .setRotation(r.toArray() as [number, number, number, number])
        .setScale(s.toArray() as [number, number, number]);
      (bones.get(bone) as Node).addChild(node);
      attachments.push({ node: name, bone, skin, joints: [], vertices: vertexCount(node) });
      continue;
    }
    if (!rig) throw new Td2dError('E_INTERNAL', `Part node ${name} is skinned but the asset has no rig.`);
    const candidates = rig.bones.map((b) => b.name).filter((b) => !extras.skinBones || extras.skinBones.includes(b));
    const skinNode = doc.createSkin(name).setSkeleton(bones.get(rootBone) as Node);
    for (const joint of candidates) skinNode.addJoint(bones.get(joint) as Node);
    const ibm = new Float32Array(candidates.length * 16);
    for (const [k, joint] of candidates.entries())
      ibm.set((rest.get(joint) as Matrix4).clone().invert().toArray(), k * 16);
    skinNode.setInverseBindMatrices(doc.createAccessor(`${name}-ibm`).setType('MAT4').setArray(ibm).setBuffer(buffer));
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const { joints, weights } = skinWeights(position.getArray() as Float32Array, rig, candidates, skin);
      primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
      primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
    }
    node.setSkin(skinNode);
    attachments.push({ node: name, bone: null, skin, joints: candidates, vertices: vertexCount(node) });
  }

  // Clips: bake every animated bone at the clip's sample times and end.
  const animated = new Set<string>();
  for (const { name, clip, keys } of clips) {
    if (keys.length === 0) continue;
    const times = bakeTimes(clip);
    const poses = times.map((t) => sampleKeys(keys, t, clip));
    const animation = doc.createAnimation(name);
    const input = doc
      .createAccessor(`${name}-times`)
      .setType('SCALAR')
      .setArray(Float32Array.from(times))
      .setBuffer(buffer);
    const interpolation = clip.interpolation === 'step' ? 'STEP' : 'LINEAR';
    for (const bone of animatedBones(keys)) {
      const node = bones.get(bone) as Node;
      const base = restOf(rig, bone);
      const deltas = poses.map((p) => p.get(bone));
      const channel = (path: 'translation' | 'rotation' | 'scale', values: number[]) => {
        const sampler = doc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(
            doc
              .createAccessor(`${name}-${bone}-${path}`)
              .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
              .setArray(Float32Array.from(values))
              .setBuffer(buffer),
          )
          .setInterpolation(interpolation);
        animation
          .addSampler(sampler)
          .addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
      };
      if (deltas.some((d) => d && d.translation.lengthSq() > 1e-18))
        channel(
          'translation',
          deltas.flatMap((d) =>
            base.t
              .clone()
              .add(d?.translation ?? new Vector3())
              .toArray(),
          ),
        );
      if (deltas.some((d) => d && Math.abs(d.rotation.w) < 1 - 1e-12))
        channel(
          'rotation',
          deltas.flatMap((d) =>
            base.r
              .clone()
              .multiply(d?.rotation ?? new Quaternion())
              .toArray(),
          ),
        );
      if (deltas.some((d) => d && d.scale.distanceToSquared(new Vector3(1, 1, 1)) > 1e-18))
        channel(
          'scale',
          deltas.flatMap((d) => (d?.scale ?? new Vector3(1, 1, 1)).toArray()),
        );
      // Rotations outside the bone's declared limits.
      const limits = rig?.bones.find((b) => b.name === bone)?.limits;
      if (limits) {
        let worst: { axis: string; value: number; range: [number, number]; t: number } | null = null;
        deltas.forEach((d, i) => {
          if (!d) return;
          const angles = eulerDegrees(d.rotation);
          (['x', 'y', 'z'] as const).forEach((axis, k) => {
            const range = limits[axis];
            const value = angles[k] as number;
            if (!range) return;
            const excess = Math.max(range[0] - value, value - range[1]);
            if (
              excess > 1e-4 &&
              (!worst || excess > Math.max(worst.range[0] - worst.value, worst.value - worst.range[1]))
            )
              worst = { axis, value, range, t: times[i] as number };
          });
        });
        const w = worst as { axis: string; value: number; range: [number, number]; t: number } | null;
        if (w) {
          warnings.push({
            code: 'W_CLIP_BONE_LIMIT',
            message: `Clip "${name}" turns ${bone} to ${w.axis} = ${Number(w.value.toFixed(1))} degrees at ${Number(w.t.toFixed(3))} s, outside its limits [${w.range[0]}, ${w.range[1]}].`,
            file: asset.sourceFile,
            path: `animation.clips.${name}`,
            assetId: asset.id,
            hint: clip.generator
              ? 'Lower the generator amplitudes, or widen the limits in the rig.'
              : 'Change the key, or widen the limits in the rig.',
          });
        }
      }
    }
    if (animation.listChannels().length === 0) animation.dispose();
    else animated.add(name);
  }

  const glb = await writeGlb(doc);
  const validator = await validateGlb(glb, logger);
  if (validator.errors > 0) {
    throw new Td2dError(
      'E_GENERATION_FAILED',
      `The rigged model failed glTF validation with ${validator.errors} error(s).`,
      {
        details: { messages: validator.messages },
      },
    );
  }
  const world = rig ? boneWorldRest(rig) : new Map<string, Matrix4>();
  return {
    glb,
    report: {
      bones: (rig?.bones ?? []).map((b) => ({
        name: b.name,
        parent: b.parent,
        world: v3(new Vector3().setFromMatrixPosition(world.get(b.name) as Matrix4)),
      })),
      attachments,
      clips: summary(animated),
      validator: { available: validator.available, errors: validator.errors, warnings: validator.warnings },
    },
    warnings,
  };
}

function vertexCount(node: Node): number {
  return (node.getMesh()?.listPrimitives() ?? []).reduce(
    (n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0),
    0,
  );
}
