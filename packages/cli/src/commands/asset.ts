import {
  type CreateAssetResult,
  createAsset,
  emitAsset,
  isTd2dError,
  listAssetLocations,
  listAssetTemplates,
  loadAsset,
  loadLibrary,
  resolveAsset,
} from '@td2d/core';
import type { Command } from 'commander';
import { integer } from '../options.ts';
import { action } from '../run.ts';

interface AssetSummary {
  id: string;
  file: string;
  status: 'valid' | 'invalid';
  type?: string;
  description?: string;
  errorCode?: string;
}

export function registerAsset(program: Command): void {
  const asset = program.command('asset').description('Create, list and inspect asset definitions.');

  asset
    .command('list')
    .description('List every asset in the project with its schema status.')
    .option(
      '--ids',
      'Print only the asset ids, one per line, without reading the definitions (used by shell completion)',
    )
    .addHelpText('after', '\nExamples:\n  $ td2d asset list --json\n  $ td2d asset list --ids\n')
    .action(
      action((ctx, opts: { ids?: boolean }) => {
        const project = ctx.project();
        if (opts.ids) {
          const ids = listAssetLocations(project).map((l) => l.id);
          return { data: { ids }, human: (d: { ids: string[] }) => d.ids.join('\n') };
        }
        const assets: AssetSummary[] = listAssetLocations(project).map((location) => {
          try {
            const { definition } = loadAsset(project, location);
            return {
              id: location.id,
              file: location.displayPath,
              status: 'valid',
              type: definition.type,
              ...(definition.description ? { description: definition.description } : {}),
            };
          } catch (error) {
            if (!isTd2dError(error)) throw error;
            return { id: location.id, file: location.displayPath, status: 'invalid', errorCode: error.code };
          }
        });
        return {
          data: { assets },
          human: (d: { assets: AssetSummary[] }) =>
            d.assets.length === 0
              ? 'No assets. Create one with `td2d asset create <id>`.'
              : d.assets
                  .map(
                    (a) =>
                      `${a.id.padEnd(28)} ${(a.type ?? '').padEnd(10)} ${a.status === 'valid' ? (a.description ?? '') : `invalid (${a.errorCode})`}`,
                  )
                  .join('\n'),
        };
      }),
    );

  asset
    .command('show')
    .description('Show an asset after defaults and presets are applied.')
    .argument('<id>', 'Asset id, such as props/crate')
    .option('--raw', 'Show the definition as written instead of the resolved asset')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d asset show props/crate --json\n  $ td2d asset show props/crate --raw\n',
    )
    .action(
      action((ctx, id: string, opts: { raw?: boolean }) => {
        const project = ctx.project();
        const loaded = loadAsset(project, id);
        if (opts.raw)
          return {
            data: { id, definition: loaded.definition },
            human: (d: { definition: unknown }) => JSON.stringify(d.definition, null, 2),
          };
        const library = loadLibrary(project);
        const { asset: resolved, warnings } = resolveAsset(project, loaded, library);
        return {
          data: { id, asset: resolved },
          warnings: [...library.warnings, ...warnings],
          human: (d: { asset: unknown }) => JSON.stringify(d.asset, null, 2),
        };
      }),
    );

  asset
    .command('emit')
    .description('Run a TypeScript asset script and write the definition it returns to assets/<id>/asset.json.')
    .argument('<script>', 'Script whose default export is an asset definition, or a function returning one')
    .option('--id <id>', 'Asset id (default: the id in the definition)')
    .option('--out <file>', 'Write here instead of assets/<id>/asset.json')
    .option('--overwrite', 'Replace an existing file that differs')
    .option('--print', 'Print the definition without writing it')
    .option('--timeout <ms>', 'Stop the script after this long (default 30000)', integer(100, 600_000))
    .addHelpText(
      'after',
      "\nExamples:\n  $ td2d asset emit scripts/barrel.ts --json\n  $ td2d asset emit scripts/fence.ts --id props/fence --overwrite\n\nScripts import helpers from '@td2d/core/sdk' and run in a separate Node process that may read only the project\nand the packages it imports: no writes, processes, workers or addons, 512 MB of memory and 30 s by default.\nThe JSON file, not the script, is what td2d generates from.\n",
    )
    .action(
      action(
        async (
          ctx,
          script: string,
          opts: { id?: string; out?: string; overwrite?: boolean; print?: boolean; timeout?: number },
        ) => {
          const { timeout, ...rest } = opts;
          const result = await emitAsset(ctx.project(), script, {
            ...rest,
            signal: ctx.signal,
            ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
          });
          const data = { id: result.id, file: result.file, changed: result.changed, definition: result.definition };
          return {
            data,
            human: () =>
              opts.print
                ? result.text
                : result.changed
                  ? `Wrote ${result.file}.`
                  : `${result.file} is already up to date.`,
          };
        },
      ),
    );

  asset
    .command('create')
    .description('Scaffold assets/<id>/asset.json from a template. The result is validated before it is written.')
    .argument('<id>', 'New asset id, such as props/barrel')
    .option(
      '--template <name>',
      `Asset template (${listAssetTemplates()
        .map((t) => t.name)
        .join(', ')})`,
      'box',
    )
    .option('--description <text>', 'Description to write into the asset')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d asset create props/barrel --template cylinder\n  $ td2d asset create characters/hero --template character-blockout --json\n',
    )
    .action(
      action((ctx, id: string, opts: { template: string; description?: string }) => {
        const result = createAsset(ctx.project(), id, {
          template: opts.template,
          ...(opts.description ? { description: opts.description } : {}),
        });
        return {
          data: result,
          warnings: result.warnings,
          human: (r: CreateAssetResult) =>
            `Created ${r.file} from the "${r.template}" template.\nEdit it, then run \`td2d validate ${r.id}\`.`,
        };
      }),
    );
}
