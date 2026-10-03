import type { RenderSceneSettings } from '@td2d/schema';
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  cameraRig,
  directionVector,
  lightDirection,
  type Point3,
  projectToPixels,
} from '../src/index.ts';

const lighting: RenderSceneSettings['lighting'] = {
  space: 'camera',
  lights: [{ type: 'ambient', intensity: 1 }],
  shadows: { enabled: false, mapSize: 1024, bias: 0, normalBias: 0 },
};

function settings(
  camera: Partial<RenderSceneSettings['camera']> = {},
  extra: Partial<RenderSceneSettings> = {},
): RenderSceneSettings {
  return {
    frame: { width: 32, height: 32 },
    supersample: 4,
    pixelsPerUnit: 16,
    camera: { pitch: 30, yawOffset: 45, groundMargin: 2, ...camera },
    lighting,
    ...extra,
  };
}

const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Point3) => Math.hypot(...a);

function slope(rig: ReturnType<typeof cameraRig>, v: Point3): number {
  const a = projectToPixels(rig, [0, 0, 0]);
  const b = projectToPixels(rig, v);
  return Math.abs((b.y - a.y) / (b.x - a.x));
}

describe('cameraRig', () => {
  it('places the pivot on the horizontal centre and groundMargin pixels above the bottom', () => {
    const rig = cameraRig(settings(), 0, 1);
    expect(rig.renderWidth).toBe(128);
    expect(rig.renderHeight).toBe(128);
    const p = projectToPixels(rig, [0, 0, 0]);
    expect(p.x).toBeCloseTo(64, 9);
    expect(p.y).toBeCloseTo(128 - 2 * 4, 9);
  });

  it('keeps the pivot fixed for every direction and pitch', () => {
    for (const pitch of [0, 30, 35.264, 45, 90]) {
      for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const p = projectToPixels(cameraRig(settings({ pitch }), yaw, 1), [0, 0, 0]);
        expect(p.x).toBeCloseTo(64, 9);
        expect(p.y).toBeCloseTo(120, 9);
      }
    }
  });

  it('gives 2:1 pixel lines for the dimetric preset (pitch 30, yaw offset 45)', () => {
    const rig = cameraRig(settings({ pitch: 30, yawOffset: 45 }), 0, 1);
    expect(slope(rig, [1, 0, 0])).toBeCloseTo(0.5, 9);
    expect(slope(rig, [0, 0, 1])).toBeCloseTo(0.5, 9);
  });

  it('gives 30 degree lines for true isometric (pitch 35.264)', () => {
    const rig = cameraRig(settings({ pitch: 35.264, yawOffset: 45 }), 0, 1);
    expect((Math.atan(slope(rig, [1, 0, 0])) * 180) / Math.PI).toBeCloseTo(30, 2);
  });

  it('maps one metre to pixelsPerUnit times supersample render pixels', () => {
    const rig = cameraRig(settings({ pitch: 0, yawOffset: 0, groundMargin: 0 }), 0, 1);
    const a = projectToPixels(rig, [0, 0, 0]);
    const b = projectToPixels(rig, [1, 1, 0]);
    expect(b.x - a.x).toBeCloseTo(64, 9);
    expect(a.y - b.y).toBeCloseTo(64, 9);
  });

  it('turns the model front (+Z) to screen left when facing west and right when facing east', () => {
    const side = (yaw: number) => projectToPixels(cameraRig(settings({ pitch: 0, yawOffset: 0 }), yaw, 1), [0, 0, 1]).x;
    expect(side(0)).toBeCloseTo(64, 9);
    expect(side(90)).toBeLessThan(64);
    expect(side(270)).toBeGreaterThan(64);
  });

  it('builds an orthonormal basis, including looking straight down', () => {
    for (const pitch of [0, 30, 89.9, 90, -90]) {
      const rig = cameraRig(settings({ pitch }), 33, 1);
      expect(len(rig.up)).toBeCloseTo(1, 9);
      expect(len(rig.right)).toBeCloseTo(1, 9);
      expect(dot(rig.up, rig.toCamera)).toBeCloseTo(0, 9);
      expect(dot(rig.right, rig.toCamera)).toBeCloseTo(0, 9);
      expect(dot(rig.right, rig.up)).toBeCloseTo(0, 9);
    }
  });

  it('shows north at the top of a top-down view', () => {
    const rig = cameraRig(
      settings({ pitch: 90, yawOffset: 0, groundMargin: 0 }, { frame: { width: 32, height: 32 } }),
      0,
      1,
    );
    const centre = projectToPixels(rig, [0, 0, 0]);
    expect(projectToPixels(rig, [0, 0, -1]).y).toBeLessThan(centre.y);
  });

  it('keeps the model inside the clipping range', () => {
    const rig = cameraRig(settings(), 0, 3);
    const distance = len(rig.position);
    expect(distance - 3).toBeGreaterThan(rig.frustum.near);
    expect(distance + 3).toBeLessThan(rig.frustum.far);
  });
});

describe('lights', () => {
  it('turns camera-space lights with the camera and keeps world lights fixed', () => {
    const light = { azimuth: -35, elevation: 50 };
    expect(lightDirection(light, 'camera', 90)).toEqual(directionVector(55, 50));
    expect(lightDirection(light, 'world', 90)).toEqual(directionVector(-35, 50));
  });

  it('points elevation 90 straight up', () => {
    const v = directionVector(123, 90);
    expect(v[1]).toBeCloseTo(1, 12);
  });
});

describe('base64', () => {
  it('round-trips large buffers', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
    const text = bytesToBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64ToBytes(text)).toEqual(bytes);
  });
});

describe('toon ramp', () => {
  it('puts every unlit sample in band 0 and spreads the bands over the lit half', async () => {
    const { toonGradient } = await import('../src/materials.ts');
    expect(Array.from(toonGradient(3).image.data as Uint8Array)).toEqual([0, 0, 0, 0, 128, 255]);
    expect(Array.from(toonGradient(2).image.data as Uint8Array)).toEqual([0, 0, 0, 255]);
  });
});
