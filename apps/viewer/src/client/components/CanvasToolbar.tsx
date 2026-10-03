import type { ReactNode } from 'react';
import { MAX_ZOOM, MIN_ZOOM, stepZoom } from '../lib/zoom.ts';
import { useShortcuts } from './hooks.ts';
import { BACKGROUNDS, backgroundLabel, sameBackground } from './PixelCanvas.tsx';
import { useViewSettings } from './settings.tsx';

/** Zoom, background, cell outline and pixel grid controls, with their shortcuts. */
export function CanvasToolbar(props: {
  readonly zoom: number | null;
  readonly setZoom: (zoom: number | null) => void;
  readonly cells?: boolean;
  readonly children?: ReactNode;
}) {
  const { zoom, setZoom, cells = true, children } = props;
  const settings = useViewSettings();
  const z = zoom ?? 1;
  useShortcuts(['canvas'], {
    'zoom-in': () => setZoom(stepZoom(z, 1)),
    'zoom-out': () => setZoom(stepZoom(z, -1)),
    'zoom-fit': () => setZoom(null),
    cells: () => settings.toggleCells(),
    grid: () => settings.togglePixelGrid(),
    background: () => settings.nextBackground(),
  });
  const custom =
    settings.background.kind === 'solid' && !BACKGROUNDS.some((b) => sameBackground(b, settings.background));
  return (
    <div className="toolbar" role="toolbar" aria-label="View">
      <button type="button" onClick={() => setZoom(stepZoom(z, -1))} disabled={z <= MIN_ZOOM} aria-label="Zoom out">
        -
      </button>
      <span className="zoom" data-zoom-label={z}>
        {z}x
      </span>
      <button type="button" onClick={() => setZoom(stepZoom(z, 1))} disabled={z >= MAX_ZOOM} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={() => setZoom(null)} aria-label="Fit">
        fit
      </button>
      <span className="divider" />
      {BACKGROUNDS.map((b) => (
        <button
          type="button"
          key={backgroundLabel(b)}
          className={`bg-choice${sameBackground(b, settings.background) ? ' on' : ''}`}
          data-background={backgroundLabel(b)}
          title={backgroundLabel(b)}
          onClick={() => settings.setBackground(b)}
        >
          <span
            className={`chip ${b.kind === 'checker' ? `chip-checker chip-checker-${b.size}` : ''}`}
            style={b.kind === 'solid' ? { background: b.colour } : undefined}
          />
          {b.kind === 'checker' ? b.size : ''}
        </button>
      ))}
      <label className={`bg-custom${custom ? ' on' : ''}`} title="Custom background colour">
        <input
          type="color"
          aria-label="Custom background colour"
          value={settings.background.kind === 'solid' ? settings.background.colour : '#808080'}
          onChange={(e) => settings.setBackground({ kind: 'solid', colour: e.target.value })}
        />
      </label>
      <span className="divider" />
      {cells && (
        <button
          type="button"
          className={settings.showCells ? 'on' : ''}
          onClick={settings.toggleCells}
          data-toggle="cells"
        >
          cells
        </button>
      )}
      <button
        type="button"
        className={settings.pixelGrid ? 'on' : ''}
        onClick={settings.togglePixelGrid}
        data-toggle="grid"
        title="Pixel grid, shown above 8x"
      >
        grid
      </button>
      {children}
    </div>
  );
}
