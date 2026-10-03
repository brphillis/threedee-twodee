import { resolve } from 'node:path';
import { type BatchResult, readBatchManifest, readBatchReport, relativePosix, runBatch } from '@td2d/core';
import type { Command } from 'commander';
import { integer } from '../options.ts';
import { paint } from '../output/style.ts';
import { action } from '../run.ts';
import { addPipelineOptions, type PipelineFlags } from './generate.ts';

interface BatchFlags extends PipelineFlags {
  filter?: string;
  manifest?: string;
  concurrency?: number;
  continueOnError?: boolean;
  failFast?: boolean;
  resume?: string;
  report?: string;
}

function human(d: { report: BatchResult['report']; reportFile: string }): string {
  const lines = [
    `${d.report.status} in ${d.report.durationMs} ms: ${d.report.totals.ok} ok, ${d.report.totals.warn} warn, ${d.report.totals.failed} failed, ${d.report.totals.skipped} skipped`,
  ];
  for (const a of d.report.assets) {
    const colour =
      a.status === 'failed' ? 'red' : a.status === 'warn' ? 'yellow' : a.status === 'skipped' ? 'dim' : 'green';
    const detail =
      a.status === 'skipped'
        ? `(${a.skipped})`
        : a.error
          ? `${a.error.code}: ${a.error.message}`
          : `${a.durationMs} ms`;
    lines.push(`  ${paint(colour, a.status.padEnd(7), process.stdout)} ${a.assetId} ${detail}`);
  }
  lines.push(`  report ${d.reportFile}`);
  return lines.join('\n');
}

export function registerBatch(program: Command): void {
  addPipelineOptions(
    program
      .command('batch')
      .description(
        'Generate many assets with a concurrency limit and one shared browser, writing build/batch-report.json. A failure stops the batch unless --continue-on-error.',
      )
      .option(
        '--filter <glob>',
        'Asset ids to include: * within a segment, ** across segments (props/*, characters/**)',
      )
      .option('--manifest <file>', 'A batch manifest: assets with per-asset overrides (td2d schema batch-manifest)')
      .option('--concurrency <n>', 'Assets generated at once (default: cores minus one, at most 4)', integer(1, 64))
      .option('--continue-on-error', 'Run every asset even after failures; exit 6 if any failed')
      .option('--fail-fast', 'Cancel assets already running when one fails')
      .option('--resume <report>', 'Skip the assets that succeeded in this earlier batch report')
      .option('--report <file>', 'Where to write the batch report (default build/batch-report.json)'),
    { stages: false },
  )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d batch --json\n  $ td2d batch --filter "props/*" --continue-on-error --json\n  $ td2d batch --manifest release.json --concurrency 4\n  $ td2d batch --resume build/batch-report.json\n\nExit codes: 0 all succeeded, 4 the batch stopped at a failure, 6 some failed with --continue-on-error, 130 cancelled.\n',
    )
    .action(
      action(async (ctx, flags: BatchFlags) => {
        const project = ctx.project();
        const display = (file: string) => relativePosix(ctx.cwd, resolve(ctx.cwd, file));
        const result = await runBatch({
          project,
          force: flags.force === true,
          noCache: flags.cache === false,
          dryRun: flags.dryRun === true,
          ...(flags.strict !== undefined ? { strict: flags.strict } : {}),
          backendOptions: { allowHardware: flags.allowHardware === true },
          ...(flags.timeout !== undefined ? { timeoutMs: flags.timeout } : {}),
          logger: ctx.logger,
          progress: ctx.progress,
          signal: ctx.signal,
          ...(flags.filter ? { match: flags.filter } : {}),
          ...(flags.manifest
            ? {
                manifest: {
                  file: display(flags.manifest),
                  data: readBatchManifest(resolve(ctx.cwd, flags.manifest), display(flags.manifest)),
                },
              }
            : {}),
          ...(flags.concurrency ? { concurrency: flags.concurrency } : {}),
          ...(flags.continueOnError ? { continueOnError: true } : {}),
          ...(flags.failFast ? { failFast: true } : {}),
          ...(flags.resume
            ? {
                resume: {
                  file: display(flags.resume),
                  data: readBatchReport(resolve(ctx.cwd, flags.resume), display(flags.resume)),
                },
              }
            : {}),
          ...(flags.report ? { reportFile: resolve(ctx.cwd, flags.report) } : {}),
        });
        const data = { report: result.report, reportFile: relativePosix(ctx.cwd, result.reportFile) };
        return {
          data,
          warnings: result.results.flatMap((r) => r.warnings.map((w) => ({ ...w, assetId: w.assetId ?? r.assetId }))),
          human,
          ...(result.error ? { error: result.error } : {}),
        };
      }),
    );
}
