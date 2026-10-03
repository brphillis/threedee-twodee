import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliEnvelope, type CliEnvelopeT } from '@td2d/schema';
import { x } from 'tinyexec';
import { afterEach } from 'vitest';

export const CLI = join(import.meta.dirname, '..', 'dist', 'main.js');

if (!existsSync(CLI)) throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-e2e-')));
  dirs.push(dir);
  return dir;
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the built CLI like an agent would: non-TTY pipes, no colour forcing. */
export async function run(args: string[], options: { cwd: string; env?: Record<string, string> }): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'FORCE_COLOR' && k !== 'NO_COLOR') env[k] = v;
  const result = await x(process.execPath, [CLI, ...args], {
    nodeOptions: { cwd: options.cwd, env: { ...env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] },
    throwOnError: false,
  });
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Run with --json and parse the single envelope on stdout, checking it against the schema. */
export async function runJson(args: string[], options: { cwd: string; env?: Record<string, string> }) {
  const result = await run([...args, '--json'], options);
  let envelope: CliEnvelopeT;
  try {
    envelope = CliEnvelope.parse(JSON.parse(result.stdout));
  } catch (error) {
    throw new Error(
      `stdout is not one valid envelope (${(error as Error).message}):\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return { ...result, envelope };
}

/** Matches the start of an ANSI escape sequence. */
export const ANSI: { test(text: string): boolean } = { test: (text) => text.includes(`${String.fromCharCode(27)}[`) };
