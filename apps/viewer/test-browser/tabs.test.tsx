import { afterEach, describe, expect, it } from 'vitest';
import { HelpOverlay } from '../src/client/components/HelpOverlay.tsx';
import { SheetView } from '../src/client/components/SheetView.tsx';
import { SHORTCUTS } from '../src/client/lib/shortcuts.ts';
import { CompareTab } from '../src/client/tabs/CompareTab.tsx';
import { HistoryTab } from '../src/client/tabs/HistoryTab.tsx';
import { MetadataTab } from '../src/client/tabs/MetadataTab.tsx';
import { ValidationTab } from '../src/client/tabs/ValidationTab.tsx';
import { CHANGED_PIXELS, CLIPS, DIRECTIONS, FRAME, spritePixel } from './fixture-data.ts';
import { click, fixture, fixtureSource, key, mount, pointer, q, unmountAll, until } from './helpers.tsx';

afterEach(unmountAll);

describe('SheetView', () => {
  it('outlines cells in their clip colour, selects a clicked cell and switches background', async () => {
    const f = await fixture();
    const host = mount(<SheetView files={f.detail.files} manifest={f.detail.manifest} />, { width: 500, height: 900 });
    await until(() => host.querySelector('[data-sheet-loaded="true"]'));
    expect([...host.querySelectorAll('.legend-item')].map((e) => e.textContent)).toEqual(['walk', 'idle', 'attack']);
    const el = await until(() => host.querySelector<HTMLElement>('.pixel-canvas:not([data-visible=""])'));
    const zoom = Number(el.dataset.zoom);
    const [panX, panY] = (el.dataset.pan ?? '').split(',').map(Number) as [number, number];
    // Click inside idle/s/001: row 8 (first idle row), column 1.
    pointer(el, 'pointerdown', panX + (8 + 3) * zoom, panY + (64 + 3) * zoom);
    pointer(el, 'pointerup', panX + (8 + 3) * zoom, panY + (64 + 3) * zoom);
    await until(() => host.querySelector('[data-selected-cell="idle/s/001"]'));
    await key('b');
    await until(() => host.querySelector('[data-background="checker 16"].on'));
    await key('c');
    await until(() => !q(host, '[data-toggle="cells"]').classList.contains('on'));
  });
});

describe('MetadataTab', () => {
  it('counts every colour used over all cells', async () => {
    const f = await fixture();
    const host = mount(<MetadataTab detail={f.detail} />);
    const expected = new Map<string, number>();
    CLIPS.forEach((clip, ci) => {
      DIRECTIONS.forEach((_d, di) => {
        for (let frame = 0; frame < clip.frames; frame++)
          for (let y = 0; y < FRAME.height; y++)
            for (let x = 0; x < FRAME.width; x++) {
              const c = spritePixel(ci, di, frame, x, y);
              if (c) expected.set(c, (expected.get(c) ?? 0) + 1);
            }
      });
    });
    await until(() => host.querySelector(`[data-swatches="${expected.size}"]`), 5000, 'swatches');
    for (const [hex, count] of expected) expect(q(host, `[data-swatch="${hex}"]`).dataset.count).toBe(String(count));
    expect(q(host, '[data-stages]').dataset.stages).toBe('2');
    expect(host.textContent).toContain('walk');
    expect(host.textContent).toContain('dimetric, pitch 30');
  });
});

describe('ValidationTab', () => {
  it('lists failing checks first and highlights the frames a check names', async () => {
    const f = await fixture();
    const host = mount(<ValidationTab detail={f.detail} />, { width: 900, height: 700 });
    await until(() => host.querySelector('[data-checks="1"]'));
    expect(q(host, '[data-highlighted]').dataset.highlighted).toBe('2');
    click(q(host, '[data-frame-key="walk/n/002"]'));
    await until(() => host.querySelector('[data-selected-cell="walk/n/002"]'));
    click(q(host, 'input[type="checkbox"]'));
    await until(() => host.querySelector('[data-checks="2"]'));
    click(q(host, '[data-check="pivot-drift"]'));
    await until(() => q(host, '[data-highlighted]').dataset.highlighted === '0');
  });
});

describe('HistoryTab', () => {
  it('lists the current build and recorded entries and links two picks to compare', async () => {
    const f = await fixture();
    const host = mount(<HistoryTab detail={f.detail} />, { width: 900, height: 700, source: fixtureSource(f) });
    await until(() => host.querySelector('[data-history="2"]'));
    for (const box of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(box);
    const link = await until(() => host.querySelector<HTMLAnchorElement>('[data-compare-picked]'));
    expect(link.getAttribute('href')).toBe(`#/asset/test%2Fhero/compare?a=${f.history.entry}&b=current`);
    click(q(host, `[data-history-entry="${f.history.entry}"] .history-row`));
    await until(() => host.querySelector(`[aria-label="test/hero ${f.history.entry}"]`));
  });
});

describe('CompareTab', () => {
  it('counts changed pixels between a history entry and the current build in every mode', async () => {
    const f = await fixture();
    const host = mount(<CompareTab detail={f.detail} params={{}} />, {
      width: 1000,
      height: 700,
      source: fixtureSource(f),
    });
    const tab = await until(
      () => host.querySelector<HTMLElement>(`.compare-tab[data-changed-pixels="${CHANGED_PIXELS}"]`),
      8000,
      'the diff',
    );
    expect(tab.dataset.changedCells).toBe('1');
    // The most changed sprite is selected once the differences are in.
    await until(() => host.querySelector('[data-compare-key="walk/s/001"]'));
    expect(q(host, '[data-compare-key]').dataset.cellChanged).toBe(String(CHANGED_PIXELS));
    expect(host.querySelectorAll('canvas[data-side]').length).toBe(2);
    const modes: [string, string][] = [
      ['swipe', '[data-swipe]'],
      ['blink', '[data-blink]'],
      ['heat-map', 'canvas[data-side="heat"]'],
    ];
    for (const [mode] of modes) {
      window.location.hash = '';
      click(q(host, `[data-compare-mode="${mode}"]`));
      // The mode lives in the URL; the test passes params directly, so read it back from there.
      await until(() => window.location.hash.includes(`mode=${mode}`));
    }
    unmountAll();
    for (const [mode, selector] of modes) {
      const h = mount(<CompareTab detail={f.detail} params={{ mode }} />, {
        width: 1000,
        height: 700,
        source: fixtureSource(f),
      });
      await until(() => h.querySelector(selector), 8000, `${mode} view`);
      if (mode === 'blink') {
        const shown = q(h, '[data-blink]').dataset.blink;
        await key('k');
        await until(() => q(h, '[data-blink]').dataset.blink !== shown);
      }
      unmountAll();
    }
    window.location.hash = '';
  });
});

describe('HelpOverlay', () => {
  it('lists every shortcut', async () => {
    const host = mount(<HelpOverlay onClose={() => {}} />);
    await until(() => host.querySelector('[data-help]'));
    for (const s of SHORTCUTS) expect(host.textContent).toContain(s.description);
  });
});
