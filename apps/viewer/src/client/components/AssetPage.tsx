import { lazy, Suspense } from 'react';
import type { AssetDetail } from '../data.ts';
import { assetHref, TABS, type Tab } from '../lib/route.ts';
import { AnimationTab } from '../tabs/AnimationTab.tsx';
import { CompareTab } from '../tabs/CompareTab.tsx';
import { HistoryTab } from '../tabs/HistoryTab.tsx';
import { MetadataTab } from '../tabs/MetadataTab.tsx';
import { ValidationTab } from '../tabs/ValidationTab.tsx';
import { useShortcuts } from './hooks.ts';
import { SheetView } from './SheetView.tsx';

const ModelTab = lazy(() => import('../tabs/ModelTab.tsx'));

export function AssetPage(props: {
  readonly detail: AssetDetail;
  readonly tab: Tab;
  readonly params: Readonly<Record<string, string>>;
}) {
  const { detail, tab, params } = props;
  const { manifest } = detail;
  const issues = manifest.validation.errors + manifest.validation.warnings;
  useShortcuts(['global'], {
    tab: (key) => {
      const next = TABS[Number(key) - 1];
      if (next) window.location.hash = assetHref(detail.id, next);
    },
  });
  return (
    <div className="asset-page" data-asset-page={detail.id} data-generated={manifest.generatedAt}>
      <header className="asset-header">
        <h2>{detail.id}</h2>
        <span className={`badge ${manifest.validation.status}`}>{manifest.validation.status}</span>
        <span className="muted small">
          {manifest.frame.width} x {manifest.frame.height}, {manifest.cells.length} cells, generated{' '}
          {new Date(manifest.generatedAt).toLocaleString()}
        </span>
      </header>
      <nav className="tabs" aria-label="Asset views">
        {TABS.map((t, i) => (
          <a
            key={t}
            href={assetHref(detail.id, t)}
            className={t === tab ? 'on' : ''}
            data-tab={t}
            aria-current={t === tab ? 'page' : undefined}
            title={`${t} (${i + 1})`}
          >
            {t}
            {t === 'validation' && issues > 0 ? (
              <span className={`count ${manifest.validation.status}`}>{issues}</span>
            ) : null}
            {t === 'history' && detail.history.length > 0 ? (
              <span className="count">{detail.history.length}</span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="tab-body" data-tab-body={tab}>
        {tab === 'sheet' && <SheetView files={detail.files} manifest={manifest} />}
        {tab === 'animation' && <AnimationTab files={detail.files} manifest={manifest} />}
        {tab === 'metadata' && <MetadataTab detail={detail} />}
        {tab === 'validation' && <ValidationTab key={manifest.generatedAt} detail={detail} />}
        {tab === 'history' && <HistoryTab detail={detail} />}
        {tab === 'compare' && <CompareTab detail={detail} params={params} />}
        {tab === 'model' && (
          <Suspense fallback={<p className="muted pad">Loading the 3D view.</p>}>
            <ModelTab detail={detail} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
