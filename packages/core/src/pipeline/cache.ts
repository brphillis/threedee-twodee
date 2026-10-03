import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cloneFile } from '../fs/copy.ts';

export interface CacheMeta<T = unknown> {
  readonly stage: string;
  readonly hash: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly data: T;
}

const META = 'meta.json';

/**
 * Content-addressed stage outputs: `<root>/<stage>/<hash[0:2]>/<hash>/`. An entry is
 * written to a temporary directory and renamed into place, so a half-written entry is
 * never visible.
 */
export class StageCache {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  entryDir(stage: string, hash: string): string {
    return join(this.root, stage, hash.slice(0, 2), hash);
  }

  read<T>(stage: string, hash: string): { dir: string; meta: CacheMeta<T> } | undefined {
    const dir = this.entryDir(stage, hash);
    const file = join(dir, META);
    if (!existsSync(file)) return undefined;
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8')) as CacheMeta<T>;
      touch(file);
      return { dir, meta };
    } catch {
      return undefined;
    }
  }

  /** Move a finished stage directory into the cache. Returns the entry directory. */
  commit<T>(tmpDir: string, meta: CacheMeta<T>): string {
    writeFileSync(join(tmpDir, META), `${JSON.stringify(meta)}\n`);
    const dir = this.entryDir(meta.stage, meta.hash);
    if (existsSync(join(dir, META))) {
      rmSync(tmpDir, { recursive: true, force: true });
      return dir;
    }
    // A directory without meta.json is left over from an interrupted write.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    try {
      renameSync(tmpDir, dir);
    } catch (error) {
      // Another asset in the same run committed the same entry first.
      if (!existsSync(join(dir, META))) throw error;
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return dir;
  }
}

/** Mark a cache file as just used: cache clean removes the least recently used entries first. */
function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {
    // A concurrent clean removed it; the caller has already read it.
  }
}

/**
 * Content-addressed single files below the stage entries: `<root>/items/<kind>/<hash[0:2]>/<hash><ext>`.
 * One rendered sample or one processed sprite is one item, so a rerun reuses every item
 * whose key is unchanged even when the stage as a whole has to run again.
 */
export class ItemCache {
  readonly root: string;

  constructor(root: string) {
    this.root = join(root, 'items');
  }

  path(kind: string, hash: string, ext = '.png'): string {
    return join(this.root, kind, hash.slice(0, 2), `${hash}${ext}`);
  }

  /** The cached file, or undefined. A hit counts as a use. */
  get(kind: string, hash: string, ext = '.png'): string | undefined {
    const file = this.path(kind, hash, ext);
    if (!existsSync(file)) return undefined;
    touch(file);
    return file;
  }

  /** Store a file or bytes under its key, atomically. */
  put(kind: string, hash: string, source: string | Uint8Array, ext = '.png'): string {
    const file = this.path(kind, hash, ext);
    if (existsSync(file)) return file;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    if (typeof source === 'string') cloneFile(source, tmp);
    else writeFileSync(tmp, source);
    renameSync(tmp, file);
    return file;
  }
}
