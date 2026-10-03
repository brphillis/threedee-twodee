import { ExportFormat, type ExportFormatT } from '@td2d/schema';
import { type Command, InvalidArgumentError } from 'commander';
import { action } from '../run.ts';
import { addPipelineOptions, type PipelineFlags, pipelineResult, runPipeline } from './generate.ts';

function formatList(value: string): ExportFormatT[] {
  const formats = value.split(',').map((f) => f.trim());
  for (const f of formats) {
    if (!ExportFormat.safeParse(f).success)
      throw new InvalidArgumentError(`Unknown format "${f}". Formats: ${ExportFormat.options.join(', ')}.`);
  }
  return formats as ExportFormatT[];
}

export function registerSheetAndExport(program: Command): void {
  addPipelineOptions(
    program
      .command('sheet')
      .description(
        'Lay out the sheets again from the cached sprites, then validate and export. Use it after changing sheet settings.',
      )
      .argument('[ids...]', 'Asset ids (default: every asset)'),
    { stages: false },
  )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d sheet characters/knight --json\n\nSame as `td2d generate <id> --from sheet`.\n',
    )
    .action(
      action(async (ctx, ids: string[], flags: Omit<PipelineFlags, 'from' | 'to'>) =>
        pipelineResult(await runPipeline(ctx, ids, { ...flags, from: 'sheet' })),
      ),
    );

  addPipelineOptions(
    program
      .command('export')
      .description(
        'Write export formats from the cached sheets. With --format, write these formats instead of the ones in the asset (the manifest is always written).',
      )
      .argument('[ids...]', 'Asset ids (default: every asset)')
      .option('--format <list>', `Comma-separated formats: ${ExportFormat.options.join(', ')}`, formatList),
    { stages: false },
  )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d export characters/knight --format pixi,phaser-atlas --json\n  $ td2d export --format godot-spriteframes\n',
    )
    .action(
      action(async (ctx, ids: string[], flags: Omit<PipelineFlags, 'from' | 'to'> & { format?: ExportFormatT[] }) => {
        const { format, ...rest } = flags;
        return pipelineResult(
          await runPipeline(ctx, ids, { ...rest, from: 'export' }, format ? { exportFormats: format } : {}),
        );
      }),
    );
}
