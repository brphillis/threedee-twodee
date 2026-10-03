import { z } from 'zod';
import { Description, Name, SchemaRef, SchemaVersion, Vec3 } from '../primitives.ts';

/** Bone name: VRM camelCase such as "leftUpperArm", or lowercase kebab-case such as "front-left-leg". */
export const BoneName = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(-[a-z0-9]+)*$/, 'Expected a camelCase or kebab-case bone name such as "leftUpperArm"')
  .max(64)
  .meta({ description: 'Bone name. Humanoid rigs use VRM 1.0 names.', examples: ['hips', 'leftUpperArm', 'tail-tip'] });

const Range = z
  .tuple([z.number().min(-360).max(360), z.number().min(-360).max(360)])
  .refine(([min, max]) => min <= max, 'The first value is the minimum and must not exceed the second')
  .meta({ description: 'Allowed range [min, max] in degrees.' });

export const BoneLimits = z.strictObject({ x: Range.optional(), y: Range.optional(), z: Range.optional() }).meta({
  description:
    'Allowed pose rotation per axis, in degrees from the rest pose (Euler X then Y then Z). Clips that go outside get W_CLIP_BONE_LIMIT.',
  examples: [{ x: [-10, 150] }],
});

export const BoneDefinition = z
  .strictObject({
    name: BoneName,
    description: Description.optional(),
    parent: BoneName.nullable()
      .optional()
      .meta({ description: 'Parent bone. null makes this the root. A preset bone keeps its parent when omitted.' }),
    position: Vec3.optional().meta({
      description:
        'Rest position of the joint in metres, relative to the parent joint (or the model origin for the root).',
    }),
    rotation: Vec3.optional().meta({
      description: 'Rest rotation in degrees, Euler X then Y then Z. Default [0, 0, 0].',
    }),
    limits: BoneLimits.optional(),
  })
  .meta({
    description: 'One bone (joint) of a rig.',
    examples: [{ name: 'leftUpperLeg', parent: 'hips', position: [0.1, -0.05, 0] }],
  });

export const RigDefinition = z
  .strictObject({
    preset: Name.optional().meta({
      description: 'Start from a rig preset: humanoid-basic, quadruped-basic, none, or a project preset.',
    }),
    scale: z
      .number()
      .positive()
      .max(100)
      .optional()
      .meta({ description: 'Scale every preset bone position, to fit a smaller or larger character. Default 1.' }),
    bones: z.array(BoneDefinition).max(128).optional().meta({
      description:
        'Bones to add, or to change by name: position, parent, rotation and limits replace the preset values.',
    }),
  })
  .meta({
    description: 'Bone hierarchy for animated assets. Parts attach to bones with their "bone" field.',
    examples: [{ preset: 'humanoid-basic', bones: [{ name: 'hips', position: [0, 0.9, 0] }] }],
  });

export const RigPreset = z
  .strictObject({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
    bones: z
      .array(BoneDefinition)
      .max(128)
      .meta({ description: 'Every bone with its parent, rest position, rotation and limits. Parents come first.' }),
  })
  .meta({
    description: 'A named rig, stored as presets/rig/<name>.json.',
    examples: [
      {
        schemaVersion: '1.0.0',
        name: 'pole',
        bones: [
          { name: 'base', parent: null, position: [0, 0, 0] },
          { name: 'top', parent: 'base', position: [0, 1, 0] },
        ],
      },
    ],
  });

export const SkinningMode = z.enum(['rigid', 'nearest-bone', 'two-bone-blend']).meta({
  description:
    'rigid: the part follows its bone. nearest-bone: each vertex follows the nearest bone. two-bone-blend: each vertex blends the two nearest bones, which bends smoothly at joints.',
});

export const ResolvedBone = z.strictObject({
  name: BoneName,
  parent: BoneName.nullable(),
  position: Vec3,
  rotation: Vec3,
  limits: BoneLimits.nullable(),
});

export const ResolvedRig = z
  .strictObject({
    preset: Name.nullable(),
    bones: z.array(ResolvedBone).meta({ description: 'Bones with parents always listed before their children.' }),
  })
  .meta({ description: 'A rig after the preset, scale and bone overrides are applied.' });

export type BoneDefinitionT = z.infer<typeof BoneDefinition>;
export type RigDefinitionT = z.infer<typeof RigDefinition>;
export type RigPresetT = z.infer<typeof RigPreset>;
export type SkinningModeT = z.infer<typeof SkinningMode>;
export type ResolvedBoneT = z.infer<typeof ResolvedBone>;
export type ResolvedRigT = z.infer<typeof ResolvedRig>;
