import type { ManifestT } from '@td2d/schema';
import { useEffect, useMemo, useState } from 'react';
import { ReactCompareSlider } from 'react-compare-slider';
import { CanvasToolbar } from '../components/CanvasToolbar.tsx';
import { useAsync, useShortcuts } from '../components/hooks.ts';
import { SpriteCanvas } from '../components/PixelCanvas.tsx';
import { useViewSettings } from '../components/settings.tsx';
import { useSource } from '../components/source.tsx';
import type { AssetDetail, DataSource } from '../data.ts';
import { canvas, context, loadFrames, pixelsOf } from '../images.ts';
import { diffImages } from '../lib/diff.ts';
import { assetHref } from '../lib/route.ts';
import { CURRENT, sameAsCurrent } from './HistoryTab.tsx';

export const COMPARE_MODES = ['side-by-side', 'swipe', 'blink', 'heat-map'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

interface Build {
  readonly id: string;
  readonly files: string;
  readonly manifest: ManifestT;
  readonly frames: Map<string, HTMLCanvasElement>;
}

export interface CellDiff {
  readonly key: string;
  readonly status: 'same' | 'changed' | 'added' | 'removed';
  readonly changed: number;
  readonly perceptible: number;
  readonly total: number;
  readonly heat: HTMLCanvasElement | null;
}

async function loadBuild(source: DataSource, detail: AssetDetail, id: string): Promise<Build> {
  const build =
    id === CURRENT ? { files: detail.files, manifest: detail.manifest } : await source.history(detail.id, id);
  return { id, files: build.files, manifest: build.manifest, frames: await loadFrames(build.files, build.manifest) };
}

/** Per-sprite differences between two builds, in A's cell order followed by cells only in B. */
export function diffBuilds(a: Build, b: Build): CellDiff[] {
  const keys = [
    ...a.manifest.cells.map((c) => c.key),
    ...b.manifest.cells.map((c) => c.key).filter((k) => !a.frames.has(k)),
  ];
  return keys.map((key) => {
    const fa = a.frames.get(key);
    const fb = b.frames.get(key);
    if (!fa || !fb) {
      // A sprite only one side has counts every pixel of its frame as changed.
      const only = (fa ?? fb) as HTMLCanvasElement;
      const total = only.width * only.height;
      return { key, status: fa ? 'removed' : 'added', changed: total, perceptible: total, total, heat: null };
    }
    const d = diffImages(pixelsOf(fa, fa.width, fa.height), pixelsOf(fb, fb.width, fb.height));
    const heat = canvas(d.width, d.height);
    context(heat).putImageData(new ImageData(new Uint8ClampedArray(d.heat), d.width, d.height), 0, 0);
    return {
      key,
      status: d.changed ? 'changed' : 'same',
      changed: d.changed,
      perceptible: d.perceptible,
      total: d.total,
      heat,
    };
  });
}

function label(detail: AssetDetail, id: string): string {
  if (id === CURRENT) return 'current build';
  const entry = detail.history.find((h) => h.id === id);
  return entry
    ? `${new Date(entry.createdAt).toLocaleString()} (${entry.hash}${sameAsCurrent(detail, entry) ? ', same as current' : ''})`
    : id;
}

export function CompareTab({
  detail,
  params,
}: {
  readonly detail: AssetDetail;
  readonly params: Readonly<Record<string, string>>;
}) {
  const source = useSource();
  const settings = useViewSettings();
  const choices = [CURRENT, ...detail.history.map((h) => h.id)];
  // By default, the newest generation whose outputs differ from the current build.
  const before = detail.history.find((h) => !sameAsCurrent(detail, h))?.id ?? detail.history[0]?.id ?? CURRENT;
  const a = params.a && choices.includes(params.a) ? params.a : before;
  const b = params.b && choices.includes(params.b) ? params.b : CURRENT;
  const go = (next: { a?: string; b?: string; mode?: string }) => {
    window.location.hash = assetHref(detail.id, 'compare', { a, b, mode, ...next });
  };
  const mode: CompareMode = (COMPARE_MODES as readonly string[]).includes(params.mode ?? '')
    ? (params.mode as CompareMode)
    : 'side-by-side';
  const builds = useAsync(`${detail.id}|${detail.manifest.generatedAt}|${a}|${b}`, () =>
    Promise.all([loadBuild(source, detail, a), loadBuild(source, detail, b)]),
  );
  const diffs = useMemo(() => (builds.value ? diffBuilds(builds.value[0], builds.value[1]) : []), [builds.value]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [blinkB, setBlinkB] = useState(false);
  const [blinking, setBlinking] = useState(true);

  const ranked = useMemo(
    () => [...diffs].filter((d) => d.status !== 'same').sort((x, y) => y.changed - x.changed),
    [diffs],
  );
  useEffect(() => {
    if (!selected || !diffs.some((d) => d.key === selected)) setSelected(ranked[0]?.key ?? diffs[0]?.key ?? null);
  }, [diffs, ranked, selected]);
  useEffect(() => {
    if (mode !== 'blink' || !blinking) return;
    const timer = setInterval(() => setBlinkB((v) => !v), 500);
    return () => clearInterval(timer);
  }, [mode, blinking]);
  useShortcuts(['compare'], {
    'compare-mode': () =>
      go({ mode: COMPARE_MODES[(COMPARE_MODES.indexOf(mode) + 1) % COMPARE_MODES.length] as string }),
    blink: () => {
      setBlinking(false);
      setBlinkB((v) => !v);
    },
  });

  if (choices.length < 2)
    return (
      <p className="muted pad">
        There is nothing to compare yet: this asset has one recorded generation. Generate it again after a change.
      </p>
    );
  const frame = builds.value?.[1].manifest.frame ?? detail.manifest.frame;
  const fit = Math.max(1, Math.min(16, Math.floor(Math.min(360 / frame.height, 360 / frame.width))));
  const z = zoom ?? fit;
  const diff = diffs.find((d) => d.key === selected);
  const fa = selected ? (builds.value?.[0].frames.get(selected) ?? null) : null;
  const fb = selected ? (builds.value?.[1].frames.get(selected) ?? null) : null;
  const changedPixels = diffs.reduce((n, d) => n + (d.status === 'changed' ? d.changed : 0), 0);
  const changedCells = diffs.filter((d) => d.status === 'changed').length;
  const added = diffs.filter((d) => d.status === 'added').length;
  const removed = diffs.filter((d) => d.status === 'removed').length;
  const sprite = (img: HTMLCanvasElement | null, name: string) => (
    <SpriteCanvas
      image={img}
      width={frame.width}
      height={frame.height}
      zoom={z}
      background={settings.background}
      label={`${selected ?? ''} ${name}`}
      data={{ side: name }}
    />
  );
  const list = onlyChanged ? ranked : diffs;
  return (
    <div
      className="split compare-tab"
      data-changed-pixels={builds.value ? changedPixels : ''}
      data-changed-cells={builds.value ? changedCells : ''}
      data-mode={mode}
    >
      <aside className="side-list">
        <h3>Compare</h3>
        <label className="stack">
          A (before)
          <select value={a} onChange={(e) => go({ a: e.target.value })} aria-label="Before">
            {choices.map((c) => (
              <option key={c} value={c}>
                {label(detail, c)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          B (after)
          <select value={b} onChange={(e) => go({ b: e.target.value })} aria-label="After">
            {choices.map((c) => (
              <option key={c} value={c}>
                {label(detail, c)}
              </option>
            ))}
          </select>
        </label>
        {builds.error && <p className="error small">{builds.error}</p>}
        {builds.value && (
          <dl className="grid-dl stats" data-stats>
            <dt>Changed pixels</dt>
            <dd data-stat="changed-pixels">{changedPixels}</dd>
            <dt>Changed sprites</dt>
            <dd data-stat="changed-cells">
              {changedCells} of {diffs.length}
            </dd>
            <dt>Added, removed</dt>
            <dd>
              {added}, {removed}
            </dd>
            <dt>Frame</dt>
            <dd>
              {builds.value[0].manifest.frame.width} x {builds.value[0].manifest.frame.height} then {frame.width} x{' '}
              {frame.height}
            </dd>
          </dl>
        )}
        <label className="small">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> only
          changed sprites
        </label>
        <ul className="diff-list" data-diff-list={list.length}>
          {list.map((d) => (
            <li key={d.key}>
              <button
                type="button"
                className={`ghost small${d.key === selected ? ' on' : ''}`}
                data-diff-key={d.key}
                onClick={() => setSelected(d.key)}
              >
                <span>{d.key}</span>
                <span className={`badge ${d.status === 'same' ? 'pass' : d.status === 'changed' ? 'warn' : 'fail'}`}>
                  {d.status === 'changed' ? d.changed : d.status}
                </span>
              </button>
            </li>
          ))}
          {builds.value && list.length === 0 && <li className="muted small">No sprite changed.</li>}
        </ul>
      </aside>
      <div className="split-main">
        <CanvasToolbar zoom={z} setZoom={setZoom} cells={false}>
          <span className="divider" />
          {COMPARE_MODES.map((m) => (
            <button
              type="button"
              key={m}
              className={m === mode ? 'on' : ''}
              data-compare-mode={m}
              onClick={() => go({ mode: m })}
            >
              {m}
            </button>
          ))}
          {mode === 'blink' && (
            <button type="button" className={blinking ? 'on' : ''} onClick={() => setBlinking((v) => !v)}>
              {blinking ? 'stop blinking' : 'blink'}
            </button>
          )}
        </CanvasToolbar>
        <div className="compare-stage pad" data-compare-key={selected ?? ''} data-cell-changed={diff?.changed ?? ''}>
          {builds.loading && !builds.value && <p className="muted">Loading both builds.</p>}
          {builds.value && selected && (
            <>
              {mode === 'side-by-side' && (
                <div className="side-by-side">
                  <figure>
                    {sprite(fa, 'a')}
                    <figcaption>A: {label(detail, a)}</figcaption>
                  </figure>
                  <figure>
                    {sprite(fb, 'b')}
                    <figcaption>B: {label(detail, b)}</figcaption>
                  </figure>
                </div>
              )}
              {mode === 'swipe' && (
                <div className="swipe" style={{ width: frame.width * z }} data-swipe>
                  <ReactCompareSlider
                    itemOne={sprite(fa, 'a')}
                    itemTwo={sprite(fb, 'b')}
                    aria-label="Swipe between A and B"
                  />
                  <p className="muted small">Drag the handle: A on the left, B on the right.</p>
                </div>
              )}
              {mode === 'blink' && (
                <figure data-blink={blinkB ? 'b' : 'a'}>
                  {sprite(blinkB ? fb : fa, blinkB ? 'b' : 'a')}
                  <figcaption>Showing {blinkB ? 'B' : 'A'}. Press k to swap.</figcaption>
                </figure>
              )}
              {mode === 'heat-map' && (
                <figure>
                  <SpriteCanvas
                    image={diff?.heat ?? null}
                    width={frame.width}
                    height={frame.height}
                    zoom={z}
                    background={{ kind: 'solid', colour: '#ffffff' }}
                    label={`${selected} difference`}
                    data={{ side: 'heat' }}
                  />
                  <figcaption>
                    {diff?.status === 'changed'
                      ? `${diff.changed} of ${diff.total} pixels differ, in red.`
                      : diff?.status === 'same'
                        ? 'Identical.'
                        : `Only in ${diff?.status === 'added' ? 'B' : 'A'}.`}
                  </figcaption>
                </figure>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
