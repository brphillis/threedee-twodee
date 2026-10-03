import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { type Background, type Overlay, PixelCanvas } from '../src/client/components/PixelCanvas.tsx';
import { fixture, loadImage, mount, pointer, q, recordDraws, unmountAll, until, wait } from './helpers.tsx';

afterEach(unmountAll);

const CHECKER: Background = { kind: 'checker', size: 8 };

function Harness(props: {
  image: CanvasImageSource;
  width: number;
  height: number;
  start: number | null;
  overlays?: Overlay[];
  grid?: boolean;
  palette?: string[];
  onSelect?: (id: string | null) => void;
}) {
  const [zoom, setZoom] = useState<number | null>(props.start);
  return (
    <div style={{ position: 'relative', flex: 1 }} data-zoom-state={zoom ?? ''}>
      <PixelCanvas
        image={props.image}
        width={props.width}
        height={props.height}
        zoom={zoom}
        onZoomChange={setZoom}
        background={CHECKER}
        overlays={props.overlays ?? []}
        pixelGrid={props.grid ?? false}
        {...(props.palette ? { paletteFor: () => props.palette as string[] } : {})}
        {...(props.onSelect ? { onSelect: props.onSelect } : {})}
        label="test canvas"
      />
      <button type="button" data-set-zoom onClick={() => setZoom((z) => (z === 12 ? 8 : 12))}>
        toggle
      </button>
    </div>
  );
}

describe('PixelCanvas', () => {
  it('fits the image to the viewport at an integer zoom', async () => {
    const f = await fixture();
    const img = await loadImage(`${f.detail.files}/sheets/hero.png`);
    const host = mount(<Harness image={img} width={img.width} height={img.height} start={null} />, {
      width: 400,
      height: 600,
    });
    const canvas = await until(() =>
      host.querySelector<HTMLElement>('.pixel-canvas[data-zoom]:not([data-visible=""])'),
    );
    // The hero sheet is 32 x 192: 400 x 600 less padding fits 2x by height (568 / 192 = 2.9 -> 2).
    expect(Number(canvas.dataset.zoom)).toBe(2);
    expect(q(host, '[data-zoom-state]').dataset.zoomState).toBe('2');
    expect(canvas.dataset.visible).toBe(`0,0,${img.width},${img.height}`);
  });

  it('draws only the visible region of a 4096 px sheet at 32x', async () => {
    const f = await fixture();
    const img = await loadImage(f.big);
    const viewport = { width: 640, height: 480 };
    let host: HTMLElement | undefined;
    const durations: number[] = [];
    const draws = await recordDraws(async () => {
      host = mount(<Harness image={img} width={img.width} height={img.height} start={32} />, viewport);
      await until(() => host?.querySelector('.pixel-canvas[data-zoom="32"]:not([data-visible=""])'));
      await wait(50);
    }, durations);
    const sheetDraws = draws.filter((args) => args[0] === img);
    const sheetDurations = durations.filter((_, i) => draws[i]?.[0] === img);
    expect(sheetDraws.length).toBeGreaterThan(0);
    for (const args of sheetDraws) {
      const [, , , sw, sh] = args as [unknown, number, number, number, number];
      // At most the viewport in image pixels, plus one partial pixel on each side.
      expect(sw).toBeLessThanOrEqual(Math.ceil(viewport.width / 32) + 1);
      expect(sh).toBeLessThanOrEqual(Math.ceil(viewport.height / 32) + 1);
    }
    const visible =
      q(host as HTMLElement, '.pixel-canvas')
        .dataset.visible?.split(',')
        .map(Number) ?? [];
    expect(visible[2]).toBeLessThanOrEqual(21);
    expect(visible[3]).toBeLessThanOrEqual(16);
    // Drawing a screenful of a 4096 px sheet is cheap, however busy the machine.
    expect(Math.max(...sheetDurations)).toBeLessThan(50);
  });

  it('reads out the hovered pixel: position, colour and palette index', async () => {
    const f = await fixture();
    const img = await loadImage(`${f.detail.files}/sheets/hero.png`);
    const palette = f.detail.manifest.palette.colors as string[];
    const host = mount(<Harness image={img} width={img.width} height={img.height} start={10} palette={palette} />, {
      width: 600,
      height: 600,
    });
    const el = await until(() =>
      host.querySelector<HTMLElement>('.pixel-canvas[data-zoom="10"]:not([data-visible=""])'),
    );
    // At 10x and centred horizontally (32 px wide sheet), panX = (600 - 320) / 2 = 140. The sheet
    // is 1920 px tall, so it starts 16 px from the top. Pixel (4, 7) is the dark foot pixel.
    pointer(el, 'pointermove', 140 + 4 * 10 + 5, 16 + 7 * 10 + 5);
    const readout = await until(() => host.querySelector<HTMLElement>('[data-readout][data-x="4"]'));
    expect(readout.dataset.y).toBe('7');
    expect(readout.dataset.hex).toBe(palette[4]);
    expect(readout.dataset.paletteIndex).toBe('4');
    // A body pixel of walk/s/000: x 0..1, rows 3..6, in the walk colour.
    pointer(el, 'pointermove', 140 + 0 * 10 + 5, 16 + 4 * 10 + 5);
    await until(() => host.querySelector('[data-readout][data-x="0"][data-y="4"]'));
    expect(q(host, '[data-readout]').dataset.hex).toBe(palette[0]);
    expect(q(host, '[data-readout]').dataset.paletteIndex).toBe('0');
    pointer(el, 'pointerleave', 0, 0);
    await until(() => q(host, '[data-readout]').dataset.x === '');
  });

  it('selects the clicked overlay and pans on drag without selecting', async () => {
    const f = await fixture();
    const img = await loadImage(`${f.detail.files}/sheets/hero.png`);
    const overlays: Overlay[] = f.detail.manifest.cells.map((c) => ({
      id: c.key,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      colour: '#f0f',
    }));
    const picked: (string | null)[] = [];
    const host = mount(
      <Harness
        image={img}
        width={img.width}
        height={img.height}
        start={4}
        overlays={overlays}
        onSelect={(id) => picked.push(id)}
      />,
      { width: 400, height: 400 },
    );
    const el = await until(() =>
      host.querySelector<HTMLElement>('.pixel-canvas[data-zoom="4"]:not([data-visible=""])'),
    );
    // panX = (400 - 128) / 2 = 136, panY = 16. Cell walk/s/001 spans x 8..15, y 0..7.
    pointer(el, 'pointerdown', 136 + 10 * 4, 16 + 3 * 4);
    pointer(el, 'pointerup', 136 + 10 * 4, 16 + 3 * 4);
    expect(picked).toEqual(['walk/s/001']);
    const before = el.dataset.visible;
    pointer(el, 'pointerdown', 200, 200);
    pointer(el, 'pointermove', 200, 120);
    pointer(el, 'pointermove', 200, 40);
    pointer(el, 'pointerup', 200, 40);
    await until(() => el.dataset.visible !== before, 2000, 'the view to pan');
    expect(picked).toEqual(['walk/s/001']);
    // Clicking outside every cell clears the selection.
    pointer(el, 'pointerdown', 5, 390);
    pointer(el, 'pointerup', 5, 390);
    expect(picked.at(-1)).toBeNull();
  });

  it('zooms with the wheel about the cursor', async () => {
    const f = await fixture();
    const img = await loadImage(`${f.detail.files}/sheets/hero.png`);
    const host = mount(<Harness image={img} width={img.width} height={img.height} start={4} />, {
      width: 400,
      height: 400,
    });
    const el = await until(() =>
      host.querySelector<HTMLElement>('.pixel-canvas[data-zoom="4"]:not([data-visible=""])'),
    );
    // Hover pixel (5, 20), then zoom in: the same pixel must stay under the cursor.
    const sx = 136 + 5 * 4 + 2;
    const sy = 16 + 20 * 4 + 2;
    pointer(el, 'pointermove', sx, sy);
    await until(() => host.querySelector('[data-readout][data-x="5"][data-y="20"]'));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: r.left + sx,
        clientY: r.top + sy,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => el.dataset.zoom === '5');
    expect(q(host, '[data-zoom-state]').dataset.zoomState).toBe('5');
    pointer(el, 'pointermove', sx, sy);
    await until(() => host.querySelector('[data-readout][data-x="5"][data-y="20"]'), 2000, 'the anchored pixel');
  });

  it('draws the pixel grid only above 8x', async () => {
    const f = await fixture();
    const img = await loadImage(`${f.detail.files}/sheets/hero.png`);
    const lineTo = CanvasRenderingContext2D.prototype.lineTo;
    let lines = 0;
    CanvasRenderingContext2D.prototype.lineTo = function (this: CanvasRenderingContext2D, x: number, y: number) {
      lines++;
      return lineTo.call(this, x, y);
    };
    try {
      const host = mount(<Harness image={img} width={img.width} height={img.height} start={8} grid />, {
        width: 400,
        height: 400,
      });
      await until(() => host.querySelector('.pixel-canvas[data-zoom="8"]:not([data-visible=""])'));
      await wait(30);
      expect(lines).toBe(0);
      (host.querySelector('[data-set-zoom]') as HTMLElement).click();
      await until(() => host.querySelector('.pixel-canvas[data-zoom="12"]'));
      await wait(30);
      // One line per pixel column and row boundary of the visible region.
      expect(lines).toBeGreaterThan(32);
    } finally {
      CanvasRenderingContext2D.prototype.lineTo = lineTo;
    }
  });
});
