// Renders every picture in docs/guide from the real pipeline. Run after `pnpm build`:
//   pnpm docs:images
// TD2D_DOCS_IMAGES_OUT=<dir> writes them elsewhere; the docs test does that and compares the
// result with the committed images, so they cannot drift from what td2d produces.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BASE_SETTINGS,
  bleedEdges,
  boxDownscale,
  cleanupOrphans,
  compareBuilds,
  generateAssets,
  initProject,
  loadProject,
  mapToPalette,
  modeDownscale,
  outline,
  Palette,
  type Project,
  type RgbaImage,
  readBuild,
  readPng,
  readSnapshot,
  thresholdAlpha,
  writePng,
  writePreview,
} from '@td2d/core';
import { PART_SCHEMAS, PART_TYPES } from '@td2d/schema';

const repo = join(import.meta.dirname, '..');
const images = process.env.TD2D_DOCS_IMAGES_OUT ?? join(repo, 'docs', 'guide', 'images');
const work = mkdtempSync(join(tmpdir(), 'td2d-docs-'));
const palette = ['#a0693a', '#5b6770', '#3e8948', '#124e89', '#b55088'];

/** Keep only the first direction's cell of a one-column sheet preview. */
async function firstCell(file: string): Promise<void> {
  const image = await readPng(file);
  const height = Math.round(image.height / 4);
  await writePng(file, { width: image.width, height, rgba: image.rgba.slice(0, image.width * height * 4) });
}

async function partTypes(): Promise<void> {
  const out = join(images, 'models');
  for (const type of PART_TYPES.filter((t) => t !== 'component' && t !== 'import')) {
    const dir = join(work, 'parts', type);
    initProject({ dir });
    const example = ((PART_SCHEMAS[type].meta()?.examples ?? []) as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const materials: Record<string, { color: string }> = {};
    const collect = (p: Record<string, unknown>) => {
      if (typeof p.material === 'string' && !materials[p.material])
        materials[p.material] = { color: palette[Object.keys(materials).length % palette.length] as string };
      for (const child of (p.parts as Record<string, unknown>[] | undefined) ?? []) collect(child);
    };
    collect(example);
    writeFileSync(
      join(dir, 'assets/props/crate/asset.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        type: 'prop',
        frame: { width: 40, height: 40 },
        directions: 'd1',
        materials,
        model: { parts: [example] },
      }),
    );
    const project = loadProject(dir);
    await generateAssets({ project, history: false });
    await writePreview(readBuild(project, 'props/crate'), {
      scale: 4,
      background: 'checker',
      grid: false,
      out: join(out, `${type}.png`),
    });
  }
}

const generated = new Map<string, Promise<Project>>();

/** Generate a copy of an example project once and return it. */
function example(name: string): Promise<Project> {
  const existing = generated.get(name);
  if (existing) return existing;
  const made = (async () => {
    const dir = join(work, name);
    cpSync(join(repo, 'examples', name), dir, {
      recursive: true,
      filter: (src) => !/[/\\](build|history|expected|\.td2d[/\\]cache)$/.test(src),
    });
    const project = loadProject(dir);
    await generateAssets({ project, history: false });
    return project;
  })();
  generated.set(name, made);
  return made;
}

/** Images side by side on a light background, top-aligned, with a gap between them. */
function beside(parts: readonly RgbaImage[], gap = 8): RgbaImage {
  const width = parts.reduce((n, p) => n + p.width, 0) + gap * (parts.length - 1);
  const height = Math.max(...parts.map((p) => p.height));
  const out: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4).fill(255) };
  let x0 = 0;
  for (const p of parts) {
    for (let y = 0; y < p.height; y++)
      out.rgba.set(p.rgba.subarray(y * p.width * 4, (y + 1) * p.width * 4), (y * width + x0) * 4);
    x0 += p.width + gap;
  }
  return out;
}

/** A one-asset project in the work directory, generated. */
async function scratch(name: string, asset: Record<string, unknown>): Promise<Project> {
  const dir = join(work, 'scratch', name);
  initProject({ dir });
  writeFileSync(
    join(dir, 'assets/props/crate/asset.json'),
    JSON.stringify({ schemaVersion: '1.0.0', type: 'prop', ...asset }),
  );
  const project = loadProject(dir);
  await generateAssets({ project, history: false });
  return project;
}

/** The starter crate: what `td2d preview` shows after the getting-started walkthrough. */
async function starter(): Promise<void> {
  const project = await example('starter');
  const build = readBuild(project, 'props/crate');
  const out = join(images, 'getting-started');
  mkdirSync(out, { recursive: true });
  await writePreview(build, { scale: 4, background: 'checker', grid: true, out: join(out, 'crate-preview.png') });
  await writePreview(build, {
    scale: 4,
    background: 'checker',
    grid: false,
    layout: 'ring',
    out: join(out, 'crate-ring.png'),
  });
  // A raw supersampled render next to the sprite made from it, both at the render's size.
  const render = await readPng(join(build.dir, 'renders', 'idle', 's', '000.png'));
  const sprite = await readPng(join(build.dir, 'sprites', 'idle', 's', '000.png'));
  const rendering = join(images, 'rendering');
  mkdirSync(rendering, { recursive: true });
  await writePng(join(rendering, 'render-and-sprite.png'), beside([onChecker(render, 2), onChecker(sprite, 8)], 16));
}

/** The shading models side by side on one sphere. */
async function materials(): Promise<void> {
  const out = join(images, 'materials');
  mkdirSync(out, { recursive: true });
  const variants: Record<string, unknown>[] = [
    { shading: 'toon', bands: 3 },
    { shading: 'toon', bands: 2 },
    { shading: 'lambert' },
    { shading: 'flat' },
    { shading: 'toon', bands: 3, emissive: '#3a1a00' },
  ];
  const cells: RgbaImage[] = [];
  for (const [i, variant] of variants.entries()) {
    const project = await scratch(`shading-${i}`, {
      frame: { width: 32, height: 32 },
      directions: 'd1',
      materials: { paint: { color: '#4f7fd0', ...variant } },
      model: { parts: [{ type: 'sphere', id: 'ball', material: 'paint', radius: 0.5, position: [0, 0.5, 0] }] },
    });
    cells.push(
      onChecker(await readPng(join(readBuild(project, 'props/crate').dir, 'sprites', 'idle', 's', '000.png')), 4),
    );
  }
  await writePng(join(out, 'shading.png'), beside(cells));

  // The same sphere shaded from its colour, with a hueShift ramp, and with a ramp of palette colours.
  const ramps: Record<string, unknown>[] = [
    { color: '#d08c48', bands: 4 },
    { color: '#d08c48', bands: 4, hueShift: 45 },
    { ramp: ['#5d275d', '#b13e53', '#ef7d57', '#ffcd75'] },
  ];
  const rampCells: RgbaImage[] = [];
  for (const [i, variant] of ramps.entries()) {
    const project = await scratch(`ramp-${i}`, {
      frame: { width: 32, height: 32 },
      directions: 'd1',
      materials: { paint: variant },
      model: { parts: [{ type: 'sphere', id: 'ball', material: 'paint', radius: 0.5, position: [0, 0.5, 0] }] },
    });
    rampCells.push(
      onChecker(await readPng(join(readBuild(project, 'props/crate').dir, 'sprites', 'idle', 's', '000.png')), 4),
    );
  }
  await writePng(join(out, 'ramps.png'), beside(rampCells));
}

/** A crate too large for its frame: the composition checks warn and the preview shows why. */
async function validation(): Promise<void> {
  const project = await scratch('clipped', {
    frame: { width: 32, height: 32 },
    pixelsPerUnit: 26,
    directions: 'd1',
    materials: { wood: { color: '#a0693a' } },
    model: { parts: [{ type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] }] },
  });
  const out = join(images, 'validation');
  mkdirSync(out, { recursive: true });
  await writePreview(readBuild(project, 'props/crate'), {
    scale: 4,
    background: 'checker',
    grid: true,
    out: join(out, 'clipped.png'),
  });
}

/** What one clip key edit changes in the knight: `td2d compare --out` against the build before it. */
async function caching(): Promise<void> {
  const project = await example('characters');
  const before = join(work, 'knight-before');
  cpSync(readBuild(project, 'characters/knight').dir, before, { recursive: true });
  const file = join(project.root, 'assets', 'characters', 'knight', 'asset.json');
  const asset = JSON.parse(readFileSync(file, 'utf8')) as {
    animation: { clips: { attack: { keys: { pose: Record<string, { rotation: number[] }> }[] } } };
  };
  const key = asset.animation.clips.attack.keys[2] as { pose: Record<string, { rotation: number[] }> };
  const bone = Object.keys(key.pose)[0] as string;
  (key.pose[bone] as { rotation: number[] }).rotation = (key.pose[bone] as { rotation: number[] }).rotation.map(
    (r) => r * 0.6,
  );
  writeFileSync(file, JSON.stringify(asset, null, 2));
  await generateAssets({ project, ids: ['characters/knight'], history: false });
  const out = join(images, 'caching');
  mkdirSync(out, { recursive: true });
  const current = readBuild(project, 'characters/knight');
  await compareBuilds(readSnapshot(current.dir, 'after'), readSnapshot(before, 'before'), {
    out: join(out, 'clip-edit-diff.png'),
    scale: 3,
    limit: 4,
  });
  // Put the knight back for the images that follow.
  cpSync(before, current.dir, { recursive: true });
}

/** The knight's walk GIF preview, as the gif-preview exporter writes it. */
async function exportsImages(): Promise<void> {
  const project = await example('characters');
  const out = join(images, 'exports');
  mkdirSync(out, { recursive: true });
  const sheets = join(readBuild(project, 'characters/knight-packed').dir, 'sheets');
  cpSync(join(sheets, 'knight-packed-walk.gif'), join(out, 'knight-packed-walk.gif'));
  // The packed sheet beside its normal map, at 2x on a checkerboard.
  await writePng(
    join(out, 'knight-packed-normals.png'),
    beside(
      [
        onChecker(await readPng(join(sheets, 'knight-packed.png')), 2),
        onChecker(await readPng(join(sheets, 'knight-packed-normals.png')), 2),
      ],
      16,
    ),
  );
  // The fighter example's README and the top-level README play these.
  const fighter = await example('fighter');
  const animations = join(images, 'examples', 'fighter');
  mkdirSync(animations, { recursive: true });
  for (const [id, name] of [
    ['fighters/karateka', 'karateka'],
    ['effects/energy-ball', 'energy-ball'],
  ] as const) {
    const build = readBuild(fighter, id);
    const built = join(build.dir, 'sheets');
    for (const gif of readdirSync(built).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.gif')))
      cpSync(join(built, gif), join(animations, gif));
    // Every frame of every clip in a row, at the sprite's own size.
    for (const clip of build.manifest.clips.map((c) => c.name))
      await writePreview(build, {
        scale: 1,
        background: 'checker',
        grid: false,
        clip,
        out: join(animations, `${name}-${clip}-frames.png`),
      });
  }
}

/** A preview of every asset of every example project, for the gallery. */
async function gallery(): Promise<void> {
  for (const name of ['starter', 'props', 'cameras', 'pixel', 'characters', 'fighter']) {
    const project = await example(name);
    const assets = join(project.root, 'assets');
    const ids: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const id = prefix ? `${prefix}/${e.name}` : e.name;
        if (readdirSync(join(dir, e.name)).some((f) => f === 'asset.json' || f === 'asset.ts')) ids.push(id);
        else walk(join(dir, e.name), id);
      }
    };
    walk(assets, '');
    for (const id of ids.sort()) {
      const file = join(images, 'examples', name, `${id.replace(/\//g, '-')}.png`);
      mkdirSync(dirname(file), { recursive: true });
      const build = readBuild(project, id);
      // A ring of one direction is a single frame: show a side-on asset's whole sheet instead.
      const sideOn = build.manifest.directions.length === 1;
      await writePreview(build, {
        scale: sideOn && build.manifest.frame.width > 64 ? 1 : 2,
        background: 'checker',
        grid: false,
        layout: sideOn ? 'sheet' : 'ring',
        out: file,
      });
    }
  }
}

async function props(): Promise<void> {
  const project = await example('props');
  for (const id of ['barrel', 'crate-notched', 'fence', 'teapot', 'lamp', 'ramp', 'totem', 'sword']) {
    await writePreview(readBuild(project, `props/${id}`), {
      scale: 4,
      background: 'checker',
      grid: false,
      out: join(images, 'models', `example-${id}.png`),
    });
  }
}

async function cameras(): Promise<void> {
  const project = await example('cameras');
  const out = join(images, 'camera');
  mkdirSync(out, { recursive: true });
  const single = [
    'camera/dimetric',
    'camera/isometric',
    'camera/three-quarter',
    'camera/top-down-45',
    'camera/side',
    'camera/top',
    'lighting/studio-toon',
    'lighting/studio-rim',
    'lighting/world-sun',
    'lighting/flat',
    'lighting/ground-shadow',
    'composition/auto-fit',
  ];
  for (const id of single) {
    const file = join(out, `${id.replace('/', '-')}.png`);
    await writePreview(readBuild(project, id), { scale: 3, background: 'checker', grid: false, out: file });
    await firstCell(file);
  }
  await writePreview(readBuild(project, 'composition/mirrored'), {
    scale: 3,
    background: 'checker',
    grid: false,
    layout: 'ring',
    out: join(out, 'ring-mirrored.png'),
  });
  await writePreview(readBuild(project, 'composition/counted'), {
    scale: 3,
    background: 'checker',
    grid: false,
    layout: 'ring',
    out: join(out, 'ring-counted.png'),
  });
}

/** Nearest-neighbour upscale onto a checkerboard, so transparent pixels show as checks. */
function onChecker(img: RgbaImage, scale: number, showTransparentColour = false): RgbaImage {
  const out: RgbaImage = {
    width: img.width * scale,
    height: img.height * scale,
    rgba: new Uint8Array(img.width * img.height * scale * scale * 4),
  };
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4;
      const check = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0xd0 : 0xe8;
      const a = showTransparentColour ? 255 : (img.rgba[i + 3] as number);
      const mix = (c: number) => Math.round((c * a + check * (255 - a)) / 255);
      out.rgba.set(
        [mix(img.rgba[i] as number), mix(img.rgba[i + 1] as number), mix(img.rgba[i + 2] as number), 255],
        (y * out.width + x) * 4,
      );
    }
  }
  return out;
}

async function pixel(): Promise<void> {
  const project = await example('pixel');
  const out = join(images, 'pixel');
  mkdirSync(out, { recursive: true });
  // One frame through every pass, in the default order, with the settings of the pico-8 preset plus cleanup.
  const render = await readPng(join(readBuild(project, 'palette/none').dir, 'renders', 'idle', 's', '000.png'));
  const pico = [
    '#000000',
    '#1d2b53',
    '#7e2553',
    '#008751',
    '#ab5236',
    '#5f574f',
    '#c2c3c7',
    '#fff1e8',
    '#ff004d',
    '#ffa300',
    '#ffec27',
    '#00e436',
    '#29adff',
    '#83769c',
    '#ff77a8',
    '#ffccaa',
  ];
  const steps: [string, RgbaImage, number, boolean?][] = [];
  steps.push(['render', render, 1]);
  steps.push(['downscale-box', boxDownscale(render, 4), 4]);
  const mode = modeDownscale(render, 4);
  steps.push(['downscale-mode', mode, 4]);
  const binary = thresholdAlpha(mode, BASE_SETTINGS.pixel.alphaThreshold);
  steps.push(['alpha-threshold', binary, 4]);
  const mapped = mapToPalette(binary, Palette.fromHex(pico), 'bayer-4', 0.35);
  steps.push(['palette', mapped, 4]);
  const ringed = outline(mapped, { side: 'outside', width: 1 }, 0x000000);
  steps.push(['outline', ringed, 4]);
  const cleaned = cleanupOrphans(ringed, 'remove', 1).image;
  steps.push(['cleanup', cleaned, 4]);
  steps.push(['bleed', bleedEdges(cleaned), 4, true]);
  for (const [name, img, scale, reveal] of steps)
    await writePng(join(out, `pass-${name}.png`), onChecker(img, scale, reveal === true));

  const ids = [
    'downscale/mode',
    'downscale/box',
    'palette/none',
    'palette/endesga-32',
    'palette/auto-16',
    'palette/auto-4',
    'palette/custom',
    'posterize/4',
    'dither/none',
    'dither/bayer-4-35',
    'dither/bayer-4-70',
    'dither/bayer-2-50',
    'outline/outside',
    'outline/outside-4',
    'outline/inside',
    'outline/snapped',
    'lines/none',
    'lines/dark',
    'lines/shade',
    'preset/retro-16',
    'preset/pico-8',
  ];
  for (const id of ids) {
    const file = join(out, `${id.replace('/', '-')}.png`);
    await writePreview(readBuild(project, id), { scale: 4, background: 'checker', grid: false, out: file });
    await firstCell(file);
  }
}

async function characters(): Promise<void> {
  const project = await example('characters');
  const out = join(images, 'rigging');
  mkdirSync(out, { recursive: true });
  const build = readBuild(project, 'characters/knight');
  await writePreview(build, {
    scale: 3,
    background: 'checker',
    grid: false,
    layout: 'ring',
    clip: 'idle',
    out: join(out, 'knight-ring.png'),
  });
  const sheets = join(images, 'sheets');
  mkdirSync(sheets, { recursive: true });
  await writePreview(build, { scale: 1, background: 'checker', grid: true, out: join(sheets, 'knight-grid.png') });
  await writePreview(readBuild(project, 'characters/knight-packed'), {
    scale: 2,
    background: 'checker',
    grid: true,
    out: join(sheets, 'knight-packed.png'),
  });
  for (const clip of ['idle', 'walk', 'attack']) {
    const file = join(out, `knight-${clip}.png`);
    await writePreview(build, { scale: 3, background: 'checker', grid: true, clip, out: file });
    await firstRow(file, 3 * build.manifest.frame.height + 2 * 3);
  }
}

/** Keep the first row of a clip preview: one direction. */
async function firstRow(file: string, height: number): Promise<void> {
  const image = await readPng(file);
  await writePng(file, { width: image.width, height, rgba: image.rgba.slice(0, image.width * height * 4) });
}

try {
  await partTypes();
  await starter();
  await materials();
  await validation();
  await props();
  await cameras();
  await pixel();
  await characters();
  await exportsImages();
  await gallery();
  await caching();
  process.stdout.write(`Wrote images to ${images}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
