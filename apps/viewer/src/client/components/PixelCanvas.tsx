import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hexOf, paletteIndexOf } from '../lib/palette.ts';
import {
  centred,
  clampPan,
  fitZoom,
  intersects,
  panBy,
  type Rect,
  type Size,
  screenToImage,
  stepZoom,
  type View,
  visibleRegion,
  zoomAt,
} from '../lib/zoom.ts';

export type Background =
  | { readonly kind: 'checker'; readonly size: number }
  | { readonly kind: 'solid'; readonly colour: string };

/** The backgrounds `b` cycles through. A custom colour can be picked as well. */
export const BACKGROUNDS: readonly Background[] = [
  { kind: 'checker', size: 8 },
  { kind: 'checker', size: 16 },
  { kind: 'solid', colour: '#ffffff' },
  { kind: 'solid', colour: '#20232b' },
  { kind: 'solid', colour: '#ff00ff' },
];

export const backgroundLabel = (b: Background): string => (b.kind === 'checker' ? `checker ${b.size}` : b.colour);
export const sameBackground = (a: Background, b: Background): boolean => backgroundLabel(a) === backgroundLabel(b);

export interface Overlay extends Rect {
  readonly id: string;
  readonly colour: string;
}

export interface Readout {
  readonly x: number;
  readonly y: number;
  readonly hex: string;
  readonly alpha: number;
  readonly paletteIndex: number | null;
  /** The overlay under the pointer, if any. */
  readonly overlay: string | null;
}

/** Zoom above which the pixel grid is drawn when enabled. */
export const GRID_MIN_ZOOM = 8;

export interface PixelCanvasProps {
  readonly image: CanvasImageSource | null;
  readonly width: number;
  readonly height: number;
  /** Integer zoom, or null to fit the image to the viewport (the fitted zoom is reported back). */
  readonly zoom: number | null;
  readonly onZoomChange: (zoom: number) => void;
  readonly background: Background;
  readonly overlays?: readonly Overlay[];
  readonly showOverlays?: boolean;
  readonly selected?: string | null;
  readonly highlighted?: ReadonlySet<string>;
  /** Points drawn as small crosses, in image pixels: the pivots. */
  readonly markers?: readonly { readonly x: number; readonly y: number }[];
  readonly pixelGrid?: boolean;
  /** The palette to look hovered colours up in, given the hovered overlay. */
  readonly paletteFor?: (overlay: string | null) => readonly string[];
  readonly onSelect?: (overlay: string | null) => void;
  readonly onHover?: (readout: Readout | null) => void;
  readonly label: string;
  /** Drawn under the image, such as an onion skin. Same size as the image. */
  readonly underlay?: CanvasImageSource | null;
  readonly underlayAlpha?: number;
  readonly children?: ReactNode;
}

function overlayAt(overlays: readonly Overlay[], x: number, y: number): Overlay | undefined {
  // Last drawn wins, so the topmost of overlapping cells is picked.
  for (let i = overlays.length - 1; i >= 0; i--) {
    const o = overlays[i] as Overlay;
    if (x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h) return o;
  }
  return undefined;
}

function checkerPattern(ctx: CanvasRenderingContext2D, size: number): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = size * 2;
  tile.height = size * 2;
  const t = tile.getContext('2d');
  if (!t) return null;
  t.fillStyle = '#cfd3da';
  t.fillRect(0, 0, size * 2, size * 2);
  t.fillStyle = '#eef0f3';
  t.fillRect(0, 0, size, size);
  t.fillRect(size, size, size, size);
  return ctx.createPattern(tile, 'repeat');
}

/**
 * A pixel-exact view of an image: integer zoom 1x to 32x with the wheel or keys, pan by dragging,
 * a background, an optional pixel grid, cell rectangles and a readout of the hovered pixel. Only
 * the visible part of the image is drawn.
 */
export function PixelCanvas(props: PixelCanvasProps) {
  const {
    image,
    width,
    height,
    zoom,
    onZoomChange,
    background,
    overlays = [],
    showOverlays = true,
    selected = null,
    highlighted,
    markers,
    pixelGrid = false,
    paletteFor,
    onSelect,
    onHover,
    label,
    underlay,
    underlayAlpha = 0.35,
    children,
  } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ zoom: zoom ?? 1, panX: 0, panY: 0 });
  const [readout, setReadout] = useState<Readout | null>(null);
  const placed = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const readback = useRef<{ source: CanvasImageSource; ctx: CanvasRenderingContext2D } | null>(null);
  const image_: Size = { width, height };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Follow the zoom prop: fit when null, otherwise zoom about the viewport centre.
  useLayoutEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;
    const size = { width, height };
    if (zoom === null) {
      const z = fitZoom(size, viewport);
      setView(centred(size, viewport, z));
      placed.current = true;
      onZoomChange(z);
      return;
    }
    if (!placed.current) {
      setView(centred(size, viewport, zoom));
      placed.current = true;
      return;
    }
    setView((v) =>
      v.zoom === zoom ? v : clampPan(zoomAt(v, zoom, viewport.width / 2, viewport.height / 2), size, viewport),
    );
  }, [zoom, viewport, width, height, onZoomChange]);

  const region = visibleRegion(view, image_, viewport);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || viewport.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(viewport.width * dpr);
    const bh = Math.round(viewport.height * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    const r = visibleRegion(view, { width, height }, viewport);
    if (!r) return;
    const z = view.zoom;
    const dx = view.panX + r.x * z;
    const dy = view.panY + r.y * z;
    const dw = r.w * z;
    const dh = r.h * z;
    if (background.kind === 'checker') {
      const pattern = checkerPattern(ctx, background.size);
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translateSelf(view.panX, view.panY));
        ctx.fillStyle = pattern;
      }
    } else {
      ctx.fillStyle = background.colour;
    }
    ctx.fillRect(dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = false;
    if (underlay) {
      ctx.globalAlpha = underlayAlpha;
      ctx.drawImage(underlay, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (image) ctx.drawImage(image, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
    if (pixelGrid && z > GRID_MIN_ZOOM) {
      ctx.beginPath();
      for (let x = r.x; x <= r.x + r.w; x++) {
        const sx = Math.round(view.panX + x * z) + 0.5;
        ctx.moveTo(sx, dy);
        ctx.lineTo(sx, dy + dh);
      }
      for (let y = r.y; y <= r.y + r.h; y++) {
        const sy = Math.round(view.panY + y * z) + 0.5;
        ctx.moveTo(dx, sy);
        ctx.lineTo(dx + dw, sy);
      }
      ctx.strokeStyle = 'rgba(90, 96, 110, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (showOverlays || highlighted?.size || selected) {
      for (const o of overlays) {
        const isSelected = o.id === selected;
        const isHighlighted = highlighted?.has(o.id) ?? false;
        if (!showOverlays && !isSelected && !isHighlighted) continue;
        if (!intersects(o, r)) continue;
        const ox = view.panX + o.x * z;
        const oy = view.panY + o.y * z;
        if (isHighlighted) {
          ctx.fillStyle = 'rgba(255, 64, 64, 0.28)';
          ctx.fillRect(ox, oy, o.w * z, o.h * z);
        }
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = isHighlighted ? '#ff4040' : isSelected ? '#ffffff' : o.colour;
        ctx.strokeRect(ox + 0.5, oy + 0.5, o.w * z - 1, o.h * z - 1);
        if (isSelected) {
          ctx.strokeStyle = o.colour;
          ctx.lineWidth = 1;
          ctx.strokeRect(ox + 2.5, oy + 2.5, o.w * z - 5, o.h * z - 5);
        }
      }
    }
    if (markers && showOverlays) {
      ctx.strokeStyle = '#ff3d7f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of markers) {
        const mx = Math.round(view.panX + m.x * z) + 0.5;
        const my = Math.round(view.panY + m.y * z) + 0.5;
        ctx.moveTo(mx - 4, my);
        ctx.lineTo(mx + 5, my);
        ctx.moveTo(mx, my - 4);
        ctx.lineTo(mx, my + 5);
      }
      ctx.stroke();
    }
  }, [
    image,
    underlay,
    underlayAlpha,
    width,
    height,
    view,
    viewport,
    background,
    overlays,
    showOverlays,
    selected,
    highlighted,
    markers,
    pixelGrid,
  ]);

  const pixelAt = useCallback(
    (x: number, y: number): [number, number, number, number] | null => {
      if (!image) return null;
      if (readback.current?.source !== image) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, width);
        c.height = Math.max(1, height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0);
        readback.current = { source: image, ctx };
      }
      const d = readback.current.ctx.getImageData(x, y, 1, 1).data;
      return [d[0] as number, d[1] as number, d[2] as number, d[3] as number];
    },
    [image, width, height],
  );

  const pointer = (event: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { sx: event.clientX - rect.left, sy: event.clientY - rect.top } : { sx: 0, sy: 0 };
  };

  const hover = (sx: number, sy: number) => {
    const p = screenToImage(view, image_, sx, sy);
    const px = p ? pixelAt(p.x, p.y) : null;
    if (!p || !px) {
      setReadout(null);
      onHover?.(null);
      return;
    }
    const over = overlayAt(overlays, p.x, p.y)?.id ?? null;
    const hex = hexOf(px[0], px[1], px[2]);
    const next: Readout = {
      x: p.x,
      y: p.y,
      hex,
      alpha: px[3],
      paletteIndex: px[3] > 0 && paletteFor ? paletteIndexOf(hex, paletteFor(over)) : null,
      overlay: over,
    };
    setReadout(next);
    onHover?.(next);
  };

  // The wheel listener must not be passive, so the page does not scroll while zooming.
  const wheelState = useRef({ view, viewport, width, height, onZoomChange });
  wheelState.current = { view, viewport, width, height, onZoomChange };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const s = wheelState.current;
      const rect = el.getBoundingClientRect();
      const next = stepZoom(s.view.zoom, event.deltaY < 0 ? 1 : -1);
      if (next === s.view.zoom) return;
      const v = clampPan(
        zoomAt(s.view, next, event.clientX - rect.left, event.clientY - rect.top),
        { width: s.width, height: s.height },
        s.viewport,
      );
      setView(v);
      s.onZoomChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={box}
      className="pixel-canvas"
      data-zoom={view.zoom}
      data-pan={`${view.panX},${view.panY}`}
      data-visible={region ? `${region.x},${region.y},${region.w},${region.h}` : ''}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const { sx, sy } = pointer(event);
        drag.current = { x: sx, y: sy, moved: false, id: event.pointerId };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointers (tests, some pens) cannot be captured; dragging still works inside.
        }
      }}
      onPointerMove={(event) => {
        const { sx, sy } = pointer(event);
        const d = drag.current;
        if (d && d.id === event.pointerId) {
          if (!d.moved && Math.hypot(sx - d.x, sy - d.y) > 3) d.moved = true;
          if (d.moved) {
            setView((v) => clampPan(panBy(v, sx - d.x, sy - d.y), image_, viewport));
            d.x = sx;
            d.y = sy;
          }
        }
        hover(sx, sy);
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        const { sx, sy } = pointer(event);
        const p = screenToImage(view, image_, sx, sy);
        onSelect?.(p ? (overlayAt(overlays, p.x, p.y)?.id ?? null) : null);
      }}
      onPointerLeave={() => {
        if (drag.current) return;
        setReadout(null);
        onHover?.(null);
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ width: viewport.width, height: viewport.height }}
      />
      <div
        className="readout"
        data-readout
        data-x={readout?.x ?? ''}
        data-y={readout?.y ?? ''}
        data-hex={readout?.hex ?? ''}
        data-palette-index={readout?.paletteIndex ?? ''}
      >
        {readout ? (
          <>
            <span>
              {readout.x}, {readout.y}
            </span>
            <span className="swatch" style={{ background: readout.alpha ? readout.hex : 'transparent' }} />
            <span>{readout.alpha ? readout.hex : 'transparent'}</span>
            {readout.alpha > 0 && readout.alpha < 255 && <span>alpha {readout.alpha}</span>}
            {readout.paletteIndex !== null && <span>palette #{readout.paletteIndex}</span>}
            {readout.overlay && <span className="muted">{readout.overlay}</span>}
          </>
        ) : (
          <span className="muted">{view.zoom}x. Drag to pan, wheel to zoom.</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** A small fixed-zoom sprite, for direction grids, thumbnails and compare panes. */
export function SpriteCanvas(props: {
  readonly image: CanvasImageSource | null;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly background: Background;
  readonly underlay?: CanvasImageSource | null;
  readonly label: string;
  readonly className?: string;
  readonly data?: Record<string, string | number>;
}) {
  const { image, width, height, zoom, background, underlay, label, className, data } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width * zoom;
    c.height = height * zoom;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (background.kind === 'checker') {
      const pattern = checkerPattern(ctx, background.size);
      if (pattern) ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = background.colour;
    }
    ctx.fillRect(0, 0, c.width, c.height);
    if (underlay) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(underlay, 0, 0, width, height, 0, 0, c.width, c.height);
      ctx.globalAlpha = 1;
    }
    if (image) ctx.drawImage(image, 0, 0, width, height, 0, 0, c.width, c.height);
  }, [image, underlay, width, height, zoom, background]);
  const attributes = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]));
  return (
    <canvas ref={ref} role="img" aria-label={label} className={`sprite-canvas ${className ?? ''}`} {...attributes} />
  );
}
