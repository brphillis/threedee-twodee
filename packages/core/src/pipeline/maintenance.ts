import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Td2dError } from '../errors.ts';
import { toPosix } from '../fs/paths.ts';

export interface CacheEntry {
  /** A stage output directory, or a single item file (one rendered sample or sprite). */
  readonly kind: 'stage' | 'item';
  /** Stage name, or item kind (render, pixel). */
  readonly group: string;
  /** Path relative to the cache root. */
  readonly path: string;
  readonly bytes: number;
  /** When it was last written or reused. */
  readonly lastUsed: Date;
}

export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 ** 3;
export const CACHE_INDEX = 'index.json';

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const DURATIONS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "5GB", "500MB", "1.5GB" or a number of bytes. */
export function parseSize(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/i.exec(value.trim());
  if (!match) throw new Td2dError('E_USAGE', `"${value}" is not a size.`, { hint: 'Use a size such as 500MB or 5GB.' });
  return Math.round(Number(match[1]) * (UNITS[(match[2] as string).toLowerCase()] as number));
}

/** "30s", "15m", "12h", "1d" or "2w". */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i.exec(value.trim());
  if (!match)
    throw new Td2dError('E_USAGE', `"${value}" is not a duration.`, { hint: 'Use a duration such as 12h, 1d or 2w.' });
  return Math.round(Number(match[1]) * (DURATIONS[(match[2] as string).toLowerCase()] as number));
}

function directorySize(dir: string): { bytes: number; newest: number } {
  let bytes = 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = directorySize(full);
      bytes += inner.bytes;
      newest = Math.max(newest, inner.newest);
    } else {
      const st = statSync(full);
      bytes += st.size;
      newest = Math.max(newest, st.mtimeMs);
    }
  }
  return { bytes, newest };
}

/** Every stage entry and item in a cache. A stage entry was last used when its meta.json was last touched. */
export function listCacheEntries(root: string): CacheEntry[] {
  const out: CacheEntry[] = [];
  if (!existsSync(root)) return out;
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = join(root, group.name);
    if (group.name === 'items') {
      for (const kind of readdirSync(groupDir, { withFileTypes: true })) {
        if (!kind.isDirectory()) continue;
        for (const prefix of readdirSync(join(groupDir, kind.name), { withFileTypes: true })) {
          if (!prefix.isDirectory()) continue;
          for (const file of readdirSync(join(groupDir, kind.name, prefix.name))) {
            if (file.endsWith('.tmp')) continue;
            const full = join(groupDir, kind.name, prefix.name, file);
            const st = statSync(full);
            out.push({
              kind: 'item',
              group: kind.name,
              path: toPosix(relative(root, full)),
              bytes: st.size,
              lastUsed: st.mtime,
            });
          }
        }
      }
      continue;
    }
    for (const prefix of readdirSync(groupDir, { withFileTypes: true })) {
      if (!prefix.isDirectory()) continue;
      for (const hash of readdirSync(join(groupDir, prefix.name), { withFileTypes: true })) {
        if (!hash.isDirectory()) continue;
        const full = join(groupDir, prefix.name, hash.name);
        const meta = join(full, 'meta.json');
        if (!existsSync(meta)) continue;
        const { bytes } = directorySize(full);
        out.push({
          kind: 'stage',
          group: group.name,
          path: toPosix(relative(root, full)),
          bytes,
          lastUsed: statSync(meta).mtime,
        });
      }
    }
  }
  return out.sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime() || (a.path < b.path ? -1 : 1));
}

export interface CacheStats {
  readonly root: string;
  readonly entries: number;
  readonly bytes: number;
  readonly oldest: string | null;
  readonly newest: string | null;
  readonly groups: readonly { kind: 'stage' | 'item'; group: string; entries: number; bytes: number }[];
}

export function cacheStats(root: string, entries = listCacheEntries(root)): CacheStats {
  const groups = new Map<string, { kind: 'stage' | 'item'; group: string; entries: number; bytes: number }>();
  for (const e of entries) {
    const key = `${e.kind}:${e.group}`;
    const g = groups.get(key) ?? { kind: e.kind, group: e.group, entries: 0, bytes: 0 };
    g.entries++;
    g.bytes += e.bytes;
    groups.set(key, g);
  }
  return {
    root,
    entries: entries.length,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    oldest: entries[0]?.lastUsed.toISOString() ?? null,
    newest: entries.at(-1)?.lastUsed.toISOString() ?? null,
    groups: [...groups.values()].sort((a, b) =>
      a.kind === b.kind ? (a.group < b.group ? -1 : 1) : a.kind === 'stage' ? -1 : 1,
    ),
  };
}

/** Rewrite the cache's LRU index: every entry with its size and last use, least recently used first. */
export function writeCacheIndex(root: string, entries = listCacheEntries(root)): void {
  if (!existsSync(root)) return;
  const index = {
    generatedAt: new Date().toISOString(),
    entries: entries.map((e) => ({
      path: e.path,
      kind: e.kind,
      group: e.group,
      bytes: e.bytes,
      lastUsed: e.lastUsed.toISOString(),
    })),
  };
  writeFileSync(join(root, CACHE_INDEX), `${JSON.stringify(index)}\n`);
}

export interface CleanOptions {
  /** Remove entries not used for this many milliseconds. */
  readonly olderThanMs?: number;
  /** Then remove the least recently used entries until the cache is at most this size. */
  readonly maxBytes?: number;
  /** Remove everything. */
  readonly all?: boolean;
  /** Report what would be removed without removing it. */
  readonly dryRun?: boolean;
  readonly now?: Date;
}

export interface CleanResult {
  readonly removed: number;
  readonly freedBytes: number;
  readonly remaining: number;
  readonly remainingBytes: number;
  readonly dryRun: boolean;
}

/** Remove cache entries by age and size, least recently used first, and rewrite the index. */
export function cleanCache(root: string, options: CleanOptions): CleanResult {
  const entries = listCacheEntries(root);
  const now = (options.now ?? new Date()).getTime();
  const remove = new Set<CacheEntry>();
  for (const e of entries) {
    if (options.all || (options.olderThanMs !== undefined && now - e.lastUsed.getTime() > options.olderThanMs))
      remove.add(e);
  }
  if (options.maxBytes !== undefined) {
    let total = entries.filter((e) => !remove.has(e)).reduce((n, e) => n + e.bytes, 0);
    for (const e of entries) {
      if (total <= options.maxBytes) break;
      if (remove.has(e)) continue;
      remove.add(e);
      total -= e.bytes;
    }
  }
  if (!options.dryRun) for (const e of remove) rmSync(join(root, e.path), { recursive: true, force: true });
  const kept = entries.filter((e) => !remove.has(e));
  if (!options.dryRun) writeCacheIndex(root, kept);
  return {
    removed: remove.size,
    freedBytes: [...remove].reduce((n, e) => n + e.bytes, 0),
    remaining: kept.length,
    remainingBytes: kept.reduce((n, e) => n + e.bytes, 0),
    dryRun: options.dryRun === true,
  };
}
