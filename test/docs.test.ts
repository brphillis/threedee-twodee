// Repository-wide documentation checks: links, guide structure, snippets and AGENTS.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderGallery } from '../scripts/lib/gallery.ts';
import { checkLinks, codeBlocks, markdownFiles } from '../scripts/lib/markdown.ts';

const ROOT = join(import.meta.dirname, '..');
const GUIDES = join(ROOT, 'docs', 'guide');

describe('documentation', () => {
  it('has no broken links, images or anchors in any Markdown file', () => {
    expect(markdownFiles(ROOT).length).toBeGreaterThan(30);
    expect(checkLinks(ROOT)).toEqual([]);
  });

  it('gives every guide a runnable example and an image produced by the test suite', () => {
    for (const file of readdirSync(GUIDES).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(join(GUIDES, file), 'utf8');
      const blocks = codeBlocks(text);
      expect(
        blocks.some((b) => b.lang === 'sh' && /\btd2d |\bpnpm |\bnode /.test(b.body)),
        `${file} has a shell example`,
      ).toBe(true);
      expect(/!\[[^\]]*\]\(images\//.test(text), `${file} shows an image from docs/guide/images`).toBe(true);
    }
  });

  it('has only valid JSON in json code blocks', () => {
    for (const file of markdownFiles(ROOT)) {
      for (const block of codeBlocks(readFileSync(join(ROOT, file), 'utf8')).filter((b) => b.lang === 'json')) {
        expect(() => JSON.parse(block.body), `${file}:${block.line}`).not.toThrow();
      }
    }
  });

  it('lists every example asset in the gallery (run `pnpm generate` to update)', () => {
    expect(readFileSync(join(GUIDES, 'examples.md'), 'utf8')).toBe(renderGallery(ROOT));
  });

  it('keeps AGENTS.md under 80 lines', () => {
    expect(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').trimEnd().split('\n').length).toBeLessThan(80);
  });

  it('writes no em or en dashes in documentation', () => {
    const dashes = /[\u2013\u2014]/;
    const offenders = markdownFiles(ROOT).filter(
      (f) => !f.startsWith('.changeset/') && dashes.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
