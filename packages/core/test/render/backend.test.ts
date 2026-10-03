import type { FrameSample, RenderSceneSettings } from '@td2d/schema';
import { cameraRig, type Point3, projectToPixels } from '@td2d/schema/camera';
import pixelmatch from 'pixelmatch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opaqueBounds, PlaywrightBackend, type RenderedFrame, type Td2dError } from '../../src/index.ts';
import { armGlb, cubeGlb, cylinderGlb } from '../fixtures/models.ts';
import { expectGolden } from './golden.ts';
import { CUBE_SCENE, SIDE_SCENE } from './scenes.ts';

const D4: FrameSample[] = [0, 90, 180, 270].map((yaw) => ({ key: `static/${yaw}`, clip: null, time: 0, yaw }));

async function renderAll(
  backend: PlaywrightBackend,
  glb: Uint8Array,
  scene: RenderSceneSettings,
  samples: readonly FrameSample[],
): Promise<RenderedFrame[]> {
  const frames: RenderedFrame[] = [];
  await backend.render({ model: { glb }, scene, samples }, (f) => {
    frames.push(f);
  });
  return frames;
}

function mismatchRatio(a: RenderedFrame, b: RenderedFrame, threshold = 0): number {
  return (
    pixelmatch(a.rgba, b.rgba, undefined, a.width, a.height, { threshold, includeAA: true }) / (a.width * a.height)
  );
}

const at = (f: RenderedFrame, x: number, y: number) => f.rgba[(y * f.width + x) * 4 + 3];

describe('Playwright SwiftShader backend', () => {
  const backend = new PlaywrightBackend();
  let cube: Uint8Array;

  beforeAll(async () => {
    cube = await cubeGlb();
    await backend.start();
  });
  afterAll(() => backend.stop());

  it('reports a WebGL2 SwiftShader renderer and the harness three.js revision', async () => {
    const info = await backend.start();
    expect(info.software).toBe(true);
    expect(info.renderer).toMatch(/SwiftShader/);
    expect(info.threeRevision).toBe('186');
    expect(info.version).toMatch(/^\d+\./);
  });

  it('renders transparent RGBA frames at frame size times supersample with binary alpha', async () => {
    const frames = await renderAll(backend, cube, CUBE_SCENE, D4);
    expect(frames.map((f) => f.key)).toEqual(D4.map((s) => s.key));
    for (const f of frames) {
      expect([f.width, f.height]).toEqual([192, 192]);
      for (let i = 3; i < f.rgba.length; i += 4) expect(f.rgba[i] === 0 || f.rgba[i] === 255).toBe(true);
      expect(at(f, 0, 0)).toBe(0);
      expect(at(f, 191, 191)).toBe(0);
    }
  });

  it('places the silhouette exactly where the camera maths projects the cube corners', async () => {
    const [frame] = await renderAll(backend, cube, CUBE_SCENE, [D4[0] as FrameSample]);
    const rig = cameraRig(CUBE_SCENE, 0, 1);
    const corners: Point3[] = [];
    for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) corners.push([x, y, z]);
    const projected = corners.map((c) => projectToPixels(rig, c));
    const expected = {
      minX: Math.min(...projected.map((p) => p.x)),
      maxX: Math.max(...projected.map((p) => p.x)),
      minY: Math.min(...projected.map((p) => p.y)),
      maxY: Math.max(...projected.map((p) => p.y)),
    };
    const b = opaqueBounds(frame as RenderedFrame);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(Math.abs(b.x - expected.minX)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.w - expected.maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - expected.minY)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y + b.h - expected.maxY)).toBeLessThanOrEqual(1);
  });

  it('shades a symmetric model identically in every direction with camera-locked lights', async () => {
    const frames = await renderAll(backend, cube, CUBE_SCENE, D4);
    const first = frames[0] as RenderedFrame;
    for (const f of frames.slice(1)) expect(mismatchRatio(first, f, 0.05)).toBeLessThan(0.002);
  });

  it('matches the committed golden images', async () => {
    const [cubeFrame] = await renderAll(backend, cube, CUBE_SCENE, [D4[0] as FrameSample]);
    await expectGolden('cube-dimetric-s', cubeFrame as RenderedFrame);
    const [cylinder] = await renderAll(
      backend,
      await cylinderGlb(),
      { ...SIDE_SCENE, frame: { width: 32, height: 32 }, camera: { ...SIDE_SCENE.camera, groundMargin: 2 } },
      [{ key: 'side', clip: null, time: 0, yaw: 0 }],
    );
    await expectGolden('cylinder-side', cylinder as RenderedFrame);
    const [arm] = await renderAll(backend, await armGlb(), SIDE_SCENE, [
      { key: 'wave', clip: 'wave', time: 0.5, yaw: 0 },
    ]);
    await expectGolden('arm-wave-0.5', arm as RenderedFrame);
  });

  it('samples skinned animation deterministically', async () => {
    const arm = await armGlb();
    const frames = await renderAll(backend, arm, SIDE_SCENE, [
      { key: 'rest', clip: null, time: 0, yaw: 0 },
      { key: 't0', clip: 'wave', time: 0, yaw: 0 },
      { key: 'bent', clip: 'wave', time: 0.5, yaw: 0 },
      { key: 't0-again', clip: 'wave', time: 0, yaw: 0 },
      { key: 'rest-again', clip: null, time: 0, yaw: 0 },
    ]);
    const [rest, t0, bent, t0Again, restAgain] = frames as [
      RenderedFrame,
      RenderedFrame,
      RenderedFrame,
      RenderedFrame,
      RenderedFrame,
    ];
    expect(mismatchRatio(rest, t0)).toBe(0);
    expect(mismatchRatio(t0, t0Again)).toBe(0);
    expect(mismatchRatio(rest, restAgain)).toBe(0);
    expect(mismatchRatio(rest, bent)).toBeGreaterThan(0.01);
    // Bending +90 degrees around Z swings the tip towards -X, the left of the frame.
    const centre = SIDE_SCENE.frame.width * 2;
    expect(opaqueBounds(bent)?.x ?? centre).toBeLessThan(centre - 40);
    expect(opaqueBounds(rest)?.x ?? 0).toBeGreaterThan(centre - 20);
  });

  it('reports unknown clips and unreadable models with typed errors', async () => {
    await expect(
      renderAll(backend, cube, CUBE_SCENE, [{ key: 'x', clip: 'dance', time: 0, yaw: 0 }]),
    ).rejects.toMatchObject({ code: 'E_RENDER_FAILED', message: expect.stringMatching(/dance/) });
    await expect(renderAll(backend, new Uint8Array([1, 2, 3, 4]), CUBE_SCENE, D4)).rejects.toMatchObject({
      code: 'E_MODEL_INVALID',
    });
  });
});

describe('reproducibility and limits', () => {
  it('produces byte-identical frames from separate browser launches', async () => {
    const cube = await cubeGlb();
    const runs: RenderedFrame[][] = [];
    for (let i = 0; i < 2; i++) {
      const backend = new PlaywrightBackend();
      try {
        runs.push(await renderAll(backend, cube, CUBE_SCENE, D4));
      } finally {
        await backend.stop();
      }
    }
    const [a, b] = runs as [RenderedFrame[], RenderedFrame[]];
    for (const [i, frame] of a.entries()) {
      expect(Buffer.compare(Buffer.from(frame.rgba), Buffer.from((b[i] as RenderedFrame).rgba)), frame.key).toBe(0);
    }
  });

  it('renders 64 frames at 128 x 128 in under 3 seconds including browser start', async () => {
    const arm = await armGlb();
    const samples: FrameSample[] = [];
    for (let d = 0; d < 16; d++)
      for (let t = 0; t < 4; t++) samples.push({ key: `${d}/${t}`, clip: 'wave', time: t / 4, yaw: d * 22.5 });
    const started = performance.now();
    const backend = new PlaywrightBackend();
    try {
      const frames = await renderAll(
        backend,
        arm,
        { ...SIDE_SCENE, frame: { width: 32, height: 32 }, pixelsPerUnit: 8 },
        samples,
      );
      expect(frames).toHaveLength(64);
    } finally {
      await backend.stop();
    }
    const elapsed = performance.now() - started;
    console.log(`64 frames at 128x128: ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  it('delivers frames in sample order while the next batch renders, and stops cleanly when the sink fails', async () => {
    const cube = await cubeGlb();
    const backend = new PlaywrightBackend({ batchSize: 3 });
    const samples: FrameSample[] = Array.from({ length: 10 }, (_, i) => ({
      key: `s${i}`,
      clip: null,
      time: 0,
      yaw: i * 36,
    }));
    try {
      const seen: string[] = [];
      const indexes: number[] = [];
      await backend.render({ model: { glb: cube }, scene: CUBE_SCENE, samples }, async (frame, index) => {
        // A slow sink: the browser is already rendering the next batch meanwhile.
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(frame.key);
        indexes.push(index);
      });
      expect(seen).toEqual(samples.map((s) => s.key));
      expect(indexes).toEqual(samples.map((_, i) => i));
      // Pipelined output matches one batch at a time.
      const serial = new PlaywrightBackend({ batchSize: 64 });
      try {
        const one = await renderAll(serial, cube, CUBE_SCENE, samples);
        const many = await renderAll(backend, cube, CUBE_SCENE, samples);
        for (const [i, frame] of one.entries())
          expect(Buffer.compare(Buffer.from(frame.rgba), Buffer.from((many[i] as RenderedFrame).rgba)), frame.key).toBe(
            0,
          );
      } finally {
        await serial.stop();
      }
      // A sink that fails while the next batch is in flight rejects with its own error.
      const failure = await backend
        .render({ model: { glb: cube }, scene: CUBE_SCENE, samples }, (_frame, index) => {
          if (index === 4) throw new Error('sink failed');
        })
        .catch((e: unknown) => e);
      expect([(failure as Td2dError).code, (failure as Td2dError).message]).toEqual([
        'E_RENDER_FAILED',
        'Rendering failed: sink failed',
      ]);
      expect(await renderAll(backend, cube, CUBE_SCENE, samples.slice(0, 2))).toHaveLength(2);
    } finally {
      await backend.stop();
    }
  });

  it('cancels promptly and can start again afterwards', async () => {
    const cube = await cubeGlb();
    const backend = new PlaywrightBackend({ batchSize: 4 });
    const controller = new AbortController();
    const samples: FrameSample[] = Array.from({ length: 400 }, (_, i) => ({
      key: String(i),
      clip: null,
      time: 0,
      yaw: i,
    }));
    let abortedAt = 0;
    const rendering = backend.render(
      { model: { glb: cube }, scene: CUBE_SCENE, samples },
      (_frame, index) => {
        if (index === 0) {
          abortedAt = performance.now();
          controller.abort();
        }
      },
      { signal: controller.signal },
    );
    const error = (await rendering.catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_CANCELLED');
    expect(performance.now() - abortedAt).toBeLessThan(2000);
    await backend.stop();
    const again = await renderAll(backend, cube, CUBE_SCENE, [D4[0] as FrameSample]);
    expect(again).toHaveLength(1);
    await backend.stop();
  });
});
