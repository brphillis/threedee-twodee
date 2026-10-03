import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubRepositoryOf, type PublishedPackage, readPublished, releaseProblems } from '../scripts/lib/release.ts';

const REPO = join(import.meta.dirname, '..');

function pkg(overrides: Partial<PublishedPackage['manifest']> = {}, files = { readme: true, licence: true }) {
  return {
    dir: 'packages/x',
    manifest: { name: '@td2d/x', version: '1.0.0', license: 'MIT', files: ['dist'], ...overrides },
    hasReadme: files.readme,
    hasLicence: files.licence,
  } satisfies PublishedPackage;
}

describe('release check', () => {
  it('finds the five published packages ready apart from the repository, which only CI knows', () => {
    const packages = readPublished(REPO);
    expect(packages.map((p) => p.manifest.name)).toEqual([
      '@td2d/schema',
      '@td2d/render-harness',
      '@td2d/core',
      '@td2d/viewer',
      '@td2d/cli',
    ]);
    expect(releaseProblems(packages)).toEqual([]);
  });

  it('reports each kind of problem', () => {
    expect(
      releaseProblems([
        pkg({ name: 'x', private: true, license: 'ISC', files: [] }, { readme: false, licence: false }),
        pkg({ version: '1.0.1' }),
      ]),
    ).toEqual([
      'The packages must share one version (they are versioned together), found 1.0.0, 1.0.1.',
      'packages/x: the name must be in the @td2d scope.',
      'x: is private, so it cannot be published.',
      'x: the licence must be MIT, found ISC.',
      'x: needs a files list, so only built output is published.',
      'x: has no README.md for its npm page.',
      'x: has no LICENSE file; MIT requires the notice to ship with the code.',
    ]);
  });

  it('requires repository.url to name the repository the release runs in', () => {
    const options = { githubRepository: 'Owner/td2d' };
    expect(releaseProblems([pkg()], options)[0]).toMatch(
      /has no repository.url.*git\+https:\/\/github.com\/Owner\/td2d.git/,
    );
    expect(
      releaseProblems([pkg({ repository: { type: 'git', url: 'git+https://github.com/owner/td2d.git' } })], options),
    ).toEqual([]);
    expect(releaseProblems([pkg({ repository: 'github:owner/td2d' })], options)).toEqual([]);
    expect(releaseProblems([pkg({ repository: { url: 'https://github.com/fork/td2d' } })], options)).toEqual([
      '@td2d/x: repository.url is https://github.com/fork/td2d, but the release runs in Owner/td2d; npm provenance would reject the publish.',
    ]);
  });

  it('reads GitHub repository URLs in the forms npm accepts', () => {
    for (const url of [
      'git+https://github.com/owner/name.git',
      'https://github.com/owner/name',
      'git@github.com:owner/name.git',
      'ssh://git@github.com/owner/name.git',
      'git://github.com/owner/name.git',
      'github:owner/name',
      'owner/name',
    ])
      expect(githubRepositoryOf(url), url).toBe('owner/name');
    expect(githubRepositoryOf('https://gitlab.com/owner/name')).toBeNull();
  });
});
