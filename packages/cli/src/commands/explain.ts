import { Td2dError } from '@td2d/core';
import { ALL_CODES, type CodeExplanation, editDistance, explainCode } from '@td2d/schema';
import type { Command } from 'commander';
import { action } from '../run.ts';

export function suggestCodes(input: string, limit = 3): string[] {
  const upper = input.trim().toUpperCase();
  const contains = ALL_CODES.filter((c) => upper.length >= 3 && c.includes(upper.replace(/^[EW]_/, '')));
  const near = [...ALL_CODES].sort((a, b) => editDistance(upper, a) - editDistance(upper, b)).slice(0, limit);
  return [...new Set([...contains, ...near])].slice(0, limit);
}

function human(e: CodeExplanation): string {
  return [
    `${e.code} (${e.kind}${e.exit === null ? ', never changes the exit code' : `, exit code ${e.exit}`})`,
    '',
    e.summary,
    ...(e.detail ? ['', e.detail] : []),
    '',
    `Fix: ${e.hint}`,
    `See: ${e.docs}`,
    `     ${e.topic.docs} (${e.topic.title})`,
  ].join('\n');
}

export function registerExplain(program: Command): void {
  program
    .command('explain')
    .description(
      'Explain an error or warning code: what it means, when it happens, how to fix it and where to read more.',
    )
    .argument('[code]', 'An error code such as E_ASSET_INVALID or a warning code such as W_FRAME_CLIPPED')
    .option('--list', 'List every error and warning code with its summary')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d explain E_PART_NOT_MANIFOLD\n  $ td2d explain w_frame_clipped --json\n  $ td2d explain --list --json\n',
    )
    .action(
      action((_ctx, code: string | undefined, opts: { list?: boolean }) => {
        if (opts.list || code === undefined) {
          if (!opts.list)
            throw new Td2dError('E_USAGE', 'Name a code to explain, or pass --list.', {
              hint: 'Run `td2d explain --list`.',
            });
          const codes = ALL_CODES.map((c) => explainCode(c) as CodeExplanation);
          const data = { codes };
          return {
            data,
            human: (d: typeof data) => d.codes.map((e) => `${e.code.padEnd(26)} ${e.summary}`).join('\n'),
          };
        }
        const entry = explainCode(code);
        if (!entry) {
          const suggestions = suggestCodes(code);
          throw new Td2dError('E_USAGE', `"${code}" is not a td2d error or warning code.`, {
            hint: `Did you mean ${suggestions.join(', ')}? Run \`td2d explain --list\` for every code.`,
            details: { suggestions },
          });
        }
        return { data: entry, human };
      }),
    );
}
