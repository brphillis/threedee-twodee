import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ViewSettingsProvider } from '../src/client/components/settings.tsx';
import { SourceContext } from '../src/client/components/source.tsx';
import type { DataSource } from '../src/client/data.ts';
import '../src/client/styles.css';
import type { Fixture } from './fixture.ts';

export const FIXTURE_URL = '/apps/viewer/test-browser/fixtures-out';

let cached: Promise<Fixture> | undefined;
export function fixture(): Promise<Fixture> {
  cached ??= fetch(`${FIXTURE_URL}/fixture.json`).then((r) => r.json() as Promise<Fixture>);
  return cached;
}

/** A data source over the fixture, for tabs that fetch history. */
export function fixtureSource(f: Fixture): DataSource {
  return {
    mode: 'static',
    index: async () => f.index,
    asset: async () => f.detail,
    history: async (_id, entry) => {
      if (entry !== f.history.entry) throw new Error(`no entry ${entry}`);
      return f.history;
    },
    events: null,
  };
}

const mounted: { root: Root; host: HTMLElement }[] = [];

/** Render into a fixed-size box with the providers the tabs need. */
export function mount(
  node: ReactNode,
  options: { width?: number; height?: number; source?: DataSource } = {},
): HTMLElement {
  try {
    localStorage.clear();
  } catch {
    // Storage may be unavailable; the settings fall back to defaults.
  }
  const host = document.createElement('div');
  host.style.cssText = `width:${options.width ?? 800}px;height:${options.height ?? 600}px;display:flex;flex-direction:column;position:relative`;
  document.body.appendChild(host);
  const root = createRoot(host);
  const tree = <ViewSettingsProvider>{node}</ViewSettingsProvider>;
  root.render(options.source ? <SourceContext.Provider value={options.source}>{tree}</SourceContext.Provider> : tree);
  mounted.push({ root, host });
  return host;
}

export function unmountAll(): void {
  for (const { root, host } of mounted.splice(0)) {
    root.unmount();
    host.remove();
  }
}

/** Poll until `check` returns a truthy value. */
export async function until<T>(
  check: () => T | null | undefined | false,
  timeout = 5000,
  what = 'condition',
): Promise<T> {
  const started = performance.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`No element matches ${selector}`);
  return el;
}

/** Dispatch a pointer event at a position relative to `el`'s top-left. */
export function pointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave',
  x: number,
  y: number,
): void {
  const r = el.getBoundingClientRect();
  if (type === 'pointerleave') {
    // React derives leave events from pointerout with the element being entered.
    el.dispatchEvent(
      new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body, pointerId: 1, isPrimary: true }),
    );
    return;
  }
  el.dispatchEvent(
    new PointerEvent(type, {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true,
    }),
  );
}

/**
 * Press a shortcut key, once it is handled. Components register their keyboard listener in an
 * effect, which React runs after the render that put them on the page, so a key sent the
 * moment an element appears can arrive before anyone listens; on a slow machine it does. A
 * handled shortcut calls preventDefault, so the key is sent again until one is, and counts
 * exactly once.
 */
export async function key(k: string, target: EventTarget = window, timeout = 5000): Promise<void> {
  const started = performance.now();
  for (;;) {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (event.defaultPrevented) return;
    if (performance.now() - started > timeout) throw new Error(`No shortcut handled the key "${k}"`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function click(el: Element): void {
  (el as HTMLElement).click();
}

/** Record drawImage calls on 2D contexts while `work` runs, with how long each took in ms. */
export async function recordDraws(work: () => Promise<void>, durations: number[] = []): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    calls.push(args);
    const started = performance.now();
    const result = (original as (...a: unknown[]) => void).apply(this, args);
    durations.push(performance.now() - started);
    return result;
  } as typeof original;
  try {
    await work();
  } finally {
    CanvasRenderingContext2D.prototype.drawImage = original;
  }
  return calls;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
