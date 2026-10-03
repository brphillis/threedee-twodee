import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetSummary } from '../src/client/data.ts';
import { COMPASS_GRID, directionLayout, tagColour } from '../src/client/lib/cells.ts';
import { changedPixels, diffImages, pad } from '../src/client/lib/diff.ts';
import { age, allTags, DEFAULT_QUERY, filterAssets } from '../src/client/lib/library.ts';
import { countColours, hexOf, mergeSwatches, paletteIndexOf } from '../src/client/lib/palette.ts';
import { FrameClock, finished, frameAt, type Scheduler, startPlayback } from '../src/client/lib/playback.ts';
import { assetHref, formatHash, parseHash, TABS } from '../src/client/lib/route.ts';
import { isTyping, type SCOPES, SHORTCUTS, shortcutFor } from '../src/client/lib/shortcuts.ts';
import {
  centred,
  clampPan,
  clampZoom,
  fitZoom,
  intersects,
  panBy,
  screenToImage,
  stepZoom,
  visibleRegion,
  ZOOM_STEPS,
  zoomAt,
} from '../src/client/lib/zoom.ts';

describe('zoom and pan maths', () => {
  it('clamps zoom to integers from 1 to 32 and steps through the zoom levels', () => {
    expect([clampZoom(0), clampZoom(2.4), clampZoom(2.6), clampZoom(99), clampZoom(Number.NaN)]).toEqual([
      1, 2, 3, 32, 1,
    ]);
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(7, 1)).toBe(8);
    expect(stepZoom(7, -1)).toBe(6);
    expect(stepZoom(32, 1)).toBe(32);
    expect(stepZoom(1, -1)).toBe(1);
    const seen = [1];
    while ((seen.at(-1) as number) < 32) seen.push(stepZoom(seen.at(-1) as number, 1));
    expect(seen).toEqual(ZOOM_STEPS);
  });

  it('fits the largest integer zoom with padding, never below 1', () => {
    expect(fitZoom({ width: 32, height: 48 }, { width: 800, height: 600 })).toBe(11);
    expect(fitZoom({ width: 4096, height: 4096 }, { width: 800, height: 600 })).toBe(1);
    expect(fitZoom({ width: 8, height: 8 }, { width: 2000, height: 2000 })).toBe(32);
    expect(fitZoom({ width: 0, height: 10 }, { width: 100, height: 100 })).toBe(1);
  });

  it('centres a fitting image and pins an oversized one to the top-left padding', () => {
    expect(centred({ width: 10, height: 10 }, { width: 100, height: 50 }, 4)).toEqual({ zoom: 4, panX: 30, panY: 5 });
    expect(centred({ width: 100, height: 1000 }, { width: 400, height: 300 }, 1)).toEqual({
      zoom: 1,
      panX: 150,
      panY: 16,
    });
  });

  it('keeps the image point under the cursor fixed when zooming', () => {
    const view = { zoom: 4, panX: 10, panY: 20 };
    const next = zoomAt(view, 8, 50, 60);
    // Image point under (50, 60): (10, 10). At 8x it must still be under (50, 60).
    expect(screenToImage(next, { width: 64, height: 64 }, 50, 60)).toEqual({ x: 10, y: 10 });
    expect(next).toEqual({ zoom: 8, panX: -30, panY: -20 });
    expect(zoomAt(view, 4, 0, 0)).toBe(view);
  });

  it('maps screen points to image pixels and pans by whole pixels', () => {
    const view = { zoom: 3, panX: 5, panY: 5 };
    expect(screenToImage(view, { width: 4, height: 4 }, 5, 5)).toEqual({ x: 0, y: 0 });
    expect(screenToImage(view, { width: 4, height: 4 }, 16.9, 7)).toEqual({ x: 3, y: 0 });
    expect(screenToImage(view, { width: 4, height: 4 }, 17, 7)).toBeNull();
    expect(screenToImage(view, { width: 4, height: 4 }, 4, 7)).toBeNull();
    expect(panBy(view, 2.4, -3.6)).toEqual({ zoom: 3, panX: 7, panY: 1 });
  });

  it('keeps part of the image on screen', () => {
    const image = { width: 100, height: 100 };
    const viewport = { width: 200, height: 200 };
    expect(clampPan({ zoom: 1, panX: 1000, panY: -1000 }, image, viewport)).toEqual({ zoom: 1, panX: 168, panY: -68 });
    const fine = { zoom: 1, panX: 10, panY: 10 };
    expect(clampPan(fine, image, viewport)).toBe(fine);
  });

  it('computes the visible region of a large image', () => {
    const big = { width: 4096, height: 4096 };
    expect(visibleRegion({ zoom: 32, panX: -32 * 100 - 16, panY: 0 }, big, { width: 640, height: 480 })).toEqual({
      x: 100,
      y: 0,
      w: 21,
      h: 15,
    });
    expect(
      visibleRegion({ zoom: 1, panX: 10, panY: 10 }, { width: 50, height: 50 }, { width: 640, height: 480 }),
    ).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(
      visibleRegion({ zoom: 1, panX: 700, panY: 0 }, { width: 50, height: 50 }, { width: 640, height: 480 }),
    ).toBeNull();
    expect(intersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
  });
});

describe('playback', () => {
  afterEach(() => vi.useRealTimers());

  it('accumulates elapsed time into whole frames without drift', () => {
    const clock = new FrameClock(10);
    let frames = 0;
    for (let i = 0; i < 300; i++) frames += clock.advance(1000 / 60);
    expect(frames).toBe(50);
    expect(clock.advance(0)).toBe(0);
    expect(clock.advance(-5)).toBe(0);
    const exact = new FrameClock(10);
    expect(Array.from({ length: 10 }, () => exact.advance(100)).reduce((a, b) => a + b)).toBe(10);
    exact.setFps(20);
    expect(exact.advance(100)).toBe(2);
    expect(() => new FrameClock(0)).toThrow(RangeError);
  });

  it('orders frames for loop, ping-pong and once', () => {
    const seq = (mode: 'loop' | 'ping-pong' | 'once') => Array.from({ length: 9 }, (_, t) => frameAt(t, 4, mode));
    expect(seq('loop')).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    expect(seq('ping-pong')).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2]);
    expect(seq('once')).toEqual([0, 1, 2, 3, 3, 3, 3, 3, 3]);
    expect(frameAt(5, 1, 'ping-pong')).toBe(0);
    expect([finished(2, 4, 'once'), finished(3, 4, 'once'), finished(9, 4, 'loop')]).toEqual([false, true, false]);
  });

  it('advances 10 frames per second within 5% over 5 s under fake timers', () => {
    // Node has no requestAnimationFrame: a 60 Hz timer stands in for the display. The browser
    // test of the animation tab runs the same check on faked requestAnimationFrame.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const display: Scheduler = {
      request: (cb) => setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number,
      cancel: (h) => clearTimeout(h),
    };
    let frames = 0;
    const stop = startPlayback({ fps: 10, onFrames: (n) => (frames += n), scheduler: display });
    vi.advanceTimersByTime(5000);
    stop();
    expect(frames).toBeGreaterThanOrEqual(47.5);
    expect(frames).toBeLessThanOrEqual(52.5);
    vi.advanceTimersByTime(1000);
    expect(frames).toBeLessThanOrEqual(52.5);
  });

  it('keeps the rate on an irregular display and treats a long stall as one frame', () => {
    const queue: ((t: number) => void)[] = [];
    const scheduler: Scheduler = { request: (cb) => queue.push(cb), cancel: () => {} };
    let frames = 0;
    startPlayback({ fps: 10, onFrames: (n) => (frames += n), scheduler });
    let time = 0;
    // 5 s of frames between 8 and 33 ms apart.
    const gaps = [8, 33, 16, 25, 12, 30];
    for (let i = 0; time < 5000; i++) {
      (queue.shift() as (t: number) => void)(time);
      time += gaps[i % gaps.length] as number;
    }
    expect(Math.abs(frames - 50)).toBeLessThanOrEqual(1);
    const before = frames;
    (queue.shift() as (t: number) => void)(time + 10_000);
    expect(frames - before).toBe(1);
  });
});

describe('palette', () => {
  it('counts opaque colours, inside regions when given, with palette indices', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]);
    expect(countColours(rgba, 2, ['#0000ff', '#ff0000'])).toEqual([
      { hex: '#ff0000', count: 2, paletteIndex: 1 },
      { hex: '#0000ff', count: 1, paletteIndex: 0 },
    ]);
    expect(countColours(rgba, 2, [], [{ x: 0, y: 1, w: 2, h: 1 }])).toEqual([
      { hex: '#0000ff', count: 1, paletteIndex: null },
    ]);
    expect(hexOf(1, 2, 255)).toBe('#0102ff');
    expect(paletteIndexOf('#FF0000', ['#ff0000'])).toBe(0);
    expect(
      mergeSwatches([
        [{ hex: '#000000', count: 2, paletteIndex: null }],
        [
          { hex: '#000000', count: 3, paletteIndex: null },
          { hex: '#ffffff', count: 9, paletteIndex: null },
        ],
      ]),
    ).toEqual([
      { hex: '#ffffff', count: 9, paletteIndex: null },
      { hex: '#000000', count: 5, paletteIndex: null },
    ]);
  });
});

const summary = (id: string, extra: Partial<AssetSummary> = {}): AssetSummary => ({
  id,
  generatedAt: '2026-10-01T00:00:00.000Z',
  frame: { width: 8, height: 8 },
  pivot: { x: 4, y: 7, normalized: { x: 0.5, y: 0.875 } },
  files: `/files/build/${id}`,
  sheets: 1,
  thumbnail: null,
  cells: 1,
  directions: ['s'],
  clips: ['idle'],
  tags: [],
  type: null,
  validation: 'pass',
  warnings: 0,
  errors: 0,
  ...extra,
});

describe('library filters', () => {
  const assets = [
    summary('props/crate', { tags: ['wood'], generatedAt: '2026-10-01T00:00:00.000Z' }),
    summary('characters/knight', {
      clips: ['walk', 'idle'],
      validation: 'warn',
      type: 'character',
      generatedAt: '2026-10-03T00:00:00.000Z',
    }),
    summary('props/barrel', { tags: ['wood', 'round'], validation: 'fail', generatedAt: '2026-10-02T00:00:00.000Z' }),
  ];
  const ids = (q: Partial<typeof DEFAULT_QUERY>) => filterAssets(assets, { ...DEFAULT_QUERY, ...q }).map((a) => a.id);

  it('searches every word across id, type, tags and clips', () => {
    expect(ids({ search: 'props' })).toEqual(['props/barrel', 'props/crate']);
    expect(ids({ search: 'WALK character' })).toEqual(['characters/knight']);
    expect(ids({ search: 'wood round' })).toEqual(['props/barrel']);
    expect(ids({ search: 'nothing' })).toEqual([]);
  });

  it('filters by status and tag and sorts by id, recency or status', () => {
    expect(ids({ status: 'warn' })).toEqual(['characters/knight']);
    expect(ids({ tag: 'wood' })).toEqual(['props/barrel', 'props/crate']);
    expect(ids({ sort: 'recent' })).toEqual(['characters/knight', 'props/barrel', 'props/crate']);
    expect(ids({ sort: 'status' })).toEqual(['props/barrel', 'characters/knight', 'props/crate']);
    expect(allTags(assets)).toEqual(['round', 'wood']);
  });

  it('describes ages', () => {
    const now = Date.parse('2026-10-02T12:00:00.000Z');
    expect(age('2026-10-02T11:59:50.000Z', now)).toBe('just now');
    expect(age('2026-10-02T11:30:00.000Z', now)).toBe('30 min ago');
    expect(age('2026-10-02T02:00:00.000Z', now)).toBe('10 h ago');
    expect(age('2026-09-28T12:00:00.000Z', now)).toBe('4 d ago');
  });
});

describe('routes', () => {
  it('round-trips asset routes with tabs and parameters', () => {
    expect(parseHash('')).toEqual({ page: 'library' });
    expect(parseHash('#/')).toEqual({ page: 'library' });
    const href = assetHref('characters/knight', 'compare', { a: 'x', b: 'current' });
    expect(href).toBe('#/asset/characters%2Fknight/compare?a=x&b=current');
    expect(parseHash(href)).toEqual({
      page: 'asset',
      id: 'characters/knight',
      tab: 'compare',
      params: { a: 'x', b: 'current' },
    });
    for (const tab of TABS)
      expect(parseHash(formatHash({ page: 'asset', id: 'a/b', tab, params: {} }))).toMatchObject({ id: 'a/b', tab });
  });

  it('accepts hand-written ids with plain slashes', () => {
    expect(parseHash('#/asset/props/crate')).toMatchObject({ id: 'props/crate', tab: 'sheet' });
    expect(parseHash('#/asset/props/crate/animation')).toMatchObject({ id: 'props/crate', tab: 'animation' });
    expect(parseHash('#/asset/crate')).toMatchObject({ id: 'crate', tab: 'sheet' });
  });
});

describe('cells', () => {
  it('lays eight compass directions out as a 3 x 3 grid and others in a row', () => {
    expect(directionLayout(['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'])).toEqual({ columns: 3, slots: COMPASS_GRID });
    expect(directionLayout(['s', 'n', 'e', 'w'])).toEqual({
      columns: 3,
      slots: [null, 'n', null, 'w', null, 'e', null, 's', null],
    });
    expect(directionLayout(['front', 'back'])).toEqual({ columns: 2, slots: ['front', 'back'] });
  });

  it('gives each clip a distinct colour', () => {
    const clips = ['idle', 'walk', 'run', 'attack', 'die'];
    expect(new Set(clips.map((c) => tagColour(clips, c))).size).toBe(clips.length);
  });
});

describe('diff', () => {
  const img = (w: number, h: number, px: number[][]) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(px.flat()),
  });

  it('counts exact changes, treating any two transparent pixels as equal', () => {
    const a = img(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 0, 255, 255],
      [1, 2, 3, 0],
    ]);
    const b = img(2, 2, [
      [255, 0, 0, 255],
      [9, 9, 9, 0],
      [0, 0, 254, 255],
      [1, 2, 3, 255],
    ]);
    const d = diffImages(a, b);
    expect([d.changed, d.total, d.width, d.height]).toEqual([2, 4, 2, 2]);
    expect(d.heat).toHaveLength(16);
    expect(changedPixels(new Uint8ClampedArray(a.data), new Uint8ClampedArray(a.data))).toBe(0);
  });

  it('pads differently sized frames with transparency', () => {
    const small = img(1, 1, [[10, 20, 30, 255]]);
    expect([...pad(small, 2, 2)]).toEqual([10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const d = diffImages(
      small,
      img(2, 1, [
        [10, 20, 30, 255],
        [1, 1, 1, 255],
      ]),
    );
    expect([d.width, d.height, d.changed]).toEqual([2, 1, 1]);
  });
});

describe('shortcuts', () => {
  it('has no key bound twice within scopes that are active together', () => {
    const together: (typeof SCOPES)[number][][] = [
      ['global', 'library'],
      ['global', 'canvas', 'animation'],
      ['global', 'canvas', 'compare'],
    ];
    for (const scopes of together) {
      const keys = SHORTCUTS.filter((s) => scopes.includes(s.scope)).flatMap((s) => s.keys);
      expect(new Set(keys).size, scopes.join()).toBe(keys.length);
    }
    expect(shortcutFor(' ', ['animation'])?.id).toBe('play');
    expect(shortcutFor(' ', ['library'])).toBeUndefined();
  });

  it('ignores keys typed into text fields but not on buttons or sliders', () => {
    expect(isTyping({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTyping({ tagName: 'input', type: 'number' })).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
