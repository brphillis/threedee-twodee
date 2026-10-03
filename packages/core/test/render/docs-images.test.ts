import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { tempDir } from '../helpers/tmp.ts';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const IMAGES = join(REPO, 'docs', 'guide', 'images');
/** Written by other tests or by hand: viewer screenshots (viewer e2e) and diagrams. */
const NOT_GENERATED = (rel: string) => rel.startsWith('viewer/') || rel.endsWith('.svg');

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

it('docs/guide/images match what td2d produces now (run `pnpm docs:images` to update)', async () => {
  const out = tempDir('td2d-docs-images-');
  try {
    await promisify(execFile)(process.execPath, ['--conditions=td2d-source', join(REPO, 'scripts', 'docs-images.ts')], {
      env: { ...process.env, TD2D_DOCS_IMAGES_OUT: out },
      maxBuffer: 16 * 1024 * 1024,
    });
    const produced = files(out);
    const committed = files(IMAGES).filter((f) => !NOT_GENERATED(f));
    expect(committed).toEqual(produced);
    const differing = produced.filter((f) => !readFileSync(join(out, f)).equals(readFileSync(join(IMAGES, f))));
    expect(differing).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 300_000);
