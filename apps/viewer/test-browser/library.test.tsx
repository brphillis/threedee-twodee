import { afterEach, describe, expect, it } from 'vitest';
import { Library } from '../src/client/components/Library.tsx';
import { click, fixture, key, mount, q, unmountAll, until } from './helpers.tsx';

afterEach(unmountAll);

const ids = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-asset]')].map((a) => a.dataset.asset);

function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Library', () => {
  it('lists assets with thumbnails of their first cell', async () => {
    const f = await fixture();
    const host = mount(<Library index={f.index} changed={new Set()} />);
    await until(() => host.querySelectorAll('[data-asset]').length === 3);
    expect(ids(host)).toEqual(['props/barrel', 'props/crate', 'test/hero']);
    await until(() => host.querySelectorAll('[data-thumbnail][data-loaded="true"]').length === 3, 5000, 'thumbnails');
    const thumb = q<HTMLCanvasElement>(host, '[data-thumbnail="test/hero"]');
    // 96 px cards: an 8 px frame is drawn at 12x.
    expect([thumb.width, thumb.height]).toEqual([96, 96]);
    expect(q(host, '[data-asset="test/hero"]').getAttribute('href')).toBe('#/asset/test%2Fhero/sheet');
  });

  it('searches, filters by status and tag, and sorts', async () => {
    const f = await fixture();
    const host = mount(<Library index={f.index} changed={new Set()} />);
    await until(() => host.querySelectorAll('[data-asset]').length === 3);
    const search = q<HTMLInputElement>(host, 'input[type="search"]');
    type(search, 'crate');
    await until(() => ids(host).join() === 'props/crate');
    type(search, 'walk hero');
    await until(() => ids(host).join() === 'test/hero');
    type(search, '');
    click(q(host, '[data-status-filter="fail"]'));
    await until(() => ids(host).join() === 'props/barrel');
    click(q(host, '[data-status-filter="all"]'));
    choose(q<HTMLSelectElement>(host, 'select[aria-label="Tag"]'), 'prop');
    await until(() => ids(host).join() === 'props/barrel,props/crate');
    choose(q<HTMLSelectElement>(host, 'select[aria-label="Tag"]'), '');
    choose(q<HTMLSelectElement>(host, 'select[aria-label="Sort"]'), 'recent');
    await until(() => ids(host).join() === 'test/hero,props/barrel,props/crate');
    choose(q<HTMLSelectElement>(host, 'select[aria-label="Sort"]'), 'status');
    await until(() => ids(host).join() === 'props/barrel,test/hero,props/crate');
  });

  it('switches between grid and list, focuses search with /, and marks fresh assets', async () => {
    const f = await fixture();
    const host = mount(<Library index={f.index} changed={new Set(['props/crate'])} />);
    await until(() => host.querySelector('.assets.grid'));
    await key('v');
    await until(() => host.querySelector('.assets.list'));
    await key('/');
    expect(document.activeElement).toBe(q(host, 'input[type="search"]'));
    // Typing in the search box does not trigger shortcuts.
    q(host, 'input[type="search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    expect(host.querySelector('.assets.list')).not.toBeNull();
    expect(q(host, '[data-asset="props/crate"]').closest('li')?.classList.contains('fresh')).toBe(true);
    expect(q(host, '[data-asset="test/hero"]').closest('li')?.classList.contains('fresh')).toBe(false);
  });
});
