import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { HARNESS_PROTOCOL_VERSION, type HarnessCapabilities, type ModelInfo } from '@td2d/schema';
import type { Browser, Page } from 'playwright';
import { isTd2dError, Td2dError } from '../errors.ts';
import { type Logger, silentLogger } from '../logger.ts';
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
import { harnessBundle } from './harness-bundle.ts';

export const PLAYWRIGHT_BACKEND_ID = 'playwright-swiftshader';

const ORIGIN = 'https://td2d.local';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>td2d harness</title></head><body><script src="${ORIGIN}/td2d-harness.js"></script></body></html>`;

/** Chromium switches that force the SwiftShader software rasteriser. */
export const SWIFTSHADER_ARGS: readonly string[] = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const NOISY_CONSOLE = /GPU stall due to ReadPixels|Automatic fallback to software WebGL/;

function abortError(signal: AbortSignal): Td2dError {
  return isTd2dError(signal.reason)
    ? signal.reason
    : new Td2dError('E_CANCELLED', 'The render was cancelled.', { cause: signal.reason });
}

function launchError(error: unknown): Td2dError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|please run the following command|playwright install/i.test(message)) {
    return new Td2dError('E_BROWSER_MISSING', 'The headless browser used for rendering is not installed.', {
      cause: error,
    });
  }
  return new Td2dError('E_BACKEND_UNAVAILABLE', `The headless browser failed to start: ${message.split('\n')[0]}`, {
    cause: error,
  });
}

/**
 * Renders with three.js inside Playwright's Chromium headless shell. SwiftShader is
 * forced unless `allowHardware` is set, so output is the same on every machine that
 * runs the same browser build.
 */
export class PlaywrightBackend implements RenderBackend {
  readonly id = PLAYWRIGHT_BACKEND_ID;
  /** Tag added to the browser command line so its processes can be identified. */
  readonly runTag: string = process.env.TD2D_RUN_TAG ?? randomUUID();
  private readonly logger: Logger;
  private readonly options: BackendOptions;
  private browser: Browser | undefined;
  private page: Page | undefined;
  private info: BackendInfo | undefined;
  private pageErrors: string[] = [];
  /** Set when the browser or page dies on its own, as opposed to stop(). */
  private crashed = false;

  constructor(options: BackendOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? silentLogger;
  }

  async start(signal?: AbortSignal): Promise<BackendInfo> {
    if (this.info) return this.info;
    signal?.throwIfAborted();
    const bundle = harnessBundle();
    const { chromium } = await import('playwright');
    const args = [...(this.options.allowHardware ? [] : SWIFTSHADER_ARGS), `--td2d-run=${this.runTag}`];
    try {
      this.browser = await chromium.launch({
        headless: true,
        args,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
    } catch (error) {
      throw launchError(error);
    }
    this.crashed = false;
    const launched = this.browser;
    launched.on('disconnected', () => {
      if (this.browser === launched) this.crashed = true;
    });
    const onAbort = () => void this.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const context = await this.browser.newContext({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      this.page = page;
      page.on('crash', () => {
        this.crashed = true;
      });
      page.on('pageerror', (error) => {
        this.pageErrors.push(error.message);
        this.logger.error('Harness page error', { message: error.message });
      });
      page.on('console', (message) => {
        const text = message.text();
        if (NOISY_CONSOLE.test(text)) return;
        this.logger.debug('Harness console', { type: message.type(), text });
      });
      await page.route(`${ORIGIN}/**`, (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/td2d-harness.js')
          return route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle.source });
        if (url.pathname === '/' || url.pathname === '/index.html')
          return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
        return route.fulfill({ status: 404, body: 'not found' });
      });
      await page.goto(`${ORIGIN}/index.html`);
      await page.waitForFunction(
        () => (globalThis as { __td2d?: { ready?: boolean } }).__td2d?.ready === true,
        undefined,
        { timeout: 15_000 },
      );
      const protocol = await page.evaluate(
        () => (globalThis as unknown as { __td2d: { protocol: number } }).__td2d.protocol,
      );
      if (protocol !== HARNESS_PROTOCOL_VERSION) {
        throw new Td2dError(
          'E_BACKEND_UNAVAILABLE',
          `The render harness speaks protocol ${protocol}, but td2d expects ${HARNESS_PROTOCOL_VERSION}.`,
          {
            hint: 'Rebuild td2d with `pnpm build`.',
          },
        );
      }
      const caps = await page.evaluate(() =>
        (globalThis as unknown as { __td2d: { capabilities(): HarnessCapabilities } }).__td2d.capabilities(),
      );
      if (!caps.webgl2) {
        throw new Td2dError(
          'E_BACKEND_UNAVAILABLE',
          `WebGL2 is not available in the headless browser: ${caps.renderer}`,
          {
            hint: 'Run `td2d doctor`. On Linux, install the browser system libraries with `npx playwright install-deps chromium`.',
          },
        );
      }
      this.info = {
        id: this.id,
        version: this.browser.version(),
        renderer: caps.renderer,
        software: /swiftshader/i.test(caps.renderer),
        harnessVersion: caps.harnessVersion,
        threeRevision: caps.threeRevision,
      };
      this.logger.debug('Render backend started', { ...this.info });
      return this.info;
    } catch (error) {
      await this.stop();
      if (signal?.aborted) throw abortError(signal);
      throw isTd2dError(error) ? error : launchError(error);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
    const ms = this.options.batchTimeoutMs ?? 120_000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Td2dError('E_RENDER_FAILED', `${what} took longer than ${ms} ms.`)), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async render(job: RenderJob, sink: FrameSink, options: RenderOptions = {}): Promise<RenderSummary> {
    const { signal } = options;
    await this.start(signal);
    const page = this.page;
    if (!page) throw new Td2dError('E_BACKEND_UNAVAILABLE', 'The render backend is not running.');
    const onAbort = () => void this.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.pageErrors = [];
    try {
      const loadStart = performance.now();
      const glbBase64 = Buffer.from(job.model.glb.buffer, job.model.glb.byteOffset, job.model.glb.byteLength).toString(
        'base64',
      );
      let model: ModelInfo;
      try {
        model = await this.withTimeout(
          page.evaluate(
            (b64) =>
              (globalThis as unknown as { __td2d: { loadModel(b: string): Promise<ModelInfo> } }).__td2d.loadModel(b64),
            glbBase64,
          ),
          'Loading the model',
        );
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (isTd2dError(error)) throw error;
        throw new Td2dError(
          'E_MODEL_INVALID',
          `${job.model.label ?? 'The model'} could not be loaded: ${(error as Error).message.split('\n')[0]}`,
          { cause: error },
        );
      }
      await page.evaluate(
        (s) => (globalThis as unknown as { __td2d: { configure(s: unknown): void } }).__td2d.configure(s),
        job.scene as unknown as Record<string, unknown>,
      );
      const loadMs = performance.now() - loadStart;

      const renderStart = performance.now();
      const batchSize = Math.max(1, this.options.batchSize ?? 16);
      const batches: RenderJob['samples'][number][][] = [];
      for (let i = 0; i < job.samples.length; i += batchSize) batches.push(job.samples.slice(i, i + batchSize));
      const request = (batch: RenderJob['samples'][number][]) => {
        const pending = this.withTimeout(
          page.evaluate(
            (samples) =>
              (
                globalThis as unknown as {
                  __td2d: {
                    renderSamples(s: unknown): { key: string; width: number; height: number; rgbaBase64: string }[];
                  };
                }
              ).__td2d.renderSamples(samples),
            batch as unknown as Record<string, unknown>[],
          ),
          `Rendering ${batch.length} frame(s)`,
        );
        // Awaited below; this only keeps a failure that arrives while the sink is busy from
        // being reported as unhandled.
        pending.catch(() => undefined);
        return pending;
      };
      let n = 0;
      // The browser renders batch i + 1 while the sink writes out batch i, so neither waits for the other.
      let next = batches[0] ? request(batches[0]) : null;
      for (let b = 0; next; b++) {
        signal?.throwIfAborted();
        const encoded = await next;
        const following = batches[b + 1];
        next = following ? request(following) : null;
        for (const frame of encoded) {
          signal?.throwIfAborted();
          const raw = Buffer.from(frame.rgbaBase64, 'base64');
          const rgba = flipRows(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), frame.width, frame.height);
          await sink({ key: frame.key, width: frame.width, height: frame.height, rgba }, n);
          n++;
          options.onFrame?.({ key: frame.key, n, total: job.samples.length });
        }
      }
      return {
        frames: n,
        model,
        timings: { loadMs: Math.round(loadMs), renderMs: Math.round(performance.now() - renderStart) },
      };
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (this.crashed) {
        await this.stop();
        throw new Td2dError(
          'E_BACKEND_CRASHED',
          `The headless browser crashed while rendering: ${(error as Error).message.split('\n')[0]}`,
          {
            cause: error,
            details: { pageErrors: this.pageErrors.slice(0, 10) },
          },
        );
      }
      if (isTd2dError(error)) throw error;
      throw new Td2dError('E_RENDER_FAILED', `Rendering failed: ${(error as Error).message.split('\n')[0]}`, {
        cause: error,
        details: { pageErrors: this.pageErrors.slice(0, 10) },
      });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async stop(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    this.info = undefined;
    if (browser) await browser.close().catch(() => undefined);
  }
}

export const playwrightBackend: BackendDescriptor = {
  id: PLAYWRIGHT_BACKEND_ID,
  description:
    'three.js in the Playwright Chromium headless shell with the SwiftShader software rasteriser. Reproducible across machines.',
  create: (options) => new PlaywrightBackend(options),
  fingerprint: () => {
    const require = createRequire(import.meta.url);
    const { version } = require('playwright/package.json') as { version: string };
    return {
      backend: PLAYWRIGHT_BACKEND_ID,
      playwright: version,
      harness: createHash('sha256').update(harnessBundle().source).digest('hex'),
      protocol: String(HARNESS_PROTOCOL_VERSION),
    };
  },
};
