import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationRecordT, ManifestT, ValidationReportT } from '@td2d/schema';
import { Td2dError } from './errors.ts';
import { relativePosix, resolveInside } from './fs/paths.ts';
import { assetLocation } from './project/assets.ts';
import type { Project } from './project/project.ts';

export interface BuildInfo {
  readonly assetId: string;
  readonly dir: string;
  readonly relativeDir: string;
  readonly manifest: ManifestT;
  readonly validation: ValidationReportT | null;
  readonly generation: GenerationRecordT | null;
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

/** The outputs of the last generation of an asset. Throws E_NOT_GENERATED when there are none. */
export function readBuild(project: Project, assetId: string): BuildInfo {
  assetLocation(project, assetId);
  const dir = resolveInside(project.paths.build, assetId);
  const manifest = readJson<ManifestT>(join(dir, 'sheets', 'manifest.json'));
  if (!manifest) {
    throw new Td2dError(
      'E_NOT_GENERATED',
      `"${assetId}" has no generated sheet in ${relativePosix(project.root, dir)}.`,
      { hint: `Run \`td2d generate ${assetId}\`.` },
    );
  }
  return {
    assetId,
    dir,
    relativeDir: relativePosix(project.root, dir),
    manifest,
    validation: readJson<ValidationReportT>(join(dir, 'validation.json')),
    generation: readJson<GenerationRecordT>(join(dir, 'generation.json')),
  };
}
