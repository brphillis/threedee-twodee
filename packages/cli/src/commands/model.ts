import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary, type ModelReport, type RigReport, Td2dError } from '@td2d/core';
import type { Command } from 'commander';
import { action } from '../run.ts';
import { addPipelineOptions, type PipelineFlags, runPipeline } from './generate.ts';

type Ctx = Parameters<Parameters<typeof action>[0]>[0];

/** Run the pipeline to the rig stage and read the model and rig reports. */
async function build(ctx: Ctx, id: string, flags: PipelineFlags) {
  const run = await runPipeline(ctx, [id], { ...flags, to: 'rig' });
  const result = run.results[0];
  if (run.error || !result?.outputs.rig) return { run, model: undefined, rig: undefined, glb: undefined };
  const dir = join(ctx.project().root, result.outputs.buildDir ?? '');
  const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  return {
    run,
    model: read<ModelReport>('model/model-report.json'),
    rig: read<RigReport>('rig/rig-report.json'),
    glb: result.outputs.rig,
  };
}

export function registerModel(program: Command): void {
  const model = program.command('model').description('Build and inspect asset geometry, rigs and clips.');

  addPipelineOptions(
    model
      .command('build')
      .description(
        'Build the model GLB for an asset, with its rig and baked clips (the resolve, model and rig stages).',
      )
      .argument('<id>', 'Asset id'),
    { stages: false },
  )
    .addHelpText('after', '\nExamples:\n  $ td2d model build props/crate --json\n')
    .action(
      action(async (ctx, id: string, flags: PipelineFlags) => {
        const { run, model: report, rig, glb } = await build(ctx, id, flags);
        const data = { assetId: id, glb, report, rig, stages: run.results[0]?.stages };
        return {
          data,
          warnings: run.warnings,
          ...(run.error ? { error: run.error } : {}),
          human: (d: typeof data) =>
            `Built ${d.glb}: ${d.report?.triangles} triangles, ${Object.keys(d.report?.materials ?? {}).length} material(s), ${d.rig?.bones.length ?? 0} bone(s), ${d.rig?.clips.filter((c) => c.animated).length ?? 0} animated clip(s).`,
        };
      }),
    );

  model
    .command('inspect')
    .description(
      'Report bounds, triangle counts, materials, parts, bones, clips and glTF validation for an asset model, building it if needed. With --clip, report one clip; add --keys for its keys, including generated ones.',
    )
    .argument('<id>', 'Asset id')
    .option('--clip <name>', 'Report one clip')
    .option('--keys', 'With --clip: include every key (a generator shows the keys it made)')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d model inspect props/crate --json\n  $ td2d model inspect characters/knight --clip walk --keys --json\n',
    )
    .action(
      action(async (ctx, id: string, opts: { clip?: string; keys?: boolean }) => {
        if (opts.keys && opts.clip === undefined) throw new Td2dError('E_USAGE', '--keys needs --clip.');
        const { run, model: report, rig, glb } = await build(ctx, id, {});
        if (opts.clip !== undefined && rig) {
          const clip = rig.clips.find((c) => c.name === opts.clip);
          if (!clip) {
            throw new Td2dError('E_USAGE', `"${id}" has no clip "${opts.clip}".`, {
              hint: `Clips: ${rig.clips.map((c) => c.name).join(', ')}.`,
            });
          }
          const { keys, ...summary } = clip;
          const data = { assetId: id, clip: { ...summary, keyCount: keys.length, ...(opts.keys ? { keys } : {}) } };
          return {
            data,
            warnings: run.warnings,
            human: (d: typeof data) =>
              [
                `${d.assetId} clip ${d.clip.name}: ${d.clip.duration} s from ${d.clip.source}, ${d.clip.keyCount} key(s), ${d.clip.interpolation}`,
                `  bones ${d.clip.bones.join(', ') || 'none'}`,
                ...(d.clip.keys ?? []).map((k) => `  t=${k.t} ${JSON.stringify(k.pose)}`),
              ].join('\n'),
          };
        }
        const clips = rig?.clips.map(({ keys, ...c }) => ({ ...c, keyCount: keys.length }));
        const data = {
          assetId: id,
          glb,
          ...(report ? { report } : {}),
          ...(rig ? { bones: rig.bones, attachments: rig.attachments, clips } : {}),
        };
        return {
          data,
          warnings: run.warnings,
          ...(run.error ? { error: run.error } : {}),
          human: (d: typeof data) =>
            d.report
              ? [
                  `${d.assetId}: ${d.report.triangles} triangles, ${d.report.vertices} vertices`,
                  `  size      ${d.report.size.join(' x ')} m (min ${d.report.bounds.min.join(', ')}, max ${d.report.bounds.max.join(', ')})`,
                  `  materials ${Object.entries(d.report.materials)
                    .map(([k, v]) => `${k} (${v.triangles})`)
                    .join(', ')}`,
                  `  parts     ${d.report.parts.map((p) => `${p.id}:${p.type}${p.bone ? `@${p.bone}` : ''}`).join(', ')}`,
                  `  bones     ${d.bones?.map((b) => b.name).join(', ') || 'none'}`,
                  `  clips     ${d.clips?.map((c) => `${c.name} (${c.source}${c.animated ? '' : ', rest pose'})`).join(', ') ?? 'none'}`,
                  `  glTF validator ${d.report.validator.available ? `${d.report.validator.errors} error(s), ${d.report.validator.warnings} warning(s)` : 'unavailable'}`,
                ].join('\n')
              : '',
        };
      }),
    );

  const rig = program.command('rig').description('List rig presets and show an asset rig.');
  rig
    .command('list')
    .description('List rig presets: built in and from presets/rig/.')
    .addHelpText('after', '\nExamples:\n  $ td2d rig list --json\n')
    .action(
      action(async (ctx) => {
        const project = ctx.tryProject();
        const library = loadLibrary(project instanceof Error ? undefined : project);
        const presets = [...library.rigs.values()].map((e) => ({
          name: e.name,
          source: e.source,
          description: e.data.description ?? '',
          bones: e.data.bones.map((b) => b.name),
        }));
        return {
          data: { presets },
          human: (d: { presets: typeof presets }) =>
            d.presets
              .map((p) => `${p.name.padEnd(16)} ${String(p.bones.length).padStart(3)} bones  ${p.description}`)
              .join('\n'),
        };
      }),
    );
  rig
    .command('show')
    .description('Show the bones of an asset rig with their rest positions, and the parts attached to each.')
    .argument('<id>', 'Asset id')
    .addHelpText('after', '\nExamples:\n  $ td2d rig show characters/knight --json\n')
    .action(
      action(async (ctx, id: string) => {
        const { run, model: report, rig: built } = await build(ctx, id, {});
        const bones = (built?.bones ?? []).map((b) => ({
          ...b,
          parts: (report?.parts ?? []).filter((p) => p.bone === b.name && p.skin === 'rigid').map((p) => p.id),
        }));
        const skinned = (report?.parts ?? [])
          .filter((p) => p.skin !== 'rigid')
          .map((p) => ({ id: p.id, skin: p.skin }));
        const data = { assetId: id, bones, skinned };
        return {
          data,
          warnings: run.warnings,
          ...(run.error ? { error: run.error } : {}),
          human: (d: typeof data) =>
            d.bones.length === 0
              ? `${d.assetId} has no rig.`
              : [
                  ...d.bones.map(
                    (b) =>
                      `${b.name.padEnd(16)} parent ${String(b.parent ?? '-').padEnd(14)} at ${b.world.join(', ')}  ${b.parts.join(', ')}`,
                  ),
                  ...d.skinned.map((s) => `skinned ${s.id} (${s.skin})`),
                ].join('\n'),
        };
      }),
    );
}
