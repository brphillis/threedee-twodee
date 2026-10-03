import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, ERROR_CODES, ExitCode, WARNING_CATALOG } from '../src/index.ts';

describe('error catalogue', () => {
  const exits = new Set<number>(Object.values(ExitCode));

  it.each(ERROR_CODES)('%s has a valid exit code, summary and hint', (code) => {
    const entry = ERROR_CATALOG[code];
    expect(code).toMatch(/^E_[A-Z_]+$/);
    expect(exits.has(entry.exit)).toBe(true);
    expect(entry.summary.length).toBeGreaterThan(5);
    expect(entry.hint.length).toBeGreaterThan(5);
  });

  it('uses W_ prefixes for warnings', () => {
    for (const code of Object.keys(WARNING_CATALOG)) expect(code).toMatch(/^W_[A-Z_]+$/);
  });
});

describe('error reference page', () => {
  it('matches docs/reference/errors.md (run `pnpm generate` to update)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { renderErrorReference } = await import('../src/index.ts');
    const committed = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'docs', 'reference', 'errors.md'),
      'utf8',
    );
    expect(committed).toBe(renderErrorReference());
  });

  it('has a heading for every error code', async () => {
    const { renderErrorReference, errorAnchor } = await import('../src/index.ts');
    const page = renderErrorReference();
    for (const code of ERROR_CODES) {
      expect(page).toContain(`### ${code}\n`);
      expect(errorAnchor(code)).toBe(code.toLowerCase());
    }
  });
});

describe('schema reference page', () => {
  it('matches docs/reference/schemas.md (run `pnpm generate` to update)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { renderSchemaReference } = await import('../src/index.ts');
    const committed = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'docs', 'reference', 'schemas.md'),
      'utf8',
    );
    expect(committed).toBe(renderSchemaReference());
  });

  it('describes every top-level field of every document', async () => {
    const { renderSchemaReference } = await import('../src/index.ts');
    // Field rows are | `name` | required | meaning |: the meaning cell must not be empty.
    const blank = renderSchemaReference()
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .filter((line) => (line.split('|')[3] ?? '').trim() === '');
    expect(blank).toEqual([]);
  });
});
