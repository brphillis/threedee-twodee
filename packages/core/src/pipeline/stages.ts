import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import {
  type ExportFormatT,
  type FrameSample,
  Manifest,
  type RenderMaterial,
  type RenderSceneSettings,
  type ResolvedAssetT,
  type ValidationReportT,
  type WarningT,
} from '@td2d/schema';
import { isTd2dError, Td2dError } from '../errors.ts';
import { asepriteDataFile, asepriteExporter } from '../export/aseprite.ts';
import { framesExporter, godotExporter, phaserExporter, pixiExporter } from '../export/engines.ts';
import { gifExporter } from '../export/gif.ts';
import { buildManifest, pivotFor } from '../export/manifest.ts';
import { type ExportContext, type Exporter, writeChecked } from '../export/registry.ts';
import { cloneFile } from '../fs/copy.ts';
import { formatJson } from '../fs/json.ts';
import type { Logger } from '../logger.ts';
import { buildModel, type ModelReport, modelInputs } from '../model/build.ts';
import { readGlb } from '../model/gltf.ts';
import type { RgbaImage } from '../pixel/image.ts';
import { opaqueColours } from '../pixel/image.ts';
import { hexToRgb, packRgb } from '../pixel/oklab.ts';
import { flipHorizontal } from '../pixel/passes.ts';
import { type FrameInput, orphanMode, passSignature } from '../pixel/pipeline.ts';
import { autoGroundMargin, autoPixelsPerUnit, boundingRadius, frameFit } from '../plan/ground.ts';
import type { ProgressReporter } from '../progress.ts';
import type { BackendInfo, RenderBackend, RenderSummary, RenderTimings } from '../render/backend.ts';
import { applyFilter, filterKey, type SampleFilter } from '../render/filter.ts';
import { alphaCoverage, encodePng, readPng, writePng } from '../render/frames.ts';
import { encodeIndexedPng } from '../render/png-indexed.ts';
import { getBackend } from '../render/registry.ts';
import { frameKey } from '../render/samples.ts';
import { buildRig, type RigReport } from '../rig/build.ts';
import { posedPositions, posedPositionsByNode } from '../rig/evaluate.ts';
import { GENERATOR_VERSIONS, WALK_DEFAULTS, walkBones } from '../rig/generators.ts';
import { layoutSheets, type SheetLayout, type SheetRow } from '../sheet/layout.ts';
import { validateSprites } from '../validate/checks.ts';
import type { WorkerPool } from '../workers/pool.ts';
import type { ItemCache } from './cache.ts';
import { hashValue, sha256Hex } from './hash.ts';

export const STAGE_NAMES = [
  'resolve',
  'model',
  'rig',
  'plan',
  'render',
  'pixel',
  'sheet',
  'validate',
  'export',
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface StageContext {
  readonly asset: ResolvedAssetT;
  readonly assetHash: string;
  /** Absolute project root, for reading imported files. */
  readonly projectRoot: string;
  readonly resolveWarnings: readonly WarningT[];
  readonly logger: Logger;
  readonly progress: ProgressReporter;
  readonly signal: AbortSignal | undefined;
  /** Samples the run may render; the rest must come from the render cache (see partialRender). */
  readonly filter?: SampleFilter | undefined;
  /** With a filter: plan only the selected samples and stop at render. */
  readonly partialRender?: boolean;
  /** Single-file caches for rendered samples and processed sprites, or null without a cache. */
  readonly items: ItemCache | null;
  /** Whether --force or --from asked this stage to recompute rather than reuse. */
  forced(stage: StageName): boolean;
  /** Worker threads for pixel processing and sheet compositing. */
  readonly workers: WorkerPool;
  /** The shared render backend, started on first use. */
  backend(): Promise<RenderBackend>;
  /** Output of an upstream stage. */
  output<T>(stage: StageName): { readonly dir: string; readonly data: T; readonly hash: string };
}

export interface StageOutcome<T> {
  readonly data: T;
  readonly warnings?: readonly WarningT[];
}

export interface Stage<T = unknown> {
  readonly name: StageName;
  /** Bump when the stage's behaviour changes, so old cache entries stop matching. */
  readonly version: number;
  readonly deps: readonly StageName[];
  /** Everything besides upstream outputs that the stage's result depends on. */
  key(ctx: Pick<StageContext, 'asset' | 'filter' | 'partialRender'>): unknown;
  run(ctx: StageContext, dir: string): Promise<StageOutcome<T>>;
}

/** The name sheets and data files take: the last segment of the asset id. */
export function sheetName(assetId: string): string {
  return assetId.split('/').at(-1) ?? assetId;
}

export interface PlanData {
  /** Hash of the posed geometry for each clip and time (see poseKey). */
  readonly poses: Readonly<Record<string, string>>;
  readonly groundMargin: number;
  /** The pixels per metre used, fitted when the asset asks for "auto". */
  readonly pixelsPerUnit: number;
  /** Sprite key to the key it is mirrored from. Mirrored sprites are not rendered. */
  readonly mirrors: Readonly<Record<string, string>>;
  readonly radius: number;
  readonly scene: Omit<RenderSceneSettings, 'lighting' | 'materials'>;
  readonly samples: readonly FrameSample[];
  readonly rows: readonly SheetRow[];
}

export interface RenderData {
  readonly backend: BackendInfo;
  readonly timings: RenderTimings;
  /** Every planned sample, with its render cache key. */
  readonly frames: readonly { key: string; file: string; item: string; coverage: number }[];
  /** Samples rendered in this run, and samples restored from the render cache. */
  readonly items: { readonly rendered: number; readonly reused: number };
}

export interface PixelData {
  readonly sprites: readonly {
    key: string;
    file: string;
    coverage: number;
    colours: number;
    mirrorOf: string | null;
  }[];
  /** Palette colours by clip (or "*" for the whole asset); empty without a palette. */
  readonly palettes: Readonly<Record<string, readonly string[]>>;
  readonly removed: number;
  readonly recoloured: number;
  /** Sprites processed in this run, and sprites restored from the pixel cache. */
  readonly items: { readonly processed: number; readonly reused: number };
}

export interface SheetData {
  /** Image file of each page, in the stage directory. */
  readonly files: readonly string[];
  readonly layout: SheetLayout;
}

export interface ValidateData {
  readonly status: ValidationReportT['status'];
  readonly checks: ValidationReportT['checks'];
}

export interface ExportData {
  readonly files: readonly string[];
  /** Sheet images, in page order. */
  readonly sheets: readonly string[];
  /** Aseprite data file of each sheet, or null. */
  readonly data: readonly (string | null)[];
  readonly manifest: string;
}

const resolve: Stage<Record<string, never>> = {
  name: 'resolve',
  version: 1,
  deps: [],
  key: (ctx) => ctx.asset,
  async run(ctx, dir) {
    writeFileSync(join(dir, 'resolved.json'), formatJson(ctx.asset));
    return { data: {}, warnings: ctx.resolveWarnings };
  },
};

const model: Stage<ModelReport> = {
  name: 'model',
  version: 3,
  deps: [],
  key: (ctx) => modelInputs(ctx.asset),
  async run(ctx, dir) {
    const built = await buildModel(ctx.asset, { projectRoot: ctx.projectRoot, logger: ctx.logger });
    writeFileSync(join(dir, 'model.glb'), built.glb);
    writeFileSync(join(dir, 'model-report.json'), formatJson(built.report));
    const warnings: WarningT[] = built.warnings.map((w) => ({ ...w, assetId: ctx.asset.id }));
    if (!built.report.validator.available) {
      warnings.push({
        code: 'W_VALIDATOR_UNAVAILABLE',
        message: 'The glTF validator could not run, so the model was not validated.',
        assetId: ctx.asset.id,
      });
    }
    return { data: built.report, warnings };
  },
};

const rigStage: Stage<RigReport> = {
  name: 'rig',
  version: 1,
  deps: ['model'],
  // Warnings name the asset and its file, so those are part of the key.
  key: ({ asset }) => ({
    id: asset.id,
    sourceFile: asset.sourceFile,
    rig: asset.rig,
    generators: GENERATOR_VERSIONS,
    clips: Object.entries(asset.animation.clips),
  }),
  async run(ctx, dir) {
    const built = await buildRig(readFileSync(join(ctx.output('model').dir, 'model.glb')), ctx.asset, ctx.logger);
    writeFileSync(join(dir, 'model.glb'), built.glb);
    writeFileSync(join(dir, 'rig-report.json'), formatJson(built.report));
    return { data: built.report, warnings: built.warnings };
  },
};

/**
 * W_CLIP_FOOT_CONTACT for walk-cycle clips: in every frame one foot should touch the ground.
 * The lowest point of the foot parts (lower legs when the feet have no parts) must be within
 * one final pixel of y = 0, measured on screen.
 */
function footContactWarnings(
  asset: ResolvedAssetT,
  doc: Document,
  animated: ReadonlySet<string>,
  pixelsPerUnit: number,
): WarningT[] {
  const warnings: WarningT[] = [];
  const meshNodes = new Set(
    doc
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh())
      .map((n) => n.getName()),
  );
  const screen = pixelsPerUnit * Math.cos((asset.camera.pitch * Math.PI) / 180);
  for (const [name, clip] of Object.entries(asset.animation.clips)) {
    const gen = clip.generator;
    if (gen?.type !== 'walk-cycle' || !animated.has(name)) continue;
    const roles = walkBones(asset.rig, gen.bones);
    const nodes = [
      [roles.leftFoot, roles.rightFoot],
      [roles.leftLowerLeg, roles.rightLowerLeg],
      [roles.leftUpperLeg, roles.rightUpperLeg],
    ]
      .map((pair) =>
        pair
          .filter((b): b is string => b !== undefined)
          .map((b) => `part:${b}`)
          .filter((n) => meshNodes.has(n)),
      )
      .find((pair) => pair.length > 0);
    if (!nodes) continue;
    let worst: { frame: number; t: number; lowest: number } | null = null;
    clip.times.forEach((t, frame) => {
      const posed = posedPositionsByNode(doc, name, t);
      let lowest = Number.POSITIVE_INFINITY;
      for (const n of nodes) {
        const values = posed.get(n) ?? new Float64Array();
        for (let i = 1; i < values.length; i += 3) lowest = Math.min(lowest, values[i] as number);
      }
      if (!worst || Math.abs(lowest) > Math.abs(worst.lowest)) worst = { frame, t, lowest };
    });
    const w = worst as { frame: number; t: number; lowest: number } | null;
    if (!w || Math.abs(w.lowest) * screen <= 1) continue;
    const bob = gen.bob ?? WALK_DEFAULTS.bob;
    const swing = Math.sin((2 * Math.PI * w.t) / clip.duration) ** 2;
    const suggestion = swing > 0.1 ? Math.max(0, bob + w.lowest / swing) : null;
    warnings.push({
      code: 'W_CLIP_FOOT_CONTACT',
      message: `In clip "${name}" the lowest foot is ${Number((Math.abs(w.lowest) * screen).toFixed(1))} px ${w.lowest > 0 ? 'above' : 'below'} the ground at frame ${w.frame} (${Number(w.t.toFixed(3))} s).`,
      file: asset.sourceFile,
      path: `animation.clips.${name}.generator`,
      assetId: asset.id,
      hint:
        suggestion === null
          ? 'Check that the feet rest on y = 0 in the rest pose.'
          : `Set generator.bob to about ${Number(suggestion.toFixed(3))} for a stride of ${gen.stride ?? WALK_DEFAULTS.stride} degrees, or lower the stride.`,
    });
  }
  return warnings;
}

/** Key of a pose in PlanData.poses: the clip and time, or the rest pose. */
export function poseKey(clip: string | null, time: number): string {
  return clip === null ? 'rest' : `${clip}@${time}`;
}

/** Hash of vertex positions rounded to a hundredth of a millimetre. */
function poseHash(positions: Float64Array): string {
  const rounded = new Int32Array(positions.length);
  for (let i = 0; i < positions.length; i++) rounded[i] = Math.round((positions[i] as number) * 1e5);
  return sha256Hex(new Uint8Array(rounded.buffer));
}

/** Pixels the pixel stage adds outside the rendered silhouette: the width of an outside outline. */
function outlinePad(asset: ResolvedAssetT): number {
  const o = asset.pixel.outline;
  return o !== 'none' && o.side === 'outside' ? o.width : 0;
}

const plan: Stage<PlanData> = {
  name: 'plan',
  version: 5,
  deps: ['rig'],
  key: ({ asset, filter, partialRender }) => ({
    frame: asset.frame,
    pixelsPerUnit: asset.pixelsPerUnit,
    supersample: asset.render.supersample,
    camera: { pitch: asset.camera.pitch, yawOffset: asset.camera.yawOffset, groundMargin: asset.camera.groundMargin },
    directions: asset.directions,
    clips: Object.entries(asset.animation.clips),
    outlinePad: outlinePad(asset),
    filter: partialRender ? filterKey(filter) : null,
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const pad = outlinePad(asset);
    const rigOut = ctx.output<RigReport>('rig');
    const doc = await readGlb(readFileSync(join(rigOut.dir, 'model.glb')));
    const animated = new Set(rigOut.data.clips.filter((c) => c.animated).map((c) => c.name));
    // Fit the frame to every pose that is rendered, not just the rest pose.
    const rest = posedPositions(doc, null, 0);
    const poses = [rest];
    // Each pose's geometry hash: the render cache reuses a sample whose pose did not change,
    // even when an edit elsewhere in the clip changed the baked animation.
    const poseHashes: Record<string, string> = { [poseKey(null, 0)]: poseHash(rest) };
    for (const [name, clip] of Object.entries(asset.animation.clips)) {
      if (!animated.has(name)) continue;
      for (const t of clip.times) {
        const posed = posedPositions(doc, name, t);
        poses.push(posed);
        poseHashes[poseKey(name, t)] = poseHash(posed);
      }
    }
    const positions = new Float64Array(poses.reduce((n, p) => n + p.length, 0));
    poses.reduce((o, p) => {
      positions.set(p, o);
      return o + p.length;
    }, 0);
    const rendered = asset.directions.filter((d) => d.mirrorOf === null);
    const yaws = rendered.map((d) => d.yaw);
    const camera = { pitch: asset.camera.pitch, yawOffset: asset.camera.yawOffset };
    const pixelsPerUnit =
      asset.pixelsPerUnit === 'auto'
        ? autoPixelsPerUnit(
            positions,
            yaws,
            {
              frame: asset.frame,
              supersample: asset.render.supersample,
              camera: { ...camera, groundMargin: asset.camera.groundMargin },
            },
            pad,
          )
        : asset.pixelsPerUnit;
    const base = { frame: asset.frame, supersample: asset.render.supersample, pixelsPerUnit };
    const groundMargin =
      asset.camera.groundMargin === 'auto'
        ? autoGroundMargin(positions, yaws, { ...base, camera }, pad)
        : asset.camera.groundMargin;
    const samples: FrameSample[] = [];
    const rows: SheetRow[] = [];
    const mirrors: Record<string, string> = {};
    for (const [clip, c] of Object.entries(asset.animation.clips)) {
      for (const d of asset.directions) {
        const keys = c.times.map((time, i) => {
          const key = frameKey(clip, d.name, i);
          if (d.mirrorOf !== null) mirrors[key] = frameKey(clip, d.mirrorOf, i);
          else samples.push({ key, clip: animated.has(clip) ? clip : null, time, yaw: d.yaw });
          return key;
        });
        rows.push({ clip, direction: d.name, keys });
      }
    }
    const kept = ctx.partialRender ? applyFilter(samples, ctx.filter) : samples;
    if (kept.length === 0) {
      throw new Td2dError('E_USAGE', `No frames of "${asset.id}" match the filter.`, {
        hint: 'Mirrored directions are not rendered; select the direction they mirror instead.',
      });
    }
    const data: PlanData = {
      poses: poseHashes,
      groundMargin,
      pixelsPerUnit,
      radius: boundingRadius(positions),
      scene: { ...base, camera: { ...camera, groundMargin } },
      samples: kept,
      rows,
      mirrors,
    };
    writeFileSync(join(dir, 'plan.json'), formatJson(data));
    const warnings: WarningT[] = footContactWarnings(asset, doc, animated, pixelsPerUnit);
    const outside = frameFit(positions, rendered, data.scene)
      .map((f) => ({ ...f, minX: f.minX - pad, minY: f.minY - pad, maxX: f.maxX + pad, maxY: f.maxY + pad }))
      .filter(
        (f) =>
          f.minX < -0.01 || f.minY < -0.01 || f.maxX > asset.frame.width + 0.01 || f.maxY > asset.frame.height + 0.01,
      );
    const worst = outside[0];
    if (worst) {
      const span = (f: typeof worst) =>
        `${Math.round(f.maxX - f.minX)} x ${Math.round(f.maxY - f.minY)} px (x ${Math.floor(f.minX)} to ${Math.ceil(f.maxX)}, y ${Math.floor(f.minY)} to ${Math.ceil(f.maxY)})`;
      warnings.push({
        code: 'W_MODEL_OUT_OF_FRAME',
        message: `The model extends past the ${asset.frame.width} x ${asset.frame.height} frame in ${outside.length} direction(s). In direction ${worst.direction} it spans ${span(worst)}.`,
        assetId: asset.id,
        hint: 'Lower pixelsPerUnit (or set it to "auto"), enlarge frame, or shrink the model. Sprites in these directions will be cut off.',
      });
    }
    return { data, warnings };
  },
};

function renderMaterials(asset: ResolvedAssetT): Record<string, RenderMaterial> {
  return Object.fromEntries(
    Object.entries(asset.materials).map(([name, m]) => [
      name,
      { color: m.color, shading: m.shading, bands: m.bands, emissive: m.emissive },
    ]),
  );
}

/**
 * PNG compression for intermediate files: renders and sprites. On the benchmark's 128 x 192
 * renders, level 6 writes 1.3 KB a frame against 3.0 KB at level 1 for 0.07 ms more, and
 * level 9 saves only another 0.2 KB for 0.55 ms more. Final sheets use export.png
 * (compressionLevel 9 by default).
 */
const INTERMEDIATE_PNG_LEVEL = 6;
const SPRITE_PNG_LEVEL = INTERMEDIATE_PNG_LEVEL;

const render: Stage<RenderData> = {
  name: 'render',
  version: 3,
  deps: ['rig', 'plan'],
  key: ({ asset }) => ({
    materials: renderMaterials(asset),
    lighting: asset.lighting,
    backend: getBackend(asset.render.backend).fingerprint(),
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const planData = ctx.output<PlanData>('plan').data;
    const { preset: _p, ...lighting } = asset.lighting;
    const materials = renderMaterials(asset);
    // A sample's pixels depend on its posed geometry, the scene, its yaw, the materials, the
    // lighting and the backend, not on the rest of the clip, so each sample is cached alone.
    const shared = {
      format: RENDER_ITEM_FORMAT,
      geometry: ctx.output('model').hash,
      rig: asset.rig,
      scene: planData.scene,
      materials,
      lighting,
      backend: getBackend(asset.render.backend).fingerprint(),
    };
    const itemKey = (s: FrameSample) =>
      hashValue({
        ...shared,
        pose: planData.poses[poseKey(s.clip, s.time)] ?? planData.poses[poseKey(null, 0)],
        yaw: s.yaw,
      });
    const forced = ctx.forced('render');
    const selected = new Set(
      ctx.filter && !ctx.partialRender
        ? applyFilter(planData.samples, ctx.filter).map((s) => s.key)
        : planData.samples.map((s) => s.key),
    );
    const frames: RenderData['frames'][number][] = [];
    const todo: FrameSample[] = [];
    for (const sample of planData.samples) {
      const item = itemKey(sample);
      const cached = forced && selected.has(sample.key) ? undefined : ctx.items?.get('render', item);
      const meta = cached ? ctx.items?.get('render', item, '.json') : undefined;
      if (cached && meta) {
        mkdirSync(join(dir, sample.key, '..'), { recursive: true });
        cloneFile(cached, join(dir, `${sample.key}.png`));
        const { coverage } = JSON.parse(readFileSync(meta, 'utf8')) as { coverage: number };
        frames.push({ key: sample.key, file: `${sample.key}.png`, item, coverage });
      } else {
        todo.push(sample);
      }
    }
    const blocked = todo.filter((s) => !selected.has(s.key));
    if (blocked.length > 0) {
      throw new Td2dError(
        'E_PARTIAL_PLAN',
        `${blocked.length} frame(s) of "${asset.id}" are outside the filter and not in the render cache.`,
        {
          hint: 'Run once without --frames, --clips or --directions to render everything, then filter again.',
          details: { frames: blocked.slice(0, 20).map((s) => s.key) },
        },
      );
    }
    let info: BackendInfo | null = null;
    let summary: RenderSummary | null = null;
    const warnings: WarningT[] = [];
    if (todo.length > 0) {
      const items = new Map(todo.map((s) => [s.key, itemKey(s)]));
      const job = {
        model: { glb: readFileSync(join(ctx.output('rig').dir, 'model.glb')), label: asset.id },
        scene: { ...planData.scene, lighting, materials },
        samples: todo,
      };
      const attempt = async () => {
        const backend = await ctx.backend();
        info = await backend.start(ctx.signal);
        const done: RenderData['frames'][number][] = [];
        const result = await backend.render(
          job,
          async (frame) => {
            const file = `${frame.key}.png`;
            await writePng(join(dir, file), frame, INTERMEDIATE_PNG_LEVEL);
            const item = items.get(frame.key) as string;
            const coverage = Number(alphaCoverage(frame.rgba).toFixed(6));
            ctx.items?.put('render', item, join(dir, file));
            ctx.items?.put('render', item, new TextEncoder().encode(JSON.stringify({ coverage })), '.json');
            done.push({ key: frame.key, file, item, coverage });
          },
          {
            ...(ctx.signal ? { signal: ctx.signal } : {}),
            onFrame: (f) => ctx.progress.itemDone('render', { ...f, assetId: asset.id }),
          },
        );
        return { result, done };
      };
      let outcome: Awaited<ReturnType<typeof attempt>>;
      try {
        outcome = await attempt();
      } catch (error) {
        if (!isTd2dError(error) || error.code !== 'E_BACKEND_CRASHED' || ctx.signal?.aborted) throw error;
        // One restart: a fresh browser renders the whole remaining job again.
        await (await ctx.backend()).stop();
        outcome = await attempt();
        warnings.push({
          code: 'W_BACKEND_RESTARTED',
          message: `The headless browser crashed while rendering ${asset.id} (E_BACKEND_CRASHED); it was restarted and the render succeeded.`,
          assetId: asset.id,
        });
      }
      summary = outcome.result;
      frames.push(...outcome.done);
    }
    const backend = info ?? (await (await ctx.backend()).start(ctx.signal));
    if (!backend.software) {
      warnings.push({
        code: 'W_HARDWARE_RENDERER',
        message: `Rendering used ${backend.renderer}, not a software rasteriser, so pixels can differ between machines.`,
        assetId: asset.id,
        hint:
          backend.id === 'playwright-swiftshader'
            ? 'Drop --allow-hardware for reproducible output.'
            : `The ${backend.id} backend renders on what the machine provides. Use the default playwright-swiftshader backend for output that matches other machines.`,
      });
    }
    const order = new Map(planData.samples.map((s, i) => [s.key, i]));
    frames.sort((a, b) => (order.get(a.key) as number) - (order.get(b.key) as number));
    const timings = (summary as RenderSummary | null)?.timings ?? { loadMs: 0, renderMs: 0 };
    return {
      data: {
        backend,
        timings,
        frames,
        items: { rendered: todo.length, reused: planData.samples.length - todo.length },
      },
      warnings,
    };
  },
};

/** Bump when a cached item or its .json sidecar changes shape, so old items stop matching. */
const RENDER_ITEM_FORMAT = 2;
const PIXEL_ITEM_FORMAT = 2;

/** Frames per worker task when frames are processed one by one. */
const PIXEL_CHUNK = 32;

const pixel: Stage<PixelData> = {
  name: 'pixel',
  version: 6,
  deps: ['render', 'plan'],
  key: ({ asset }) => ({
    pixel: { ...asset.pixel, preset: null },
    passes: passSignature(asset.pixel),
    palette: asset.paletteColors,
    supersample: asset.render.supersample,
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const renderOut = ctx.output<RenderData>('render');
    // An automatic palette is built from every frame, so frames are processed together.
    // Otherwise every frame stands alone and is cached on its own.
    const together = asset.pixel.palette.startsWith('auto:');
    const settingsKey = {
      pixel: { ...asset.pixel, preset: null },
      passes: passSignature(asset.pixel),
      palette: asset.paletteColors,
      supersample: asset.render.supersample,
    };
    const itemKey = (render: string) => hashValue({ ...settingsKey, render, format: PIXEL_ITEM_FORMAT });
    const forced = ctx.forced('pixel');
    type SpriteMeta = { removed: number; recoloured: number; coverage: number; colours: number };
    const processed = new Map<string, { image: RgbaImage; removed: number; recoloured: number; png: Buffer }>();
    /** Sprites restored from the item cache: copied as files, decoded only when a mirror needs them. */
    const restored = new Map<string, SpriteMeta & { file: string }>();
    const todo: FrameInput[] = [];
    for (const frame of renderOut.data.frames) {
      ctx.signal?.throwIfAborted();
      const key = itemKey(frame.item);
      const item = together || forced ? undefined : ctx.items?.get('pixel', key);
      const meta = item ? ctx.items?.get('pixel', key, '.json') : undefined;
      if (item && meta) {
        restored.set(frame.key, { ...(JSON.parse(readFileSync(meta, 'utf8')) as SpriteMeta), file: item });
        continue;
      }
      todo.push({
        key: frame.key,
        clip: frame.key.split('/')[0] as string,
        image: await readPng(join(renderOut.dir, frame.file)),
      });
    }
    let palettes: Readonly<Record<string, readonly string[]>> = asset.paletteColors ? { '*': asset.paletteColors } : {};
    let totals: { removed: number; recoloured: number } | null = null;
    const chunks = together
      ? [todo]
      : Array.from({ length: Math.ceil(todo.length / PIXEL_CHUNK) }, (_, i) =>
          todo.slice(i * PIXEL_CHUNK, (i + 1) * PIXEL_CHUNK),
        );
    let done = renderOut.data.frames.length - todo.length;
    const results = await Promise.all(
      chunks
        .filter((c) => c.length > 0)
        .map(async (frames) => {
          const result = await ctx.workers.pixel(
            {
              frames,
              supersample: asset.render.supersample,
              settings: asset.pixel,
              fixedPalette: asset.paletteColors,
              perFrame: !together,
            },
            ctx.signal,
          );
          done += frames.length;
          ctx.progress.itemDone('pixel', {
            key: frames.at(-1)?.key ?? '',
            n: done,
            total: renderOut.data.frames.length,
            assetId: asset.id,
          });
          return result;
        }),
    );
    const renderItems = new Map(renderOut.data.frames.map((f) => [f.key, f.item]));
    for (const result of results) {
      if (together) {
        palettes = result.palettes;
        totals = { removed: result.removed, recoloured: result.recoloured };
      }
      for (const s of result.sprites) {
        const png = await encodePng(s.image, SPRITE_PNG_LEVEL);
        processed.set(s.key, { ...s, png });
        if (!together && ctx.items) {
          const key = itemKey(renderItems.get(s.key) as string);
          const meta: SpriteMeta = {
            removed: s.removed,
            recoloured: s.recoloured,
            coverage: Number(alphaCoverage(s.image.rgba).toFixed(6)),
            colours: opaqueColours(s.image).length,
          };
          ctx.items.put('pixel', key, png);
          ctx.items.put('pixel', key, new TextEncoder().encode(JSON.stringify(meta)), '.json');
        }
      }
    }
    const sprites: PixelData['sprites'][number][] = [];
    const record = async (key: string, sprite: RgbaImage, mirrorOf: string | null, png?: Buffer) => {
      const file = `${key}.png`;
      if (png) {
        mkdirSync(join(dir, key, '..'), { recursive: true });
        writeFileSync(join(dir, file), png);
      } else {
        await writePng(join(dir, file), sprite, SPRITE_PNG_LEVEL);
      }
      sprites.push({
        key,
        file,
        coverage: Number(alphaCoverage(sprite.rgba).toFixed(6)),
        colours: opaqueColours(sprite).length,
        mirrorOf,
      });
    };
    for (const frame of renderOut.data.frames) {
      const cached = restored.get(frame.key);
      if (cached) {
        const file = `${frame.key}.png`;
        mkdirSync(join(dir, frame.key, '..'), { recursive: true });
        cloneFile(cached.file, join(dir, file));
        sprites.push({ key: frame.key, file, coverage: cached.coverage, colours: cached.colours, mirrorOf: null });
      } else {
        const sprite = processed.get(frame.key) as { image: RgbaImage; png: Buffer };
        await record(frame.key, sprite.image, null, sprite.png);
      }
    }
    // Mirrored directions are the horizontal flip of their source; the pivot is centred, so it stays put.
    for (const [key, source] of Object.entries(ctx.output<PlanData>('plan').data.mirrors)) {
      const cached = restored.get(source);
      const original = processed.get(source)?.image ?? (cached ? await readPng(cached.file) : undefined);
      if (!original) throw new Td2dError('E_INTERNAL', `Mirror source ${source} was not rendered.`);
      await record(key, flipHorizontal(original), source);
    }
    const counts =
      totals ??
      [...processed.values(), ...restored.values()].reduce(
        (a, p) => ({ removed: a.removed + p.removed, recoloured: a.recoloured + p.recoloured }),
        {
          removed: 0,
          recoloured: 0,
        },
      );
    const warnings: WarningT[] = [];
    if (asset.pixel.paletteScope === 'clip' && together && Object.keys(palettes).length > 1) {
      warnings.push({
        code: 'W_PALETTE_PER_CLIP',
        message: `Each of the ${Object.keys(palettes).length} clips has its own automatic palette, so the same pose can change colour where one clip hands over to another.`,
        assetId: asset.id,
        path: 'pixel.paletteScope',
        hint: 'Use paletteScope "asset" (the default) for one palette shared by every clip.',
      });
    }
    return {
      data: {
        sprites,
        palettes: asset.pixel.palette === 'none' ? {} : palettes,
        removed: counts.removed,
        recoloured: counts.recoloured,
        items: { processed: todo.length, reused: renderOut.data.frames.length - todo.length },
      },
      warnings,
    };
  },
};

async function loadSprites(dir: string, sprites: PixelData['sprites']): Promise<Map<string, RgbaImage>> {
  const out = new Map<string, RgbaImage>();
  for (const s of sprites) out.set(s.key, await readPng(join(dir, s.file)));
  return out;
}

const sheet: Stage<SheetData> = {
  name: 'sheet',
  version: 2,
  deps: ['pixel', 'plan'],
  key: ({ asset }) => ({
    sheet: { ...asset.sheet, preset: null },
    frame: asset.frame,
    name: sheetName(asset.id),
    png: asset.export.png.compressionLevel,
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const pixelOut = ctx.output<PixelData>('pixel');
    const sprites = await loadSprites(pixelOut.dir, pixelOut.data.sprites);
    const layout = layoutSheets(
      ctx.output<PlanData>('plan').data.rows,
      sprites,
      asset.frame,
      asset.sheet,
      sheetName(asset.id),
    );
    const files: string[] = [];
    for (const [page, info] of layout.pages.entries()) {
      const file = `${info.name}.png`;
      const used = [...sprites].filter(([key]) => layout.cells.some((c) => c.page === page && c.key === key));
      const image = await ctx.workers.composite(
        { layout, page, sprites: used, extrude: asset.sheet.extrude },
        ctx.signal,
      );
      await writePng(join(dir, file), image, asset.export.png.compressionLevel);
      files.push(file);
    }
    return { data: { files, layout } };
  },
};

/** Colours sprites may use: every palette colour plus the outline colour. Null without a palette. */
function allowedColours(asset: ResolvedAssetT, pixelData: PixelData): string[] | null {
  if (asset.pixel.palette === 'none') return null;
  const colours = new Set(Object.values(pixelData.palettes).flat());
  const o = asset.pixel.outline;
  if (o !== 'none' && !o.snapToPalette) colours.add(o.color.toLowerCase());
  return [...colours];
}

const validate: Stage<ValidateData> = {
  name: 'validate',
  version: 4,
  deps: ['pixel', 'sheet', 'plan'],
  key: ({ asset }) => ({
    extrude: asset.sheet.extrude,
    acceptance: asset.acceptance,
    type: asset.type,
    frame: asset.frame,
    clips: asset.animation.clips,
    outline: asset.pixel.outline,
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const pixelOut = ctx.output<PixelData>('pixel');
    const sheetOut = ctx.output<SheetData>('sheet');
    const planData = ctx.output<PlanData>('plan').data;
    const sprites = await loadSprites(pixelOut.dir, pixelOut.data.sprites);
    const pages = [];
    for (const [i, file] of sheetOut.data.files.entries()) {
      const image = await readPng(join(sheetOut.dir, file));
      const planned = sheetOut.data.layout.pages[i] as { name: string; width: number; height: number };
      pages.push({
        name: planned.name,
        width: image.width,
        height: image.height,
        expectedWidth: planned.width,
        expectedHeight: planned.height,
      });
    }
    const report = validateSprites({
      assetId: asset.id,
      type: asset.type,
      frame: asset.frame,
      groundMargin: planData.groundMargin,
      sprites: [...sprites].map(([key, image]) => ({ key, image })),
      sheets: pages,
      cells: sheetOut.data.layout.cells.map((c) => ({ key: c.key, sheet: c.page, x: c.x, y: c.y, w: c.w, h: c.h })),
      extrude: asset.sheet.extrude,
      expectedKeys: planData.rows.flatMap((r) => r.keys),
      acceptance: asset.acceptance,
      allowedColours: allowedColours(asset, pixelOut.data),
      sequences: planData.rows.map((r) => ({ ...r, motion: asset.animation.clips[r.clip]?.motion ?? false })),
      cleanup:
        orphanMode(asset.pixel) === 'off'
          ? null
          : { removed: pixelOut.data.removed, recoloured: pixelOut.data.recoloured },
    });
    writeFileSync(join(dir, 'validation.json'), formatJson(report));
    const warnings: WarningT[] = report.checks
      .filter((c) => c.status === 'warn')
      .map((c) => ({
        code: CHECK_WARNINGS[c.id] ?? ('W_OUTPUT_CHECK' as const),
        message: `${c.id}: ${c.message}`,
        assetId: asset.id,
      }));
    return { data: { status: report.status, checks: report.checks }, warnings };
  },
};

const CHECK_WARNINGS: Record<string, WarningT['code']> = {
  grounded: 'W_COMPOSITION_GROUND',
  'inside-frame': 'W_COMPOSITION_EDGE',
};

/** Exporters by format id. The manifest is always written, last. */
export const EXPORTERS: Readonly<Record<Exclude<ExportFormatT, 'manifest'>, Exporter>> = {
  'aseprite-json': asepriteExporter,
  frames: framesExporter,
  pixi: pixiExporter,
  'phaser-atlas': phaserExporter,
  'godot-spriteframes': godotExporter,
  'gif-preview': gifExporter,
};

const exportStage: Stage<ExportData> = {
  name: 'export',
  version: 3,
  deps: ['resolve', 'model', 'rig', 'plan', 'render', 'pixel', 'sheet', 'validate'],
  key: ({ asset }) => ({
    export: { ...asset.export, preset: null },
    palette: asset.pixel.palette,
    exporters: asset.export.formats
      .filter((f) => f !== 'manifest')
      .map((f) => `${f}@${EXPORTERS[f as Exclude<ExportFormatT, 'manifest'>].version}`),
  }),
  async run(ctx, dir) {
    const { asset } = ctx;
    const name = sheetName(asset.id);
    const planData = ctx.output<PlanData>('plan').data;
    const sheetOut = ctx.output<SheetData>('sheet');
    const pixelOut = ctx.output<PixelData>('pixel');
    const validation = ctx.output<ValidateData>('validate').data;
    const formats = [...new Set(asset.export.formats)].filter(
      (f): f is Exclude<ExportFormatT, 'manifest'> => f !== 'manifest',
    );
    const files: Record<string, string[]> = {};
    const warnings: WarningT[] = [];
    const palette = allowedColours(asset, pixelOut.data) ?? [];
    const order = palette.map((hex) => packRgb(...hexToRgb(hex)));
    const policy = asset.export.png.indexed;
    const wantIndexed = policy === 'always' || (policy === 'auto' && asset.pixel.palette !== 'none');
    let indexedFallbacks = 0;

    /** Write a PNG, indexed when asked and possible; indexed output is decoded again to prove it is lossless. */
    const writeImage = async (source: string, target: string) => {
      if (wantIndexed) {
        const image = await readPng(source);
        const indexed = encodeIndexedPng(image, order);
        if (indexed) {
          writeFileSync(join(dir, target), indexed.png);
          const decoded = await readPng(indexed.png);
          for (let i = 0; i < image.rgba.length; i += 4) {
            const same =
              decoded.rgba[i + 3] === image.rgba[i + 3] &&
              (image.rgba[i + 3] === 0 ||
                (decoded.rgba[i] === image.rgba[i] &&
                  decoded.rgba[i + 1] === image.rgba[i + 1] &&
                  decoded.rgba[i + 2] === image.rgba[i + 2]));
            if (!same)
              throw new Td2dError('E_INTERNAL', `The indexed PNG for ${target} does not decode to the same pixels.`);
          }
          return;
        }
        indexedFallbacks++;
      }
      cloneFile(source, join(dir, target));
    };

    const images = sheetOut.data.files;
    for (const image of images) await writeImage(join(sheetOut.dir, image), image);
    files.sheets = [...images];
    const pivot = pivotFor(asset.frame, planData.groundMargin);
    const context: ExportContext = {
      asset,
      name,
      dir,
      layout: sheetOut.data.layout,
      images,
      pivot,
      sprites: (() => {
        let loaded: Promise<Map<string, RgbaImage>> | undefined;
        return () => {
          loaded ??= loadSprites(pixelOut.dir, pixelOut.data.sprites);
          return loaded;
        };
      })(),
      spriteFiles: new Map(pixelOut.data.sprites.map((s) => [s.key, join(pixelOut.dir, s.file)])),
      writeImage,
    };
    for (const format of formats) files[format] = await EXPORTERS[format].write(context);
    if (indexedFallbacks > 0 && policy === 'always') {
      warnings.push({
        code: 'W_INDEXED_UNAVAILABLE',
        message: `${indexedFallbacks} image(s) need more than 256 palette entries and were written as RGBA.`,
        assetId: asset.id,
        path: 'export.png.indexed',
        hint: 'Set a palette, such as pixel.palette "auto:32".',
      });
    }
    const stages = Object.fromEntries(
      (['model', 'rig', 'plan', 'render', 'pixel', 'sheet'] as const).map((s) => [s, `sha256:${ctx.output(s).hash}`]),
    );
    const byClip =
      asset.pixel.paletteScope === 'clip' && asset.pixel.palette.startsWith('auto:')
        ? pixelOut.data.palettes
        : undefined;
    const dataFiles = images.map((image) => (formats.includes('aseprite-json') ? asepriteDataFile(image) : null));
    files.manifest = ['manifest.json'];
    const manifest = buildManifest({
      pixelsPerUnit: planData.pixelsPerUnit,
      mirrored: new Set(Object.keys(planData.mirrors)),
      palette: { colors: palette, ...(byClip ? { byClip } : {}) },
      asset,
      assetHash: ctx.assetHash,
      groundMargin: planData.groundMargin,
      layout: sheetOut.data.layout,
      images,
      dataFiles,
      files,
      stages,
      validation,
    });
    writeChecked(dir, 'manifest.json', manifest, Manifest, 'manifest');
    const all = Object.values(files).flat();
    return {
      data: { files: [...new Set(all)], sheets: [...images], data: dataFiles, manifest: 'manifest.json' },
      warnings,
    };
  },
};

export const STAGES: readonly Stage[] = [
  resolve,
  model,
  rigStage,
  plan,
  render,
  pixel,
  sheet,
  validate,
  exportStage,
] as Stage[];

/** Where each stage's files land inside build/<id>/, and the top-level entries they own there. */
export const BUILD_LAYOUT: Readonly<
  Record<StageName, { readonly dir: string; readonly entries: readonly string[] } | null>
> = {
  resolve: { dir: '.', entries: ['resolved.json'] },
  model: { dir: 'model', entries: ['model'] },
  rig: { dir: 'rig', entries: ['rig'] },
  plan: { dir: '.', entries: ['plan.json'] },
  render: { dir: 'renders', entries: ['renders'] },
  pixel: { dir: 'sprites', entries: ['sprites'] },
  sheet: null,
  validate: { dir: '.', entries: ['validation.json'] },
  export: { dir: 'sheets', entries: ['sheets', 'preview.png'] },
};
