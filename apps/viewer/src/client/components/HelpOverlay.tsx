import { keyLabel, SCOPES, SHORTCUTS } from '../lib/shortcuts.ts';

const TITLES = {
  global: 'Everywhere',
  library: 'Library',
  canvas: 'Sheet and sprite views',
  animation: 'Animation',
  compare: 'Compare',
} as const;

export function HelpOverlay({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-help>
      <div className="overlay-panel">
        <header>
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            close
          </button>
        </header>
        <div className="shortcut-columns">
          {SCOPES.map((scope) => (
            <section key={scope}>
              <h3>{TITLES[scope]}</h3>
              <dl>
                {SHORTCUTS.filter((s) => s.scope === scope).map((s) => (
                  <div key={s.id} className="dl-row">
                    <dt>
                      {(s.id === 'tab' ? ['1', '7'] : s.keys).map((k, i) => (
                        <span key={k}>
                          {s.id === 'tab' && i === 1 ? ' to ' : i > 0 ? ' ' : ''}
                          <kbd>{keyLabel(k)}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
