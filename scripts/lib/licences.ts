// Licence check for everything td2d's published packages install: the dependency closure as it
// is on disk, optional platform packages included (pnpm's own listing leaves those out).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Licences that may be installed with td2d without review. */
export const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
]);

/** Reviewed exceptions: package name pattern, licence, and why it is acceptable. */
export const EXCEPTIONS: readonly { readonly pattern: RegExp; readonly licence: string; readonly reason: string }[] = [
  {
    pattern: /^@img\/sharp-libvips-/,
    licence: 'LGPL-3.0-or-later',
    reason:
      'The prebuilt libvips that sharp loads as a shared library. td2d neither modifies nor bundles it; it installs as its own package, which the LGPL permits.',
  },
];

export interface InstalledPackage {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly dir: string;
}

export const PUBLISHED = ['packages/schema', 'packages/render-harness', 'packages/core', 'apps/viewer', 'packages/cli'];

function licenceOf(manifest: Record<string, unknown>): string {
  const value = manifest.license ?? manifest.licenses;
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.map((l) => (typeof l === 'string' ? l : (l as { type?: string }).type)).join(' OR ');
  if (value && typeof value === 'object') return String((value as { type?: string }).type ?? 'UNKNOWN');
  return 'UNKNOWN';
}

/** Every package the published packages install, found by resolving their dependencies on disk. */
export function installedClosure(repo: string): InstalledPackage[] {
  const seen = new Map<string, InstalledPackage>();
  const visit = (dir: string, includeWorkspace: boolean) => {
    const real = realpathSync(dir);
    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')) as Record<string, unknown>;
    const name = String(manifest.name);
    const key = `${name}@${String(manifest.version)}`;
    if (seen.has(key)) return;
    if (!name.startsWith('@td2d/') || includeWorkspace)
      seen.set(key, { name, version: String(manifest.version), licence: licenceOf(manifest), dir: real });
    const require = createRequire(join(real, 'package.json'));
    const deps = {
      ...((manifest.dependencies as Record<string, string>) ?? {}),
      ...((manifest.optionalDependencies as Record<string, string>) ?? {}),
    };
    for (const dep of Object.keys(deps)) {
      let found: string | undefined;
      // Resolve the dependency's directory from this package, as Node would.
      for (let d = real; ; d = dirname(d)) {
        const candidate = join(d, 'node_modules', dep);
        if (existsSync(join(candidate, 'package.json'))) {
          found = candidate;
          break;
        }
        if (dirname(d) === d) break;
      }
      if (!found) {
        // Optional platform packages for other systems are not installed here.
        if (dep in ((manifest.optionalDependencies as Record<string, string>) ?? {})) continue;
        try {
          found = dirname(require.resolve(`${dep}/package.json`));
        } catch {
          throw new Error(`${name} depends on ${dep}, which is not installed.`);
        }
      }
      visit(found, includeWorkspace);
    }
  };
  for (const dir of PUBLISHED) visit(join(repo, dir), true);
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Packages whose licence is neither allowed nor a reviewed exception. Workspace packages must be MIT. */
export function licenceProblems(packages: readonly InstalledPackage[]): string[] {
  const problems: string[] = [];
  for (const p of packages) {
    if (p.name.startsWith('@td2d/')) {
      if (p.licence !== 'MIT') problems.push(`${p.name}@${p.version}: td2d packages are MIT, found ${p.licence}`);
      continue;
    }
    const options = p.licence.replace(/[()]/g, '').split(/\s+OR\s+/);
    if (options.some((l) => ALLOWED.has(l))) continue;
    if (EXCEPTIONS.some((e) => e.pattern.test(p.name) && e.licence === p.licence)) continue;
    problems.push(`${p.name}@${p.version}: ${p.licence} is not on the allowlist`);
  }
  return problems;
}
