import { spawn } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AssetDefinition,
  type AssetDefinitionT,
  AssetId,
  CURRENT_INPUT_SCHEMA_VERSION,
  issuesFromZod,
} from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import { formatJson, writeJsonFile } from '../fs/json.ts';
import { relativePosix, toPosix } from '../fs/paths.ts';
import { SCHEMAS_DIR } from '../init.ts';
import { assetLocation } from '../project/assets.ts';
import type { Project } from '../project/project.ts';

export const SCRIPT_TIMEOUT_MS = 30_000;
export const SCRIPT_MEMORY_MB = 512;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface EmitOptions {
  /** Asset id. Defaults to the id in the definition. */
  readonly id?: string;
  /** Write here instead of assets/<id>/asset.json. */
  readonly out?: string;
  readonly overwrite?: boolean;
  /** Return the definition without writing anything. */
  readonly print?: boolean;
  readonly signal?: AbortSignal;
  /** Longest the script may run. Default 30 s. */
  readonly timeoutMs?: number;
}

export interface EmitResult {
  readonly id: string;
  readonly file: string | null;
  readonly definition: AssetDefinitionT;
  readonly text: string;
  readonly changed: boolean;
}

/** This package's root: the file is two levels deep in both src/sdk and dist/sdk. */
const CORE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The directories an asset script may read, by real path: the project, td2d's own package, and
 * every package either of them can import. Node checks permissions against real paths, so a
 * symlinked package (pnpm links everything) needs its target allowed, not just node_modules.
 * Each node_modules directory above a root is allowed, and so is the target of every symlink in
 * it, followed until no new package appears.
 */
export function scriptReadAllowlist(roots: readonly string[]): string[] {
  const allowed: string[] = [];
  const covered = (real: string) => allowed.some((a) => real === a || real.startsWith(`${a}${sep}`));
  const queue: string[] = [];
  const add = (dir: string) => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (covered(real)) return;
    for (let i = allowed.length - 1; i >= 0; i--)
      if ((allowed[i] as string).startsWith(`${real}${sep}`)) allowed.splice(i, 1);
    allowed.push(real);
    queue.push(real);
  };
  const links = (modules: string) => {
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      const full = join(modules, entry.name);
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const scoped of readdirSync(full, { withFileTypes: true }))
          if (scoped.isSymbolicLink()) add(join(full, scoped.name));
      } else if (entry.isSymbolicLink()) add(full);
    }
  };
  for (const root of roots) add(root);
  while (queue.length > 0) {
    let dir = queue.shift() as string;
    for (;;) {
      const modules = join(dir, 'node_modules');
      if (existsSync(modules)) {
        add(modules);
        links(modules);
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return allowed.sort();
}

/**
 * What an ERR_ACCESS_DENIED was about: from the runner's TD2D_ACCESS_DENIED line, or from Node's
 * own report when the script failed before the runner could catch it.
 */
function deniedAccess(stderr: string): { permission: string; resource: string | null } | null {
  const line = /^TD2D_ACCESS_DENIED (.+)$/m.exec(stderr)?.[1];
  if (line) {
    const parsed = JSON.parse(line) as { permission: string | null; resource: string | null };
    return { permission: parsed.permission ?? 'unknown', resource: parsed.resource };
  }
  if (!/ERR_ACCESS_DENIED/.test(stderr)) return null;
  return {
    permission: /permission: '([A-Za-z]+)'/.exec(stderr)?.[1] ?? 'unknown',
    resource: /resource: '([^']+)'/.exec(stderr)?.[1] ?? null,
  };
}

const PERMISSION_WORDS: Record<string, string> = {
  FileSystemRead: 'read',
  FileSystemWrite: 'write',
  ChildProcess: 'start a process',
  WorkerThreads: 'start a worker thread',
  Addon: 'load a native addon',
  WASI: 'use WASI',
  Network: 'use the network',
  Inspector: 'use the inspector',
};

/**
 * Run an asset script in a sandboxed child process and return its JSON output. The script may
 * read the project and import packages, and nothing else: no writes, processes, workers or
 * addons, at most 512 MB of heap, and 30 s by default.
 */
export async function runAssetScript(
  project: Project,
  scriptPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  const fromSource = import.meta.url.endsWith('.ts');
  const runner = fileURLToPath(new URL(`./run-script.${fromSource ? 'ts' : 'js'}`, import.meta.url));
  const display = relativePosix(project.root, scriptPath);
  if (!existsSync(scriptPath)) throw new Td2dError('E_USAGE', `Script ${display} does not exist.`);
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  const reads = scriptReadAllowlist([project.root, CORE_ROOT, dirname(scriptPath)]);
  const args = [
    '--permission',
    ...reads.map((dir) => `--allow-fs-read=${dir}`),
    `--max-old-space-size=${SCRIPT_MEMORY_MB}`,
    ...(fromSource ? ['--conditions=td2d-source'] : []),
    runner,
    scriptPath,
  ];
  const output = await new Promise<string>((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: project.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let stdout = '';
    let stderr = '';
    let reason: 'timeout' | 'output' | null = null;
    const timer = setTimeout(() => {
      reason = 'timeout';
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d;
      if (stdout.length > MAX_OUTPUT_BYTES && reason === null) {
        reason = 'output';
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      if ((e as { name?: string }).name === 'AbortError')
        reject(new Td2dError('E_CANCELLED', `Running ${display} was cancelled.`));
      else reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && reason === null) {
        resolveRun(stdout);
        return;
      }
      const details = { stderr: stderr.trim().split('\n').slice(0, 20).join('\n') };
      if (reason === 'timeout') {
        reject(
          new Td2dError('E_SCRIPT_FAILED', `${display} did not finish within ${timeoutMs / 1000} s and was stopped.`, {
            hint: 'Look for a loop that never ends. Pass --timeout <ms> if the script really needs longer.',
          }),
        );
        return;
      }
      if (reason === 'output') {
        reject(
          new Td2dError(
            'E_SCRIPT_FAILED',
            `${display} printed more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB and was stopped.`,
          ),
        );
        return;
      }
      const denied = deniedAccess(stderr);
      if (denied) {
        const what = PERMISSION_WORDS[denied.permission] ?? denied.permission;
        reject(
          new Td2dError(
            'E_SCRIPT_PERMISSION',
            `${display} tried to ${what}${denied.resource && denied.permission.startsWith('FileSystem') ? ` ${denied.resource}` : ''}, which asset scripts may not do.`,
            {
              details: { ...details, permission: denied.permission, resource: denied.resource },
              hint:
                denied.permission === 'Network'
                  ? 'Asset scripts may not use the network. Download what the script needs into the project first.'
                  : denied.permission === 'FileSystemRead'
                    ? 'Asset scripts may read only the project and the packages they import. Copy the data into the project.'
                    : 'Asset scripts may only compute and return a definition. Return it instead of writing it.',
            },
          ),
        );
        return;
      }
      const outOfMemory = /heap out of memory|Allocation failed/i.test(stderr);
      reject(
        new Td2dError(
          'E_SCRIPT_FAILED',
          outOfMemory
            ? `${display} ran out of memory (the limit is ${SCRIPT_MEMORY_MB} MB).`
            : `${display} failed with exit code ${code}.`,
          {
            details,
            hint: outOfMemory
              ? 'Build less geometry in the script; a sprite cannot show that much detail anyway.'
              : 'Run the script with Node directly to see the full error.',
          },
        ),
      );
    });
  });
  try {
    return JSON.parse(output);
  } catch {
    throw new Td2dError('E_SCRIPT_FAILED', `${display} printed something that is not JSON.`, {
      details: { output: output.slice(0, 200) },
    });
  }
}

/** Run an asset script and write the definition it returns, validated, to the asset's file. */
export async function emitAsset(project: Project, script: string, options: EmitOptions = {}): Promise<EmitResult> {
  const scriptPath = resolve(project.root, script);
  const display = relativePosix(project.root, scriptPath);
  const raw = (await runAssetScript(project, scriptPath, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })) as Record<string, unknown>;
  const id = options.id ?? (typeof raw.id === 'string' ? raw.id : undefined);
  if (!id || !AssetId.safeParse(id).success) {
    throw new Td2dError('E_USAGE', `${display} needs an asset id: set "id" in the definition or pass --id.`);
  }
  const location = assetLocation(project, id);
  const target = options.out ? resolve(project.root, options.out) : location.file;
  const schemaRef = toPosix(relative(join(target, '..'), join(project.root, SCHEMAS_DIR, 'asset.schema.json')));
  const { $schema: _s, schemaVersion: _v, id: _id, ...body } = raw;
  const definition = { $schema: schemaRef, schemaVersion: CURRENT_INPUT_SCHEMA_VERSION, id, ...body };
  const parsed = AssetDefinition.safeParse(definition);
  if (!parsed.success) {
    throw new Td2dError('E_SCRIPT_FAILED', `${display} returned an invalid asset definition.`, {
      file: display,
      issues: issuesFromZod(parsed.error, display, { input: definition, schema: AssetDefinition }),
    });
  }
  const text = formatJson(definition);
  const current = existsSync(target) ? (await import('node:fs')).readFileSync(target, 'utf8') : null;
  const changed = current !== text;
  if (!options.print) {
    if (current !== null && changed && !options.overwrite) {
      throw new Td2dError(
        'E_ASSET_EXISTS',
        `${relativePosix(project.root, target)} already exists and differs from the script output.`,
        { hint: 'Pass --overwrite to replace it, or --print to see the output.' },
      );
    }
    if (changed) writeJsonFile(target, definition);
  }
  return {
    id,
    file: options.print ? null : relativePosix(project.root, target),
    definition: parsed.data,
    text,
    changed,
  };
}
