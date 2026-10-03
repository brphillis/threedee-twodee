import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneFile } from '../src/fs/copy.ts';
import { tempDir } from './helpers/tmp.ts';

describe('cloneFile', () => {
  it('copies the bytes, and the two files stay independent when either is written', () => {
    const dir = tempDir();
    const source = join(dir, 'a.png');
    const target = join(dir, 'b.png');
    const bytes = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251));
    writeFileSync(source, bytes);
    cloneFile(source, target);
    expect(readFileSync(target).equals(bytes)).toBe(true);
    writeFileSync(target, 'changed');
    expect(readFileSync(source).equals(bytes)).toBe(true);
    cloneFile(source, target);
    writeFileSync(source, 'also changed');
    expect(readFileSync(target).equals(bytes)).toBe(true);
  });

  it('fails when the source does not exist', () => {
    const dir = tempDir();
    expect(() => cloneFile(join(dir, 'missing.png'), join(dir, 'b.png'))).toThrow(/ENOENT/);
  });
});
