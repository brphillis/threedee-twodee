import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GenerationRecordT, ManifestT, ResolvedAssetT, ValidationReportT } from '@td2d/schema';
import type {
  AssetDetail,
  AssetSummary,
  HistoryDetail,
  HistorySummary,
  ResolvedSummary,
  ViewerIndex,
} from './types.ts';

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export const toPosix = (p: string) => p.split('\\').join('/');

/** Where each kind of file is served from: the server's /files/ routes, or paths relative to a static site. */
export interface FileUrls {
  build(rel: string): string;
  history(rel: string): string;
}

export const SERVER_URLS: FileUrls = {
  build: (rel) => `/files/build/${rel}`,
  history: (rel) => `/files/history/${rel}`,
};

/** The asset directories under build/, found by their sheets/manifest.json. */
export function assetDirs(buildDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || !existsSync(dir)) return;
    if (existsSync(join(dir, 'sheets', 'manifest.json'))) {
      out.push(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(buildDir, 0);
  return out;
}

/** One asset's library entry. */
export function summarise(buildDir: string, dir: string, urls: FileUrls): AssetSummary | null {
  const manifest = readJson<ManifestT>(join(dir, 'sheets', 'manifest.json'));
  if (!manifest) return null;
  const resolved = readJson<Pick<ResolvedAssetT, 'tags' | 'type'>>(join(dir, 'resolved.json'));
  const rel = toPosix(relative(buildDir, dir));
  const firstClip = manifest.clips[0]?.name;
  const firstDirection = manifest.directions[0]?.name;
  const cell =
    manifest.cells.find((c) => c.clip === firstClip && c.direction === firstDirection && c.index === 0) ??
    manifest.cells[0];
  const sheet = cell ? manifest.sheets.find((s) => s.name === cell.sheet) : undefined;
  return {
    id: manifest.assetId,
    generatedAt: manifest.generatedAt,
    frame: manifest.frame,
    pivot: manifest.pivot,
    files: urls.build(rel),
    sheets: manifest.sheets.length,
    thumbnail:
      cell && sheet
        ? {
            image: urls.build(`${rel}/sheets/${sheet.image}`),
            x: cell.x,
            y: cell.y,
            w: cell.w,
            h: cell.h,
            offset: cell.offset,
          }
        : null,
    cells: manifest.cells.length,
    directions: manifest.directions.map((d) => d.name),
    clips: manifest.clips.map((c) => c.name),
    tags: resolved?.tags ?? [],
    type: resolved?.type ?? null,
    validation: manifest.validation.status,
    warnings: manifest.validation.warnings,
    errors: manifest.validation.errors,
  };
}

/** Every generated asset under the build directory, sorted by id. */
export function buildIndex(
  buildDir: string,
  projectName: string,
  options: { mode?: ViewerIndex['mode']; urls?: FileUrls } = {},
): ViewerIndex {
  const urls = options.urls ?? SERVER_URLS;
  const assets = assetDirs(buildDir)
    .map((dir) => summarise(buildDir, dir, urls))
    .filter((a): a is AssetSummary => a !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    mode: options.mode ?? 'server',
    project: { name: projectName },
    generatedAt: new Date().toISOString(),
    assets,
  };
}

/** History entries of an asset, newest first. */
export function historyOf(historyDir: string, id: string, urls: FileUrls): HistorySummary[] {
  const dir = join(historyDir, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        /^\d{4}-\d{2}-\d{2}T/.test(e.name) &&
        existsSync(join(dir, e.name, 'sheets', 'manifest.json')),
    )
    .map((e) => {
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-([0-9a-f]+))?$/.exec(e.name);
      return {
        id: e.name,
        createdAt: match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : '',
        hash: match?.[6] ?? '',
        validation: readJson<ValidationReportT>(join(dir, e.name, 'validation.json'))?.status ?? null,
        files: urls.history(`${id}/${e.name}`),
      };
    })
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

function resolvedSummary(dir: string): ResolvedSummary | null {
  const r = readJson<ResolvedAssetT>(join(dir, 'resolved.json'));
  if (!r) return null;
  return {
    camera: r.camera,
    lighting: r.lighting,
    pixel: r.pixel,
    sheet: r.sheet,
    rig: r.rig ? { preset: r.rig.preset, bones: r.rig.bones.length } : null,
    materials: r.materials,
  };
}

/** Everything the asset page shows. */
/** `historyDir` null leaves the history list empty. */
export function assetDetail(
  buildDir: string,
  historyDir: string | null,
  dir: string,
  urls: FileUrls,
): AssetDetail | null {
  const manifest = readJson<ManifestT>(join(dir, 'sheets', 'manifest.json'));
  if (!manifest) return null;
  const rel = toPosix(relative(buildDir, dir));
  return {
    id: manifest.assetId,
    files: urls.build(rel),
    manifest,
    validation: readJson<ValidationReportT>(join(dir, 'validation.json')),
    generation: readJson<GenerationRecordT>(join(dir, 'generation.json')),
    resolved: resolvedSummary(dir),
    model: existsSync(join(dir, 'rig', 'model.glb'))
      ? urls.build(`${rel}/rig/model.glb`)
      : existsSync(join(dir, 'model', 'model.glb'))
        ? urls.build(`${rel}/model/model.glb`)
        : null,
    history: historyDir ? historyOf(historyDir, manifest.assetId, urls) : [],
  };
}

/** One history entry of an asset, or null when it does not exist. `entryDir` is history/<id>/<entry>. */
export function historyDetail(entryDir: string, id: string, entry: string, urls: FileUrls): HistoryDetail | null {
  const manifest = readJson<ManifestT>(join(entryDir, 'sheets', 'manifest.json'));
  if (!manifest) return null;
  return {
    id,
    entry,
    files: urls.history(`${id}/${entry}`),
    manifest,
    validation: readJson<ValidationReportT>(join(entryDir, 'validation.json')),
    generation: readJson<GenerationRecordT>(join(entryDir, 'generation.json')),
  };
}
