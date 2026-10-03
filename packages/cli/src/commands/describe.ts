import { type Capabilities, describeCapabilities, loadLibrary, Td2dError } from '@td2d/core';
import { closest } from '@td2d/schema';
import type { Command, Option } from 'commander';
import { action } from '../run.ts';

export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly usage: string;
  readonly arguments: { name: string; required: boolean; description: string }[];
  readonly options: { flags: string; description: string; default?: unknown; choices?: readonly string[] }[];
}

function optionInfo(o: Option) {
  return {
    flags: o.flags,
    description: o.description,
    ...(o.defaultValue === undefined ? {} : { default: o.defaultValue }),
    ...(o.argChoices ? { choices: o.argChoices } : {}),
  };
}

/** Walk the commander tree into plain data. */
export function commandTree(program: Command): { global: ReturnType<typeof optionInfo>[]; commands: CommandInfo[] } {
  const commands: CommandInfo[] = [];
  const visit = (cmd: Command, prefix: string) => {
    for (const sub of cmd.commands) {
      const name = prefix ? `${prefix} ${sub.name()}` : sub.name();
      if (sub.commands.length > 0) {
        visit(sub, name);
        continue;
      }
      commands.push({
        name,
        description: sub.description(),
        usage: `td2d ${name} ${sub.usage()}`.trim(),
        arguments: sub.registeredArguments.map((a) => ({
          name: a.name(),
          required: a.required,
          description: a.description,
        })),
        options: sub.options.map(optionInfo),
      });
    }
  };
  visit(program, '');
  return { global: program.options.map(optionInfo), commands };
}

export function registerDescribe(program: Command): void {
  program
    .command('describe')
    .description(
      'Describe everything this version of td2d supports: commands, documents, part types, presets, palettes, templates and error codes.',
    )
    .argument('[section]', 'Only this part of the description, such as partTypes, presets, pixelPasses or errors')
    .option('--schemas', 'Include the JSON Schema of every entry')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d describe --json\n  $ td2d describe partTypes --json\n  $ td2d describe presets --json --schemas\n\nSections: version, documents, partTypes, directions, presets, palettes, templates, backends, rigs, generators,\neasings, easingDocs, pixelPasses, exporters, stages, exitCodes, errors, warnings, cli.\n',
    )
    .action(
      action((ctx, section: string | undefined, opts: { schemas?: boolean }) => {
        const project = ctx.tryProject();
        const library = loadLibrary(project instanceof Error ? undefined : project);
        const data = {
          ...describeCapabilities(library, { schemas: opts.schemas === true }),
          cli: commandTree(program),
        };
        if (section !== undefined) {
          const sections = Object.keys(data);
          if (!sections.includes(section)) {
            const guess = closest(section, sections);
            throw new Td2dError('E_USAGE', `describe has no section "${section}".`, {
              hint: `${guess ? `Did you mean "${guess}"? ` : ''}Sections: ${sections.join(', ')}.`,
            });
          }
          const part = { version: data.version, [section]: data[section as keyof typeof data] };
          return { data: part, warnings: library.warnings, human: () => JSON.stringify(part[section], null, 2) };
        }
        return {
          data,
          warnings: library.warnings,
          human: (d: Capabilities & { cli: ReturnType<typeof commandTree> }) =>
            [
              `td2d ${d.version}`,
              '',
              'Commands:',
              ...d.cli.commands.map((c) => `  ${c.name.padEnd(16)} ${c.description}`),
              '',
              `Part types: ${d.partTypes.map((p) => p.type).join(', ')}`,
              `Direction sets: ${Object.keys(d.directions.sets).join(', ')}`,
              ...Object.entries(d.presets).map(
                ([kind, list]) => `${kind} presets: ${list.map((p) => p.name).join(', ')}`,
              ),
              `Palettes: ${d.palettes.map((p) => `${p.name} (${p.colors})`).join(', ')}`,
              `Project templates: ${d.templates.projects.join(', ')}`,
              `Asset templates: ${d.templates.assets.map((t) => t.name).join(', ')}`,
              `Pipeline stages: ${d.stages.pipeline.join(', ')}`,
              '',
              'Run `td2d describe --json` for the complete machine-readable description.',
            ].join('\n'),
        };
      }),
    );
}
