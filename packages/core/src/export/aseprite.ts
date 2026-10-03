import { AsepriteSheet, AsepriteSheetArray, type AsepriteSheetT } from '@td2d/schema';
import type { SheetCell, SheetLayout } from '../sheet/layout.ts';
import { CORE_VERSION } from '../version.ts';
import { type Exporter, frameDurationMs, sequenceName, writeChecked } from './registry.ts';

export interface AsepriteInput {
  readonly assetId: string;
  readonly image: string;
  readonly layout: SheetLayout;
  /** The page to describe. */
  readonly page: number;
  readonly fpsByClip: Readonly<Record<string, number>>;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly frameNames: 'index' | 'descriptive';
}

export function asepriteFrameName(assetId: string, clip: string, direction: string, index: number): string {
  return `${assetId} (${clip}_${direction}) ${index}.png`;
}

/**
 * Aseprite JSON Hash data for one sheet, in the shape Aseprite's doc_exporter.cpp writes:
 * frames in sheet order, one frame tag per clip and direction (forward, with frame durations
 * from the clip's fps), and a "pivot" slice. With index frame names (Aseprite's "{frame}"),
 * Phaser's load.aseprite and createFromAseprite work unchanged.
 */
export function buildAsepriteSheet(input: AsepriteInput): AsepriteSheetT {
  const cells = input.layout.cells.filter((c) => c.page === input.page);
  const page = input.layout.pages[input.page] as { width: number; height: number };
  const frames: AsepriteSheetT['frames'] = {};
  const tags: AsepriteSheetT['meta']['frameTags'] = [];
  const { width, height } = input.layout.frame;
  cells.forEach((cell: SheetCell, i) => {
    const name =
      input.frameNames === 'index'
        ? String(i)
        : asepriteFrameName(input.assetId, cell.clip, cell.direction, cell.index);
    frames[name] = {
      frame: { x: cell.x, y: cell.y, w: cell.w, h: cell.h },
      rotated: false,
      trimmed: cell.trimmed,
      spriteSourceSize: { x: cell.offset.x, y: cell.offset.y, w: cell.w, h: cell.h },
      sourceSize: { w: width, h: height },
      duration: frameDurationMs(input.fpsByClip[cell.clip] ?? 10),
    };
    const tag = sequenceName(cell.clip, cell.direction);
    const last = tags.at(-1);
    if (last && last.name === tag) last.to = i;
    else tags.push({ name: tag, from: i, to: i, direction: 'forward', color: '#000000ff' });
  });
  return {
    frames,
    meta: {
      app: 'td2d',
      version: CORE_VERSION,
      image: input.image,
      format: 'RGBA8888',
      size: { w: page.width, h: page.height },
      scale: '1',
      frameTags: tags,
      layers: [],
      slices:
        cells.length > 0
          ? [
              {
                name: 'pivot',
                color: '#0000ffff',
                keys: [
                  {
                    frame: 0,
                    bounds: { x: 0, y: 0, w: width, h: height },
                    pivot: { x: input.pivot.x, y: input.pivot.y },
                  },
                ],
              },
            ]
          : [],
    },
  };
}

/** The Aseprite data file for a sheet image. */
export const asepriteDataFile = (image: string) => image.replace(/\.png$/, '.json');

export const asepriteExporter: Exporter = {
  id: 'aseprite-json',
  version: 2,
  description: 'Aseprite JSON (hash or array) per sheet, with frame tags per clip and direction and a pivot slice.',
  async write(ctx) {
    const { variant, frameNames } = ctx.asset.export.aseprite;
    const fpsByClip = Object.fromEntries(Object.entries(ctx.asset.animation.clips).map(([k, c]) => [k, c.fps]));
    return ctx.images.map((image, page) => {
      const sheet = buildAsepriteSheet({
        assetId: ctx.asset.id,
        image,
        layout: ctx.layout,
        page,
        fpsByClip,
        pivot: ctx.pivot,
        frameNames,
      });
      const file = asepriteDataFile(image);
      if (variant === 'hash') return writeChecked(ctx.dir, file, sheet, AsepriteSheet, 'Aseprite');
      const array = { ...sheet, frames: Object.entries(sheet.frames).map(([filename, f]) => ({ filename, ...f })) };
      return writeChecked(ctx.dir, file, array, AsepriteSheetArray, 'Aseprite');
    });
  },
};
