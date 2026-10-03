// Constants and pixel rules of the browser test fixture, shared by the Node setup and the tests.

export const FRAME = { width: 8, height: 8 };
export const PALETTE = ['#e04040', '#40c060', '#4060e0', '#f0d040', '#202020'];
export const DIRECTIONS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
export const CLIPS = [
  { name: 'walk', fps: 10, frames: 4, loop: true },
  { name: 'idle', fps: 5, frames: 2, loop: true },
  { name: 'attack', fps: 10, frames: 3, loop: false },
] as const;
export const HISTORY_ENTRY = '2026-10-01T12-00-00-000Z-0123456789ab';
/** Pixels of walk/s/001 the history entry has in another colour. */
export const CHANGED_PIXELS = 3;
export const BIG = { width: 4096, height: 4096 };
/**
 * Sprite pixels: a 2 x 4 body in the clip's colour whose x is the frame index, a head pixel in
 * the direction's colour at row 1, and a dark foot pixel at the pivot.
 */
export function spritePixel(clip: number, direction: number, frame: number, x: number, y: number): string | null {
  if (x === 4 && y === 7) return PALETTE[4] as string;
  if (y === 1 && x === direction % 8) return PALETTE[(direction % 3) + 1] as string;
  if (y >= 3 && y <= 6 && x >= frame && x < frame + 2) return PALETTE[clip % 4] as string;
  return null;
}
