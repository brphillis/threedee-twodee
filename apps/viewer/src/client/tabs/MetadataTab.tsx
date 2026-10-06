import type { ReactNode } from 'react';
import { useAsync } from '../components/hooks.ts';
import type { AssetDetail } from '../data.ts';
import { loadSheets, pixelsOf } from '../images.ts';
import { countColours, mergeSwatches, type Swatch } from '../lib/palette.ts';

const short = (hash: string) => hash.replace(/^sha256:/, '').slice(0, 12);
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);

/** Colour usage over every cell of every sheet, counted in the browser. */
async function swatches(detail: AssetDetail): Promise<Swatch[]> {
  const { manifest } = detail;
  const sheets = await loadSheets(detail.files, manifest);
  const lists = manifest.sheets.map((s) => {
    const img = sheets.get(s.name);
    if (!img) return [];
    const px = pixelsOf(img, s.width, s.height);
    const regions = manifest.cells.filter((c) => c.sheet === s.name);
    return countColours(px.data, s.width, manifest.palette.colors, regions);
  });
  return mergeSwatches(lists);
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="meta-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function MetadataTab({ detail }: { readonly detail: AssetDetail }) {
  const { manifest, generation, resolved } = detail;
  const colours = useAsync(`${detail.files}|${manifest.generatedAt}`, () => swatches(detail));
  const used = new Set(colours.value?.map((s) => s.hex.toLowerCase()) ?? []);
  const unused = manifest.palette.colors.filter((c) => !used.has(c.toLowerCase()));
  const total = colours.value?.reduce((n, s) => n + s.count, 0) ?? 0;
  const lights = resolved?.lighting.lights ?? [];
  return (
    <div className="metadata-tab pad">
      <Section title="Frame">
        <dl className="grid-dl">
          <dt>Frame</dt>
          <dd>
            {manifest.frame.width} x {manifest.frame.height} px at {manifest.pixelsPerUnit} px/m
          </dd>
          <dt>Pivot</dt>
          <dd>
            ({manifest.pivot.x}, {manifest.pivot.y}), normalised ({manifest.pivot.normalized.x.toFixed(3)},{' '}
            {manifest.pivot.normalized.y.toFixed(3)})
          </dd>
          <dt>Sheets</dt>
          <dd>
            {manifest.sheets.map((s) => `${s.name} ${s.width} x ${s.height} (${s.layout})`).join(', ')},{' '}
            {manifest.cells.length} cells
          </dd>
          <dt>Directions</dt>
          <dd>
            {manifest.directions
              .map((d) => `${d.name} ${d.yaw}°${d.mirrorOf ? ` (mirror of ${d.mirrorOf})` : ''}`)
              .join(', ')}
          </dd>
          {resolved?.rig && (
            <>
              <dt>Rig</dt>
              <dd>
                {resolved.rig.preset ?? 'custom'}, {resolved.rig.bones} bones
              </dd>
            </>
          )}
        </dl>
      </Section>
      <Section title="Palette">
        <p className="muted small">
          {manifest.palette.mode}
          {manifest.palette.name ? ` "${manifest.palette.name}"` : ''}
          {manifest.palette.colors.length
            ? `, ${manifest.palette.colors.length} colours allowed`
            : ', no fixed palette'}
          .{' '}
          {colours.value
            ? `${colours.value.length} colours used over ${total} opaque pixels.`
            : colours.error
              ? colours.error
              : 'Counting colours.'}
        </p>
        <ul className="swatches" data-swatches={colours.value?.length ?? ''}>
          {colours.value?.map((s) => (
            <li key={s.hex} data-swatch={s.hex} data-count={s.count}>
              <span className="chip big" style={{ background: s.hex }} />
              <code>{s.hex}</code>
              <span className="muted">{s.count}</span>
              {s.paletteIndex !== null && <span className="muted">#{s.paletteIndex}</span>}
            </li>
          ))}
        </ul>
        {unused.length > 0 && (
          <p className="muted small">
            Unused palette colours:{' '}
            {unused.map((c) => (
              <span key={c} className="inline-swatch">
                <span className="chip" style={{ background: c }} />
                {c}
              </span>
            ))}
          </p>
        )}
      </Section>
      <Section title="Clips">
        <table className="table">
          <thead>
            <tr>
              <th>Clip</th>
              <th>Frames</th>
              <th>fps</th>
              <th>Duration</th>
              <th>Loop</th>
              <th>Moves</th>
            </tr>
          </thead>
          <tbody>
            {manifest.clips.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.frames}</td>
                <td>{c.fps}</td>
                <td>{ms(c.durationMs)}</td>
                <td>{c.loop ? 'yes' : 'no'}</td>
                <td>{c.motion ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Camera and lighting">
        <dl className="grid-dl">
          <dt>Camera</dt>
          <dd>
            {manifest.camera.preset ?? 'custom'}, pitch {manifest.camera.pitch}°, yaw offset {manifest.camera.yawOffset}
            °, ground margin {manifest.camera.groundMargin} px
          </dd>
          {resolved && (
            <>
              <dt>Lighting</dt>
              <dd>
                {resolved.lighting.preset ?? 'custom'}, lights in {resolved.lighting.space} space, shadows{' '}
                {resolved.lighting.shadows.enabled ? 'on' : 'off'}
              </dd>
              {lights.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lights have no names; their order is their identity.
                <dd key={i} className="small">
                  {l.type} {l.intensity}
                  {'azimuth' in l ? `, azimuth ${l.azimuth}°, elevation ${l.elevation}°` : ''}
                  {'color' in l && l.color ? `, ${l.color}` : ''}
                </dd>
              ))}
              <dt>Materials</dt>
              <dd>
                {Object.entries(resolved.materials).map(([name, m]) => (
                  <span key={name} className="inline-swatch">
                    {(m.ramp ?? [m.color]).map((c, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a ramp may repeat a colour; its order is its identity.
                      <span key={i} className="chip" style={{ background: c }} />
                    ))}
                    {name} {m.shading}
                    {m.ramp ? ` ${m.ramp.length} colour ramp` : m.shading === 'toon' ? ` ${m.bands} bands` : ''}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </Section>
      <Section title="Stages">
        {generation ? (
          <>
            <p className="muted small">
              {generation.status}, {ms(generation.durationMs)} on {new Date(generation.finishedAt).toLocaleString()}
              {generation.backend
                ? `, ${generation.backend.id} ${generation.backend.version}: ${generation.backend.renderer}`
                : ''}
            </p>
            <table className="table" data-stages={generation.stages.length}>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Result</th>
                  <th>Time</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {generation.stages.map((s) => (
                  <tr key={s.name} data-stage={s.name}>
                    <td>{s.name}</td>
                    <td>{s.cached ? 'cached' : 'ran'}</td>
                    <td>{ms(s.durationMs)}</td>
                    <td>
                      <code title={s.hash}>{short(s.hash)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {generation.warnings.length > 0 && (
              <ul className="checks">
                {generation.warnings.map((w, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: warnings may repeat a code.
                  <li key={i} className="warn">
                    <strong>{w.code}</strong> {w.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted small">No generation record.</p>
        )}
      </Section>
      <Section title="Files">
        <dl className="grid-dl">
          {Object.entries(manifest.files).map(([format, list]) => (
            <div key={format} className="dl-row">
              <dt>{format}</dt>
              <dd>
                {list.slice(0, 6).map((f) => (
                  <a
                    key={f}
                    href={`${detail.files}/sheets/${f}`}
                    target="_blank"
                    rel="noreferrer"
                    className="file-link"
                  >
                    {f}
                  </a>
                ))}
                {list.length > 6 ? <span className="muted"> and {list.length - 6} more</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
