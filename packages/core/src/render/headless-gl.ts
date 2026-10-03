// A render backend that runs the harness scene in Node on a headless-gl WebGL2 context, without
// a browser. Optional: it needs the `gl` package (an optional peer dependency), and it renders on
// whatever ANGLE picks (the GPU on macOS), so output can differ between machines.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ModelInfo } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import type { Logger } from '../logger.ts';
import type {
  BackendDescriptor,
  BackendInfo,
  BackendOptions,
  FrameSink,
  RenderBackend,
  RenderJob,
  RenderOptions,
  RenderSummary,
} from './backend.ts';
import { flipRows } from './frames.ts';

export const HEADLESS_GL_BACKEND_ID = 'headless-gl';
/** The `gl` version this backend is tested with. */
export const HEADLESS_GL_VERSION = '9.0.0-rc.10';

const require = createRequire(import.meta.url);

/** The part of a headless-gl context this backend uses. Core is built without DOM types. */
interface GlContext {
  readonly RENDERER: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
}

const resizer = (gl: GlContext) =>
  gl.getExtension('STACKGL_resize_drawingbuffer') as { resize(width: number, height: number): void } | null;
const destroyer = (gl: GlContext) => gl.getExtension('STACKGL_destroy_context') as { destroy(): void } | null;
type CreateContext = (width: number, height: number, options: Record<string, unknown>) => GlContext | null;

/** The installed `gl` package, or why it cannot be used. */
export function loadHeadlessGl(): { create: CreateContext; version: string } | { error: string } {
  try {
    const create = require('gl') as CreateContext;
    const version = (require('gl/package.json') as { version: string }).version;
    return { create, version };
  } catch (error) {
    const missing = (error as { code?: string }).code === 'MODULE_NOT_FOUND';
    return {
      error: missing
        ? 'the optional "gl" package is not installed'
        : `the "gl" package failed to load: ${(error as Error).message.split('\n')[0]}`,
    };
  }
}

/** Whether a WebGL2 context can be made here, and with which renderer. For td2d doctor. */
/**
 * Why headless-gl cannot open a context here, before trying: on Linux it needs an X display
 * (xvfb-run provides one), and without one its native code prints an error straight to stderr,
 * where td2d's NDJSON progress goes. Null when there is nothing in the way.
 */
export function missingDisplay(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'linux' || env.DISPLAY) return null;
  return 'no X display on Linux (DISPLAY is not set); run td2d under xvfb-run';
}

export function probeHeadlessGl(): { ok: true; version: string; renderer: string } | { ok: false; reason: string } {
  const gl = loadHeadlessGl();
  if ('error' in gl) return { ok: false, reason: gl.error };
  const display = missingDisplay();
  if (display) return { ok: false, reason: display };
  const context = gl.create(8, 8, { createWebGL2Context: true });
  if (!context)
    return { ok: false, reason: 'headless-gl could not create a WebGL2 context (on Linux, run under xvfb-run)' };
  const renderer = String(context.getParameter(context.RENDERER));
  destroyer(context)?.destroy();
  return { ok: true, version: gl.version, renderer };
}

/** A stand-in canvas: three.js sets its size, and headless-gl resizes its drawing buffer to match. */
function canvasFor(gl: GlContext) {
  const resize = resizer(gl);
  let width = gl.drawingBufferWidth;
  let height = gl.drawingBufferHeight;
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext: () => gl,
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      resize?.resize(width, height);
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      resize?.resize(width, height);
    },
  };
}

/** The harness's source files, hashed: a change to the scene code invalidates cached renders. */
function harnessHash(): string {
  const dir = join(dirname(require.resolve('@td2d/render-harness/package.json')), 'src');
  const hash = createHash('sha256');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort())
    hash.update(file).update(readFileSync(join(dir, file)));
  return hash.digest('hex');
}

interface HarnessLike {
  loadModel(glb: ArrayBuffer): Promise<ModelInfo>;
  configure(settings: RenderJob['scene']): void;
  render(sample: RenderJob['samples'][number]): { width: number; height: number; rgba: Uint8Array };
}

export class HeadlessGlBackend implements RenderBackend {
  readonly id = HEADLESS_GL_BACKEND_ID;
  private readonly logger: Logger | undefined;
  private gl: GlContext | undefined;
  private scene: HarnessLike | undefined;
  private renderer: { dispose(): void } | undefined;
  private info: BackendInfo | undefined;

  constructor(options: BackendOptions = {}) {
    this.logger = options.logger;
  }

  async start(signal?: AbortSignal): Promise<BackendInfo> {
    if (this.info) return this.info;
    signal?.throwIfAborted();
    const loaded = loadHeadlessGl();
    if ('error' in loaded)
      throw new Td2dError('E_BACKEND_UNAVAILABLE', `The headless-gl backend cannot run: ${loaded.error}.`, {
        hint: `Install it with \`npm install gl@${HEADLESS_GL_VERSION}\`, or use the default playwright-swiftshader backend.`,
      });
    const display = missingDisplay();
    if (display)
      throw new Td2dError('E_BACKEND_UNAVAILABLE', `The headless-gl backend cannot run: ${display}.`, {
        hint: 'Install Mesa and xvfb and run `xvfb-run -a td2d ...`, or use the default playwright-swiftshader backend.',
      });
    const gl = loaded.create(64, 64, {
      createWebGL2Context: true,
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl)
      throw new Td2dError('E_BACKEND_UNAVAILABLE', 'headless-gl could not create a WebGL2 context.', {
        hint: 'On Linux, run td2d under xvfb-run with Mesa installed, or use the default playwright-swiftshader backend.',
      });
    const three = await import('three');
    const { HarnessScene } = await import('@td2d/render-harness');
    const renderer = new three.WebGLRenderer({
      canvas: canvasFor(gl) as never,
      context: gl as never,
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    this.gl = gl;
    this.renderer = renderer;
    this.scene = new HarnessScene(renderer) as unknown as HarnessLike;
    const rendererName = String(gl.getParameter(gl.RENDERER));
    this.info = {
      id: this.id,
      version: loaded.version,
      renderer: `headless-gl ${loaded.version} (${rendererName})`,
      software: false,
      harnessVersion: (require('@td2d/render-harness/package.json') as { version: string }).version,
      threeRevision: three.REVISION,
    };
    this.logger?.debug('Render backend started', { ...this.info });
    return this.info;
  }

  async render(job: RenderJob, sink: FrameSink, options: RenderOptions = {}): Promise<RenderSummary> {
    const { signal } = options;
    await this.start(signal);
    const scene = this.scene as HarnessLike;
    const loadStart = performance.now();
    let model: ModelInfo;
    try {
      const bytes = job.model.glb;
      model = await scene.loadModel(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    } catch (error) {
      throw new Td2dError(
        'E_MODEL_INVALID',
        `${job.model.label ?? 'The model'} could not be loaded: ${(error as Error).message.split('\n')[0]}`,
        { cause: error },
      );
    }
    scene.configure(job.scene);
    const loadMs = performance.now() - loadStart;
    const renderStart = performance.now();
    let n = 0;
    for (const sample of job.samples) {
      signal?.throwIfAborted();
      let frame: { width: number; height: number; rgba: Uint8Array };
      try {
        frame = scene.render(sample);
      } catch (error) {
        throw new Td2dError('E_RENDER_FAILED', `Rendering failed: ${(error as Error).message.split('\n')[0]}`, {
          cause: error,
        });
      }
      await sink(
        {
          key: sample.key,
          width: frame.width,
          height: frame.height,
          rgba: flipRows(frame.rgba, frame.width, frame.height),
        },
        n,
      );
      n++;
      options.onFrame?.({ key: sample.key, n, total: job.samples.length });
    }
    return {
      frames: n,
      model,
      timings: { loadMs: Math.round(loadMs), renderMs: Math.round(performance.now() - renderStart) },
    };
  }

  async stop(): Promise<void> {
    this.renderer?.dispose();
    if (this.gl) destroyer(this.gl)?.destroy();
    this.renderer = undefined;
    this.scene = undefined;
    this.gl = undefined;
    this.info = undefined;
  }
}

export const headlessGlBackend: BackendDescriptor = {
  id: HEADLESS_GL_BACKEND_ID,
  description:
    'three.js in Node on a headless-gl WebGL2 context, without a browser. Optional (needs the gl package); renders on the GPU where ANGLE uses one, so output can differ between machines.',
  create: (options) => new HeadlessGlBackend(options),
  fingerprint: () => {
    const gl = loadHeadlessGl();
    return {
      backend: HEADLESS_GL_BACKEND_ID,
      gl: 'error' in gl ? 'missing' : gl.version,
      harness: harnessHash(),
    };
  },
};
