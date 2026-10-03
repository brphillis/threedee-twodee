// Checks every relative link, image and anchor in the repository's Markdown.
//   node scripts/check-links.ts      (also run by the test suite)
import { join } from 'node:path';
import { checkLinks } from './lib/markdown.ts';

const root = join(import.meta.dirname, '..');
const problems = checkLinks(root);
for (const p of problems) process.stderr.write(`${p.file}:${p.line} ${p.link}: ${p.problem}\n`);
process.stdout.write(problems.length === 0 ? 'All links resolve.\n' : `${problems.length} broken link(s).\n`);
process.exit(problems.length === 0 ? 0 : 1);
