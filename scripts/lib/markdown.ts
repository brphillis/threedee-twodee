// Markdown checks for the repository's documentation: links, anchors, images and JSON snippets.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'history',
  '.git',
  '.td2d',
  'coverage',
  '.artifacts',
  'fixtures-out',
]);

/** Every Markdown file in the repository that is documentation (not generated build output). */
export function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (e.name.endsWith('.md')) out.push(relative(root, join(dir, e.name)).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** GitHub's anchor for a heading. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

/** Lines outside fenced code blocks, with their line numbers. */
function prose(text: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (!fenced) out.push({ line, n: i + 1 });
  });
  return out;
}

/** Anchors a Markdown file defines: headings (deduplicated the way GitHub does) and <a id>. */
export function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const { line } of prose(text)) {
    const heading = /^#{1,6} (.+?)\s*#*$/.exec(line);
    if (heading) {
      const base = slug((heading[1] as string).replace(/`/g, ''));
      const count = seen.get(base) ?? 0;
      anchors.add(count === 0 ? base : `${base}-${count}`);
      seen.set(base, count + 1);
    }
    for (const m of line.matchAll(/<a id="([^"]+)"/g)) anchors.add(m[1] as string);
  }
  return anchors;
}

/** Fenced code blocks with their language. */
export function codeBlocks(text: string): { lang: string; body: string; line: number }[] {
  const out: { lang: string; body: string; line: number }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*```(\S*)/.exec(lines[i] as string);
    if (!open) continue;
    const start = i;
    const body: string[] = [];
    for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i] as string); i++) body.push(lines[i] as string);
    out.push({ lang: open[1] ?? '', body: body.join('\n'), line: start + 1 });
  }
  return out;
}

export interface LinkProblem {
  readonly file: string;
  readonly line: number;
  readonly link: string;
  readonly problem: string;
}

/**
 * Check every relative link and image in the Markdown files: the target exists and, for a
 * Markdown target with an anchor, the anchor does. External links are not fetched.
 */
export function checkLinks(root: string, files: readonly string[] = markdownFiles(root)): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (file: string) => {
    let a = anchorCache.get(file);
    if (!a) {
      a = anchorsOf(readFileSync(file, 'utf8'));
      anchorCache.set(file, a);
    }
    return a;
  };
  for (const file of files) {
    const full = join(root, file);
    const text = readFileSync(full, 'utf8');
    for (const { line, n } of prose(text)) {
      // Inline code cannot hold links.
      const visible = line.replace(/`[^`]*`/g, '');
      const targets = [
        ...[...visible.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] as string),
        ...[...visible.matchAll(/<(?:img|a)\s[^>]*(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string),
      ];
      for (const link of targets) {
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [path = '', anchor] = link.split('#') as [string, string | undefined];
        const target = path === '' ? full : resolve(dirname(full), decodeURIComponent(path));
        if (!target.startsWith(root)) {
          problems.push({ file, line: n, link, problem: 'points outside the repository' });
          continue;
        }
        if (!existsSync(target)) {
          problems.push({ file, line: n, link, problem: 'target does not exist' });
          continue;
        }
        if (anchor !== undefined && target.endsWith('.md') && statSync(target).isFile() && !anchors(target).has(anchor))
          problems.push({ file, line: n, link, problem: `no anchor #${anchor} in ${relative(root, target)}` });
      }
    }
  }
  return problems;
}
