import { z } from 'zod';
import { AssetId, ClipName, Description, HexColor, Name, PixelSize, SchemaRef, SchemaVersion } from '../primitives.ts';
import { AnimationDefinition, ClipGenerator, ClipKey, Interpolation } from './animation.ts';
import { CameraOverrides, CameraSettings } from './camera.ts';
import { DirectionSpec, MirrorSpec } from './directions.ts';
import { ExportOverrides, ExportSettings } from './export.ts';
import { LightingOverrides, LightingSettings } from './lighting.ts';
import { MaterialDefinition, PaletteColorRef, Shading } from './material.ts';
import { ModelDefinition, ResolvedModel } from './model.ts';
import { PixelOverrides, PixelSettings } from './pixel.ts';
import { ResolvedRig, RigDefinition } from './rig.ts';
import { SheetOverrides, SheetSettings } from './sheet.ts';

export const ASSET_TYPES = ['prop', 'character', 'tile', 'effect'] as const;
export const AssetType = z
  .enum(ASSET_TYPES)
  .meta({ description: 'Asset category. Selects type defaults such as frame size.' });

export const FrameSize = z
  .strictObject({ width: PixelSize, height: PixelSize })
  .meta({ description: 'Final sprite cell size in pixels.', examples: [{ width: 32, height: 32 }] });

export const PixelsPerUnit = z.union([z.number().positive().max(1024), z.literal('auto')]).meta({
  description:
    'Pixels per metre in the final sprite; the camera frustum width is frame.width / pixelsPerUnit. "auto" picks the largest whole number that fits the model in every direction with one pixel to spare, and records it in the manifest.',
  examples: [16, 'auto'],
});

export const RenderOverrides = z
  .strictObject({
    supersample: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .meta({ description: 'Render at this multiple of the frame size. Default 4.' }),
    backend: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional()
      .meta({ description: 'Render backend id. Default playwright-swiftshader.' }),
  })
  .meta({ description: 'Render settings.' });

export const Acceptance = z
  .strictObject({
    maxColors: z
      .number()
      .int()
      .min(1)
      .max(256)
      .optional()
      .meta({ description: 'Most opaque colours allowed in any sprite.' }),
    minAlphaCoverage: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: 'Smallest opaque fraction of each frame.' }),
    maxAlphaCoverage: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: 'Largest opaque fraction of each frame.' }),
    maxJitter: z
      .number()
      .min(0)
      .optional()
      .meta({ description: 'Largest centroid move between consecutive frames, in pixels.' }),
    maxBoundsDrift: z
      .number()
      .min(0)
      .optional()
      .meta({ description: 'Largest bounding-box deviation within a clip, in pixels.' }),
    maxOrphans: z.number().int().min(0).optional().meta({
      description: 'Most isolated single pixels allowed in any sprite. Without it, isolated pixels are a warning.',
    }),
    requiredClips: z.array(ClipName).optional().meta({ description: 'Clips that must exist.' }),
  })
  .meta({ description: 'Asset-specific checks enforced by validate and generate.' });

/** A preset name, with examples of that kind, or an object of overrides. */
const presetRef = <T extends z.ZodType>(overrides: T, examples: readonly string[]) =>
  z.union([Name.meta({ description: 'Preset name.', examples: [...examples] }), overrides]);

/** Settings that can come from built-in defaults, project defaults or the asset itself. */
const SharedSettings = {
  frame: FrameSize.optional(),
  pixelsPerUnit: PixelsPerUnit.optional(),
  camera: presetRef(CameraOverrides, ['dimetric', 'isometric', 'side'])
    .optional()
    .meta({ description: 'Camera preset name, or an object with an optional preset and overrides.' }),
  lighting: presetRef(LightingOverrides, ['studio-toon', 'world-sun'])
    .optional()
    .meta({ description: 'Lighting preset name, or an object with an optional preset and overrides.' }),
  directions: DirectionSpec.optional(),
  mirror: MirrorSpec.optional(),
  render: RenderOverrides.optional(),
  pixel: presetRef(PixelOverrides, ['retro-16', 'pico-8'])
    .optional()
    .meta({ description: 'Pixel preset name, or an object with an optional preset and overrides.' }),
  sheet: presetRef(SheetOverrides, ['packed', 'strips'])
    .optional()
    .meta({ description: 'Sheet preset name, or an object with an optional preset and overrides.' }),
  export: presetRef(ExportOverrides, ['everything'])
    .optional()
    .meta({ description: 'Export preset name, or an object with an optional preset and overrides.' }),
  rig: presetRef(RigDefinition, ['humanoid-basic', 'quadruped-basic']).optional().meta({
    description:
      'Rig preset name, or an object with an optional preset, scale and bone changes. A preset name in a later layer starts the rig again from that preset.',
  }),
};

export const AssetDefaults = z
  .strictObject({
    ...SharedSettings,
    fps: z.number().int().min(1).max(60).optional().meta({ description: 'Default animation frame rate.' }),
    materials: z
      .record(Name, MaterialDefinition)
      .optional()
      .meta({ description: 'Materials shared by every asset. Asset materials with the same name win.' }),
  })
  .meta({ description: 'Defaults applied to assets before their own settings.' });

export const AssetDefinition = z
  .strictObject({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    id: AssetId.optional().meta({
      description: 'Optional. When present it must equal the directory path under assets/.',
    }),
    type: AssetType,
    description: Description.optional(),
    tags: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(32),
      )
      .max(32)
      .optional()
      .meta({
        description: 'Lowercase labels for finding assets, such as "wood" or "enemy". The viewer filters by them.',
      }),
    ...SharedSettings,
    materials: z.record(Name, MaterialDefinition).optional().meta({ description: 'Materials keyed by name.' }),
    model: ModelDefinition,
    animation: AnimationDefinition.optional(),
    acceptance: Acceptance.optional(),
  })
  .meta({
    description: 'A td2d asset definition, stored as assets/<id>/asset.json.',
    examples: [
      {
        schemaVersion: '1.0.0',
        type: 'prop',
        frame: { width: 32, height: 32 },
        camera: 'dimetric',
        directions: ['s', 'w', 'n', 'e'],
        materials: { wood: { color: '#a0693a', shading: 'toon' } },
        model: { parts: [{ type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] }] },
      },
    ],
  });

export const ResolvedMaterial = z.strictObject({
  color: HexColor,
  colorRef: PaletteColorRef.nullable(),
  shading: Shading,
  bands: z.number().int(),
  emissive: HexColor,
  outline: z.boolean(),
  opacity: z.number(),
  description: Description.optional(),
});

export const ResolvedDirection = z.strictObject({
  name: z.string(),
  yaw: z.number().meta({ description: 'Direction yaw before the camera yaw offset, in degrees.' }),
  mirrorOf: z
    .string()
    .nullable()
    .meta({ description: 'Source direction when this direction is produced by mirroring.' }),
});

export const ResolvedClip = z.strictObject({
  duration: z.number(),
  loop: z.boolean(),
  fps: z.number().int(),
  frames: z.number().int().min(1),
  times: z.array(z.number()).min(1).meta({ description: 'Sample times in seconds, one per frame.' }),
  motion: z.boolean(),
  interpolation: Interpolation,
  keys: z.array(ClipKey).nullable(),
  generator: ClipGenerator.nullable(),
  description: Description.optional(),
});

const PresetName = Name.nullable().meta({ description: 'Preset the settings started from.' });
const ResolvedCamera = CameraSettings.extend({ preset: PresetName });
const ResolvedLighting = LightingSettings.extend({ preset: PresetName });
const ResolvedPixel = PixelSettings.extend({ preset: PresetName });
const ResolvedSheet = SheetSettings.extend({ preset: PresetName });
const ResolvedExport = ExportSettings.extend({ preset: PresetName });

export const ResolvedAsset = z
  .strictObject({
    id: AssetId,
    type: AssetType,
    description: Description.optional(),
    tags: z.array(z.string()).meta({ description: "The asset's tags." }),
    sourceFile: z.string().meta({ description: 'Asset definition path relative to the project root.' }),
    frame: FrameSize,
    pixelsPerUnit: PixelsPerUnit,
    camera: ResolvedCamera.meta({
      description: 'Camera after presets and overrides, with the ground margin resolved.',
    }),
    lighting: ResolvedLighting.meta({ description: 'Lighting after presets and overrides.' }),
    directions: z
      .array(ResolvedDirection)
      .min(1)
      .meta({ description: 'Every direction to render, with mirrors resolved.' }),
    materials: z.record(z.string(), ResolvedMaterial).meta({
      description: 'Materials by name. A part with its own colour gets a variant named <material>~<part id>.',
    }),
    model: ResolvedModel.meta({ description: 'Parts with components expanded and imports hashed.' }),
    rig: ResolvedRig.nullable().meta({ description: 'Bones in parent-first order, or null for an unrigged asset.' }),
    animation: z
      .strictObject({ fps: z.number().int(), clips: z.record(ClipName, ResolvedClip) })
      .meta({ description: 'Clips with their sample times; generator clips keep their settings.' }),
    render: z
      .strictObject({ supersample: z.number().int(), backend: z.string() })
      .meta({ description: 'Supersampling factor and render backend.' }),
    pixel: ResolvedPixel.meta({ description: 'Pixel settings after presets and overrides.' }),
    paletteColors: z.array(HexColor).nullable().meta({ description: 'The colours of a fixed palette, or null.' }),
    sheet: ResolvedSheet.meta({ description: 'Sheet settings after presets and overrides.' }),
    export: ResolvedExport.meta({ description: 'Export settings after presets and overrides.' }),
    acceptance: Acceptance,
  })
  .meta({ description: 'An asset after defaults and presets are applied. Printed by td2d asset show.' });

export type AssetTypeT = z.infer<typeof AssetType>;
export type FrameSizeT = z.infer<typeof FrameSize>;
export type AcceptanceT = z.infer<typeof Acceptance>;
export type AssetDefaultsT = z.infer<typeof AssetDefaults>;
export type AssetDefinitionT = z.infer<typeof AssetDefinition>;
export type ResolvedMaterialT = z.infer<typeof ResolvedMaterial>;
export type ResolvedDirectionT = z.infer<typeof ResolvedDirection>;
export type ResolvedClipT = z.infer<typeof ResolvedClip>;
export type ResolvedAssetT = z.infer<typeof ResolvedAsset>;
