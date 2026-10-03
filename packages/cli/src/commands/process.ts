import type { Command } from 'commander';
import { action } from '../run.ts';
import { addPipelineOptions, type PipelineFlags, pipelineResult, runPipeline } from './generate.ts';

export function registerProcess(program: Command): void {
  addPipelineOptions(
    program
      .command('process')
      .description(
        'Rerun pixel processing and every later stage from the cached renders. Use it after changing pixel settings: nothing is rendered again unless the renders are missing or out of date.',
      )
      .argument('[ids...]', 'Asset ids (default: every asset)'),
    { stages: false },
  )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d process props/crate --json\n  $ td2d process props/crate --strict\n\nSame as `td2d generate <id> --from pixel`. Stages before pixel are reused from .td2d/cache when they are still valid, and run otherwise.\n',
    )
    .action(
      action(async (ctx, ids: string[], flags: Omit<PipelineFlags, 'from' | 'to'>) =>
        pipelineResult(await runPipeline(ctx, ids, { ...flags, from: 'pixel' })),
      ),
    );
}
