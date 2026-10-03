import { useState } from 'react';
import { useAsync } from '../components/hooks.ts';
import { SheetView } from '../components/SheetView.tsx';
import { useSource } from '../components/source.tsx';
import type { AssetDetail } from '../data.ts';
import { age } from '../lib/library.ts';
import { assetHref } from '../lib/route.ts';

/** `current` for the build itself, else a history entry id. */
export const CURRENT = 'current';

/**
 * The export stage hash of the current build, without its algorithm prefix: history entries are
 * named after it. The generation record has it; the manifest cannot, being an export output.
 */
export function currentHash(detail: AssetDetail): string {
  return (detail.generation?.stages.find((s) => s.name === 'export')?.hash ?? '').replace(/^sha256:/, '');
}

/** Whether a history entry holds the same outputs as the current build. */
export function sameAsCurrent(detail: AssetDetail, entry: { readonly hash: string }): boolean {
  return entry.hash.length > 0 && currentHash(detail).startsWith(entry.hash);
}

export function HistoryTab({ detail }: { readonly detail: AssetDetail }) {
  const source = useSource();
  const [picked, setPicked] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string>(CURRENT);
  const entry = useAsync(`${detail.id}|${viewing}`, () =>
    viewing === CURRENT ? Promise.resolve(null) : source.history(detail.id, viewing),
  );
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const rows = [
    {
      id: CURRENT,
      label: 'current build',
      createdAt: detail.manifest.generatedAt,
      hash: currentHash(detail).slice(0, 12),
      validation: detail.manifest.validation.status,
      same: false,
    },
    ...detail.history.map((h) => ({
      id: h.id,
      label: h.id,
      createdAt: h.createdAt,
      hash: h.hash,
      validation: h.validation,
      same: sameAsCurrent(detail, h),
    })),
  ];
  const [a, b] =
    picked.length === 2 ? [...picked].sort((x, y) => (x === CURRENT ? 1 : y === CURRENT ? -1 : x < y ? -1 : 1)) : [];
  const shown = viewing === CURRENT ? { files: detail.files, manifest: detail.manifest } : entry.value;
  return (
    <div className="split">
      <aside className="side-list">
        <h3>History</h3>
        <p className="muted small">
          {detail.history.length === 0
            ? 'No history yet. Each generation that changes the outputs is recorded under history/.'
            : `${detail.history.length} recorded generation(s). Pick two to compare.`}
        </p>
        <ul className="history" data-history={rows.length}>
          {rows.map((r) => (
            <li key={r.id} className={r.id === viewing ? 'chosen' : ''} data-history-entry={r.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`Pick ${r.label}`}
                />
              </label>
              <button type="button" className="history-row" onClick={() => setViewing(r.id)}>
                <span>{r.id === CURRENT ? 'Current build' : new Date(r.createdAt).toLocaleString()}</span>
                <span className="muted small">
                  {age(r.createdAt)}
                  {r.hash ? `, ${r.hash}` : ''}
                  {r.same ? ', same as current' : ''}
                </span>
                {r.validation && <span className={`badge ${r.validation}`}>{r.validation}</span>}
              </button>
              {r.id !== CURRENT && !r.same && (
                <a className="small" href={assetHref(detail.id, 'compare', { a: r.id, b: CURRENT })}>
                  compare with current
                </a>
              )}
            </li>
          ))}
        </ul>
        {a && b ? (
          <a className="button primary" href={assetHref(detail.id, 'compare', { a, b })} data-compare-picked>
            Compare the two picked
          </a>
        ) : (
          <button type="button" className="primary" disabled>
            Compare the two picked
          </button>
        )}
      </aside>
      <div className="split-main">
        {entry.error && <p className="error pad">{entry.error}</p>}
        {shown ? (
          <SheetView key={viewing} files={shown.files} manifest={shown.manifest} label={`${detail.id} ${viewing}`} />
        ) : (
          <p className="muted pad">Loading {viewing}</p>
        )}
      </div>
    </div>
  );
}
