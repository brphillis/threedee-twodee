// Packs every publishable package, installs the tarballs with npm into an empty directory, and
// runs td2d from there: doctor, init, generate, preview, validate, asset emit and index. Then installs them
// again with `npm install -g` into a temporary prefix and, through the installed `td2d` command
// (the bin shim, td2d.cmd on Windows), runs doctor --fix, init, generate, an edit and a second
// generate, compare, batch, asset emit and the live viewer. Last, `npx td2d` (npm exec with the
// tarballs as its packages) runs doctor --fix, init and generate. CI runs it on Linux, macOS and
// Windows (`pnpm pack:smoke`), so what is published works without this repository.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const PACKAGES = ['packages/schema', 'packages/render-harness', 'packages/core', 'apps/viewer', 'packages/cli'];
const work = mkdtempSync(join(tmpdir(), 'td2d-pack-'));
const tarballs = join(work, 'tarballs');
const consumer = join(work, 'consumer');
mkdirSync(tarballs);
mkdirSync(consumer);
const windows = process.platform === 'win32';

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', shell: windows, stdio: ['ignore', 'pipe', 'inherit'] });
}

function parseEnvelope(args: string[], out: string): Record<string, unknown> {
  const envelope = JSON.parse(out) as { ok: boolean; data?: Record<string, unknown>; error?: unknown };
  if (!envelope.ok) throw new Error(`td2d ${args.join(' ')} failed: ${JSON.stringify(envelope.error)}`);
  return envelope.data ?? {};
}

/** A small SDK script, as a user would write it, for `td2d asset emit`. */
const EMIT_SCRIPT = `import { box, defineAsset } from '@td2d/core/sdk';
export default defineAsset({
  id: 'props/emitted',
  type: 'prop',
  directions: 'd4',
  materials: { stone: { color: '#8a8f99' } },
  model: { parts: [box({ id: 'block', material: 'stone', size: [1, 0.5, 1], position: [0, 0.25, 0] })] },
});
`;

/** Write the SDK script into a project and check what `td2d asset emit` wrote from it. */
function checkEmit(project: string, emit: (args: string[]) => Record<string, unknown>): void {
  mkdirSync(join(project, 'scripts'), { recursive: true });
  writeFileSync(join(project, 'scripts', 'emitted.ts'), EMIT_SCRIPT);
  emit(['asset', 'emit', 'scripts/emitted.ts']);
  const written = JSON.parse(readFileSync(join(project, 'assets', 'props', 'emitted', 'asset.json'), 'utf8')) as {
    id: string;
  };
  if (written.id !== 'props/emitted') throw new Error(`asset emit wrote ${JSON.stringify(written)}`);
}

/** Run the locally installed td2d with --json and return the envelope's data, failing on a non-zero exit. */
function td2d(args: string[], cwd: string): Record<string, unknown> {
  const bin = join(consumer, 'node_modules', '@td2d', 'cli', 'dist', 'main.js');
  const out = execFileSync(process.execPath, [bin, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseEnvelope(args, out);
}

/** The environment a shell has after `npm install -g --prefix <prefix>`: its bin directory on PATH. */
function globalEnv(prefix: string): NodeJS.ProcessEnv {
  const binDir = windows ? prefix : join(prefix, 'bin');
  return { ...process.env, PATH: `${binDir}${windows ? ';' : ':'}${process.env.PATH ?? ''}` };
}

const TD2D_COMMAND = windows ? 'td2d.cmd' : 'td2d';

/** Run the globally installed `td2d` command, as a shell would find it on PATH. */
function globalTd2d(prefix: string, args: string[], cwd: string): Record<string, unknown> {
  const out = execFileSync(TD2D_COMMAND, [...args, '--json'], {
    cwd,
    encoding: 'utf8',
    shell: windows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: globalEnv(prefix),
  });
  return parseEnvelope(args, out);
}

/** Start `td2d viewer` from the global install, read its index over HTTP, and stop it. */
async function checkViewer(prefix: string, cwd: string): Promise<string[]> {
  const child = spawn(TD2D_COMMAND, ['viewer', '--port', '0', '--json'], {
    cwd,
    shell: windows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: globalEnv(prefix),
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let err = '';
      const timer = setTimeout(() => reject(new Error(`td2d viewer printed no URL: ${err}`)), 30_000);
      child.stderr?.on('data', (chunk: Buffer) => {
        err += chunk.toString();
        const match = /"url":"(http:\/\/[^"]+)"/.exec(err);
        if (match) {
          clearTimeout(timer);
          resolve(match[1] as string);
        }
      });
      child.on('exit', (code) => reject(new Error(`td2d viewer exited with ${code}: ${err}`)));
    });
    const index = (await (await fetch(new URL('api/index', url))).json()) as { assets: { id: string }[] };
    const page = await (await fetch(url)).text();
    if (!page.includes('<div id="root">')) throw new Error('The viewer page has no app root.');
    return index.assets.map((a) => a.id);
  } finally {
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve(undefined);
      else child.once('exit', resolve);
    });
    // With a shell, kill() would stop only cmd.exe on Windows and leave the viewer running,
    // holding files in the temporary directory: stop the whole process tree there.
    if (windows && child.pid !== undefined) {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // The tree had already exited.
      }
    } else child.kill();
    await exited;
  }
}

try {
  // pnpm replaces workspace: versions with real ones in the packed package.json.
  const pnpm = process.env.npm_execpath;
  for (const dir of PACKAGES) {
    if (pnpm?.endsWith('.js'))
      execFileSync(process.execPath, [pnpm, 'pack', '--pack-destination', tarballs], {
        cwd: join(repo, dir),
        stdio: 'ignore',
      });
    else run('pnpm', ['pack', '--pack-destination', tarballs], join(repo, dir));
  }
  const files = readdirSync(tarballs).filter((f) => f.endsWith('.tgz'));
  if (files.length !== PACKAGES.length)
    throw new Error(`Expected ${PACKAGES.length} tarballs, got ${files.join(', ')}`);
  for (const f of files)
    process.stdout.write(`packed ${f} (${Math.round(statSync(join(tarballs, f)).size / 1024)} KB)\n`);

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'td2d-smoke', private: true, type: 'module' }));
  run('npm', ['install', '--no-audit', '--no-fund', ...files.map((f) => join(tarballs, f))], consumer);

  // No package downloads a browser at install time.
  const browsers = join(consumer, 'node_modules', 'playwright-core', '.local-browsers');
  if (existsSync(browsers)) throw new Error('A browser was downloaded during npm install.');

  const doctor = td2d(['doctor'], consumer) as { checks: { id: string; status: string }[] };
  process.stdout.write(`doctor: ${doctor.checks.map((c) => `${c.id} ${c.status}`).join(', ')}\n`);
  td2d(['init', 'sprites'], consumer);
  const project = join(consumer, 'sprites');
  const generated = td2d(['generate', 'props/crate'], project) as {
    results: { status: string; outputs: Record<string, string> }[];
  };
  const result = generated.results[0];
  if (result?.status !== 'ok') throw new Error(`generate: ${JSON.stringify(result)}`);
  for (const key of ['sheet', 'manifest']) {
    const file = join(project, result.outputs[key] as string);
    if (!existsSync(file)) throw new Error(`${key} was not written: ${file}`);
  }
  td2d(['preview', 'props/crate'], project);
  td2d(['validate'], project);
  checkEmit(project, (args) => td2d(args, project));
  td2d(['index'], project);
  if (!existsSync(join(project, 'build', 'index.html'))) throw new Error('td2d index wrote no page.');

  // npm install -g, into a prefix of its own so the machine's global packages are untouched.
  const prefix = join(work, 'global');
  mkdirSync(prefix);
  run(
    'npm',
    ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', ...files.map((f) => join(tarballs, f))],
    work,
  );
  const shim = windows ? join(prefix, 'td2d.cmd') : join(prefix, 'bin', 'td2d');
  if (!existsSync(shim)) throw new Error(`npm install -g put no td2d command at ${shim}.`);
  const globalDoctor = globalTd2d(prefix, ['doctor', '--fix'], work) as { checks: { id: string; status: string }[] };
  if (globalDoctor.checks.some((c) => c.status === 'fail'))
    throw new Error(`doctor --fix from the global install: ${JSON.stringify(globalDoctor.checks)}`);
  globalTd2d(prefix, ['init', 'global-sprites'], work);
  const globalProject = join(work, 'global-sprites');
  const generate = () => {
    const out = globalTd2d(prefix, ['generate', 'props/crate'], globalProject) as { results: { status: string }[] };
    if (out.results[0]?.status !== 'ok') throw new Error(`generate from the global install: ${JSON.stringify(out)}`);
  };
  generate();
  // Recolour the wood and generate again, so compare has two generations to diff.
  const assetFile = join(globalProject, 'assets', 'props', 'crate', 'asset.json');
  const asset = JSON.parse(readFileSync(assetFile, 'utf8')) as { materials: { wood: { color: string } } };
  asset.materials.wood.color = '#3a6aa0';
  writeFileSync(assetFile, JSON.stringify(asset, null, 2));
  generate();
  const compared = globalTd2d(prefix, ['compare', 'props/crate'], globalProject) as {
    changedCells: number;
    cells: number;
  };
  if (!(compared.changedCells > 0))
    throw new Error(`compare saw no change after a recolour: ${JSON.stringify(compared)}`);
  const batch = globalTd2d(prefix, ['batch'], globalProject) as { report: { status: string } };
  if (batch.report.status !== 'ok') throw new Error(`batch from the global install: ${JSON.stringify(batch.report)}`);
  checkEmit(globalProject, (args) => globalTd2d(prefix, args, globalProject));
  const listed = await checkViewer(prefix, globalProject);
  if (!listed.includes('props/crate')) throw new Error(`The viewer does not list props/crate: ${listed.join(', ')}`);
  process.stdout.write(
    `npm install -g: doctor --fix, init, generate, compare (${compared.changedCells} of ${compared.cells} cells changed), batch, asset emit and viewer ran from ${shim}.\n`,
  );

  // npx, as someone with nothing installed runs it: npm exec with the tarballs as its packages,
  // and an npm cache of its own so the machine's cache is left alone.
  const npxArgs = ['--yes', ...files.map((f) => `--package=${join(tarballs, f)}`), 'td2d'];
  const npx = (args: string[], cwd: string) =>
    parseEnvelope(
      args,
      execFileSync(windows ? 'npx.cmd' : 'npx', [...npxArgs, ...args, '--json'], {
        cwd,
        encoding: 'utf8',
        shell: windows,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_cache: join(work, 'npx-cache') },
      }),
    );
  const npxDoctor = npx(['doctor', '--fix'], work) as { checks: { status: string }[] };
  if (npxDoctor.checks.some((c) => c.status === 'fail'))
    throw new Error(`npx td2d doctor --fix: ${JSON.stringify(npxDoctor)}`);
  npx(['init', 'npx-sprites'], work);
  const npxRun = npx(['generate', 'props/crate'], join(work, 'npx-sprites')) as { results: { status: string }[] };
  if (npxRun.results[0]?.status !== 'ok') throw new Error(`npx td2d generate: ${JSON.stringify(npxRun)}`);
  process.stdout.write('npx td2d: doctor --fix, init and generate ran.\n');
  process.stdout.write(
    `Installed from ${files.length} tarballs, locally, with npm install -g and with npx, and generated a validated sheet on ${process.platform}-${process.arch}.\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
