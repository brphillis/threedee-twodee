import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { runJson, tempDir } from './helpers.ts';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'characters');

function copy() {
  const root = join(tempDir(), 'characters');
  cpSync(EXAMPLE, root, {
    recursive: true,
    filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
  });
  return root;
}

interface StageResult {
  name: string;
  status: string;
}
const stages = (envelope: { data?: unknown }) =>
  Object.fromEntries(
    ((envelope.data as { results: { stages: StageResult[] }[] }).results[0]?.stages ?? []).map((s) => [
      s.name,
      s.status,
    ]),
  );

describe('the knight example', () => {
  it('generates an 8-direction, 3-clip sheet that passes validation, and reruns only the rig onwards when a key changes', async () => {
    const root = copy();
    const generated = await runJson(['generate', 'characters/knight'], { cwd: root });
    expect(generated.exitCode, generated.stderr).toBe(0);
    const result = (
      generated.envelope.data as { results: { validation: { status: string }; outputs: Record<string, string> }[] }
    ).results[0];
    expect(result?.validation.status).toBe('pass');
    const manifest = JSON.parse(readFileSync(join(root, result?.outputs.manifest ?? ''), 'utf8')) as {
      directions: string[];
      clips: { name: string; frames: number }[];
      cells: unknown[];
    };
    expect(manifest.directions).toHaveLength(8);
    expect(manifest.clips.map((c) => [c.name, c.frames])).toEqual([
      ['idle', 10],
      ['walk', 8],
      ['attack', 6],
    ]);
    expect(manifest.cells).toHaveLength(8 * (10 + 8 + 6));
    const report = JSON.parse(readFileSync(join(root, result?.outputs.validation ?? ''), 'utf8')) as {
      checks: { id: string; status: string }[];
    };
    expect(report.checks.find((c) => c.id === 'jitter')?.status).toBe('pass');

    const file = join(root, 'assets/characters/knight/asset.json');
    const asset = JSON.parse(readFileSync(file, 'utf8')) as {
      animation: { clips: { attack: { keys: { pose: Record<string, { rotation: number[] }> }[] } } };
    };
    (asset.animation.clips.attack.keys[2]?.pose.rightUpperArm as { rotation: number[] }).rotation = [-30, 0, 0];
    writeFileSync(file, JSON.stringify(asset));
    const again = await runJson(['generate', 'characters/knight'], { cwd: root });
    expect(again.exitCode, again.stderr).toBe(0);
    expect(stages(again.envelope)).toMatchObject({ model: 'cached', rig: 'ran', plan: 'ran', render: 'ran' });

    // Without planted feet, a stride far past what the bob allows lifts the feet off the ground.
    const walk = asset.animation.clips as unknown as { walk: { generator: { stride: number; ik: boolean } } };
    walk.walk.generator.stride = 50;
    walk.walk.generator.ik = false;
    writeFileSync(file, JSON.stringify(asset));
    const planned = await runJson(['generate', 'characters/knight', '--to', 'plan'], { cwd: root });
    expect(planned.exitCode, planned.stderr).toBe(0);
    expect(planned.envelope.warnings?.map((w) => w.code)).toContain('W_CLIP_FOOT_CONTACT');
  });

  it('inspects clips, keys and the rig, renders filtered frames and previews one clip', async () => {
    const root = copy();
    const keys = await runJson(['model', 'inspect', 'characters/knight', '--clip', 'walk', '--keys'], { cwd: root });
    expect(keys.exitCode, keys.stderr).toBe(0);
    const clip = (
      keys.envelope.data as { clip: { source: string; keyCount: number; keys: { t: number }[]; bones: string[] } }
    ).clip;
    expect(clip.source).toBe('generator');
    expect(clip.keys.map((k) => k.t)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(clip.bones).toContain('leftUpperLeg');
    expect((await runJson(['model', 'inspect', 'characters/knight', '--keys'], { cwd: root })).exitCode).toBe(2);
    expect(
      (await runJson(['model', 'inspect', 'characters/knight', '--clip', 'run'], { cwd: root })).envelope.error?.code,
    ).toBe('E_USAGE');

    const rig = await runJson(['rig', 'show', 'characters/knight'], { cwd: root });
    const bones = (rig.envelope.data as { bones: { name: string; parts: string[] }[] }).bones;
    expect(bones).toHaveLength(19);
    expect(bones.find((b) => b.name === 'rightLowerArm')?.parts).toEqual(
      expect.arrayContaining(['knight-blade', 'knight-grip', 'knight-forearm-mx']),
    );
    const presets = await runJson(['rig', 'list'], { cwd: root });
    expect((presets.envelope.data as { presets: { name: string }[] }).presets.map((p) => p.name)).toContain(
      'quadruped-basic',
    );

    const render = await runJson(['render', 'characters/knight', '--frames', 'walk/s/0-1', '--frames', 'attack/n/5'], {
      cwd: root,
    });
    expect(render.exitCode, render.stderr).toBe(0);
    const plan = JSON.parse(readFileSync(join(root, 'build/characters/knight/plan.json'), 'utf8')) as {
      samples: { key: string }[];
    };
    expect(plan.samples.map((s) => s.key)).toEqual(['walk/s/000', 'walk/s/001', 'attack/n/005']);
    const bad = await runJson(['render', 'characters/knight', '--clips', 'run'], { cwd: root });
    expect([bad.exitCode, bad.envelope.error?.code]).toEqual([2, 'E_USAGE']);

    expect((await runJson(['generate', 'characters/knight'], { cwd: root })).exitCode).toBe(0);
    const preview = await runJson(['preview', 'characters/knight', '--clip', 'walk', '--scale', '2'], { cwd: root });
    expect(preview.exitCode, preview.stderr).toBe(0);
    const meta = await sharp(join(root, (preview.envelope.data as { file: string }).file)).metadata();
    // Eight frames in a row for each of eight directions, with a 2 px grid between cells.
    expect([meta.width, meta.height]).toEqual([8 * 192 + 9 * 2, 8 * 192 + 9 * 2]);
  });
});
