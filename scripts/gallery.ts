// Writes docs/guide/examples.md from the example projects. Part of `pnpm generate`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderGallery } from './lib/gallery.ts';

const repo = join(import.meta.dirname, '..');
writeFileSync(join(repo, 'docs', 'guide', 'examples.md'), renderGallery(repo));
process.stdout.write('Wrote docs/guide/examples.md\n');
