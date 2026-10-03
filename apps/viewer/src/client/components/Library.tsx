import { useMemo, useRef } from 'react';
import type { AssetSummary, ViewerIndex } from '../data.ts';
import { loadImage } from '../images.ts';
import { age, allTags, DEFAULT_QUERY, filterAssets, type LibraryQuery, SORTS, STATUS_FILTERS } from '../lib/library.ts';
import { assetHref } from '../lib/route.ts';
import { useAsync, useShortcuts, useStored } from './hooks.ts';
import { SpriteCanvas } from './PixelCanvas.tsx';
import { useViewSettings } from './settings.tsx';

const isQuery = (v: unknown): v is LibraryQuery => {
  if (typeof v !== 'object' || v === null) return false;
  const q = v as Record<string, unknown>;
  return (
    typeof q.search === 'string' &&
    (STATUS_FILTERS as readonly unknown[]).includes(q.status) &&
    (q.tag === null || typeof q.tag === 'string') &&
    (SORTS as readonly unknown[]).includes(q.sort)
  );
};
const isLayout = (v: unknown): v is 'grid' | 'list' => v === 'grid' || v === 'list';

/** The first cell of the first clip, cut out of its sheet. */
function Thumbnail({ asset, size }: { readonly asset: AssetSummary; readonly size: number }) {
  const settings = useViewSettings();
  const t = asset.thumbnail;
  const url = t ? `${t.image}?t=${encodeURIComponent(asset.generatedAt)}` : '';
  const frame = useAsync(url, async () => {
    if (!t) return null;
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = asset.frame.width;
    c.height = asset.frame.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, t.x, t.y, t.w, t.h, t.offset.x, t.offset.y, t.w, t.h);
    return c;
  });
  const zoom = Math.max(1, Math.floor(size / Math.max(asset.frame.width, asset.frame.height)));
  return (
    <SpriteCanvas
      image={frame.value}
      width={asset.frame.width}
      height={asset.frame.height}
      zoom={zoom}
      background={settings.background}
      label={`${asset.id} thumbnail`}
      className="thumb"
      data={{ thumbnail: asset.id, loaded: frame.value ? 'true' : 'false' }}
    />
  );
}

export function Library({ index, changed }: { readonly index: ViewerIndex; readonly changed: ReadonlySet<string> }) {
  const [query, setQuery] = useStored<LibraryQuery>('library-query', DEFAULT_QUERY, isQuery);
  const [layout, setLayout] = useStored<'grid' | 'list'>('library-layout', 'grid', isLayout);
  const search = useRef<HTMLInputElement>(null);
  const tags = useMemo(() => allTags(index.assets), [index]);
  const assets = useMemo(() => filterAssets(index.assets, query), [index, query]);
  const counts = useMemo(() => {
    const c = { all: index.assets.length, pass: 0, warn: 0, fail: 0 };
    for (const a of index.assets) c[a.validation]++;
    return c;
  }, [index]);
  useShortcuts(['library'], {
    search: () => search.current?.focus(),
    layout: () => setLayout((l) => (l === 'grid' ? 'list' : 'grid')),
  });
  const update = (patch: Partial<LibraryQuery>) => setQuery((q) => ({ ...q, ...patch }));
  return (
    <div className="library-page">
      <div className="toolbar library-tools" role="toolbar" aria-label="Library">
        <input
          ref={search}
          type="search"
          placeholder="Search ids, tags, clips ( / )"
          aria-label="Search assets"
          value={query.search}
          onChange={(e) => update({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.currentTarget.blur();
            update({ search: '' });
          }}
        />
        {STATUS_FILTERS.map((s) => (
          <button
            type="button"
            key={s}
            className={query.status === s ? 'on' : ''}
            data-status-filter={s}
            onClick={() => update({ status: s })}
          >
            {s} {counts[s]}
          </button>
        ))}
        {tags.length > 0 && (
          <select value={query.tag ?? ''} onChange={(e) => update({ tag: e.target.value || null })} aria-label="Tag">
            <option value="">any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <select
          value={query.sort}
          onChange={(e) => update({ sort: e.target.value as LibraryQuery['sort'] })}
          aria-label="Sort"
        >
          <option value="id">by id</option>
          <option value="recent">newest first</option>
          <option value="status">failures first</option>
        </select>
        <span className="divider" />
        <button
          type="button"
          className={layout === 'grid' ? 'on' : ''}
          onClick={() => setLayout('grid')}
          data-layout="grid"
        >
          grid
        </button>
        <button
          type="button"
          className={layout === 'list' ? 'on' : ''}
          onClick={() => setLayout('list')}
          data-layout="list"
        >
          list
        </button>
      </div>
      {index.assets.length === 0 && (
        <p className="muted pad">No generated assets. Run `td2d generate` and they appear here.</p>
      )}
      {index.assets.length > 0 && assets.length === 0 && <p className="muted pad">No asset matches.</p>}
      <ul className={`assets ${layout}`} data-count={assets.length}>
        {assets.map((a) => (
          <li key={a.id} className={changed.has(a.id) ? 'fresh' : ''}>
            <a href={assetHref(a.id)} className="asset-card" data-asset={a.id} data-generated={a.generatedAt}>
              <Thumbnail asset={a} size={layout === 'grid' ? 96 : 40} />
              <span className="asset-id">{a.id}</span>
              <span className={`badge ${a.validation}`}>{a.validation}</span>
              <span className="muted small">
                {a.frame.width} x {a.frame.height}, {a.cells} cells, {a.clips.length} clip(s), {a.directions.length} dir
              </span>
              <span className="muted small" title={new Date(a.generatedAt).toLocaleString()}>
                {age(a.generatedAt)}
              </span>
              {a.tags.length > 0 && (
                <span className="tags">
                  {a.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
