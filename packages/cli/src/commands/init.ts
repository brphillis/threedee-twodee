import { resolve } from 'node:path';
import { type InitResult, initProject, listProjectTemplates } from '@td2d/core';
import type { Command } from 'commander';
import { paint } from '../output/style.ts';
import { action } from '../run.ts';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a td2d project from a template. Never overwrites existing files.')
    .argument('[dir]', 'Directory to create the project in', '.')
    .option('--template <name>', `Project template (${listProjectTemplates().join(', ')})`, 'starter')
    .option('--name <name>', 'Project name written to td2d.project.json (default: directory name)')
    .addHelpText('after', '\nExamples:\n  $ td2d init my-sprites\n  $ td2d init . --name "Forest tiles" --json\n')
    .action(
      action((ctx, dir: string, opts: { template: string; name?: string }) => {
        const result = initProject({
          dir: resolve(ctx.cwd, dir),
          template: opts.template,
          ...(opts.name ? { name: opts.name } : {}),
        });
        return {
          data: result,
          human: (r: InitResult) =>
            [
              `Created td2d project ${paint('bold', `"${r.name}"`, process.stdout)} in ${r.root}`,
              `  ${r.files.filter((f) => !f.startsWith('.td2d/')).join('\n  ')}`,
              '',
              'Next:',
              `  cd ${dir}`,
              '  td2d validate',
              '  td2d asset show props/crate',
            ].join('\n'),
        };
      }),
    );
}
