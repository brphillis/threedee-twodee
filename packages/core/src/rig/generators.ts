import type { ClipGeneratorT, ClipKeyT, ResolvedRigT } from '@td2d/schema';
import { round6 } from './math.ts';

/** The bone a generator moves when the asset has no rig: the whole model. */
export const MODEL_ROOT = 'root';

export const WALK_ROLES = [
  'hips',
  'spine',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftUpperArm',
  'rightUpperArm',
] as const;
export type WalkRole = (typeof WALK_ROLES)[number];
/** Roles a walk cannot do without. */
export const REQUIRED_WALK_ROLES: readonly WalkRole[] = ['hips', 'leftUpperLeg', 'rightUpperLeg'];

/** Version of each generator's motion. Bump one when the same settings would give different keys; the rig stage's cache key includes them. */
export const GENERATOR_VERSIONS: Readonly<Record<ClipGeneratorT['type'], number>> = {
  'walk-cycle': 1,
  'idle-breathe': 1,
  bob: 1,
  spin: 1,
  sway: 1,
};

export const WALK_DEFAULTS = { stride: 25, bob: 0.03, armSwing: 20, kneeBend: 30, hipSway: 4, lean: 0 } as const;
export const BREATHE_DEFAULTS = { amount: 2, rise: 0.01 } as const;
export const BOB_DEFAULTS = { height: 0.05 } as const;
export const SPIN_DEFAULTS = { turns: 1, axis: 'y' } as const;
export const SWAY_DEFAULTS = { axis: 'x', amount: 5, bias: 0, lag: 0.12, cycles: 1, growth: 1 } as const;

export interface GeneratorProblem {
  /** Path inside the generator, such as "bones.hips". */
  readonly path: string;
  readonly message: string;
}

/** Bone name for each walk role, from the mapping or the VRM default, when the rig has it. */
export function walkBones(
  rig: ResolvedRigT | null,
  mapping: Partial<Record<WalkRole, string>> = {},
): Partial<Record<WalkRole, string>> {
  const names = new Set(rig?.bones.map((b) => b.name) ?? []);
  const out: Partial<Record<WalkRole, string>> = {};
  for (const role of WALK_ROLES) {
    const name = mapping[role] ?? role;
    if (names.has(name)) out[role] = name;
  }
  return out;
}

/** The bone a single-target generator moves. */
export function targetBone(rig: ResolvedRigT | null, bone: string | undefined): string {
  return bone ?? rig?.bones[0]?.name ?? MODEL_ROOT;
}

function breatheBones(rig: ResolvedRigT | null, gen: Extract<ClipGeneratorT, { type: 'idle-breathe' }>) {
  const names = new Set(rig?.bones.map((b) => b.name) ?? []);
  const chest = gen.bones?.chest ?? (names.has('chest') ? 'chest' : names.has('spine') ? 'spine' : undefined);
  const shoulders = gen.bones?.shoulders ?? ['leftUpperArm', 'rightUpperArm'].filter((n) => names.has(n));
  return { chest, shoulders };
}

/** Problems with a generator on this rig: missing bones and generators that need a rig. */
export function checkGenerator(gen: ClipGeneratorT, rig: ResolvedRigT | null): GeneratorProblem[] {
  const names = new Set(rig?.bones.map((b) => b.name) ?? []);
  const problems: GeneratorProblem[] = [];
  const known = (name: string) => names.has(name) || (rig === null && name === MODEL_ROOT);
  switch (gen.type) {
    case 'walk-cycle': {
      if (!rig)
        return [{ path: 'type', message: 'walk-cycle needs a rig with leg bones. Add "rig": "humanoid-basic"' }];
      for (const [role, name] of Object.entries(gen.bones ?? {})) {
        if (!names.has(name)) problems.push({ path: `bones.${role}`, message: `Bone "${name}" is not in the rig` });
      }
      const found = walkBones(rig, gen.bones);
      for (const role of REQUIRED_WALK_ROLES) {
        if (!found[role] && !gen.bones?.[role]) {
          problems.push({
            path: `bones.${role}`,
            message: `The rig has no "${role}" bone; map the ${role} role to one of its bones`,
          });
        }
      }
      break;
    }
    case 'idle-breathe': {
      if (!rig) return [{ path: 'type', message: 'idle-breathe needs a rig with a chest or spine bone' }];
      const { chest, shoulders } = breatheBones(rig, gen);
      if (!chest)
        problems.push({ path: 'bones.chest', message: 'The rig has no chest or spine bone; set bones.chest' });
      else if (!names.has(chest)) problems.push({ path: 'bones.chest', message: `Bone "${chest}" is not in the rig` });
      shoulders.forEach((s, i) => {
        if (!names.has(s)) problems.push({ path: `bones.shoulders[${i}]`, message: `Bone "${s}" is not in the rig` });
      });
      break;
    }
    case 'bob':
    case 'spin':
      if (gen.bone !== undefined && !known(gen.bone))
        problems.push({ path: 'bone', message: `Bone "${gen.bone}" is not in the rig` });
      break;
    case 'sway':
      gen.bones.forEach((b, i) => {
        if (!known(b)) problems.push({ path: `bones[${i}]`, message: `Bone "${b}" is not in the rig` });
      });
      break;
  }
  return problems;
}

const r3 = (x: number, y: number, z: number): [number, number, number] => [round6(x), round6(y), round6(z)];

/**
 * Keys for a generator, one per sample time, so every rendered frame is exactly the
 * generator's pose. Phase runs from 0 at the start of the clip to 1 at its end.
 */
export function generateKeys(
  gen: ClipGeneratorT,
  rig: ResolvedRigT | null,
  duration: number,
  times: readonly number[],
): ClipKeyT[] {
  const phases = times.map((t) => ({ t, p: t / duration }));
  switch (gen.type) {
    case 'walk-cycle': {
      const o = { ...WALK_DEFAULTS, ...gen };
      const b = walkBones(rig, gen.bones);
      return phases.map(({ t, p }) => {
        const s = Math.sin(2 * Math.PI * p);
        const c = Math.cos(2 * Math.PI * p);
        const pose: ClipKeyT['pose'] = {};
        // Negative X swings a leg forward (+Z). The leg moving forward bends its knee most as it passes under the hips.
        if (b.hips) pose[b.hips] = { translation: r3(0, -o.bob * s * s, 0), rotation: r3(0, -o.hipSway * s, 0) };
        if (b.leftUpperLeg) pose[b.leftUpperLeg] = { rotation: r3(-o.stride * s, 0, 0) };
        if (b.rightUpperLeg) pose[b.rightUpperLeg] = { rotation: r3(o.stride * s, 0, 0) };
        if (b.leftLowerLeg) pose[b.leftLowerLeg] = { rotation: r3(o.kneeBend * Math.max(0, c), 0, 0) };
        if (b.rightLowerLeg) pose[b.rightLowerLeg] = { rotation: r3(o.kneeBend * Math.max(0, -c), 0, 0) };
        if (b.leftUpperArm) pose[b.leftUpperArm] = { rotation: r3(o.armSwing * s, 0, 0) };
        if (b.rightUpperArm) pose[b.rightUpperArm] = { rotation: r3(-o.armSwing * s, 0, 0) };
        if (b.spine) pose[b.spine] = { rotation: r3(o.lean, o.hipSway * s, 0) };
        return { t: round6(t), pose };
      });
    }
    case 'idle-breathe': {
      const o = { ...BREATHE_DEFAULTS, ...gen };
      const { chest, shoulders } = breatheBones(rig, gen);
      return phases.map(({ t, p }) => {
        const breath = (1 - Math.cos(2 * Math.PI * p)) / 2;
        const pose: ClipKeyT['pose'] = {};
        if (chest) pose[chest] = { rotation: r3(-o.amount * breath, 0, 0), translation: r3(0, o.rise * breath, 0) };
        for (const s of shoulders) pose[s] = { translation: r3(0, -0.5 * o.rise * breath, 0) };
        return { t: round6(t), pose };
      });
    }
    case 'bob': {
      const height = gen.height ?? BOB_DEFAULTS.height;
      const bone = targetBone(rig, gen.bone);
      return phases.map(({ t, p }) => ({
        t: round6(t),
        pose: { [bone]: { translation: r3(0, (height * (1 - Math.cos(2 * Math.PI * p))) / 2, 0) } },
      }));
    }
    case 'spin': {
      const turns = gen.turns ?? SPIN_DEFAULTS.turns;
      const axis = gen.axis ?? SPIN_DEFAULTS.axis;
      const bone = targetBone(rig, gen.bone);
      return phases.map(({ t, p }) => {
        const angle = round6((360 * turns * p) % 360);
        const rotation = r3(axis === 'x' ? angle : 0, axis === 'y' ? angle : 0, axis === 'z' ? angle : 0);
        return { t: round6(t), pose: { [bone]: { rotation } } };
      });
    }
    case 'sway': {
      const o = { ...SWAY_DEFAULTS, ...gen };
      return phases.map(({ t, p }) => {
        const pose: ClipKeyT['pose'] = {};
        o.bones.forEach((bone, i) => {
          const angle = o.growth ** i * (o.bias + o.amount * Math.sin(2 * Math.PI * (o.cycles * p - i * o.lag)));
          pose[bone] = {
            rotation: r3(o.axis === 'x' ? angle : 0, o.axis === 'y' ? angle : 0, o.axis === 'z' ? angle : 0),
          };
        });
        return { t: round6(t), pose };
      });
    }
  }
}
