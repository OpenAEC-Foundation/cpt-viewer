import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
  | "bro-sonderingen"
  | "bro-boringen"
  | "project-sonderingen";

interface LayerDef {
  id: LayerId;
  label: string;
  group: "base" | "overlay" | "data";
  defaultOn: boolean;
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

  // BRO data layers — sonderingen on by default so the map shows public CPTs
  // immediately when the user opens the Kaart tab.
  { id: "bro-sonderingen", label: "BRO Sonderingen", group: "data", defaultOn: true },
  { id: "bro-boringen", label: "BRO Boringen", group: "data", defaultOn: false },

  // Project layer
  { id: "project-sonderingen", label: "Project sonderingen", group: "data", defaultOn: true },
];

/**
 * Initial state — must be a *function* so the defaults are computed once,
 * not regenerated on every render.
 */
function defaultState(): Record<LayerId, boolean> {
  const out = {} as Record<LayerId, boolean>;
  for (const d of LAYER_DEFS) out[d.id] = d.defaultOn;
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
export default function GisLayerPanel() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<Record<LayerId, boolean>>(defaultState);
  const [counts, setCounts] = useState<{ cpt: number; bore: number }>({ cpt: 0, bore: 0 });

  // Broadcast initial state on mount so MapView can sync up.
  // We defer with a microtask so MapView's effect (which attaches the
  // listener) has a chance to run first — both components mount in the
  // same render pass, and React commits effects in DOM order, which
  // means the left-panel sibling fires its effects before the main view.
  useEffect(() => {
    const broadcast = () => {
      for (const d of LAYER_DEFS) {
        window.dispatchEvent(
          new CustomEvent("ogs:layer-toggle", {
            detail: { id: d.id, enabled: enabled[d.id] },
          }),
        );
      }
    };
    const id = setTimeout(broadcast, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      window.dispatchEvent(
        new CustomEvent("ogs:layer-toggle", {
          detail: { id, enabled: next[id] },
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
            {items.map((d) => (
              <li key={d.id}>
                <label className="gis-layer-row">
                  <input
                    type="checkbox"
                    checked={enabled[d.id]}
                    onChange={() => toggle(d.id)}
                  />
                  <span>{d.label}</span>
                </label>
              </li>
            ))}
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
      {renderGroup("data", t("dataLayers", "Data"), dataFooter)}
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
