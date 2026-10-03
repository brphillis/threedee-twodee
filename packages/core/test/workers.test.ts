import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

/** Every module a file imports, following relative and @td2d imports through the sources. */
function importGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^(?:import|export)[^'"]*?from\s+'([^']+)'/gm)) {
      const spec = match[1] as string;
      if (/^import\s+type\s/.test(match[0]) || /^export\s+type\s/.test(match[0])) continue;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (spec === '@td2d/schema' || spec.startsWith('@td2d/schema/')) continue;
      else
        packages.add(
          spec.startsWith('node:')
            ? spec
            : spec
                .split('/')
                .slice(0, spec.startsWith('@') ? 2 : 1)
                .join('/'),
        );
    }
  };
  visit(entry);
  return { files, packages };
}

describe('worker threads', () => {
  it('load no native modules', () => {
    // Native addons such as sharp (libvips) can crash the process when a worker thread exits.
    const { packages } = importGraph(join(SRC, 'workers', 'worker.ts'));
    for (const native of ['sharp', 'playwright', 'manifold-3d', 'gltf-validator'])
      expect(packages.has(native), native).toBe(false);
    expect([...packages].filter((p) => !p.startsWith('node:'))).toEqual(['maxrects-packer']);
  });
});
