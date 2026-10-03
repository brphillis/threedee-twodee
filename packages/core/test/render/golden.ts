import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { expect } from 'vitest';
import { encodePng, type RenderedFrame, readPng } from '../../src/index.ts';

export const GOLDEN_DIR = join(import.meta.dirname, '..', 'fixtures', 'golden', 'render');
export const ARTIFACT_DIR = join(import.meta.dirname, '..', '..', '.artifacts');

const UPDATE = process.env.TD2D_UPDATE_GOLDENS === '1';
const IN_CI = process.env.CI === 'true' || process.env.CI === '1';

/** Cross-machine tolerance for raw renders (section 14.3 of the roadmap). */
export const RENDER_TOLERANCE = { threshold: 0.1, maxDiffRatio: 0.005 } as const;

/**
 * Record a comparison. Test files run in parallel, so each entry is its own file, and the combined
 * golden-report.json is rebuilt from all of them and moved into place, never half written.
 */
function record(name: string, entry: Record<string, unknown>): void {
  const entries = join(ARTIFACT_DIR, 'golden-report');
  mkdirSync(entries, { recursive: true });
  writeFileSync(
    join(entries, `${name.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`),
    JSON.stringify({ name, ...entry, platform: `${process.platform}-${process.arch}` }),
  );
  const report: Record<string, unknown> = {};
  for (const file of readdirSync(entries)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    try {
      const { name: key, ...rest } = JSON.parse(readFileSync(join(entries, file), 'utf8')) as { name: string };
      report[key] = rest;
    } catch {
      // Another worker is writing this entry right now; it rebuilds the report itself.
    }
  }
  const tmp = join(ARTIFACT_DIR, `golden-report.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(tmp, join(ARTIFACT_DIR, 'golden-report.json'));
}

/**
 * Compare a frame with its committed golden. Missing goldens are written locally and
 * fail in CI. Set TD2D_UPDATE_GOLDENS=1 to rewrite them. On a mismatch the actual
 * image and a diff image are written to packages/core/.artifacts/.
 */
export async function expectGolden(
  name: string,
  frame: RenderedFrame,
  tolerance = RENDER_TOLERANCE,
  /** Record under this name instead, to compare another backend with the same golden. */
  reportAs: string = name,
): Promise<number> {
  const file = join(GOLDEN_DIR, `${name}.png`);
  // Only the golden's own backend writes it; other backends are compared against it.
  if (reportAs !== name && !existsSync(file)) throw new Error(`Golden ${name}.png is missing.`);
  if (reportAs === name && (UPDATE || !existsSync(file))) {
    if (!UPDATE && IN_CI)
      throw new Error(`Golden ${name}.png is missing. Generate it locally with TD2D_UPDATE_GOLDENS=1.`);
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, await encodePng(frame, 9));
    record(name, { written: true });
    return 0;
  }
  const golden = await readPng(file);
  expect([frame.width, frame.height], `${name} size`).toEqual([golden.width, golden.height]);
  const diff = new Uint8Array(frame.rgba.length);
  const mismatched = pixelmatch(golden.rgba, frame.rgba, diff, frame.width, frame.height, {
    threshold: tolerance.threshold,
    includeAA: true,
  });
  const ratio = mismatched / (frame.width * frame.height);
  let exactDifferences = 0;
  for (let i = 0; i < frame.rgba.length; i += 4) {
    if (
      frame.rgba[i] !== golden.rgba[i] ||
      frame.rgba[i + 1] !== golden.rgba[i + 1] ||
      frame.rgba[i + 2] !== golden.rgba[i + 2] ||
      frame.rgba[i + 3] !== golden.rgba[i + 3]
    )
      exactDifferences++;
  }
  record(reportAs, { mismatched, ratio, exactDifferences });
  if (ratio > tolerance.maxDiffRatio) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, `${reportAs}.actual.png`), await encodePng(frame));
    writeFileSync(
      join(ARTIFACT_DIR, `${name}.diff.png`),
      await encodePng({ width: frame.width, height: frame.height, rgba: diff }),
    );
  }
  expect(ratio, `${name}: ${mismatched} pixels differ`).toBeLessThanOrEqual(tolerance.maxDiffRatio);
  return ratio;
}
