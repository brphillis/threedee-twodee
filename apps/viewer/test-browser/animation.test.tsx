import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationTab } from '../src/client/tabs/AnimationTab.tsx';
import { click, fixture, key, mount, q, recordDraws, unmountAll, until, wait } from './helpers.tsx';

afterEach(() => {
  vi.useRealTimers();
  unmountAll();
});

const tab = (host: HTMLElement) => q(host, '.animation-tab');
const frame = (host: HTMLElement) => Number(tab(host).dataset.frame);

describe('AnimationTab', () => {
  it('plays the first clip facing south and advances frames', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('[data-current-key="walk/s/000"]'));
    expect(tab(host).dataset.playing).toBe('true');
    // Real animation frames in the test iframe can stall for a while when the machine is busy
    // (the rate itself is checked exactly under fake timers below): sample until every frame
    // has shown, with a generous deadline.
    const seen = new Set<number>();
    const started = performance.now();
    while (seen.size < 4 && performance.now() - started < 15_000) {
      seen.add(frame(host));
      await wait(10);
    }
    // walk has 4 frames.
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('steps, scrubs and pauses', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('[data-current-key]'));
    click(q(host, '[data-play]'));
    await until(() => tab(host).dataset.playing === 'false');
    const at = frame(host);
    click(q(host, 'button[aria-label="Next frame"]'));
    await until(() => frame(host) === (at + 1) % 4);
    click(q(host, 'button[aria-label="Previous frame"]'));
    click(q(host, 'button[aria-label="Previous frame"]'));
    await until(() => frame(host) === (at + 3) % 4);
    const scrub = q<HTMLInputElement>(host, 'input[aria-label="Frame"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(scrub, '2');
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => frame(host) === 2);
    expect(q(host, '[data-current-key]').dataset.currentKey).toBe('walk/s/002');
    // Keyboard: . steps forward, [ and ] turn.
    await key('.');
    await until(() => frame(host) === 3);
    await key(']');
    await until(() => host.querySelector('[data-current-key="walk/sw/003"]'));
    await key('[');
    await key('[');
    await until(() => host.querySelector('[data-current-key="walk/se/003"]'));
  });

  it('overrides fps and plays a once-only clip to its last frame', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('[data-current-key]'));
    const fps = q<HTMLInputElement>(host, 'input[aria-label="Frames per second"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(fps, '30');
    fps.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => tab(host).dataset.fps === '30');
    const clip = q<HTMLSelectElement>(host, 'select[aria-label="Clip"]');
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    selectSetter?.call(clip, 'attack');
    clip.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => q<HTMLSelectElement>(host, 'select[aria-label="Loop mode"]').value === 'once');
    await until(() => tab(host).dataset.playing === 'false', 3000, 'the clip to finish');
    expect(frame(host)).toBe(2);
    expect(q(host, '[data-current-key]').dataset.currentKey).toBe('attack/s/002');
  });

  it('draws an onion skin of the previous frame under the current one', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('.animation-tab[data-frames="loaded"]'));
    await key(' ');
    await until(() => tab(host).dataset.playing === 'false');
    // Sprite canvases are frame-sized (8 x 8); count the distinct ones each view draws.
    const sprites = (calls: unknown[][]) =>
      new Set(
        calls.filter((a) => a[0] instanceof HTMLCanvasElement && a[0].width === 8 && a.length === 9).map((a) => a[0]),
      );
    const without = await recordDraws(async () => {
      await key('.');
      await wait(60);
    });
    expect(sprites(without).size).toBe(1);
    const withOnion = await recordDraws(async () => {
      await key('o');
      await until(() => q(host, '[data-toggle="onion"]').classList.contains('on'));
      await wait(60);
    });
    // The current frame and, under it, the previous one.
    expect(sprites(withOnion).size).toBe(2);
  });

  it('plays all eight directions at once in a compass grid', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('[data-current-key]'));
    await key('d');
    const grid = await until(() => host.querySelector<HTMLElement>('[data-direction-grid]'));
    const cells = [...grid.querySelectorAll<HTMLCanvasElement>('canvas[data-direction]')];
    expect(cells.map((c) => c.dataset.direction)).toEqual(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']);
    const frames = new Set(cells.map((c) => c.dataset.frame));
    expect(frames.size).toBe(1);
  });

  it('advances exactly 10 frames per second within 5% over 5 s of fake time', async () => {
    const f = await fixture();
    const host = mount(<AnimationTab files={f.detail.files} manifest={f.detail.manifest} />);
    await until(() => host.querySelector('[data-current-key]'));
    // Pause, reset to the first frame, then play under fake animation frames and clock.
    await key(' ');
    await until(() => tab(host).dataset.playing === 'false');
    const scrub = q<HTMLInputElement>(host, 'input[aria-label="Frame"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(scrub, '0');
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => tab(host).dataset.tick === '0');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    await key(' ');
    await until(() => tab(host).dataset.playing === 'true');
    // Let React start the loop under the fake scheduler, then run 5 s of 60 Hz frames.
    await wait(20);
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
    await wait(50);
    const ticks = Number(tab(host).dataset.tick);
    expect(ticks).toBeGreaterThanOrEqual(47.5);
    expect(ticks).toBeLessThanOrEqual(52.5);
  });
});
