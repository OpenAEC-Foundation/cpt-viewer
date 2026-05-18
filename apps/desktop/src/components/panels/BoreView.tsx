import { useMemo, useState } from "react";
import type { Bore } from "../../types/bore";
import { soilColour } from "../../types/bore";
import "./BoreView.css";

/** Min/max zoom multipliers — 1× = 360 px base height, 0.5× compact, 6× hyper-zoom. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.4;
const BASE_HEIGHT_PX = 360;

/**
 * BoreView — strip-log visualisation for a BHR-GT borehole document.
 *
 * Layout: paper-style panel with a depth-axis on the left, a coloured
 * lithology strip in the middle, and a per-layer description column on
 * the right. Depths follow the CPT chart convention (positive = below
 * ground, NAP shown on the left axis when available).
 *
 * Hover any layer to highlight + see the full soil description in a
 * tooltip. The header carries the BRO id, position (RD), final depth,
 * and project info if the XML supplied any.
 */
export default function BoreView({ bore }: { bore: Bore }) {
  const [zoom, setZoom] = useState(1);

  const totalDepth = useMemo(() => {
    if (bore.final_depth && bore.final_depth > 0) return bore.final_depth;
    if (bore.layers.length === 0) return 1;
    return bore.layers[bore.layers.length - 1].base_depth;
  }, [bore]);

  // Strip-wrap CSS height grows with `zoom` — `overflow: auto` on the
  // `.bore-view` wrapper makes the extra space scrollable so descriptions
  // for very thin layers (a 0.1 m band crushed at 1×) become readable
  // once the user zooms in.
  const wrapHeightPx = Math.max(BASE_HEIGHT_PX, BASE_HEIGHT_PX * zoom);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z * ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z / ZOOM_STEP).toFixed(2)));
  const zoomReset = () => setZoom(1);

  // Ctrl + wheel → zoom; plain wheel scrolls the page as normal.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  // Depth axis: pick a "nice" 1-m step until we'd have >25 ticks, then
  // step up to 2/5/10 so the strip stays readable for deep borings.
  const tickStep = useMemo(() => {
    for (const s of [0.5, 1, 2, 5, 10]) {
      if (totalDepth / s <= 25) return s;
    }
    return 10;
  }, [totalDepth]);

  const depthTicks = useMemo(() => {
    const out: number[] = [];
    for (let d = 0; d <= totalDepth + 1e-9; d = +(d + tickStep).toFixed(3)) {
      out.push(d);
    }
    return out;
  }, [totalDepth, tickStep]);

  const z0 = bore.position?.z_nap;

  return (
    <div className="bore-view">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="bore-header">
        <div>
          <h2 className="bore-title">{bore.id || "Boring"}</h2>
          <p className="bore-sub">
            {bore.metadata.project_name ? `${bore.metadata.project_name} · ` : ""}
            BHR-GT (BRO)
          </p>
        </div>
        <dl className="bore-meta">
          {bore.position && (
            <>
              <dt>RD</dt>
              <dd>
                <code>
                  {bore.position.x_rd.toFixed(1)}, {bore.position.y_rd.toFixed(1)}
                </code>
              </dd>
            </>
          )}
          {typeof z0 === "number" && (
            <>
              <dt>NAP</dt>
              <dd>
                <code>{z0.toFixed(2)} m</code>
              </dd>
            </>
          )}
          {bore.final_depth && (
            <>
              <dt>Diepte</dt>
              <dd>
                <code>{bore.final_depth.toFixed(2)} m</code>
              </dd>
            </>
          )}
          {bore.layers.length > 0 && (
            <>
              <dt>Lagen</dt>
              <dd>
                <code>{bore.layers.length}</code>
              </dd>
            </>
          )}
        </dl>
      </header>

      {/* ── Zoom toolbar ───────────────────────────────────────── */}
      {bore.layers.length > 0 && (
        <div className="bore-toolbar">
          <span className="bore-toolbar-hint">
            Ctrl + scroll om in/uit te zoomen
          </span>
          <div className="bore-toolbar-zoom">
            <button
              type="button"
              className="bore-zoom-btn"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              title="Uitzoomen"
            >
              −
            </button>
            <button
              type="button"
              className="bore-zoom-btn bore-zoom-reset"
              onClick={zoomReset}
              title="Reset zoom"
            >
              {`${zoom.toFixed(1)}×`}
            </button>
            <button
              type="button"
              className="bore-zoom-btn"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              title="Inzoomen"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* ── Strip log ──────────────────────────────────────────── */}
      <div className="bore-body" onWheel={onWheel}>
        {bore.layers.length === 0 ? (
          <div className="bore-empty">
            <p>Geen lagen aangetroffen in deze boring.</p>
            <p className="bore-empty-sub">
              De BHR-GT XML bevatte geen <code>describedInterval</code> elementen.
            </p>
          </div>
        ) : (
          <div
            className="bore-strip-wrap"
            style={{ minHeight: `${wrapHeightPx}px` }}
          >
            {/* Depth axis */}
            <div className="bore-axis">
              {depthTicks.map((d) => {
                const top = (d / totalDepth) * 100;
                const napLabel = typeof z0 === "number"
                  ? `${(z0 - d).toFixed(2)}`
                  : `−${d.toFixed(1)}`;
                return (
                  <div
                    key={d}
                    className="bore-axis-tick"
                    style={{ top: `${top}%` }}
                  >
                    <span className="bore-axis-line" aria-hidden />
                    <span className="bore-axis-label">{napLabel}</span>
                  </div>
                );
              })}
              <div className="bore-axis-spine" aria-hidden />
              <div className="bore-axis-title">
                {typeof z0 === "number" ? "m NAP" : "m −mv"}
              </div>
            </div>

            {/* Coloured layer column */}
            <div className="bore-strip">
              {bore.layers.map((l, i) => {
                const top = (l.top_depth / totalDepth) * 100;
                const h = ((l.base_depth - l.top_depth) / totalDepth) * 100;
                return (
                  <div
                    key={i}
                    className="bore-layer"
                    style={{
                      top: `${top}%`,
                      height: `${h}%`,
                      background: soilColour(l.soil_name),
                    }}
                    title={`${l.top_depth.toFixed(2)}–${l.base_depth.toFixed(2)} m: ${l.soil_name}${l.description ? ` (${l.description})` : ""}`}
                  >
                    <span className="bore-layer-label">{l.soil_name}</span>
                  </div>
                );
              })}
            </div>

            {/* Per-layer description column — natural flow so rows
                with lots of secondary-attribute chips don't overlap
                their neighbours. The strip+axis columns stretch to
                match the descriptions' total height via the grid row. */}
            <ul className="bore-descriptions">
              {bore.layers.map((l, i) => (
                <li
                  key={i}
                  className="bore-description-row"
                >
                  <span
                    className="bore-description-swatch"
                    style={{ background: soilColour(l.soil_name) }}
                    aria-hidden
                  />
                  <div className="bore-description-text">
                    <div className="bore-description-soil">{l.soil_name}</div>
                    <div className="bore-description-range">
                      {l.top_depth.toFixed(2)} – {l.base_depth.toFixed(2)} m
                    </div>
                    {l.secondary && l.secondary.length > 0 && (
                      <div className="bore-description-chips">
                        {l.secondary.map((s, si) => (
                          <span key={si} className="bore-chip">
                            <span className="bore-chip-label">{s.label}</span>
                            <span className="bore-chip-value">{s.value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {l.colour && (
                      <div className="bore-description-extra">Kleur: {l.colour}</div>
                    )}
                    {l.description && (
                      <div className="bore-description-extra">{l.description}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
