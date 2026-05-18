import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import TopotijdreisSlider from "./TopotijdreisSlider";

/**
 * Identifier for a single toggleable map layer.
 *
 * Kept narrow + serializable so it round-trips cleanly through the
 * `ogs:layer-toggle` window event. MapView listens for that event and
 * does the actual `map.addLayer` / `map.removeLayer` work.
 */
export type LayerId =
  | "brt"
  | "luchtfoto-actueel"
  | "luchtfoto-2025"
  | "luchtfoto-2024"
  | "luchtfoto-2023"
  | "luchtfoto-2022"
  | "luchtfoto-2021"
  | "luchtfoto-2020"
  | "luchtfoto-2019"
  | "luchtfoto-2018"
  | "luchtfoto-2017"
  | "luchtfoto-2016"
  | "adressen"
  | "ahn"
  | "kadaster"
  | "bag"
  | "bgt"
  | "bestemmingsplan"
  | "bro-sonderingen"
  | "bro-boringen"
  | "project-sonderingen";

interface LayerDef {
  id: LayerId;
  label: string;
  group: "base" | "overlay" | "data";
  defaultOn: boolean;
  /** Optional legend renderer — shown directly under the layer row when
   *  the layer is enabled. Only AHN currently provides one. */
  hasLegend?: boolean;
}

const LAYER_DEFS: LayerDef[] = [
  // Base layers (radio-ish, but we keep them as checkboxes — Leaflet will
  // happily stack tile layers and the user can manage opacity later)
  { id: "brt", label: "Topografie (BRT)", group: "base", defaultOn: true },
  { id: "luchtfoto-actueel", label: "Luchtfoto (actueel)", group: "base", defaultOn: false },
  { id: "luchtfoto-2025", label: "Luchtfoto 2025", group: "base", defaultOn: false },
  { id: "luchtfoto-2024", label: "Luchtfoto 2024", group: "base", defaultOn: false },
  { id: "luchtfoto-2023", label: "Luchtfoto 2023", group: "base", defaultOn: false },
  { id: "luchtfoto-2022", label: "Luchtfoto 2022", group: "base", defaultOn: false },
  { id: "luchtfoto-2021", label: "Luchtfoto 2021", group: "base", defaultOn: false },
  { id: "luchtfoto-2020", label: "Luchtfoto 2020", group: "base", defaultOn: false },
  { id: "luchtfoto-2019", label: "Luchtfoto 2019", group: "base", defaultOn: false },
  { id: "luchtfoto-2018", label: "Luchtfoto 2018", group: "base", defaultOn: false },
  { id: "luchtfoto-2017", label: "Luchtfoto 2017", group: "base", defaultOn: false },
  { id: "luchtfoto-2016", label: "Luchtfoto 2016", group: "base", defaultOn: false },

  // BAG huisnummers + straatnamen — WMS-tile overlay van het PDOK BAG
  // huisnummerposities + nummeraanduiding. Toont straatnamen + nummers
  // bij hogere zoomniveaus.
  { id: "adressen", label: "Adressen + straten", group: "overlay", defaultOn: false },

  // AHN — Actueel Hoogtebestand Nederland (DTM 0.5 m). Overlay-style
  // hillshade ramp from blue (low) to red (high). Off by default — too
  // visually loud to combine with the base layer without consent.
  { id: "ahn", label: "AHN hoogtekaart", group: "overlay", defaultOn: false, hasLegend: true },
  // PDOK BRO-adjacent overlays — cadastre boundaries, building outlines
  // (BAG), and the fine-grained BGT topography. All transparent PNG
  // overlays so they layer cleanly on top of BRT / luchtfoto.
  { id: "kadaster", label: "Kadastrale grenzen", group: "overlay", defaultOn: false },
  { id: "bag", label: "BAG (gebouwen)", group: "overlay", defaultOn: false },
  { id: "bgt", label: "BGT topografie", group: "overlay", defaultOn: false },
  // PDOK "Ruimtelijkeplannen" — gemeentelijke bestemmingsplannen via
  // WMS. Toont gekleurde zonering (Wonen, Bedrijf, Groen, Verkeer, …).
  { id: "bestemmingsplan", label: "Bestemmingsplan", group: "overlay", defaultOn: false },

  // BRO data layers — sonderingen on by default so the map shows public CPTs
  // immediately when the user opens the Kaart tab.
  { id: "bro-sonderingen", label: "BRO Sonderingen", group: "data", defaultOn: true },
  { id: "bro-boringen", label: "BRO Boringen", group: "data", defaultOn: false },

  // Project layer
  { id: "project-sonderingen", label: "Project sonderingen", group: "data", defaultOn: true },
];

/** AHN colour ramp stops (NAP metres). Mirrors the PDOK ramp closely
 *  enough that the user can read the map without opening PDOK's own
 *  legend image. */
const AHN_LEGEND: { color: string; label: string }[] = [
  { color: "#08306b", label: "< −5 m" },
  { color: "#2171b5", label: "−5 — 0 m" },
  { color: "#6baed6", label: "0 — 2 m" },
  { color: "#74c476", label: "2 — 5 m" },
  { color: "#fee391", label: "5 — 10 m" },
  { color: "#fdae6b", label: "10 — 25 m" },
  { color: "#e6550d", label: "25 — 50 m" },
  { color: "#7f2704", label: "> 50 m" },
];

/**
 * Initial state — must be a *function* so the defaults are computed once,
 * not regenerated on every render.
 *
 * The Sonderingstekening tab needs different defaults than the Kaart tab:
 * a tekening visually leans on a luchtfoto (50% to keep contrast) plus
 * BAG buildings and kadaster lines so the reader sees the parcel + the
 * surrounding buildings at a glance. Kaart keeps its lichter BRT-only
 * default so the user can search/inspect freely without overlays getting
 * in the way.
 */
function defaultState(view: ViewId = "map"): Record<LayerId, boolean> {
  const out = {} as Record<LayerId, boolean>;
  for (const d of LAYER_DEFS) out[d.id] = d.defaultOn;
  if (view === "tekening") {
    // BRT stays as a fallback under the luchtfoto so any tiles that fail
    // to load still show a base. Luchtfoto-actueel sits on top at 50%.
    out["luchtfoto-actueel"] = true;
    out["kadaster"] = true;
    out["bag"] = true;
  }
  return out;
}

/** Initial opacity state. Sonderingstekening starts the luchtfoto at 50%
 *  so the cadaster + BAG outlines, sonderingen and dimensions stay
 *  readable on top — the Kaart tab keeps everything at 100%. */
function defaultOpacityState(view: ViewId = "map"): Record<LayerId, number> {
  const out = {} as Record<LayerId, number>;
  for (const d of LAYER_DEFS) out[d.id] = 1;
  if (view === "tekening") {
    out["luchtfoto-actueel"] = 0.5;
  }
  return out;
}

/**
 * GIS Layer browser — replaces the regular LeftPanel when the Map view is
 * active. Each entry is a toggleable layer; checking/unchecking dispatches
 * an `ogs:layer-toggle` window event that MapView listens for.
 *
 * Why a window event instead of a Zustand slice?
 * MapView already uses window events for BRO actions (`ogs:bro-load-area`)
 * and Leaflet layer state lives outside of React anyway, so a global event
 * keeps the MapView wiring uniform without adding store machinery.
 *
 * The `ogs:bro-counts` event is dispatched by MapView after each
 * archive-area load, so we can show "X sonderingen / Y boringen geladen"
 * right under the data-layer toggles.
 */
/**
 * Per-view layer state. The Kaart and Sonderingstekening tabs each
 * keep their own checkbox + opacity values, otherwise toggling on
 * one would also fire on the other (both panels subscribe to the
 * same `ogs:layer-toggle` event). We dispatch `{ view, id, enabled }`
 * so the receiving views can filter on their own viewId.
 */
type ViewId = "map" | "tekening";

const mapState = {
  enabled: defaultState("map"),
  opacity: defaultOpacityState("map"),
};
const tekState = {
  enabled: defaultState("tekening"),
  opacity: defaultOpacityState("tekening"),
};
function statesFor(view: ViewId) {
  return view === "tekening" ? tekState : mapState;
}

export default function GisLayerPanel() {
  const { t } = useTranslation();
  // Active view drives which set of layer toggles is shown + edited.
  // We don't have a Zustand slot for activeView, so we use a DOM-attribute
  // fallback: <body data-active-view="...">. App.tsx sets this whenever
  // the active tab changes (see ApplicationShell), and also dispatches
  // `ogs:active-view-changed` so we can re-sync on swap.
  const view: ViewId =
    typeof document !== "undefined" &&
    document.body.dataset.activeView === "tekening"
      ? "tekening"
      : "map";

  const [enabled, setEnabled] = useState<Record<LayerId, boolean>>(
    () => ({ ...statesFor(view).enabled }),
  );
  const [opacity, setOpacity] = useState<Record<LayerId, number>>(
    () => ({ ...statesFor(view).opacity }),
  );
  const [counts, setCounts] = useState<{ cpt: number; bore: number }>({ cpt: 0, bore: 0 });

  // When the active view changes (tab switch), swap the displayed state
  // to that view's snapshot. Triggered by listening to body class change.
  useEffect(() => {
    const onViewChange = () => {
      const v: ViewId =
        document.body.dataset.activeView === "tekening" ? "tekening" : "map";
      setEnabled({ ...statesFor(v).enabled });
      setOpacity({ ...statesFor(v).opacity });
    };
    window.addEventListener("ogs:active-view-changed", onViewChange);
    return () =>
      window.removeEventListener("ogs:active-view-changed", onViewChange);
  }, []);

  // Broadcast initial state on mount so the current view can sync up.
  // We emit both the toggle state and the opacity for every layer — the
  // tekening view starts with luchtfoto-actueel at 50%, so without an
  // opacity broadcast the tile would attach at the (default) full
  // opacity instead of the value the panel claims to show.
  useEffect(() => {
    const broadcast = () => {
      for (const d of LAYER_DEFS) {
        window.dispatchEvent(
          new CustomEvent("ogs:layer-toggle", {
            detail: { view, id: d.id, enabled: enabled[d.id] },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("ogs:layer-opacity", {
            detail: { view, id: d.id, opacity: opacity[d.id] },
          }),
        );
      }
    };
    const id = setTimeout(broadcast, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Subscribe to BRO count notifications from MapView.
  useEffect(() => {
    const onCounts = (e: Event) => {
      const ce = e as CustomEvent<{ cpt: number; bore: number }>;
      setCounts({ cpt: ce.detail.cpt, bore: ce.detail.bore });
    };
    window.addEventListener("ogs:bro-counts", onCounts as EventListener);
    return () => window.removeEventListener("ogs:bro-counts", onCounts as EventListener);
  }, []);

  const toggle = (id: LayerId) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      // Mirror into the cross-component store so a future tab-switch
      // restores the same checkbox state.
      statesFor(view).enabled = next;
      window.dispatchEvent(
        new CustomEvent("ogs:layer-toggle", {
          detail: { view, id, enabled: next[id] },
        }),
      );
      return next;
    });
  };

  const changeOpacity = (id: LayerId, value: number) => {
    setOpacity((prev) => {
      const next = { ...prev, [id]: value };
      // Mirror into the per-view store so a tab-switch restores it later.
      statesFor(view).opacity = next;
      window.dispatchEvent(
        new CustomEvent("ogs:layer-opacity", {
          detail: { view, id, opacity: value },
        }),
      );
      return next;
    });
  };

  const refresh = () => {
    window.dispatchEvent(new CustomEvent("ogs:bro-load-area"));
  };

  const broActive = enabled["bro-sonderingen"] || enabled["bro-boringen"];

  const renderGroup = (group: LayerDef["group"], title: string, footer?: ReactNode) => {
    const items = LAYER_DEFS.filter((d) => d.group === group);
    return (
      <div className="panel-section" key={group}>
        <div className="panel-section-header-row">
          <div className="panel-section-header" style={{ cursor: "default" }}>
            <span className="panel-section-title">{title}</span>
          </div>
        </div>
        <div className="panel-section-body">
          <ul className="gis-layer-list">
            {items.map((d) => {
              const op = opacity[d.id];
              const pct = Math.round(op * 100);
              return (
                <li key={d.id}>
                  <label className="gis-layer-row">
                    <input
                      type="checkbox"
                      checked={enabled[d.id]}
                      onChange={() => toggle(d.id)}
                    />
                    <span className="gis-layer-label">{d.label}</span>
                  </label>
                  <div
                    className="gis-layer-opacity"
                    title={`Transparantie: ${100 - pct}% — slider regelt zichtbaarheid`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={pct}
                      disabled={!enabled[d.id]}
                      onChange={(e) =>
                        changeOpacity(d.id, Number(e.currentTarget.value) / 100)
                      }
                      aria-label={`Transparantie ${d.label}`}
                    />
                    <span className="gis-layer-opacity-val">{pct}%</span>
                  </div>
                  {d.hasLegend && d.id === "ahn" && enabled[d.id] && (
                    <div className="gis-layer-legend">
                      <div className="gis-legend-title">Hoogte NAP</div>
                      <ul className="gis-legend-list">
                        {AHN_LEGEND.map((stop) => (
                          <li key={stop.color}>
                            <span
                              className="gis-legend-swatch"
                              style={{ background: stop.color }}
                              aria-hidden="true"
                            />
                            <span className="gis-legend-label">{stop.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {footer}
        </div>
      </div>
    );
  };

  // Footer for the "data" group: live counts + refresh button. Only shown
  // when at least one BRO layer is on so the panel stays minimal otherwise.
  const dataFooter = broActive ? (
    <div className="gis-bro-footer">
      <div className="gis-bro-counts">
        {enabled["bro-sonderingen"] && (
          <span>{counts.cpt} {t("sondingen", "sonderingen")}</span>
        )}
        {enabled["bro-sonderingen"] && enabled["bro-boringen"] && <span> / </span>}
        {enabled["bro-boringen"] && (
          <span>{counts.bore} {t("boringen", "boringen")}</span>
        )}
        <span> {t("loaded", "geladen")}</span>
      </div>
      <button
        type="button"
        className="gis-bro-refresh"
        onClick={refresh}
        title={t("refreshBro", "Vernieuw BRO archief voor zichtbaar gebied")}
      >
        {t("refresh", "Vernieuw")}
      </button>
    </div>
  ) : null;

  return (
    <div className="left-panel-body">
      <div className="project-header">
        <div className="project-header-icon">
          <MapIcon />
        </div>
        <div className="project-header-text">
          <div className="project-header-title">{t("layers", "Lagen")}</div>
          <div className="project-header-sub">{t("gisLayers", "Kaartlagen + BRO")}</div>
        </div>
      </div>

      {renderGroup("base", t("baseLayers", "Onderlagen"))}
      {renderGroup("overlay", t("overlayLayers", "Overlay"))}
      {renderGroup("data", t("dataLayers", "Data"), dataFooter)}

      <div className="panel-section">
        <div className="panel-section-header-row">
          <div className="panel-section-header" style={{ cursor: "default" }}>
            <span className="panel-section-title">{t("topotijdreis", "Topotijdreis")}</span>
          </div>
        </div>
        <div className="panel-section-body">
          <TopotijdreisSlider />
        </div>
      </div>
    </div>
  );
}

function MapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}
