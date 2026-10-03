import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The packages td2d publishes, in dependency order. */
export const PUBLISHED = ['packages/schema', 'packages/render-harness', 'packages/core', 'apps/viewer', 'packages/cli'];

export interface PublishedPackage {
  readonly dir: string;
  readonly manifest: {
    readonly name?: string;
    readonly version?: string;
    readonly license?: string;
    readonly private?: boolean;
    readonly files?: readonly string[];
    readonly repository?: string | { readonly type?: string; readonly url?: string; readonly directory?: string };
  };
  readonly hasReadme: boolean;
  readonly hasLicence: boolean;
}

export function readPublished(repo: string): PublishedPackage[] {
  return PUBLISHED.map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8')) as PublishedPackage['manifest'],
    hasReadme: existsSync(join(repo, dir, 'README.md')),
    hasLicence: existsSync(join(repo, dir, 'LICENSE')),
  }));
}

/** "owner/name" from a GitHub repository URL in any of the forms npm accepts, or null. */
export function githubRepositoryOf(url: string): string | null {
  const match = /^(?:git\+)?(?:https:\/\/|ssh:\/\/git@|git@|git:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
    url,
  );
  if (match) return (match[1] as string).toLowerCase();
  const short = /^(?:github:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(url);
  return short ? (short[1] as string).toLowerCase() : null;
}

export interface ReleaseCheckOptions {
  /**
   * The repository the release workflow runs in ("owner/name", GITHUB_REPOSITORY). npm
   * provenance only verifies when every package's repository.url names this repository, so
   * with it set, a missing or different repository is a problem. Without it (a local check)
   * the repository is not checked.
   */
  readonly githubRepository?: string;
}

/** Everything that would make `changeset publish` fail or publish something wrong, as messages. */
export function releaseProblems(packages: readonly PublishedPackage[], options: ReleaseCheckOptions = {}): string[] {
  const problems: string[] = [];
  const versions = new Set(packages.map((p) => p.manifest.version));
  if (versions.size !== 1)
    problems.push(
      `The packages must share one version (they are versioned together), found ${[...versions].join(', ')}.`,
    );
  for (const p of packages) {
    const name = p.manifest.name ?? p.dir;
    if (!p.manifest.name?.startsWith('@td2d/')) problems.push(`${p.dir}: the name must be in the @td2d scope.`);
    if (p.manifest.private) problems.push(`${name}: is private, so it cannot be published.`);
    if (p.manifest.license !== 'MIT') problems.push(`${name}: the licence must be MIT, found ${p.manifest.license}.`);
    if (!p.manifest.files?.length) problems.push(`${name}: needs a files list, so only built output is published.`);
    if (!p.hasReadme) problems.push(`${name}: has no README.md for its npm page.`);
    if (!p.hasLicence) problems.push(`${name}: has no LICENSE file; MIT requires the notice to ship with the code.`);
    if (options.githubRepository) {
      const repository = p.manifest.repository;
      const url = typeof repository === 'string' ? repository : repository?.url;
      const expected = options.githubRepository.toLowerCase();
      if (!url)
        problems.push(
          `${name}: has no repository.url. npm provenance needs it to name ${options.githubRepository}: add "repository": { "type": "git", "url": "git+https://github.com/${options.githubRepository}.git", "directory": "${p.dir}" }.`,
        );
      else if (githubRepositoryOf(url) !== expected)
        problems.push(
          `${name}: repository.url is ${url}, but the release runs in ${options.githubRepository}; npm provenance would reject the publish.`,
        );
    }
  }
  return problems;
}
