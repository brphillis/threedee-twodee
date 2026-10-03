// Checks the licence of every package td2d's published packages install.
//   node scripts/licences.ts        (also run by the test suite)
import { join } from 'node:path';
import { installedClosure, licenceProblems } from './lib/licences.ts';

const packages = installedClosure(join(import.meta.dirname, '..'));
const counts = new Map<string, number>();
for (const p of packages) counts.set(p.licence, (counts.get(p.licence) ?? 0) + 1);
process.stdout.write(`${packages.length} packages: ${[...counts].map(([l, n]) => `${l} ${n}`).join(', ')}\n`);
const problems = licenceProblems(packages);
for (const p of problems) process.stderr.write(`${p}\n`);
process.exit(problems.length === 0 ? 0 : 1);
