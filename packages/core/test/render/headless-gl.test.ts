// Q13: the optional headless-gl backend against the Playwright SwiftShader goldens. Where it
// cannot run, the test checks td2d doctor says so, which is how an unsupported platform is reported.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkHeadlessGl,
  generateAssets,
  HeadlessGlBackend,
  loadProject,
  probeHeadlessGl,
  type RenderedFrame,
  readPng,
} from '../../src/index.ts';
import { armGlb, cubeGlb, cylinderGlb } from '../fixtures/models.ts';
import { tempDir, writeJson } from '../helpers/tmp.ts';
import { expectGolden, RENDER_TOLERANCE } from './golden.ts';
import { arm, CUBE_SCENE, SIDE_SCENE } from './scenes.ts';

const probe = probeHeadlessGl();
const REPO = join(import.meta.dirname, '..', '..', '..', '..');

describe.runIf(!probe.ok)('headless-gl where it cannot run', () => {
  it('is reported by td2d doctor with the reason and a hint, never as a failure', () => {
    const check = checkHeadlessGl();
    expect(check.status).toBe('skip');
    expect(check.message).toMatch(/unavailable/);
    expect(check.hint).toMatch(/gl@/);
  });
});

describe.runIf(probe.ok)('headless-gl backend parity with Playwright SwiftShader', () => {
  const backend = new HeadlessGlBackend();
  afterAll(() => backend.stop());

  async function render(
    glb: Uint8Array,
    scene: typeof CUBE_SCENE,
    samples: { key: string; clip: string | null; time: number; yaw: number }[],
  ) {
    const frames: RenderedFrame[] = [];
    await backend.render({ model: { glb }, scene, samples }, (f) => {
      frames.push(f);
    });
    return frames;
  }

  it('starts on a WebGL2 context and says it is not a software rasteriser', async () => {
    const info = await backend.start();
    expect(info.id).toBe('headless-gl');
    expect(info.renderer).toMatch(/^headless-gl /);
    expect(info.software).toBe(false);
  });

  it('matches the static and animated goldens within the render tolerance', async () => {
    const [cube] = await render(await cubeGlb(), CUBE_SCENE, [{ key: 's', clip: null, time: 0, yaw: 0 }]);
    await expectGolden('cube-dimetric-s', cube as RenderedFrame, RENDER_TOLERANCE, 'headless-gl/cube-dimetric-s');
    const [cylinder] = await render(
      await cylinderGlb(),
      { ...SIDE_SCENE, frame: { width: 32, height: 32 }, camera: { ...SIDE_SCENE.camera, groundMargin: 2 } },
      [{ key: 'side', clip: null, time: 0, yaw: 0 }],
    );
    await expectGolden('cylinder-side', cylinder as RenderedFrame, RENDER_TOLERANCE, 'headless-gl/cylinder-side');
    const [wave] = await render(await armGlb(), SIDE_SCENE, [{ key: 'wave', clip: 'wave', time: 0.5, yaw: 0 }]);
    await expectGolden('arm-wave-0.5', wave as RenderedFrame, RENDER_TOLERANCE, 'headless-gl/arm-wave-0.5');
  });

  it('renders the rigid and skinned elbow goldens through the pipeline', async () => {
    const root = tempDir();
    writeJson(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'rigs' });
    for (const skin of ['rigid', 'two-bone-blend'] as const)
      writeJson(root, `assets/arms/${skin === 'rigid' ? 'rigid' : 'skinned'}/asset.json`, {
        ...arm(skin),
        render: { backend: 'headless-gl' },
      });
    const project = loadProject(root);
    const results = await generateAssets({ project, history: false, to: 'render' });
    for (const r of results) {
      // headless-gl is not a software rasteriser, so it warns that output can vary between machines.
      expect(r.status, JSON.stringify(r.error)).toBe('warn');
      expect(r.warnings.map((w) => w.code)).toEqual(['W_HARDWARE_RENDERER']);
      expect(r.backend?.id).toBe('headless-gl');
    }
    for (const id of ['arms/rigid', 'arms/skinned'])
      for (const [i, t] of ['0', '05', '1'].entries()) {
        const frame = await readPng(join(project.paths.build, id, 'renders', 'bend', 's', `00${i}.png`));
        const name = `rig-${id.split('/')[1]}-elbow-t${t}`;
        await expectGolden(name, { ...frame, key: name }, RENDER_TOLERANCE, `headless-gl/${name}`);
      }
  });

  it('generates the starter crate sheet within the render tolerance of the committed one', async () => {
    const root = tempDir();
    writeJson(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'starter' });
    const crate = JSON.parse(
      readFileSync(join(REPO, 'examples/starter/assets/props/crate/asset.json'), 'utf8'),
    ) as object;
    writeJson(root, 'assets/props/crate/asset.json', { ...crate, render: { backend: 'headless-gl' } });
    const [result] = await generateAssets({ project: loadProject(root), history: false });
    expect(result?.status, JSON.stringify(result?.error)).toBe('warn');
    expect(result?.warnings.map((w) => w.code)).toEqual(['W_HARDWARE_RENDERER']);
    const sheet = await readPng(join(root, 'build/props/crate/sheets/crate.png'));
    const expected = await readPng(join(REPO, 'examples/starter/expected/props/crate/crate.png'));
    expect([sheet.width, sheet.height]).toEqual([expected.width, expected.height]);
    const mismatched = pixelmatch(sheet.rgba, expected.rgba, undefined, sheet.width, sheet.height, {
      threshold: RENDER_TOLERANCE.threshold,
      includeAA: true,
    });
    expect(mismatched / (sheet.width * sheet.height)).toBeLessThanOrEqual(RENDER_TOLERANCE.maxDiffRatio);
  });
});
