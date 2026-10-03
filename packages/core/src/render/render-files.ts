import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameSample, ModelInfo, RenderSceneSettings, WarningT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import { relativePosix } from '../fs/paths.ts';
import type { Logger } from '../logger.ts';
import { MAX_IMPORT_BYTES } from '../model/expand.ts';
import { glbHeaderProblem, readGlb } from '../model/gltf.ts';
import { autoGroundMargin, worldPositions } from '../plan/ground.ts';
import type { BackendInfo, BackendOptions, RenderTimings } from './backend.ts';
import { frameWarnings } from './frame-checks.ts';
import { alphaCoverage, writePng } from './frames.ts';
import { prepareOutputDir } from './output-dir.ts';
import { getBackend } from './registry.ts';

export interface RenderToDirOptions {
  readonly glbPath: string;
  readonly outDir: string;
  /** Scene settings. An "auto" ground margin is fitted to the model. */
  readonly scene: Omit<RenderSceneSettings, 'camera'> & {
    readonly camera: { readonly pitch: number; readonly yawOffset: number; readonly groundMargin: number | 'auto' };
  };
  readonly samples: readonly FrameSample[];
  readonly backend: string;
  readonly backendOptions?: BackendOptions;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
  readonly onStart?: (info: BackendInfo) => void;
  readonly onFrame?: (info: { key: string; n: number; total: number }) => void;
}

export interface WrittenFrame {
  readonly key: string;
  /** Path relative to the output directory. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly coverage: number;
  readonly bytes: number;
}

export interface RenderToDirResult {
  readonly outDir: string;
  readonly backend: BackendInfo;
  readonly model: ModelInfo;
  /** The ground margin used, in final pixels. */
  readonly groundMargin: number;
  readonly frames: readonly WrittenFrame[];
  readonly warnings: readonly WarningT[];
  readonly timings: RenderTimings & { readonly startMs: number; readonly totalMs: number };
}

/** Render a GLB file to `<outDir>/<clip>/<direction>/<nnn>.png`, one PNG per sample. */
export async function renderGlbToDir(options: RenderToDirOptions): Promise<RenderToDirResult> {
  const started = performance.now();
  let glb: Uint8Array;
  try {
    glb = readFileSync(options.glbPath);
  } catch (error) {
    throw new Td2dError('E_MODEL_INVALID', `Cannot read ${options.glbPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (glb.byteLength > MAX_IMPORT_BYTES)
    throw new Td2dError('E_MODEL_INVALID', `${options.glbPath} is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`, {
      hint: 'Simplify the model; sprites cannot show that much detail.',
    });
  const problem = glbHeaderProblem(glb);
  if (problem) throw new Td2dError('E_MODEL_INVALID', `${options.glbPath} is not a valid GLB: ${problem}.`);
  let groundMargin: number;
  if (options.scene.camera.groundMargin === 'auto') {
    let doc: Awaited<ReturnType<typeof readGlb>>;
    try {
      doc = await readGlb(glb);
    } catch (error) {
      throw new Td2dError('E_MODEL_INVALID', `${options.glbPath} is not a valid GLB: ${(error as Error).message}`, {
        cause: error,
      });
    }
    groundMargin = autoGroundMargin(
      worldPositions(doc),
      [...new Set(options.samples.map((s) => s.yaw))],
      options.scene,
    );
  } else {
    groundMargin = options.scene.camera.groundMargin;
  }
  const scene: RenderSceneSettings = { ...options.scene, camera: { ...options.scene.camera, groundMargin } };
  prepareOutputDir(options.outDir);
  const backend = getBackend(options.backend).create({
    ...options.backendOptions,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const frames: WrittenFrame[] = [];
  const warnings: WarningT[] = [];
  try {
    const info = await backend.start(options.signal);
    const startMs = Math.round(performance.now() - started);
    options.onStart?.(info);
    const summary = await backend.render(
      { model: { glb, label: options.glbPath }, scene, samples: options.samples },
      async (frame) => {
        const file = `${frame.key}.png`;
        const bytes = await writePng(join(options.outDir, file), frame);
        warnings.push(...frameWarnings(frame));
        frames.push({
          key: frame.key,
          file,
          width: frame.width,
          height: frame.height,
          coverage: Number(alphaCoverage(frame.rgba).toFixed(6)),
          bytes,
        });
      },
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onFrame ? { onFrame: options.onFrame } : {}),
      },
    );
    return {
      outDir: options.outDir,
      backend: info,
      model: summary.model,
      groundMargin,
      frames,
      warnings: [
        ...(info.software
          ? []
          : [
              {
                code: 'W_HARDWARE_RENDERER' as const,
                message: `Rendering used ${info.renderer}.`,
                hint: 'Drop --allow-hardware for reproducible output.',
              },
            ]),
        ...warnings,
      ],
      timings: { startMs, ...summary.timings, totalMs: Math.round(performance.now() - started) },
    };
  } finally {
    await backend.stop();
  }
}

export function displayFrames(root: string, result: RenderToDirResult): string[] {
  return result.frames.map((f) => relativePosix(root, join(result.outDir, f.file)));
}
