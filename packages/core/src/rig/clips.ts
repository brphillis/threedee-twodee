import type { BonePoseT, ClipKeyT, ResolvedClipT, ResolvedRigT } from '@td2d/schema';
import { type Quaternion, Vector3 } from 'three';
import { generateKeys } from './generators.ts';
import { EASINGS, quaternionFrom } from './math.ts';

/** A bone's pose relative to its rest pose. */
export interface PoseDelta {
  readonly rotation: Quaternion;
  readonly translation: Vector3;
  readonly scale: Vector3;
}

/** The keys a clip plays: its own, or its generator's. Empty for a rest-pose clip. */
export function clipKeys(clip: ResolvedClipT, rig: ResolvedRigT | null): ClipKeyT[] {
  if (clip.keys) return clip.keys;
  if (clip.generator) return generateKeys(clip.generator, rig, clip.duration, clip.times);
  return [];
}

/** Every bone a set of keys moves, in first-seen order. */
export function animatedBones(keys: readonly ClipKeyT[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) for (const bone of Object.keys(key.pose)) seen.add(bone);
  return [...seen];
}

function delta(pose: BonePoseT | undefined): PoseDelta {
  const s = pose?.scale ?? 1;
  return {
    rotation: quaternionFrom(pose?.rotation),
    translation: new Vector3(...(pose?.translation ?? [0, 0, 0])),
    scale: typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s),
  };
}

function blend(a: PoseDelta, b: PoseDelta, u: number): PoseDelta {
  return {
    rotation: a.rotation.clone().slerp(b.rotation, u),
    translation: a.translation.clone().lerp(b.translation, u),
    scale: a.scale.clone().lerp(b.scale, u),
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
