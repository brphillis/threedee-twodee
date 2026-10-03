import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareBuilds, listHistory, readBuild, readSnapshot, relativePosix, Td2dError } from '@td2d/core';
import type { Command } from 'commander';
import { integer, numberBetween } from '../options.ts';
import { action } from '../run.ts';

export function registerCompare(program: Command): void {
  program
    .command('compare')
    .description(
      'Compare the current build of an asset with an earlier generation, cell by cell: changed pixels per cell, added and removed cells, and an optional diff image.',
    )
    .argument('<id>', 'Asset id')
    .option(
      '--against <entry>',
      'A history entry id (td2d history list) or a directory. Default: the previous history entry',
    )
    .option('--out <file>', 'Write a PNG with a row per changed cell: before, after and the difference')
    .option('--threshold <n>', 'Colour difference ignored, from 0 (exact, default) to 1', numberBetween(0, 1), 0)
    .option('--scale <n>', 'Enlargement of the diff image', integer(1, 16), 4)
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d compare characters/knight --json\n  $ td2d compare characters/knight --against 2026-10-02T09-00-00-000Z-1a2b3c4d5e6f --out diff.png\n  $ td2d compare props/crate --against ../old/build/props/crate\n\nThe --out image has a row per changed cell, most changed first (data.diffRows names them), and three columns:\nbefore, after, and the changed pixels in red.\n',
    )
    .action(
      action(async (ctx, id: string, opts: { against?: string; out?: string; threshold: number; scale: number }) => {
        const project = ctx.project();
        const build = readBuild(project, id);
        const current = readSnapshot(build.dir, build.relativeDir);
        const history = listHistory(project, id);
        let againstDir: string;
        let label: string;
        if (opts.against) {
          const entry = history.find((e) => e.id === opts.against);
          againstDir = entry ? join(project.root, entry.dir) : resolve(ctx.cwd, opts.against);
          label = entry ? entry.dir : relativePosix(ctx.cwd, againstDir);
          if (!entry && !existsSync(againstDir)) {
            throw new Td2dError('E_USAGE', `"${opts.against}" is neither a history entry of ${id} nor a directory.`, {
              hint: `Run \`td2d history list ${id}\`.`,
            });
          }
        } else {
          // The newest entry is the current build; compare with the one before it.
          const previous = history[1];
          if (!previous) {
            throw new Td2dError('E_USAGE', `${id} has no earlier generation in history to compare with.`, {
              hint: 'Generate it again after a change, or pass --against <directory>.',
            });
          }
          againstDir = join(project.root, previous.dir);
          label = previous.dir;
        }
        const result = await compareBuilds(current, readSnapshot(againstDir, label), {
          threshold: opts.threshold,
          scale: opts.scale,
          ...(opts.out ? { out: resolve(ctx.cwd, opts.out) } : {}),
        });
        const data = { ...result, diffImage: result.diffImage ? relativePosix(ctx.cwd, result.diffImage) : null };
        return {
          data,
          human: (d: typeof data) =>
            [
              `${d.current} against ${d.against}: ${d.changedCells} of ${d.cells} cell(s) changed (${d.changedPixels} px), ${d.added.length} added, ${d.removed.length} removed`,
              ...(d.pixelsPerUnit.current !== d.pixelsPerUnit.against
                ? [
                    `  The scale changed from ${d.pixelsPerUnit.against} to ${d.pixelsPerUnit.current} px/m, so every sprite changed size.`,
                  ]
                : []),
              ...d.changes
                .slice(0, 20)
                .map(
                  (c) => `  ${c.key.padEnd(18)} ${String(c.pixels).padStart(6)} px (${(c.ratio * 100).toFixed(1)}%)`,
                ),
              ...(d.diffImage
                ? [
                    `  diff ${d.diffImage}: a row per changed cell (${d.diffRows.join(', ')}), before, after and difference`,
                  ]
                : d.changedCells > 0
                  ? ['  Add --out diff.png for a picture of the changes.']
                  : []),
            ].join('\n'),
        };
      }),
    );
}
