import type { EasingT, ResolvedBoneT, ResolvedRigT } from '@td2d/schema';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export const DEG = Math.PI / 180;

/** A rotation as written in a pose: Euler degrees (X then Y then Z) or a quaternion [x, y, z, w]. */
export function quaternionFrom(rotation: readonly number[] | undefined): Quaternion {
  if (!rotation) return new Quaternion();
  if (rotation.length === 4) return new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize();
  const [x = 0, y = 0, z = 0] = rotation;
  return new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));
}

/** Euler angles in degrees (X then Y then Z) of a quaternion, each in (-180, 180]. */
export function eulerDegrees(q: Quaternion): [number, number, number] {
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

/** A bone's rest transform relative to its parent. */
export function boneLocalRest(bone: ResolvedBoneT): Matrix4 {
  return new Matrix4().compose(new Vector3(...bone.position), quaternionFrom(bone.rotation), new Vector3(1, 1, 1));
}

/** Rest transforms of every bone in model space, by name. Parents come first in the rig. */
export function boneWorldRest(rig: ResolvedRigT): Map<string, Matrix4> {
  const world = new Map<string, Matrix4>();
  for (const bone of rig.bones) {
    const local = boneLocalRest(bone);
    world.set(bone.name, bone.parent === null ? local : (world.get(bone.parent) as Matrix4).clone().multiply(local));
  }
  return world;
}

/** Easing curves on [0, 1]. step is handled by the sampler, which holds the key. */
export const EASINGS: Readonly<Record<EasingT, (t: number) => number>> = {
  linear: (t) => t,
  step: () => 0,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => 1 - (1 - t) ** 3,
  'ease-in-out-cubic': (t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) ** 3),
  'ease-in-out-sine': (t) => (1 - Math.cos(Math.PI * t)) / 2,
};

/** Round to 6 decimals, so keys written to reports and JSON stay readable and stable. */
export const round6 = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};
