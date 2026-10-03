// Checks the publishable packages before a release: one shared version, the @td2d scope, MIT
// with a LICENSE file, a files list, a README, and (in GitHub Actions) a repository.url that
// names the repository the workflow runs in, which npm provenance requires.
//   node scripts/release-check.ts
import { join } from 'node:path';
import { readPublished, releaseProblems } from './lib/release.ts';

const packages = readPublished(join(import.meta.dirname, '..'));
const githubRepository = process.env.GITHUB_REPOSITORY;
const problems = releaseProblems(packages, githubRepository ? { githubRepository } : {});
for (const p of problems) process.stderr.write(`${p}\n`);
if (problems.length === 0)
  process.stdout.write(
    `${packages.length} packages ready to publish at ${packages[0]?.manifest.version}${githubRepository ? ` from ${githubRepository}` : ' (repository not checked outside GitHub Actions)'}.\n`,
  );
process.exit(problems.length === 0 ? 0 : 1);
