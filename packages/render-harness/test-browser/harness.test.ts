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

describe('ramp materials', () => {
  it('paints every toon band with a ramp colour and nothing else', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0xa0693a, name: 'paint' });
    await harness.loadModel(await glbOf(new Mesh(new SphereGeometry(0.4, 32, 24).translate(0, 0.4, 0), material)));
    const ramp = ['#5d275d', '#b13e53', '#ef7d57', '#ffcd75'];
    harness.configure({
      ...SETTINGS,
      materials: { paint: { color: '#b13e53', shading: 'toon', bands: 4, emissive: '#000000', ramp } },
    });
    const colours = histogram(harness.render({ clip: null, time: 0, yaw: 0 }).rgba);
    const asRgb = (hex: string) =>
      `${Number.parseInt(hex.slice(1, 3), 16)},${Number.parseInt(hex.slice(3, 5), 16)},${Number.parseInt(hex.slice(5), 16)}`;
    expect([...colours.keys()].sort()).toEqual(ramp.map(asRgb).sort());
    // The lit side is the biggest area and the shadow side the smallest with the key light high in front.
    const counts = ramp.map((c) => colours.get(asRgb(c)) ?? 0);
    expect(counts.every((n) => n > 0)).toBe(true);
  });

  it('shades a plain toon material and a ramp of its own shades alike', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0xa0693a, name: 'paint' });
    await harness.loadModel(await glbOf(new Mesh(new SphereGeometry(0.4, 32, 24).translate(0, 0.4, 0), material)));
    harness.configure({
      ...SETTINGS,
      materials: { paint: { color: '#a0693a', shading: 'toon', bands: 3, emissive: '#000000' } },
    });
    const plain = histogram(harness.render({ clip: null, time: 0, yaw: 0 }).rgba);
    const shades = [...plain.keys()]
      .sort((a, b) => sum(a) - sum(b))
      .map(
        (k) =>
          `#${k
            .split(',')
            .map((n) => Number(n).toString(16).padStart(2, '0'))
            .join('')}`,
      );
    expect(shades).toHaveLength(3);
    harness.configure({
      ...SETTINGS,
      materials: { paint: { color: '#a0693a', shading: 'toon', bands: 3, emissive: '#000000', ramp: shades } },
    });
    const ramped = histogram(harness.render({ clip: null, time: 0, yaw: 0 }).rgba);
    expect([...ramped.keys()].sort()).toEqual([...plain.keys()].sort());
    for (const [colour, count] of plain)
      expect(Math.abs((ramped.get(colour) ?? 0) - count)).toBeLessThanOrEqual(count * 0.02 + 2);
  });
});

function sum(key: string): number {
  return key.split(',').reduce((n, c) => n + Number(c), 0);
}

describe('normal maps', () => {
  it('renders view-space normals beside the colour frame when asked', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0xa0693a, name: 'paint' });
    await harness.loadModel(await glbOf(new Mesh(new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), material)));
    harness.configure({ ...SETTINGS, camera: { pitch: 0, yawOffset: 0, groundMargin: 8 }, normals: true });
    const frame = harness.render({ clip: null, time: 0, yaw: 0 });
    expect(frame.normals).toBeDefined();
    const normals = frame.normals as Uint8Array;
    expect(normals.length).toBe(frame.rgba.length);
    // Opaque exactly where the colour frame is, and the face towards the camera has the flat normal.
    for (let i = 3; i < normals.length; i += 4) expect(normals[i] === 0).toBe(frame.rgba[i] === 0);
    const colours = histogram(normals);
    expect(colours.get('128,128,255')).toBeGreaterThan(100);
    expect(colours.size).toBeLessThanOrEqual(2);
    const plain = harness.render({ clip: null, time: 0, yaw: 0 });
    expect(plain.normals).toBeDefined();
    harness.configure({ ...SETTINGS, camera: { pitch: 0, yawOffset: 0, groundMargin: 8 } });
    expect(harness.render({ clip: null, time: 0, yaw: 0 }).normals).toBeUndefined();
  });

  it('tilts normals with the camera: a top face seen from 30 degrees above points up and towards the viewer', async () => {
    const harness = newScene();
    const material = new MeshStandardMaterial({ color: 0xa0693a, name: 'paint' });
    await harness.loadModel(await glbOf(new Mesh(new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), material)));
    harness.configure({ ...SETTINGS, camera: { pitch: 30, yawOffset: 0, groundMargin: 8 }, normals: true });
    const colours = histogram(harness.render({ clip: null, time: 0, yaw: 0 }).normals as Uint8Array);
    const top = [...colours.keys()].map((k) => k.split(',').map(Number)).find((c) => (c[1] as number) > 200);
    expect(top).toBeDefined();
    // (0, cos 30, sin 30) encoded: y about 238, z about 191.
    expect(Math.abs((top?.[1] as number) - 238)).toBeLessThanOrEqual(2);
    expect(Math.abs((top?.[2] as number) - 191)).toBeLessThanOrEqual(2);
  });
});
