import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetPage } from './components/AssetPage.tsx';
import { HelpOverlay } from './components/HelpOverlay.tsx';
import { useShortcuts } from './components/hooks.ts';
import { Library } from './components/Library.tsx';
import { ViewSettingsProvider } from './components/settings.tsx';
import { SourceContext } from './components/source.tsx';
import { type AssetDetail, type DataSource, detectSource, type LiveStatus, type ViewerIndex } from './data.ts';
import { formatHash, parseHash, type Route } from './lib/route.ts';

const FRESH_MS = 4000;

function Shell() {
  const [source, setSource] = useState<DataSource | null>(null);
  const [index, setIndex] = useState<ViewerIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | 'static' | 'connecting'>('connecting');
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [help, setHelp] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    detectSource()
      .then(({ source: s, index: i }) => {
        setSource(s);
        setIndex(i);
        if (s.mode === 'static') setStatus('static');
      })
      .catch((e: unknown) => setError(`Could not load the build index: ${e instanceof Error ? e.message : String(e)}`));
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const reloadIndex = useCallback(() => {
    source
      ?.index()
      .then((i) => {
        setIndex(i);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [source]);

  // Live reload: refresh the index, and the open asset when it is among the changes.
  useEffect(() => {
    if (!source?.events) return;
    let connectedBefore = false;
    return source.events(
      (event) => {
        reloadIndex();
        const current = routeRef.current;
        if (current.page === 'asset' && (event.assets.includes('*') || event.assets.includes(current.id)))
          setDetailVersion((v) => v + 1);
        const ids = event.assets.filter((a) => a !== '*');
        setChanged(new Set(ids));
        setTimeout(() => setChanged((c) => (ids.every((id) => c.has(id)) ? new Set() : c)), FRESH_MS);
      },
      (next) => {
        // A reconnect may have missed events: reload once it is back.
        if (next !== 'disconnected' && connectedBefore) {
          reloadIndex();
          setDetailVersion((v) => v + 1);
        }
        if (next !== 'disconnected') connectedBefore = true;
        setStatus(next);
      },
    );
  }, [source, reloadIndex]);

  const assetId = route.page === 'asset' ? route.id : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: detailVersion forces a reload after a change.
  useEffect(() => {
    if (!source || !assetId) {
      setDetail(null);
      return;
    }
    let live = true;
    source.asset(assetId).then(
      (d) => {
        if (!live) return;
        setDetail(d);
        setDetailError(null);
      },
      (e: unknown) => live && setDetailError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [source, assetId, detailVersion]);

  useShortcuts(['global'], {
    help: () => setHelp((h) => !h),
    close: () => {
      if (help) setHelp(false);
      else if (routeRef.current.page === 'asset') window.location.hash = formatHash({ page: 'library' });
    },
  });

  const shown = detail && assetId === detail.id ? detail : null;
  return (
    <div className="layout" data-status={status} data-mode={source?.mode ?? ''}>
      <header className="topbar">
        <a href="#/" className="brand">
          td2d
        </a>
        <a href="#/" className="project">
          {index?.project.name ?? ''}
        </a>
        {assetId && <span className="crumb">/ {assetId}</span>}
        <span className="spacer" />
        <span className={`status status-${status}`} data-live-status={status} title={statusTitle(status)}>
          {status === 'static'
            ? 'static'
            : status === 'live'
              ? 'live'
              : status === 'off'
                ? 'not watching'
                : status === 'connecting'
                  ? 'connecting'
                  : 'reconnecting'}
        </span>
        <button type="button" className="ghost" onClick={reloadIndex} aria-label="Reload">
          reload
        </button>
        <button type="button" className="ghost" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
          ?
        </button>
      </header>
      <main className="main">
        {error && <p className="error pad">{error}</p>}
        {source && index && (
          <SourceContext.Provider value={source}>
            {route.page === 'library' && <Library index={index} changed={changed} />}
            {route.page === 'asset' &&
              (shown ? (
                <AssetPage detail={shown} tab={route.tab} params={route.params} />
              ) : detailError ? (
                <p className="error pad">{detailError}</p>
              ) : (
                <p className="muted pad">Loading {route.id}</p>
              ))}
          </SourceContext.Provider>
        )}
      </main>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}

function statusTitle(status: string): string {
  if (status === 'live') return 'Watching build/: regenerated assets appear here within a second.';
  if (status === 'off') return 'The server runs with --no-watch. Use reload after generating.';
  if (status === 'static') return 'A static copy written by td2d index. It does not update.';
  return 'Connecting to the td2d server.';
}

export function App() {
  return (
    <ViewSettingsProvider>
      <Shell />
    </ViewSettingsProvider>
  );
}
