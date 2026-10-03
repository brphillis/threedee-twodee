import { z } from 'zod';
import { Description, Name, PositiveVec3, SchemaRef, SchemaVersion, Vec3 } from '../primitives.ts';
import { ColorValue, MaterialDefinition } from './material.ts';
import { BoneName, SkinningMode } from './rig.ts';

const Point2 = z.tuple([z.number(), z.number()]);

export const Axis = z.enum(['x', 'y', 'z']);

const NonZero = z.number().refine((n) => n !== 0, 'Scale cannot be 0');

export const RepeatSpec = z
  .strictObject({
    count: z.number().int().min(2).max(256).meta({ description: 'Number of copies, including the original.' }),
    offset: Vec3.optional().meta({
      description: 'Translation added for each copy, in the parent frame. Default [0, 0, 0].',
    }),
    rotation: Vec3.optional().meta({
      description: 'Rotation in degrees added for each copy, about the parent origin. Default [0, 0, 0].',
    }),
  })
  .meta({
    description: 'Array the part: copy i is moved by i x offset and turned by i x rotation.',
    examples: [{ count: 4, offset: [0.5, 0, 0] }],
  });

export const PartMirror = z.union([Axis, z.array(Axis).min(1).max(3)]).meta({
  description: 'Add a mirrored copy across the parent plane through the origin, for each axis listed.',
  examples: ['x', ['x', 'z']],
});

const Base = {
  id: Name.meta({ description: 'Part id, unique within the asset.' }),
  description: Description.optional(),
  position: Vec3.optional().meta({
    description: 'Where the pivot goes, in metres in the parent frame. Default [0, 0, 0].',
  }),
  rotation: Vec3.optional().meta({
    description: 'Euler rotation in degrees about the pivot, applied X then Y then Z. Default [0, 0, 0].',
  }),
  scale: z
    .union([NonZero, z.tuple([NonZero, NonZero, NonZero])])
    .optional()
    .meta({ description: 'Uniform or per-axis scale about the pivot. Negative values mirror. Default 1.' }),
  pivot: Vec3.optional().meta({
    description:
      "Point in the part's own frame that rotation and scale act around and that lands on position. Default [0, 0, 0], the part centre.",
  }),
  visible: z.boolean().optional().meta({ description: 'Hidden parts are skipped. Default true.' }),
  bone: BoneName.optional().meta({
    description:
      'Rig bone this part follows. Children of groups and components inherit it. A copy made by mirroring across x swaps left and right in the name.',
  }),
  skin: SkinningMode.optional().meta({
    description: 'How the part follows the rig. Default rigid, which needs bone. Inherited like bone.',
  }),
  skinBones: z.array(BoneName).min(2).max(16).optional().meta({
    description: 'For nearest-bone and two-bone-blend: only these bones may move the part. Default every bone.',
  }),
  repeat: RepeatSpec.optional(),
  mirror: PartMirror.optional(),
};

const Leaf = {
  ...Base,
  material: Name.meta({ description: 'Material name from the asset (or project, or component) materials.' }),
  color: ColorValue.optional().meta({
    description: 'Colour for this part only, overriding the material colour but keeping its shading.',
  }),
};

/** Rings along the length, for parts that bend with a skin. */
const rings = () =>
  z
    .number()
    .int()
    .min(1)
    .max(64)
    .optional()
    .meta({ description: 'Rings along the length. Default 1; use more for skinned parts that bend.' });

const segments = (fallback: number, min = 3) =>
  z
    .number()
    .int()
    .min(min)
    .max(256)
    .optional()
    .meta({ description: `Default ${fallback}.` });

export const BoxPart = z
  .strictObject({
    type: z.literal('box'),
    ...Leaf,
    size: PositiveVec3.meta({ description: 'Width, height and depth in metres.' }),
  })
  .meta({
    description: 'Box centred on its own origin.',
    examples: [{ type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] }],
  });

export const CylinderPart = z
  .strictObject({
    type: z.literal('cylinder'),
    ...Leaf,
    radius: z
      .number()
      .positive()
      .optional()
      .meta({ description: 'Radius of both ends. radiusTop and radiusBottom override it.' }),
    radiusTop: z.number().min(0).optional(),
    radiusBottom: z.number().min(0).optional(),
    height: z.number().positive(),
    segments: segments(16),
    heightSegments: rings(),
  })
  .meta({
    description: 'Cylinder along Y, centred on its own origin.',
    examples: [{ type: 'cylinder', id: 'post', material: 'wood', radius: 0.1, height: 1, position: [0, 0.5, 0] }],
  });

export const ConePart = z
  .strictObject({
    type: z.literal('cone'),
    ...Leaf,
    radius: z.number().positive(),
    height: z.number().positive(),
    segments: segments(16),
  })
  .meta({
    description: 'Cone along Y with its tip at the top, centred on its own origin.',
    examples: [{ type: 'cone', id: 'spike', material: 'iron', radius: 0.3, height: 0.8, position: [0, 0.4, 0] }],
  });

export const SpherePart = z
  .strictObject({
    type: z.literal('sphere'),
    ...Leaf,
    radius: z.number().positive(),
    widthSegments: segments(16),
    heightSegments: segments(12, 2),
  })
  .meta({
    description: 'UV sphere centred on its own origin.',
    examples: [{ type: 'sphere', id: 'head', material: 'skin', radius: 0.4, position: [0, 0.4, 0] }],
  });

export const CapsulePart = z
  .strictObject({
    type: z.literal('capsule'),
    ...Leaf,
    radius: z.number().positive(),
    length: z
      .number()
      .min(0)
      .meta({ description: 'Length of the straight middle section. Total height is length + 2 x radius.' }),
    capSegments: segments(6, 1),
    radialSegments: segments(16),
    heightSegments: rings(),
  })
  .meta({
    description: 'Capsule along Y, centred on its own origin.',
    examples: [{ type: 'capsule', id: 'pill', material: 'cloth', radius: 0.25, length: 0.6, position: [0, 0.55, 0] }],
  });

export const TorusPart = z
  .strictObject({
    type: z.literal('torus'),
    ...Leaf,
    radius: z.number().positive().meta({ description: 'Distance from the centre to the middle of the tube.' }),
    tube: z.number().positive().meta({ description: 'Tube radius.' }),
    radialSegments: segments(12),
    tubularSegments: segments(32),
  })
  .meta({
    description: 'Ring lying flat in the XZ plane, centred on its own origin.',
    examples: [{ type: 'torus', id: 'ring', material: 'iron', radius: 0.4, tube: 0.1, position: [0, 0.1, 0] }],
  });

export const PlanePart = z
  .strictObject({
    type: z.literal('plane'),
    ...Leaf,
    size: z
      .tuple([z.number().positive(), z.number().positive()])
      .meta({ description: 'Width (X) and depth (Z) in metres.' }),
  })
  .meta({
    description: 'Flat rectangle facing up, centred on its own origin.',
    examples: [{ type: 'plane', id: 'floor', material: 'stone', size: [1, 1] }],
  });

export const WedgePart = z
  .strictObject({
    type: z.literal('wedge'),
    ...Leaf,
    size: PositiveVec3.meta({
      description:
        'Width, height and depth. The top slopes from full height at the back (-Z) to zero at the front (+Z).',
    }),
  })
  .meta({
    description: 'Ramp-shaped triangular prism centred on its own origin.',
    examples: [{ type: 'wedge', id: 'ramp', material: 'stone', size: [1, 0.5, 1], position: [0, 0.25, 0] }],
  });

export const LathePart = z
  .strictObject({
    type: z.literal('lathe'),
    ...Leaf,
    profile: z.array(Point2).min(2).max(256).meta({
      description: 'Points [radius, height] from bottom to top, spun around the Y axis. Use radius 0 to close an end.',
    }),
    segments: segments(24),
  })
  .meta({
    description:
      'Surface of revolution around Y. Heights are used as given, so a profile starting at 0 sits on the part origin.',
    examples: [
      {
        type: 'lathe',
        id: 'vase',
        material: 'clay',
        profile: [
          [0, 0],
          [0.3, 0],
          [0.4, 0.3],
          [0.2, 0.7],
          [0.25, 0.9],
          [0, 0.9],
        ],
      },
    ],
  });

export const ExtrudePart = z
  .strictObject({
    type: z.literal('extrude'),
    ...Leaf,
    shape: z.array(Point2).min(3).max(512).meta({ description: 'Outline [x, y] in the XY plane.' }),
    holes: z
      .array(z.array(Point2).min(3))
      .max(32)
      .optional()
      .meta({ description: 'Outlines to cut out of the shape.' }),
    depth: z.number().positive().meta({ description: 'Thickness along Z, centred on the part origin.' }),
  })
  .meta({
    description:
      'A 2D outline in the XY plane, around its own origin, extruded along Z from -depth/2 to depth/2: centred on its own origin in Z.',
    examples: [
      {
        type: 'extrude',
        id: 'blade',
        material: 'steel',
        shape: [
          [-0.05, 0],
          [0.05, 0],
          [0.05, 0.8],
          [0, 0.95],
          [-0.05, 0.8],
        ],
        depth: 0.02,
      },
    ],
  });

export const ImportPart = z
  .strictObject({
    type: z.literal('import'),
    ...Base,
    src: z.string().min(1).max(256).meta({ description: 'GLB file, relative to the asset directory.' }),
    select: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .meta({ description: 'Only these glTF node names and their children. Default: the whole default scene.' }),
    material: Name.meta({ description: 'Material for every glTF material not listed in materialMap.' }),
    materialMap: z
      .record(z.string(), Name)
      .optional()
      .meta({ description: 'glTF material name to asset material name.' }),
    units: z
      .number()
      .positive()
      .optional()
      .meta({ description: 'Metres per file unit, such as 0.01 for centimetres. Default 1.' }),
    align: z.enum(['base', 'centre', 'origin']).optional().meta({
      description:
        "base: bottom centre of the bounds at the part origin (default). centre: centre of the bounds. origin: keep the file's origin.",
    }),
  })
  .meta({
    description: 'Geometry from a binary glTF file.',
    examples: [{ type: 'import', id: 'teapot', src: 'import/teapot.glb', material: 'glaze' }],
  });

export const ComponentPart = z
  .strictObject({
    type: z.literal('component'),
    ...Base,
    component: Name.meta({ description: 'Component name: components/<name>.json in a project components directory.' }),
    params: z
      .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
      .optional()
      .meta({ description: "Values for the component's parameters." }),
    materials: z.record(Name, Name).optional().meta({ description: 'Component material name to asset material name.' }),
  })
  .meta({
    description: 'A reusable group of parts from a component file.',
    examples: [{ type: 'component', id: 'gate', component: 'fence-post', params: { height: 1.2 } }],
  });

export interface GroupPartT {
  type: 'group';
  id: string;
  description?: string | undefined;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: number | [number, number, number] | undefined;
  pivot?: [number, number, number] | undefined;
  visible?: boolean | undefined;
  bone?: string | undefined;
  skin?: z.infer<typeof SkinningMode> | undefined;
  skinBones?: string[] | undefined;
  repeat?: z.infer<typeof RepeatSpec> | undefined;
  mirror?: z.infer<typeof PartMirror> | undefined;
  parts: PartDefinitionT[];
}

export interface CsgPartT extends Omit<GroupPartT, 'type'> {
  type: 'csg';
  op: 'union' | 'subtract' | 'intersect' | 'hull';
}

export type PartDefinitionT =
  | z.infer<typeof BoxPart>
  | z.infer<typeof CylinderPart>
  | z.infer<typeof ConePart>
  | z.infer<typeof SpherePart>
  | z.infer<typeof CapsulePart>
  | z.infer<typeof TorusPart>
  | z.infer<typeof PlanePart>
  | z.infer<typeof WedgePart>
  | z.infer<typeof LathePart>
  | z.infer<typeof ExtrudePart>
  | z.infer<typeof ImportPart>
  | z.infer<typeof ComponentPart>
  | GroupPartT
  | CsgPartT;

export const GroupPart: z.ZodType<GroupPartT> = z
  .strictObject({
    type: z.literal('group'),
    ...Base,
    get parts(): z.ZodArray<z.ZodType<PartDefinitionT>> {
      return z.array(PartDefinition).min(1).max(1000);
    },
  })
  .meta({
    description: 'Parts that move together. The group transform applies to every child.',
    examples: [
      {
        type: 'group',
        id: 'lamp',
        position: [0, 0, 0],
        parts: [{ type: 'cylinder', id: 'pole', material: 'iron', radius: 0.05, height: 1.5, position: [0, 0.75, 0] }],
      },
    ],
  });

export const CsgPart: z.ZodType<CsgPartT> = z
  .strictObject({
    type: z.literal('csg'),
    ...Base,
    op: z.enum(['union', 'subtract', 'intersect', 'hull']).meta({
      description: 'subtract removes every later operand from the first. hull wraps all operands in their convex hull.',
    }),
    get parts(): z.ZodArray<z.ZodType<PartDefinitionT>> {
      return z.array(PartDefinition).min(1).max(64);
    },
  })
  .meta({
    description: 'Boolean combination of closed operands. Each operand keeps its own material.',
    examples: [
      {
        type: 'csg',
        id: 'block',
        op: 'subtract',
        position: [0, 0.5, 0],
        parts: [
          { type: 'box', id: 'body', material: 'stone', size: [1, 1, 1] },
          { type: 'cylinder', id: 'hole', material: 'stone', radius: 0.3, height: 1.2, rotation: [90, 0, 0] },
        ],
      },
    ],
  });

export const PartDefinition: z.ZodType<PartDefinitionT> = z.discriminatedUnion('type', [
  BoxPart,
  CylinderPart,
  ConePart,
  SpherePart,
  CapsulePart,
  TorusPart,
  PlanePart,
  WedgePart,
  LathePart,
  ExtrudePart,
  ImportPart,
  ComponentPart,
  GroupPart as never,
  CsgPart as never,
]);

/** Every part schema, by type, in the order they are documented. */
export const PART_SCHEMAS = {
  box: BoxPart,
  cylinder: CylinderPart,
  cone: ConePart,
  sphere: SpherePart,
  capsule: CapsulePart,
  torus: TorusPart,
  plane: PlanePart,
  wedge: WedgePart,
  lathe: LathePart,
  extrude: ExtrudePart,
  group: GroupPart,
  csg: CsgPart,
  component: ComponentPart,
  import: ImportPart,
} as const;

export type PartType = keyof typeof PART_SCHEMAS;
export const PART_TYPES = Object.keys(PART_SCHEMAS) as PartType[];

export const ModelDefinition = z
  .strictObject({
    description: Description.optional(),
    parts: z.array(PartDefinition).min(1).max(2000),
  })
  .meta({ description: 'Declarative model built from parts.' });

/** The model after components, repeats and mirrors are expanded. Imports carry a content hash. */
export const ResolvedModel = z.strictObject({
  description: Description.optional(),
  parts: z.array(PartDefinition),
  imports: z.record(z.string(), z.string()).meta({ description: 'Imported file (project-relative) to its sha256.' }),
});

export const ComponentParam = z.strictObject({
  type: z.enum(['number', 'string', 'boolean']),
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: Description.optional(),
});

export const ComponentFile = z
  .strictObject({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
    params: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'Parameter names are camelCase'), ComponentParam)
      .optional()
      .meta({
        description: 'Parameters the component takes, with types, defaults and limits. Use them as ${name} in parts.',
      }),
    materials: z
      .record(Name, MaterialDefinition)
      .optional()
      .meta({ description: 'Default materials. Asset materials with the same name win.' }),
    parts: z.array(z.unknown()).min(1).max(1000).meta({
      description:
        'Parts, validated after "${...}" placeholders are replaced. A placeholder can hold arithmetic: "${height / 2}".',
    }),
  })
  .meta({
    description: 'A reusable, parameterised group of parts, stored as components/<name>.json.',
    examples: [
      {
        schemaVersion: '1.0.0',
        name: 'fence-post',
        params: { height: { type: 'number', default: 1, min: 0.2 } },
        parts: [
          {
            type: 'box',
            id: 'post',
            material: 'wood',
            size: [0.12, '${height}', 0.12],
            position: [0, '${height / 2}', 0],
          },
        ],
      },
    ],
  });

export type BoxPartT = z.infer<typeof BoxPart>;
export type CylinderPartT = z.infer<typeof CylinderPart>;
export type ConePartT = z.infer<typeof ConePart>;
export type SpherePartT = z.infer<typeof SpherePart>;
export type CapsulePartT = z.infer<typeof CapsulePart>;
export type TorusPartT = z.infer<typeof TorusPart>;
export type PlanePartT = z.infer<typeof PlanePart>;
export type WedgePartT = z.infer<typeof WedgePart>;
export type LathePartT = z.infer<typeof LathePart>;
export type ExtrudePartT = z.infer<typeof ExtrudePart>;
export type ImportPartT = z.infer<typeof ImportPart>;
export type ComponentPartT = z.infer<typeof ComponentPart>;
export type RepeatSpecT = z.infer<typeof RepeatSpec>;
export type ModelDefinitionT = z.infer<typeof ModelDefinition>;
export type ResolvedModelT = z.infer<typeof ResolvedModel>;
export type ComponentFileT = z.infer<typeof ComponentFile>;
export type ComponentParamT = z.infer<typeof ComponentParam>;
