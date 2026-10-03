import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  alphaCoverage,
  centroid,
  opaqueBounds,
  opaqueColours,
  readBuild,
  readPng,
  relativePosix,
  Td2dError,
  writePreview,
} from '@td2d/core';
import { type Command, InvalidArgumentError, Option } from 'commander';
import { integer } from '../options.ts';
import { action } from '../run.ts';

function roundPoint(p: { x: number; y: number } | null) {
  return p ? { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) } : null;
}

function background(value: string): string {
  if (value === 'checker' || value === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  throw new InvalidArgumentError('Expected checker, transparent or a #rrggbb colour.');
}

export function registerInspect(program: Command): void {
  program
    .command('inspect')
    .description(
      'Summarise the last generation of an asset: sheet, cells, pivot, validation and stages. With --frame, report one sprite.',
    )
    .argument('<id>', 'Asset id')
    .option('--frame <key>', 'Sprite key such as idle/s/000')
    .option('--cells', 'List every cell: sheet, rectangle, trim offset and whether it is mirrored')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d inspect props/crate --json\n  $ td2d inspect props/crate --frame idle/s/000 --json\n  $ td2d inspect characters/knight --cells --json\n',
    )
    .action(
      action(async (ctx, id: string, opts: { frame?: string; cells?: boolean }) => {
        const project = ctx.project();
        const build = readBuild(project, id);
        if (opts.frame) {
          const file = join(build.dir, 'sprites', `${opts.frame}.png`);
          if (!/^[a-z0-9_-]+\/[a-z0-9-]+\/\d{3}$/.test(opts.frame) || !existsSync(file)) {
            throw new Td2dError('E_USAGE', `No sprite "${opts.frame}" in ${build.relativeDir}.`, {
              hint: `Sprite keys look like ${build.manifest.cells[0] ? `${build.manifest.cells[0].clip}/${build.manifest.cells[0].direction}/000` : 'idle/s/000'}. Run \`td2d inspect ${id} --cells\` to list every cell.`,
            });
          }
          const sprite = await readPng(file);
          const colours = opaqueColours(sprite);
          const data = {
            key: opts.frame,
            file: relativePosix(project.root, file),
            width: sprite.width,
            height: sprite.height,
            coverage: Number(alphaCoverage(sprite.rgba).toFixed(4)),
            bounds: opaqueBounds(sprite),
            centroid: roundPoint(centroid(sprite)),
            colorCount: colours.length,
            colors: colours.slice(0, 64),
          };
          return {
            data,
            human: (d: typeof data) =>
              `${d.key}: ${d.width} x ${d.height}, ${(d.coverage * 100).toFixed(1)}% opaque, ${d.colorCount} colour(s), bounds ${JSON.stringify(d.bounds)}, centroid ${d.centroid ? `${d.centroid.x}, ${d.centroid.y}` : 'none'}`,
          };
        }
        const { manifest, validation, generation } = build;
        const data = {
          assetId: id,
          buildDir: build.relativeDir,
          sheets: manifest.sheets.map((s) => ({
            ...s,
            image: `${build.relativeDir}/sheets/${s.image}`,
            ...(s.data ? { data: `${build.relativeDir}/sheets/${s.data}` } : {}),
          })),
          cellCount: manifest.cells.length,
          files: manifest.files,
          frame: manifest.frame,
          pixelsPerUnit: manifest.pixelsPerUnit,
          pivot: manifest.pivot,
          camera: manifest.camera,
          directions: manifest.directions.map((d) => d.name),
          clips: manifest.clips,
          ...(opts.cells ? { cells: manifest.cells } : {}),
          validation: validation
            ? { status: validation.status, checks: validation.checks.filter((c) => c.status !== 'pass') }
            : null,
          generation: generation
            ? {
                status: generation.status,
                finishedAt: generation.finishedAt,
                durationMs: generation.durationMs,
                backend: generation.backend,
                stages: generation.stages,
              }
            : null,
        };
        return {
          data,
          human: (d: typeof data) =>
            [
              `${d.assetId}: ${d.cellCount} cell(s) of ${d.frame.width} x ${d.frame.height} on ${d.sheets.length} sheet(s)`,
              ...d.sheets.map((s) => `  sheet      ${s.image} (${s.width} x ${s.height}, ${s.layout})`),
              `  formats    ${Object.keys(d.files).join(', ')}`,
              `  pivot      (${d.pivot.x}, ${d.pivot.y}), ground margin ${d.camera.groundMargin} px, ${d.pixelsPerUnit} px/m`,
              `  directions ${d.directions.join(', ')}`,
              `  clips      ${d.clips.map((c) => `${c.name} (${c.frames} frame(s) at ${c.fps} fps)`).join(', ')}`,
              `  validation ${d.validation?.status ?? 'unknown'}${d.validation?.checks.length ? `: ${d.validation.checks.map((c) => `${c.id} ${c.status}`).join(', ')}` : ''}`,
              ...(d.cells ?? []).map(
                (c) =>
                  `  ${c.key.padEnd(18)} ${c.sheet} ${c.x},${c.y} ${c.w}x${c.h}${c.trimmed ? ` offset ${c.offset.x},${c.offset.y}` : ''}${c.mirrored ? ' mirrored' : ''}`,
              ),
            ].join('\n'),
        };
      }),
    );

  program
    .command('preview')
    .description(
      'Write an enlarged PNG of the sheet on a visible background with cell borders, for viewing with an image reader.',
    )
    .argument('<id>', 'Asset id')
    .option('--scale <n>', 'Enlargement factor', integer(1, 32), 8)
    .option('--background <value>', 'checker, transparent or #rrggbb', background, 'checker')
    .option('--no-grid', 'Leave out cell borders')
    .option('--out <file>', 'Where to write the PNG (default: build/<id>/preview.png)')
    .option('--overwrite', 'Replace --out if it already exists')
    .option('--clip <name>', 'Show one clip: its frames in a row for each direction')
    .option('--sheet <n>', 'With the sheet layout: which sheet to show, counting from 0', integer(0, 1024), 0)
    .addOption(
      new Option(
        '--layout <layout>',
        'sheet: the whole sheet. ring: one frame per direction, placed at the angle it faces',
      )
        .choices(['sheet', 'ring'])
        .default('sheet'),
    )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d preview props/crate --json\n  $ td2d preview props/crate --scale 4 --out /tmp/crate.png --overwrite\n  $ td2d preview props/crate --layout ring\n  $ td2d preview characters/knight --clip walk --scale 4\n',
    )
    .action(
      action(
        async (
          ctx,
          id: string,
          opts: {
            scale: number;
            background: string;
            grid: boolean;
            out?: string;
            overwrite?: boolean;
            layout: 'sheet' | 'ring';
            clip?: string;
            sheet: number;
          },
        ) => {
          const project = ctx.project();
          const build = readBuild(project, id);
          const out = opts.out ? resolve(ctx.cwd, opts.out) : join(build.dir, 'preview.png');
          if (opts.out && !out.endsWith('.png')) throw new Td2dError('E_USAGE', '--out must end in .png.');
          if (opts.out && existsSync(out) && !opts.overwrite)
            throw new Td2dError('E_USAGE', `${out} already exists.`, { hint: 'Pass --overwrite to replace it.' });
          const result = await writePreview(build, {
            scale: opts.scale,
            background: opts.background,
            grid: opts.grid,
            out,
            layout: opts.layout,
            ...(opts.clip !== undefined ? { clip: opts.clip } : {}),
            sheet: opts.sheet,
          });
          const data = { ...result, file: relativePosix(ctx.cwd, result.file) };
          return { data, human: (d: typeof data) => `Wrote ${d.file} (${d.width} x ${d.height}).` };
        },
      ),
    );
}
