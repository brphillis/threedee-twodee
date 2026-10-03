// The karateka's clips, written with the td2d SDK. `td2d asset emit scripts/karateka.ts` writes
// assets/fighters/karateka/asset.json, which is what td2d actually generates from.
//
// Every clip is a few poses with easing between them, posed at every frame. Planted feet are
// solved with two-bone IK in the side (Y-Z) plane, so they stay on the floor however the hips
// move; a foot that leaves the floor is posed by its joint angles instead.
import { component, defineAsset } from '@td2d/core/sdk';

const FPS = 16;
const THIGH = 0.42; // hip to knee on humanoid-basic
const SHIN = 0.4; // knee to ankle
const HIP_Y = 0.9; // rest height of the hip joints
const ANKLE_Y = 0.08; // rest height of the ankles
const TWIST = -10; // the camera already turns him three quarters to the viewer; the chest leads a little more
const DEG = 180 / Math.PI;

type Vec3 = [number, number, number];
/** A planted foot (ankle height and Z), or a lifted leg's thigh, knee and foot angles. */
type Leg = { ik: [number, number] } | { fk: Vec3 };
interface Pose {
  hy: number;
  hz: number;
  lead: Leg;
  rear: Leg;
  spine: Vec3;
  chest: Vec3;
  head: Vec3;
  lUA: Vec3;
  lLA: Vec3;
  rUA: Vec3;
  rLA: Vec3;
}
type Easing = (u: number) => number;
const linear: Easing = (u) => u;
const easeOut: Easing = (u) => 1 - (1 - u) ** 2;
const easeIn: Easing = (u) => u * u;
const easeInOut: Easing = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);

function stance(over: Partial<Pose> = {}): Pose {
  return {
    hy: -0.12,
    hz: 0,
    lead: { ik: [ANKLE_Y, 0.3] },
    rear: { ik: [ANKLE_Y, -0.32] },
    spine: [8, TWIST * 0.4, 0],
    chest: [4, TWIST * 0.6, 0],
    head: [-8, -TWIST * 0.45, 0],
    lUA: [-55, 0, 14],
    lLA: [-100, 0, 0],
    rUA: [-32, 0, -14],
    rLA: [-128, 0, 0],
    ...over,
  };
}

/** Thigh, knee and foot angles in degrees that put the ankle on its target, knee forward. */
function solveLeg(hip: [number, number], ankle: [number, number]): Vec3 {
  const dy = ankle[0] - hip[0];
  const dz = ankle[1] - hip[1];
  const d = Math.min(Math.hypot(dy, dz), THIGH + SHIN - 1e-6);
  const theta = Math.atan2(-dz, -dy);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
  const a = theta - alpha;
  const ky = hip[0] - THIGH * Math.cos(a);
  const kz = hip[1] - THIGH * Math.sin(a);
  const s = Math.atan2(-(ankle[1] - kz), -(ankle[0] - ky));
  return [a * DEG, (s - a) * DEG, -s * DEG];
}

const legAngles = (leg: Leg, p: Pose): Vec3 => ('fk' in leg ? leg.fk : solveLeg([HIP_Y + p.hy, p.hz], leg.ik));
const mix = (a: number, b: number, u: number) => a + (b - a) * u;
const mix3 = (a: Vec3, b: Vec3, u: number): Vec3 => [mix(a[0], b[0], u), mix(a[1], b[1], u), mix(a[2], b[2], u)];

function mixLeg(a: Leg, pa: Pose, b: Leg, pb: Pose, u: number): Leg {
  if ('ik' in a && 'ik' in b) return { ik: [mix(a.ik[0], b.ik[0], u), mix(a.ik[1], b.ik[1], u)] };
  // Blend joint angles when either end lifts the foot.
  return { fk: mix3(legAngles(a, pa), legAngles(b, pb), u) };
}

function mixPose(a: Pose, b: Pose, u: number): Pose {
  return {
    hy: mix(a.hy, b.hy, u),
    hz: mix(a.hz, b.hz, u),
    lead: mixLeg(a.lead, a, b.lead, b, u),
    rear: mixLeg(a.rear, a, b.rear, b, u),
    spine: mix3(a.spine, b.spine, u),
    chest: mix3(a.chest, b.chest, u),
    head: mix3(a.head, b.head, u),
    lUA: mix3(a.lUA, b.lUA, u),
    lLA: mix3(a.lLA, b.lLA, u),
    rUA: mix3(a.rUA, b.rUA, u),
    rLA: mix3(a.rLA, b.rLA, u),
  };
}

/** The pose at time t between [time, pose, easing to the next] keys. */
function at(keys: [number, Pose, Easing][], t: number): Pose {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0, ease] = keys[i] as [number, Pose, Easing];
    const [t1, p1] = keys[i + 1] as [number, Pose, Easing];
    if (t >= t0 - 1e-9 && t <= t1 + 1e-9) return mixPose(p0, p1, ease((t - t0) / (t1 - t0)));
  }
  return (keys[keys.length - 1] as [number, Pose, Easing])[1];
}

const r = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1000) / 1000 + 0) as Vec3;
const flat = (a: number): Vec3 => [Math.max(-45, Math.min(45, a)), 0, 0];

function bones(p: Pose) {
  const lead = legAngles(p.lead, p);
  const rear = legAngles(p.rear, p);
  return {
    hips: { translation: r([0, p.hy, p.hz]) },
    spine: { rotation: r(p.spine) },
    chest: { rotation: r(p.chest) },
    neck: { rotation: [0, 0, 0] as Vec3 },
    head: { rotation: r(p.head) },
    leftUpperArm: { rotation: r(p.lUA) },
    leftLowerArm: { rotation: r(p.lLA) },
    rightUpperArm: { rotation: r(p.rUA) },
    rightLowerArm: { rotation: r(p.rLA) },
    leftUpperLeg: { rotation: r([lead[0], 0, 0]) },
    leftLowerLeg: { rotation: r([lead[1], 0, 0]) },
    leftFoot: { rotation: r(flat(lead[2])) },
    rightUpperLeg: { rotation: r([rear[0], 0, 0]) },
    rightLowerLeg: { rotation: r([rear[1], 0, 0]) },
    rightFoot: { rotation: r(flat(rear[2])) },
  };
}

/** One key per frame: a looping clip leaves out its end, a one-shot clip renders it. */
function perFrame(duration: number, loop: boolean, pose: (t: number) => Pose) {
  const n = Math.round(duration * FPS) + (loop ? 0 : 1);
  return Array.from({ length: n }, (_, i) => ({ t: Math.round((i / FPS) * 1e6) / 1e6, pose: bones(pose(i / FPS)) }));
}

const wave = (phase: number) => Math.sin(2 * Math.PI * phase);

function idle(phase: number): Pose {
  const b = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return stance({
    hy: -0.12 - 0.025 * b,
    chest: [4 + 3 * b, TWIST * 0.6, 0],
    head: [-8 - 2 * b, -TWIST * 0.45, 0],
    lUA: [-55 + 4 * b, 0, 14],
    rUA: [-32 + 4 * b, 0, -14],
  });
}

function walk(phase: number): Pose {
  const s = wave(phase);
  const c = Math.cos(2 * Math.PI * phase);
  return stance({
    hy: -0.12 + 0.012 * Math.cos(4 * Math.PI * phase),
    hz: 0.02 * s,
    lead: { ik: [ANKLE_Y + 0.06 * Math.max(0, c), 0.3 + 0.1 * s] },
    rear: { ik: [ANKLE_Y + 0.06 * Math.max(0, -c), -0.32 - 0.1 * s] },
    chest: [4, TWIST * 0.6 + 4 * s, 0],
    lUA: [-55 - 4 * s, 0, 14],
    rUA: [-32 + 4 * s, 0, -14],
  });
}

const struck: Partial<Pose> = {
  hy: -0.14,
  hz: 0.07,
  spine: [12, -12, 0],
  chest: [6, -16, 0],
  head: [-8, 14, 0],
  lUA: [-88, 0, -4],
  lLA: [-4, 0, 0],
  rUA: [-40, 0, -18],
  rLA: [-132, 0, 0],
};
const punch: [number, Pose, Easing][] = [
  [0, stance(), easeOut],
  [1 / 12, stance({ hz: -0.02, chest: [2, TWIST * 0.6 + 4, 0], lUA: [-45, 0, 14], lLA: [-115, 0, 0] }), easeIn],
  [2 / 12, stance(struck), linear],
  [3 / 12, stance(struck), easeInOut],
  [0.5, stance(), linear],
];

const chamber: Partial<Pose> = {
  hy: -0.06,
  hz: 0.12,
  rear: { fk: [-100, 115, 35] },
  spine: [-4, 0, 0],
  chest: [0, 0, 0],
  head: [0, 0, 0],
  lUA: [-45, 0, 30],
  rUA: [-20, 0, -35],
  rLA: [-120, 0, 0],
};
const extended: Partial<Pose> = {
  ...chamber,
  rear: { fk: [-118, 6, 40] },
  spine: [-16, 0, 0],
  head: [12, 0, 0],
  hy: -0.05,
  hz: 0.16,
};
const kick: [number, Pose, Easing][] = [
  [0, stance(), easeOut],
  [2 / 12, stance(chamber), easeOut],
  [4 / 12, stance(extended), linear],
  [5 / 12, stance(extended), easeInOut],
  [7 / 12, stance(chamber), easeInOut],
  [0.75, stance(), linear],
];

const gather: Partial<Pose> = {
  hy: -0.2,
  hz: -0.05,
  spine: [14, -10, 0],
  chest: [6, -20, 0],
  head: [-10, 24, 0],
  lUA: [12, 0, -30],
  lLA: [-100, 0, 0],
  rUA: [28, 0, -6],
  rLA: [-85, 0, 0],
};
const thrust: Partial<Pose> = {
  hy: -0.18,
  hz: 0.12,
  spine: [12, 4, 0],
  chest: [4, 6, 0],
  head: [-10, -8, 0],
  lUA: [-86, 0, -10],
  lLA: [-6, 0, 0],
  rUA: [-86, 0, 10],
  rLA: [-6, 0, 0],
};
const special: [number, Pose, Easing][] = [
  [0, stance(), easeInOut],
  [3 / 12, stance(gather), easeIn],
  [4 / 12, stance(thrust), linear],
  [7 / 12, stance(thrust), easeInOut],
  [0.75, stance(), linear],
];

// The headband and belt tails ride their own bones and flutter on sway layers.
const band = ['headband-1', 'headband-2'];
const belt = ['belt-1', 'belt-2'];
const flutter = (amount: number, bias: number, cycles: number) => [
  { type: 'sway' as const, bones: band, amount, bias, cycles, lag: 0.2, growth: 1.3 },
  { type: 'sway' as const, bones: belt, amount: amount * 0.7, cycles, lag: 0.25, growth: 1.3 },
];

export default defineAsset({
  id: 'fighters/karateka',
  type: 'character',
  description:
    'A martial artist for a side-on fighting game: spiky hair, a red headband, a white gi and a black belt. Stance, walk, punch, kick and an energy-blast special. Generated by scripts/karateka.ts.',
  model: {
    parts: [
      component(
        'fighter',
        'fighter',
        {},
        { description: 'The body, from components/fighter.json; the clips below pose its bones.' },
      ),
    ],
  },
  animation: {
    fps: FPS,
    clips: {
      idle: {
        description: 'A bouncing fighting stance, guard up; the headband tails flutter.',
        duration: 0.5,
        keys: perFrame(0.5, true, (t) => idle(t / 0.5)),
        layers: [...flutter(8, 0, 1), { type: 'sway', bones: band, axis: 'y', amount: 6, cycles: 2, lag: 0.25 }],
      },
      walk: {
        description: 'Walking forward in stance: the feet slide in turn, the guard stays up.',
        duration: 0.75,
        keys: perFrame(0.75, true, (t) => walk(t / 0.75)),
        layers: flutter(10, 6, 2),
      },
      punch: {
        description: 'A lead jab: the hips drive forward, the chest opens and the front fist snaps out.',
        duration: 0.5,
        loop: false,
        motion: true,
        keys: perFrame(0.5, false, (t) => at(punch, t)),
        layers: flutter(14, 8, 1),
      },
      kick: {
        description: 'A high front kick off the rear leg: chamber, snap out, chamber, set down.',
        duration: 0.75,
        loop: false,
        motion: true,
        keys: perFrame(0.75, false, (t) => at(kick, t)),
        layers: flutter(16, 10, 1),
      },
      special: {
        description: 'Gather energy at the hip, then thrust both palms forward to launch effects/energy-ball.',
        duration: 0.75,
        loop: false,
        motion: true,
        keys: perFrame(0.75, false, (t) => at(special, t)),
        layers: flutter(18, 12, 1),
      },
    },
  },
  acceptance: { requiredClips: ['idle', 'walk', 'punch', 'kick', 'special'] },
});
