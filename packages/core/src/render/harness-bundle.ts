import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Td2dError } from '../errors.ts';

let cached: { path: string; source: string } | undefined;

/** The built browser harness script. Missing in a fresh clone until `pnpm build` runs. */
export function harnessBundle(): { path: string; source: string } {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  let path: string;
  try {
    path = require.resolve('@td2d/render-harness/bundle');
  } catch (error) {
    throw new Td2dError('E_BACKEND_UNAVAILABLE', 'The render harness package is not installed.', {
      cause: error,
      hint: 'Reinstall td2d.',
    });
  }
  if (!existsSync(path)) {
    throw new Td2dError('E_BACKEND_UNAVAILABLE', `The render harness has not been built (${path} is missing).`, {
      hint: 'Run `pnpm build` in the td2d repository.',
    });
  }
  cached = { path, source: readFileSync(path, 'utf8') };
  return cached;
}
