// Cell lookups and tag colours. No DOM.
import type { ManifestT } from '@td2d/schema';

export type Cell = ManifestT['cells'][number];

/** A distinct, readable colour per clip (the Aseprite tag), stable for a given clip order. */
export function tagColour(clips: readonly string[], clip: string): string {
  const i = Math.max(0, clips.indexOf(clip));
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue} 85% 58%)`;
}

/** The frames of one clip in one direction, in order. */
export function sequence(manifest: ManifestT, clip: string, direction: string): Cell[] {
  return manifest.cells.filter((c) => c.clip === clip && c.direction === direction).sort((a, b) => a.index - b.index);
}

export function cellsByKey(manifest: ManifestT): Map<string, Cell> {
  return new Map(manifest.cells.map((c) => [c.key, c]));
}

/** The eight compass directions in screen order for a 3 x 3 grid, with the centre empty. */
export const COMPASS_GRID: readonly (string | null)[] = ['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'];

/**
 * Where each direction goes when all play at once: a compass grid when every name is a compass
 * point, else one row in manifest order.
 */
export function directionLayout(directions: readonly string[]): { columns: number; slots: (string | null)[] } {
  const compass = new Set(COMPASS_GRID.filter((d): d is string => d !== null));
  if (directions.length > 1 && directions.every((d) => compass.has(d))) {
    const present = new Set(directions);
    return { columns: 3, slots: COMPASS_GRID.map((d) => (d && present.has(d) ? d : null)) };
  }
  return { columns: Math.max(1, directions.length), slots: [...directions] };
}

/** The palette a cell is drawn with: its clip's own when the palette is per clip. */
export function paletteFor(manifest: ManifestT, clip: string | null): readonly string[] {
  if (clip && manifest.palette.byClip?.[clip]) return manifest.palette.byClip[clip] ?? [];
  return manifest.palette.colors;
}
