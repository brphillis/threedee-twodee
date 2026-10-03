// Hash routing: #/ is the library, #/asset/<id>/<tab>?a=..&b=.. an asset. No DOM.

export const TABS = ['sheet', 'animation', 'metadata', 'validation', 'history', 'compare', 'model'] as const;
export type Tab = (typeof TABS)[number];

export type Route =
  | { readonly page: 'library' }
  | {
      readonly page: 'asset';
      readonly id: string;
      readonly tab: Tab;
      readonly params: Readonly<Record<string, string>>;
    };

const isTab = (s: string): s is Tab => (TABS as readonly string[]).includes(s);

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseHash(hash: string): Route {
  const body = hash.replace(/^#/, '');
  const q = body.indexOf('?');
  const path = q < 0 ? body : body.slice(0, q);
  const params: Record<string, string> = {};
  if (q >= 0) for (const [k, v] of new URLSearchParams(body.slice(q + 1))) params[k] = v;
  const match = /^\/asset\/(.+)$/.exec(path);
  if (!match?.[1]) return { page: 'library' };
  // Links encode the id as one segment. A hand-written id with plain slashes also works, and a
  // trailing tab name is read as the tab.
  const parts = match[1].split('/').filter(Boolean);
  const last = parts.at(-1) ?? '';
  const tab: Tab = parts.length > 1 && isTab(last) ? last : 'sheet';
  const idParts = parts.length > 1 && isTab(last) ? parts.slice(0, -1) : parts;
  return { page: 'asset', id: idParts.map(decode).join('/'), tab, params };
}

export function formatHash(route: Route): string {
  if (route.page === 'library') return '#/';
  const query = new URLSearchParams(Object.entries(route.params)).toString();
  return `#/asset/${encodeURIComponent(route.id)}/${route.tab}${query ? `?${query}` : ''}`;
}

export const assetHref = (id: string, tab: Tab = 'sheet', params: Record<string, string> = {}): string =>
  formatHash({ page: 'asset', id, tab, params });
