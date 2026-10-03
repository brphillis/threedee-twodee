// Negative tests for inputs td2d must refuse cleanly: a typed error, never a crash or a write.
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetLocation,
  buildModel,
  generateAssets,
  glbHeaderProblem,
  jsonDepth,
  loadAsset,
  loadLibrary,
  loadProject,
  MAX_IMPORT_BYTES,
  MAX_JSON_DEPTH,
  readGlb,
  readJsonFile,
  renderGlbToDir,
  resolveAsset,
  resolveInside,
  type Td2dError,
} from '../src/index.ts';
import { CRATE, makeProject, tempDir, writeJson } from './helpers/tmp.ts';

async function failure(work: () => unknown): Promise<Td2dError> {
  try {
    await work();
  } catch (error) {
    return error as Td2dError;
  }
  throw new Error('expected a failure');
}

const importAsset = (src: string) => ({
  ...CRATE,
  materials: { wood: { color: '#a0693a' } },
  model: { parts: [{ type: 'import', id: 'thing', src, material: 'wood' }] },
});

/** Resolve and build props/crate in a project, as generate's first stages do. */
async function build(root: string) {
  const project = loadProject(root);
  const { asset } = resolveAsset(project, loadAsset(project, 'props/crate'), loadLibrary(project));
  return buildModel(asset, { projectRoot: root });
}

describe('paths', () => {
  it('refuses imports that climb out of the project, directly or through a symlink', async () => {
    const outside = tempDir();
    writeFileSync(join(outside, 'model.glb'), 'glTF');
    const climbing = makeProject({}, importAsset('../../../../model.glb'));
    const e1 = await failure(() => build(climbing));
    expect(e1.code).toBe('E_IMPORT_FAILED');
    expect(e1.issues?.[0]).toMatchObject({
      path: 'model.parts[0].src',
      message: expect.stringMatching(/outside the project/),
    });

    const linked = makeProject({}, importAsset('escape/model.glb'));
    symlinkSync(outside, join(linked, 'assets', 'props', 'crate', 'escape'));
    const e2 = await failure(() => build(linked));
    expect(e2.code).toBe('E_IMPORT_FAILED');
    expect(e2.issues?.[0]?.message).toMatch(/outside the project/);
    expect(() => resolveInside(linked, 'assets/props/crate/escape/model.glb')).toThrow(/symlink/);
  });

  it('refuses asset ids that are not paths below assets/', () => {
    const project = loadProject(makeProject());
    for (const id of ['../secret', '/etc/passwd', 'props/../../x', 'Props/Crate', 'props//crate']) {
      expect(() => assetLocation(project, id), id).toThrow(/not a valid asset id/);
      expect(() => loadAsset(project, id), id).toThrow(/not a valid asset id/);
    }
  });
});

describe('GLB files', () => {
  it('rejects an import larger than 50 MB before reading it', async () => {
    const root = makeProject({}, importAsset('big.glb'));
    const file = join(root, 'assets', 'props', 'crate', 'big.glb');
    const fd = openSync(file, 'w');
    ftruncateSync(fd, MAX_IMPORT_BYTES + 1);
    closeSync(fd);
    const e = await failure(() => build(root));
    expect(e.code).toBe('E_IMPORT_FAILED');
    expect(e.issues?.[0]?.message).toMatch(/larger than 50 MB/);
  });

  it('names what is wrong with malformed GLBs, for imports and for td2d render', async () => {
    const header = (magic: number, version: number, length: number, chunk = 0x4e4f534a) => {
      const b = Buffer.alloc(Math.max(20, length));
      b.writeUInt32LE(magic, 0);
      b.writeUInt32LE(version, 4);
      b.writeUInt32LE(length, 8);
      b.writeUInt32LE(4, 12);
      b.writeUInt32LE(chunk, 16);
      return b;
    };
    const cases: [string, Uint8Array, RegExp][] = [
      ['empty', new Uint8Array(0), /too short/],
      ['text', Buffer.from('this is not a model, just some text'), /magic/],
      ['version 1', header(0x46546c67, 1, 24), /version 1/],
      ['truncated', header(0x46546c67, 2, 999).subarray(0, 40), /truncated/],
      ['wrong chunk', header(0x46546c67, 2, 24, 0x004e4942), /JSON chunk/],
      [
        'json past end',
        (() => {
          const b = header(0x46546c67, 2, 24);
          b.writeUInt32LE(9999, 12);
          return b;
        })(),
        /past the end/,
      ],
    ];
    for (const [name, bytes, message] of cases) {
      expect(glbHeaderProblem(bytes), name).toMatch(message);
      await expect(readGlb(bytes), name).rejects.toThrow(message);
      const root = makeProject({}, importAsset('bad.glb'));
      writeFileSync(join(root, 'assets', 'props', 'crate', 'bad.glb'), bytes);
      const e = await failure(() => build(root));
      expect([e.code, name]).toEqual(['E_IMPORT_FAILED', name]);
      const out = join(tempDir(), 'frames');
      const glbPath = join(root, 'assets', 'props', 'crate', 'bad.glb');
      const r = await failure(() => renderGlbToDir({ glbPath, outDir: out } as never));
      expect([r.code, name]).toEqual(['E_MODEL_INVALID', name]);
      expect(existsSync(out) ? readdirSync(out) : [], `${name} wrote nothing`).toEqual([]);
    }
  });
});

describe('JSON documents', () => {
  it('measures nesting without counting brackets inside strings', () => {
    expect(jsonDepth('{"a":[1,{"b":"[[[["}]}')).toBe(3);
    expect(jsonDepth('"\\\\"')).toBe(0);
  });

  it('rejects deeply nested JSON with a typed error instead of overflowing the stack', () => {
    const root = tempDir();
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    writeFileSync(join(root, 'deep.json'), deep);
    try {
      readJsonFile(join(root, 'deep.json'), 'deep.json');
      throw new Error('accepted');
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_JSON_PARSE');
      expect((error as Td2dError).message).toMatch(new RegExp(`more than ${MAX_JSON_DEPTH}`));
    }
    const project = makeProject();
    writeFileSync(
      join(project, 'assets/props/crate/asset.json'),
      `{"schemaVersion":"1.0.0","type":"prop","model":${'{"a":'.repeat(200)}1${'}'.repeat(200)}}`,
    );
    expect(() => loadAsset(loadProject(project), 'props/crate')).toThrow(/levels deep/);
  });

  it('rejects oversized JSON before parsing it', () => {
    const root = tempDir();
    const fd = openSync(join(root, 'huge.json'), 'w');
    ftruncateSync(fd, 9 * 1024 * 1024);
    closeSync(fd);
    expect(() => readJsonFile(join(root, 'huge.json'), 'huge.json')).toThrow(/larger than/);
  });

  it('restricts preset and palette names to kebab-case, so a name cannot be a path', () => {
    const root = makeProject();
    writeJson(root, 'assets/props/crate/asset.json', { ...CRATE, camera: '../../etc/passwd' });
    const project = loadProject(root);
    expect(() => loadAsset(project, 'props/crate')).toThrow(/problem/);
    mkdirSync(join(root, 'palettes'), { recursive: true });
    writeJson(root, 'palettes/evil.json', { schemaVersion: '1.0.0', name: '../evil', colors: ['#000000'] });
    expect(loadLibrary(loadProject(root)).invalid.palettes).toBe(true);
  });
});

describe('resource limits', () => {
  it('stops an asset that runs past its time limit with E_ASSET_TIMEOUT', async () => {
    const parts = Array.from({ length: 60 }, (_, i) => ({
      type: 'sphere',
      id: `s${i}`,
      material: 'wood',
      radius: 0.1,
      position: [i * 0.01, 0.5, 0],
    }));
    const root = makeProject({}, { ...CRATE, materials: { wood: { color: '#a0693a' } }, model: { parts } });
    const e = await failure(() =>
      // Stages check the limit as they go and between each other; plan comes after the model build.
      generateAssets({ project: loadProject(root), to: 'plan', timeoutMs: 1, history: false }),
    );
    expect(e.code, JSON.stringify(e.issues ?? e.message)).toBe('E_ASSET_TIMEOUT');
    expect(e.message).toMatch(/took longer than 0.001 s/);
  });

  it('warns with W_MEMORY_HIGH when memory passes the warning level after a stage', async () => {
    const root = makeProject();
    const [result] = await generateAssets({
      project: loadProject(root),
      to: 'model',
      memoryWarnBytes: 1,
      history: false,
    });
    const warnings = result?.warnings.filter((w) => w.code === 'W_MEMORY_HIGH') ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/MB of memory after the \w+ stage/);
    const [quiet] = await generateAssets({
      project: loadProject(root),
      to: 'model',
      memoryWarnBytes: 1e15,
      history: false,
      force: true,
    });
    expect(quiet?.warnings.some((w) => w.code === 'W_MEMORY_HIGH')).toBe(false);
  });
});
