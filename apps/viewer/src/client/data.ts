// Where the viewer's data comes from: the td2d server's /api routes, or the files `td2d index`
// writes for a static file server. The mode is found by probing api/index.
import type { AssetDetail, ChangeEvent, HistoryDetail, ViewerIndex } from '../server/types.ts';

export type {
  AssetDetail,
  AssetSummary,
  ChangeEvent,
  HistoryDetail,
  HistorySummary,
  ViewerIndex,
} from '../server/types.ts';

/** live: changes arrive. off: the server runs with --no-watch. disconnected: the stream dropped and is retrying. */
export type LiveStatus = 'live' | 'off' | 'disconnected';

export interface DataSource {
  readonly mode: 'server' | 'static';
  index(): Promise<ViewerIndex>;
  asset(id: string): Promise<AssetDetail>;
  history(id: string, entry: string): Promise<HistoryDetail>;
  /** Subscribe to build changes. Null in static mode, which has no live reload. */
  readonly events:
    | ((onChange: (event: ChangeEvent) => void, onStatus: (status: LiveStatus) => void) => () => void)
    | null;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`${url} returned ${status}`);
    this.status = status;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new HttpError(url, response.status);
  const type = response.headers.get('content-type') ?? '';
  // A static server answering every path with index.html is not an API.
  if (!type.includes('json')) throw new HttpError(url, 415);
  return (await response.json()) as T;
}

/** An asset id as a URL path: each segment encoded, slashes kept. */
const idPath = (id: string) => id.split('/').map(encodeURIComponent).join('/');

export function serverSource(base = './'): DataSource {
  return {
    mode: 'server',
    index: () => getJson(`${base}api/index`),
    asset: (id) => getJson(`${base}api/assets/${idPath(id)}`),
    history: (id, entry) => getJson(`${base}api/history/${idPath(id)}/${encodeURIComponent(entry)}`),
    events: (onChange, onStatus) => {
      const source = new EventSource(`${base}api/events`);
      source.addEventListener('hello', (e) =>
        onStatus((JSON.parse((e as MessageEvent<string>).data) as { watching: boolean }).watching ? 'live' : 'off'),
      );
      source.addEventListener('change', (e) => onChange(JSON.parse((e as MessageEvent<string>).data) as ChangeEvent));
      source.addEventListener('error', () => onStatus('disconnected'));
      return () => source.close();
    },
  };
}

export function staticSource(base = './'): DataSource {
  return {
    mode: 'static',
    index: () => getJson(`${base}index.json`),
    asset: (id) => getJson(`${base}_td2d/data/assets/${idPath(id)}.json`),
    history: (id, entry) => getJson(`${base}_td2d/data/history/${idPath(id)}/${encodeURIComponent(entry)}.json`),
    events: null,
  };
}

/** Probe api/index: a JSON answer means the td2d server, anything else a static file server. */
export async function detectSource(base = './'): Promise<{ source: DataSource; index: ViewerIndex }> {
  const server = serverSource(base);
  try {
    return { source: server, index: await server.index() };
  } catch {
    const fallback = staticSource(base);
    return { source: fallback, index: await fallback.index() };
  }
}
