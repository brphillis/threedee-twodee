import { useMemo, useState } from 'react';
import { SheetView } from '../components/SheetView.tsx';
import type { AssetDetail } from '../data.ts';

const ORDER = { fail: 0, warn: 1, pass: 2 } as const;

/** The validation checks; choosing one highlights the frames it names on the sheet. */
export function ValidationTab({ detail }: { readonly detail: AssetDetail }) {
  const checks = useMemo(
    () =>
      [...(detail.validation?.checks ?? [])].sort(
        (a, b) => ORDER[a.status] - ORDER[b.status] || (a.id < b.id ? -1 : 1),
      ),
    [detail.validation],
  );
  const [showPassing, setShowPassing] = useState(false);
  const firstWithFrames = checks.find((c) => c.status !== 'pass' && c.frames?.length);
  const [chosen, setChosen] = useState<string | null>(firstWithFrames?.id ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const check = checks.find((c) => c.id === chosen);
  const highlighted = useMemo(() => new Set(check?.frames ?? []), [check]);
  const shown = checks.filter((c) => showPassing || c.status !== 'pass');
  if (!detail.validation) return <p className="muted pad">No validation report for this build.</p>;
  return (
    <div className="split">
      <aside className="side-list">
        <h3>
          Validation <span className={`badge ${detail.validation.status}`}>{detail.validation.status}</span>
        </h3>
        <label className="small">
          <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} /> show
          passing checks ({checks.filter((c) => c.status === 'pass').length})
        </label>
        {shown.length === 0 && <p className="muted small">All {checks.length} checks passed.</p>}
        <ul className="checks" data-checks={shown.length}>
          {shown.map((c) => (
            <li key={c.id} className={`${c.status}${c.id === chosen ? ' chosen' : ''}`}>
              <button
                type="button"
                className="check"
                data-check={c.id}
                onClick={() => setChosen(c.id === chosen ? null : c.id)}
              >
                <span className={`badge ${c.status}`}>{c.status}</span> <strong>{c.id}</strong>
                <span className="message">{c.message}</span>
                {c.frames?.length ? <span className="muted small">{c.frames.length} frame(s)</span> : null}
              </button>
              {c.id === chosen && c.frames?.length ? (
                <div className="frame-list">
                  {c.frames.map((f) => (
                    <button
                      type="button"
                      key={f}
                      className={`ghost small${f === selected ? ' on' : ''}`}
                      data-frame-key={f}
                      onClick={() => setSelected(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </aside>
      <div className="split-main" data-highlighted={highlighted.size}>
        <SheetView
          files={detail.files}
          manifest={detail.manifest}
          highlighted={highlighted}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
