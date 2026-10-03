// Search, filter and sort for the library. No DOM.
import type { AssetSummary } from '../../server/types.ts';

export const STATUS_FILTERS = ['all', 'pass', 'warn', 'fail'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const SORTS = ['id', 'recent', 'status'] as const;
export type Sort = (typeof SORTS)[number];

export interface LibraryQuery {
  readonly search: string;
  readonly status: StatusFilter;
  /** Only assets carrying this tag, or null for any. */
  readonly tag: string | null;
  readonly sort: Sort;
}

export const DEFAULT_QUERY: LibraryQuery = { search: '', status: 'all', tag: null, sort: 'id' };

const STATUS_ORDER: Record<AssetSummary['validation'], number> = { fail: 0, warn: 1, pass: 2 };

/** Every word of the search must appear in the id, the type, a tag, a clip or a direction. */
function matches(asset: AssetSummary, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const haystack = [asset.id, asset.type ?? '', ...asset.tags, ...asset.clips].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function filterAssets(assets: readonly AssetSummary[], query: LibraryQuery): AssetSummary[] {
  const words = query.search.toLowerCase().split(/\s+/).filter(Boolean);
  const byId = (a: AssetSummary, b: AssetSummary) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sorters: Record<Sort, (a: AssetSummary, b: AssetSummary) => number> = {
    id: byId,
    // Newest first; ISO timestamps sort as strings.
    recent: (a, b) => (a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : byId(a, b)),
    status: (a, b) => STATUS_ORDER[a.validation] - STATUS_ORDER[b.validation] || byId(a, b),
  };
  return assets
    .filter((a) => query.status === 'all' || a.validation === query.status)
    .filter((a) => query.tag === null || a.tags.includes(query.tag))
    .filter((a) => matches(a, words))
    .sort(sorters[query.sort]);
}

/** Every tag used by any asset, sorted. */
export function allTags(assets: readonly AssetSummary[]): string[] {
  return [...new Set(assets.flatMap((a) => a.tags))].sort();
}

/** "3 min ago" style age of an ISO timestamp, relative to `now`. */
export function age(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
