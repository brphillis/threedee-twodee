// Scenes the render goldens are made from, shared by the backend, rig and headless-gl tests.
import type { RenderSceneSettings } from '@td2d/schema';
import { BASE_SETTINGS } from '../../src/index.ts';

export const CUBE_SCENE: RenderSceneSettings = {
  frame: { width: 48, height: 48 },
  supersample: 4,
  pixelsPerUnit: 16,
  camera: { pitch: 30, yawOffset: 45, groundMargin: 8 },
  lighting: BASE_SETTINGS.lighting,
};

export const SIDE_SCENE: RenderSceneSettings = {
  frame: { width: 64, height: 64 },
  supersample: 4,
  pixelsPerUnit: 16,
  camera: { pitch: 0, yawOffset: 0, groundMargin: 4 },
  lighting: BASE_SETTINGS.lighting,
};

/** A two-segment arm bending at the elbow, rigid or skinned. */
export function arm(skin: 'rigid' | 'two-bone-blend') {
  const parts =
    skin === 'rigid'
      ? [
          {
            type: 'capsule',
            id: 'upper',
            bone: 'shoulder',
            material: 'skin',
            radius: 0.08,
            length: 0.36,
            position: [0, 0.75, 0],
          },
          {
            type: 'capsule',
            id: 'lower',
            bone: 'elbow',
            material: 'skin',
            radius: 0.08,
            length: 0.36,
            position: [0, 0.26, 0],
          },
        ]
      : [
          {
            type: 'capsule',
            id: 'arm',
            skin,
            material: 'skin',
            radius: 0.08,
            length: 0.84,
            position: [0, 0.5, 0],
            heightSegments: 24,
          },
        ];
  return {
    schemaVersion: '1.0.0',
    type: 'prop',
    frame: { width: 48, height: 48 },
    pixelsPerUnit: 28,
    directions: ['s'],
    camera: { preset: 'side', groundMargin: 6 },
    rig: {
      bones: [
        { name: 'shoulder', parent: null, position: [0, 1, 0] },
        { name: 'elbow', parent: 'shoulder', position: [0, -0.5, 0] },
      ],
    },
    materials: { skin: { color: '#e8b796', shading: 'toon' } },
    model: { parts },
    animation: {
      clips: {
        bend: {
          duration: 1,
          loop: false,
          sampleTimes: [0, 0.5, 1],
          keys: [
            { t: 0, pose: {} },
            { t: 1, pose: { elbow: { rotation: [0, 0, 90] } } },
          ],
        },
      },
    },
  };
}
