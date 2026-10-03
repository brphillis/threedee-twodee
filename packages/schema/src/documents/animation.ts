import { z } from 'zod';
import { ClipName, Description, PositiveVec3, Vec3 } from '../primitives.ts';
import { BoneName } from './rig.ts';

export const Easing = z
  .enum([
    'linear',
    'step',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'ease-in-cubic',
    'ease-out-cubic',
    'ease-in-out-cubic',
    'ease-in-out-sine',
  ])
  .meta({
    description:
      'How a key moves towards the next key. step holds the pose until the next key; the ease curves are quadratic unless named cubic or sine.',
  });

export const Interpolation = z.enum(['linear', 'step']).meta({
  description: 'linear eases between keys. step holds each key pose until the next key, like hand-drawn key frames.',
});

const Quaternion = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((q) => Math.hypot(...q) > 1e-6, 'A quaternion cannot be all zeros')
  .meta({ description: 'Quaternion [x, y, z, w]; normalised before use.' });

export const BonePose = z
  .strictObject({
    rotation: z.union([Vec3, Quaternion]).optional().meta({
      description:
        'Rotation from the rest pose: [x, y, z] degrees (Euler X then Y then Z) or a quaternion [x, y, z, w].',
    }),
    translation: Vec3.optional().meta({
      description: 'Offset from the rest position in metres, in the parent bone frame.',
    }),
    scale: z
      .union([z.number().positive(), PositiveVec3])
      .optional()
      .meta({ description: 'Scale relative to the rest pose.' }),
  })
  .meta({ description: 'Pose of one bone in a key. Missing fields hold the rest pose.' });

const ModelTarget = 'Bone to move. Default: the rig root, or the whole model when the asset has no rig.';

export const ClipKey = z
  .strictObject({
    t: z.number().min(0).max(60).meta({ description: 'Key time in seconds from the start of the clip.' }),
    pose: z
      .record(BoneName, BonePose)
      .meta({ description: 'Poses by bone name. Bones not listed hold the rest pose.' }),
    easing: Easing.optional().meta({ description: 'How this key moves to the next. Default linear.' }),
  })
  .meta({
    description: 'A pose at a time.',
    examples: [{ t: 0.5, pose: { spine: { rotation: [4, 0, 0] } }, easing: 'ease-in-out' }],
  });

export const WalkCycleGenerator = z
  .strictObject({
    type: z.literal('walk-cycle'),
    stride: z
      .number()
      .min(0)
      .max(90)
      .optional()
      .meta({ description: 'Leg swing either side of vertical, in degrees. Default 25.' }),
    bob: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: 'How far the hips drop when the legs are furthest apart, in metres. Default 0.03.' }),
    armSwing: z
      .number()
      .min(0)
      .max(90)
      .optional()
      .meta({ description: 'Arm swing, opposite to the legs, in degrees. Default 20.' }),
    kneeBend: z
      .number()
      .min(0)
      .max(150)
      .optional()
      .meta({ description: 'Knee bend of the swinging leg, in degrees. Default 30.' }),
    hipSway: z
      .number()
      .min(0)
      .max(45)
      .optional()
      .meta({ description: 'Hip twist towards the forward leg, in degrees. Default 4.' }),
    lean: z
      .number()
      .min(-45)
      .max(45)
      .optional()
      .meta({ description: 'Forward lean of the spine, in degrees. Default 0.' }),
    bones: z
      .strictObject({
        hips: BoneName.optional(),
        spine: BoneName.optional(),
        leftUpperLeg: BoneName.optional(),
        rightUpperLeg: BoneName.optional(),
        leftLowerLeg: BoneName.optional(),
        rightLowerLeg: BoneName.optional(),
        leftFoot: BoneName.optional(),
        rightFoot: BoneName.optional(),
        leftUpperArm: BoneName.optional(),
        rightUpperArm: BoneName.optional(),
      })
      .optional()
      .meta({
        description:
          'Bone for each role, for rigs without VRM names. Roles default to the VRM name; missing arm, spine and foot bones are skipped.',
      }),
  })
  .meta({
    description:
      'A looping walk: legs swing with knees bending on the way forward, arms counter-swing, hips drop and twist.',
    examples: [{ type: 'walk-cycle', stride: 25, bob: 0.05 }],
  });

export const IdleBreatheGenerator = z
  .strictObject({
    type: z.literal('idle-breathe'),
    amount: z
      .number()
      .min(0)
      .max(30)
      .optional()
      .meta({ description: 'Chest tilt at the top of the breath, in degrees. Default 2.' }),
    rise: z
      .number()
      .min(0)
      .max(0.5)
      .optional()
      .meta({ description: 'How far the chest lifts, in metres. Default 0.01.' }),
    bones: z
      .strictObject({ chest: BoneName.optional(), shoulders: z.array(BoneName).optional() })
      .optional()
      .meta({
        description:
          'chest defaults to chest, then spine. shoulders (default the upper arms) settle as the chest rises.',
      }),
  })
  .meta({ description: 'A slow breath in and out over the clip.', examples: [{ type: 'idle-breathe', amount: 3 }] });

export const BobGenerator = z
  .strictObject({
    type: z.literal('bob'),
    height: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .meta({ description: 'Rise at the middle of the clip, in metres. Default 0.05.' }),
    bone: BoneName.optional().meta({ description: ModelTarget }),
  })
  .meta({ description: 'Rise and fall once per clip, easing in and out.', examples: [{ type: 'bob', height: 0.08 }] });

export const SpinGenerator = z
  .strictObject({
    type: z.literal('spin'),
    turns: z
      .number()
      .min(-16)
      .max(16)
      .optional()
      .meta({ description: 'Full turns over the clip; negative turns the other way. Default 1.' }),
    axis: z.enum(['x', 'y', 'z']).optional().meta({ description: 'Axis to turn about. Default y.' }),
    bone: BoneName.optional().meta({ description: ModelTarget }),
  })
  .meta({ description: 'Turn at a constant rate.', examples: [{ type: 'spin', turns: 1, axis: 'y' }] });

export const SwayGenerator = z
  .strictObject({
    type: z.literal('sway'),
    bones: z
      .array(BoneName)
      .min(1)
      .max(16)
      .meta({ description: 'A chain of bones from root to tip, such as the segments of a cape or a tail.' }),
    axis: z.enum(['x', 'y', 'z']).optional().meta({ description: 'Axis each bone turns about. Default x.' }),
    amount: z
      .number()
      .min(0)
      .max(90)
      .optional()
      .meta({ description: 'Swing either side of the bias, in degrees. Default 5.' }),
    bias: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .meta({ description: 'A constant turn the swing centres on, such as a cape blown back. Default 0.' }),
    lag: z.number().min(0).max(1).optional().meta({
      description:
        'How far each bone trails the one before it, in cycles, so the wave travels down the chain. Default 0.12.',
    }),
    cycles: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .meta({ description: 'Whole swings per clip, so a looping clip joins up. Default 1.' }),
    growth: z.number().min(0.25).max(4).optional().meta({
      description:
        'Each bone turns this many times as far as the one before it; above 1 the tip moves most. Default 1.',
    }),
  })
  .meta({
    description: 'A wave travelling down a chain of bones, for capes, banners, tails and plumes.',
    examples: [{ type: 'sway', bones: ['spine', 'chest', 'neck', 'head'], axis: 'z', amount: 3 }],
  });

export const ClipGenerator = z
  .discriminatedUnion('type', [WalkCycleGenerator, IdleBreatheGenerator, BobGenerator, SpinGenerator, SwayGenerator])
  .meta({
    description: 'Procedural clip. td2d turns it into keys; `td2d model inspect <id> --clip <name> --keys` shows them.',
  });

export const GENERATOR_TYPES = ['walk-cycle', 'idle-breathe', 'bob', 'spin', 'sway'] as const;

export const ClipDefinition = z
  .strictObject({
    description: Description.optional(),
    duration: z.number().positive().max(60).meta({ description: 'Clip length in seconds.' }),
    loop: z
      .boolean()
      .optional()
      .meta({ description: 'Looping clips omit the final frame so playback is seamless. Default true.' }),
    fps: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .meta({ description: 'Overrides the asset frame rate for this clip.' }),
    motion: z.boolean().optional().meta({
      description:
        'The model moves across the frame on purpose (a dash or a jump), so the jitter check skips this clip.',
    }),
    keys: z
      .array(ClipKey)
      .min(1)
      .max(256)
      .optional()
      .meta({ description: 'Pose keys. Use keys or generator, not both.' }),
    generator: ClipGenerator.optional(),
    layers: z.array(ClipGenerator).min(1).max(8).optional().meta({
      description:
        "Generators layered over the clip's keys or generator, such as a sway on a cape over a walk. At every frame their rotations turn the pose further and their translations add to it.",
    }),
    interpolation: Interpolation.optional().meta({ description: 'Default linear.' }),
    sampleTimes: z
      .array(z.number().min(0).max(60))
      .min(1)
      .max(256)
      .optional()
      .meta({ description: 'Render exactly these times in seconds instead of evenly spaced frames.' }),
  })
  .refine((c) => !(c.keys && c.generator), { message: 'Use keys or generator, not both', path: ['generator'] })
  .meta({
    description: 'Animation clip. Without keys or a generator it renders the rest pose.',
    examples: [
      { duration: 0.6, loop: true },
      { duration: 0.8, generator: { type: 'walk-cycle', stride: 25 } },
      {
        duration: 1,
        keys: [
          { t: 0, pose: {} },
          { t: 0.5, pose: { spine: { rotation: [3, 0, 0] } }, easing: 'ease-in-out' },
        ],
      },
    ],
  });

export const AnimationDefinition = z
  .strictObject({
    fps: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .meta({ description: 'Sampling rate in frames per second. Default 10.' }),
    clips: z.record(ClipName, ClipDefinition).meta({ description: 'Clips keyed by clip name.' }),
  })
  .meta({ description: 'Animation clips and sampling rate.' });

export type EasingT = z.infer<typeof Easing>;
export type InterpolationT = z.infer<typeof Interpolation>;
export type BonePoseT = z.infer<typeof BonePose>;
export type ClipKeyT = z.infer<typeof ClipKey>;
export type ClipGeneratorT = z.infer<typeof ClipGenerator>;
export type WalkCycleGeneratorT = z.infer<typeof WalkCycleGenerator>;
export type ClipDefinitionT = z.infer<typeof ClipDefinition>;
export type AnimationDefinitionT = z.infer<typeof AnimationDefinition>;
