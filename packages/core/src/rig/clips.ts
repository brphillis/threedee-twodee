import type { BonePoseT, ClipKeyT, ResolvedClipT, ResolvedRigT } from '@td2d/schema';
import { type Quaternion, Vector3 } from 'three';
import { generateKeys } from './generators.ts';
import { type IkGoal, solveIk } from './ik.ts';
import { EASINGS, eulerDegrees, quaternionFrom, round6 } from './math.ts';

/** A bone's pose relative to its rest pose, with the goal its chain is solved for, if any. */
export interface PoseDelta {
  rotation: Quaternion;
  translation: Vector3;
  scale: Vector3;
  ik?: IkGoal;
}

/** Whether any key asks for inverse kinematics. */
export function hasIk(keys: readonly ClipKeyT[]): boolean {
  return keys.some((k) => Object.values(k.pose).some((p) => p.ik !== undefined));
}

/**
 * The keys a clip plays: its own, or its generator's, empty for a rest-pose clip. With layers or
 * inverse kinematics, one key per sample time: the clip's pose there with each layer's pose
 * composed on top and every chain solved for its goal.
 */
export function clipKeys(clip: ResolvedClipT, rig: ResolvedRigT | null): ClipKeyT[] {
  const keys = clip.keys ?? (clip.generator ? generateKeys(clip.generator, rig, clip.duration, clip.times) : []);
  const solve = rig !== null && hasIk(keys);
  if (!clip.layers?.length && !solve) return keys;
  const layers = (clip.layers ?? []).map((layer) => generateKeys(layer, rig, clip.duration, clip.times));
  return clip.times.map((t, i) => {
    const pose = sampleKeys(keys, t, clip);
    for (const layer of layers) {
      for (const [bone, p] of Object.entries(layer[i]?.pose ?? {})) {
        const d = delta(p);
        const base = pose.get(bone);
        pose.set(
          bone,
          base
            ? {
                rotation: base.rotation.clone().multiply(d.rotation),
                translation: base.translation.clone().add(d.translation),
                scale: base.scale.clone().multiply(d.scale),
                ...(base.ik ? { ik: base.ik } : {}),
              }
            : d,
        );
      }
    }
    if (solve) solveGoals(rig, pose);
    return { t: round6(t), pose: plainPose(pose) };
  });
}

/** A sampled pose as key poses: rotations, and translations and scales where they move. */
function plainPose(pose: ReadonlyMap<string, PoseDelta>): ClipKeyT['pose'] {
  const out: ClipKeyT['pose'] = {};
  for (const [bone, d] of pose) {
    out[bone] = {
      rotation: eulerDegrees(d.rotation).map(round6) as [number, number, number],
      ...(d.translation.lengthSq() > 0 ? { translation: d.translation.toArray().map(round6) as Vec3 } : {}),
      ...(d.scale.equals(ONE) ? {} : { scale: d.scale.toArray().map(round6) as Vec3 }),
    };
  }
  return out;
}

/** Solve the chains of every bone in the pose that carries a goal. */
function solveGoals(rig: ResolvedRigT, pose: Map<string, PoseDelta>): void {
  const goals = new Map<string, IkGoal>();
  for (const [bone, d] of pose) if (d.ik) goals.set(bone, d.ik);
  if (goals.size > 0) solveIk(rig, pose, goals);
}

type Vec3 = [number, number, number];
const ONE = new Vector3(1, 1, 1);

/** Every bone a set of keys moves, in first-seen order. */
export function animatedBones(keys: readonly ClipKeyT[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) for (const bone of Object.keys(key.pose)) seen.add(bone);
  return [...seen];
}

function delta(pose: BonePoseT | undefined): PoseDelta {
  const s = pose?.scale ?? 1;
  const ik = pose?.ik;
  return {
    rotation: quaternionFrom(pose?.rotation),
    translation: new Vector3(...(pose?.translation ?? [0, 0, 0])),
    scale: typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s),
    ...(ik
      ? {
          ik: {
            target: new Vector3(...ik.target),
            pole: ik.pole ? new Vector3(...ik.pole) : null,
            keepOrientation: ik.keepOrientation ?? false,
            weight: 1,
          },
        }
      : {}),
  };
}

/**
 * Between two keys that both set a goal, the goal moves with them. Towards a key without one, the
 * goal keeps its target and fades, so the solved chain eases into that key's own rotations.
 */
function blendGoals(a: IkGoal | undefined, b: IkGoal | undefined, u: number): IkGoal | undefined {
  if (a && b)
    return {
      target: a.target.clone().lerp(b.target, u),
      pole: a.pole && b.pole ? a.pole.clone().lerp(b.pole, u) : (a.pole ?? b.pole),
      keepOrientation: a.keepOrientation || b.keepOrientation,
      weight: a.weight + (b.weight - a.weight) * u,
    };
  if (a) return { ...a, weight: a.weight * (1 - u) };
  if (b) return { ...b, weight: b.weight * u };
  return undefined;
}

function blend(a: PoseDelta, b: PoseDelta, u: number): PoseDelta {
  const ik = blendGoals(a.ik, b.ik, u);
  return {
    rotation: a.rotation.clone().slerp(b.rotation, u),
    translation: a.translation.clone().lerp(b.translation, u),
    scale: a.scale.clone().lerp(b.scale, u),
    ...(ik ? { ik } : {}),
  };
}

/**
 * Pose of every animated bone at time t. Each key is a whole pose: a bone it does not list
 * is at rest at that key. Between keys a bone moves with the earlier key's easing, or holds
 * with step. A looping clip runs from its last key back to its first, which repeats at
 * t + duration; a one-shot clip holds its first and last poses outside the keys.
 */
export function sampleKeys(
  keys: readonly ClipKeyT[],
  t: number,
  clip: Pick<ResolvedClipT, 'duration' | 'loop' | 'interpolation'>,
): Map<string, PoseDelta> {
  const out = new Map<string, PoseDelta>();
  if (keys.length === 0) return out;
  const bones = animatedBones(keys);
  const first = keys[0] as ClipKeyT;
  const last = keys[keys.length - 1] as ClipKeyT;
  let from: ClipKeyT;
  let to: ClipKeyT;
  let span: number;
  let elapsed: number;
  const after = keys.findIndex((k) => k.t > t + 1e-9);
  if (after === 0) {
    if (!clip.loop) {
      for (const bone of bones) out.set(bone, delta(first.pose[bone]));
      return out;
    }
    from = last;
    to = first;
    span = first.t + clip.duration - last.t;
    elapsed = t + clip.duration - last.t;
  } else if (after === -1) {
    if (!clip.loop || keys.length === 1) {
      for (const bone of bones) out.set(bone, delta(last.pose[bone]));
      return out;
    }
    from = last;
    to = first;
    span = first.t + clip.duration - last.t;
    elapsed = t - last.t;
  } else {
    from = keys[after - 1] as ClipKeyT;
    to = keys[after] as ClipKeyT;
    span = to.t - from.t;
    elapsed = t - from.t;
  }
  const easing = clip.interpolation === 'step' ? 'step' : (from.easing ?? 'linear');
  const u = easing === 'step' || span <= 1e-9 ? 0 : EASINGS[easing](Math.min(1, Math.max(0, elapsed / span)));
  for (const bone of bones) out.set(bone, blend(delta(from.pose[bone]), delta(to.pose[bone]), u));
  return out;
}

/**
 * Times to bake into the glTF animation: every sample time, plus the clip's end so a
 * looping clip closes on its first pose and a one-shot clip reaches its last.
 */
export function bakeTimes(clip: Pick<ResolvedClipT, 'times' | 'duration'>): number[] {
  const times = [...new Set([...clip.times, clip.duration].map((t) => Math.round(t * 1e9) / 1e9))].sort(
    (a, b) => a - b,
  );
  return times;
}
