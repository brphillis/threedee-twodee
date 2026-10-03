import type { RenderSceneSettings } from '@td2d/schema';
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, SphereGeometry, WebGLRenderer } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { describe, expect, it } from 'vitest';
import { HarnessScene } from '../src/index.ts';

const SETTINGS: RenderSceneSettings = {
  frame: { width: 32, height: 32 },
  supersample: 2,
  pixelsPerUnit: 16,
  camera: { pitch: 30, yawOffset: 45, groundMargin: 8 },
  lighting: {
    space: 'camera',
    lights: [
      { type: 'directional', azimuth: -35, elevation: 50, intensity: 2, castShadow: true },
      { type: 'ambient', intensity: 0.45 },
    ],
    shadows: { enabled: true, mapSize: 512, bias: -0.0005, normalBias: 0.02 },
  },
};

async function glbOf(mesh: Mesh): Promise<ArrayBuffer> {
  const scene = new Scene();
  scene.add(mesh);
  return (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
}

function newScene(): HarnessScene {
  return new HarnessScene(
    new WebGLRenderer({
      canvas: document.createElement('canvas'),
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
    }),
  );
}

function histogram(rgba: Uint8Array): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

describe('HarnessScene in a real browser', () => {
  it('renders a WebGL2 frame with a transparent background', async () => {
    const harness = newScene();
    expect(harness.renderer.capabilities.isWebGL2).toBe(true);
    const material = new MeshStandardMaterial({ color: 0xe07040 });
    material.userData = { td2d: { shading: 'toon', bands: 3 } };
    const info = await harness.loadModel(
      await glbOf(new Mesh(new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), material)),
    );
    expect(info.triangles).toBe(12);
    harness.configure(SETTINGS);
    const frame = harness.render({ clip: null, time: 0, yaw: 0 });
    expect([frame.width, frame.height]).toEqual([64, 64]);
    expect(frame.rgba[3]).toBe(0);
    expect(histogram(frame.rgba).size).toBeGreaterThan(0);
    expect(histogram(frame.rgba).size).toBeLessThanOrEqual(6);
  });

  it('maps flat materials to unlit colour and toon bands to a small set of colours', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0x3e8948 });
    material.userData = { td2d: { shading: 'flat' } };
    await harness.loadModel(await glbOf(new Mesh(new SphereGeometry(0.4, 24, 16).translate(0, 0.4, 0), material)));
    harness.configure(SETTINGS);
    const colours = [...histogram(harness.render({ clip: null, time: 0, yaw: 0 }).rgba.slice()).keys()];
    expect(colours).toEqual(['62,137,72']);
  });

  it('shades a sphere the same from every direction when lights follow the camera', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0xa0693a });
    material.userData = { td2d: { shading: 'toon', bands: 3 } };
    await harness.loadModel(await glbOf(new Mesh(new SphereGeometry(0.4, 32, 24).translate(0, 0.4, 0), material)));
    harness.configure(SETTINGS);
    const a = histogram(harness.render({ clip: null, time: 0, yaw: 0 }).rgba);
    const b = histogram(harness.render({ clip: null, time: 0, yaw: 135 }).rgba);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [colour, count] of a) expect(Math.abs((b.get(colour) ?? 0) - count) / count).toBeLessThan(0.05);
  });
});
