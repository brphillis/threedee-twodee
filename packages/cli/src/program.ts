import { Td2dError } from '@td2d/core';
import { Command, CommanderError, Option } from 'commander';
import { registerAsset } from './commands/asset.ts';
import { registerBatch } from './commands/batch.ts';
import { registerCache } from './commands/cache.ts';
import { registerCompare } from './commands/compare.ts';
import { registerCompletion } from './commands/completion.ts';
import { registerDescribe } from './commands/describe.ts';
import { registerDoctor } from './commands/doctor.ts';
import { registerExplain } from './commands/explain.ts';
import { registerSheetAndExport } from './commands/export.ts';
import { registerGenerate } from './commands/generate.ts';
import { registerHistory } from './commands/history.ts';
import { registerInit } from './commands/init.ts';
import { registerInspect } from './commands/inspect.ts';
import { registerModel } from './commands/model.ts';
import { registerProcess } from './commands/process.ts';
import { registerRender } from './commands/render.ts';
import { registerSchema } from './commands/schema.ts';
import { registerValidate } from './commands/validate.ts';
import { registerViewer } from './commands/viewer.ts';
import { buildEnvelope, formatError, writeJson } from './output/envelope.ts';
import { LOG_LEVELS } from './output/logger.ts';
import { CLI_VERSION } from './version.ts';

const GLOBAL_HELP = `
Output:
  Without --json, results go to stdout and logs, warnings and errors go to stderr.
  With --json, stdout is exactly one JSON document (the envelope) and stderr carries NDJSON logs and progress.

Exit codes:
  0 success (warnings allowed)   1 internal error        2 usage error
  3 invalid input                4 generation failed     5 output failed validation
  6 batch partially failed       7 environment problem   130 cancelled

Start here:
  $ td2d init my-sprites && cd my-sprites
  $ td2d validate
  $ td2d describe --json
`;

export function buildProgram(): Command {
  const program = new Command('td2d');
  program
    .description('Turn declarative 3D asset definitions into pixel-art sprites and sprite sheets.')
    .version(CLI_VERSION, '-V, --version', 'Print the td2d version')
    .option('--project <dir>', 'Project root (default: nearest directory with td2d.project.json)')
    .option('--json', 'Print one JSON envelope on stdout; NDJSON logs and progress on stderr')
    .addOption(new Option('--log-level <level>', 'Log verbosity').choices(LOG_LEVELS).default('info'))
    .option('--no-color', 'Disable colour (also honours NO_COLOR)')
    .showSuggestionAfterError(true)
    .exitOverride()
    .configureOutput({
      // Usage errors are reported once by main(): inside the envelope with --json, on stderr otherwise.
      outputError: () => {},
    })
    .addHelpText('after', GLOBAL_HELP);

  registerInit(program);
  registerDoctor(program);
  registerSchema(program);
  registerDescribe(program);
  registerValidate(program);
  registerAsset(program);
  registerGenerate(program);
  registerBatch(program);
  registerModel(program);
  registerProcess(program);
  registerSheetAndExport(program);
  registerRender(program);
  registerInspect(program);
  registerHistory(program);
  registerCache(program);
  registerCompare(program);
  registerViewer(program);
  registerExplain(program);
  registerCompletion(program);
  return program;
}

/** The command a list of arguments names, such as "generate" or "history show", or "" if none. */
export function commandPathOf(program: Command, args: readonly string[]): string {
  const words = args.filter((a) => !a.startsWith('-'));
  const first = program.commands.find((c) => c.name() === words[0]);
  if (!first) return '';
  const second = first.commands.find((c) => c.name() === words[1]);
  return second ? `${first.name()} ${second.name()}` : first.name();
}

/** Parse argv and run. Sets process.exitCode; never calls process.exit on success paths. */
export async function main(input: readonly string[] = process.argv): Promise<void> {
  // TD2D_JSON=1 turns --json on for every command, so a mistyped flag cannot lose the envelope.
  const argv = process.env.TD2D_JSON === '1' && !input.includes('--json') ? [...input, '--json'] : [...input];
  if (argv.includes('--no-color')) process.env.NO_COLOR = '1';
  const program = buildProgram();
  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode === 0 || error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exitCode = 0;
      return;
    }
    const message = error.message.replace(/^error:\s*/i, '').replace(/\s*\n\s*/g, ' ');
    const command = commandPathOf(program, argv.slice(2));
    const usage = new Td2dError('E_USAGE', message.charAt(0).toUpperCase() + message.slice(1), {
      details: { commanderCode: error.code },
      hint: command ? `Run \`td2d ${command} --help\`.` : 'Run `td2d --help` for the commands.',
    });
    // A mistyped --json still wants JSON back.
    const json = argv.includes('--json') || /Did you mean --json\?/.test(message);
    if (json) {
      writeJson(buildEnvelope({ command, version: CLI_VERSION, durationMs: 0, warnings: [], error: usage }));
    } else if (error.code === 'commander.help') {
      // Commander already printed help because no command was given.
    } else {
      process.stderr.write(formatError({ code: 'E_USAGE', message: usage.message, hint: usage.hint }));
    }
    process.exitCode = usage.exitCode;
  }
}
