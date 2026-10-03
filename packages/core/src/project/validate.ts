import type { IssueT, WarningT } from '@td2d/schema';
import { isTd2dError } from '../errors.ts';
import { type AssetLocation, assetLocation, listAssetLocations, loadAsset } from './assets.ts';
import { loadLibrary } from './library.ts';
import type { Project } from './project.ts';
import { resolveAsset } from './resolve.ts';

export type CheckStatus = 'pass' | 'fail';

export interface AssetConfigReport {
  readonly id: string;
  readonly file: string;
  readonly status: CheckStatus;
  readonly errorCode?: string;
  readonly message?: string;
  readonly hint?: string;
  readonly issues: readonly IssueT[];
  readonly warnings: readonly WarningT[];
}

export interface ConfigValidationReport {
  readonly stage: 'config';
  readonly status: CheckStatus;
  readonly library: {
    readonly status: CheckStatus;
    readonly issues: readonly IssueT[];
    readonly invalid: { readonly presets: boolean; readonly palettes: boolean };
  };
  readonly assets: readonly AssetConfigReport[];
  readonly summary: { readonly assets: number; readonly passed: number; readonly failed: number };
  readonly warnings: readonly WarningT[];
}

/**
 * Validate project presets, palettes and asset definitions without building anything.
 * The project file itself was already validated when the project was opened.
 */
export function validateConfig(project: Project, ids?: readonly string[]): ConfigValidationReport {
  const library = loadLibrary(project);
  const locations: AssetLocation[] =
    ids && ids.length > 0 ? ids.map((id) => assetLocation(project, id)) : listAssetLocations(project);
  const warnings: WarningT[] = [...library.warnings];
  if (locations.length === 0) warnings.push({ code: 'W_NO_ASSETS', message: 'The project has no assets yet.' });

  const assets: AssetConfigReport[] = locations.map((location) => {
    try {
      const loaded = loadAsset(project, location);
      const result = resolveAsset(project, loaded, library);
      return { id: location.id, file: location.displayPath, status: 'pass', issues: [], warnings: result.warnings };
    } catch (error) {
      if (!isTd2dError(error) || error.code === 'E_INTERNAL') throw error;
      const issues = error.issues ?? [
        { file: location.displayPath, path: '', message: error.message, code: error.code },
      ];
      return {
        id: location.id,
        file: location.displayPath,
        status: 'fail',
        errorCode: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        issues,
        warnings: [],
      };
    }
  });

  const failed = assets.filter((a) => a.status === 'fail').length;
  const libraryStatus: CheckStatus = library.issues.length > 0 ? 'fail' : 'pass';
  return {
    stage: 'config',
    status: failed > 0 || libraryStatus === 'fail' ? 'fail' : 'pass',
    library: { status: libraryStatus, issues: library.issues, invalid: library.invalid },
    assets,
    summary: { assets: assets.length, passed: assets.length - failed, failed },
    warnings,
  };
}
