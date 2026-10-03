import { z } from 'zod';
import { Description, Name, SchemaRef, SchemaVersion } from '../primitives.ts';

/** Pixels between the pivot line and the bottom edge, or "auto" to fit the model's footprint. */
export const GroundMargin = z.union([z.literal('auto'), z.number().int().min(0).max(256)]).meta({
  description:
    'Pixels between the pivot (ground) line and the bottom edge of the frame. "auto" picks the smallest margin that keeps the footprint in front of the pivot inside the frame in every direction.',
  examples: ['auto', 4],
});

export const CameraSettings = z
  .strictObject({
    projection: z.literal('orthographic').meta({ description: 'Only orthographic projection is supported.' }),
    pitch: z.number().min(-90).max(90).meta({
      description:
        'Degrees above the horizon the camera looks down from. 30 gives 2:1 pixel lines at 45 degrees of yaw.',
    }),
    yawOffset: z.number().min(-360).max(360).meta({ description: 'Degrees added to every direction yaw.' }),
    groundMargin: GroundMargin,
  })
  .meta({ description: 'Camera settings.' });

export const CameraOverrides = CameraSettings.partial()
  .extend({ preset: Name.optional().meta({ description: 'Camera preset to start from.' }) })
  .meta({ description: 'A camera preset name plus overrides, or a complete inline camera.' });

export const CameraPreset = CameraSettings.extend({
  $schema: SchemaRef.optional(),
  schemaVersion: SchemaVersion,
  name: Name,
  description: Description.optional(),
}).meta({
  description: 'A named camera preset.',
  examples: [
    {
      schemaVersion: '1.0.0',
      name: 'dimetric',
      projection: 'orthographic',
      pitch: 30,
      yawOffset: 45,
      groundMargin: 'auto',
    },
  ],
});

export type CameraSettingsT = z.infer<typeof CameraSettings>;
export type CameraOverridesT = z.infer<typeof CameraOverrides>;
export type CameraPresetT = z.infer<typeof CameraPreset>;
