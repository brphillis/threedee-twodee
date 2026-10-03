import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh temporary directory removed after each test. */
export function tempDir(prefix = 'td2d-test-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export function writeJson(root: string, rel: string, value: unknown): string {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

export const CRATE = {
  schemaVersion: '1.0.0',
  type: 'prop',
  materials: {
    wood: { color: '#a0693a' },
    iron: { color: '#5b6770', bands: 2 },
  },
  model: {
    parts: [
      { type: 'box', id: 'body', material: 'wood', size: [1, 1, 1], position: [0, 0.5, 0] },
      { type: 'box', id: 'band', material: 'iron', size: [1.04, 0.12, 1.04], position: [0, 0.5, 0] },
    ],
  },
} as const;

/** A minimal project with optional extra config and one crate asset. */
export function makeProject(config: Record<string, unknown> = {}, asset: Record<string, unknown> = CRATE): string {
  const root = tempDir();
  writeJson(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'test', ...config });
  writeJson(root, 'assets/props/crate/asset.json', asset);
  return root;
}
