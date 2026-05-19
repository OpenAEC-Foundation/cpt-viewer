import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import { fetchBagPanden, fetchKadasterPercelen } from "../../utils/pdokWfs";
import { AdressenLayer } from "../../utils/adressenLayer";
import MapAddressSearch from "./MapAddressSearch";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import proj4 from "proj4";
import {
  useCptStore,
  loadCptFromContent,
  loadBoreFromContent,
  mergeIntoNewProject,
  addBroToActiveProject,
} from "../../store/useCptStore";
import { setLayerLive } from "../../store/tekeningState";
// Topotijdreis slider lives in the GisLayerPanel (left side, with the
// other map layer controls) — not in this view's bottom bar.

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
  // Adressen layer is fundamentally a vector overlay (WFS-driven); we
  // hold a dedicated instance so the toggle / opacity handlers can talk
  // to its public attach/detach/setOpacity methods.
  const adressenLayerRef = useRef<AdressenLayer | null>(null);
  const broLayerRef = useRef<L.LayerGroup | null>(null);
  const broBoresLayerRef = useRef<L.LayerGroup | null>(null);
  const cptLayerRef = useRef<L.LayerGroup | null>(null);
  const distLayerRef = useRef<L.LayerGroup | null>(null);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  // Topotijdreis (historical maps) overlay. Created lazily — there's one
  // layer instance per active year because each service is a separate
  // ArcGIS endpoint. Disposed + recreated when the slider year changes.
  const topotijdreisLayerRef = useRef<L.GridLayer | null>(null);
  // PDOK WFS-driven overlays — BAG (grey + red outline polygons) and
  // Kadaster (dashed center-line per perceelgrens). Both are populated
  // on moveend when their toggle is enabled.
  const bagLayerRef = useRef<L.LayerGroup | null>(null);
  const kadasterLayerRef = useRef<L.LayerGroup | null>(null);
  const bagAbortRef = useRef<AbortController | null>(null);
  const kadasterAbortRef = useRef<AbortController | null>(null);
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

  /** Per-layer opacity (0..1). Defaults to 1.0 for any unknown id. Used
   *  by `onLayerOpacity` to apply transparency to tile/marker layers
   *  and to remember the value when new markers get added later
   *  (e.g. after a BRO archive reload). */
  const layerOpacityRef = useRef<Record<string, number>>({});
  /** Last document id we auto-fitted the map for. `null` until the
   *  first fit. Mismatch with `activeDocId` triggers a force-fit even
   *  when the markers are already in the current view — used so a
   *  tab-switch into Kaart with a project loaded snaps to the
   *  sonderingen immediately. */
  const fittedDocIdRef = useRef<string | null>(null);

  /** When a topotijdreis layer is active it replaces the base layers, so
   *  user-driven opacity slider for a base layer should also affect the
   *  topotijdreis overlay. This ref holds the id of the base layer whose
   *  opacity should mirror to the topotijdreis layer (the "actueel" base
   *  acts as proxy by default). */
  const topoOpacityProxyRef = useRef<string>("luchtfoto-actueel");

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
  const activeDocId = useCptStore((s) => s.activeDocId);
  const hiddenCptIds = useCptStore((s) => s.hiddenCptIds);
  // CPT-selectie state (Ctrl/Cmd+klik = toggle, Shift+drag = box-select).
  // Wordt door dit component zelf onderhouden via store-actions; andere
  // views (LeftPanel, Situatietekening) kunnen er op reageren.
  const selectedCptIds = useCptStore((s) => s.selectedCptIds);
  const toggleCptSelection = useCptStore((s) => s.toggleCptSelection);
  const selectCpts = useCptStore((s) => s.selectCpts);
  const clearCptSelection = useCptStore((s) => s.clearCptSelection);
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
    // Lifecycle-guards: `disposed` wordt aan het einde van het effect
    // op true gezet bij cleanup. Hoog up gedeclareerd zodat reloadBag/
    // reloadKadaster (verderop gedefinieerd binnen dit effect) er bij
    // kunnen. autoEnableTimeouts collecteert setTimeout-IDs voor de
    // staggered toggle-dispatch, ook in cleanup leeggemaakt.
    let disposed = false;
    const autoEnableTimeouts: number[] = [];
    // Default-locatie: Lange Gelderse Kade 1, Dordrecht — historisch
    // centrum aan de Voorstraathaven. Zoom 18 zodat de gebruiker
    // direct het pand + omgeving ziet (BAG + Kadaster overlays zijn
    // bij dit zoom-niveau leesbaar). Zodra de gebruiker zelf pant
    // schrijft `setLastMapView` de nieuwe positie in de store en
    // wordt deze default niet meer toegepast op subsequent mounts.
    const DEFAULT_LAT = 51.81317;
    const DEFAULT_LON = 4.67242;
    const DEFAULT_ZOOM = 18;
    const seed = useCptStore.getState().lastMapView;
    const initLat = seed?.lat ?? DEFAULT_LAT;
    const initLon = seed?.lon ?? DEFAULT_LON;
    const initZoom = seed?.zoom ?? DEFAULT_ZOOM;
    const map = L.map(containerRef.current).setView(
      [initLat, initLon],
      initZoom,
    );
    // Shift+drag is bij ons voor CPT-selectie (zie de selection-
    // effect verderop). Direct hier disablen zodat de gebruiker niet
    // per ongeluk Leaflet's BoxZoom triggert vóór die effect draait.
    try { map.boxZoom.disable(); } catch { /* noop */ }
    // Belt-and-braces: dragging expliciet enabled houden. De CPT-
    // selectie-effect disablet hem tijdelijk tijdens een Shift-drag
    // en re-enabled op mouseup — als de effect-cleanup midden in een
    // drag draait kon dragging eerder hangen op "disabled" en moest
    // de gebruiker tab-switchen om weer te kunnen pannen. Re-enable
    // bij elke moveend als safety-net.
    try { map.dragging.enable(); } catch { /* noop */ }
    map.on("moveend", () => {
      try { if (!map.dragging.enabled()) map.dragging.enable(); } catch { /* noop */ }
    });

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
    // ── Adressen + straatnamen ──────────────────────────────────
    // Vector overlay backed by PDOK BAG WFS — no tiles, no CartoDB.
    // The AdressenLayer fetches `bag:openbareruimte` (street polygons →
    // centroid labels) and `bag:nummeraanduiding` (house number points)
    // on each map moveend / zoomend and renders the results as Leaflet
    // divIcon markers (see utils/adressenLayer.ts). The toggle handler
    // below calls attach()/detach() on this instance; opacity routes
    // through its setOpacity() so the labels can be dimmed without
    // losing their data.
    adressenLayerRef.current = new AdressenLayer();
    baseLayers["adressen"] =
      adressenLayerRef.current.group as unknown as L.TileLayer;

    // ── AHN (Actueel Hoogtebestand Nederland) — coloured DTM elevation
    // raster from PDOK. The `dtm_05m` service ships as a paletted PNG
    // overlay where colour ramps from blue (low) → green → yellow → red
    // (high). It sits on top of the base layer at user-controlled
    // opacity so the user can read the underlying topography too.
    baseLayers["ahn"] = L.tileLayer(
      "https://service.pdok.nl/rws/ahn/wmts/v1_0/dtm_05m/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "AHN © Rijkswaterstaat | PDOK", maxZoom: 19, opacity: 0.7 },
    );
    // ── Kadastrale kaart + BAG are now served via PDOK WFS instead of
    // WMTS so we can style the features ourselves (BAG = solid grey with
    // red outline; Kadaster = dashed center-line per perceelgrens). The
    // actual fetch + render happens in the `ogs:layer-toggle` handler
    // below — the LayerGroup placeholders are created up front so the
    // toggle logic can simply attach/detach them.
    // ── BGT (Basisregistratie Grootschalige Topografie) — fine-grained
    // topography: pavement, terrain, water lines, vegetation polygons.
    // The "standaardvisualisatie" layer is the human-readable variant.
    baseLayers["bgt"] = L.tileLayer(
      "https://service.pdok.nl/lv/bgt/wmts/v1_0/standaardvisualisatie/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "BGT © Geonovum / Kadaster | PDOK", maxZoom: 20, opacity: 0.85 },
    );
    // ── Bestemmingsplan (Ruimtelijkeplannen WMS) ─────────────────
    // Gemeentelijke zoneringen — wonen / bedrijf / verkeer / groen.
    // PDOK serveert dit als WMS (geen WMTS-cache beschikbaar), dus we
    // wrappen het in L.tileLayer.wms zodat Leaflet per tegel een
    // GetMap-call doet. Transparant zodat de onderliggende BRT/luchtfoto
    // erdoorheen leesbaar blijft.
    baseLayers["bestemmingsplan"] = L.tileLayer.wms(
      "https://service.pdok.nl/kadaster/plu/wms/v2_0",
      {
        layers: "bestemmingsplangebied",
        format: "image/png",
        transparent: true,
        attribution: "Ruimtelijkeplannen © Kadaster | PDOK",
        maxZoom: 20,
        opacity: 0.7,
      },
    );
    baseLayersRef.current = baseLayers;
    // Default base: BRT als achtergrond + luchtfoto op 50% er
    // bovenop. Luchtfoto wordt OOK direct geattacht zodat de
    // gebruiker bij Kaart-tab open meteen de luchtfoto ziet — niet
    // pas na een toggle vanuit het lagen-paneel.
    baseLayers["brt"].addTo(map);
    baseLayers["luchtfoto-actueel"].addTo(map);
    baseLayers["luchtfoto-actueel"].setOpacity(0.5);
    enabledLayersRef.current["brt"] = true;
    enabledLayersRef.current["luchtfoto-actueel"] = true;
    layerOpacityRef.current["luchtfoto-actueel"] = 0.5;

    // Data layer groups — kept always attached so we just clear/refill.
    broLayerRef.current = L.layerGroup().addTo(map);
    broBoresLayerRef.current = L.layerGroup().addTo(map);
    distLayerRef.current = L.layerGroup().addTo(map);   // pairwise distance lines
    cptLayerRef.current = L.layerGroup().addTo(map);    // project sondering markers
    measureLayerRef.current = L.layerGroup().addTo(map); // measure lines
    // WFS-backed overlays — created here but only populated when their
    // toggle is enabled (see onLayerToggle below). They start NOT
    // attached so the early viewport doesn't trigger a useless fetch.
    bagLayerRef.current = L.layerGroup();
    kadasterLayerRef.current = L.layerGroup();

    mapRef.current = map;

    // ── BRO load helpers ─────────────────────────────────────
    /**
     * Render one CPT-archive marker. Light-red down-triangle so the BRO
     * sonderingen stand out clearly against both the BRT topo background
     * and the amber project markers — easier to find at low zoom levels.
     * Click → fetch the full GEF/XML and load it as a project tab.
     */
    const renderCptMarker = (f: BroFeature): L.Marker => {
      const html = `
        <div class="bro-sondering-marker">
          <svg width="14" height="14" viewBox="0 0 14 14" overflow="visible">
            <polygon points="1,1 13,1 7,13"
                     fill="#FCA5A5" stroke="#B91C1C"
                     stroke-width="1.1" stroke-linejoin="round" />
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
     * Render one borehole marker. Uses the standard NL-geotechniek
     * boring symbol — an open ring with a centerpoint dot — so the
     * user instantly distinguishes it from a sondering (filled
     * triangle/pin) at any zoom. divIcon-based, so the marker scales
     * crisply on Hi-DPI displays.
     */
    const renderBoreMarker = (f: BroFeature): L.Marker => {
      const icon = L.divIcon({
        className: "bro-bore-symbol",
        html:
          `<svg width="16" height="16" viewBox="0 0 16 16">` +
          `<circle cx="8" cy="8" r="6" fill="#FECACA" fill-opacity="0.85" stroke="#7F1D1D" stroke-width="1.6"/>` +
          `<circle cx="8" cy="8" r="1.6" fill="#7F1D1D"/>` +
          `</svg>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const m = L.marker([f.lat, f.lon], { icon, riseOnHover: true });
      m.bindPopup(buildPopupHtml(f, /* loadable = */ true, "openOnly"), { minWidth: 240 });
      return m;
    };

    // ── PDOK WFS reloads (BAG / Kadaster) ───────────────────────
    // Refetched on every moveend when their toggle is on. Bounded by
    // the current viewport bbox and capped at a few thousand features.
    const reloadBag = async () => {
      const layer = bagLayerRef.current;
      if (!layer || disposed) return;
      bagAbortRef.current?.abort();
      const ctrl = new AbortController();
      bagAbortRef.current = ctrl;
      const b = map.getBounds();
      const fc = await fetchBagPanden(
        {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted || !fc || disposed) return;
      // Belt-and-braces: check dat de map nog steeds in DOM zit voor
      // we polygonen toevoegen. Anders crashen Leaflet drag-handlers
      // op een gedetacheerd parent-element (offsetWidth = null).
      const internalMap = map as unknown as { _container?: HTMLElement };
      if (!internalMap._container || !internalMap._container.isConnected) return;
      layer.clearLayers();
      // Solid grey (192,192,192) fill, red outline — matches the
      // user-requested rendering convention.
      L.geoJSON(fc, {
        // Niet-interactieve overlay: Leaflet bindt geen mouse-handlers
        // aan elk polygon. Voorkomt de getSizedParentNode null-crash
        // bij snelle tab-switch (polygon → mousedown → walks dead
        // parent DOM).
        interactive: false,
        style: () => ({
          color: "#DC2626",       // outline = red-600
          weight: 1.1,
          fillColor: "rgb(192,192,192)",
          fillOpacity: 0.85,
          opacity: 0.95,
        }),
      }).addTo(layer);
    };

    const reloadKadaster = async () => {
      const layer = kadasterLayerRef.current;
      if (!layer || disposed) return;
      kadasterAbortRef.current?.abort();
      const ctrl = new AbortController();
      kadasterAbortRef.current = ctrl;
      const b = map.getBounds();
      const fc = await fetchKadasterPercelen(
        {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted || !fc || disposed) return;
      const internalMap = map as unknown as { _container?: HTMLElement };
      if (!internalMap._container || !internalMap._container.isConnected) return;
      layer.clearLayers();
      // Center-line type: dashed grey-blue stroke with no fill so the
      // user can see the perceelgrenzen on top of BRT/luchtfoto without
      // hiding the underlying basemap.
      L.geoJSON(fc, {
        interactive: false, // zie reloadBag voor de toelichting
        style: () => ({
          color: "#475569",       // slate-600
          weight: 1.0,
          dashArray: "6 3 1 3",   // center-line pattern (long-short-dot-short)
          fillOpacity: 0,
          opacity: 0.85,
        }),
      }).addTo(layer);
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
              const op = layerOpacityRef.current["bro-sonderingen"] ?? 1;
              features.forEach((f) => {
                const m = renderCptMarker(f);
                m.setOpacity(op);
                broLayerRef.current?.addLayer(m);
              });
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
              const op = layerOpacityRef.current["bro-boringen"] ?? 1;
              features.forEach((f) => {
                const m = renderBoreMarker(f);
                m.setOpacity(op);
                broBoresLayerRef.current?.addLayer(m);
              });
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
      // Publish the new viewport so the Sonderingstekening view (and
      // any other map-based panel) can default to the same location.
      const c = map.getCenter();
      useCptStore.getState().setLastMapView({
        lat: c.lat,
        lon: c.lng,
        zoom: map.getZoom(),
      });
      if (panTimer) window.clearTimeout(panTimer);
      panTimer = window.setTimeout(() => {
        const sondOn = enabledLayersRef.current["bro-sonderingen"];
        const boresOn = enabledLayersRef.current["bro-boringen"];
        if ((sondOn || boresOn) && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
          void loadVisibleArea({ force: true });
        }
        // WFS overlays piggy-back on moveend so they stay in sync with
        // the visible bbox. Same zoom guard so a fully-zoomed-out view
        // doesn't demand a wall of features.
        if (enabledLayersRef.current["bag"] && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
          void reloadBag();
        }
        if (enabledLayersRef.current["kadaster"] && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
          void reloadKadaster();
        }
      }, BRO_REFETCH_DEBOUNCE_MS);
    };
    map.on("moveend", onMoveEnd);

    // Zoom-only refresh: forces a fresh BRO + WFS reload the moment a
    // zoom gesture completes. Without this the markers can lag behind
    // the new viewport — e.g. zooming in shows the previous coarse
    // viewport's positions until the next pan. We bypass the panTimer
    // so the response feels snappy.
    const onZoomEnd = () => {
      const sondOn = enabledLayersRef.current["bro-sonderingen"];
      const boresOn = enabledLayersRef.current["bro-boringen"];
      if ((sondOn || boresOn) && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
        void loadVisibleArea({ force: true });
      }
      if (enabledLayersRef.current["bag"] && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
        void reloadBag();
      }
      if (enabledLayersRef.current["kadaster"] && map.getZoom() >= MIN_BRO_AUTOFETCH_ZOOM) {
        void reloadKadaster();
      }
    };
    map.on("zoomend", onZoomEnd);

    // Fly-to handler triggered by the MapAddressSearch component.
    const onFlyTo = (e: Event) => {
      const ce = e as CustomEvent<{ lat: number; lon: number; zoom?: number }>;
      const { lat, lon, zoom } = ce.detail;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        map.flyTo([lat, lon], zoom ?? map.getZoom(), { duration: 0.8 });
      }
    };
    window.addEventListener("ogs:map-fly-to", onFlyTo as EventListener);
    // Seed the store with the initial centre so a tab-switch to
    // Sonderingstekening before the user pans still inherits a sane location.
    {
      const c = map.getCenter();
      useCptStore.getState().setLastMapView({
        lat: c.lat,
        lon: c.lng,
        zoom: map.getZoom(),
      });
    }

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
        // For boreholes (kind="bore") we fetch BHR-GT XML + open it as a
        // BoreDocument. All other actions (merge / addToProject) only
        // apply to CPTs — those buttons aren't rendered on bore popups.
        const kind = a.getAttribute("data-kind") ?? "cpt";
        if (add) {
          await addBroToActiveProject(id);
        } else if (merge) {
          const xml = await invoke<string>("fetch_bro_cpt", { broId: id });
          const existing = activeCptIdRef.current;
          if (!existing) {
            await loadCptFromContent(xml, `${id}.xml`);
          } else {
            await mergeIntoNewProject(existing, xml, `${id}.xml`);
          }
        } else if (kind === "bore") {
          const xml = await invoke<string>("fetch_bro_bore", { broId: id });
          await loadBoreFromContent(xml, `${id}.xml`);
        } else {
          const xml = await invoke<string>("fetch_bro_cpt", { broId: id });
          await loadCptFromContent(xml, `${id}.xml`);
        }
        map.closePopup();
        // Jump the ribbon back to Home so the user immediately sees the
        // freshly-opened sondering or boring instead of being stranded on
        // the Kaart tab. The Ribbon component listens for this event.
        window.dispatchEvent(
          new CustomEvent("ogs:ribbon-switch", { detail: { tab: "start" } }),
        );
      } catch (err) {
        console.error("BRO popup action failed", err);
      }
    };
    document.addEventListener("click", onPopupClick);

    /** Honor an `ogs:layer-toggle` event by adding/removing the matching
     *  layer object. For data layers we toggle visibility by attaching or
     *  detaching the `LayerGroup` to the map.
     *
     *  Per-view filter: GisLayerPanel now tags every event with `view`
     *  ("map" or "tekening"); we only react when the event is for this
     *  view, so toggling on the Sonderingstekening tab doesn't disturb
     *  this Leaflet instance. Older callers (no `view` field) are treated
     *  as map-targeted for backwards compatibility. */
    const onLayerToggle = (e: Event) => {
      const ce = e as CustomEvent<{ view?: string; id: string; enabled: boolean }>;
      if (ce.detail.view && ce.detail.view !== "map") return;
      const { id, enabled } = ce.detail;
      const wasEnabled = enabledLayersRef.current[id] === true;
      enabledLayersRef.current[id] = enabled;
      // Mirror naar de tekeningState-singleton zodat Backstage's
      // save-flow weet welke lagen actief zijn in de `gis`-sectie
      // van het .ifcgis bestand.
      setLayerLive(id, enabled, layerOpacityRef.current[id] ?? 1);

      // Adressen — vector WFS overlay. Routed through AdressenLayer so
      // moveend/zoomend listeners are wired up on attach and torn down
      // on detach (otherwise we'd keep fetching after the user disables
      // the layer).
      if (id === "adressen" && adressenLayerRef.current) {
        const al = adressenLayerRef.current;
        if (enabled) {
          if (!map.hasLayer(al.group)) al.group.addTo(map);
          al.attach(map);
        } else {
          al.detach();
          if (map.hasLayer(al.group)) map.removeLayer(al.group);
        }
        return;
      }

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

      // WFS-backed overlays — attach the empty LayerGroup, then trigger
      // a one-shot fetch so the user sees features immediately. On
      // disable: detach + abort any in-flight request.
      if (id === "bag" && bagLayerRef.current) {
        if (enabled) {
          if (!map.hasLayer(bagLayerRef.current)) bagLayerRef.current.addTo(map);
          if (!wasEnabled) void reloadBag();
        } else {
          bagAbortRef.current?.abort();
          if (map.hasLayer(bagLayerRef.current)) map.removeLayer(bagLayerRef.current);
          bagLayerRef.current.clearLayers();
        }
        return;
      }
      if (id === "kadaster" && kadasterLayerRef.current) {
        if (enabled) {
          if (!map.hasLayer(kadasterLayerRef.current)) kadasterLayerRef.current.addTo(map);
          if (!wasEnabled) void reloadKadaster();
        } else {
          kadasterAbortRef.current?.abort();
          if (map.hasLayer(kadasterLayerRef.current)) map.removeLayer(kadasterLayerRef.current);
          kadasterLayerRef.current.clearLayers();
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
        // Apply any previously-set topotijdreis opacity.
        const op = layerOpacityRef.current["topotijdreis"];
        if (typeof op === "number") layer.setOpacity(op);
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

    /**
     * Apply an opacity value (0..1) to a layer by id. Tile layers use
     * `setOpacity`. Marker layer groups iterate their children — markers
     * implement `setOpacity`, which sets the wrapping <img>/divIcon's
     * CSS opacity. We also remember the value so future markers added to
     * the same group (e.g. after a BRO reload) inherit the same opacity.
     */
    const onLayerOpacity = (e: Event) => {
      const ce = e as CustomEvent<{ view?: string; id: string; opacity: number }>;
      // Per-view filter — see onLayerToggle comment.
      if (ce.detail.view && ce.detail.view !== "map") return;
      const { id, opacity } = ce.detail;
      const clamped = Math.max(0, Math.min(1, opacity));
      layerOpacityRef.current[id] = clamped;
      // Mirror naar tekeningState (preserveert enabled-state).
      setLayerLive(id, enabledLayersRef.current[id] === true, clamped);

      // Adressen — route through the AdressenLayer instance so the
      // current markers + any markers added later from a fresh WFS
      // response all pick up the new opacity.
      if (id === "adressen" && adressenLayerRef.current) {
        adressenLayerRef.current.setOpacity(clamped);
        return;
      }

      const base = baseLayersRef.current[id];
      if (base) {
        base.setOpacity(clamped);
        // Same opacity applies to the topotijdreis layer if it's currently
        // standing in for a base layer.
        if (topotijdreisLayerRef.current && id === topoOpacityProxyRef.current) {
          topotijdreisLayerRef.current.setOpacity(clamped);
        }
        return;
      }

      // Topotijdreis explicitly has its own opacity entry.
      if (id === "topotijdreis" && topotijdreisLayerRef.current) {
        topotijdreisLayerRef.current.setOpacity(clamped);
        return;
      }

      const group: L.LayerGroup | null =
        id === "bro-sonderingen" ? broLayerRef.current :
        id === "bro-boringen" ? broBoresLayerRef.current :
        id === "project-sonderingen" ? cptLayerRef.current :
        null;
      if (!group) return;
      group.eachLayer((lyr) => {
        const m = lyr as L.Marker & { setOpacity?: (o: number) => void };
        if (typeof m.setOpacity === "function") m.setOpacity(clamped);
      });
      // Distance lines piggy-back on project layer opacity.
      if (id === "project-sonderingen" && distLayerRef.current) {
        distLayerRef.current.eachLayer((lyr) => {
          const path = lyr as L.Path & { setStyle?: (s: L.PathOptions) => void };
          if (typeof path.setStyle === "function") path.setStyle({ opacity: clamped });
        });
      }
    };

    window.addEventListener("ogs:bro-load-area", onLoad);
    window.addEventListener("ogs:bro-clear", onClear);
    window.addEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
    window.addEventListener("ogs:layer-opacity", onLayerOpacity as EventListener);
    window.addEventListener("ogs:measure-toggle", onMeasureToggle);
    window.addEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
    window.addEventListener("keydown", onKey);

    // ── Default overlay-stack op de Kaart-tab ─────────────────────
    // Activeer bag + kadaster + adressen via dezelfde toggle-flow die
    // het lagen-paneel ook gebruikt. STAGGER ze (350ms tussen elk) +
    // wacht tot de map "ready" is voordat de eerste toggle vuurt.
    // Anders kwamen er 3 simultane WFS-fetches op zoom 18 binnen,
    // met ieder honderden polygonen in de Leaflet-render-pipeline —
    // dat veroorzaakte een hard-freeze van de Kaart-tab.
    //
    // Belangrijk: timeout-IDs worden ge-collecteerd in
    // autoEnableTimeouts (al hoog up gedeclareerd) en in cleanup
    // gecleared zodat een snelle tab-switch (binnen 1.5s) geen
    // toggle-events dispatcht naar een al gedestroyed map. De
    // whenReady-callback checkt `disposed` om hetzelfde te vermijden.
    map.whenReady(() => {
      if (disposed) return;
      const fire = (id: string, enabled: boolean) => {
        if (disposed) return;
        window.dispatchEvent(
          new CustomEvent("ogs:layer-toggle", {
            detail: { view: "map", id, enabled },
          }),
        );
      };
      // BAG eerst (lichtste payload — 1 polygon/pand), dan kadaster,
      // tenslotte adressen. Tussen elk 350ms ademruimte voor de
      // Leaflet-render-loop.
      autoEnableTimeouts.push(
        window.setTimeout(() => fire("bag", true), 350),
      );
      autoEnableTimeouts.push(
        window.setTimeout(() => fire("kadaster", true), 700),
      );
      autoEnableTimeouts.push(
        window.setTimeout(() => fire("adressen", true), 1050),
      );
    });
    return () => {
      // Disposed-flag eerst: voorkomt dat lopende whenReady-callbacks
      // of staged timeouts nog acties dispatchen op een gedestroyed map.
      disposed = true;
      for (const id of autoEnableTimeouts) window.clearTimeout(id);
      window.removeEventListener("ogs:bro-load-area", onLoad);
      window.removeEventListener("ogs:bro-clear", onClear);
      window.removeEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
      window.removeEventListener("ogs:layer-opacity", onLayerOpacity as EventListener);
      window.removeEventListener("ogs:measure-toggle", onMeasureToggle);
      window.removeEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
      window.removeEventListener("ogs:map-fly-to", onFlyTo as EventListener);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onPopupClick);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onZoomEnd);
      map.off("click", onMapClick);
      if (panTimer) window.clearTimeout(panTimer);
      pendingAbort?.abort();
      adressenLayerRef.current?.detach();
      adressenLayerRef.current = null;
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
      const isSelected = selectedCptIds.has(cpt.id);
      // Project sonderingen are green (so they read as "ours" against
      // the light-red BRO sonderingen on the same map). Active = brighter
      // green-500, inactive = green-700, dark green-900 stroke for
      // contrast on both light and dark base layers.
      // Geselecteerde markers krijgen een amber-stroke (#D97706) zodat
      // de selectie meteen oogvallend is óók op de luchtfoto-tiles.
      const fill = isActive ? "#22C55E" : "#15803D";
      const stroke = isSelected ? "#D97706" : "#14532D";
      const strokeWidth = isSelected ? 2.4 : 1.6;
      // Sondeer-symbool (Dutch convention): triangle with apex pointing DOWN
      // into the ground at the actual location. Base at top, apex at (11, 20).
      const classes =
        "cpt-sondeer-marker" +
        (isActive ? " active" : "") +
        (isSelected ? " selected" : "");
      const html = `
        <div class="${classes}">
          <svg width="22" height="22" viewBox="0 0 22 22" overflow="visible">
            <polygon points="2,2 20,2 11,20"
                     fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
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
        opacity: layerOpacityRef.current["project-sonderingen"] ?? 1,
      }).bindPopup(`<strong>${cpt.id}</strong><br>${cpt.metadata.project_name ?? ""}<br>RD ${cpt.position!.x_rd.toFixed(1)}, ${cpt.position!.y_rd.toFixed(1)}<br>diepte tot ${cpt.points.reduce((m, p) => Math.max(m, p.depth), 0).toFixed(1)} m`);

      // Click handler met drie modes:
      //   1. Measure-mode (al actief) → CPT-to-CPT afstand kiezen
      //   2. Ctrl/Cmd/Shift+klik       → CPT toggle in selectie
      //                                  (geen popup, geen propagation)
      //   3. Plain click               → popup tonen (default)
      marker.on("click", (e) => {
        if (measureModeRef.current) {
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
          return;
        }
        // Modifier-klik = selectie-toggle. macOS gebruikers verwachten
        // Cmd (metaKey), Windows/Linux verwachten Ctrl. Shift werkt
        // op alle platforms als alias zodat het sowieso "ergens" zit.
        const ev = e.originalEvent as MouseEvent;
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
          L.DomEvent.stopPropagation(e);
          marker.closePopup();
          toggleCptSelection(cpt.id);
        }
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

    // Auto-fit logic:
    //  - On MOUNT (`fittedDocIdRef.current === null`) → always fit to
    //    the project sonderingen, so opening Kaart with a project
    //    loaded immediately zooms onto the markers.
    //  - When the active document CHANGES (user opens another project
    //    while still on Kaart) → re-fit.
    //  - Otherwise (same doc, marker added/removed) → only fit when
    //    markers escape the current view, so casual edits don't yank
    //    the user's zoom away.
    // On a fresh mount (tab-switch into Kaart) the map element may not
    // have its final pixel size yet — Leaflet's `getBounds()` then
    // returns a degenerate viewport and `fitBounds` over-zooms onto a
    // single pixel. Defer the fit to the next animation frame and call
    // `invalidateSize()` first so the projection is honest.
    const isInitialOrDocChange = fittedDocIdRef.current !== activeDocId;
    const doFit = () => {
      const m = mapRef.current;
      if (!m) return;
      try { m.invalidateSize(); } catch { /* map torn down */ }
      if (positioned.length === 1) {
        if (isInitialOrDocChange || m.getZoom() < 12) {
          m.setView([positioned[0].lat, positioned[0].lon], 17);
        }
      } else {
        const bounds = L.latLngBounds(
          positioned.map((p) => [p.lat, p.lon] as [number, number]),
        );
        const current = m.getBounds();
        if (isInitialOrDocChange || !current.contains(bounds)) {
          m.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
        }
      }
    };
    if (isInitialOrDocChange) {
      requestAnimationFrame(doFit);
    } else {
      doFit();
    }
    fittedDocIdRef.current = activeDocId;

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
    // selectedCptIds + toggleCptSelection in deps zodat de markers
    // opnieuw renderen met de juiste highlight wanneer de selectie
    // wijzigt (en de click-closure een verse toggle-functie heeft).
  }, [cpts, activeCptId, activeDocId, selectedCptIds, toggleCptSelection]);

  // ── CPT-selectie: Esc wist hem, Shift+drag tekent een box-select ─
  // We zetten Leaflet's eigen box-zoom uit en bouwen een eigen drag-
  // rect (L.Rectangle als visueel feedback). Op mouseup bepalen we
  // welke CPTs binnen de bounds vallen en seleceren die in bulk.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.boxZoom.disable();
    // Bouw een snelle lookup van CPT-id → lat/lon voor de bbox-check.
    const positioned = cpts
      .filter((c) => c.position != null)
      .map((c) => {
        const { lat, lon } = rdToWgs84(c.position!.x_rd, c.position!.y_rd);
        return { id: c.id, lat, lon };
      });

    const container = map.getContainer();
    let dragStart: L.LatLng | null = null;
    let rect: L.Rectangle | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      // Voorkom Leaflet's pan-drag tijdens Shift-drag (anders draggen
      // we de kaart in plaats van een box te tekenen).
      e.preventDefault();
      e.stopPropagation();
      const containerPoint = L.point(
        e.clientX - container.getBoundingClientRect().left,
        e.clientY - container.getBoundingClientRect().top,
      );
      dragStart = map.containerPointToLatLng(containerPoint);
      map.dragging.disable();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStart) return;
      const rectBox = container.getBoundingClientRect();
      const cp = L.point(e.clientX - rectBox.left, e.clientY - rectBox.top);
      const cur = map.containerPointToLatLng(cp);
      const bounds = L.latLngBounds(dragStart, cur);
      if (!rect) {
        rect = L.rectangle(bounds, {
          color: "#D97706",
          weight: 1.5,
          fillColor: "#FBBF24",
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(map);
      } else {
        rect.setBounds(bounds);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!dragStart) return;
      const rectBox = container.getBoundingClientRect();
      const cp = L.point(e.clientX - rectBox.left, e.clientY - rectBox.top);
      const end = map.containerPointToLatLng(cp);
      const bounds = L.latLngBounds(dragStart, end);
      // Alleen daadwerkelijk selecteren als de box ergens uit minimum
      // 5px slepen voortkwam — voorkomt per-ongeluk-leeg-selecteren
      // bij een simpele Shift-klik.
      const dragPx = Math.abs(
        map.latLngToContainerPoint(dragStart).distanceTo(cp),
      );
      if (dragPx > 5) {
        const hits = positioned
          .filter((p) => bounds.contains([p.lat, p.lon]))
          .map((p) => p.id);
        // Replace=false: ophogen bij meerdere Shift-drags na elkaar.
        // De gebruiker kan altijd eerst "Wis" klikken om opnieuw te
        // beginnen.
        if (hits.length > 0) selectCpts(hits, false);
      }
      rect?.remove();
      rect = null;
      dragStart = null;
      map.dragging.enable();
    };

    container.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCptIds.size > 0) {
        clearCptSelection();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      container.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKey);
      rect?.remove();
      map.dragging.enable();
      // Re-enable boxZoom voor het geval een ander deel van de app
      // het wil gebruiken — geen kwaad bedoeld.
      try { map.boxZoom.enable(); } catch { /* map al weg */ }
    };
  }, [cpts, selectedCptIds, selectCpts, clearCptSelection]);

  return (
    <div className="map-view-wrap">
      <div ref={containerRef} className={`map-view-container${measureMode ? " measuring" : ""}`} />
      {selectedCptIds.size > 0 && (
        <div className="map-selection-badge" role="status">
          <span className="map-selection-count">
            {selectedCptIds.size} geselecteerd
          </span>
          <button
            type="button"
            className="map-selection-clear"
            onClick={clearCptSelection}
            title="Wis selectie (Esc)"
          >
            Wis
          </button>
        </div>
      )}
      <MapAddressSearch />
      <div className="map-status">
        {cpts.filter((c) => c.position).length > 0 && (
          <span className="map-cpt-count">{cpts.filter((c) => c.position).length} sondering(en) ·&nbsp;</span>
        )}
        {status}
      </div>
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
  const kindAttr = escapeHtml(f.kind);
  const openAction = loadable
    ? `<a href="#" class="bro-popup-open" data-id="${id}" data-kind="${kindAttr}">Open in viewer &rarr;</a>`
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
