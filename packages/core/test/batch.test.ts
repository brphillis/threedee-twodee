import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConcurrency, matchesGlob, readBatchManifest, readBatchReport, type Td2dError } from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

describe('batch globs', () => {
  it('matches * within a segment, ** across segments and ? one character', () => {
    expect(matchesGlob('props/crate', 'props/*')).toBe(true);
    expect(matchesGlob('props/wood/crate', 'props/*')).toBe(false);
    expect(matchesGlob('props/wood/crate', 'props/**')).toBe(true);
    expect(matchesGlob('props/crate', '**/crate')).toBe(true);
    expect(matchesGlob('props/crate', 'props/cr?te')).toBe(true);
    expect(matchesGlob('props/crate', 'characters/*')).toBe(false);
    expect(matchesGlob('a.b/c', 'a.b/*')).toBe(true);
    expect(matchesGlob('axb/c', 'a.b/*')).toBe(false);
  });
});

describe('batch concurrency', () => {
  it('defaults to one fewer than the cores, at least 1 and at most 4', () => {
    expect([1, 2, 3, 4, 5, 10, 64].map((cores) => defaultConcurrency(cores))).toEqual([1, 1, 2, 3, 4, 4, 4]);
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);
  });
});

describe('batch files', () => {
  it('reads manifests and reports, and rejects invalid ones with typed errors', () => {
    const dir = tempDir();
    const file = (name: string, value: unknown) => {
      const path = join(dir, name);
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
      return path;
    };
    const manifest = readBatchManifest(
      file('m.json', { schemaVersion: '1.0.0', assets: [{ id: 'props/crate', overrides: { pixel: 'pico-8' } }] }),
      'm.json',
    );
    expect(manifest.assets[0]?.overrides).toEqual({ pixel: 'pico-8' });
    const fail = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error as Td2dError;
      }
      throw new Error('expected an error');
    };
    expect(fail(() => readBatchManifest(file('bad.json', '{ nope'), 'bad.json')).code).toBe('E_USAGE');
    const invalid = fail(() =>
      readBatchManifest(file('empty.json', { schemaVersion: '1.0.0', assets: [] }), 'empty.json'),
    );
    expect(invalid.code).toBe('E_ASSET_INVALID');
    expect(invalid.issues?.[0]?.path).toBe('assets');
    expect(fail(() => readBatchReport(file('r.json', { status: 'ok' }), 'r.json')).code).toBe('E_USAGE');
  });
});
