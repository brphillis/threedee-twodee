import {
  type AcceptanceT,
  type AssetTypeT,
  OUTPUT_SCHEMA_VERSION,
  type ValidationCheckT,
  type ValidationReportT,
} from '@td2d/schema';
import { opaqueColours, type RgbaImage } from '../pixel/image.ts';
import { isolatedPixels } from '../pixel/passes.ts';
import { touchedEdges } from '../render/frame-checks.ts';
import { alphaCoverage, opaqueBounds } from '../render/frames.ts';
import { CORE_VERSION } from '../version.ts';

/** Frames below this opaque fraction count as blank. */
export const MIN_COVERAGE = 0.005;

export interface ValidationInput {
  readonly assetId: string;
  readonly type: AssetTypeT;
  readonly frame: { readonly width: number; readonly height: number };
  readonly groundMargin: number;
  readonly sprites: readonly { readonly key: string; readonly image: RgbaImage }[];
  /** Every sheet image with the size the layout planned for it. */
  readonly sheets: readonly {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly expectedWidth: number;
    readonly expectedHeight: number;
  }[];
  /** Cell rectangles, with the index of their sheet, and the extrude around each. */
  readonly cells?: readonly {
    readonly key: string;
    readonly sheet: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[];
  readonly extrude?: number;
  /** Sprite keys the plan expects on the sheets, each exactly once. */
  readonly expectedKeys?: readonly string[];
  readonly acceptance: AcceptanceT;
  /** Colours sprites may use, as #rrggbb, or null when there is no palette. */
  readonly allowedColours?: readonly string[] | null;
  /** Frames in playback order for each clip and direction. */
  readonly sequences?: readonly {
    readonly clip: string;
    readonly direction: string;
    readonly keys: readonly string[];
    readonly motion: boolean;
  }[];
  /** Pixels the cleanup pass changed, or null when cleanup is off. */
  readonly cleanup?: { readonly removed: number; readonly recoloured: number } | null;
}

/** Default largest centroid move, in pixels, between consecutive frames before a jitter warning. */
export const DEFAULT_MAX_JITTER = 2;

/** Mean position of the opaque pixels, or null for a blank image. */
export function centroid(img: RgbaImage): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] === 0) continue;
      sx += x;
      sy += y;
      n++;
    }
  }
  return n === 0 ? null : { x: sx / n, y: sy / n };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function check(
  id: string,
  failing: string[],
  status: 'warn' | 'fail',
  ok: string,
  bad: (n: number) => string,
  details?: Record<string, unknown>,
): ValidationCheckT {
  return failing.length === 0
    ? { id, status: 'pass', message: ok }
    : { id, status, message: bad(failing.length), frames: failing.slice(0, 50), ...(details ? { details } : {}) };
}

/** Automated checks on generated sprites. Judgement calls such as readability are left to people. */
export function validateSprites(input: ValidationInput): ValidationReportT {
  const { frame, sprites } = input;
  const checks: ValidationCheckT[] = [];
  const keysWhere = (predicate: (img: RgbaImage) => boolean) =>
    sprites.filter((s) => predicate(s.image)).map((s) => s.key);

  checks.push(
    check(
      'sprite-size',
      keysWhere((img) => img.width !== frame.width || img.height !== frame.height),
      'fail',
      `Every sprite is ${frame.width} x ${frame.height}.`,
      (n) => `${n} sprite(s) are not ${frame.width} x ${frame.height}.`,
    ),
  );
  checks.push(
    check(
      'binary-alpha',
      keysWhere((img) => {
        for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 0 && img.rgba[i] !== 255) return true;
        return false;
      }),
      'fail',
      'Every pixel is fully opaque or fully transparent.',
      (n) => `${n} sprite(s) have partially transparent pixels.`,
    ),
  );
  checks.push(
    check(
      'not-blank',
      keysWhere((img) => alphaCoverage(img.rgba) < MIN_COVERAGE),
      'fail',
      'No sprite is blank.',
      (n) => `${n} sprite(s) are blank or nearly blank (under ${MIN_COVERAGE * 100}% opaque).`,
    ),
  );
  const clipped = sprites.filter((s) => touchedEdges(s.image).length > 0);
  checks.push(
    check(
      'inside-frame',
      clipped.map((s) => s.key),
      'warn',
      'No sprite touches the frame edge.',
      (n) => `${n} sprite(s) touch the frame edge and may be cut off.`,
      { edges: Object.fromEntries(clipped.slice(0, 50).map((s) => [s.key, touchedEdges(s.image)])) },
    ),
  );
  if (input.type !== 'effect') {
    const pivotRow = frame.height - input.groundMargin;
    checks.push(
      check(
        'grounded',
        keysWhere((img) => {
          const b = opaqueBounds(img);
          return b !== null && b.y + b.h - 1 < pivotRow - 1;
        }),
        'warn',
        'Every sprite reaches the ground line.',
        (n) => `${n} sprite(s) float above the ground line at row ${pivotRow}. Check the model's base is at y = 0.`,
      ),
    );
  }
  const { minAlphaCoverage, maxAlphaCoverage, maxColors } = input.acceptance;
  if (minAlphaCoverage !== undefined || maxAlphaCoverage !== undefined) {
    const lo = minAlphaCoverage ?? 0;
    const hi = maxAlphaCoverage ?? 1;
    const coverage = sprites.map((s) => alphaCoverage(s.image.rgba));
    // The measured range, so an author can see how much room the limits leave.
    const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
    const measured =
      coverage.length > 0 ? ` (measured ${pct(Math.min(...coverage))} to ${pct(Math.max(...coverage))})` : '';
    checks.push(
      check(
        'coverage',
        keysWhere((img) => alphaCoverage(img.rgba) < lo || alphaCoverage(img.rgba) > hi),
        'fail',
        `Every sprite is between ${lo * 100}% and ${hi * 100}% opaque${measured}.`,
        (n) => `${n} sprite(s) are outside the accepted opaque range ${lo * 100}% to ${hi * 100}%${measured}.`,
      ),
    );
  }
  if (maxColors !== undefined) {
    const counts = Object.fromEntries(sprites.map((s) => [s.key, opaqueColours(s.image).length]));
    checks.push(
      check(
        'max-colors',
        sprites.filter((s) => (counts[s.key] ?? 0) > maxColors).map((s) => s.key),
        'fail',
        `Every sprite uses at most ${maxColors} colours (the most is ${Math.max(0, ...Object.values(counts))}).`,
        (n) =>
          `${n} sprite(s) use more than ${maxColors} colours (the most is ${Math.max(0, ...Object.values(counts))}).`,
        { colours: counts },
      ),
    );
  }
  if (input.allowedColours) {
    const allowed = new Set(input.allowedColours.map((c) => c.toLowerCase()));
    const offending = new Map<string, string[]>();
    for (const s of sprites) {
      const outside = opaqueColours(s.image).filter((c) => !allowed.has(c));
      if (outside.length > 0) offending.set(s.key, outside);
    }
    checks.push(
      check(
        'palette',
        [...offending.keys()],
        'fail',
        `Every opaque pixel uses one of the ${allowed.size} palette colours.`,
        (n) => `${n} sprite(s) use colours outside the palette.`,
        {
          colours: Object.fromEntries([...offending].slice(0, 20).map(([k, v]) => [k, v.slice(0, 8)])),
        },
      ),
    );
  }
  const images = new Map(sprites.map((s) => [s.key, s.image]));
  const animated = (input.sequences ?? []).filter((q) => q.keys.length > 1);
  if (animated.length > 0) {
    const limit = input.acceptance.maxJitter ?? DEFAULT_MAX_JITTER;
    const jumps: Record<string, number> = {};
    for (const q of animated.filter((q) => !q.motion)) {
      const points = q.keys.map((k) => images.get(k)).map((img) => (img ? centroid(img) : null));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (!a || !b) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > limit) jumps[q.keys[i] as string] = Number(d.toFixed(2));
      }
    }
    checks.push(
      check(
        'jitter',
        Object.keys(jumps),
        input.acceptance.maxJitter === undefined ? 'warn' : 'fail',
        `No frame's centre moves more than ${limit} px from the previous frame.`,
        (n) => `${n} frame(s) jump more than ${limit} px from the previous frame.`,
        { jumps },
      ),
    );
    if (input.acceptance.maxBoundsDrift !== undefined) {
      const drift = input.acceptance.maxBoundsDrift;
      const drifting: string[] = [];
      for (const q of animated) {
        const boxes = q.keys
          .map((k) => ({ k, b: images.get(k) ? opaqueBounds(images.get(k) as RgbaImage) : null }))
          .filter((e) => e.b !== null);
        const mw = median(boxes.map((e) => e.b?.w ?? 0));
        const mh = median(boxes.map((e) => e.b?.h ?? 0));
        for (const e of boxes)
          if (Math.abs((e.b?.w ?? 0) - mw) > drift || Math.abs((e.b?.h ?? 0) - mh) > drift) drifting.push(e.k);
      }
      checks.push(
        check(
          'bounds-drift',
          drifting,
          'fail',
          `Every frame's size stays within ${drift} px of its clip's median.`,
          (n) => `${n} frame(s) change size by more than ${drift} px within their clip.`,
        ),
      );
    }
  }
  if (input.cleanup) {
    const { removed, recoloured } = input.cleanup;
    checks.push({
      id: 'cleanup',
      status: 'pass',
      message: `Cleanup removed ${removed} and recoloured ${recoloured} stray pixel(s) across all sprites.`,
      details: { removed, recoloured },
    });
  }
  const maxOrphans = input.acceptance.maxOrphans;
  const lonely = sprites
    .map((s) => ({ key: s.key, count: isolatedPixels(s.image) }))
    .filter((s) => s.count > (maxOrphans ?? 0));
  checks.push(
    check(
      'isolated-pixels',
      lonely.map((s) => s.key),
      maxOrphans === undefined ? 'warn' : 'fail',
      maxOrphans === undefined
        ? 'No sprite has stray single pixels.'
        : `No sprite has more than ${maxOrphans} stray single pixel(s).`,
      (n) =>
        `${n} sprite(s) have ${maxOrphans === undefined ? '' : `more than ${maxOrphans} `}single pixels with no opaque neighbour. Set pixel.cleanup.orphans to "remove" to drop them.`,
      { counts: Object.fromEntries(lonely.slice(0, 20).map((s) => [s.key, s.count])) },
    ),
  );
  const wrong = input.sheets.filter((s) => s.width !== s.expectedWidth || s.height !== s.expectedHeight);
  const sizes = input.sheets.map((s) => `${s.width} x ${s.height}`).join(', ');
  checks.push(
    wrong.length === 0
      ? {
          id: 'sheet-size',
          status: 'pass',
          message:
            input.sheets.length === 1 ? `The sheet is ${sizes}.` : `The ${input.sheets.length} sheets are ${sizes}.`,
        }
      : {
          id: 'sheet-size',
          status: 'fail',
          message: wrong
            .map(
              (s) => `Sheet ${s.name} is ${s.width} x ${s.height}, expected ${s.expectedWidth} x ${s.expectedHeight}.`,
            )
            .join(' '),
        },
  );
  if (input.cells) {
    const e = input.extrude ?? 0;
    const outside = input.cells
      .filter((c) => {
        const page = input.sheets[c.sheet];
        return (
          !page ||
          c.x - e < 0 ||
          c.y - e < 0 ||
          c.x + c.w + e > page.expectedWidth ||
          c.y + c.h + e > page.expectedHeight
        );
      })
      .map((c) => c.key);
    checks.push(
      check(
        'cells-in-bounds',
        outside,
        'fail',
        'Every cell, with its extruded border, lies inside its sheet.',
        (n) => `${n} cell(s) reach outside their sheet.`,
      ),
    );
  }
  if (input.cells && input.expectedKeys) {
    const counts = new Map<string, number>();
    for (const c of input.cells) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
    const missing = input.expectedKeys.filter((k) => !counts.has(k));
    const extra = [...counts].filter(([k, n]) => n > 1 || !input.expectedKeys?.includes(k)).map(([k]) => k);
    checks.push(
      check(
        'frame-count',
        [...missing, ...extra],
        'fail',
        `All ${input.expectedKeys.length} planned frames are on the sheets, each once.`,
        (n) => `${n} frame(s) are missing from the sheets or appear more than once.`,
        { missing: missing.slice(0, 20), extra: extra.slice(0, 20) },
      ),
    );
  }

  const status = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generator: { name: 'td2d', version: CORE_VERSION },
    assetId: input.assetId,
    generatedAt: new Date().toISOString(),
    status,
    checks,
  };
}
