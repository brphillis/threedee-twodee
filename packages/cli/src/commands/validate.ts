import {
  type AssetGenerateResult,
  assetLocation,
  type ConfigValidationReport,
  Td2dError,
  validateConfig,
} from '@td2d/core';
import type { ErrorCode, IssueT, WarningT } from '@td2d/schema';
import { type Command, Option } from 'commander';
import { paint } from '../output/style.ts';
import { action } from '../run.ts';
import { runPipeline } from './generate.ts';

function human(report: ConfigValidationReport): string {
  const out = report.assets.map((a) => {
    const mark = a.status === 'pass' ? paint('green', 'ok  ', process.stdout) : paint('red', 'FAIL', process.stdout);
    return `${mark}  ${a.id}`;
  });
  if (report.library.status === 'fail') out.push(`${paint('red', 'FAIL', process.stdout)}  presets and palettes`);
  out.push('', `${report.summary.passed} of ${report.summary.assets} asset(s) valid.`);
  return out.join('\n');
}

export function failureFor(report: ConfigValidationReport): Td2dError | undefined {
  if (report.status === 'pass') return undefined;
  const failedAssets = report.assets.filter((a) => a.status === 'fail');
  const issues: IssueT[] = [...failedAssets.flatMap((a) => a.issues), ...report.library.issues];
  const first = failedAssets[0];
  const libraryCode: ErrorCode =
    report.library.invalid.palettes && !report.library.invalid.presets ? 'E_PALETTE_INVALID' : 'E_PRESET_INVALID';
  const code = (first?.errorCode as ErrorCode | undefined) ?? libraryCode;
  const parts: string[] = [];
  if (failedAssets.length === 1 && first) parts.push(first.message ?? `${first.file} failed validation.`);
  else if (failedAssets.length > 1)
    parts.push(`${failedAssets.length} of ${report.summary.assets} assets failed validation.`);
  if (report.library.status === 'fail')
    parts.push(
      report.library.invalid.presets && report.library.invalid.palettes
        ? 'Some preset and palette files are invalid.'
        : report.library.invalid.palettes
          ? 'Some palette files are invalid.'
          : 'Some preset files are invalid.',
    );
  const single = failedAssets.length === 1 && report.library.status !== 'fail' ? first : undefined;
  return new Td2dError(code, parts.join(' '), {
    issues,
    details: { failedAssets: failedAssets.map((a) => a.id) },
    ...(single ? { file: single.file } : {}),
    ...(single?.hint ? { hint: single.hint } : {}),
  });
}

interface ModelStageReport {
  readonly stage: 'model';
  readonly status: 'pass' | 'warn' | 'fail';
  readonly assets: readonly {
    id: string;
    /** The asset definition, relative to the project root. */
    file: string;
    status: 'pass' | 'warn' | 'fail';
    /** The failure's issues, each with a file and a path; empty when the model built. */
    issues: readonly IssueT[];
    warnings: readonly WarningT[];
    error?: AssetGenerateResult['error'];
  }[];
  readonly summary: { readonly assets: number; readonly passed: number; readonly failed: number };
}

function humanModel(report: ModelStageReport): string {
  const out = report.assets.map((a) => {
    const mark =
      a.status === 'fail'
        ? paint('red', 'FAIL', process.stdout)
        : a.status === 'warn'
          ? paint('yellow', 'warn', process.stdout)
          : paint('green', 'ok  ', process.stdout);
    return `${mark}  ${a.id}${a.error ? `  ${a.error.code}: ${a.error.message}` : ''}`;
  });
  out.push('', `${report.summary.passed} of ${report.summary.assets} model(s) built without errors.`);
  return out.join('\n');
}

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description(
      'Validate asset definitions (config), or also build and check their geometry (model), without rendering.',
    )
    .argument('[ids...]', 'Asset ids to validate (default: every asset)')
    .addOption(
      new Option(
        '--stage <stage>',
        'config: definitions, presets and palettes. model: also build geometry and check it against the frame.',
      )
        .choices(['config', 'model'])
        .default('config'),
    )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d validate\n  $ td2d validate props/crate --json\n  $ td2d validate --stage model --json\n\nExit code 3 means at least one definition or model is invalid. Every issue has a file and a path.\n',
    )
    .action(
      action(async (ctx, ids: string[], opts: { stage: 'config' | 'model' }) => {
        if (opts.stage === 'config') {
          const report = validateConfig(ctx.project(), ids);
          const warnings = [...report.warnings, ...report.assets.flatMap((a) => a.warnings)];
          const error = failureFor(report);
          return { data: report, warnings, human, ...(error ? { error } : {}) };
        }
        const project = ctx.project();
        const run = await runPipeline(ctx, ids, { to: 'plan' }, { history: false });
        const assets = run.results.map((r) => ({
          id: r.assetId,
          file: assetLocation(project, r.assetId).displayPath,
          issues: r.error?.issues ?? [],
          status:
            r.status === 'failed' ? ('fail' as const) : r.warnings.length > 0 ? ('warn' as const) : ('pass' as const),
          warnings: r.warnings,
          ...(r.error ? { error: r.error } : {}),
        }));
        const failed = assets.filter((a) => a.status === 'fail').length;
        const data: ModelStageReport = {
          stage: 'model',
          status: failed > 0 ? 'fail' : assets.some((a) => a.status === 'warn') ? 'warn' : 'pass',
          assets,
          summary: { assets: assets.length, passed: assets.length - failed, failed },
        };
        return { data, warnings: run.warnings, human: humanModel, ...(run.error ? { error: run.error } : {}) };
      }),
    );
}
