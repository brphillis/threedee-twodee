import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GenerationRecordT, ManifestT, ValidationReportT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import { relativePosix, resolveInside, toPosix } from '../fs/paths.ts';
import type { Project } from '../project/project.ts';

export interface HistoryEntry {
  readonly id: string;
  readonly assetId: string;
  readonly createdAt: string;
  /** First 12 hex digits of the export stage hash. */
  readonly hash: string;
  readonly dir: string;
  readonly validation: ValidationReportT['status'] | null;
}

function entryId(createdAt: Date, hash: string): string {
  return `${createdAt.toISOString().replace(/[:.]/g, '-')}-${hash.slice(0, 12)}`;
}

/** Newest first. */
export function listHistory(project: Project, assetId: string): HistoryEntry[] {
  const dir = resolveInside(project.paths.history, assetId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
    .map((e) => {
      const full = join(dir, e.name);
      let validation: HistoryEntry['validation'] = null;
      try {
        validation = (JSON.parse(readFileSync(join(full, 'validation.json'), 'utf8')) as ValidationReportT).status;
      } catch {
        validation = null;
      }
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([0-9a-f]+)$/.exec(e.name);
      const createdAt = match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : '';
      return { id: e.name, assetId, createdAt, hash: match?.[6] ?? '', dir: relativePosix(project.root, full), validation };
    })
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Copy the published outputs of a generation into history/<id>/<timestamp>-<hash>/.
 * Nothing is recorded when the newest entry already has the same outputs.
 */
export function recordHistory(project: Project, assetId: string, buildDir: string, exportHash: string, now = new Date()): HistoryEntry | null {
  const latest = listHistory(project, assetId)[0];
  if (latest && exportHash.startsWith(latest.hash)) return null;
  const id = entryId(now, exportHash);
  const dir = join(resolveInside(project.paths.history, assetId), id);
  mkdirSync(dir, { recursive: true });
  cpSync(join(buildDir, 'sheets'), join(dir, 'sheets'), { recursive: true });
  for (const file of ['validation.json', 'generation.json']) {
    if (existsSync(join(buildDir, file))) cpSync(join(buildDir, file), join(dir, file));
  }
  return listHistory(project, assetId).find((e) => e.id === id) ?? null;
}

const ENTRY_NAME = /^\d{4}-\d{2}-\d{2}T/;

/** Every asset id that has history, including assets that no longer exist. Sorted. */
export function historyAssetIds(project: Project): string[] {
  const root = project.paths.history;
  const ids: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || !existsSync(dir)) return;
    const children = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (children.some((e) => ENTRY_NAME.test(e.name))) ids.push(toPosix(relative(root, dir)));
    for (const child of children) if (!ENTRY_NAME.test(child.name)) walk(join(dir, child.name), depth + 1);
  };
  walk(root, 0);
  return ids.filter(Boolean).sort();
}

export interface HistoryDetails extends HistoryEntry {
  readonly bytes: number;
  readonly sheets: { readonly name: string; readonly width: number; readonly height: number; readonly layout: string }[];
  readonly cells: number;
  readonly clips: { readonly name: string; readonly frames: number }[];
  readonly checks: { readonly id: string; readonly status: string; readonly message: string }[];
  readonly generation: Pick<GenerationRecordT, 'finishedAt' | 'durationMs' | 'status'> | null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function bytesOf(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? bytesOf(full) : statSync(full).size;
  }
  return total;
}

/**
 * Find one entry: its id, a unique prefix of it or of its hash, "latest" (the newest) or
 * "previous" (the one before it).
 */
export function findHistoryEntry(project: Project, assetId: string, ref: string): HistoryEntry {
  const entries = listHistory(project, assetId);
  const byName: Record<string, HistoryEntry | undefined> = { latest: entries[0], previous: entries[1] };
  const named = byName[ref];
  if (named) return named;
  const matches = entries.filter((e) => e.id === ref || e.id.startsWith(ref) || (ref.length >= 4 && e.hash.startsWith(ref)));
  if (matches.length === 1) return matches[0] as HistoryEntry;
  throw new Td2dError(
    'E_USAGE',
    entries.length === 0
      ? `${assetId} has no history.`
      : matches.length === 0
        ? `${assetId} has no history entry "${ref}".`
        : `"${ref}" matches ${matches.length} history entries of ${assetId}.`,
    { hint: `Run \`td2d history list ${assetId}\` and pass an entry id, a hash prefix, "latest" or "previous".` },
  );
}

/** One entry with what it holds: sheets, cells, clips, failing checks and timing. */
export function showHistory(project: Project, assetId: string, ref: string): HistoryDetails {
  const entry = findHistoryEntry(project, assetId, ref);
  const dir = join(project.root, entry.dir);
  const manifest = readJson<ManifestT>(join(dir, 'sheets', 'manifest.json'));
  const validation = readJson<ValidationReportT>(join(dir, 'validation.json'));
  const generation = readJson<GenerationRecordT>(join(dir, 'generation.json'));
  return {
    ...entry,
    bytes: bytesOf(dir),
    sheets: manifest?.sheets.map((s) => ({ name: s.name, width: s.width, height: s.height, layout: s.layout })) ?? [],
    cells: manifest?.cells.length ?? 0,
    clips: manifest?.clips.map((c) => ({ name: c.name, frames: c.frames })) ?? [],
    checks: validation?.checks.filter((c) => c.status !== 'pass').map((c) => ({ id: c.id, status: c.status, message: c.message })) ?? [],
    generation: generation ? { finishedAt: generation.finishedAt, durationMs: generation.durationMs, status: generation.status } : null,
  };
}

export interface PruneOptions {
  /** Keep this many newest entries of each asset. */
  readonly keep?: number;
  /** Remove entries older than this many milliseconds. */
  readonly olderThanMs?: number;
  readonly dryRun?: boolean;
  readonly now?: Date;
}

export interface PruneResult {
  readonly removed: (HistoryEntry & { readonly bytes: number })[];
  readonly kept: number;
  readonly bytes: number;
  readonly dryRun: boolean;
}

/**
 * Remove history entries beyond the newest `keep`, or older than `olderThanMs`, or both (an
 * entry goes when either rule says so). The newest entry of an asset is never removed.
 */
export function pruneHistory(project: Project, assetIds: readonly string[], options: PruneOptions): PruneResult {
  if (options.keep === undefined && options.olderThanMs === undefined)
    throw new Td2dError('E_USAGE', 'Say which entries to remove.', { hint: 'Pass --keep <n>, --older-than <duration>, or both.' });
  const now = (options.now ?? new Date()).getTime();
  const removed: PruneResult['removed'][number][] = [];
  let kept = 0;
  for (const id of assetIds) {
    const entries = listHistory(project, id);
    entries.forEach((entry, i) => {
      const beyond = options.keep !== undefined && i >= Math.max(1, options.keep);
      const old = options.olderThanMs !== undefined && i > 0 && now - Date.parse(entry.createdAt) > options.olderThanMs;
      if (!beyond && !old) {
        kept++;
        return;
      }
      const dir = join(project.root, entry.dir);
      const bytes = bytesOf(dir);
      if (!options.dryRun) rmSync(dir, { recursive: true, force: true });
      removed.push({ ...entry, bytes });
    });
  }
  return { removed, kept, bytes: removed.reduce((n, e) => n + e.bytes, 0), dryRun: options.dryRun === true };
}
