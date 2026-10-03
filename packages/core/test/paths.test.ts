import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside, Td2dError, toPosix } from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

describe('resolveInside', () => {
  it('resolves relative paths inside the root', () => {
    const root = tempDir();
    expect(resolveInside(root, 'assets/props')).toBe(join(root, 'assets', 'props'));
    expect(resolveInside(root, '.')).toBe(root);
  });

  it.each(['..', '../x', 'a/../../x', '/etc/passwd'])('rejects %s', (p) => {
    const root = tempDir();
    expect(() => resolveInside(root, p)).toThrowError(Td2dError);
    try {
      resolveInside(root, p);
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_PATH_OUTSIDE_PROJECT');
    }
  });

  it('rejects symlinks that leave the root', () => {
    const outside = tempDir();
    const root = tempDir();
    symlinkSync(outside, join(root, 'escape'));
    expect(() => resolveInside(root, 'escape/file.json')).toThrowError(/symlink/);
  });

  it('allows symlinks that stay inside the root', () => {
    const root = tempDir();
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'link'));
    expect(resolveInside(root, 'link/file.json')).toBe(join(root, 'link', 'file.json'));
  });

  it('converts separators for display', () => {
    expect(toPosix('a/b')).toBe('a/b');
  });
});
