import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { issuesFromZod, ProjectConfig, type ProjectConfigT, type ResolvedProjectPathsT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import { readJsonFile } from '../fs/json.ts';
import { resolveInside } from '../fs/paths.ts';

export const PROJECT_FILE = 'td2d.project.json';

export interface Project {
  /** Absolute project root. */
  readonly root: string;
  readonly config: ProjectConfigT;
  /** Absolute, validated project directories. */
  readonly paths: ResolvedProjectPathsT;
}

/** Walk up from `start` to the nearest directory containing td2d.project.json. */
export function findProjectRoot(start: string): string | undefined {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, PROJECT_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function parseProjectConfig(raw: unknown, file: string = PROJECT_FILE): ProjectConfigT {
  const result = ProjectConfig.safeParse(raw);
  if (!result.success) {
    const issues = issuesFromZod(result.error, file, { input: raw, schema: ProjectConfig });
    throw new Td2dError('E_PROJECT_INVALID', `${file} has ${issues.length} problem${issues.length === 1 ? '' : 's'}.`, {
      file,
      issues,
    });
  }
  return result.data;
}

export function resolveProjectPaths(root: string, config: ProjectConfigT): ResolvedProjectPathsT {
  const p = config.paths ?? {};
  const one = (value: string | undefined, fallback: string) => resolveInside(root, value ?? fallback);
  const many = (values: string[] | undefined, fallback: string) =>
    (values ?? [fallback]).map((v) => resolveInside(root, v));
  return {
    assets: one(p.assets, 'assets'),
    build: one(p.build, 'build'),
    history: one(p.history, 'history'),
    cache: one(p.cache, '.td2d/cache'),
    presets: many(p.presets, 'presets'),
    palettes: many(p.palettes, 'palettes'),
    components: many(p.components, 'components'),
  };
}

/** Load the project rooted at `root`. Throws E_PROJECT_NOT_FOUND or E_PROJECT_INVALID. */
export function loadProject(root: string): Project {
  const absoluteRoot = resolve(root);
  const file = join(absoluteRoot, PROJECT_FILE);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Td2dError('E_PROJECT_NOT_FOUND', `No ${PROJECT_FILE} in ${absoluteRoot}.`, {
      details: { root: absoluteRoot },
    });
  }
  const config = parseProjectConfig(readJsonFile(file, PROJECT_FILE));
  return { root: absoluteRoot, config, paths: resolveProjectPaths(absoluteRoot, config) };
}

/** Load the project at `explicitRoot`, or the nearest one above `cwd`. */
export function openProject(options: { readonly explicitRoot?: string | undefined; readonly cwd: string }): Project {
  if (options.explicitRoot !== undefined) return loadProject(resolve(options.cwd, options.explicitRoot));
  const root = findProjectRoot(options.cwd);
  if (root === undefined) {
    throw new Td2dError('E_PROJECT_NOT_FOUND', `No ${PROJECT_FILE} found in ${options.cwd} or any parent directory.`, {
      details: { cwd: options.cwd },
    });
  }
  return loadProject(root);
}
