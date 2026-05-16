import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import proj4 from "proj4";
import {
  useCptStore,
  loadCptFromContent,
  mergeIntoNewProject,
  addBroToActiveProject,
} from "../../store/useCptStore";
import TopotijdreisSlider from "./TopotijdreisSlider";

/**
 * RD New (Amersfoort / EPSG:28992) definition for proj4. PDOK
 * Topotijdreis tiles are served exclusively in RD, so we have to
 * reproject Leaflet's EPSG:3857 tile bounds to ask for the right AGS
 * tile in `createTopotijdreisLayer`.
 */
proj4.defs(
  "EPSG:28992",
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 " +
    "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
    "+towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 " +
    "+units=m +no_defs",
);
const RD_TO_3857 = proj4("EPSG:28992", "EPSG:3857");

/** Tile-matrix metadata for the PDOK / AGS RD tiling scheme
 *  (`default028mm`, scale 1:12 288 000 → 1:6 000). Derived from the
 *  WMTSCapabilities document of every `Historische_tijdreis_<year>`
 *  service. We only need origin + resolutions to derive (col, row). */
const RD_ORIGIN_X = -30515500;
const RD_ORIGIN_Y = 31112400;
/** Resolutions in metres-per-pixel for matrix levels 0..11. */
const RD_RESOLUTIONS = [
  3251.206502413005, 1625.6032512065026, 812.8016256032513,
  406.40081280162565, 203.20040640081282, 101.60020320040641,
  50.800101600203206, 25.400050800101603, 12.700025400050801,
  6.350012700025401, 3.1750063500127004, 1.5875031750063502,
];
const RD_TILE_SIZE = 256;

/**
 * Build a Leaflet GridLayer that overlays the PDOK Topotijdreis service
 * (year `serviceId`, e.g. "1815" or "1823_1829") onto the EPSG:3857 map.
 *
 * The service is tile-only in EPSG:28992 (RD), so we reproject every
 * 256×256 web-mercator tile back to RD, find the best matching AGS
 * tile pyramid level, fetch the four corner tiles that cover the
 * target bbox, stitch them into a canvas, then return that canvas as
 * the Leaflet tile. Costs roughly 1–4 tile fetches per displayed tile;
 * the browser caches the underlying AGS tiles aggressively so panning
 * is cheap after the initial paint.
 */
function createTopotijdreisLayer(serviceId: string): L.GridLayer {
  const url =
    `https://tiles.arcgis.com/tiles/nSZVuSZjHpEZZbRo/arcgis/rest/` +
    `services/Historische_tijdreis_${serviceId}/MapServer/tile`;

  const layer = L.gridLayer({
    tileSize: 256,
    minZoom: 6,
    maxZoom: 18,
    opacity: 1.0,
    attribution: "Topotijdreis © Kadaster / Esri NL",
  }) as L.GridLayer & {
    createTile: (coords: L.Coords, done: L.DoneCallback) => HTMLElement;
  };

  // Custom tile factory — Leaflet calls it whenever it needs a new tile.
  layer.createTile = (coords, done) => {
    const canvas = L.DomUtil.create("canvas") as HTMLCanvasElement;
    canvas.width = RD_TILE_SIZE;
    canvas.height = RD_TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // No 2D context — nothing we can do.
      setTimeout(() => done(undefined, canvas), 0);
      return canvas;
    }

    // Compute tile NW + SE corners (lat/lng), convert each to RD via 3857.
    const tileMap = (layer as unknown as { _map: L.Map })._map;
    const tilePoint = coords.scaleBy(L.point(RD_TILE_SIZE, RD_TILE_SIZE));
    const nwLatLng = tileMap.unproject(tilePoint, coords.z);
    const sePoint = tilePoint.add(L.point(RD_TILE_SIZE, RD_TILE_SIZE));
    const seLatLng = tileMap.unproject(sePoint, coords.z);
    const nwMerc = L.CRS.EPSG3857.project(nwLatLng);
    const seMerc = L.CRS.EPSG3857.project(seLatLng);
    const nwRd = RD_TO_3857.inverse([nwMerc.x, nwMerc.y]);
    const seRd = RD_TO_3857.inverse([seMerc.x, seMerc.y]);

    const minX = Math.min(nwRd[0], seRd[0]);
    const maxX = Math.max(nwRd[0], seRd[0]);
    const minY = Math.min(nwRd[1], seRd[1]);
    const maxY = Math.max(nwRd[1], seRd[1]);

    // Approximate target resolution (m/px) in RD for this Leaflet tile.
    const targetRes = (maxX - minX) / RD_TILE_SIZE;
    // Pick the RD pyramid level whose resolution is just below the
    // target — gives us pixels at least as fine as needed.
    let bestLevel = 0;
    for (let i = RD_RESOLUTIONS.length - 1; i >= 0; i--) {
      if (RD_RESOLUTIONS[i] <= targetRes * 1.5) {
        bestLevel = i;
        break;
      }
      bestLevel = i;
    }
    const rdRes = RD_RESOLUTIONS[bestLevel];
    const rdTileM = rdRes * RD_TILE_SIZE;

    // Range of AGS (col, row) tiles to cover the bbox.
    const colMin = Math.floor((minX - RD_ORIGIN_X) / rdTileM);
    const colMax = Math.floor((maxX - RD_ORIGIN_X) / rdTileM);
    const rowMin = Math.floor((RD_ORIGIN_Y - maxY) / rdTileM);
    const rowMax = Math.floor((RD_ORIGIN_Y - minY) / rdTileM);

    const tilesToFetch: { col: number; row: number; x0: number; y0: number }[] = [];
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        tilesToFetch.push({
          col: c,
          row: r,
          x0: RD_ORIGIN_X + c * rdTileM,
          y0: RD_ORIGIN_Y - r * rdTileM,
        });
      }
    }

    // Map an RD point to canvas pixel coordinates.
    const rdToPx = (rx: number, ry: number): [number, number] => {
      // Reproject back to 3857 for accurate placement within the
      // EPSG:3857 Leaflet tile (cell boundaries don't align with RD).
      const merc = RD_TO_3857.forward([rx, ry]);
      const latLng = L.CRS.EPSG3857.unproject(L.point(merc[0], merc[1]));
      const worldPoint = tileMap.project(latLng, coords.z);
      return [worldPoint.x - tilePoint.x, worldPoint.y - tilePoint.y];
    };

    let remaining = tilesToFetch.length;
    let errored = false;
    if (remaining === 0) {
      setTimeout(() => done(undefined, canvas), 0);
      return canvas;
    }

    for (const t of tilesToFetch) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          // Compute the destination quad on the canvas for this AGS tile.
          const [dx0, dy0] = rdToPx(t.x0, t.y0);
          const [dx1, dy1] = rdToPx(t.x0 + rdTileM, t.y0 - rdTileM);
          const dw = dx1 - dx0;
          const dh = dy1 - dy0;
          ctx.drawImage(img, dx0, dy0, dw, dh);
        } catch (e) {
          errored = true;
          console.warn("topotijdreis drawImage failed", e);
        }
        remaining--;
        if (remaining === 0) done(errored ? new Error("partial fail") : undefined, canvas);
      };
      img.onerror = () => {
        remaining--;
        // Out-of-bounds tiles are normal at the map edges — don't bubble
        // those as errors. Only flag if the request failed entirely.
        if (remaining === 0) done(undefined, canvas);
      };
      img.src = `${url}/${bestLevel}/${t.row}/${t.col}`;
    }

    return canvas;
  };

  return layer;
}

/**
 * Result of a BRO area characteristics search. Mirrors `BroFeature` in
 * Rust (`commands/bro_api.rs`). `extra` carries the loose set of
 * Dutch-labelled metadata fields the backend chose to surface for popup
 * rendering (registration date, depth, quality class, purpose, …).
 */
interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
  kind: "cpt" | "bore";
  registration_date?: string;
  extra: Record<string, string>;
}

/** Minimum zoom level at which we auto-fetch BRO archive features.
 *  Below this the bbox would be huge (thousands of results capped at 2000). */
const MIN_BRO_AUTOFETCH_ZOOM = 12;
/** Debounce window for pan/zoom-triggered refetches. */
const BRO_REFETCH_DEBOUNCE_MS = 500;

/**
 * The MapView component renders a Leaflet map with multiple toggleable layers.
 *
 * Layer architecture
 * ──────────────────
 * - **Base layers** (BRT, luchtfoto …) are persistent `TileLayer` instances
 *   created on init. The GisLayerPanel dispatches `ogs:layer-toggle` events
 *   to add/remove them from the map without recreating them.
 * - **Data layers** (BRO sonderingen/boringen, project markers, distance
 *   lines) live in dedicated `LayerGroup`s. Toggling clears or refills
 *   them; the GroupRef-based design means React effect re-runs don't
 *   accidentally tear down state.
 *
 * Measurement tool
 * ────────────────
 * `Meten` mode is toggled via the `ogs:measure-toggle` event. While
 * active, the first sondering-click captures a start point; the second
 * draws a line + distance label between the two markers, then exits the
 * mode. Esc cancels.
 */
export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Layer refs — built once and reused. `null` until init effect runs.
  const baseLayersRef = useRef<Record<string, L.TileLayer>>({});
  const broLayerRef = useRef<L.LayerGroup | null>(null);
  const broBoresLayerRef = useRef<L.LayerGroup | null>(null);
  const cptLayerRef = useRef<L.LayerGroup | null>(null);
  const distLayerRef = useRef<L.LayerGroup | null>(null);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  // Topotijdreis (historical maps) overlay. Created lazily — there's one
  // layer instance per active year because each service is a separate
  // ArcGIS endpoint. Disposed + recreated when the slider year changes.
  const topotijdreisLayerRef = useRef<L.GridLayer | null>(null);
  /** Snapshot of which base layers were attached just before the user
   *  enabled the topotijdreis overlay. Used to restore them when the
   *  user turns the slider back off. */
  const hiddenBaseLayersRef = useRef<string[]>([]);

  // Enabled state per layer id — drives whether a layer is currently
  // attached to the map. Mirrors the GisLayerPanel toggle state.
  const enabledLayersRef = useRef<Record<string, boolean>>({
    brt: true,
    "project-sonderingen": true,
  });

  // Measurement-mode state — held in a ref so the click handler always
  // sees the latest value without re-binding.
  const measureModeRef = useRef(false);
  const measureStartRef = useRef<{ id: string; lat: number; lon: number; xRd?: number; yRd?: number } | null>(null);

  const [status, setStatus] = useState("Zoom in en klik 'Laad gebied'");
  const [measureMode, setMeasureMode] = useState(false);

  // CPTs from store — used to render project markers + connecting distance lines.
  // Hidden CPTs are filtered out so they don't clutter the map.
  const cptsMap = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const hiddenCptIds = useCptStore((s) => s.hiddenCptIds);
  // Active doc (kind: cpt | project | undefined) — drives whether BRO popups
  // offer the "Maak project + voeg toe" button (only when a single CPT is open).
  const activeDocKind = useCptStore((s) => {
    const doc = s.documents.find((d) => d.id === s.activeDocId);
    return doc?.kind ?? null;
  });
  const cpts = useMemo(
    () => Array.from(cptsMap.values()).filter((c) => !hiddenCptIds.has(c.id)),
    [cptsMap, hiddenCptIds],
  );

  // Refs that mirror the activeDoc/activeCpt state so the imperative
  // popup-render closures can read the latest value without re-binding.
  const activeDocKindRef = useRef<typeof activeDocKind>(activeDocKind);
  const activeCptIdRef = useRef<string | null>(activeCptId);
  useEffect(() => { activeDocKindRef.current = activeDocKind; }, [activeDocKind]);
  useEffect(() => { activeCptIdRef.current = activeCptId; }, [activeCptId]);

  // ── 1. Init map (one-time) ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current).setView([52.156, 5.388], 8);

    // Build all base layers up front (cheap — they're just URL templates).
    const baseLayers: Record<string, L.TileLayer> = {};
    baseLayers["brt"] = L.tileLayer(
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "Kaartgegevens © Kadaster | PDOK", maxZoom: 19 },
    );
    baseLayers["luchtfoto-actueel"] = L.tileLayer(
      "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
      { attribution: "Luchtfoto © PDOK", maxZoom: 19 },
    );
    // PDOK WMTS yearly aerial layers — identifier convention is `${year}_ortho25`
    // (NOT `Actueel_ortho25_${year}`, which returns HTTP 400). Verified against
    // https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/WMTSCapabilities.xml
    // Exception: 2021 only ships as `2021_orthoHR` (no ortho25 variant).
    const yearLayerIds: Record<string, string> = {
      "2025": "2025_ortho25",
      "2024": "2024_ortho25",
      "2023": "2023_ortho25",
      "2022": "2022_ortho25",
      "2021": "2021_orthoHR",
      "2020": "2020_ortho25",
      "2019": "2019_ortho25",
      "2018": "2018_ortho25",
      "2017": "2017_ortho25",
      "2016": "2016_ortho25",
    };
    for (const [year, layerId] of Object.entries(yearLayerIds)) {
      baseLayers[`luchtfoto-${year}`] = L.tileLayer(
        `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${layerId}/EPSG:3857/{z}/{x}/{y}.jpeg`,
        { attribution: "Luchtfoto © PDOK", maxZoom: 19 },
      );
    }
    baseLayersRef.current = baseLayers;
    // Default: BRT on.
    baseLayers["brt"].addTo(map);

    // Data layer groups — kept always attached so we just clear/refill.
    broLayerRef.current = L.layerGroup().addTo(map);
    broBoresLayerRef.current = L.layerGroup().addTo(map);
    distLayerRef.current = L.layerGroup().addTo(map);   // pairwise distance lines
    cptLayerRef.current = L.layerGroup().addTo(map);    // project sondering markers
    measureLayerRef.current = L.layerGroup().addTo(map); // measure lines

    mapRef.current = map;

    // ── BRO load helpers ─────────────────────────────────────
    /**
     * Render one CPT-archive marker. Lightweight grey down-triangle so it
     * reads as "background data" against the louder amber project markers.
     * Click → fetch the full GEF/XML and load it as a project tab.
     */
    const renderCptMarker = (f: BroFeature): L.Marker => {
      const html = `
        <div class="bro-sondering-marker">
          <svg width="14" height="14" viewBox="0 0 14 14" overflow="visible">
            <polygon points="1,1 13,1 7,13"
                     fill="#A1A1AA" stroke="#52525B"
                     stroke-width="1" stroke-linejoin="round" />
          </svg>
        </div>
      `;
      const m = L.marker([f.lat, f.lon], {
        icon: L.divIcon({
          className: "bro-sondering-icon",
          html,
          iconSize: [14, 14],
          iconAnchor: [7, 13],
        }),
      });
      // Render popup HTML lazily via popupopen so it reflects the *current*
      // activeDocKind — otherwise switching between a project and a CPT tab
      // wouldn't update which buttons appear in already-rendered popups.
      m.bindPopup("", { minWidth: 240 });
      m.on("popupopen", () => {
        // Three-way fork on what the active document currently is:
        //  - "project" → offer "Voeg toe aan project" (+ "Open in viewer")
        //  - "cpt"     → offer "Maak project + voeg toe" (+ "Open in viewer")
        //  - null      → only "Open in viewer"
        const kind = activeDocKindRef.current;
        const action: PopupAction =
          kind === "project" ? "addToProject" :
          kind === "cpt" ? "merge" :
          "openOnly";
        m.setPopupContent(buildPopupHtml(f, /* loadable = */ true, action));
      });
      m.on("click", () => { if (measureModeRef.current) m.closePopup(); });
      // The "Open in tool" anchor inside the popup uses a window-level
      // delegated click handler (see installPopupClickDelegate) so we
      // don't have to re-bind a listener every time the popup opens.
      return m;
    };

    /**
     * Render one borehole marker. Different shape (circle) so the user
     * instantly distinguishes it from a sondering even at low zoom.
     */
    const renderBoreMarker = (f: BroFeature): L.CircleMarker => {
      const m = L.circleMarker([f.lat, f.lon], {
        radius: 4,
        color: "#52525B",
        weight: 1,
        fillColor: "#D4D4D8",
        fillOpacity: 0.85,
      });
      m.bindPopup(buildPopupHtml(f, /* loadable = */ false, "openOnly"), { minWidth: 240 });
      return m;
    };

    /**
     * Compose a one-shot fetch+render for the area currently shown by the
     * map. Honors the per-layer enabled flags — skipped layers are not
     * fetched at all (saves a network round-trip on every pan).
     */
    let pendingAbort: AbortController | null = null;
    const loadVisibleArea = async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;
      const z = map.getZoom();
      const sondOn = enabledLayersRef.current["bro-sonderingen"];
      const boresOn = enabledLayersRef.current["bro-boringen"];
      if (!sondOn && !boresOn) {
        // Nothing to do — don't waste a request, but clear stale data.
        broLayerRef.current?.clearLayers();
        broBoresLayerRef.current?.clearLayers();
        emitBroCounts(0, 0);
        return;
      }
      if (!force && z < MIN_BRO_AUTOFETCH_ZOOM) {
        setStatus(`Zoom in tot zoomniveau ${MIN_BRO_AUTOFETCH_ZOOM}+ om archief te laden`);
        return;
      }
      // Cancel any in-flight load — a second pan during loading would
      // otherwise produce two interleaved sets of markers.
      if (pendingAbort) pendingAbort.abort();
      pendingAbort = new AbortController();
      const myAbort = pendingAbort;

      const b = map.getBounds();
      const bbox = {
        min_lat: b.getSouth(),
        min_lon: b.getWest(),
        max_lat: b.getNorth(),
        max_lon: b.getEast(),
      };
      setStatus("Bezig met laden...");
      // Fire both calls in parallel — independent endpoints.
      const tasks: Promise<void>[] = [];
      let cptCount = 0;
      let boreCount = 0;
      if (sondOn) {
        tasks.push(
          invoke<BroFeature[]>("fetch_bro_area", { bbox })
            .then((features) => {
              if (myAbort.signal.aborted) return;
              broLayerRef.current?.clearLayers();
              features.forEach((f) => broLayerRef.current?.addLayer(renderCptMarker(f)));
              cptCount = features.length;
            })
            .catch((e) => {
              console.warn("fetch_bro_area failed", e);
              broLayerRef.current?.clearLayers();
            }),
        );
      } else {
        broLayerRef.current?.clearLayers();
      }
      if (boresOn) {
        tasks.push(
          invoke<BroFeature[]>("fetch_bro_bores", { bbox })
            .then((features) => {
              if (myAbort.signal.aborted) return;
              broBoresLayerRef.current?.clearLayers();
              features.forEach((f) => broBoresLayerRef.current?.addLayer(renderBoreMarker(f)));
              boreCount = features.length;
            })
            .catch((e) => {
              console.warn("fetch_bro_bores failed", e);
              broBoresLayerRef.current?.clearLayers();
            }),
        );
      } else {
        broBoresLayerRef.current?.clearLayers();
      }
      try {
        await Promise.all(tasks);
        if (myAbort.signal.aborted) return;
        emitBroCounts(cptCount, boreCount);
        setStatus(broCountSummary(cptCount, boreCount, sondOn, boresOn));
      } catch (e) {
        if (!myAbort.signal.aborted) setStatus(`Fout: ${String(e)}`);
      }
    };

    // Public handlers (window events) ─────────────────────────
    const onLoad = () => {
      // Explicit "Laad gebied" button always forces, even at low zoom.
      void loadVisibleArea({ force: true });
    };
    const onClear = () => {
      pendingAbort?.abort();
      broLayerRef.current?.clearLayers();
      broBoresLayerRef.current?.clearLayers();
      emitBroCounts(0, 0);
      setStatus("BRO-markers gewist");
    };

    // Auto-refetch on pan/zoom-end, debounced. Only kicks in when at
    // least one BRO layer is enabled — saves a request per pan otherwise.
    let panTimer: number | null = null;
    const onMoveEnd = () => {
      if (panTimer) window.clearTimeout(panTimer);
      panTimer = window.setTimeout(() => {
        const sondOn = enabledLayersRef.current["bro-sonderingen"];
        const boresOn = enabledLayersRef.current["bro-boringen"];
        if (!sondOn && !boresOn) return;
        // Don't auto-fetch when zoomed too far out — bbox would be huge.
        if (map.getZoom() < MIN_BRO_AUTOFETCH_ZOOM) return;
        void loadVisibleArea();
      }, BRO_REFETCH_DEBOUNCE_MS);
    };
    map.on("moveend", onMoveEnd);

    /**
     * Click delegate for the action anchors inside our BRO popups —
     * "Open in viewer", "Maak project + voeg toe", and "Voeg toe aan
     * project". We use document-level delegation rather than per-popup
     * listeners because Leaflet recreates the popup content node on each
     * open.
     */
    const onPopupClick = async (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const open = target.closest("a.bro-popup-open");
      const merge = target.closest("a.bro-popup-merge");
      const add = target.closest("a.bro-popup-add-to-project");
      const a = open ?? merge ?? add;
      if (!a) return;
      e.preventDefault();
      const id = a.getAttribute("data-id");
      if (!id) return;
      try {
        if (add) {
          // Active document is a project — fetch the BRO XML and append
          // it to the active project. The store helper handles the
          // fetch + open_cpt invoke + project mutation atomically.
          await addBroToActiveProject(id);
        } else if (merge) {
          const xml = await invoke<string>("fetch_bro_cpt", { broId: id });
          const existing = activeCptIdRef.current;
          if (!existing) {
            // No active CPT — fall back to a normal open in a new tab.
            await loadCptFromContent(xml, `${id}.xml`);
          } else {
            await mergeIntoNewProject(existing, xml, `${id}.xml`);
          }
        } else {
          const xml = await invoke<string>("fetch_bro_cpt", { broId: id });
          await loadCptFromContent(xml, `${id}.xml`);
        }
        map.closePopup();
      } catch (err) {
        console.error("BRO popup action failed", err);
      }
    };
    document.addEventListener("click", onPopupClick);

    /** Honor an `ogs:layer-toggle` event by adding/removing the matching
     *  layer object. For data layers we toggle visibility by attaching or
     *  detaching the `LayerGroup` to the map. */
    const onLayerToggle = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; enabled: boolean }>;
      const { id, enabled } = ce.detail;
      const wasEnabled = enabledLayersRef.current[id] === true;
      enabledLayersRef.current[id] = enabled;

      // Base layers — directly add/remove the TileLayer.
      const base = baseLayersRef.current[id];
      if (base) {
        if (enabled) {
          if (!map.hasLayer(base)) base.addTo(map);
        } else {
          if (map.hasLayer(base)) map.removeLayer(base);
        }
        return;
      }

      // Data layers — toggle the LayerGroup attachment.
      const dataLayer =
        id === "bro-sonderingen" ? broLayerRef.current :
        id === "bro-boringen" ? broBoresLayerRef.current :
        id === "project-sonderingen" ? cptLayerRef.current :
        null;
      if (!dataLayer) return;
      if (enabled) {
        if (!map.hasLayer(dataLayer)) dataLayer.addTo(map);
      } else {
        if (map.hasLayer(dataLayer)) map.removeLayer(dataLayer);
      }
      // The pairwise-distance lines piggy-back on the project layer.
      if (id === "project-sonderingen" && distLayerRef.current) {
        if (enabled) {
          if (!map.hasLayer(distLayerRef.current)) distLayerRef.current.addTo(map);
        } else {
          if (map.hasLayer(distLayerRef.current)) map.removeLayer(distLayerRef.current);
        }
      }

      // Newly-enabled BRO layer → kick off an immediate load for the
      // current viewport so the user doesn't have to manually pan.
      if ((id === "bro-sonderingen" || id === "bro-boringen") && enabled && !wasEnabled) {
        void loadVisibleArea({ force: true });
      }
    };

    /**
     * Handle the Topotijdreis slider event. Detail.serviceId is the AGS
     * service identifier suffix (e.g. "1815" or "1823_1829") or null to
     * remove the layer and restore the previously-active base layers.
     */
    const onTopoYear = (e: Event) => {
      const ce = e as CustomEvent<{ year: number | null; serviceId: string | null }>;
      const { serviceId } = ce.detail;

      // Always remove the previous topotijdreis layer first.
      if (topotijdreisLayerRef.current && map.hasLayer(topotijdreisLayerRef.current)) {
        map.removeLayer(topotijdreisLayerRef.current);
      }
      topotijdreisLayerRef.current = null;

      if (serviceId) {
        // Hide every currently-attached base layer so the historical
        // map shows up cleanly — and remember which ones we hid so we
        // can put them back when the slider goes off.
        if (hiddenBaseLayersRef.current.length === 0) {
          for (const [id, lyr] of Object.entries(baseLayersRef.current)) {
            if (map.hasLayer(lyr)) {
              hiddenBaseLayersRef.current.push(id);
              map.removeLayer(lyr);
            }
          }
        }
        const layer = createTopotijdreisLayer(serviceId);
        layer.addTo(map);
        topotijdreisLayerRef.current = layer;
      } else {
        // Slider went to "off" — restore every base layer that was
        // attached when we took over.
        for (const id of hiddenBaseLayersRef.current) {
          const lyr = baseLayersRef.current[id];
          if (lyr && !map.hasLayer(lyr)) lyr.addTo(map);
        }
        hiddenBaseLayersRef.current = [];
      }
    };

    /** Toggle measurement mode from the ribbon. */
    const onMeasureToggle = () => {
      measureModeRef.current = !measureModeRef.current;
      setMeasureMode(measureModeRef.current);
      measureStartRef.current = null;
      // Clear any prior measurement (highlight + line + label) on every toggle.
      measureLayerRef.current?.clearLayers();
      setStatus(measureModeRef.current
        ? "Meet-modus: klik op een punt of sondering om te starten"
        : "Meet-modus uit");
    };

    /** Generic map-click handler for measure mode — works for any spot on
     *  the map, not just project-sondering markers. Marker-specific click
     *  handlers (project sonderings) preempt this when a marker is hit. */
    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (!measureModeRef.current) return;
      handleMeasurePoint(e.latlng.lat, e.latlng.lng, undefined);
    };

    /** Shared click → measure handler. Called by both the marker on-click
     *  callbacks (registered in the project-CPT useEffect) and the generic
     *  map onMapClick. `id` is provided when the click came from a known
     *  CPT marker, used in the status string. */
    const handleMeasurePoint = (
      lat: number,
      lon: number,
      id?: string,
    ) => {
      if (!measureStartRef.current) {
        measureStartRef.current = { id: id ?? "punt", lat, lon };
        // Visible highlight so the user sees the first click landed.
        measureLayerRef.current?.clearLayers();
        const startMarker = L.circleMarker([lat, lon], {
          radius: 9,
          color: "#2563EB",
          weight: 3,
          fillColor: "#60A5FA",
          fillOpacity: 0.35,
        });
        measureLayerRef.current?.addLayer(startMarker);
        setStatus(
          id
            ? `Meet vanaf ${id} — klik op een tweede punt`
            : `Startpunt vastgelegd — klik op een tweede punt`,
        );
        return;
      }
      const start = measureStartRef.current;
      // Draw line + label
      measureLayerRef.current?.clearLayers();
      const line = L.polyline(
        [[start.lat, start.lon], [lat, lon]],
        { color: "#2563EB", weight: 2.5, opacity: 0.9 },
      );
      measureLayerRef.current?.addLayer(line);
      // Distance via great-circle (Leaflet helper, returns metres).
      const dist = mapRef.current?.distance([start.lat, start.lon], [lat, lon]) ?? 0;
      const mid = L.latLng((start.lat + lat) / 2, (start.lon + lon) / 2);
      const label = L.marker(mid, {
        icon: L.divIcon({
          className: "cpt-measure-label",
          html: `<span>${formatDist(dist)}</span>`,
          iconSize: [80, 22],
          iconAnchor: [40, 11],
        }),
        interactive: false,
      });
      measureLayerRef.current?.addLayer(label);
      const startLabel = start.id !== "punt" ? start.id : "punt";
      const endLabel = id ?? "punt";
      setStatus(`Afstand ${startLabel} ↔ ${endLabel}: ${formatDist(dist)}`);
      measureModeRef.current = false;
      setMeasureMode(false);
      measureStartRef.current = null;
    };

    // Expose handleMeasurePoint to the project-CPT useEffect via the
    // measureLayerRef host (we use a closure-stable ref attached to it).
    (measureLayerRef.current as unknown as { __handleMeasurePoint?: typeof handleMeasurePoint }).__handleMeasurePoint = handleMeasurePoint;

    map.on("click", onMapClick);

    /** Esc cancels measurement mode. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && measureModeRef.current) {
        measureModeRef.current = false;
        setMeasureMode(false);
        measureStartRef.current = null;
        measureLayerRef.current?.clearLayers();
        setStatus("Meet-modus geannuleerd");
      }
    };

    window.addEventListener("ogs:bro-load-area", onLoad);
    window.addEventListener("ogs:bro-clear", onClear);
    window.addEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
    window.addEventListener("ogs:measure-toggle", onMeasureToggle);
    window.addEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("ogs:bro-load-area", onLoad);
      window.removeEventListener("ogs:bro-clear", onClear);
      window.removeEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
      window.removeEventListener("ogs:measure-toggle", onMeasureToggle);
      window.removeEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onPopupClick);
      map.off("moveend", onMoveEnd);
      map.off("click", onMapClick);
      if (panTimer) window.clearTimeout(panTimer);
      pendingAbort?.abort();
      map.remove();
    };
  }, []);

  // ── 2. Render project CPTs (markers + distance lines) ─────
  useEffect(() => {
    const map = mapRef.current;
    const cptLayer = cptLayerRef.current;
    const distLayer = distLayerRef.current;
    if (!map || !cptLayer || !distLayer) return;
    cptLayer.clearLayers();
    distLayer.clearLayers();

    // Convert RD → WGS84 for each CPT that has a position.
    const positioned = cpts
      .filter((c) => c.position != null)
      .map((c) => {
        const { lat, lon } = rdToWgs84(c.position!.x_rd, c.position!.y_rd);
        return { cpt: c, lat, lon };
      });
    if (positioned.length === 0) return;

    // Add markers as the conventional Dutch sondeer-symbol: a downward
    // triangle (point on the ground) with the CPT id as a label next to it.
    positioned.forEach(({ cpt, lat, lon }) => {
      const isActive = cpt.id === activeCptId;
      const fill = isActive ? "#F59E0B" : "#D97706";
      const stroke = isActive ? "#36363E" : "#36363E";
      // Sondeer-symbool (Dutch convention): triangle with apex pointing DOWN
      // into the ground at the actual location. Base at top, apex at (11, 20).
      const html = `
        <div class="cpt-sondeer-marker${isActive ? " active" : ""}">
          <svg width="22" height="22" viewBox="0 0 22 22" overflow="visible">
            <polygon points="2,2 20,2 11,20"
                     fill="${fill}" stroke="${stroke}" stroke-width="1.6"
                     stroke-linejoin="round" />
          </svg>
          <span class="cpt-sondeer-label">${cpt.id}</span>
        </div>
      `;
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: "cpt-sondeer-icon",   // strip default Leaflet styling
          html,
          iconSize: [22, 22],
          iconAnchor: [11, 20],            // anchor at the apex (now at the bottom)
        }),
      }).bindPopup(`<strong>${cpt.id}</strong><br>${cpt.metadata.project_name ?? ""}<br>RD ${cpt.position!.x_rd.toFixed(1)}, ${cpt.position!.y_rd.toFixed(1)}<br>diepte tot ${cpt.points.reduce((m, p) => Math.max(m, p.depth), 0).toFixed(1)} m`);

      // Measurement-mode click handler — delegates to the shared
      // `handleMeasurePoint` set up in the init effect. Snapping to the
      // marker centre (rather than the click latLng) gives precise
      // CPT-to-CPT distances even when the user mis-clicks.
      marker.on("click", (e) => {
        if (!measureModeRef.current) return;
        // Stop propagation so the map's onClick doesn't also fire and
        // record a generic point at the same location.
        L.DomEvent.stopPropagation(e);
        marker.closePopup();
        if (measureStartRef.current?.id === cpt.id) {
          setStatus("Kies een andere sondering");
          return;
        }
        const handler = (
          measureLayerRef.current as unknown as {
            __handleMeasurePoint?: (lat: number, lon: number, id?: string) => void;
          }
        )?.__handleMeasurePoint;
        handler?.(lat, lon, cpt.id);
      });
      cptLayer.addLayer(marker);
    });

    // Pairwise distances — draw amber lines between every pair, with midpoint label.
    if (positioned.length >= 2) {
      for (let i = 0; i < positioned.length; i++) {
        for (let j = i + 1; j < positioned.length; j++) {
          const a = positioned[i];
          const b = positioned[j];
          // Distance in meters via RD coords (already in meters).
          const dx = a.cpt.position!.x_rd - b.cpt.position!.x_rd;
          const dy = a.cpt.position!.y_rd - b.cpt.position!.y_rd;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const line = L.polyline(
            [[a.lat, a.lon], [b.lat, b.lon]],
            { color: "#D97706", weight: 1.4, opacity: 0.65, dashArray: "4 5" },
          );
          distLayer.addLayer(line);
          const mid = L.latLng((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
          const label = L.marker(mid, {
            icon: L.divIcon({
              className: "cpt-distance-label",
              html: `<span>${formatDist(dist)}</span>`,
              iconSize: [60, 18],
              iconAnchor: [30, 9],
            }),
            interactive: false,
          });
          distLayer.addLayer(label);
        }
      }
    }

    // Auto-fit bounds the first time we get positions, but don't keep
    // re-fitting on every re-render — would yank the view away from the user.
    if (positioned.length === 1) {
      // Only zoom in if currently very zoomed-out.
      if (map.getZoom() < 12) map.setView([positioned[0].lat, positioned[0].lon], 17);
    } else {
      const bounds = L.latLngBounds(positioned.map((p) => [p.lat, p.lon] as [number, number]));
      const current = map.getBounds();
      // Only auto-fit if the markers are largely outside the current view.
      if (!current.contains(bounds)) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
      }
    }

    // Whenever the active CPT changes, gently pan to centre it (without
    // changing zoom — the user's zoom level is preserved).
    if (activeCptId) {
      const active = positioned.find((p) => p.cpt.id === activeCptId);
      if (active) {
        const targetLatLng = L.latLng(active.lat, active.lon);
        if (!map.getBounds().contains(targetLatLng)) {
          map.panTo(targetLatLng, { animate: true });
        }
      }
    }
  }, [cpts, activeCptId]);

  return (
    <div className="map-view-wrap">
      <div ref={containerRef} className={`map-view-container${measureMode ? " measuring" : ""}`} />
      <div className="map-status">
        {cpts.filter((c) => c.position).length > 0 && (
          <span className="map-cpt-count">{cpts.filter((c) => c.position).length} sondering(en) ·&nbsp;</span>
        )}
        {status}
      </div>
      <TopotijdreisSlider />
    </div>
  );
}

function formatDist(meters: number): string {
  if (meters < 1) return `${(meters * 100).toFixed(0)} cm`;
  if (meters < 1000) return `${meters.toFixed(1)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Which secondary action a BRO popup should offer alongside (or instead
 * of) the primary "Open in viewer" link. Determined by the kind of the
 * currently-active document tab — see the `popupopen` handler.
 *
 * - `addToProject` — active doc is a project; offer "Voeg toe aan project"
 * - `merge`        — active doc is a single CPT; offer "Maak project + voeg toe"
 * - `openOnly`     — no active doc, or the marker isn't loadable; only
 *                    show the primary link.
 */
type PopupAction = "addToProject" | "merge" | "openOnly";

/**
 * Build the popup content for a BRO marker. Uses the loose `extra` map
 * the backend filled with Dutch-labelled fields. The action anchors are
 * wired up by a delegated click handler in the MapView init effect:
 *   - `a.bro-popup-open[data-id]`           → "Open in viewer"
 *   - `a.bro-popup-merge[data-id]`          → "Maak project + voeg toe"
 *   - `a.bro-popup-add-to-project[data-id]` → "Voeg toe aan project"
 */
function buildPopupHtml(f: BroFeature, loadable: boolean, action: PopupAction): string {
  const kindLabel = f.kind === "cpt" ? "Sondering (BRO)" : "Boring (BHR-GT)";
  const reg = f.registration_date ? ` &middot; ${escapeHtml(f.registration_date)}` : "";
  const rows = Object.entries(f.extra)
    .map(
      ([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const id = escapeHtml(f.id);
  const openAction = loadable
    ? `<a href="#" class="bro-popup-open" data-id="${id}">Open in viewer &rarr;</a>`
    : "";
  const secondaryAction =
    !loadable
      ? ""
      : action === "merge"
        ? `<a href="#" class="bro-popup-merge" data-id="${id}">Maak project + voeg toe</a>`
        : action === "addToProject"
          ? `<a href="#" class="bro-popup-add-to-project" data-id="${id}">Voeg toe aan project</a>`
          : "";
  const actionRow = openAction || secondaryAction
    ? `<div class="bro-popup-actions">${openAction}${secondaryAction}</div>`
    : "";
  return `
    <div class="bro-popup">
      <div class="bro-popup-header">
        <strong>${id}</strong>
        <span class="bro-popup-kind">${escapeHtml(kindLabel)}${reg}</span>
      </div>
      <table class="bro-popup-table"><tbody>${rows}</tbody></table>
      ${actionRow}
    </div>
  `;
}

/** Notify the GIS-layer panel of the most recent BRO load counts. */
function emitBroCounts(cpt: number, bore: number) {
  window.dispatchEvent(
    new CustomEvent("ogs:bro-counts", { detail: { cpt, bore } }),
  );
}

/** Compose a status-bar string summarising what was just loaded. */
function broCountSummary(cpt: number, bore: number, sondOn: boolean, boresOn: boolean): string {
  const parts: string[] = [];
  if (sondOn) parts.push(`${cpt} sondering(en)`);
  if (boresOn) parts.push(`${bore} boring(en)`);
  return `${parts.join(" / ")} geladen`;
}

/** Cheap HTML escape — popups embed user-uncontrolled BRO text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline RD → WGS84 (Schreutelkamp 2001), mirrors cpt-core::coords::rd_to_wgs84.
function rdToWgs84(x: number, y: number): { lat: number; lon: number } {
  const X0 = 155_000.0, Y0 = 463_000.0;
  const PHI0 = 52.15517440, LAM0 = 5.38720621;
  const dx = (x - X0) * 1e-5;
  const dy = (y - Y0) * 1e-5;
  const kp: [number, number, number][] = [
    [0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.24750], [2, 1, -0.84978],
    [0, 3, -0.06550], [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.00530],
    [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012],
  ];
  const lp: [number, number, number][] = [
    [1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885],
    [1, 3, 0.05594], [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256],
    [1, 4, 0.00128], [0, 2, 0.00022], [2, 0, -0.00022], [5, 0, 0.00026],
  ];
  let dphi = 0, dlam = 0;
  for (const [p, q, k] of kp) dphi += k * Math.pow(dx, p) * Math.pow(dy, q);
  for (const [p, q, l] of lp) dlam += l * Math.pow(dx, p) * Math.pow(dy, q);
  return { lat: PHI0 + dphi / 3600, lon: LAM0 + dlam / 3600 };
}
