import {
  type HistoryDetails,
  type HistoryEntry,
  historyAssetIds,
  listHistory,
  type PruneResult,
  parseDuration,
  pruneHistory,
  showHistory,
} from '@td2d/core';
import type { Command } from 'commander';
import { integer } from '../options.ts';
import { action } from '../run.ts';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function registerHistory(program: Command): void {
  const history = program
    .command('history')
    .description('List, show and prune earlier generations of an asset, kept under history/.');
  history
    .command('list')
    .description(
      'List recorded generations of an asset, newest first. A new entry is recorded whenever the outputs change.',
    )
    .argument('<id>', 'Asset id')
    .addHelpText('after', '\nExamples:\n  $ td2d history list props/crate --json\n')
    .action(
      action((ctx, id: string) => {
        const entries = listHistory(ctx.project(), id);
        return {
          data: { assetId: id, entries },
          human: (d: { entries: HistoryEntry[] }) =>
            d.entries.length === 0
              ? `No history for ${id} yet.`
              : d.entries.map((e) => `${e.createdAt}  ${e.hash}  ${e.validation ?? 'unknown'}  ${e.dir}`).join('\n'),
        };
      }),
    );
  history
    .command('show')
    .description('Show one recorded generation: its sheets, cells, clips, failing checks, timing and size on disk.')
    .argument('<id>', 'Asset id')
    .argument('[entry]', 'Entry id, a unique prefix of it or of its hash, "latest" or "previous"', 'latest')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d history show characters/knight --json\n  $ td2d history show characters/knight previous\n  $ td2d history show characters/knight 9ddbd7dc --json\n',
    )
    .action(
      action((ctx, id: string, entry: string) => {
        const data = showHistory(ctx.project(), id, entry);
        return {
          data,
          human: (d: HistoryDetails) =>
            [
              `${d.assetId} ${d.id}`,
              `  created    ${d.createdAt}, export hash ${d.hash}, ${kb(d.bytes)}`,
              `  sheets     ${d.sheets.map((s) => `${s.name} ${s.width} x ${s.height} (${s.layout})`).join(', ')}`,
              `  cells      ${d.cells}; clips ${d.clips.map((c) => `${c.name} (${c.frames})`).join(', ')}`,
              `  validation ${d.validation ?? 'unknown'}${d.checks.length ? `: ${d.checks.map((c) => `${c.id} ${c.status}`).join(', ')}` : ''}`,
              ...(d.generation
                ? [`  generated  ${d.generation.finishedAt} in ${d.generation.durationMs} ms (${d.generation.status})`]
                : []),
              `  files      ${d.dir}`,
            ].join('\n'),
        };
      }),
    );
  history
    .command('prune')
    .description(
      'Remove old history entries: beyond the newest --keep of each asset, older than --older-than, or both. The newest entry of an asset is always kept.',
    )
    .argument('[ids...]', 'Asset ids (default: every asset with history, including deleted ones)')
    .option('--keep <n>', 'Keep this many newest entries of each asset', integer(1, 100_000))
    .option('--older-than <duration>', 'Remove entries older than this, such as 30d or 12h')
    .option('--dry-run', 'Report what would be removed without removing it')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d history prune --keep 10 --json\n  $ td2d history prune characters/knight --older-than 30d --dry-run\n',
    )
    .action(
      action((ctx, ids: string[], opts: { keep?: number; olderThan?: string; dryRun?: boolean }) => {
        const project = ctx.project();
        const result = pruneHistory(project, ids.length > 0 ? ids : historyAssetIds(project), {
          ...(opts.keep !== undefined ? { keep: opts.keep } : {}),
          ...(opts.olderThan !== undefined ? { olderThanMs: parseDuration(opts.olderThan) } : {}),
          dryRun: opts.dryRun === true,
        });
        return {
          data: result,
          human: (d: PruneResult) =>
            `${d.dryRun ? 'Would remove' : 'Removed'} ${d.removed.length} entr${d.removed.length === 1 ? 'y' : 'ies'} (${kb(d.bytes)}); kept ${d.kept}.`,
        };
      }),
    );
}
