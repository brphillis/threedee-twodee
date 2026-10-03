import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { ANSI, run, runJson, tempDir } from './helpers.ts';

async function newProject(): Promise<string> {
  const root = join(tempDir(), 'proj');
  const { exitCode } = await run(['init', root], { cwd: tempDir() });
  expect(exitCode).toBe(0);
  return root;
}

describe('td2d init and validate', () => {
  it('creates a project and validates it', async () => {
    const cwd = tempDir();
    const init = await runJson(['init', 'game', '--name', 'Game'], { cwd });
    expect(init.exitCode).toBe(0);
    expect(init.envelope).toMatchObject({ ok: true, command: 'init', data: { name: 'Game', template: 'starter' } });

    const validate = await runJson(['validate'], { cwd: join(cwd, 'game') });
    expect(validate.exitCode).toBe(0);
    expect(validate.envelope.ok).toBe(true);
    expect(validate.envelope.data).toMatchObject({ status: 'pass', summary: { assets: 1, passed: 1, failed: 0 } });
  });

  it('reports a wrongly typed field with its path, a hint and exit code 3', async () => {
    const root = await newProject();
    const file = join(root, 'assets/props/crate/asset.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"width": 32', '"width": "32"'));
    const { exitCode, envelope } = await runJson(['validate'], { cwd: root });
    expect(exitCode).toBe(3);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('E_ASSET_INVALID');
    expect(envelope.error?.issues?.[0]).toMatchObject({
      file: 'assets/props/crate/asset.json',
      path: 'frame.width',
      code: 'invalid_type',
    });
    expect(envelope.error?.hint).toMatch(/td2d schema asset/);
  });

  it('reports JSON syntax errors with a line and column', async () => {
    const root = await newProject();
    writeFileSync(join(root, 'assets/props/crate/asset.json'), '{\n  "type": "prop",,\n}');
    const { exitCode, envelope } = await runJson(['validate', 'props/crate'], { cwd: root });
    expect(exitCode).toBe(3);
    expect(envelope.error?.code).toBe('E_JSON_PARSE');
    expect(envelope.error?.issues?.[0]?.message).toMatch(/line 2, column 18/);
  });

  it('refuses to overwrite files and leaves them untouched', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'README.md'), 'keep me');
    const { exitCode, envelope } = await runJson(['init', '.'], { cwd: root });
    expect(exitCode).toBe(2);
    expect(envelope.error?.code).toBe('E_INIT_CONFLICT');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('keep me');
  });

  it('reports a missing project with exit code 2', async () => {
    const { exitCode, envelope } = await runJson(['validate'], { cwd: tempDir() });
    expect(exitCode).toBe(2);
    expect(envelope.error?.code).toBe('E_PROJECT_NOT_FOUND');
  });

  it('honours --project', async () => {
    const root = await newProject();
    const { exitCode } = await runJson(['--project', root, 'validate'], { cwd: tempDir() });
    expect(exitCode).toBe(0);
  });
});

describe('td2d asset', () => {
  it('creates, lists and shows assets', async () => {
    const root = await newProject();
    const created = await runJson(['asset', 'create', 'characters/hero', '--template', 'character-blockout'], {
      cwd: root,
    });
    expect(created.envelope).toMatchObject({
      ok: true,
      command: 'asset create',
      data: { file: 'assets/characters/hero/asset.json' },
    });

    const list = await runJson(['asset', 'list'], { cwd: root });
    expect((list.envelope.data as { assets: { id: string }[] }).assets.map((a) => a.id)).toEqual([
      'characters/hero',
      'props/crate',
    ]);

    const show = await runJson(['asset', 'show', 'characters/hero'], { cwd: root });
    const asset = (show.envelope.data as { asset: { frame: unknown; directions: unknown[] } }).asset;
    expect(asset.frame).toEqual({ width: 32, height: 48 });
    expect(asset.directions).toHaveLength(8);

    const again = await runJson(['asset', 'create', 'characters/hero'], { cwd: root });
    expect(again.exitCode).toBe(2);
    expect(again.envelope.error?.code).toBe('E_ASSET_EXISTS');
  });
});

describe('td2d schema and describe', () => {
  it('prints a JSON Schema that independently validates the starter asset', async () => {
    const root = await newProject();
    const { exitCode, stdout } = await run(['schema', 'asset'], { cwd: root });
    expect(exitCode).toBe(0);
    const ajv = new Ajv2020.default({ strict: false });
    const validate = ajv.compile(JSON.parse(stdout));
    const crate = JSON.parse(readFileSync(join(root, 'assets/props/crate/asset.json'), 'utf8'));
    expect(validate(crate), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...crate, frame: { width: '32', height: 32 } })).toBe(false);
  });

  it('lists schemas and rejects unknown names', async () => {
    const cwd = tempDir();
    const list = await runJson(['schema', '--list'], { cwd });
    expect((list.envelope.data as { schemas: { name: string }[] }).schemas.map((s) => s.name)).toContain('asset');
    const missing = await runJson(['schema', 'nope'], { cwd });
    expect(missing.exitCode).toBe(2);
    expect(missing.envelope.error?.code).toBe('E_SCHEMA_NOT_FOUND');
  });

  it('describes commands, part types, presets and error codes', async () => {
    const { envelope } = await runJson(['describe'], { cwd: tempDir() });
    const data = envelope.data as {
      cli: { commands: { name: string }[] };
      partTypes: { type: string }[];
      errors: { code: string }[];
    };
    expect(data.cli.commands.map((c) => c.name)).toEqual([
      'init',
      'doctor',
      'schema',
      'describe',
      'validate',
      'asset list',
      'asset show',
      'asset emit',
      'asset create',
      'generate',
      'batch',
      'model build',
      'model inspect',
      'rig list',
      'rig show',
      'process',
      'sheet',
      'export',
      'render',
      'inspect',
      'preview',
      'history list',
      'history show',
      'history prune',
      'cache stats',
      'cache clean',
      'compare',
      'viewer',
      'index',
      'explain',
      'completion',
    ]);
    expect(data.partTypes.map((p) => p.type)).toContain('box');
    expect(data.errors.map((e) => e.code)).toContain('E_BROWSER_MISSING');
  });
});

describe('td2d doctor', () => {
  it('passes on a working machine', async () => {
    const { exitCode, envelope } = await runJson(['doctor'], { cwd: await newProject() });
    const checks = (envelope.data as { checks: { id: string; status: string }[] }).checks;
    expect(checks.map((c) => c.id)).toEqual([
      'node',
      'project',
      'write',
      'sharp',
      'manifold',
      'browser',
      'headless-gl',
    ]);
    expect(exitCode, JSON.stringify(checks)).toBe(0);
  });

  it('exits 7 with a fix hint when the browser is missing', async () => {
    const empty = tempDir();
    const { exitCode, envelope, stderr } = await runJson(['doctor'], {
      cwd: tempDir(),
      env: { PLAYWRIGHT_BROWSERS_PATH: empty },
    });
    expect(exitCode).toBe(7);
    expect(envelope.error?.code).toBe('E_BROWSER_MISSING');
    expect(envelope.error?.hint).toMatch(/td2d doctor --fix/);
    const checks = (envelope.data as { checks: { id: string; status: string }[] }).checks;
    expect(checks.find((c) => c.id === 'project')?.status).toBe('skip');
    expect(checks.map((c) => c.id)).toEqual([
      'node',
      'project',
      'write',
      'sharp',
      'manifold',
      'browser',
      'headless-gl',
    ]);
    // stderr is NDJSON progress
    const events = stderr
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events[0]).toMatchObject({ event: 'stage:start', stage: 'doctor', total: 7 });
    expect(events.at(-1)).toMatchObject({ event: 'stage:done', stage: 'doctor' });
  });
});

describe('agent-facing output conventions', () => {
  it('prints no ANSI escape codes when not attached to a terminal', async () => {
    const root = await newProject();
    writeFileSync(join(root, 'assets/props/crate/asset.json'), '{}');
    for (const args of [['validate'], ['describe'], ['asset', 'list'], ['nope']]) {
      const { stdout, stderr } = await run(args, { cwd: root });
      expect(ANSI.test(stdout), `${args} stdout`).toBe(false);
      expect(ANSI.test(stderr), `${args} stderr`).toBe(false);
    }
  });

  it('reports usage errors as an envelope with exit code 2', async () => {
    const cwd = tempDir();
    const unknown = await runJson(['valdate'], { cwd });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.envelope.error?.code).toBe('E_USAGE');
    expect(unknown.envelope.error?.message).toMatch(/Did you mean validate/);

    const badChoice = await runJson(['validate', '--stage', 'everything'], { cwd });
    expect(badChoice.exitCode).toBe(2);
    expect(badChoice.envelope.error?.code).toBe('E_USAGE');
  });

  it('keeps human results on stdout and errors on stderr', async () => {
    const { stdout, stderr, exitCode } = await run(['validate'], { cwd: tempDir() });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/error \[E_PROJECT_NOT_FOUND\]/);
    expect(stderr).toMatch(/hint/);
  });

  it('prints the version and help with exit code 0', async () => {
    const cwd = tempDir();
    const version = await run(['--version'], { cwd });
    expect(version).toMatchObject({ exitCode: 0, stdout: `${pkg.version}\n` });
    const help = await run(['validate', '--help'], { cwd });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toMatch(/Examples:/);
  });
});
