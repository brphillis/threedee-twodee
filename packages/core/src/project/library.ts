import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  CameraPreset,
  type CameraPresetT,
  ExportPreset,
  type ExportPresetT,
  type IssueT,
  issuesFromZod,
  LightingPreset,
  type LightingPresetT,
  PaletteDefinition,
  type PaletteDefinitionT,
  PixelPreset,
  type PixelPresetT,
  PRESET_KINDS,
  type PresetKind,
  RigPreset,
  type RigPresetT,
  SheetPreset,
  type SheetPresetT,
  type WarningT,
} from '@td2d/schema';
import type { z } from 'zod';
import { isTd2dError, Td2dError } from '../errors.ts';
import { readJsonFile } from '../fs/json.ts';
import { relativePosix } from '../fs/paths.ts';
import { BUILTIN_PALETTES_DIR, BUILTIN_PRESETS_DIR } from '../package-paths.ts';
import type { Project } from './project.ts';

export interface PresetTypes {
  camera: CameraPresetT;
  lighting: LightingPresetT;
  pixel: PixelPresetT;
  sheet: SheetPresetT;
  export: ExportPresetT;
}

export const PRESET_SCHEMAS: { readonly [K in PresetKind]: z.ZodType<PresetTypes[K]> } = {
  camera: CameraPreset,
  lighting: LightingPreset,
  pixel: PixelPreset,
  sheet: SheetPreset,
  export: ExportPreset,
};

export type Source = 'builtin' | 'project';

export interface LibraryEntry<T> {
  readonly name: string;
  readonly source: Source;
  /** Project-relative path, or "builtin:<kind>/<name>". */
  readonly file: string;
  readonly data: T;
}

export interface Library {
  readonly presets: { readonly [K in PresetKind]: ReadonlyMap<string, LibraryEntry<PresetTypes[K]>> };
  readonly palettes: ReadonlyMap<string, LibraryEntry<PaletteDefinitionT>>;
  /** Rig presets from presets/rig/. */
  readonly rigs: ReadonlyMap<string, LibraryEntry<RigPresetT>>;
  /** Problems in project preset and palette files. Each carries the file it came from. */
  readonly issues: readonly IssueT[];
  /** Which kinds of file the issues come from. */
  readonly invalid: { readonly presets: boolean; readonly palettes: boolean };
  readonly warnings: readonly WarningT[];
}

interface Collected<T> {
  entries: Map<string, LibraryEntry<T>>;
  issues: IssueT[];
}

function collectDir<T>(
  dir: string,
  schema: z.ZodType<T>,
  source: Source,
  display: (file: string) => string,
  nameOf: (data: T) => string,
): Collected<T> {
  const entries = new Map<string, LibraryEntry<T>>();
  const issues: IssueT[] = [];
  if (!existsSync(dir)) return { entries, issues };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const name of files) {
    const absolute = join(dir, name);
    const file = display(absolute);
    try {
      const input = readJsonFile(absolute, file);
      const result = schema.safeParse(input);
      if (!result.success) {
        issues.push(...issuesFromZod(result.error, file, { input, schema }));
        continue;
      }
      const stem = basename(name, '.json');
      const declared = nameOf(result.data);
      if (declared !== stem) {
        issues.push({
          file,
          path: 'name',
          message: `Name "${declared}" must match the file name "${stem}"`,
          code: 'name_mismatch',
        });
        continue;
      }
      entries.set(stem, { name: stem, source, file, data: result.data });
    } catch (error) {
      if (isTd2dError(error) && error.issues) issues.push(...error.issues);
      else throw error;
    }
  }
  return { entries, issues };
}

type Builtins = Pick<Library, 'presets' | 'palettes' | 'rigs'>;
let builtinCache: Builtins | undefined;

/** Built-in presets and palettes shipped with @td2d/core. Invalid built-ins are a bug. */
export function builtinLibrary(): Builtins {
  if (builtinCache) return builtinCache;
  const problems: IssueT[] = [];
  const presets = {} as Record<PresetKind, Map<string, LibraryEntry<unknown>>>;
  for (const kind of PRESET_KINDS) {
    const c = collectDir<PresetTypes[typeof kind]>(
      join(BUILTIN_PRESETS_DIR, kind),
      PRESET_SCHEMAS[kind],
      'builtin',
      (f) => `builtin:${kind}/${basename(f, '.json')}`,
      (d) => d.name,
    );
    presets[kind] = c.entries;
    problems.push(...c.issues);
  }
  const palettes = collectDir(
    BUILTIN_PALETTES_DIR,
    PaletteDefinition,
    'builtin',
    (f) => `builtin:palette/${basename(f, '.json')}`,
    (d) => d.name,
  );
  problems.push(...palettes.issues);
  const rigs = collectDir(
    join(BUILTIN_PRESETS_DIR, 'rig'),
    RigPreset,
    'builtin',
    (f) => `builtin:rig/${basename(f, '.json')}`,
    (d) => d.name,
  );
  problems.push(...rigs.issues);
  if (problems.length > 0) {
    throw new Td2dError('E_INTERNAL', 'Built-in presets or palettes are invalid.', { issues: problems });
  }
  builtinCache = { presets: presets as unknown as Builtins['presets'], palettes: palettes.entries, rigs: rigs.entries };
  return builtinCache;
}

/** Built-in entries overlaid with project presets and palettes. Later project directories win. */
export function loadLibrary(project?: Project): Library {
  const builtins = builtinLibrary();
  if (!project) return { ...builtins, issues: [], invalid: { presets: false, palettes: false }, warnings: [] };

  const issues: IssueT[] = [];
  const warnings: WarningT[] = [];
  const display = (f: string) => relativePosix(project.root, f);

  const overlay = <T>(
    base: ReadonlyMap<string, LibraryEntry<T>>,
    dirs: string[],
    schema: z.ZodType<T>,
    nameOf: (d: T) => string,
    label: string,
  ) => {
    const merged = new Map(base);
    for (const dir of dirs) {
      const c = collectDir(dir, schema, 'project', display, nameOf);
      issues.push(...c.issues);
      for (const [name, entry] of c.entries) {
        if (base.has(name)) {
          warnings.push({
            code: 'W_PRESET_SHADOWS_BUILTIN',
            message: `Project ${label} "${name}" replaces the built-in ${label} with the same name.`,
            file: entry.file,
          });
        }
        merged.set(name, entry);
      }
    }
    return merged;
  };

  const presets = {} as Record<PresetKind, ReadonlyMap<string, LibraryEntry<unknown>>>;
  for (const kind of PRESET_KINDS) {
    presets[kind] = overlay<PresetTypes[typeof kind]>(
      builtins.presets[kind],
      project.paths.presets.map((d) => join(d, kind)),
      PRESET_SCHEMAS[kind],
      (d) => d.name,
      `${kind} preset`,
    );
  }
  const beforePalettes = issues.length;
  const palettes = overlay(builtins.palettes, project.paths.palettes, PaletteDefinition, (d) => d.name, 'palette');
  const paletteIssues = issues.length - beforePalettes;
  const rigs = overlay(
    builtins.rigs,
    project.paths.presets.map((d) => join(d, 'rig')),
    RigPreset,
    (d) => d.name,
    'rig preset',
  );
  return {
    presets: presets as unknown as Library['presets'],
    palettes,
    rigs,
    issues,
    invalid: { presets: issues.length > paletteIssues, palettes: paletteIssues > 0 },
    warnings,
  };
}
