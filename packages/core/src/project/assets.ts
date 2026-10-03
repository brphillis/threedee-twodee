import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AssetDefinition, type AssetDefinitionT, AssetId, closest, issuesFromZod } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import { readJsonFile } from '../fs/json.ts';
import { relativePosix, resolveInside, toPosix } from '../fs/paths.ts';
import type { Project } from './project.ts';

export const ASSET_FILE = 'asset.json';
const MAX_DEPTH = 8;

export interface AssetLocation {
  /** Id derived from the directory path. May be invalid; see `idValid`. */
  readonly id: string;
  readonly idValid: boolean;
  readonly dir: string;
  readonly file: string;
  /** Asset file relative to the project root, with forward slashes. */
  readonly displayPath: string;
}

export interface LoadedAsset {
  readonly location: AssetLocation;
  readonly definition: AssetDefinitionT;
}

function locate(project: Project, dir: string): AssetLocation {
  const id = toPosix(relative(project.paths.assets, dir));
  const file = join(dir, ASSET_FILE);
  return { id, idValid: AssetId.safeParse(id).success, dir, file, displayPath: relativePosix(project.root, file) };
}

/** Find every assets/<id>/asset.json, sorted by id. */
export function listAssetLocations(project: Project): AssetLocation[] {
  const found: AssetLocation[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === ASSET_FILE)) found.push(locate(project, dir));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  if (existsSync(project.paths.assets)) walk(project.paths.assets, 0);
  return found.filter((l) => l.id !== '').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function assetLocation(project: Project, id: string): AssetLocation {
  if (!AssetId.safeParse(id).success) {
    throw new Td2dError('E_USAGE', `"${id}" is not a valid asset id.`, {
      hint: 'Asset ids are kebab-case segments separated by "/", such as "props/crate".',
    });
  }
  const dir = resolveInside(project.paths.assets, id);
  return locate(project, dir);
}

export function parseAssetDefinition(raw: unknown, location: AssetLocation): AssetDefinitionT {
  const file = location.displayPath;
  if (!location.idValid) {
    throw new Td2dError('E_ASSET_INVALID', `${file} is in a directory that is not a valid asset id.`, {
      file,
      issues: [
        {
          file,
          path: '',
          message: `Directory "${location.id}" is not a valid asset id. Use kebab-case segments such as "props/crate".`,
          code: 'invalid_asset_id',
        },
      ],
    });
  }
  const result = AssetDefinition.safeParse(raw);
  if (!result.success) {
    const issues = issuesFromZod(result.error, file, { input: raw, schema: AssetDefinition });
    throw new Td2dError('E_ASSET_INVALID', `${file} has ${issues.length} problem${issues.length === 1 ? '' : 's'}.`, {
      file,
      issues,
      hint: 'Fix each issue at its path; `td2d schema asset` shows every key. References to materials, bones and clips are checked once the file matches the schema.',
    });
  }
  if (result.data.id !== undefined && result.data.id !== location.id) {
    throw new Td2dError('E_ASSET_INVALID', `${file} declares id "${result.data.id}" but lives at "${location.id}".`, {
      file,
      issues: [
        {
          file,
          path: 'id',
          message: `Expected "${location.id}" to match the directory, or remove the id field`,
          code: 'id_mismatch',
        },
      ],
    });
  }
  return result.data;
}

/** Load and schema-validate one asset definition. */
export function loadAsset(project: Project, idOrLocation: string | AssetLocation): LoadedAsset {
  const location = typeof idOrLocation === 'string' ? assetLocation(project, idOrLocation) : idOrLocation;
  if (!existsSync(location.file)) {
    const known = listAssetLocations(project).map((l) => l.id);
    const suggestion = closest(location.id, known);
    throw new Td2dError('E_ASSET_NOT_FOUND', `Asset "${location.id}" not found at ${location.displayPath}.`, {
      details: { id: location.id, ...(suggestion ? { suggestion } : {}) },
      hint: suggestion
        ? `Did you mean "${suggestion}"? Run \`td2d asset list --ids\` for every id.`
        : 'Run `td2d asset list --ids` for every id.',
    });
  }
  const raw = readJsonFile(location.file, location.displayPath);
  return { location, definition: parseAssetDefinition(raw, location) };
}
