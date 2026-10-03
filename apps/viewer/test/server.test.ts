import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIndex,
  createViewerApp,
  type HistorySummary,
  type RunningViewer,
  StaticSiteError,
  safeJoin,
  startViewer,
  VIEWER_MARKER,
  ViewerState,
  writeStaticSite,
} from '../src/server/index.ts';

const dirs: string[] = [];
const viewers: RunningViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.close();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const ENTRY = '2026-10-01T10-00-00-000Z-0123456789ab';

function manifest(generatedAt: string) {
  return {
    assetId: 'props/crate',
    generatedAt,
    frame: { width: 32, height: 32 },
    pivot: { x: 16, y: 28, normalized: { x: 0.5, y: 0.875 } },
    sheets: [{ name: 'crate', image: 'crate.png', data: 'crate.json', width: 32, height: 128, layout: 'grid' }],
    cells: [
      {
        key: 'idle/s/000',
        clip: 'idle',
        direction: 's',
        index: 0,
        sheet: 'crate',
        x: 0,
        y: 32,
        w: 30,
        h: 28,
        trimmed: true,
        offset: { x: 1, y: 2 },
        mirrored: false,
      },
    ],
    directions: [{ name: 's', yaw: 0, mirrorOf: null }],
    clips: [{ name: 'idle', fps: 10, frames: 1, loop: true, durationMs: 100 }],
    validation: { status: 'pass', warnings: 0, errors: 0, report: '../validation.json' },
  };
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-viewer-')));
  dirs.push(root);
  const build = join(root, 'build');
  const history = join(root, 'history');
  const asset = join(build, 'props', 'crate');
  mkdirSync(join(asset, 'sheets'), { recursive: true });
  mkdirSync(join(asset, 'rig'), { recursive: true });
  writeFileSync(join(asset, 'sheets', 'manifest.json'), JSON.stringify(manifest('2026-10-02T00:00:00.000Z')));
  writeFileSync(join(asset, 'sheets', 'crate.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(asset, 'rig', 'model.glb'), Buffer.from('glTF'));
  writeFileSync(join(asset, 'validation.json'), JSON.stringify({ status: 'pass', checks: [] }));
  writeFileSync(
    join(asset, 'resolved.json'),
    JSON.stringify({
      tags: ['wood', 'prop'],
      type: 'prop',
      camera: {},
      lighting: {},
      pixel: {},
      sheet: {},
      materials: {},
      rig: null,
    }),
  );
  const entry = join(history, 'props', 'crate', ENTRY);
  mkdirSync(join(entry, 'sheets'), { recursive: true });
  writeFileSync(join(entry, 'sheets', 'manifest.json'), JSON.stringify(manifest('2026-10-01T10:00:00.000Z')));
  writeFileSync(join(entry, 'sheets', 'crate.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  writeFileSync(join(entry, 'validation.json'), JSON.stringify({ status: 'warn', checks: [] }));
  // Not a history entry: no manifest.
  mkdirSync(join(history, 'props', 'crate', '2026-09-01T00-00-00-000Z-ffffffffffff'), { recursive: true });
  writeFileSync(join(root, 'secret.txt'), 'outside the build directory');
  const client = join(root, 'client');
  mkdirSync(join(client, '_td2d', 'app'), { recursive: true });
  mkdirSync(join(client, '.vite'), { recursive: true });
  writeFileSync(join(client, 'index.html'), `<!doctype html>${VIEWER_MARKER} /><title>viewer</title>`);
  writeFileSync(join(client, '_td2d', 'app', 'main.js'), 'console.log(1)');
  writeFileSync(join(client, '.vite', 'manifest.json'), '{}');
  return { root, build, history, client, asset };
}

const options = (f: ReturnType<typeof fixture>) => ({
  buildDir: f.build,
  historyDir: f.history,
  projectName: 'demo',
  clientDir: f.client,
});

describe('buildIndex', () => {
  it('summarises generated assets with a thumbnail of the first cell, tags and type', () => {
    const { build } = fixture();
    mkdirSync(join(build, 'props', 'empty'), { recursive: true });
    mkdirSync(join(build, '_td2d', 'data', 'sheets'), { recursive: true });
    writeFileSync(
      join(build, '_td2d', 'data', 'sheets', 'manifest.json'),
      JSON.stringify(manifest('2026-01-01T00:00:00.000Z')),
    );
    const index = buildIndex(build, 'demo');
    expect(index.project.name).toBe('demo');
    expect(index.mode).toBe('server');
    expect(index.assets).toEqual([
      expect.objectContaining({
        id: 'props/crate',
        cells: 1,
        sheets: 1,
        validation: 'pass',
        tags: ['wood', 'prop'],
        type: 'prop',
        files: '/files/build/props/crate',
        thumbnail: {
          image: '/files/build/props/crate/sheets/crate.png',
          x: 0,
          y: 32,
          w: 30,
          h: 28,
          offset: { x: 1, y: 2 },
        },
      }),
    ]);
  });

  it('returns no assets for a missing build directory', () => {
    expect(buildIndex(join(tmpdir(), 'td2d-does-not-exist'), 'x').assets).toEqual([]);
  });
});

describe('safeJoin', () => {
  it('keeps paths inside the root and rejects escapes, including through symlinks', () => {
    const { root, build } = fixture();
    expect(safeJoin(build, 'props/crate/sheets/crate.png')).toBe(join(build, 'props/crate/sheets/crate.png'));
    expect(safeJoin(build, '../secret.txt')).toBeNull();
    expect(safeJoin(build, '%2e%2e/secret.txt')).toBeNull();
    expect(safeJoin(build, 'a\0b')).toBeNull();
    expect(safeJoin(build, '%E0%A4%A')).toBeNull();
    symlinkSync(root, join(build, 'escape'));
    expect(safeJoin(build, 'escape/secret.txt')).toBeNull();
  });
});

describe('viewer routes', () => {
  it('serves the index, asset details with history, history entries, files and the client', async () => {
    const f = fixture();
    const app = createViewerApp(options(f));
    expect(((await (await app.request('/api/index')).json()) as { assets: unknown[] }).assets).toHaveLength(1);
    const detail = (await (await app.request('/api/assets/props/crate')).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      id: 'props/crate',
      files: '/files/build/props/crate',
      validation: { status: 'pass' },
      generation: null,
      model: '/files/build/props/crate/rig/model.glb',
      resolved: { rig: null },
    });
    expect(detail.history as HistorySummary[]).toEqual([
      {
        id: ENTRY,
        createdAt: '2026-10-01T10:00:00.000Z',
        hash: '0123456789ab',
        validation: 'warn',
        files: `/files/history/props/crate/${ENTRY}`,
      },
    ]);
    // Encoded ids work as well as plain slashes.
    expect((await app.request('/api/assets/props%2Fcrate')).status).toBe(200);
    const entry = (await (await app.request(`/api/history/props/crate/${ENTRY}`)).json()) as Record<string, unknown>;
    expect(entry).toMatchObject({
      id: 'props/crate',
      entry: ENTRY,
      files: `/files/history/props/crate/${ENTRY}`,
      validation: { status: 'warn' },
    });
    expect(((await (await app.request('/api/history/props/crate/')).json()) as unknown[]).length).toBe(1);
    expect((await app.request('/api/history/props/crate/2026-09-01T00-00-00-000Z-ffffffffffff')).status).toBe(404);
    const png = await app.request('/files/build/props/crate/sheets/crate.png');
    expect([png.status, png.headers.get('content-type')]).toEqual([200, 'image/png']);
    const old = await app.request(`/files/history/props/crate/${ENTRY}/sheets/crate.png`);
    expect([old.status, (await old.arrayBuffer()).byteLength]).toEqual([200, 5]);
    expect((await app.request('/files/build/props/crate/rig/model.glb')).headers.get('content-type')).toBe(
      'model/gltf-binary',
    );
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/_td2d/app/main.js')).headers.get('content-type')).toMatch(/javascript/);
    expect(await (await app.request('/asset/whatever')).text()).toMatch(/<title>viewer/);
    expect((await app.request('/api/nothing')).status).toBe(404);
  });

  it('never serves files outside the build and history directories', async () => {
    const f = fixture();
    const app = createViewerApp(options(f));
    for (const path of [
      '/files/build/%2e%2e/secret.txt',
      '/files/build/..%2fsecret.txt',
      '/files/build/props/..%2f..%2fsecret.txt',
      '/files/history/..%2fsecret.txt',
      '/api/history/..%2f..%2fsecret.txt/x',
    ]) {
      const response = await app.request(path);
      expect(await response.text(), path).not.toMatch(/outside the build directory/);
    }
    expect((await app.request('/api/assets/missing/thing')).status).toBe(404);
  });

  it('explains when the client has not been built', async () => {
    const f = fixture();
    const app = createViewerApp({ ...options(f), clientDir: join(f.root, 'nope') });
    const response = await app.request('/');
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/pnpm build/);
  });
});

describe('ViewerState', () => {
  it('caches the index while watching and rebuilds it after a change', () => {
    const f = fixture();
    const state = new ViewerState(options(f));
    state.watching = true;
    const first = state.index();
    expect(state.index()).toBe(first);
    const events: unknown[] = [];
    const unsubscribe = state.subscribe((e) => events.push(e.assets));
    state.changed(['props/crate']);
    expect(events).toEqual([['props/crate']]);
    expect(state.index()).not.toBe(first);
    unsubscribe();
    expect(state.subscribers).toBe(0);
  });

  it('rebuilds the index on every request without a watcher', () => {
    const f = fixture();
    const state = new ViewerState(options(f));
    expect(state.index()).not.toBe(state.index());
  });
});

/** Reads server-sent events from a response in the background, until stopped. */
class EventReader {
  private readonly events: { type: string; data: string }[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private done = false;

  constructor(response: Response) {
    this.reader = (response.body as ReadableStream<Uint8Array>).getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type && data) this.events.push({ type, data });
        }
      }
    } catch {
      // The server closed the stream.
    }
    this.done = true;
  }

  /** The next event of `type`, parsed. */
  async next(type: string, timeout = 3000): Promise<unknown> {
    const started = performance.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.type === type);
      if (i >= 0) return JSON.parse((this.events.splice(i, 1)[0] as { data: string }).data);
      if (this.done || performance.now() - started > timeout) throw new Error(`no ${type} event`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  get closed(): boolean {
    return this.done;
  }

  async stop(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}

describe('live reload', () => {
  it('streams a hello and then one debounced change event per regeneration', async () => {
    const f = fixture();
    const viewer = await startViewer({ ...options(f), port: 0, watch: 'native', debounceMs: 100 });
    viewers.push(viewer);
    const response = await fetch(`${viewer.url}api/events`);
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = new EventReader(response);
    expect(await events.next('hello')).toEqual({ watching: true });
    // Write a burst of files like a regeneration does: one event must come of it.
    const started = performance.now();
    for (let i = 0; i < 5; i++)
      writeFileSync(join(f.asset, 'sheets', 'manifest.json'), JSON.stringify(manifest(`2026-10-03T00:00:0${i}.000Z`)));
    writeFileSync(join(f.asset, 'generation.json'), '{}');
    const event = (await events.next('change')) as { assets: string[] };
    expect(performance.now() - started).toBeLessThan(1000);
    expect(event.assets).toEqual(['props/crate']);
    await new Promise((r) => setTimeout(r, 300));
    await expect(events.next('change', 0)).rejects.toThrow();
    await events.stop();
    // The cache was invalidated: the index carries the new generation time.
    const index = (await (await fetch(`${viewer.url}api/index`)).json()) as { assets: { generatedAt: string }[] };
    expect(index.assets[0]?.generatedAt).toBe('2026-10-03T00:00:04.000Z');
  });

  it('reports watching false with --no-watch', async () => {
    const f = fixture();
    const viewer = await startViewer({ ...options(f), port: 0, watch: 'off' });
    viewers.push(viewer);
    const events = new EventReader(await fetch(`${viewer.url}api/events`));
    expect(await events.next('hello')).toEqual({ watching: false });
    expect(viewer.watch).toBe('off');
    await events.stop();
  });

  it('closes with event streams still open', async () => {
    const f = fixture();
    const viewer = await startViewer({ ...options(f), port: 0, watch: 'poll' });
    const events = new EventReader(await fetch(`${viewer.url}api/events`));
    await events.next('hello');
    const started = performance.now();
    await viewer.close();
    expect(performance.now() - started).toBeLessThan(2000);
    while (!events.closed) await new Promise((r) => setTimeout(r, 10));
  });
});

describe('writeStaticSite', () => {
  it('writes the SPA, index.json, per-asset data and history copies into the build directory', () => {
    const f = fixture();
    const site = writeStaticSite({
      buildDir: f.build,
      historyDir: f.history,
      projectName: 'demo',
      clientDir: f.client,
    });
    expect([site.assets, site.historyEntries]).toEqual([1, 1]);
    expect(existsSync(join(f.build, 'index.html'))).toBe(true);
    expect(existsSync(join(f.build, '_td2d', 'app', 'main.js'))).toBe(true);
    expect(existsSync(join(f.build, '.vite'))).toBe(false);
    const index = JSON.parse(readFileSync(join(f.build, 'index.json'), 'utf8'));
    expect(index.mode).toBe('static');
    expect(index.assets[0].files).toBe('./props/crate');
    expect(index.assets[0].thumbnail.image).toBe('./props/crate/sheets/crate.png');
    const detail = JSON.parse(readFileSync(join(f.build, '_td2d', 'data', 'assets', 'props', 'crate.json'), 'utf8'));
    expect(detail.history[0].files).toBe(`./_td2d/history/props/crate/${ENTRY}`);
    expect(detail.model).toBe('./props/crate/rig/model.glb');
    expect(existsSync(join(f.build, '_td2d', 'history', 'props', 'crate', ENTRY, 'sheets', 'crate.png'))).toBe(true);
    const entry = JSON.parse(
      readFileSync(join(f.build, '_td2d', 'data', 'history', 'props', 'crate', `${ENTRY}.json`), 'utf8'),
    );
    expect(entry.entry).toBe(ENTRY);
    // Writing again replaces only the viewer's own files, and the index still finds one asset.
    expect(
      writeStaticSite({ buildDir: f.build, historyDir: f.history, projectName: 'demo', clientDir: f.client }).assets,
    ).toBe(1);
  });

  it('copies the build outputs to another directory, and can leave history out', () => {
    const f = fixture();
    const out = join(f.root, 'site');
    const site = writeStaticSite({
      buildDir: f.build,
      historyDir: f.history,
      projectName: 'demo',
      clientDir: f.client,
      outDir: out,
      history: false,
    });
    expect(site.historyEntries).toBe(0);
    expect(existsSync(join(out, 'props', 'crate', 'sheets', 'crate.png'))).toBe(true);
    expect(existsSync(join(out, 'props', 'crate', 'rig', 'model.glb'))).toBe(true);
    expect(existsSync(join(out, '_td2d', 'history'))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(out, '_td2d', 'data', 'assets', 'props', 'crate.json'), 'utf8')).history,
    ).toEqual([]);
  });

  it('refuses to replace an index.html it did not write', () => {
    const f = fixture();
    writeFileSync(join(f.build, 'index.html'), '<!doctype html><title>mine</title>');
    expect(() =>
      writeStaticSite({ buildDir: f.build, historyDir: f.history, projectName: 'demo', clientDir: f.client }),
    ).toThrow(StaticSiteError);
    expect(readFileSync(join(f.build, 'index.html'), 'utf8')).toMatch(/mine/);
  });
});
