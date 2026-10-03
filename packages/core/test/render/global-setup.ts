import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..', '..', '..');
const harness = join(repo, 'packages', 'render-harness');
const bundle = join(harness, 'dist', 'td2d-harness.js');

function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs);
  }
  return latest;
}

/** Rebuild the browser harness when its sources or the render contract changed since the last build. */
export default async function setup(): Promise<void> {
  const sources = Math.max(
    newest(join(harness, 'src')),
    statSync(join(repo, 'packages', 'schema', 'src', 'render.ts')).mtimeMs,
  );
  if (existsSync(bundle) && statSync(bundle).mtimeMs >= sources) return;
  const { build } = await import('vite');
  await build({ configFile: join(harness, 'vite.config.ts'), logLevel: 'warn' });
}
