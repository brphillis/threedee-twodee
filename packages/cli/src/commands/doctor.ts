import { type DoctorReport, runDoctor, Td2dError } from '@td2d/core';
import type { Command } from 'commander';
import { paint } from '../output/style.ts';
import { action } from '../run.ts';

const MARK = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' } as const;
const COLOR = { pass: 'green', warn: 'yellow', fail: 'red', skip: 'gray' } as const;

function human(report: DoctorReport): string {
  const lines = report.checks.map((c) => {
    const mark = paint(COLOR[c.status], MARK[c.status], process.stdout);
    const hint = c.status === 'fail' && c.hint ? `\n       ${paint('yellow', 'hint', process.stdout)} ${c.hint}` : '';
    return `${mark}  ${c.title}: ${c.message}${hint}`;
  });
  return lines.join('\n');
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check that this machine can run td2d: Node.js, native modules, the headless browser and the project.')
    .option('--fix', 'Install the headless browser if it is missing')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d doctor\n  $ td2d doctor --fix --json\n\nExit code 7 means a check failed; each failed check has a code and a hint.\n',
    )
    .action(
      action(async (ctx, opts: { fix?: boolean }) => {
        const report = await runDoctor({
          project: ctx.tryProject(),
          cwd: ctx.cwd,
          fix: opts.fix === true,
          logger: ctx.logger,
          progress: ctx.progress,
          signal: ctx.signal,
        });
        const failed = report.checks.find((c) => c.status === 'fail');
        const error = failed
          ? new Td2dError(
              failed.code && failed.code !== 'E_INTERNAL' ? failed.code : 'E_ENVIRONMENT',
              `Doctor check "${failed.id}" failed: ${failed.message}`,
              {
                ...(failed.hint ? { hint: failed.hint } : {}),
                ...(failed.issues ? { issues: failed.issues } : {}),
                details: { failedChecks: report.checks.filter((c) => c.status === 'fail').map((c) => c.id) },
              },
            )
          : undefined;
        return { data: report, human, ...(error ? { error } : {}) };
      }),
    );
}
