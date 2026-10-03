import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedClosure, licenceProblems } from '../scripts/lib/licences.ts';

describe('dependency licences', () => {
  it('installs only allowlisted licences or reviewed exceptions', () => {
    const packages = installedClosure(join(import.meta.dirname, '..'));
    // The closure includes td2d's own five packages and their real dependency tree.
    expect(packages.filter((p) => p.name.startsWith('@td2d/'))).toHaveLength(5);
    expect(packages.length).toBeGreaterThan(40);
    expect(licenceProblems(packages)).toEqual([]);
  });

  it('flags a licence that is not allowed', () => {
    expect(licenceProblems([{ name: 'gpl-thing', version: '1.0.0', licence: 'GPL-3.0-only', dir: '' }])).toEqual([
      'gpl-thing@1.0.0: GPL-3.0-only is not on the allowlist',
    ]);
    expect(licenceProblems([{ name: 'dual', version: '1.0.0', licence: '(MIT OR GPL-3.0)', dir: '' }])).toEqual([]);
    expect(
      licenceProblems([
        { name: '@img/sharp-libvips-linux-x64', version: '1.0.0', licence: 'LGPL-3.0-or-later', dir: '' },
      ]),
    ).toEqual([]);
  });
});
