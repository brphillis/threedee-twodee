import type { SheetSettingsT } from '@td2d/schema';
import { MaxRectsPacker } from 'maxrects-packer';
import { Td2dError } from '../errors.ts';
import { opaqueBounds } from '../pixel/bounds.ts';
import { createImage, type RgbaImage } from '../pixel/image.ts';

export interface SheetRow {
  readonly clip: string;
  readonly direction: string;
  /** Sprite keys in frame order. */
  readonly keys: readonly string[];
}

export interface SheetPage {
  /** Sheet name, also the stem of its image file: the asset name, plus the split group and page number. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface SheetCell {
  readonly key: string;
  readonly clip: string;
  readonly direction: string;
  readonly index: number;
  /** Index into the layout's pages. */
  readonly page: number;
  /** Top-left of the sprite pixels on the sheet, excluding any extruded border. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly trimmed: boolean;
  /** Where the cell's top-left pixel lies inside the untrimmed frame. */
  readonly offset: { readonly x: number; readonly y: number };
}

export interface SheetLayout {
  readonly frame: { readonly width: number; readonly height: number };
  readonly pages: readonly SheetPage[];
  readonly cells: readonly SheetCell[];
}

type Settings = Pick<
  SheetSettingsT,
  'layout' | 'order' | 'flow' | 'split' | 'trim' | 'padding' | 'extrude' | 'powerOfTwo' | 'maxSize'
>;

const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Sequences in the requested order: by clip first (plan order), or by direction first. */
function orderRows(rows: readonly SheetRow[], order: Settings['order']): SheetRow[] {
  if (order === 'clip-direction') return [...rows];
  const directions = [...new Set(rows.map((r) => r.direction))];
  return [...rows].sort(
    (a, b) => directions.indexOf(a.direction) - directions.indexOf(b.direction) || rows.indexOf(a) - rows.indexOf(b),
  );
}

/** Sequences grouped into the sheets the split asks for, each with its name suffix. */
function groupRows(rows: readonly SheetRow[], settings: Settings): { suffix: string; rows: SheetRow[] }[] {
  const by = (label: (r: SheetRow) => string) => {
    const groups = new Map<string, SheetRow[]>();
    for (const r of rows) groups.set(label(r), [...(groups.get(label(r)) ?? []), r]);
    return [...groups].map(([suffix, list]) => ({ suffix, rows: list }));
  };
  // Strips are one sheet per sequence already, so split has nothing to add.
  if (settings.layout === 'strips') return by((r) => `${r.clip}-${r.direction}`);
  if (settings.split === 'clip') return by((r) => r.clip);
  if (settings.split === 'direction') return by((r) => r.direction);
  return [{ suffix: '', rows: [...rows] }];
}

/**
 * Place every sprite on one or more sheets.
 *
 * - grid and strips: each clip-direction sequence is a row (or a column with flow "columns").
 *   A sheet that would exceed maxSize breaks between sequences into numbered sheets; a single
 *   sequence longer than maxSize is an error.
 * - packed: sprites (trimmed to their opaque pixels with trim) are packed with maxrects. Whole
 *   sequences are added to a sheet while everything still packs onto it, so a clip and
 *   direction is never split across sheets. Input is sorted by key, so packing is deterministic.
 *
 * Every cell takes `extrude` pixels on each side and cells are `padding` pixels apart.
 */
export function layoutSheets(
  rows: readonly SheetRow[],
  sprites: ReadonlyMap<string, RgbaImage>,
  frame: { width: number; height: number },
  settings: Settings,
  name: string,
): SheetLayout {
  const e = settings.extrude;
  const p = settings.padding;
  const pages: SheetPage[] = [];
  const cells: SheetCell[] = [];
  const size = (w: number, h: number) =>
    settings.powerOfTwo ? { width: nextPowerOfTwo(w), height: nextPowerOfTwo(h) } : { width: w, height: h };
  const tooBig = (what: string, w: number, h: number) =>
    new Td2dError(
      'E_GENERATION_FAILED',
      `${what} needs ${w} x ${h} pixels, more than sheet.maxSize ${settings.maxSize}.`,
      {
        hint: 'Raise sheet.maxSize, use layout "packed", split the sheet by clip or direction, or use fewer frames.',
      },
    );

  for (const group of groupRows(orderRows(rows, settings.order), settings)) {
    const base = group.suffix ? `${name}-${group.suffix}` : name;
    const first = pages.length;
    if (settings.layout === 'packed') {
      type Rect = {
        width: number;
        height: number;
        x: number;
        y: number;
        key: string;
        clip: string;
        direction: string;
        index: number;
        trim: { x: number; y: number; w: number; h: number };
      };
      const rectFor = (c: { key: string; clip: string; direction: string; index: number }): Rect => {
        const sprite = sprites.get(c.key);
        if (!sprite) throw new Td2dError('E_INTERNAL', `Sprite ${c.key} is missing from the sheet input.`);
        const bounds = settings.trim ? opaqueBounds(sprite) : { x: 0, y: 0, w: frame.width, h: frame.height };
        const trim = bounds ?? { x: 0, y: 0, w: 1, h: 1 };
        if (trim.w + 2 * e > settings.maxSize || trim.h + 2 * e > settings.maxSize)
          throw tooBig(`Sprite ${c.key}`, trim.w + 2 * e, trim.h + 2 * e);
        return { ...c, width: trim.w + 2 * e, height: trim.h + 2 * e, x: 0, y: 0, trim };
      };
      const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      /** Pack rects into one bin of at most maxSize, or return null when they need more. */
      const packOne = (rects: readonly Rect[]) => {
        const packer = new MaxRectsPacker<Rect>(settings.maxSize, settings.maxSize, p, {
          smart: true,
          pot: settings.powerOfTwo,
          square: false,
          allowRotation: false,
          border: 0,
        });
        packer.addArray([...rects].sort(byKey).map((r) => ({ ...r })));
        return packer.bins.length === 1 ? (packer.bins[0] as (typeof packer.bins)[number]) : null;
      };
      // Whole sequences go on a sheet while they still fit on one; then a new sheet starts.
      const sequences = group.rows.map((r) =>
        r.keys.map((key, index) => rectFor({ key, clip: r.clip, direction: r.direction, index })),
      );
      const sheetsOfRects: Rect[][] = [];
      for (const sequence of sequences) {
        const current = sheetsOfRects.at(-1);
        if (current && packOne([...current, ...sequence])) current.push(...sequence);
        else {
          if (!packOne(sequence)) {
            const r = sequence[0] as Rect;
            throw tooBig(`The ${r.clip} ${r.direction} sequence`, settings.maxSize + 1, settings.maxSize + 1);
          }
          sheetsOfRects.push([...sequence]);
        }
      }
      for (const [b, rects] of sheetsOfRects.entries()) {
        const bin = packOne(rects) as NonNullable<ReturnType<typeof packOne>>;
        pages.push({ name: sheetsOfRects.length > 1 ? `${base}-${b}` : base, ...size(bin.width, bin.height) });
        for (const r of bin.rects) {
          cells.push({
            key: r.key,
            clip: r.clip,
            direction: r.direction,
            index: r.index,
            page: first + b,
            x: r.x + e,
            y: r.y + e,
            w: r.trim.w,
            h: r.trim.h,
            trimmed: settings.trim,
            offset: { x: r.trim.x, y: r.trim.y },
          });
        }
      }
      continue;
    }
    // grid and strips: sequences along rows or columns, broken into pages between sequences.
    const cw = frame.width + 2 * e;
    const ch = frame.height + 2 * e;
    const along = settings.flow === 'rows' ? cw : ch;
    const across = settings.flow === 'rows' ? ch : cw;
    const longest = Math.max(1, ...group.rows.map((r) => r.keys.length));
    const length = longest * along + (longest - 1) * p;
    if (length > settings.maxSize) {
      throw tooBig(
        `A sequence of ${longest} frames`,
        settings.flow === 'rows' ? length : cw,
        settings.flow === 'rows' ? ch : length,
      );
    }
    const perPage = Math.max(1, Math.floor((settings.maxSize + p) / (across + p)));
    const chunks: SheetRow[][] = [];
    for (let i = 0; i < group.rows.length; i += perPage) chunks.push(group.rows.slice(i, i + perPage));
    for (const [c, chunk] of chunks.entries()) {
      const depth = chunk.length * across + (chunk.length - 1) * p;
      const w = settings.flow === 'rows' ? length : depth;
      const h = settings.flow === 'rows' ? depth : length;
      pages.push({ name: chunks.length > 1 ? `${base}-${c}` : base, ...size(w, h) });
      for (const [r, row] of chunk.entries()) {
        for (const [i, key] of row.keys.entries()) {
          const a = i * (along + p) + e;
          const b = r * (across + p) + e;
          cells.push({
            key,
            clip: row.clip,
            direction: row.direction,
            index: i,
            page: first + c,
            x: settings.flow === 'rows' ? a : b,
            y: settings.flow === 'rows' ? b : a,
            w: frame.width,
            h: frame.height,
            trimmed: false,
            offset: { x: 0, y: 0 },
          });
        }
      }
    }
  }
  // Cells in sequence order (as rows list them), whatever order packing placed them in.
  const order = new Map(
    orderRows(rows, settings.order)
      .flatMap((r) => r.keys)
      .map((k, i) => [k, i]),
  );
  cells.sort((a, b) => (order.get(a.key) as number) - (order.get(b.key) as number));
  return { frame, pages, cells };
}

/** Draw the cells of one page, extruding each by `extrude` pixels of its own edge colours. */
export function compositePage(
  layout: SheetLayout,
  page: number,
  sprites: ReadonlyMap<string, RgbaImage>,
  extrude: number,
): RgbaImage {
  const info = layout.pages[page] as SheetPage;
  const sheet = createImage(info.width, info.height);
  for (const cell of layout.cells) {
    if (cell.page !== page) continue;
    const sprite = sprites.get(cell.key);
    if (!sprite) throw new Td2dError('E_INTERNAL', `Sprite ${cell.key} is missing from the sheet input.`);
    if (sprite.width !== layout.frame.width || sprite.height !== layout.frame.height) {
      throw new Td2dError(
        'E_INTERNAL',
        `Sprite ${cell.key} is ${sprite.width} x ${sprite.height}, expected ${layout.frame.width} x ${layout.frame.height}.`,
      );
    }
    for (let y = -extrude; y < cell.h + extrude; y++) {
      for (let x = -extrude; x < cell.w + extrude; x++) {
        const sx = cell.offset.x + Math.min(cell.w - 1, Math.max(0, x));
        const sy = cell.offset.y + Math.min(cell.h - 1, Math.max(0, y));
        const i = (sy * sprite.width + sx) * 4;
        sheet.rgba.set(sprite.rgba.subarray(i, i + 4), ((cell.y + y) * sheet.width + cell.x + x) * 4);
      }
    }
  }
  return sheet;
}

/** Rebuild a full frame from a cell, for checking that trimming kept every visible pixel in place. */
export function cellToFrame(sheet: RgbaImage, cell: SheetCell, frame: { width: number; height: number }): RgbaImage {
  const out = createImage(frame.width, frame.height);
  for (let y = 0; y < cell.h; y++) {
    for (let x = 0; x < cell.w; x++) {
      const i = ((cell.y + y) * sheet.width + cell.x + x) * 4;
      out.rgba.set(sheet.rgba.subarray(i, i + 4), ((cell.offset.y + y) * frame.width + cell.offset.x + x) * 4);
    }
  }
  return out;
}
