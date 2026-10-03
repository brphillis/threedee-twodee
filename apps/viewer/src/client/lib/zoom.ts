// Zoom and pan maths for the pixel canvas. No DOM: unit tested in Node.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 32;
/** The zoom levels the toolbar, keys and wheel step through. */
export const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];

/** Integer zoom and the screen position, in CSS pixels, of the image's top-left corner. */
export interface View {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
}

/** The next zoom step in `direction` from `zoom`, which need not be a step itself. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const z = clampZoom(zoom);
  if (direction > 0) return ZOOM_STEPS.find((s) => s > z) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z) ?? MIN_ZOOM;
}

/** The largest integer zoom at which the whole image fits the viewport, at least 1. */
export function fitZoom(image: Size, viewport: Size, padding = 16): number {
  if (image.width <= 0 || image.height <= 0) return MIN_ZOOM;
  const byWidth = Math.floor((viewport.width - padding * 2) / image.width);
  const byHeight = Math.floor((viewport.height - padding * 2) / image.height);
  return clampZoom(Math.min(byWidth, byHeight));
}

/**
 * The image centred in the viewport at `zoom`, on whole pixels. Along an axis where it is larger
 * than the viewport it starts `padding` from the edge instead, so its top-left is visible.
 */
export function centred(image: Size, viewport: Size, zoom: number, padding = 16): View {
  const z = clampZoom(zoom);
  const place = (space: number, length: number) =>
    length <= space ? Math.round((space - length) / 2) : Math.min(padding, Math.round((space - length) / 2) + length);
  return { zoom: z, panX: place(viewport.width, image.width * z), panY: place(viewport.height, image.height * z) };
}

/** Change zoom while keeping the image point under (anchorX, anchorY) where it is on screen. */
export function zoomAt(view: View, zoom: number, anchorX: number, anchorY: number): View {
  const z = clampZoom(zoom);
  if (z === view.zoom) return view;
  const imageX = (anchorX - view.panX) / view.zoom;
  const imageY = (anchorY - view.panY) / view.zoom;
  return { zoom: z, panX: Math.round(anchorX - imageX * z), panY: Math.round(anchorY - imageY * z) };
}

/** Move the view by a screen delta. */
export function panBy(view: View, dx: number, dy: number): View {
  return { zoom: view.zoom, panX: Math.round(view.panX + dx), panY: Math.round(view.panY + dy) };
}

/** Keep at least `margin` screen pixels of the image inside the viewport, so it cannot be lost. */
export function clampPan(view: View, image: Size, viewport: Size, margin = 32): View {
  const w = image.width * view.zoom;
  const h = image.height * view.zoom;
  const mx = Math.min(margin, w);
  const my = Math.min(margin, h);
  const panX = Math.min(viewport.width - mx, Math.max(mx - w, view.panX));
  const panY = Math.min(viewport.height - my, Math.max(my - h, view.panY));
  return panX === view.panX && panY === view.panY ? view : { zoom: view.zoom, panX, panY };
}

/** The image pixel under a screen point, or null when the point is outside the image. */
export function screenToImage(view: View, image: Size, sx: number, sy: number): { x: number; y: number } | null {
  const x = Math.floor((sx - view.panX) / view.zoom);
  const y = Math.floor((sy - view.panY) / view.zoom);
  return x >= 0 && y >= 0 && x < image.width && y < image.height ? { x, y } : null;
}

/**
 * The part of the image the viewport shows, in whole image pixels, or null when none of it is
 * visible. The canvas draws only this region, so a 4096 px sheet at 32x costs what the screen does.
 */
export function visibleRegion(view: View, image: Size, viewport: Size): Rect | null {
  const x0 = Math.max(0, Math.floor(-view.panX / view.zoom));
  const y0 = Math.max(0, Math.floor(-view.panY / view.zoom));
  const x1 = Math.min(image.width, Math.ceil((viewport.width - view.panX) / view.zoom));
  const y1 = Math.min(image.height, Math.ceil((viewport.height - view.panY) / view.zoom));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Whether two rectangles overlap. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
