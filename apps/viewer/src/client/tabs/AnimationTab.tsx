import type { ManifestT } from '@td2d/schema';
import { useEffect, useMemo, useState } from 'react';
import { CanvasToolbar } from '../components/CanvasToolbar.tsx';
import { useAsync, useShortcuts } from '../components/hooks.ts';
import { PixelCanvas, SpriteCanvas } from '../components/PixelCanvas.tsx';
import { useViewSettings } from '../components/settings.tsx';
import { loadFrames } from '../images.ts';
import { directionLayout, paletteFor, sequence } from '../lib/cells.ts';
import { finished, frameAt, LOOP_MODES, type LoopMode, startPlayback } from '../lib/playback.ts';

/** Play `playing` at `fps`, adding elapsed frames to the tick. */
function usePlayback(playing: boolean, fps: number, onFrames: (n: number) => void): void {
  useEffect(() => {
    if (!playing) return;
    return startPlayback({ fps, onFrames });
  }, [playing, fps, onFrames]);
}

export function AnimationTab({ files, manifest }: { readonly files: string; readonly manifest: ManifestT }) {
  const settings = useViewSettings();
  const frames = useAsync(`${files}|${manifest.generatedAt}`, () => loadFrames(files, manifest));
  const clips = manifest.clips;
  const directions = manifest.directions.map((d) => d.name);
  const [clipName, setClipName] = useState(clips[0]?.name ?? '');
  const [direction, setDirection] = useState(directions.includes('s') ? 's' : (directions[0] ?? ''));
  const clip = clips.find((c) => c.name === clipName) ?? clips[0];
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);
  const [mode, setMode] = useState<LoopMode>(clip?.loop === false ? 'once' : 'loop');
  const [onion, setOnion] = useState(false);
  const [all, setAll] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [gridZoomChoice, setGridZoom] = useState<number | null>(null);
  const seq = useMemo(() => (clip ? sequence(manifest, clip.name, direction) : []), [manifest, clip, direction]);
  const count = seq.length;
  const fps = fpsOverride ?? clip?.fps ?? 10;
  const frame = frameAt(tick, count, mode);
  const previous = count > 1 ? (mode === 'loop' || frame > 0 ? (frame - 1 + count) % count : null) : null;

  useEffect(() => {
    setTick(0);
    setMode(clip?.loop === false ? 'once' : 'loop');
  }, [clip]);
  useEffect(() => {
    if (playing && finished(tick, count, mode)) setPlaying(false);
  }, [playing, tick, count, mode]);
  const onFrames = useMemo(() => (n: number) => setTick((t) => t + n), []);
  usePlayback(playing && count > 1, fps, onFrames);

  // Functional updates, so presses that arrive before a render still each count.
  const step = (by: 1 | -1) => {
    setPlaying(false);
    setTick((t) => (frameAt(t, count, mode) + by + count) % Math.max(1, count));
  };
  const turn = (by: 1 | -1) =>
    setDirection((current) => {
      const i = directions.indexOf(current);
      return directions[(i + by + directions.length) % directions.length] ?? current;
    });
  useShortcuts(['animation'], {
    play: () => {
      if (!playing && finished(tick, count, mode)) setTick(0);
      setPlaying((p) => !p);
    },
    'step-back': () => step(-1),
    'step-forward': () => step(1),
    'direction-prev': () => turn(-1),
    'direction-next': () => turn(1),
    onion: () => setOnion((o) => !o),
    'all-directions': () => setAll((a) => !a),
    'loop-mode': () => setMode((m) => LOOP_MODES[(LOOP_MODES.indexOf(m) + 1) % LOOP_MODES.length] as LoopMode),
  });

  const sprite = (dir: string, index: number | null) => {
    if (index === null || !clip) return null;
    const cell = sequence(manifest, clip.name, dir)[index];
    return cell ? (frames.value?.get(cell.key) ?? null) : null;
  };
  const layout = directionLayout(directions);
  const cell = seq[frame];
  const fitGrid = Math.max(1, Math.min(8, Math.floor(160 / Math.max(manifest.frame.width, manifest.frame.height))));
  const gridZoom = gridZoomChoice ?? fitGrid;

  if (!clip) return <p className="muted pad">This asset has no clips.</p>;
  return (
    <div
      className="animation-tab"
      data-frame={frame}
      data-tick={tick}
      data-playing={playing ? 'true' : 'false'}
      data-fps={fps}
      data-frames={frames.value ? 'loaded' : 'loading'}
    >
      <CanvasToolbar zoom={all ? gridZoom : zoom} setZoom={all ? setGridZoom : setZoom} cells={false}>
        <span className="divider" />
        <label>
          clip{' '}
          <select value={clip.name} onChange={(e) => setClipName(e.target.value)} aria-label="Clip">
            {clips.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          direction{' '}
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            aria-label="Direction"
            disabled={all}
          >
            {directions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </CanvasToolbar>
      <div className="toolbar" role="toolbar" aria-label="Playback">
        <button type="button" onClick={() => step(-1)} aria-label="Previous frame">
          prev
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (!playing && finished(tick, count, mode)) setTick(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? 'Pause' : 'Play'}
          data-play
        >
          {playing ? 'pause' : 'play'}
        </button>
        <button type="button" onClick={() => step(1)} aria-label="Next frame">
          next
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={frame}
          aria-label="Frame"
          className="scrub"
          onChange={(e) => {
            setPlaying(false);
            setTick(Number(e.target.value));
          }}
        />
        <span className="frame-label" data-frame-label>
          {frame + 1} / {count}
        </span>
        <span className="divider" />
        <label>
          fps{' '}
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            aria-label="Frames per second"
            className="fps"
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 1 && v <= 60) setFpsOverride(v === clip.fps ? null : v);
            }}
          />
        </label>
        {fpsOverride !== null && (
          <button type="button" className="ghost" onClick={() => setFpsOverride(null)}>
            reset to {clip.fps}
          </button>
        )}
        <select value={mode} onChange={(e) => setMode(e.target.value as LoopMode)} aria-label="Loop mode">
          {LOOP_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className={onion ? 'on' : ''} onClick={() => setOnion((o) => !o)} data-toggle="onion">
          onion skin
        </button>
        <button
          type="button"
          className={all ? 'on' : ''}
          onClick={() => setAll((a) => !a)}
          data-toggle="all-directions"
        >
          all directions
        </button>
      </div>
      <div className="canvas-area">
        {frames.error && <p className="error pad">{frames.error}</p>}
        {all ? (
          <div
            className="direction-grid"
            style={{ gridTemplateColumns: `repeat(${layout.columns}, auto)` }}
            data-direction-grid
          >
            {layout.slots.map((d, i) =>
              d ? (
                <figure key={d} className={d === direction ? 'current' : ''}>
                  <SpriteCanvas
                    image={sprite(d, frame)}
                    underlay={onion ? sprite(d, previous) : null}
                    width={manifest.frame.width}
                    height={manifest.frame.height}
                    zoom={gridZoom}
                    background={settings.background}
                    label={`${clip.name} ${d} frame ${frame}`}
                    data={{ direction: d, frame }}
                  />
                  <figcaption>{d}</figcaption>
                </figure>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: empty compass slots have no other identity.
                <span key={`empty-${i}`} />
              ),
            )}
          </div>
        ) : (
          <PixelCanvas
            image={sprite(direction, frame)}
            underlay={onion ? sprite(direction, previous) : null}
            width={manifest.frame.width}
            height={manifest.frame.height}
            zoom={zoom}
            onZoomChange={setZoom}
            background={settings.background}
            markers={[{ x: manifest.pivot.x, y: manifest.pivot.y }]}
            showOverlays={settings.showCells}
            pixelGrid={settings.pixelGrid}
            paletteFor={() => paletteFor(manifest, clip.name)}
            label={`${clip.name} ${direction} frame ${frame}`}
          />
        )}
      </div>
      <div className="sheet-footer">
        <span data-current-key={cell?.key ?? ''}>{cell?.key ?? ''}</span>
        <span className="muted">
          {clip.frames} frames at {clip.fps} fps, {clip.loop ? 'looping' : 'once'}
          {clip.motion ? ', moves across the frame' : ''}
        </span>
      </div>
    </div>
  );
}
