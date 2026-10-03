import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClipGenerator, DOCUMENTS, PartDefinition } from '@td2d/schema';
import { describe, expect, it } from 'vitest';
import {
  buildModel,
  createImage,
  describeCapabilities,
  EXPORTERS,
  type ExportContext,
  generateKeys,
  layoutSheets,
  listPartBuilders,
  loadAsset,
  loadLibrary,
  loadProject,
  PART_VERSIONS,
  processFrames,
  resolveAsset,
  writePng,
} from '../src/index.ts';
import { CRATE, makeProject, writeJson } from './helpers/tmp.ts';

describe('describeCapabilities', () => {
  const caps = describeCapabilities(loadLibrary(), { schemas: true });

  it('lists every part type with a valid example and a schema', () => {
    expect(caps.partTypes.map((p) => p.type)).toEqual([
      'box',
      'cylinder',
      'cone',
      'sphere',
      'capsule',
      'torus',
      'plane',
      'wedge',
      'lathe',
      'extrude',
      'group',
      'csg',
      'component',
      'import',
    ]);
    for (const part of caps.partTypes) {
      expect(PartDefinition.safeParse(part.example).success, part.type).toBe(true);
      expect(part.schema).toBeTypeOf('object');
    }
  });

  it('lists presets, palettes, templates and error codes', () => {
    expect(caps.presets.camera.map((p) => p.name)).toContain('dimetric');
    expect(caps.palettes.find((p) => p.name === 'pico-8')?.colors).toBe(16);
    expect(caps.templates.projects).toContain('starter');
    expect(caps.errors.find((e) => e.code === 'E_ASSET_INVALID')).toMatchObject({
      exit: 3,
      docs: 'docs/reference/errors.md#e_asset_invalid',
    });
  });

  it('is honest about what is implemented', () => {
    expect(caps.stages.pipeline).toEqual([
      'resolve',
      'model',
      'rig',
      'plan',
      'render',
      'pixel',
      'sheet',
      'validate',
      'export',
    ]);
    expect(caps.stages.planned).toEqual([]);
    expect(caps.rigs.map((r) => r.name)).toEqual(['humanoid-basic', 'none', 'quadruped-basic']);
    expect(caps.rigs.find((r) => r.name === 'humanoid-basic')?.bones).toHaveLength(15);
    expect(caps.generators.map((g) => g.type)).toEqual(['walk-cycle', 'idle-breathe', 'bob', 'spin']);
    expect(caps.easings).toContain('ease-in-out');
    expect(caps.pixelPasses.map((p) => p.id)).toEqual([
      'downscale',
      'alphaThreshold',
      'posterize',
      'palette',
      'outline',
      'cleanup',
      'bleed',
    ]);
    expect(caps.backends).toEqual([
      expect.objectContaining({
        id: 'playwright-swiftshader',
        description: expect.stringMatching(/SwiftShader/),
        default: true,
      }),
      expect.objectContaining({
        id: 'headless-gl',
        description: expect.stringMatching(/optional/i),
        default: false,
      }),
    ]);
  });
});

const REPO = join(import.meta.dirname, '..', '..', '..');

/** GitHub's heading anchors for a Markdown file, plus explicit <a id> anchors. */
function anchorsOf(file: string): Set<string> {
  const text = readFileSync(join(REPO, file), 'utf8');
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading)
      anchors.add(
        (heading[1] as string)
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N} _-]/gu, '')
          .replace(/ /g, '-'),
      );
    for (const m of line.matchAll(/<a id="([^"]+)"/g)) anchors.add(m[1] as string);
  }
  return anchors;
}

function expectDocs(docs: unknown, what: string) {
  expect(typeof docs, what).toBe('string');
  const [path, anchor] = String(docs).split('#') as [string, string | undefined];
  expect(existsSync(join(REPO, path)), `${what}: ${path} exists`).toBe(true);
  expect(anchor, `${what}: ${docs} has an anchor`).toBeTruthy();
  expect(anchorsOf(path).has(anchor as string), `${what}: ${docs} anchor exists`).toBe(true);
}

/** Every material name used by a part tree, so a test asset can define them. */
function materialsOf(part: unknown, out = new Set<string>()): Set<string> {
  if (part && typeof part === 'object') {
    const p = part as { material?: unknown; parts?: unknown[] };
    if (typeof p.material === 'string') out.add(p.material);
    for (const child of p.parts ?? []) materialsOf(child, out);
  }
  return out;
}

describe('describe completeness', () => {
  const caps = describeCapabilities(loadLibrary(), { schemas: true });
  const entries: { what: string; entry: Record<string, unknown> }[] = [
    ...caps.partTypes.map((e) => ({ what: `part ${e.type}`, entry: e })),
    ...Object.values(caps.presets).flatMap((list) =>
      list.map((e) => ({ what: `preset ${e.name}`, entry: e as unknown as Record<string, unknown> })),
    ),
    ...caps.palettes.map((e) => ({ what: `palette ${e.name}`, entry: e })),
    ...caps.rigs.map((e) => ({ what: `rig ${e.name}`, entry: e })),
    ...caps.generators.map((e) => ({ what: `generator ${e.type}`, entry: e })),
    ...caps.pixelPasses.map((e) => ({ what: `pass ${e.id}`, entry: e })),
    ...caps.exporters.map((e) => ({ what: `exporter ${e.id}`, entry: e })),
    ...caps.backends.map((e) => ({ what: `backend ${e.id}`, entry: e })),
  ];

  it('gives every registry entry a version, a description, an option schema, an example and a docs anchor', () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const { what, entry } of entries) {
      expect(['number', 'string'], `${what} version`).toContain(typeof entry.version);
      expect(String(entry.description ?? ''), `${what} description`).not.toBe('');
      expect(entry.schema, `${what} schema`).toBeTypeOf('object');
      expect(entry.example, `${what} example`).toBeTruthy();
      expectDocs(entry.docs, what);
    }
    for (const t of caps.templates.entries) {
      expect(typeof t.name, 'template name').toBe('string');
      expect(t.example).toMatch(new RegExp(`--template ${t.name}$`));
      expectDocs(t.docs, `template ${t.name}`);
    }
    for (const d of caps.documents) expectDocs(d.docs, `document ${d.name}`);
    expectDocs(caps.directions.docs, 'directions');
    expectDocs(caps.easingDocs, 'easings');
    // Every exporter and every part type has an entry.
    expect(caps.exporters.map((e) => e.id).sort()).toEqual(Object.keys(EXPORTERS).sort());
    expect(Object.keys(PART_VERSIONS).sort()).toEqual([...caps.partTypes.map((p) => p.type)].sort());
    expect(listPartBuilders().sort()).toEqual(
      caps.partTypes
        .map((p) => p.type)
        .filter((t) => !['group', 'csg', 'component', 'import'].includes(t))
        .sort(),
    );
  });

  it('has a valid example for every input document', () => {
    for (const d of caps.documents.filter((x) => x.kind === 'input')) {
      expect(d.example, `${d.name} example`).toBeTruthy();
      const doc = DOCUMENTS.find((x) => x.name === d.name);
      expect(doc?.schema.safeParse(d.example).success, `${d.name} example parses`).toBe(true);
    }
  });

  it('builds the example of every part type', async () => {
    for (const part of caps.partTypes) {
      const materials = Object.fromEntries(
        [...materialsOf(part.example), 'wood'].map((m) => [m, { color: '#a0693a' }]),
      );
      const root = makeProject(
        {},
        { schemaVersion: '1.0.0', type: 'prop', materials, model: { parts: [part.example] } },
      );
      // The component and import examples name files: provide them.
      const component = DOCUMENTS.find((d) => d.name === 'component')?.schema.meta()?.examples as unknown[];
      writeJson(root, 'components/fence-post.json', component[0]);
      const project = loadProject(root);
      if (part.type === 'import') {
        // A real GLB to import: the starter crate, built.
        const plain = makeProject();
        const plainProject = loadProject(plain);
        const crate = resolveAsset(plainProject, loadAsset(plainProject, 'props/crate'), loadLibrary(plainProject));
        mkdirSync(join(root, 'assets/props/crate/import'), { recursive: true });
        writeFileSync(
          join(root, 'assets/props/crate/import/teapot.glb'),
          (await buildModel(crate.asset, { projectRoot: plain })).glb,
        );
      }
      const resolved = resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
      const built = await buildModel(resolved.asset, { projectRoot: root });
      expect(built.report.triangles, part.type).toBeGreaterThan(0);
    }
  }, 60_000);

  it('resolves every preset, palette, rig, backend, pixel pass and exporter example on a real asset', () => {
    const root = makeProject();
    const project = loadProject(root);
    const library = loadLibrary(project);
    const examples = entries.filter((e) => !e.what.startsWith('part ') && !e.what.startsWith('generator '));
    for (const { what, entry } of examples) {
      writeJson(root, 'assets/props/crate/asset.json', { ...CRATE, ...(entry.example as object) });
      const resolved = resolveAsset(project, loadAsset(project, 'props/crate'), library);
      expect(resolved.asset.id, what).toBe('props/crate');
    }
  });

  it('bakes every generator example on the humanoid rig', () => {
    const root = makeProject();
    const project = loadProject(root);
    for (const g of caps.generators) {
      writeJson(root, 'assets/props/crate/asset.json', {
        ...CRATE,
        rig: 'humanoid-basic',
        animation: { fps: 10, clips: { test: { duration: 1, generator: g.example } } },
      });
      const { asset } = resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
      const clip = asset.animation.clips.test as NonNullable<(typeof asset.animation.clips)[string]>;
      const keys = generateKeys(ClipGenerator.parse(g.example), asset.rig, clip.duration, clip.times);
      expect(keys, g.type).toHaveLength(clip.frames);
    }
  });

  it('runs every pixel pass example over real frames', () => {
    const root = makeProject();
    const project = loadProject(root);
    const frame = createImage(16, 16);
    for (let i = 0; i < 16 * 16; i++) if (i % 3) frame.rgba.set([i % 255, 80, 160, 255], i * 4);
    for (const pass of caps.pixelPasses) {
      writeJson(root, 'assets/props/crate/asset.json', { ...CRATE, ...(pass.example as object) });
      const { asset } = resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
      const result = processFrames(
        [{ key: 'idle/s/000', clip: 'idle', image: frame }],
        4,
        asset.pixel,
        asset.paletteColors,
      );
      expect(result.sprites.get('idle/s/000')?.width, pass.id).toBe(4);
    }
  });

  it('runs every exporter on a laid-out sheet', async () => {
    const root = makeProject();
    const project = loadProject(root);
    const sprite = createImage(8, 8);
    for (let i = 0; i < 64; i++) if (i % 2) sprite.rgba.set([200, 100, 50, 255], i * 4);
    const sprites = new Map([
      ['idle/s/000', sprite],
      ['idle/s/001', sprite],
    ]);
    for (const exporter of caps.exporters) {
      writeJson(root, 'assets/props/crate/asset.json', { ...CRATE, ...(exporter.example as object) });
      const { asset } = resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
      const layout = layoutSheets(
        [{ clip: 'idle', direction: 's', keys: [...sprites.keys()] }],
        sprites,
        { width: 8, height: 8 },
        asset.sheet,
        'crate',
      );
      const dir = join(root, `out-${exporter.id}`);
      mkdirSync(dir, { recursive: true });
      const spriteFiles = new Map<string, string>();
      for (const [key, img] of sprites) {
        const file = join(dir, `${key.replace(/\//g, '_')}.png`);
        await writePng(file, img);
        spriteFiles.set(key, file);
      }
      const ctx: ExportContext = {
        asset: {
          ...asset,
          frame: { width: 8, height: 8 },
          animation: { fps: 10, clips: { idle: { ...asset.animation.clips.idle, frames: 2 } } },
        } as never,
        name: 'crate',
        dir,
        layout,
        images: layout.pages.map((p) => `${p.name}.png`),
        pivot: { x: 4, y: 7 },
        sprites: async () => sprites,
        spriteFiles,
        writeImage: async (source, target) => {
          writeFileSync(join(dir, target), readFileSync(source));
        },
      };
      const files = await EXPORTERS[exporter.id as keyof typeof EXPORTERS].write(ctx);
      expect(files.length, exporter.id).toBeGreaterThan(0);
      for (const f of files) expect(existsSync(join(dir, f)), `${exporter.id} wrote ${f}`).toBe(true);
    }
  });
});
