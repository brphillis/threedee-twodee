import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ErrorCode, IssueT } from '@td2d/schema';
import { isTd2dError } from './errors.ts';
import type { Logger } from './logger.ts';
import { silentLogger } from './logger.ts';
import { type ProgressReporter, silentProgress } from './progress.ts';
import type { Project } from './project/project.ts';
import { HEADLESS_GL_VERSION, probeHeadlessGl } from './render/headless-gl.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  readonly id: string;
  readonly title: string;
  readonly status: DoctorStatus;
  readonly message: string;
  readonly durationMs: number;
  readonly code?: ErrorCode;
  readonly hint?: string;
  readonly issues?: readonly IssueT[];
  readonly details?: Record<string, unknown>;
  readonly fixed?: boolean;
}

export interface DoctorReport {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorOptions {
  /** The opened project, the error from opening it, or undefined when not in a project. */
  readonly project: Project | Error | undefined;
  readonly cwd: string;
  readonly fix?: boolean;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
  readonly progress?: ProgressReporter;
}

export const MIN_NODE_MAJOR = 24;

type CheckBody = Omit<DoctorCheck, 'id' | 'title' | 'durationMs'>;

async function timed(id: string, title: string, body: () => Promise<CheckBody> | CheckBody): Promise<DoctorCheck> {
  const start = performance.now();
  let result: CheckBody;
  try {
    result = await body();
  } catch (error) {
    result = { status: 'fail', message: error instanceof Error ? error.message : String(error), code: 'E_INTERNAL' };
  }
  return { id, title, ...result, durationMs: Math.round(performance.now() - start) };
}

function checkNode(): CheckBody {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  return major >= MIN_NODE_MAJOR
    ? { status: 'pass', message: `Node.js ${version}`, details: { version } }
    : {
        status: 'fail',
        message: `Node.js ${version} is older than ${MIN_NODE_MAJOR}.`,
        code: 'E_NODE_VERSION',
        hint: `Install Node.js ${MIN_NODE_MAJOR} or newer.`,
        details: { version },
      };
}

function checkProject(project: DoctorOptions['project']): CheckBody {
  if (project === undefined) return { status: 'skip', message: 'Not inside a td2d project.' };
  if (project instanceof Error) {
    if (isTd2dError(project)) {
      return {
        status: 'fail',
        message: project.message,
        code: project.code,
        hint: project.hint,
        ...(project.issues ? { issues: project.issues } : {}),
      };
    }
    return { status: 'fail', message: project.message, code: 'E_INTERNAL' };
  }
  return { status: 'pass', message: `${project.config.name} at ${project.root}`, details: { root: project.root } };
}

function checkWritable(project: DoctorOptions['project'], cwd: string): CheckBody {
  const dir = project && !(project instanceof Error) ? project.root : cwd;
  try {
    accessSync(dir, constants.W_OK);
    return { status: 'pass', message: `${dir} is writable.` };
  } catch {
    return {
      status: 'fail',
      message: `${dir} is not writable.`,
      code: 'E_ENVIRONMENT',
      hint: 'Fix the directory permissions or choose another project directory.',
    };
  }
}

async function checkSharp(): Promise<CheckBody> {
  try {
    const sharp = (await import('sharp')).default;
    return {
      status: 'pass',
      message: `sharp ${sharp.versions.sharp} with libvips ${sharp.versions.vips}`,
      details: { ...sharp.versions },
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `sharp failed to load: ${(error as Error).message}`,
      code: 'E_NATIVE_MODULE',
      hint: 'Reinstall dependencies on this platform so the sharp prebuilt binary matches.',
    };
  }
}

async function checkManifold(): Promise<CheckBody> {
  try {
    const { default: Module } = await import('manifold-3d');
    const wasm = await Module();
    wasm.setup();
    const cube = wasm.Manifold.cube([1, 1, 1]);
    const volume = cube.volume();
    cube.delete();
    return { status: 'pass', message: `manifold-3d WASM loaded (unit cube volume ${volume}).` };
  } catch (error) {
    return {
      status: 'fail',
      message: `manifold-3d failed to load: ${(error as Error).message}`,
      code: 'E_NATIVE_MODULE',
      hint: 'Reinstall dependencies and make sure WebAssembly is allowed.',
    };
  }
}

/** Command that installs the headless browser this Playwright version expects. */
export function browserInstallCommand(): { command: string; args: string[] } {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  return { command: process.execPath, args: [cli, 'install', '--only-shell', '--no-remove', 'chromium'] };
}

async function probeRender(): Promise<{
  version: string;
  renderer: string;
  software: boolean;
  coverage: number;
  ms: number;
}> {
  const { PlaywrightBackend } = await import('./render/playwright.ts');
  const { probeModelGlb } = await import('./render/probe.ts');
  const { alphaCoverage } = await import('./render/frames.ts');
  const { BASE_SETTINGS } = await import('./project/defaults.ts');
  const backend = new PlaywrightBackend();
  const started = performance.now();
  try {
    const info = await backend.start();
    let coverage = 0;
    await backend.render(
      {
        model: { glb: await probeModelGlb() },
        scene: {
          frame: { width: 16, height: 16 },
          supersample: 2,
          pixelsPerUnit: 16,
          camera: { ...BASE_SETTINGS.camera, groundMargin: 4 },
          lighting: BASE_SETTINGS.lighting,
        },
        samples: [{ key: 'probe', clip: null, time: 0, yaw: 0 }],
      },
      (frame) => {
        coverage = alphaCoverage(frame.rgba);
      },
    );
    return {
      version: info.version,
      renderer: info.renderer,
      software: info.software,
      coverage,
      ms: Math.round(performance.now() - started),
    };
  } finally {
    await backend.stop();
  }
}

async function installBrowser(logger: Logger, signal: AbortSignal | undefined): Promise<void> {
  const { command, args } = browserInstallCommand();
  logger.info('Installing the headless browser', { command: [command, ...args].join(' ') });
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`Browser install exited with ${code}: ${output.trim().slice(-500)}`)),
    );
  });
}

async function checkBrowser(fix: boolean, logger: Logger, signal: AbortSignal | undefined): Promise<CheckBody> {
  const rendered = (r: Awaited<ReturnType<typeof probeRender>>, fixed: boolean): CheckBody => {
    const details = { version: r.version, renderer: r.renderer, software: r.software, renderMs: r.ms };
    if (r.coverage === 0) {
      return {
        status: 'fail',
        message: `Chromium ${r.version} started but rendered an empty frame (${r.renderer}).`,
        code: 'E_BACKEND_UNAVAILABLE',
        hint: 'Run with --log-level debug and report the browser output.',
        details,
      };
    }
    if (!r.software) {
      return {
        status: 'warn',
        message: `Rendering works but uses ${r.renderer}, not SwiftShader. Output may differ between machines.`,
        details,
        ...(fixed ? { fixed } : {}),
      };
    }
    return {
      status: 'pass',
      message: `Chromium ${r.version} renders with ${r.renderer} in ${r.ms} ms.`,
      details,
      ...(fixed ? { fixed } : {}),
    };
  };
  try {
    return rendered(await probeRender(), false);
  } catch (error) {
    const code = isTd2dError(error) ? error.code : 'E_BACKEND_UNAVAILABLE';
    const message = (error as Error).message.split('\n')[0] ?? '';
    if (code !== 'E_BROWSER_MISSING') {
      return {
        status: 'fail',
        message: `Rendering failed: ${message}`,
        code,
        hint: isTd2dError(error) ? error.hint : 'Run with --log-level debug for the full browser log.',
      };
    }
    if (!fix) {
      return {
        status: 'fail',
        message: 'The headless browser used for rendering is not installed.',
        code: 'E_BROWSER_MISSING',
        hint: 'Run `td2d doctor --fix` to install it. On Linux, system libraries may also be needed: `npx playwright install-deps chromium`.',
      };
    }
    try {
      await installBrowser(logger, signal);
      return rendered(await probeRender(), true);
    } catch (installError) {
      return {
        status: 'fail',
        message: `Installing the headless browser failed: ${(installError as Error).message}`,
        code: 'E_BROWSER_MISSING',
        hint: 'Check network access, then run `td2d doctor --fix` again.',
      };
    }
  }
}

/** Run every environment check. Checks never throw; failures are reported per check. */
/** The optional headless-gl backend: available or not, never a failure. */
export function checkHeadlessGl(): CheckBody {
  const probe = probeHeadlessGl();
  if (probe.ok)
    return {
      status: 'pass',
      message: `headless-gl ${probe.version} creates a WebGL2 context (${probe.renderer}). Use it with "render": { "backend": "headless-gl" }.`,
      details: { version: probe.version, renderer: probe.renderer },
    };
  return {
    status: 'skip',
    message: `Optional headless-gl backend unavailable: ${probe.reason}.`,
    hint: `Not needed: the default backend renders with the headless browser. To try it, install gl@${HEADLESS_GL_VERSION}${process.platform === 'linux' ? ' and run td2d under xvfb-run' : ''}.`,
  };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const logger = options.logger ?? silentLogger;
  const progress = options.progress ?? silentProgress;
  const plan: [string, string, () => Promise<CheckBody> | CheckBody][] = [
    ['node', 'Node.js version', checkNode],
    ['project', 'Project configuration', () => checkProject(options.project)],
    ['write', 'Write access', () => checkWritable(options.project, options.cwd)],
    ['sharp', 'Image library (sharp)', checkSharp],
    ['manifold', 'Geometry kernel (manifold-3d)', checkManifold],
    ['browser', 'Headless rendering', () => checkBrowser(options.fix ?? false, logger, options.signal)],
    ['headless-gl', 'Optional headless-gl backend', checkHeadlessGl],
  ];
  const started = performance.now();
  progress.stageStart('doctor', { total: plan.length });
  const checks: DoctorCheck[] = [];
  for (const [i, [id, title, body]] of plan.entries()) {
    options.signal?.throwIfAborted();
    const check = await timed(id, title, body);
    checks.push(check);
    progress.itemDone('doctor', { key: id, n: i + 1, total: plan.length, status: check.status });
  }
  progress.stageDone('doctor', { durationMs: Math.round(performance.now() - started), cached: false });
  const status = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return { status, checks };
}
