import { resolve } from 'node:path';
import {
  DEFAULT_BACKEND_ID,
  directionsFromSpec,
  type FrameSelector,
  loadLibrary,
  parseFrameSelector,
  planSamples,
  presetSettings,
  type RenderToDirResult,
  relativePosix,
  renderGlbToDir,
  type SampleFilter,
  Td2dError,
} from '@td2d/core';
import { DirectionSpec, issuesFromZod } from '@td2d/schema';
import { type Command, InvalidArgumentError } from 'commander';
import { frameSize, integer, numberList, positiveNumber } from '../options.ts';
import { action } from '../run.ts';
import { pipelineResult, runPipeline } from './generate.ts';

interface RenderOptions {
  glb?: string;
  out?: string;
  force?: boolean;
  directions?: string;
  clips?: string[];
  frames?: FrameSelector[];
  frame: { width: number; height: number };
  supersample: number;
  ppu: number;
  camera: string;
  lighting: string;
  groundMargin?: number;
  clip?: string;
  times?: number[];
  allowHardware?: boolean;
}

function directionSpec(value: string) {
  const candidate = /^d\d|^d1-side$/.test(value) ? value : value.split(',').map((d) => d.trim());
  const parsed = DirectionSpec.safeParse(candidate);
  if (!parsed.success) {
    throw new InvalidArgumentError(
      `Expected a direction set (d1, d1-side, d4, d8, d16) or compass names such as s,w,n,e. ${issuesFromZod(parsed.error)[0]?.message ?? ''}`,
    );
  }
  return parsed.data;
}

export function registerRender(program: Command): void {
  program
    .command('render')
    .description(
      'Render an asset (pipeline stages up to render) or a GLB file to transparent PNG frames, one per direction and sample time.',
    )
    .argument('[id]', 'Asset id: run the pipeline up to the render stage')
    .option('--glb <file>', 'Render a binary glTF file instead of an asset')
    .option('--out <dir>', 'Output directory for --glb. Must be empty, new, or one td2d created.')
    .option(
      '--directions <spec>',
      'With --glb: direction set (d1, d1-side, d4, d8, d16) or compass names (default d4). With an asset id: only these directions, comma separated',
    )
    .option('--clips <list>', 'With an asset id: only these clips, comma separated', (v: string) =>
      v.split(',').map((c) => c.trim()),
    )
    .option(
      '--frames <selector>',
      'With an asset id: only these frames, as clip/direction/range (walk/s/0-2, walk/*/3, idle/*/*). Repeat to add more',
      (v: string, previous: FrameSelector[] = []) => {
        try {
          return [...previous, parseFrameSelector(v)];
        } catch (error) {
          const e = error as Td2dError;
          throw new InvalidArgumentError(`${e.message} ${e.hint ?? ''}`.trim());
        }
      },
    )
    .option('--frame <WxH>', 'Final sprite size in pixels', frameSize, { width: 32, height: 32 })
    .option('--supersample <n>', 'Render at this multiple of the frame size', integer(1, 16), 4)
    .option('--ppu <n>', 'Pixels per metre in the final sprite', positiveNumber(1024), 16)
    .option('--camera <preset>', 'Camera preset', 'dimetric')
    .option(
      '--ground-margin <px>',
      'Pixels between the pivot line and the bottom edge (overrides the preset)',
      integer(0, 1024),
    )
    .option('--lighting <preset>', 'Lighting preset', 'studio-toon')
    .option('--clip <name>', 'Animation clip to sample')
    .option('--times <list>', 'Clip times in seconds, comma separated (default 0)', numberList)
    .option('--allow-hardware', 'Use the GPU if available. Faster, but output depends on the machine.')
    .option('--force', 'With an asset id: recompute instead of reusing cached stages')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d render props/crate --json\n  $ td2d render characters/knight --clips walk --directions s,w --json\n  $ td2d render characters/knight --frames walk/s/0-2 --json\n  $ td2d render --glb crate.glb --out frames --directions d8 --json\n  $ td2d render --glb hero.glb --out walk --clip walk --times 0,0.1,0.2,0.3 --frame 32x48 --ground-margin 4\n\nFrames are written to <out>/<clip or static>/<direction>/<nnn>.png at frame size times supersample.\n',
    )
    .action(
      action(async (ctx, id: string | undefined, opts: RenderOptions) => {
        if (id !== undefined) {
          if (opts.glb || opts.out)
            throw new Td2dError('E_USAGE', 'Pass either an asset id or --glb with --out, not both.');
          const filter: SampleFilter = {
            ...(opts.clips ? { clips: opts.clips } : {}),
            ...(opts.directions ? { directions: opts.directions.split(',').map((d) => d.trim()) } : {}),
            ...(opts.frames ? { frames: opts.frames } : {}),
          };
          return pipelineResult(
            await runPipeline(
              ctx,
              [id],
              { to: 'render', force: opts.force === true, allowHardware: opts.allowHardware === true },
              Object.keys(filter).length > 0 ? { filter, partialRender: true } : {},
            ),
          );
        }
        if (!opts.glb || !opts.out)
          throw new Td2dError('E_USAGE', 'Pass an asset id, or --glb <file> with --out <dir>.');
        if (opts.clips || opts.frames)
          throw new Td2dError('E_USAGE', '--clips and --frames need an asset id; with --glb use --clip and --times.');
        const glb = opts.glb;
        const out = opts.out;
        if (opts.times && !opts.clip) throw new Td2dError('E_USAGE', '--times needs --clip.');
        const project = ctx.tryProject();
        const library = loadLibrary(project instanceof Error ? undefined : project);
        const camera = presetSettings(library, 'camera', opts.camera);
        const lighting = presetSettings(library, 'lighting', opts.lighting);
        const directions = directionsFromSpec(directionSpec(opts.directions ?? 'd4'));
        const samples = planSamples({
          directions,
          clips: opts.clip ? [{ name: opts.clip, times: opts.times ?? [0] }] : [],
        });
        const outDir = resolve(ctx.cwd, out);

        ctx.progress.stageStart('render', { total: samples.length });
        const result = await renderGlbToDir({
          glbPath: resolve(ctx.cwd, glb),
          outDir,
          backend: DEFAULT_BACKEND_ID,
          backendOptions: { allowHardware: opts.allowHardware === true },
          logger: ctx.logger,
          signal: ctx.signal,
          scene: {
            frame: opts.frame,
            supersample: opts.supersample,
            pixelsPerUnit: opts.ppu,
            camera: {
              pitch: camera.pitch,
              yawOffset: camera.yawOffset,
              groundMargin: opts.groundMargin ?? camera.groundMargin,
            },
            lighting,
          },
          samples,
          onFrame: (f) => ctx.progress.itemDone('render', f),
        });
        ctx.progress.stageDone('render', { durationMs: result.timings.totalMs, cached: false });

        const data = {
          glb: relativePosix(ctx.cwd, resolve(ctx.cwd, glb)),
          out: relativePosix(ctx.cwd, outDir),
          backend: result.backend,
          model: result.model,
          groundMargin: result.groundMargin,
          frames: result.frames,
          timings: result.timings,
        };
        return {
          data,
          warnings: result.warnings,
          human: (d: typeof data & Pick<RenderToDirResult, 'backend'>) =>
            `Rendered ${d.frames.length} frame(s) to ${d.out}/ in ${d.timings.totalMs} ms with ${d.backend.renderer}.`,
        };
      }),
    );
}
