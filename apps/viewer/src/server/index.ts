import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  assetDetail,
  assetDirs,
  buildIndex,
  type FileUrls,
  historyDetail,
  historyOf,
  SERVER_URLS,
  toPosix,
} from './index-builder.ts';
import type { ChangeEvent, ViewerIndex } from './types.ts';
import { type ChangeWatcher, watchBuild } from './watch.ts';

export {
  assetDetail,
  assetDirs,
  buildIndex,
  historyDetail,
  historyOf,
  SERVER_URLS,
  summarise,
} from './index-builder.ts';
export type * from './types.ts';
export { assetOf, assetOfPath, debounce, ignoredPath, watchBuild } from './watch.ts';

/** The package root: this file is two levels deep in both src/server and dist/server. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLIENT_DIR: string = join(PACKAGE_ROOT, 'dist', 'client');
/** Marks an index.html as written by the viewer, so `td2d index` only ever replaces its own page. */
export const VIEWER_MARKER = '<meta name="generator" content="td2d-viewer"';
/** Where the static site keeps everything that is not the build itself. */
export const STATIC_DIR = '_td2d';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.tres': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Resolve a request path inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, requested: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = resolve(root, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  if (!existsSync(target) || !existsSync(root)) return target;
  const real = realpathSync(target);
  const realRoot = realpathSync(root);
  const realRel = relative(realRoot, real);
  return realRel.startsWith('..') || isAbsolute(realRel) ? null : target;
}

function fileResponse(file: string | null): Response {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(file), {
    headers: {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    },
  });
}

const notFound = (message: string) => ({ error: { code: 'E_NOT_GENERATED', message } });

export interface ViewerOptions {
  /** Absolute path of the project's build directory. */
  readonly buildDir: string;
  /** Absolute path of the project's history directory. */
  readonly historyDir: string;
  readonly projectName: string;
  /** Directory holding the built client. Defaults to this package's dist/client. */
  readonly clientDir?: string;
}

/**
 * Shared state of one running viewer: the cached index and the event subscribers. The index is
 * built on first request and kept until a change under build/ invalidates it.
 */
export class ViewerState {
  private cached: ViewerIndex | null = null;
  private readonly listeners = new Set<(event: ChangeEvent) => void>();
  /** Whether a watcher keeps the cache honest. Without one the index is rebuilt for every request. */
  watching = false;

  private readonly options: ViewerOptions;

  constructor(options: ViewerOptions) {
    this.options = options;
  }

  index(): ViewerIndex {
    if (this.watching && this.cached) return this.cached;
    const index = buildIndex(this.options.buildDir, this.options.projectName);
    if (this.watching) this.cached = index;
    return index;
  }

  /** Called by the watcher with the asset ids that changed. */
  changed(assets: readonly string[]): void {
    this.cached = null;
    const event: ChangeEvent = { assets, at: new Date().toISOString() };
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get subscribers(): number {
    return this.listeners.size;
  }
}

/** The viewer as a Hono app. Read-only: no route writes to disk. */
export function createViewerApp(options: ViewerOptions, state: ViewerState = new ViewerState(options)): Hono {
  const app = new Hono();
  const clientDir = options.clientDir ?? CLIENT_DIR;
  app.get('/api/index', (c) => c.json(state.index()));
  app.get('/api/assets/*', (c) => {
    const id = decodeURIComponent(c.req.path.slice('/api/assets/'.length));
    const dir = safeJoin(options.buildDir, id);
    const detail = dir ? assetDetail(options.buildDir, options.historyDir, dir, SERVER_URLS) : null;
    return detail ? c.json(detail) : c.json(notFound(`No generated asset "${id}".`), 404);
  });
  app.get('/api/history/*', (c) => {
    // The entry is the last segment; the asset id, which may contain slashes, is the rest.
    const rest = decodeURIComponent(c.req.path.slice('/api/history/'.length));
    const cut = rest.lastIndexOf('/');
    const id = rest.slice(0, cut);
    const entry = rest.slice(cut + 1);
    const dir = cut > 0 ? safeJoin(options.historyDir, rest) : null;
    if (cut > 0 && !entry) return c.json(historyOf(options.historyDir, rest.slice(0, -1), SERVER_URLS));
    const detail = dir ? historyDetail(dir, id, entry, SERVER_URLS) : null;
    return detail ? c.json(detail) : c.json(notFound(`No history entry "${entry}" for "${id}".`), 404);
  });
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let wake: (() => void) | undefined;
      const queue: ChangeEvent[] = [];
      const unsubscribe = state.subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ watching: state.watching }) });
      while (!stream.aborted && !stream.closed) {
        const event = queue.shift();
        if (event) {
          await stream.writeSSE({ event: 'change', data: JSON.stringify(event) });
          continue;
        }
        // Wait for the next event, with a comment every 15 s so proxies keep the stream open.
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 15_000);
          wake = () => {
            clearTimeout(timer);
            done();
          };
        });
        wake = undefined;
        if (!queue.length && !stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
    }),
  );
  app.get('/files/build/*', (c) => fileResponse(safeJoin(options.buildDir, c.req.path.slice('/files/build/'.length))));
  app.get('/files/history/*', (c) =>
    fileResponse(safeJoin(options.historyDir, c.req.path.slice('/files/history/'.length))),
  );
  app.get('/api/*', (c) => c.json({ error: { code: 'E_USAGE', message: `No route ${c.req.path}.` } }, 404));
  app.get('*', (c) => {
    if (!existsSync(join(clientDir, 'index.html'))) {
      return c.text('The td2d viewer client has not been built. Run `pnpm build` in the td2d repository.', 503);
    }
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const file = safeJoin(clientDir, path);
    return file && existsSync(file) && statSync(file).isFile()
      ? fileResponse(file)
      : fileResponse(join(clientDir, 'index.html'));
  });
  return app;
}

export interface RunningViewer {
  readonly url: string;
  readonly port: number;
  readonly watch: 'native' | 'poll' | 'off';
  readonly state: ViewerState;
  close(): Promise<void>;
}

/**
 * Start the viewer on localhost. Port 0 picks a free port. `watch` chooses how changes under
 * build/ are noticed: "native" (fs.watch, the default), "poll" (chokidar polling, for mounts that
 * deliver no events) or "off" (no live reload).
 */
export async function startViewer(
  options: ViewerOptions & {
    readonly port?: number;
    readonly host?: string;
    readonly watch?: 'native' | 'poll' | 'off';
    readonly debounceMs?: number;
  },
): Promise<RunningViewer> {
  const state = new ViewerState(options);
  const mode = options.watch ?? 'native';
  let watcher: ChangeWatcher | undefined;
  if (mode !== 'off') {
    watcher = await watchBuild(options.buildDir, mode, (assets) => state.changed(assets), options.debounceMs ?? 100);
    state.watching = true;
  }
  const app = createViewerApp(options, state);
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolveStart, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port ?? 4747, hostname: host }, (info: AddressInfo) => {
      resolveStart({
        url: `http://${host.includes(':') ? `[${host}]` : host}:${info.port}/`,
        port: info.port,
        watch: mode,
        state,
        close: async () => {
          await watcher?.close();
          await new Promise<void>((done) => {
            server.close(() => done());
            // Event streams stay open until the client leaves: end them so close() returns.
            (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
          });
        },
      });
    });
    server.on('error', async (error) => {
      await watcher?.close();
      reject(error);
    });
  });
}

export interface StaticSiteOptions {
  readonly buildDir: string;
  readonly historyDir: string;
  readonly projectName: string;
  /** Where to write the site. Defaults to the build directory itself. */
  readonly outDir?: string;
  /** Copy history entries so the History and Compare tabs work. Default true. */
  readonly history?: boolean;
  readonly clientDir?: string;
}

export interface StaticSite {
  readonly outDir: string;
  readonly assets: number;
  readonly historyEntries: number;
  /** index.html, index.json and the _td2d directory, relative to outDir. */
  readonly written: readonly string[];
}

export class StaticSiteError extends Error {
  readonly reason: 'no-client' | 'not-ours';

  constructor(message: string, reason: 'no-client' | 'not-ours') {
    super(message);
    this.name = 'StaticSiteError';
    this.reason = reason;
  }
}

/**
 * Write the viewer as a static site: the SPA, index.json, one JSON file per asset and history
 * entry under _td2d/data, and copies of history entries under _td2d/history. Any static file
 * server can then serve the directory. Only files the viewer owns are replaced.
 */
export function writeStaticSite(options: StaticSiteOptions): StaticSite {
  const clientDir = options.clientDir ?? CLIENT_DIR;
  const outDir = resolve(options.outDir ?? options.buildDir);
  const buildDir = resolve(options.buildDir);
  if (!existsSync(join(clientDir, 'index.html')))
    throw new StaticSiteError(
      'The td2d viewer client has not been built. Run `pnpm build` in the td2d repository.',
      'no-client',
    );
  const page = join(outDir, 'index.html');
  if (existsSync(page) && !readFileSync(page, 'utf8').includes(VIEWER_MARKER))
    throw new StaticSiteError(`${page} exists and was not written by td2d.`, 'not-ours');
  const inPlace = outDir === buildDir;
  rmSync(join(outDir, STATIC_DIR), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // The Vite manifest is a build artefact, not part of the site.
  cpSync(clientDir, outDir, { recursive: true, filter: (src) => !src.includes(`${clientDir}/.vite`) });

  const urls: FileUrls = {
    build: (rel) => `./${rel}`,
    history: (rel) => `./${STATIC_DIR}/history/${rel}`,
  };
  const index = buildIndex(buildDir, options.projectName, { mode: 'static', urls });
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const data = join(outDir, STATIC_DIR, 'data');
  let historyEntries = 0;
  for (const dir of assetDirs(buildDir)) {
    const rel = toPosix(relative(buildDir, dir));
    if (!inPlace) {
      for (const item of [
        'sheets',
        'validation.json',
        'generation.json',
        'resolved.json',
        'rig/model.glb',
        'model/model.glb',
      ]) {
        if (existsSync(join(dir, item))) cpSync(join(dir, item), join(outDir, rel, item), { recursive: true });
      }
    }
    const detail = assetDetail(buildDir, options.history === false ? null : options.historyDir, dir, urls);
    if (!detail) continue;
    const file = join(data, 'assets', `${detail.id}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(detail));
    if (options.history === false) continue;
    for (const entry of detail.history) {
      const source = join(options.historyDir, detail.id, entry.id);
      const target = join(outDir, STATIC_DIR, 'history', detail.id, entry.id);
      cpSync(source, target, { recursive: true });
      const record = historyDetail(source, detail.id, entry.id, urls);
      if (!record) continue;
      const recordFile = join(data, 'history', detail.id, `${entry.id}.json`);
      mkdirSync(dirname(recordFile), { recursive: true });
      writeFileSync(recordFile, JSON.stringify(record));
      historyEntries++;
    }
  }
  return { outDir, assets: index.assets.length, historyEntries, written: ['index.html', 'index.json', STATIC_DIR] };
}
