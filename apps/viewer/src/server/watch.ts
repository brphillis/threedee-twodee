import { existsSync, type FSWatcher, watch } from 'node:fs';
import { join, relative } from 'node:path';
import { toPosix } from './index-builder.ts';

export interface ChangeWatcher {
  close(): Promise<void>;
}

/**
 * Collect calls for `ms` after the last one and then run `flush` once with everything collected.
 * Used so a regeneration, which writes many files, sends one change event.
 */
export function debounce<T>(ms: number, flush: (items: Set<T>) => void): { push(item: T): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = new Set<T>();
  return {
    push(item) {
      pending.add(item);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const items = pending;
        pending = new Set();
        timer = undefined;
        flush(items);
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = new Set();
    },
  };
}

/** The asset id a changed path under build/ belongs to: the path up to its sheets/ (or generation.json), else "*". */
export function assetOfPath(rel: string): string {
  const parts = toPosix(rel).split('/');
  const sheets = parts.indexOf('sheets');
  if (sheets > 0) return parts.slice(0, sheets).join('/');
  if (parts.at(-1) === 'generation.json' && parts.length > 1) return parts.slice(0, -1).join('/');
  return '*';
}

/** td2d core writes this file into every asset's build directory. */
const OUTPUT_MARKER = '.td2d-output';

/**
 * The asset a changed path belongs to: the nearest enclosing directory that is an asset's build
 * directory (it has the output marker or a manifest), else what the path itself suggests.
 */
export function assetOf(buildDir: string, rel: string): string {
  const parts = toPosix(rel).split('/').filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const dir = join(buildDir, ...parts.slice(0, n));
    if (existsSync(join(dir, OUTPUT_MARKER)) || existsSync(join(dir, 'sheets', 'manifest.json')))
      return parts.slice(0, n).join('/');
  }
  return assetOfPath(rel);
}

/** Staging directories and temporary files: a regeneration's work in progress. */
export function ignoredPath(rel: string): boolean {
  const parts = toPosix(rel).split('/');
  return parts.includes('.partial') || parts.some((p) => p.endsWith('.tmp'));
}

/**
 * Watch the build directory and report changed asset ids, debounced by `debounceMs`. "native"
 * uses fs.watch with recursive: true; "poll" uses chokidar's polling, for file systems where
 * native events are missing (some network and container mounts).
 */
export async function watchBuild(
  buildDir: string,
  mode: 'native' | 'poll',
  onChange: (assets: string[]) => void,
  debounceMs = 100,
): Promise<ChangeWatcher> {
  const batch = debounce<string>(debounceMs, (ids) => onChange(ids.has('*') ? ['*'] : [...ids].sort()));
  const record = (path: string) => {
    const rel = relative(buildDir, path);
    if (ignoredPath(rel)) return;
    batch.push(rel === '' ? '*' : assetOf(buildDir, rel));
  };
  if (mode === 'native') {
    let watcher: FSWatcher | undefined;
    const start = () => {
      if (!existsSync(buildDir)) return false;
      watcher = watch(buildDir, { recursive: true }, (_event, file) => {
        if (file) record(`${buildDir}/${toPosix(file.toString())}`);
        else batch.push('*');
      });
      return true;
    };
    // The build directory may not exist until the first generation: poll for it.
    let retry: ReturnType<typeof setInterval> | undefined;
    if (!start()) {
      retry = setInterval(() => {
        if (start()) {
          clearInterval(retry);
          batch.push('*');
        }
      }, 500);
    }
    return {
      async close() {
        if (retry) clearInterval(retry);
        watcher?.close();
        batch.cancel();
      },
    };
  }
  const { watch: chokidarWatch } = await import('chokidar');
  const watcher = chokidarWatch(buildDir, {
    ignoreInitial: true,
    usePolling: true,
    interval: 200,
    ignored: (p: string) => ignoredPath(relative(buildDir, p)),
  });
  watcher.on('all', (_event, path) => record(path));
  return {
    async close() {
      await watcher.close();
      batch.cancel();
    },
  };
}
