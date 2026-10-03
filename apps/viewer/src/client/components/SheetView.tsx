import type { ManifestT } from '@td2d/schema';
import { useEffect, useMemo, useState } from 'react';
import { loadImage, sheetUrl } from '../images.ts';
import { type Cell, paletteFor, tagColour } from '../lib/cells.ts';
import { CanvasToolbar } from './CanvasToolbar.tsx';
import { useAsync } from './hooks.ts';
import { type Overlay, PixelCanvas } from './PixelCanvas.tsx';
import { useViewSettings } from './settings.tsx';

/**
 * A whole sheet with its cell rectangles coloured by clip, pivots, sheet tabs and cell
 * selection. Used by the sheet, validation and history tabs.
 */
export function SheetView(props: {
  readonly files: string;
  readonly manifest: ManifestT;
  /** Cell keys to highlight, such as the frames a validation check names. */
  readonly highlighted?: ReadonlySet<string>;
  readonly selected?: string | null;
  readonly onSelect?: (key: string | null) => void;
  readonly label?: string;
}) {
  const { files, manifest, highlighted } = props;
  const settings = useViewSettings();
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selected = props.selected !== undefined ? props.selected : ownSelected;
  const select = props.onSelect ?? setOwnSelected;
  const firstHighlighted =
    highlighted && highlighted.size > 0 ? manifest.cells.find((c) => highlighted.has(c.key)) : undefined;
  const preferredSheet = (selected && manifest.cells.find((c) => c.key === selected)?.sheet) || firstHighlighted?.sheet;
  const [sheetName, setSheetName] = useState<string>(preferredSheet ?? manifest.sheets[0]?.name ?? '');
  useEffect(() => {
    if (preferredSheet) setSheetName(preferredSheet);
  }, [preferredSheet]);
  const sheet = manifest.sheets.find((s) => s.name === sheetName) ?? manifest.sheets[0];
  const [zoom, setZoom] = useState<number | null>(null);
  const url = sheet ? sheetUrl(files, manifest, sheet.name) : '';
  const image = useAsync(url, () => loadImage(url));
  const clips = useMemo(() => manifest.clips.map((c) => c.name), [manifest]);
  const cells = useMemo(() => manifest.cells.filter((c) => c.sheet === sheet?.name), [manifest, sheet]);
  const byKey = useMemo(() => new Map(manifest.cells.map((c) => [c.key, c])), [manifest]);
  const overlays = useMemo<Overlay[]>(
    () => cells.map((c) => ({ id: c.key, x: c.x, y: c.y, w: c.w, h: c.h, colour: tagColour(clips, c.clip) })),
    [cells, clips],
  );
  const markers = useMemo(
    () => cells.map((c) => ({ x: c.x - c.offset.x + manifest.pivot.x, y: c.y - c.offset.y + manifest.pivot.y })),
    [cells, manifest],
  );
  const cell: Cell | undefined = selected ? byKey.get(selected) : undefined;
  if (!sheet) return <p className="muted pad">This asset has no sheet.</p>;
  return (
    <div className="sheet-view">
      <CanvasToolbar zoom={zoom} setZoom={setZoom}>
        {manifest.sheets.length > 1 && (
          <>
            <span className="divider" />
            {manifest.sheets.map((s) => (
              <button
                type="button"
                key={s.name}
                className={s.name === sheet.name ? 'on' : ''}
                data-sheet-tab={s.name}
                onClick={() => {
                  setSheetName(s.name);
                  setZoom(null);
                }}
              >
                {s.name}
              </button>
            ))}
          </>
        )}
      </CanvasToolbar>
      <div className="canvas-area" data-sheet={sheet.name} data-sheet-loaded={image.value ? 'true' : 'false'}>
        {image.error ? (
          <p className="error pad">{image.error}</p>
        ) : (
          <PixelCanvas
            image={image.value}
            width={sheet.width}
            height={sheet.height}
            zoom={zoom}
            onZoomChange={setZoom}
            background={settings.background}
            overlays={overlays}
            showOverlays={settings.showCells}
            selected={selected}
            {...(highlighted ? { highlighted } : {})}
            markers={markers}
            pixelGrid={settings.pixelGrid}
            paletteFor={(key) => paletteFor(manifest, key ? (byKey.get(key)?.clip ?? null) : null)}
            onSelect={select}
            label={props.label ?? `${manifest.assetId} sheet ${sheet.name}`}
          />
        )}
      </div>
      <div className="sheet-footer">
        <span className="legend">
          {clips.map((c) => (
            <span key={c} className="legend-item">
              <span className="chip" style={{ background: tagColour(clips, c) }} />
              {c}
            </span>
          ))}
        </span>
        <span data-selected-cell={cell?.key ?? ''}>
          {cell
            ? `${cell.key} at ${cell.x}, ${cell.y}, ${cell.w} x ${cell.h}${cell.trimmed ? `, offset ${cell.offset.x}, ${cell.offset.y}` : ''}${cell.mirrored ? ', mirrored' : ''}`
            : `${sheet.width} x ${sheet.height}, ${cells.length} cells. Click a cell to select it.`}
        </span>
      </div>
    </div>
  );
}
