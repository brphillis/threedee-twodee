import {
  cacheStats,
  cleanCache,
  listCacheEntries,
  parseDuration,
  parseSize,
  relativePosix,
  Td2dError,
  writeCacheIndex,
} from '@td2d/core';
import type { Command } from 'commander';
import { action } from '../run.ts';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function registerCache(program: Command): void {
  const cache = program.command('cache').description('Inspect and prune the stage and item cache in .td2d/cache.');
  cache
    .command('stats')
    .description('Size of the cache by stage and item kind, with the oldest and newest use.')
    .addHelpText('after', '\nExamples:\n  $ td2d cache stats --json\n')
    .action(
      action(async (ctx) => {
        const project = ctx.project();
        const entries = listCacheEntries(project.paths.cache);
        writeCacheIndex(project.paths.cache, entries);
        const stats = cacheStats(relativePosix(project.root, project.paths.cache), entries);
        return {
          data: stats,
          human: (d: typeof stats) =>
            [
              `${d.root}: ${d.entries} entries, ${mb(d.bytes)}`,
              ...d.groups.map(
                (g) => `  ${`${g.kind} ${g.group}`.padEnd(16)} ${String(g.entries).padStart(7)}  ${mb(g.bytes)}`,
              ),
              ...(d.oldest ? [`  last used between ${d.oldest} and ${d.newest}`] : []),
            ].join('\n'),
        };
      }),
    );
  cache
    .command('clean')
    .description('Remove cache entries by age or size, least recently used first. Nothing in build/ is touched.')
    .option('--older-than <duration>', 'Remove entries not used for this long: 30m, 12h, 1d, 2w')
    .option('--max-size <size>', 'Then remove least recently used entries until the cache fits: 500MB, 5GB')
    .option('--all', 'Remove every entry')
    .option('--dry-run', 'Report what would be removed without removing it')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d cache clean --older-than 1d --json\n  $ td2d cache clean --max-size 2GB\n  $ td2d cache clean --all\n',
    )
    .action(
      action(async (ctx, opts: { olderThan?: string; maxSize?: string; all?: boolean; dryRun?: boolean }) => {
        if (!opts.olderThan && !opts.maxSize && !opts.all) {
          throw new Td2dError('E_USAGE', 'Say what to remove: --older-than, --max-size or --all.');
        }
        const project = ctx.project();
        const result = cleanCache(project.paths.cache, {
          ...(opts.olderThan ? { olderThanMs: parseDuration(opts.olderThan) } : {}),
          ...(opts.maxSize ? { maxBytes: parseSize(opts.maxSize) } : {}),
          ...(opts.all ? { all: true } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });
        return {
          data: result,
          human: (d: typeof result) =>
            `${d.dryRun ? 'Would remove' : 'Removed'} ${d.removed} entries (${mb(d.freedBytes)}); ${d.remaining} remain (${mb(d.remainingBytes)}).`,
        };
      }),
    );
}
