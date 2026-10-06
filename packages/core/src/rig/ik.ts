import type { ResolvedRigT } from '@td2d/schema';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { boneWorldRest, quaternionFrom } from './math.ts';

/** Version of the solver. Bump when the same goals would give different rotations; the rig stage's cache key includes it. */
export const IK_VERSION = 1;

/** A bone's pose relative to its rest pose, as the solver reads and writes it. */
export interface IkPose {
  rotation: Quaternion;
  translation: Vector3;
  scale: Vector3;
}

/** Where a bone's joint should be, solved by turning the two bones above it. */
export interface IkGoal {
  readonly target: Vector3;
  /** Direction the middle joint bends towards, or null for the default from the middle bone's limits. */
  readonly pole: Vector3 | null;
  readonly keepOrientation: boolean;
  /** How far the chain follows the goal, from 0 (its keyed rotations) to 1 (solved). */
  readonly weight: number;
}

/** The three bones of a two-bone chain ending at `bone`, or null when it has fewer than two bones above it. */
export function ikChain(rig: ResolvedRigT, bone: string): { end: string; mid: string; root: string } | null {
  const end = rig.bones.find((b) => b.name === bone);
  const mid = end?.parent ? rig.bones.find((b) => b.name === end.parent) : undefined;
  const root = mid?.parent ? rig.bones.find((b) => b.name === mid.parent) : undefined;
  return end && mid && root ? { end: end.name, mid: mid.name, root: root.name } : null;
}

/**
 * The side a middle joint bends towards when a goal gives no pole: the side its X limits allow.
 * A lower leg's limits are positive (the knee goes forwards, +Z) and a lower arm's negative (the
 * elbow goes back, -Z). Without limits the joint bends forwards.
 */
export function defaultPole(rig: ResolvedRigT, mid: string): Vector3 {
  const limits = rig.bones.find((b) => b.name === mid)?.limits?.x;
  return new Vector3(0, 0, limits && limits[0] + limits[1] < 0 ? -1 : 1);
}

/** Model-space transforms of every bone under a pose. */
export function posedBoneWorld(rig: ResolvedRigT, pose: ReadonlyMap<string, IkPose>): Map<string, Matrix4> {
  const world = new Map<string, Matrix4>();
  for (const bone of rig.bones) {
    const d = pose.get(bone.name);
    const local = new Matrix4().compose(
      new Vector3(...bone.position).add(d?.translation ?? ZERO),
      quaternionFrom(bone.rotation).multiply(d?.rotation ?? IDENTITY),
      d?.scale ?? ONE,
    );
    world.set(bone.name, bone.parent === null ? local : (world.get(bone.parent) as Matrix4).clone().multiply(local));
  }
  return world;
}

const ZERO = new Vector3();
const ONE = new Vector3(1, 1, 1);
const IDENTITY = new Quaternion();
const rotationOf = (m: Matrix4) => new Quaternion().setFromRotationMatrix(m);
const positionOf = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

/**
 * Solve every goal, parents' chains first, writing the root and middle bones' rotations into the
 * pose (and the end bone's when it keeps its orientation). The chain is posed by the rest of the
 * pose first, so a goal in model space holds while the hips move. Each bone turns the least it
 * can from its rest direction, so a leg bending in a plane turns about one axis as a hand-made
 * key would. A target out of reach is brought to the nearest point the straight chain can reach.
 * A goal with a weight below 1 turns each bone only that far from its keyed rotation.
 */
export function solveIk(rig: ResolvedRigT, pose: Map<string, IkPose>, goals: ReadonlyMap<string, IkGoal>): void {
  const rest = boneWorldRest(rig);
  const order = rig.bones.map((b) => b.name).filter((name) => goals.has(name));
  for (const name of order) {
    const chain = ikChain(rig, name);
    const goal = goals.get(name) as IkGoal;
    if (!chain) continue;
    const bones = Object.fromEntries(rig.bones.map((b) => [b.name, b])) as Record<
      string,
      ResolvedRigT['bones'][number]
    >;
    const root = bones[chain.root] as ResolvedRigT['bones'][number];
    const mid = bones[chain.mid] as ResolvedRigT['bones'][number];
    const end = bones[chain.end] as ResolvedRigT['bones'][number];
    const world = posedBoneWorld(rig, pose);
    const parentWorld = root.parent ? (world.get(root.parent) as Matrix4) : new Matrix4();
    const parentRotation = rotationOf(parentWorld);
    const origin = positionOf(world.get(chain.root) as Matrix4);

    const rootRestWorld = parentRotation.clone().multiply(quaternionFrom(root.rotation));
    const midOffset = new Vector3(...mid.position);
    const endOffset = new Vector3(...end.position);
    const l1 = midOffset.length();
    const l2 = endOffset.length();
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const firstRest = midOffset.clone().normalize().applyQuaternion(rootRestWorld);

    const toTarget = goal.target.clone().sub(origin);
    const reach = Math.min(Math.max(toTarget.length(), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
    const direction = toTarget.length() < 1e-9 ? firstRest.clone() : toTarget.clone().normalize();
    const pole = (goal.pole ?? defaultPole(rig, chain.mid)).clone().normalize();
    let bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < 1e-12) {
      // The pole lies along the chain: bend wherever the rest direction already leans, or sideways.
      bend = firstRest.clone().addScaledVector(direction, -firstRest.dot(direction));
      if (bend.lengthSq() < 1e-12) bend = new Vector3(0, 0, 1).addScaledVector(direction, -direction.z);
      if (bend.lengthSq() < 1e-12) bend = new Vector3(1, 0, 0);
    }
    bend.normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const first = direction.clone().multiplyScalar(cosA).addScaledVector(bend, sinA).normalize();
    const knee = origin.clone().addScaledVector(first, l1);
    const second = origin.clone().addScaledVector(direction, reach).sub(knee).normalize();

    const weight = Math.min(1, Math.max(0, goal.weight));
    const rootWorld = new Quaternion().setFromUnitVectors(firstRest, first).multiply(rootRestWorld);
    const rootLocal = parentRotation.clone().invert().multiply(rootWorld);
    setRotation(pose, chain.root, quaternionFrom(root.rotation).invert().multiply(rootLocal), weight);

    const midRestWorld = rootWorld.clone().multiply(quaternionFrom(mid.rotation));
    const secondRest = endOffset.clone().normalize().applyQuaternion(midRestWorld);
    const midWorld = new Quaternion().setFromUnitVectors(secondRest, second).multiply(midRestWorld);
    const midLocal = rootWorld.clone().invert().multiply(midWorld);
    setRotation(pose, chain.mid, quaternionFrom(mid.rotation).invert().multiply(midLocal), weight);

    if (goal.keepOrientation) {
      // The bone's keyed rotation is its own, applied over its rest orientation in model space.
      const own = pose.get(chain.end)?.rotation ?? IDENTITY;
      const endWorld = rotationOf(rest.get(chain.end) as Matrix4).multiply(own);
      const endLocal = midWorld.clone().invert().multiply(endWorld);
      setRotation(pose, chain.end, quaternionFrom(end.rotation).invert().multiply(endLocal), weight);
    }
  }
}

/** Turn a bone to `rotation`, or part of the way there from its keyed rotation when the weight is below 1. */
function setRotation(pose: Map<string, IkPose>, bone: string, rotation: Quaternion, weight: number): void {
  const existing = pose.get(bone);
  const from = existing?.rotation ?? IDENTITY;
  const to = weight >= 1 ? rotation.normalize() : from.clone().slerp(rotation.normalize(), weight);
  if (existing) existing.rotation = to;
  else pose.set(bone, { rotation: to, translation: new Vector3(), scale: new Vector3(1, 1, 1) });
}
