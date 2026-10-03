// Writes docs/reference/cli.md from the command definitions. Part of `pnpm generate`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCliReference } from '../src/reference.ts';

const file = join(import.meta.dirname, '..', '..', '..', 'docs', 'reference', 'cli.md');
writeFileSync(file, renderCliReference());
process.stdout.write('Wrote docs/reference/cli.md\n');
