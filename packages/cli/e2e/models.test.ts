import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { probeModelGlb } from '@td2d/core';
import { describe, expect, it } from 'vitest';
import { run, runJson, tempDir } from './helpers.ts';

const PROPS = join(import.meta.dirname, '..', '..', '..', 'examples', 'props');

async function project(): Promise<string> {
  const root = join(tempDir(), 'game');
  expect((await run(['init', root], { cwd: tempDir() })).exitCode).toBe(0);
  return root;
}

function writeAsset(root: string, id: string, asset: Record<string, unknown>): void {
  mkdirSync(join(root, 'assets', id), { recursive: true });
  writeFileSync(
    join(root, 'assets', id, 'asset.json'),
    JSON.stringify({ schemaVersion: '1.0.0', type: 'prop', ...asset }),
  );
}

describe('td2d asset emit', () => {
  it('reproduces the committed barrel definition from its script', async () => {
    const { exitCode, stdout } = await run(['asset', 'emit', 'scripts/barrel.ts', '--print'], { cwd: PROPS });
    expect(exitCode).toBe(0);
    expect(stdout).toBe(readFileSync(join(PROPS, 'assets/props/barrel/asset.json'), 'utf8'));
    const again = await runJson(['asset', 'emit', 'scripts/barrel.ts'], { cwd: PROPS });
    expect(again.envelope.data).toMatchObject({
      id: 'props/barrel',
      file: 'assets/props/barrel/asset.json',
      changed: false,
    });
  });

  it('resolves @td2d/core/sdk from td2d itself when the project does not install it', async () => {
    // A project outside the repository has no node_modules: as after npm install -g.
    const root = await project();
    writeFileSync(
      join(root, 'slab.ts'),
      "import { box, defineAsset } from '@td2d/core/sdk';\nexport default defineAsset({ id: 'props/slab', type: 'prop', model: { parts: [box({ id: 'b', material: 'm', size: [1, 0.2, 1] })] } });",
    );
    const emitted = await runJson(['asset', 'emit', 'slab.ts', '--print'], { cwd: root });
    expect(emitted.exitCode, emitted.stderr).toBe(0);
    expect((emitted.envelope.data as { definition: { id: string } }).definition.id).toBe('props/slab');
    // A missing package that is not td2d's still fails as the script wrote it.
    writeFileSync(join(root, 'other.ts'), "import 'not-a-package';\nexport default {};");
    const missing = await runJson(['asset', 'emit', 'other.ts'], { cwd: root });
    expect([missing.exitCode, missing.envelope.error?.code]).toEqual([3, 'E_SCRIPT_FAILED']);
    expect(JSON.stringify(missing.envelope.error)).toMatch(/not-a-package/);
  });

  it('writes a new asset, refuses to overwrite a different file, and replaces it with --overwrite', async () => {
    const root = await project();
    writeFileSync(
      join(root, 'thing.ts'),
      "export default { id: 'props/thing', type: 'prop', model: { parts: [{ type: 'box', id: 'b', material: 'm', size: [1, 1, 1] }] } };",
    );
    expect((await runJson(['asset', 'emit', 'thing.ts'], { cwd: root })).envelope.data).toMatchObject({
      file: 'assets/props/thing/asset.json',
      changed: true,
    });
    writeFileSync(
      join(root, 'thing.ts'),
      "export default () => ({ id: 'props/thing', type: 'prop', model: { parts: [{ type: 'box', id: 'b', material: 'm', size: [2, 1, 1] }] } });",
    );
    const refused = await runJson(['asset', 'emit', 'thing.ts'], { cwd: root });
    expect([refused.exitCode, refused.envelope.error?.code]).toEqual([2, 'E_ASSET_EXISTS']);
    expect((await runJson(['asset', 'emit', 'thing.ts', '--overwrite'], { cwd: root })).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'assets/props/thing/asset.json'), 'utf8')).model.parts[0].size).toEqual([
      2, 1, 1,
    ]);
  });

  it('does not let scripts write files, read outside the project, use the network or start processes, and reports invalid output with paths', async () => {
    const root = await project();
    const outside = tempDir();
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    // A local server a script must not reach.
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end('reached');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    const scripts: [string, string, RegExp][] = [
      [
        'fetch.ts',
        `export default async () => ({ page: await (await fetch('http://127.0.0.1:${port}/')).text() });`,
        /tried to use the network/,
      ],
      [
        'socket.ts',
        `import { connect } from 'node:net';\nconnect(${port}, '127.0.0.1');\nexport default {};`,
        /tried to use the network/,
      ],
      [
        'http.ts',
        `import { get } from 'node:http';\nget('http://127.0.0.1:${port}/');\nexport default {};`,
        /tried to use the network/,
      ],
      [
        'write.ts',
        "import { writeFileSync } from 'node:fs';\nwriteFileSync('pwned.txt', 'x');\nexport default {};",
        /tried to write .*pwned\.txt/,
      ],
      [
        'escape.ts',
        `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(outside, 'pwned.txt'))}, 'x');\nexport default {};`,
        /tried to write/,
      ],
      [
        'read.ts',
        `import { readFileSync } from 'node:fs';\nexport default { secret: readFileSync(${JSON.stringify(join(outside, 'secret.txt'))}, 'utf8') };`,
        /tried to read .*secret\.txt/,
      ],
      [
        'spawn.ts',
        "import { execSync } from 'node:child_process';\nexecSync('touch pwned.txt');\nexport default {};",
        /tried to start a process/,
      ],
      [
        'worker.ts',
        "import { Worker } from 'node:worker_threads';\nnew Worker('setTimeout(() => {}, 10)', { eval: true });\nexport default {};",
        /tried to start a worker thread/,
      ],
    ];
    for (const [file, source, message] of scripts) {
      writeFileSync(join(root, file), source);
      const result = await runJson(['asset', 'emit', file, '--id', 'props/x'], { cwd: root });
      expect([result.exitCode, result.envelope.error?.code], file).toEqual([3, 'E_SCRIPT_PERMISSION']);
      expect(result.envelope.error?.message, file).toMatch(message);
    }
    expect(() => readFileSync(join(root, 'pwned.txt'))).toThrow();
    expect(() => readFileSync(join(outside, 'pwned.txt'))).toThrow();
    expect(() => readFileSync(join(root, 'assets/props/x/asset.json'))).toThrow();
    expect(hits).toBe(0);
    server.close();
    writeFileSync(join(root, 'bad.ts'), "export default { id: 'props/bad', type: 'prop', model: { parts: [] } };");
    const bad = await runJson(['asset', 'emit', 'bad.ts'], { cwd: root });
    expect(bad.envelope.error?.issues?.[0]).toMatchObject({ file: 'bad.ts', path: 'model.parts' });
  });

  it('stops a script that never finishes, and one that runs out of memory', async () => {
    const root = await project();
    writeFileSync(join(root, 'loop.ts'), 'while (true) {}\nexport default {};');
    const started = Date.now();
    const loop = await runJson(['asset', 'emit', 'loop.ts', '--id', 'props/x', '--timeout', '1500'], { cwd: root });
    expect([loop.exitCode, loop.envelope.error?.code]).toEqual([3, 'E_SCRIPT_FAILED']);
    expect(loop.envelope.error?.message).toMatch(/did not finish within 1\.5 s/);
    expect(Date.now() - started).toBeLessThan(10_000);
    writeFileSync(
      join(root, 'hog.ts'),
      'const keep = [];\nfor (;;) keep.push(new Array(1e6).fill(1.5));\nexport default {};',
    );
    const hog = await runJson(['asset', 'emit', 'hog.ts', '--id', 'props/x'], { cwd: root });
    expect([hog.exitCode, hog.envelope.error?.code]).toEqual([3, 'E_SCRIPT_FAILED']);
    expect(hog.envelope.error?.message).toMatch(/ran out of memory/);
  }, 120_000);
});

describe('model errors and warnings', () => {
  it('rejects a non-manifold CSG operand by id with exit code 3', async () => {
    const root = await project();
    writeAsset(root, 'props/bad-csg', {
      materials: { m: { color: '#888888' } },
      model: {
        parts: [
          {
            type: 'csg',
            id: 'block',
            op: 'subtract',
            parts: [
              { type: 'box', id: 'body', material: 'm', size: [1, 1, 1] },
              { type: 'plane', id: 'sheet', material: 'm', size: [2, 2] },
            ],
          },
        ],
      },
    });
    const { exitCode, envelope } = await runJson(['validate', 'props/bad-csg', '--stage', 'model'], { cwd: root });
    expect(exitCode).toBe(3);
    expect(envelope.error?.code).toBe('E_PART_NOT_MANIFOLD');
    expect(envelope.error?.message).toMatch(/"sheet"/);
  });

  it('reports component cycles with exit code 3', async () => {
    const root = await project();
    mkdirSync(join(root, 'components'));
    writeFileSync(
      join(root, 'components/loop.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        name: 'loop',
        parts: [{ type: 'component', id: 'again', component: 'loop' }],
      }),
    );
    writeAsset(root, 'props/loop', {
      materials: {},
      model: { parts: [{ type: 'component', id: 'start', component: 'loop' }] },
    });
    const { exitCode, envelope } = await runJson(['validate', 'props/loop'], { cwd: root });
    expect([exitCode, envelope.error?.code]).toEqual([3, 'E_COMPONENT_CYCLE']);
  });

  it('warns with measured bounds when an imported model is larger than the frame', async () => {
    const root = await project();
    mkdirSync(join(root, 'assets/props/huge'), { recursive: true });
    writeFileSync(join(root, 'assets/props/huge/cube.glb'), await probeModelGlb());
    writeAsset(root, 'props/huge', {
      materials: { m: { color: '#888888' } },
      model: { parts: [{ type: 'import', id: 'cube', src: 'cube.glb', material: 'm', units: 8 }] },
    });
    const { exitCode, envelope } = await runJson(['validate', 'props/huge', '--stage', 'model'], { cwd: root });
    expect(exitCode).toBe(0);
    const warning = envelope.warnings.find((w) => w.code === 'W_MODEL_OUT_OF_FRAME');
    expect(warning?.message).toMatch(/32 x 32 frame in 4 direction\(s\)\. In direction s it spans \d+ x \d+ px/);
  });

  it('describes every part type and the component schema', async () => {
    const { envelope } = await runJson(['describe'], { cwd: tempDir() });
    expect((envelope.data as { partTypes: { type: string }[] }).partTypes.map((p) => p.type)).toHaveLength(14);
    expect((await runJson(['schema', 'component'], { cwd: tempDir() })).exitCode).toBe(0);
  });
});
