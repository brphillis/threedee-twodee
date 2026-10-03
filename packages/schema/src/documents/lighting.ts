import { z } from 'zod';
import { Description, HexColor, Name, SchemaRef, SchemaVersion } from '../primitives.ts';

export const DirectionalLight = z
  .strictObject({
    type: z.literal('directional'),
    azimuth: z
      .number()
      .min(-360)
      .max(360)
      .meta({ description: 'Degrees around the vertical axis. 0 points from the viewer.' }),
    elevation: z.number().min(-90).max(90).meta({ description: 'Degrees above the horizon.' }),
    intensity: z.number().min(0).max(20),
    color: HexColor.optional(),
    castShadow: z.boolean().optional(),
  })
  .meta({ description: 'Directional light.' });

export const AmbientLight = z
  .strictObject({
    type: z.literal('ambient'),
    intensity: z.number().min(0).max(20),
    color: HexColor.optional(),
  })
  .meta({ description: 'Uniform ambient light.' });

export const HemisphereLight = z
  .strictObject({
    type: z.literal('hemisphere'),
    intensity: z.number().min(0).max(20),
    skyColor: HexColor,
    groundColor: HexColor,
  })
  .meta({ description: 'Sky and ground gradient light.' });

export const Light = z.discriminatedUnion('type', [DirectionalLight, AmbientLight, HemisphereLight]);

export const ShadowSettings = z
  .strictObject({
    enabled: z.boolean(),
    mapSize: z.union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]),
    bias: z.number().min(-0.1).max(0.1),
    normalBias: z.number().min(0).max(1),
  })
  .meta({ description: 'Hard shadow settings. Shadows are always unfiltered for reproducibility.' });

export const GroundShadow = z
  .strictObject({
    enabled: z.boolean(),
    color: HexColor.meta({
      description: 'Colour of the shadow. Sprite alpha is binary, so the shadow is drawn solid in this colour.',
    }),
  })
  .meta({
    description: 'Draw the shadow the model casts on the ground (y = 0) into the sprite.',
    examples: [{ enabled: true, color: '#1a1c2c' }],
  });

export const LightingSettings = z
  .strictObject({
    space: z.enum(['camera', 'world']).meta({
      description: 'camera: lights turn with the camera so every direction shades alike. world: lights stay fixed.',
    }),
    lights: z
      .array(Light)
      .min(1)
      .max(8)
      .meta({ description: 'One to eight lights: directional, ambient or hemisphere.' }),
    shadows: ShadowSettings,
    groundShadow: GroundShadow.optional(),
  })
  .meta({ description: 'Lighting settings.' });

export const LightingOverrides = LightingSettings.partial()
  .extend({
    preset: Name.optional().meta({ description: 'Lighting preset to start from.' }),
    shadows: ShadowSettings.partial().optional(),
    groundShadow: GroundShadow.partial().optional(),
  })
  .meta({ description: 'A lighting preset name plus overrides. A lights array replaces the preset lights.' });

export const LightingPreset = LightingSettings.extend({
  $schema: SchemaRef.optional(),
  schemaVersion: SchemaVersion,
  name: Name,
  description: Description.optional(),
}).meta({
  description: 'A named lighting preset.',
  examples: [
    {
      schemaVersion: '1.0.0',
      name: 'dusk',
      space: 'camera',
      lights: [
        { type: 'directional', azimuth: -40, elevation: 25, intensity: 2, color: '#ffb070' },
        { type: 'ambient', intensity: 0.6, color: '#6070a0' },
      ],
      shadows: { enabled: false, mapSize: 1024, bias: 0, normalBias: 0 },
    },
  ],
});

export type LightT = z.infer<typeof Light>;
export type LightingSettingsT = z.infer<typeof LightingSettings>;
export type LightingOverridesT = z.infer<typeof LightingOverrides>;
export type LightingPresetT = z.infer<typeof LightingPreset>;
