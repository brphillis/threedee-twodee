import { existsSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { CURRENT_INPUT_SCHEMA_VERSION, type WarningT } from '@td2d/schema';
import { Td2dError } from './errors.ts';
import { readJsonFile, writeJsonFile } from './fs/json.ts';
import { toPosix } from './fs/paths.ts';
import { SCHEMAS_DIR, writeProjectSchemas } from './init.ts';
import { TEMPLATES_DIR } from './package-paths.ts';
import { assetLocation, parseAssetDefinition } from './project/assets.ts';
import { loadLibrary } from './project/library.ts';
import type { Project } from './project/project.ts';
import { resolveAsset } from './project/resolve.ts';

const ASSET_TEMPLATES_DIR = join(TEMPLATES_DIR, 'assets');

export function listAssetTemplates(): { name: string; type: string; description: string }[] {
  if (!existsSync(ASSET_TEMPLATES_DIR)) return [];
  return readdirSync(ASSET_TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const data = readJsonFile(join(ASSET_TEMPLATES_DIR, f), `template:${f}`) as {
        type: string;
        description?: string;
      };
      return { name: basename(f, '.json'), type: data.type, description: data.description ?? '' };
    });
}

export interface CreateAssetOptions {
  readonly template?: string;
  readonly description?: string;
}

export interface CreateAssetResult {
  readonly id: string;
  readonly file: string;
  readonly template: string;
  readonly warnings: readonly WarningT[];
}

/** Scaffold assets/<id>/asset.json from a template. The result is validated before it is written. */
export function createAsset(project: Project, id: string, options: CreateAssetOptions = {}): CreateAssetResult {
  const template = options.template ?? 'box';
  const templateFile = join(ASSET_TEMPLATES_DIR, `${template}.json`);
  if (!existsSync(templateFile)) {
    throw new Td2dError('E_TEMPLATE_NOT_FOUND', `Asset template "${template}" does not exist.`, {
      details: { available: listAssetTemplates().map((t) => t.name) },
    });
  }
  const location = assetLocation(project, id);
  if (existsSync(location.file)) {
    throw new Td2dError('E_ASSET_EXISTS', `Asset "${id}" already exists at ${location.displayPath}.`);
  }

  const { schemaVersion: _v, ...body } = readJsonFile(templateFile, `template:${template}`) as Record<string, unknown>;
  const schemaRef = toPosix(relative(location.dir, join(project.root, SCHEMAS_DIR, 'asset.schema.json')));
  const definition = {
    $schema: schemaRef,
    schemaVersion: CURRENT_INPUT_SCHEMA_VERSION,
    id,
    ...body,
    ...(options.description === undefined ? {} : { description: options.description }),
  };

  const parsed = parseAssetDefinition(definition, location);
  const { warnings } = resolveAsset(project, { location, definition: parsed }, loadLibrary(project));

  writeJsonFile(location.file, definition);
  if (!existsSync(join(project.root, SCHEMAS_DIR))) writeProjectSchemas(project.root);
  return { id, file: location.displayPath, template, warnings };
}
