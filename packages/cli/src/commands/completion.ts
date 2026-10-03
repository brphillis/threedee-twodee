import { Td2dError } from '@td2d/core';
import type { Command } from 'commander';
import { action } from '../run.ts';
import { type CommandInfo, commandTree } from './describe.ts';

export const SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

interface Spec {
  /** "generate" or "history list". */
  readonly name: string;
  readonly description: string;
  /** Long and short flags, such as --scale and -V. */
  readonly flags: string[];
  /** Flags that take a value from a fixed list. */
  readonly choices: Record<string, readonly string[]>;
  /** Whether a positional argument is an asset id. */
  readonly ids: boolean;
}

const flagNames = (flags: string) => flags.split(/[ ,|]+/).filter((f) => f.startsWith('-'));

function specs(commands: readonly CommandInfo[]): Spec[] {
  return commands.map((c) => {
    const choices: Record<string, readonly string[]> = {};
    for (const o of c.options) if (o.choices) for (const f of flagNames(o.flags)) choices[f] = o.choices;
    return {
      name: c.name,
      description: c.description.split(/(?<=\.) /)[0] ?? c.description,
      flags: c.options.flatMap((o) => flagNames(o.flags)),
      choices,
      ids: c.arguments.some((a) => a.name === 'id' || a.name === 'ids'),
    };
  });
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function bash(program: Command): string {
  const tree = commandTree(program);
  const all = specs(tree.commands);
  const globals = tree.global.flatMap((o) => flagNames(o.flags));
  const top = [...new Set(all.map((s) => s.name.split(' ')[0] as string))];
  const groups = [...new Set(all.filter((s) => s.name.includes(' ')).map((s) => s.name.split(' ')[0] as string))];
  const lines = [
    '# td2d shell completion for bash.',
    '# Load it with:  eval "$(td2d completion bash)"   (for example in ~/.bashrc)',
    '_td2d() {',
    '  local cur prev key opts ids choices',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    `  local globals=${quote(globals.join(' '))}`,
    '  if [[ $COMP_CWORD -eq 1 ]]; then',
    `    COMPREPLY=( $(compgen -W ${quote(`${top.join(' ')} ${globals.join(' ')}`)} -- "$cur") )`,
    '    return',
    '  fi',
    '  key="${COMP_WORDS[1]}"',
    '  case "$key" in',
  ];
  for (const g of groups) {
    const subs = all.filter((s) => s.name.startsWith(`${g} `)).map((s) => s.name.split(' ')[1]);
    lines.push(
      `    ${g})`,
      `      if [[ $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W ${quote(subs.join(' '))} -- "$cur") ); return; fi`,
      '      key="$key ${COMP_WORDS[2]}" ;;',
    );
  }
  lines.push('  esac', '  opts=""; ids=""; choices=""', '  case "$key" in');
  for (const s of all) {
    lines.push(`    ${quote(s.name)})`);
    lines.push(`      opts=${quote(s.flags.join(' '))}${s.ids ? '; ids=1' : ''}`);
    const withChoices = Object.entries(s.choices);
    if (withChoices.length > 0) {
      lines.push('      case "$prev" in');
      for (const [flag, values] of withChoices) lines.push(`        ${flag}) choices=${quote(values.join(' '))} ;;`);
      lines.push('      esac');
    }
    lines.push('      ;;');
  }
  lines.push(
    '  esac',
    '  if [[ -n "$choices" ]]; then COMPREPLY=( $(compgen -W "$choices" -- "$cur") ); return; fi',
    '  if [[ "$cur" == -* ]]; then COMPREPLY=( $(compgen -W "$opts $globals" -- "$cur") ); return; fi',
    '  if [[ -n "$ids" ]]; then COMPREPLY=( $(compgen -W "$(td2d asset list --ids 2>/dev/null)" -- "$cur") ); fi',
    '}',
    'complete -o default -F _td2d td2d',
    '',
  );
  return lines.join('\n');
}

function zsh(program: Command): string {
  return [
    "# td2d shell completion for zsh, through zsh's bash completion support.",
    '# Load it with:  eval "$(td2d completion zsh)"   (for example in ~/.zshrc, after compinit)',
    'autoload -U +X compinit && compinit',
    'autoload -U +X bashcompinit && bashcompinit',
    bash(program),
  ].join('\n');
}

function fish(program: Command): string {
  const tree = commandTree(program);
  const all = specs(tree.commands);
  const top = new Map<string, string>();
  for (const s of all) {
    const first = s.name.split(' ')[0] as string;
    if (!top.has(first)) top.set(first, s.name.includes(' ') ? `${first} commands` : s.description);
  }
  const lines = [
    '# td2d shell completion for fish.',
    '# Load it with:  td2d completion fish > ~/.config/fish/completions/td2d.fish',
    'complete -c td2d -f',
  ];
  for (const o of tree.global) {
    for (const f of flagNames(o.flags).filter((f) => f.startsWith('--')))
      lines.push(`complete -c td2d -l ${f.slice(2)} -d ${quote(o.description)}`);
  }
  for (const [name, description] of top)
    lines.push(`complete -c td2d -n '__fish_use_subcommand' -a ${name} -d ${quote(description)}`);
  for (const s of all) {
    const [first, second] = s.name.split(' ') as [string, string | undefined];
    const seen = second
      ? `__fish_seen_subcommand_from ${first}; and __fish_seen_subcommand_from ${second}`
      : `__fish_seen_subcommand_from ${first}`;
    if (second) {
      lines.push(
        `complete -c td2d -n '__fish_seen_subcommand_from ${first}; and not __fish_seen_subcommand_from ${all
          .filter((x) => x.name.startsWith(`${first} `))
          .map((x) => x.name.split(' ')[1])
          .join(' ')}' -a ${second} -d ${quote(s.description)}`,
      );
    }
    for (const f of s.flags.filter((f) => f.startsWith('--'))) {
      const values = s.choices[f];
      lines.push(
        `complete -c td2d -n ${quote(seen)} -l ${f.slice(2)}${values ? ` -x -a ${quote(values.join(' '))}` : ''}`,
      );
    }
    if (s.ids) lines.push(`complete -c td2d -n ${quote(seen)} -a '(td2d asset list --ids 2>/dev/null)'`);
  }
  lines.push('');
  return lines.join('\n');
}

export function completionScript(program: Command, shell: Shell): string {
  return shell === 'bash' ? bash(program) : shell === 'zsh' ? zsh(program) : fish(program);
}

export function registerCompletion(program: Command): void {
  program
    .command('completion')
    .description(
      'Print a shell completion script for bash, zsh or fish: commands, options, option values and asset ids.',
    )
    .argument('<shell>', `One of ${SHELLS.join(', ')}`)
    .addHelpText(
      'after',
      '\nExamples:\n  $ eval "$(td2d completion bash)"\n  $ eval "$(td2d completion zsh)"\n  $ td2d completion fish > ~/.config/fish/completions/td2d.fish\n',
    )
    .action(
      action((_ctx, shell: string) => {
        if (!(SHELLS as readonly string[]).includes(shell))
          throw new Td2dError('E_USAGE', `No completion for "${shell}".`, {
            hint: `Choose one of ${SHELLS.join(', ')}.`,
          });
        const script = completionScript(program, shell as Shell);
        const data = { shell, script };
        // The script itself is the human output, so `eval "$(td2d completion bash)"` works.
        return { data, human: (d: typeof data) => d.script.trimEnd() };
      }),
    );
}
