import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALL_CODES,
  ERROR_CATALOG,
  ERROR_CODES,
  explainCode,
  TROUBLESHOOTING_TOPICS,
  WARNING_CATALOG,
} from '@td2d/schema';
import { afterAll, describe, expect, it } from 'vitest';
import { completionScript } from '../src/commands/completion.ts';
import { suggestCodes } from '../src/commands/explain.ts';
import { buildProgram } from '../src/program.ts';
import { commandHelp, renderCliReference } from '../src/reference.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');

describe('CLI reference', () => {
  it('matches docs/reference/cli.md (run `pnpm generate` to update)', () => {
    expect(readFileSync(join(REPO, 'docs', 'reference', 'cli.md'), 'utf8')).toBe(renderCliReference());
  });

  it('gives every command at least one example in its --help', () => {
    const missing = commandHelp(buildProgram())
      .filter((c) => !c.examples.some((e) => e.startsWith('td2d ') || e.includes('td2d ')))
      .map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it('describes every command, argument and option', () => {
    for (const c of commandHelp(buildProgram())) {
      expect(c.command.description(), c.name).not.toBe('');
      for (const a of c.command.registeredArguments) expect(a.description, `${c.name} ${a.name()}`).not.toBe('');
      for (const o of c.command.options) expect(o.description, `${c.name} ${o.flags}`).not.toBe('');
    }
  });
});

describe('error catalogue', () => {
  it('has a summary, detail, hint and troubleshooting topic for every error and warning', () => {
    for (const code of ERROR_CODES) {
      const e = ERROR_CATALOG[code];
      expect(
        [e.summary, e.detail, e.hint].every((t) => t.length > 10),
        code,
      ).toBe(true);
      expect(e.detail, code).not.toBe(e.hint);
      expect(Object.keys(TROUBLESHOOTING_TOPICS), code).toContain(e.topic);
    }
    for (const [code, w] of Object.entries(WARNING_CATALOG)) {
      expect(
        [w.summary, w.hint].every((t) => t.length > 10),
        code,
      ).toBe(true);
      expect(Object.keys(TROUBLESHOOTING_TOPICS), code).toContain(w.topic);
    }
  });

  it('lists every code under its topic in the troubleshooting guide', () => {
    const guide = readFileSync(join(REPO, 'docs', 'guide', 'troubleshooting.md'), 'utf8');
    const sections = new Map<string, string>();
    const parts = guide.split(/^## /m).slice(1);
    for (const part of parts) sections.set(part.slice(0, part.indexOf('\n')).trim(), part);
    for (const code of ALL_CODES) {
      const entry = explainCode(code);
      if (!entry) throw new Error(code);
      const section = sections.get(entry.topic.title);
      expect(section, `troubleshooting.md has no "## ${entry.topic.title}"`).toBeDefined();
      expect(section, `${code} is not listed under "${entry.topic.title}"`).toContain(code);
    }
  });

  it('explains codes case-insensitively and suggests near misses', () => {
    expect(explainCode('e_asset_invalid')).toMatchObject({ code: 'E_ASSET_INVALID', kind: 'error', exit: 3 });
    expect(explainCode('W_FRAME_CLIPPED')).toMatchObject({ kind: 'warning', exit: null, detail: null });
    expect(explainCode('E_NOPE')).toBeNull();
    expect(suggestCodes('E_ASET_INVALID')[0]).toBe('E_ASSET_INVALID');
    expect(suggestCodes('clipped')).toContain('W_FRAME_CLIPPED');
  });
});

describe('shell completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'td2d-completion-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // A stand-in for td2d that answers `asset list --ids` the way a project would.
  const stub =
    'td2d() { if [ "$1 $2 $3" = "asset list --ids" ]; then printf "props/crate\\nprops/barrel\\ncharacters/knight\\n"; fi; }';

  /** Complete `words` (the last one being typed) with the generated script in a real shell. */
  function complete(shell: 'bash' | 'zsh', words: string[]): string[] {
    const file = join(dir, `td2d.${shell}`);
    writeFileSync(file, completionScript(buildProgram(), shell));
    const call = `COMP_WORDS=(${words.map((w) => `'${w}'`).join(' ')}); COMP_CWORD=${words.length - 1}; COMPREPLY=(); _td2d; printf '%s\\n' "\${COMPREPLY[@]}"`;
    const script =
      shell === 'bash'
        ? `${stub}\nsource '${file}'\n${call}`
        : // zsh runs bash completion functions under sh emulation, and filters the words itself.
          `${stub}\nsource '${file}'\nt() { emulate -L sh; ${call}; }\nt`;
    const out = execFileSync(shell, shell === 'zsh' ? ['-f', '-c', script] : ['-c', script], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  }

  it('completes commands, subcommands, options, option values and asset ids in bash', () => {
    expect(complete('bash', ['td2d', 'gen'])).toEqual(['generate']);
    expect(complete('bash', ['td2d', 'history', ''])).toEqual(['list', 'show', 'prune']);
    expect(complete('bash', ['td2d', 'generate', 'props/'])).toEqual(['props/crate', 'props/barrel']);
    expect(complete('bash', ['td2d', 'preview', 'x', '--layout', ''])).toEqual(['sheet', 'ring']);
    expect(complete('bash', ['td2d', 'viewer', '--no-w'])).toEqual(['--no-watch']);
    expect(complete('bash', ['td2d', 'history', 'show', ''])).toEqual([
      'props/crate',
      'props/barrel',
      'characters/knight',
    ]);
    expect(complete('bash', ['td2d', 'explain', '--l'])).toEqual(['--list', '--log-level']);
  });

  // Runs wherever zsh is installed, and always on CI, which installs it (a missing zsh fails there).
  const hasZsh = spawnSync('zsh', ['--version']).status === 0;
  it.runIf(hasZsh || Boolean(process.env.CI))('offers the same words in zsh', () => {
    expect(complete('zsh', ['td2d', 'gen'])).toContain('generate');
    expect(complete('zsh', ['td2d', 'cache', ''])).toEqual(['stats', 'clean']);
    expect(complete('zsh', ['td2d', 'inspect', ''])).toEqual(['props/crate', 'props/barrel', 'characters/knight']);
  });

  it('writes a fish script with every command, option and asset id completion', () => {
    const fish = completionScript(buildProgram(), 'fish');
    for (const c of commandHelp(buildProgram())) expect(fish, c.name).toContain(`-a ${c.name.split(' ').at(-1)}`);
    expect(fish).toContain("-l watch-mode -x -a 'native poll'");
    expect(fish).toContain("-a '(td2d asset list --ids 2>/dev/null)'");
    const which = spawnSync('fish', ['--version']);
    if (which.status === 0) {
      // Where fish is installed (CI installs it), check the script parses.
      const file = join(dir, 'td2d.fish');
      writeFileSync(file, fish);
      expect(spawnSync('fish', ['--no-execute', file]).status).toBe(0);
    }
  });
});
