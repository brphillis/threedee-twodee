import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Td2dError } from '../errors.ts';

/** Convert a platform path to forward slashes for ids, messages and metadata. */
export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function nearestExisting(p: string): string {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Resolve `p` against `root` and guarantee the result stays inside `root`,
 * including after following symlinks of the parts that already exist.
 */
export function resolveInside(root: string, p: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, p);
  if (!isInside(absoluteRoot, target)) {
    throw new Td2dError('E_PATH_OUTSIDE_PROJECT', `Path "${p}" resolves outside the project root.`, {
      details: { path: p, root: absoluteRoot },
    });
  }
  const realRoot = realpathSync(nearestExisting(absoluteRoot));
  const existing = nearestExisting(target);
  const realExisting = realpathSync(existing);
  if (!isInside(realRoot, realExisting)) {
    throw new Td2dError('E_PATH_OUTSIDE_PROJECT', `Path "${p}" leaves the project root through a symlink.`, {
      details: { path: p, root: absoluteRoot, resolved: realExisting },
    });
  }
  return target;
}

/** Path relative to `root` with forward slashes, for messages and metadata. */
export function relativePosix(root: string, p: string): string {
  return toPosix(relative(root, p)) || '.';
}
