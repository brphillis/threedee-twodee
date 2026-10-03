import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AsepriteSheet, GenerationRecord, Manifest, PART_SCHEMAS, PART_TYPES, ValidationReport } from '@td2d/schema';
import { describe, expect, it } from 'vitest';
import {
  type AssetGenerateResult,
  generateAssets,
  initProject,
  listHistory,
  loadProject,
  readPng,
  type Td2dError,
} from '../../src/index.ts';
import { tempDir } from '../helpers/tmp.ts';

function starter() {
  const dir = join(tempDir(), 'game');
  initProject({ dir, name: 'game' });
  return dir;
}

async function generate(
  dir: string,
  extra: Partial<Parameters<typeof generateAssets>[0]> = {},
): Promise<AssetGenerateResult> {
  const [result] = await generateAssets({ project: loadProject(dir), ...extra });
  if (!result) throw new Error('no result');
  return result;
}

const statuses = (r: AssetGenerateResult) => Object.fromEntries(r.stages.map((s) => [s.name, s.status]));
const editAsset = (dir: string, edit: (asset: Record<string, unknown>) => void) => {
  const file = join(dir, 'assets/props/crate/asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(asset);
  writeFileSync(file, JSON.stringify(asset));
};

describe('the end-to-end pipeline on the starter crate', () => {
  it('produces a validated sheet, Aseprite data, a manifest and a record', async () => {
    const dir = starter();
    const r = await generate(dir);
    expect(r.status).toBe('ok');
    expect(r.validation).toEqual({ status: 'pass', warnings: 0, errors: 0 });
    expect(r.cache).toEqual({ hits: 0, misses: 9 });
    expect(r.backend?.software).toBe(true);
    const build = join(dir, 'build/props/crate');
    const sheet = await readPng(join(build, 'sheets/crate.png'));
    expect([sheet.width, sheet.height]).toEqual([32, 128]);
    for (const d of ['s', 'w', 'n', 'e']) {
      const sprite = await readPng(join(build, `sprites/idle/${d}/000.png`));
      expect([sprite.width, sprite.height]).toEqual([32, 32]);
      const render = await readPng(join(build, `renders/idle/${d}/000.png`));
      expect([render.width, render.height]).toEqual([128, 128]);
    }
    const aseprite = AsepriteSheet.parse(JSON.parse(readFileSync(join(build, 'sheets/crate.json'), 'utf8')));
    expect(aseprite.meta.frameTags.map((t) => t.name)).toEqual(['idle_s', 'idle_w', 'idle_n', 'idle_e']);
    const manifest = Manifest.parse(JSON.parse(readFileSync(join(build, 'sheets/manifest.json'), 'utf8')));
    expect(manifest.cells).toHaveLength(4);
    expect(manifest.camera.groundMargin).toBe(7);
    expect(manifest.pivot).toEqual({ x: 16, y: 25, normalized: { x: 0.5, y: 0.78125 } });
    ValidationReport.parse(JSON.parse(readFileSync(join(build, 'validation.json'), 'utf8')));
    const record = GenerationRecord.parse(JSON.parse(readFileSync(join(build, 'generation.json'), 'utf8')));
    expect(record.outputs.map((o) => o.path)).toContain('sheets/crate.png');
    expect(listHistory(loadProject(dir), 'props/crate')).toHaveLength(1);
  });

  it('reuses every stage on an unchanged rerun and writes byte-identical sheets', async () => {
    const dir = starter();
    await generate(dir);
    const first = readFileSync(join(dir, 'build/props/crate/sheets/crate.png'));
    const warm = await generate(dir);
    expect(warm.cache).toEqual({ hits: 9, misses: 0 });
    expect(Buffer.compare(first, readFileSync(join(dir, 'build/props/crate/sheets/crate.png')))).toBe(0);
    expect(listHistory(loadProject(dir), 'props/crate')).toHaveLength(1);
    const forced = await generate(dir, { force: true });
    expect(forced.cache).toEqual({ hits: 0, misses: 9 });
    expect(Buffer.compare(first, readFileSync(join(dir, 'build/props/crate/sheets/crate.png')))).toBe(0);
  });

  it('keeps geometry and planning when a material colour changes', async () => {
    const dir = starter();
    await generate(dir);
    editAsset(dir, (a) => {
      (a.materials as Record<string, { color: string }>).wood = { color: '#7a4a2a' };
    });
    const r = await generate(dir);
    expect(statuses(r)).toEqual({
      resolve: 'ran',
      model: 'cached',
      rig: 'cached',
      plan: 'cached',
      render: 'ran',
      pixel: 'ran',
      sheet: 'ran',
      validate: 'ran',
      export: 'ran',
    });
    expect(listHistory(loadProject(dir), 'props/crate')).toHaveLength(2);
  });

  it('reports planned work in a dry run without running anything', async () => {
    const dir = starter();
    const cold = await generate(dir, { dryRun: true });
    expect(cold.dryRun).toBe(true);
    expect(Object.values(statuses(cold))).toEqual(Array(9).fill('would-run'));
    expect(existsSync(join(dir, 'build'))).toBe(false);
    await generate(dir);
    expect(statuses(await generate(dir, { dryRun: true, from: 'pixel' }))).toMatchObject({
      render: 'would-reuse',
      pixel: 'would-run',
      export: 'would-run',
    });
  });

  it('stops after a stage and keeps later outputs that are still valid', async () => {
    const dir = starter();
    await generate(dir);
    const r = await generate(dir, { to: 'model' });
    expect(statuses(r)).toMatchObject({ model: 'cached', plan: 'skipped', export: 'skipped' });
    expect(existsSync(join(dir, 'build/props/crate/sheets/crate.png'))).toBe(true);
    editAsset(dir, (a) => {
      (a.materials as Record<string, { color: string }>).iron = { color: '#000000' };
    });
    await generate(dir, { to: 'render' });
    expect(existsSync(join(dir, 'build/props/crate/sheets'))).toBe(false);
    expect(existsSync(join(dir, 'build/props/crate/renders/idle/s/000.png'))).toBe(true);
  });

  it('records per-clip palettes in the manifest and warns that colours can jump between clips', async () => {
    const dir = starter();
    editAsset(dir, (asset) => {
      asset.animation = { fps: 10, clips: { idle: { duration: 0.1 }, hold: { duration: 0.1 } } };
      asset.pixel = { palette: 'auto:4', paletteScope: 'clip' };
    });
    const r = await generate(dir);
    expect(r.status).toBe('warn');
    expect(r.warnings.map((w) => w.code)).toContain('W_PALETTE_PER_CLIP');
    const manifest = Manifest.parse(
      JSON.parse(readFileSync(join(dir, 'build/props/crate/sheets/manifest.json'), 'utf8')),
    );
    expect(Object.keys(manifest.palette.byClip ?? {}).sort()).toEqual(['hold', 'idle']);
    expect(manifest.palette.byClip?.idle?.length).toBeLessThanOrEqual(4);
    editAsset(dir, (asset) => {
      asset.pixel = { palette: 'auto:4' };
    });
    const shared = await generate(dir);
    expect(shared.warnings.map((w) => w.code)).not.toContain('W_PALETTE_PER_CLIP');
    expect(shared.stages.find((s) => s.name === 'render')?.status).toBe('cached');
  });

  it('fails validation with E_VALIDATION_FAILED while still writing the outputs', async () => {
    const dir = starter();
    editAsset(dir, (a) => {
      a.acceptance = { maxColors: 2 };
    });
    const r = await generate(dir);
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('E_VALIDATION_FAILED');
    expect(r.validation?.status).toBe('fail');
    expect(existsSync(join(dir, 'build/props/crate/sheets/crate.png'))).toBe(true);
  });

  it('treats validation warnings as failures in strict mode', async () => {
    const dir = starter();
    editAsset(dir, (a) => {
      const model = a.model as { parts: { position: number[] }[] };
      for (const p of model.parts) p.position = [0, 1.2, 0];
    });
    const relaxed = await generate(dir);
    expect(relaxed.status).toBe('warn');
    expect(relaxed.warnings.map((w) => w.code)).toContain('W_COMPOSITION_GROUND');
    const strict = await generate(dir, { strict: true });
    expect(strict.error?.code).toBe('E_VALIDATION_FAILED');
  });

  it('cancels during rendering with E_CANCELLED', async () => {
    const dir = starter();
    editAsset(dir, (a) => {
      a.directions = 'd16';
      a.frame = { width: 128, height: 128 };
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const error = (await generate(dir, { signal: controller.signal }).catch((e: unknown) => e)) as Td2dError;
    expect(error.code).toBe('E_CANCELLED');
  });
});

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', '..', 'examples');
const strip = (doc: Record<string, unknown>) => {
  // Stage hashes fingerprint the toolchain (harness bundle, library versions), not the output;
  // generator and meta.version carry the td2d version.
  const { generatedAt: _g, generator: _v, stages: _s, ...rest } = doc;
  if (rest.meta && typeof rest.meta === 'object') rest.meta = { ...(rest.meta as object), version: 'x' };
  return rest;
};
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe.each(readdirSync(EXAMPLES).filter((name) => existsSync(join(EXAMPLES, name, 'td2d.project.json'))))(
  'examples/%s',
  (name) => {
    const example = join(EXAMPLES, name);

    it('regenerates exactly the committed expected outputs', async () => {
      const dir = join(tempDir(), name);
      cpSync(example, dir, {
        recursive: true,
        filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
      });
      const results = await generateAssets({ project: loadProject(dir), history: false });
      for (const r of results) {
        expect(r.status, `${r.assetId}: ${JSON.stringify(r.error ?? r.warnings)}`).toBe('ok');
        const built = join(dir, 'build', r.assetId);
        const expected = join(example, 'expected', r.assetId);
        const manifest = json(join(built, 'sheets/manifest.json')) as {
          files: Record<string, string[]>;
          cells: unknown[];
        };
        // Every exported file except individual frame PNGs, which are only counted.
        const exported = Object.entries(manifest.files)
          .filter(([format]) => format !== 'frames')
          .flatMap(([, list]) => list)
          .map((f) => `sheets/${f}`);
        if (manifest.files.frames) expect(manifest.files.frames).toHaveLength(manifest.cells.length);
        const files = [...new Set([...exported, 'validation.json'])];
        if (process.env.TD2D_UPDATE_GOLDENS === '1') {
          rmSync(expected, { recursive: true, force: true });
          mkdirSync(expected, { recursive: true });
          for (const f of files) cpSync(join(built, f), join(expected, f.split('/').pop() as string));
        }
        expect(readdirSync(expected).sort(), `${r.assetId} files`).toEqual(
          files.map((f) => f.split('/').pop() as string).sort(),
        );
        for (const f of files) {
          const name = f.split('/').pop() as string;
          if (name.endsWith('.json')) {
            expect(strip(json(join(built, f))), `${r.assetId} ${name}`).toEqual(strip(json(join(expected, name))));
          } else {
            expect(
              Buffer.compare(readFileSync(join(built, f)), readFileSync(join(expected, name))),
              `${r.assetId} ${name} bytes`,
            ).toBe(0);
          }
        }
      }
    });
  },
);

describe('examples/starter', () => {
  it('matches the starter template it was created from', () => {
    const template = join(
      import.meta.dirname,
      '..',
      '..',
      'templates',
      'projects',
      'starter',
      'assets',
      'props',
      'crate',
      'asset.json',
    );
    expect(JSON.parse(readFileSync(join(EXAMPLES, 'starter', 'assets/props/crate/asset.json'), 'utf8'))).toEqual(
      JSON.parse(readFileSync(template, 'utf8')),
    );
  });
});

describe('part type examples', () => {
  it.each(PART_TYPES.filter((t) => t !== 'component' && t !== 'import'))(
    'renders the %s schema example into a validated sprite',
    async (type) => {
      const dir = join(tempDir(), 'shapes');
      initProject({ dir });
      const example = ((PART_SCHEMAS[type].meta()?.examples ?? []) as Record<string, unknown>[])[0] as Record<
        string,
        unknown
      >;
      const materials: Record<string, { color: string }> = {};
      const collectMaterials = (p: Record<string, unknown>) => {
        if (typeof p.material === 'string') materials[p.material] = { color: '#a0693a' };
        for (const child of (p.parts as Record<string, unknown>[] | undefined) ?? []) collectMaterials(child);
      };
      collectMaterials(example);
      writeFileSync(
        join(dir, 'assets/props/crate/asset.json'),
        JSON.stringify({
          schemaVersion: '1.0.0',
          type: 'prop',
          frame: { width: 48, height: 48 },
          directions: 'd1',
          materials,
          model: { parts: [example] },
        }),
      );
      const r = await generate(dir, { history: false });
      expect(r.status, JSON.stringify(r.warnings)).not.toBe('failed');
      expect(r.validation?.errors).toBe(0);
    },
  );
});
