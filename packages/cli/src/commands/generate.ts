import {
  type AssetGenerateResult,
  type FrameSelector,
  type GenerateOptions,
  generateAssets,
  parseFrameSelector,
  type SampleFilter,
  STAGE_NAMES,
  type StageName,
  Td2dError,
} from '@td2d/core';
import type { ErrorCode, WarningT } from '@td2d/schema';
import { type Command, InvalidArgumentError, Option } from 'commander';
import type { CommandContext } from '../context.ts';
import { integer } from '../options.ts';
import { paint } from '../output/style.ts';
import { action, type CommandResult } from '../run.ts';

export interface PipelineFlags {
  force?: boolean;
  from?: StageName;
  to?: StageName;
  cache?: boolean;
  dryRun?: boolean;
  strict?: boolean;
  allowHardware?: boolean;
  timeout?: number;
}

export function addPipelineOptions(cmd: Command, { stages = true } = {}): Command {
  cmd
    .option('--force', 'Recompute every stage instead of reusing cached results')
    .option('--no-cache', 'Neither read nor write the stage cache')
    .option('--dry-run', 'Show which stages would run or be reused, without running anything')
    .option('--strict', 'Fail (exit 5) on validation warnings as well as errors')
    .option('--allow-hardware', 'Use the GPU if available. Faster, but output depends on the machine.')
    .option('--timeout <ms>', 'Stop any asset that takes longer than this (E_ASSET_TIMEOUT)', integer(100, 86_400_000));
  if (stages) {
    cmd
      .addOption(new Option('--from <stage>', 'Recompute this stage and every later one').choices(STAGE_NAMES))
      .addOption(new Option('--to <stage>', 'Stop after this stage').choices(STAGE_NAMES));
  }
  return cmd;
}

/** Run the pipeline and turn the results into one command result with the right error and exit code. */
export async function runPipeline(
  ctx: CommandContext,
  ids: readonly string[],
  flags: PipelineFlags,
  overrides: Partial<GenerateOptions> = {},
): Promise<{ results: AssetGenerateResult[]; warnings: WarningT[]; error: Td2dError | undefined }> {
  const results = await generateAssets({
    project: ctx.project(),
    ids,
    force: flags.force === true,
    ...(flags.from ? { from: flags.from } : {}),
    ...(flags.to ? { to: flags.to } : {}),
    noCache: flags.cache === false,
    dryRun: flags.dryRun === true,
    strict: flags.strict === true,
    backendOptions: { allowHardware: flags.allowHardware === true },
    ...(flags.timeout !== undefined ? { timeoutMs: flags.timeout } : {}),
    logger: ctx.logger,
    progress: ctx.progress,
    signal: ctx.signal,
    ...overrides,
  });
  const warnings = results.flatMap((r) => r.warnings.map((w) => ({ ...w, assetId: w.assetId ?? r.assetId })));
  const failed = results.filter((r) => r.status === 'failed');
  let error: Td2dError | undefined;
  if (results.length === 1 && failed[0]?.error) {
    const e = failed[0].error;
    error = new Td2dError(e.code as ErrorCode, e.message, {
      ...(e.hint ? { hint: e.hint } : {}),
      ...(e.issues ? { issues: e.issues } : {}),
      ...(e.details ? { details: e.details } : {}),
    });
  } else if (failed.length > 0) {
    error = new Td2dError('E_BATCH_PARTIAL', `${failed.length} of ${results.length} assets failed.`, {
      details: { failed: failed.map((r) => ({ assetId: r.assetId, code: r.error?.code, message: r.error?.message })) },
    });
  }
  return { results, warnings, error };
}

function humanResults(results: AssetGenerateResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const colour = r.status === 'failed' ? 'red' : r.status === 'warn' ? 'yellow' : 'green';
    if (r.dryRun) {
      lines.push(`${r.assetId} (dry run): ${r.cache.misses} stage(s) would run, ${r.cache.hits} would be reused`);
      for (const s of r.stages) lines.push(`  ${s.name.padEnd(9)} ${s.status}`);
      continue;
    }
    const ran = r.stages.filter((s) => s.status === 'ran').map((s) => s.name);
    lines.push(
      `${paint(colour, r.status.padEnd(6), process.stdout)} ${r.assetId} in ${r.durationMs} ms (${ran.length ? `ran ${ran.join(', ')}` : 'all stages cached'})`,
    );
    if (r.outputs.sheet) lines.push(`       sheet ${r.outputs.sheet}`);
    if (r.validation)
      lines.push(
        `       validation ${r.validation.status} (${r.validation.errors} error(s), ${r.validation.warnings} warning(s))`,
      );
    if (r.error && results.length > 1) lines.push(`       ${r.error.code}: ${r.error.message}`);
  }
  return lines.join('\n');
}

export function pipelineResult(run: Awaited<ReturnType<typeof runPipeline>>): CommandResult {
  return {
    data: { results: run.results },
    warnings: run.warnings,
    human: (d: { results: AssetGenerateResult[] }) => humanResults(d.results),
    ...(run.error ? { error: run.error } : {}),
  };
}

export function registerGenerate(program: Command): void {
  addPipelineOptions(
    program
      .command('generate')
      .description(
        'Run the full pipeline: build the model, render every direction and frame, make sprites and a sheet, validate, and export.',
      )
      .argument('[ids...]', 'Asset ids (default: every asset)')
      .option(
        '--clips <list>',
        'Render only these clips, comma separated; other frames come from the render cache',
        (v: string) => v.split(',').map((c) => c.trim()),
      )
      .option(
        '--directions <list>',
        'Render only these directions, comma separated; other frames come from the render cache',
        (v: string) => v.split(',').map((d) => d.trim()),
      )
      .option(
        '--frames <selector>',
        'Render only these frames (clip/direction/range, such as walk/s/0-2); others come from the render cache. Repeat to add more',
        (v: string, previous: FrameSelector[] = []) => {
          try {
            return [...previous, parseFrameSelector(v)];
          } catch (error) {
            const e = error as Td2dError;
            throw new InvalidArgumentError(`${e.message} ${e.hint ?? ''}`.trim());
          }
        },
      ),
  )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d generate props/crate --json\n  $ td2d generate --dry-run\n  $ td2d generate props/crate --from render\n  $ td2d generate characters/knight --frames walk/s/0-2\n\nStages: resolve, model, plan, render, pixel, sheet, validate, export. Unchanged stages are reused from .td2d/cache.\nOutputs go to build/<id>/; sheets/ holds <name>.png, <name>.json (Aseprite) and manifest.json.\nExit code 5 means the sprites were written but failed validation; read build/<id>/validation.json.\n',
    )
    .action(
      action(
        async (
          ctx,
          ids: string[],
          flags: PipelineFlags & { clips?: string[]; directions?: string[]; frames?: FrameSelector[] },
        ) => {
          const { clips, directions, frames, ...rest } = flags;
          const filter: SampleFilter = {
            ...(clips ? { clips } : {}),
            ...(directions ? { directions } : {}),
            ...(frames ? { frames } : {}),
          };
          return pipelineResult(await runPipeline(ctx, ids, rest, Object.keys(filter).length > 0 ? { filter } : {}));
        },
      ),
    );
}
