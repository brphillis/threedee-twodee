import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAssets, loadProject, type PlanData, readPng } from '../../src/index.ts';
import { tempDir, writeJson } from '../helpers/tmp.ts';
import { expectGolden } from './golden.ts';
import { arm } from './scenes.ts';

/** An arm 1 m long on a two-bone rig, bending at the elbow, either skinned or as two rigid pieces. */
function project(assets: Record<string, unknown>) {
  const root = tempDir();
  writeJson(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'rigs' });
  for (const [id, asset] of Object.entries(assets)) writeJson(root, `assets/${id}/asset.json`, asset);
  return loadProject(root);
}

describe('rigged rendering', () => {
  it('renders a skinned and a rigid elbow bend at three times, matching the goldens', async () => {
    const p = project({ 'arms/skinned': arm('two-bone-blend'), 'arms/rigid': arm('rigid') });
    const results = await generateAssets({ project: p, history: false, to: 'render' });
    for (const r of results) expect(r.status, JSON.stringify(r.error ?? r.warnings)).toBe('ok');
    for (const id of ['arms/rigid', 'arms/skinned']) {
      for (const [i, t] of ['0', '05', '1'].entries()) {
        const frame = await readPng(join(p.paths.build, id, 'renders', 'bend', 's', `00${i}.png`));
        await expectGolden(`rig-${id.split('/')[1]}-elbow-t${t}`, { ...frame, key: `bend/s/00${i}` });
      }
    }
    // The bend changes the silhouette; the two styles differ at the joint but agree at rest.
    const at = async (id: string, i: number) => readPng(join(p.paths.build, id, 'renders', 'bend', 's', `00${i}.png`));
    const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, k) => n + (k % 4 === 3 && v !== b[k] ? 1 : 0), 0);
    expect(diff((await at('arms/skinned', 0)).rgba, (await at('arms/skinned', 2)).rgba)).toBeGreaterThan(500);
    expect(diff((await at('arms/skinned', 2)).rgba, (await at('arms/rigid', 2)).rgba)).toBeGreaterThan(0);
  });

  it('samples the same clip time to identical bytes in separate renders', async () => {
    const p = project({ 'arms/skinned': arm('two-bone-blend') });
    await generateAssets({ project: p, history: false, to: 'render' });
    const first = readFileSync(join(p.paths.build, 'arms/skinned', 'renders', 'bend', 's', '001.png'));
    const again = await generateAssets({ project: p, history: false, to: 'render', force: true });
    expect(again[0]?.stages.find((s) => s.name === 'render')?.status).toBe('ran');
    expect(
      Buffer.compare(first, readFileSync(join(p.paths.build, 'arms/skinned', 'renders', 'bend', 's', '001.png'))),
    ).toBe(0);
  });

  it('plans samples clip by clip, then direction, then frame', async () => {
    const asset = {
      ...arm('rigid'),
      directions: ['s', 'w'],
      animation: {
        fps: 10,
        clips: {
          bend: {
            duration: 0.2,
            keys: [
              { t: 0, pose: {} },
              { t: 0.1, pose: { elbow: { rotation: [0, 0, 45] } } },
            ],
          },
          rest: { duration: 0.1 },
        },
      },
    };
    const p = project({ 'arms/rigid': asset });
    const [r] = await generateAssets({ project: p, history: false, to: 'plan' });
    const plan = JSON.parse(readFileSync(join(p.paths.build, 'arms/rigid', 'plan.json'), 'utf8')) as PlanData;
    expect(r?.status, JSON.stringify(r?.warnings)).toBe('ok');
    expect(plan.samples.map((s) => `${s.key}@${s.time}:${s.clip}`)).toEqual([
      'bend/s/000@0:bend',
      'bend/s/001@0.1:bend',
      'bend/w/000@0:bend',
      'bend/w/001@0.1:bend',
      'rest/s/000@0:null',
      'rest/w/000@0:null',
    ]);
    expect(plan.rows.map((row) => `${row.clip}/${row.direction}`)).toEqual(['bend/s', 'bend/w', 'rest/s', 'rest/w']);
  });
});
