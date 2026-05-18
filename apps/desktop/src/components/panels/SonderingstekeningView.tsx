import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import proj4 from "proj4";
import { useCptStore } from "../../store/useCptStore";
import { fetchBagPanden, fetchKadasterPercelen } from "../../utils/pdokWfs";
import "./SonderingstekeningView.css";

/**
 * SonderingstekeningView — drawing-board view for a project sondering plan.
 *
 * Layout: a paper-sized rectangle (A2/A3 landscape) with an embedded
 * Leaflet map showing project + BRO sonderingen, plus an overlay layer
 * for user-placed markers, a title block, and a drawing frame. The
 * paper is rendered at screen scale 1:n where n is the user-chosen
 * scale (1:500 / 1:1000 / 1:2000 / 1:5000) — the map is fitted so
 * one millimetre of paper at the chosen scale corresponds to one
 * map-metre in the field.
 *
 * State is local to this component for v1 — paper layout is per session
 * and not persisted. Drag-drop of PDF/JPG/SVG drops the file as an
 * overlay over the paper. DWG/DXF support is stubbed (see the toolbox).
 */

// RD New (EPSG:28992) for map distance/scale calculations.
proj4.defs(
  "EPSG:28992",
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 " +
    "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
    "+towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 " +
    "+units=m +no_defs",
);
const WGS84_TO_RD = proj4("WGS84", "EPSG:28992");

// ── Paper geometry ───────────────────────────────────────────────
// All dimensions in millimetres. ISO A-series landscape.
type PaperSize = "A2" | "A3";
type Scale = 500 | 1000 | 2000 | 5000;

const PAPER_MM: Record<PaperSize, { wMm: number; hMm: number }> = {
  A2: { wMm: 594, hMm: 420 },
  A3: { wMm: 420, hMm: 297 },
};

const SCALES: Scale[] = [500, 1000, 2000, 5000];
const PAPER_SIZES: PaperSize[] = ["A2", "A3"];
const GRID_SPACINGS = [15, 20, 25] as const;
const DEFAULT_RASTER_ROWS = 3;
const DEFAULT_RASTER_COLS = 3;
const DEFAULT_RASTER_SPACING = 20; // metres

interface PlacedSondering {
  id: string;       // S01, S02, ...
  lat: number;
  lon: number;
}

/**
 * A dynamic grid of sonderingen treated as a single object — can be
 * selected, stretched (independent X/Y via corner handles), translated
 * (via edge-drag), and rotated (via the rotation button). Marker
 * positions are derived from the raster's parameters on every render
 * so dragging a handle updates the whole grid in one go.
 *
 * `spacingX` controls horizontal column spacing, `spacingY` controls
 * vertical row spacing — both in metres. Splitting them lets the user
 * make narrow + tall rasters (e.g. 5 m along the trench, 25 m across)
 * without forcing a square grid.
 */
interface PlacedRaster {
  id: string;        // R01, R02, ...
  centerLat: number;
  centerLon: number;
  rows: number;
  cols: number;
  spacingX: number;  // metres between columns (X direction)
  spacingY: number;  // metres between rows (Y direction)
  rotation: number;  // degrees clockwise from north
}

/** A selection identifies which object the user is currently editing. */
type Selection =
  | { kind: "marker"; id: string }
  | { kind: "raster"; id: string }
  | null;

interface OverlayDrop {
  id: string;
  kind: "pdf" | "image" | "svg" | "dwg";
  name: string;
  src?: string;     // data URL for image/svg/pdf-page-render
  /** Real-world width of the overlay in metres. When set the overlay is
   *  attached to the Leaflet map as an `imageOverlay` so it scales with
   *  the map zoom; the height is derived from the image's aspect ratio
   *  on load. */
  widthMeters?: number;
  /** Optional position override — if not set, the overlay sits at the
   *  current map centre. RD coords; converted to lat/lon for bounds. */
  centerLat?: number;
  centerLon?: number;
}

/**
 * RD coordinate tag — a small label the user can drop on the map that
 * shows the (x, y) RD coordinate at that exact lat/lon. Useful for
 * pinning real surveyor positions onto a sondering plan.
 */
interface CoordTag {
  id: string;
  lat: number;
  lon: number;
  /** User-editable note rendered next to the coordinate (e.g. "BP1"). */
  label?: string;
}

interface TitleBlockData {
  project: string;
  drawingNumber: string;
  scale: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  version: string;
}

interface FrameSvg {
  name: string;
  src: string;      // data URL
}

interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
  kind: "cpt" | "bore";
  registration_date?: string;
  extra: Record<string, string>;
}

// Convert a paper dimension (mm) at the chosen scale to map metres.
// e.g. 100 mm on paper at scale 1:1000 -> 100 metres in reality.
const paperMmToMeters = (mm: number, scale: Scale) => (mm / 1000) * scale;

/**
 * Derive every sondering position for a raster, in WGS84 lat/lon.
 * The raster is centred on (centerLat, centerLon), expanded into a
 * rows × cols grid spaced `spacing` metres apart, then rotated
 * `rotation` degrees clockwise from north (so 0° = grid columns
 * aligned with the RD East axis).
 */
function rasterPoints(r: PlacedRaster): { lat: number; lon: number; rIdx: number; cIdx: number }[] {
  const [cxRd, cyRd] = WGS84_TO_RD.forward([r.centerLon, r.centerLat]);
  const rad = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: { lat: number; lon: number; rIdx: number; cIdx: number }[] = [];
  for (let ri = 0; ri < r.rows; ri++) {
    for (let ci = 0; ci < r.cols; ci++) {
      const lx = (ci - (r.cols - 1) / 2) * r.spacingX;
      const ly = (ri - (r.rows - 1) / 2) * r.spacingY;
      // Rotate (lx, ly) by `rad` then translate to (cxRd, cyRd). RD
      // axes are metric so the rotation works directly without a
      // separate angular correction.
      const wx = cxRd + lx * cos - ly * sin;
      const wy = cyRd + lx * sin + ly * cos;
      const ll = WGS84_TO_RD.inverse([wx, wy]);
      out.push({ lat: ll[1], lon: ll[0], rIdx: ri, cIdx: ci });
    }
  }
  return out;
}

/**
 * Half-width / half-height of a raster's bounding rectangle in metres,
 * derived from rows × cols × spacingX/Y plus 30 % padding so the
 * rectangle stretches past the outermost markers. Used by both the
 * corner-handle math and the rectangle drawer.
 */
function rasterHalfExtents(r: PlacedRaster): { halfW: number; halfH: number } {
  const halfW = ((r.cols - 1) / 2 + 0.3) * r.spacingX;
  const halfH = ((r.rows - 1) / 2 + 0.3) * r.spacingY;
  return { halfW, halfH };
}

/**
 * Compute the 4 corners (clockwise from bottom-left) of a raster's
 * bounding rectangle in lat/lon. Built from rasterHalfExtents so the
 * rectangle always matches what the marker grid actually covers.
 */
function rasterCornersLatLng(r: PlacedRaster): L.LatLng[] {
  const [cxRd, cyRd] = WGS84_TO_RD.forward([r.centerLon, r.centerLat]);
  const { halfW, halfH } = rasterHalfExtents(r);
  const rad = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: [number, number][] = [
    [-halfW, -halfH],
    [+halfW, -halfH],
    [+halfW, +halfH],
    [-halfW, +halfH],
  ];
  return corners.map(([lx, ly]) => {
    const wx = cxRd + lx * cos - ly * sin;
    const wy = cyRd + lx * sin + ly * cos;
    const ll = WGS84_TO_RD.inverse([wx, wy]);
    return L.latLng(ll[1], ll[0]);
  });
}

/** Edge midpoints (S, E, N, W) of the raster bounding box in lat/lon. */
function rasterEdgeMidpointsLatLng(r: PlacedRaster): L.LatLng[] {
  const [cxRd, cyRd] = WGS84_TO_RD.forward([r.centerLon, r.centerLat]);
  const { halfW, halfH } = rasterHalfExtents(r);
  const rad = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mids: [number, number][] = [
    [0, -halfH],   // bottom (south)
    [+halfW, 0],   // right (east)
    [0, +halfH],   // top (north)
    [-halfW, 0],   // left (west)
  ];
  return mids.map(([lx, ly]) => {
    const wx = cxRd + lx * cos - ly * sin;
    const wy = cyRd + lx * sin + ly * cos;
    const ll = WGS84_TO_RD.inverse([wx, wy]);
    return L.latLng(ll[1], ll[0]);
  });
}

export default function SonderingstekeningView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  /** BGT stays as a tile layer (WMTS) — it's a rasterised composite
   *  visualization rather than a vector dataset we want to restyle. */
  const pdokOverlayRefs = useRef<Record<"bgt", L.TileLayer | null>>({
    bgt: null,
  });
  /** Vector overlays for Kadaster + BAG, driven by PDOK WFS. */
  const bagLayerRef = useRef<L.LayerGroup | null>(null);
  const kadasterLayerRef = useRef<L.LayerGroup | null>(null);
  const bagAbortRef = useRef<AbortController | null>(null);
  const kadasterAbortRef = useRef<AbortController | null>(null);
  const placedLayerRef = useRef<L.LayerGroup | null>(null);
  const rasterLayerRef = useRef<L.LayerGroup | null>(null);
  const handlesLayerRef = useRef<L.LayerGroup | null>(null);
  const coordLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLayerRef = useRef<L.ImageOverlay | null>(null);
  const broLayerRef = useRef<L.LayerGroup | null>(null);
  const projectLayerRef = useRef<L.LayerGroup | null>(null);
  const placeModeRef = useRef(false);
  // Whether the next map click should drop an RD-coordinate tag (vs.
  // place a sondering or just deselect). Ref so the bound map handler
  // always sees the latest value without re-binding.
  const coordModeRef = useRef(false);
  // Live snapshot of the latest rasters list, so drag-handler closures
  // (registered once per render) always read the fresh value when fired.
  const rastersRef = useRef<PlacedRaster[]>([]);
  /**
   * True while the user is mid-drag on any raster handle. Used by the
   * handle-render effect to skip rebuilding the handle markers — otherwise
   * each `setRasters` from the drag handler triggers an effect re-run that
   * destroys the very marker Leaflet is dragging, and the drag dies.
   */
  const draggingRef = useRef(false);

  const [paperSize, setPaperSize] = useState<PaperSize>("A2");
  const [scale, setScale] = useState<Scale>(1000);
  const [showBro, setShowBro] = useState(true);
  const [placeMode, setPlaceMode] = useState(false);
  const [gridSpacing, setGridSpacing] = useState<typeof GRID_SPACINGS[number]>(20);
  const [placed, setPlaced] = useState<PlacedSondering[]>([]);
  const [rasters, setRasters] = useState<PlacedRaster[]>([]);
  const [coordTags, setCoordTags] = useState<CoordTag[]>([]);
  const [coordMode, setCoordMode] = useState(false);
  /**
   * Bump-counter used to force the handle-render effect to run again
   * after a drag ends — the actual raster state may already be at the
   * post-drag value (the drag handler called `setRasters` repeatedly
   * while the rebuild was suppressed by `draggingRef`), so we need an
   * unrelated dep to actually re-trigger the layout pass.
   */
  const [handleRedraw, setHandleRedraw] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  // Legacy state — kept off the render path. Base/overlay layer
  // selection is now driven entirely by the GisLayerPanel sidebar.
  /** Per-overlay enable flags for the PDOK overlay-tile layers. None
   *  are on by default to keep the paper readable until the user opts
   *  in. The effect below attaches / detaches the matching tile layer. */
  const [overlayLayers, setOverlayLayers] = useState<Record<"kadaster" | "bag" | "bgt", boolean>>({
    kadaster: false,
    bag: false,
    bgt: false,
  });
  const [overlay, setOverlay] = useState<OverlayDrop | null>(null);
  const [frame, setFrame] = useState<FrameSvg | null>(null);
  const [titleBlockOpen, setTitleBlockOpen] = useState(false);
  const [titleBlock, setTitleBlock] = useState<TitleBlockData>({
    project: "",
    drawingNumber: "",
    scale: `1:${1000}`,
    date: new Date().toISOString().slice(0, 10),
    drawnBy: "",
    checkedBy: "",
    version: "1.0",
  });
  const [toast, setToast] = useState<string | null>(null);

  // Pull project info to seed the title block + render project markers.
  // Subscribe to primitives separately so the selector never returns a
  // fresh object literal — Zustand v5 would otherwise treat each render
  // as a state change and loop with "Maximum update depth exceeded".
  const activeDocId = useCptStore((s) => s.activeDocId);
  const documents = useCptStore((s) => s.documents);
  const project = useMemo(() => {
    const doc = activeDocId ? documents.find((d) => d.id === activeDocId) : undefined;
    if (!doc) return null;
    if (doc.kind === "project") {
      return {
        title: doc.meta.title,
        number: doc.meta.project_number,
        cpts: Array.from(doc.cpts.values()),
      };
    }
    if (doc.kind === "cpt") {
      return {
        title: doc.cpt.metadata.project_name ?? doc.title,
        number: doc.cpt.metadata.project_number ?? "",
        cpts: [doc.cpt],
      };
    }
    // bore: no CPT markers from this doc; just seed title from boring id.
    return {
      title: doc.title,
      number: "",
      cpts: [],
    };
  }, [activeDocId, documents]);

  // Auto-seed title block from active doc the first time the project changes.
  useEffect(() => {
    if (!project) return;
    setTitleBlock((tb) => ({
      ...tb,
      project: tb.project || project.title || "",
      drawingNumber: tb.drawingNumber || project.number || "",
      scale: `1:${scale}`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.title, project?.number]);

  // Keep title block scale field in sync when scale changes.
  useEffect(() => {
    setTitleBlock((tb) => ({ ...tb, scale: `1:${scale}` }));
  }, [scale]);

  useEffect(() => {
    placeModeRef.current = placeMode;
  }, [placeMode]);

  useEffect(() => {
    coordModeRef.current = coordMode;
  }, [coordMode]);

  // ── PDOK overlays ────────────────────────────────────────────
  // BGT is a rasterised WMTS tile layer (lazy single instance, reused
  // on toggle). BAG + Kadaster are vector WFS overlays so we can style
  // them ourselves (BAG = grey + red outline; Kadaster = center-line).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // BGT WMTS — lazy, swap visibility.
    if (!pdokOverlayRefs.current.bgt) {
      pdokOverlayRefs.current.bgt = L.tileLayer(
        "https://service.pdok.nl/lv/bgt/wmts/v1_0/standaardvisualisatie/EPSG:3857/{z}/{x}/{y}.png",
        { attribution: "BGT © Geonovum / Kadaster | PDOK", maxZoom: 20, opacity: 0.85 },
      );
    }
    const bgtLayer = pdokOverlayRefs.current.bgt!;
    if (overlayLayers.bgt) {
      if (!map.hasLayer(bgtLayer)) bgtLayer.addTo(map);
    } else {
      if (map.hasLayer(bgtLayer)) map.removeLayer(bgtLayer);
    }

    // BAG WFS — attach the LayerGroup container; the fetch happens
    // below in `reloadVectorOverlays`. Detach on disable.
    const bagL = bagLayerRef.current;
    if (bagL) {
      if (overlayLayers.bag) {
        if (!map.hasLayer(bagL)) bagL.addTo(map);
      } else {
        bagAbortRef.current?.abort();
        if (map.hasLayer(bagL)) map.removeLayer(bagL);
        bagL.clearLayers();
      }
    }
    // Kadaster WFS — same pattern.
    const kadL = kadasterLayerRef.current;
    if (kadL) {
      if (overlayLayers.kadaster) {
        if (!map.hasLayer(kadL)) kadL.addTo(map);
      } else {
        kadasterAbortRef.current?.abort();
        if (map.hasLayer(kadL)) map.removeLayer(kadL);
        kadL.clearLayers();
      }
    }
    // Kick off an immediate fetch for the enabled overlays so the user
    // sees features the moment they toggle on (otherwise they'd have to
    // pan to trigger moveend).
    if (overlayLayers.bag) void reloadBagOverlay();
    if (overlayLayers.kadaster) void reloadKadasterOverlay();
  }, [overlayLayers]);

  // Helpers shared between the toggle effect and the moveend handler.
  const reloadBagOverlay = useCallback(async () => {
    const map = mapRef.current;
    const layer = bagLayerRef.current;
    if (!map || !layer) return;
    bagAbortRef.current?.abort();
    const ctrl = new AbortController();
    bagAbortRef.current = ctrl;
    const b = map.getBounds();
    const fc = await fetchBagPanden(
      { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      ctrl.signal,
    );
    if (ctrl.signal.aborted || !fc) return;
    layer.clearLayers();
    L.geoJSON(fc, {
      style: () => ({
        color: "#DC2626",
        weight: 1.1,
        fillColor: "rgb(192,192,192)",
        fillOpacity: 0.85,
        opacity: 0.95,
      }),
    }).addTo(layer);
  }, []);

  const reloadKadasterOverlay = useCallback(async () => {
    const map = mapRef.current;
    const layer = kadasterLayerRef.current;
    if (!map || !layer) return;
    kadasterAbortRef.current?.abort();
    const ctrl = new AbortController();
    kadasterAbortRef.current = ctrl;
    const b = map.getBounds();
    const fc = await fetchKadasterPercelen(
      { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      ctrl.signal,
    );
    if (ctrl.signal.aborted || !fc) return;
    layer.clearLayers();
    L.geoJSON(fc, {
      style: () => ({
        color: "#475569",
        weight: 1.0,
        dashArray: "6 3 1 3",
        fillOpacity: 0,
        opacity: 0.85,
      }),
    }).addTo(layer);
  }, []);

  // Refetch WFS overlays on map move (same debounce cadence as the BRO
  // refetch below).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let timer: number | null = null;
    const onMove = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (overlayLayers.bag) void reloadBagOverlay();
        if (overlayLayers.kadaster) void reloadKadasterOverlay();
      }, 400);
    };
    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
      if (timer) window.clearTimeout(timer);
    };
  }, [overlayLayers.bag, overlayLayers.kadaster, reloadBagOverlay, reloadKadasterOverlay]);

  // The legacy base-layer dropdown is gone — base/overlay toggles are
  // now driven by the GisLayerPanel sidebar via `ogs:layer-toggle`
  // events (see the init effect above). This effect is intentionally
  // empty so `baseLayerKey` is preserved purely for back-compat if
  // any older code still reads it.

  // ── Render RD-coordinate tags ─────────────────────────────────
  useEffect(() => {
    const layer = coordLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const t of coordTags) {
      const [x, y] = WGS84_TO_RD.forward([t.lon, t.lat]);
      const html = `<div class="tek-coord-tag">
        <svg viewBox="0 0 12 12" width="10" height="10">
          <circle cx="6" cy="6" r="4" fill="#d97706" stroke="#7c2d12" stroke-width="1" />
        </svg>
        <div class="tek-coord-text">
          <strong>x:</strong> ${x.toFixed(1)}<br>
          <strong>y:</strong> ${y.toFixed(1)}
          ${t.label ? `<br><em>${t.label}</em>` : ""}
        </div>
      </div>`;
      const m = L.marker([t.lat, t.lon], {
        icon: L.divIcon({
          className: "tek-coord-icon",
          html,
          iconSize: [110, 36],
          iconAnchor: [10, 36],
        }),
      });
      m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        setCoordTags((prev) => prev.filter((x) => x.id !== t.id));
      });
      layer.addLayer(m);
    }
  }, [coordTags]);

  // ── Image overlay attached to the map (scales with zoom) ──────
  // Whenever the overlay state changes, we detach the previous
  // imageOverlay and create a new one centred on the map view (or at
  // the stored position) with bounds derived from `widthMeters`. PDF +
  // DWG kinds still render as DOM overlays via the existing CSS classes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (overlayLayerRef.current) {
      map.removeLayer(overlayLayerRef.current);
      overlayLayerRef.current = null;
    }
    if (!overlay || !overlay.src) return;
    if (overlay.kind !== "image" && overlay.kind !== "svg") return;
    // Default width = 100 m for newly-dropped images, so the user can
    // see them right away. They can dial it in via the toolbox.
    const widthM = overlay.widthMeters ?? 100;
    const cLat = overlay.centerLat ?? map.getCenter().lat;
    const cLon = overlay.centerLon ?? map.getCenter().lng;
    // Aspect ratio comes from the natural image dimensions — load the
    // image off-DOM, then attach with bounds proportional to its size.
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth > 0
        ? img.naturalHeight / img.naturalWidth
        : 1;
      const heightM = widthM * aspect;
      const [cxRd, cyRd] = WGS84_TO_RD.forward([cLon, cLat]);
      const swLL = WGS84_TO_RD.inverse([cxRd - widthM / 2, cyRd - heightM / 2]);
      const neLL = WGS84_TO_RD.inverse([cxRd + widthM / 2, cyRd + heightM / 2]);
      const bounds = L.latLngBounds(
        L.latLng(swLL[1], swLL[0]),
        L.latLng(neLL[1], neLL[0]),
      );
      const ov = L.imageOverlay(overlay.src!, bounds, {
        opacity: 0.92,
        interactive: false,
      });
      ov.addTo(map);
      overlayLayerRef.current = ov;
    };
    img.src = overlay.src;
  }, [overlay]);

  // ── Init Leaflet map inside the paper rect ─────────────────────
  useEffect(() => {
    if (!paperRef.current) return;
    // Default to whatever location the Kaart view was last looking at —
    // MapView writes its viewport into `lastMapView` on every moveend.
    // Falls back to the geographic centre of NL if the user hasn't
    // opened the Kaart yet this session.
    const seed = useCptStore.getState().lastMapView;
    const startLat = seed?.lat ?? 52.156;
    const startLon = seed?.lon ?? 5.388;
    const startZoom = seed?.zoom ?? 14;
    const map = L.map(paperRef.current, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    }).setView([startLat, startLon], startZoom);

    // ── Tile layer registry (mirrors MapView's set) ──────────────
    // Created lazily — only when the user actually toggles a layer
    // via the GisLayerPanel does the corresponding TileLayer get
    // instantiated. Reusing the same instance on subsequent toggles
    // means tiles stay cached and Leaflet doesn't refetch.
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
    const createTileLayer = (id: string): L.TileLayer | null => {
      if (id === "brt") {
        return L.tileLayer(
          "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
          { attribution: "Kaartgegevens © Kadaster | PDOK", maxZoom: 19 },
        );
      }
      if (id === "luchtfoto-actueel") {
        return L.tileLayer(
          "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
          { attribution: "Luchtfoto © PDOK", maxZoom: 19 },
        );
      }
      const yearMatch = /^luchtfoto-(\d{4})$/.exec(id);
      if (yearMatch) {
        const layerId = yearLayerIds[yearMatch[1]];
        if (!layerId) return null;
        return L.tileLayer(
          `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${layerId}/EPSG:3857/{z}/{x}/{y}.jpeg`,
          { attribution: "Luchtfoto © PDOK", maxZoom: 19 },
        );
      }
      if (id === "ahn") {
        return L.tileLayer(
          "https://service.pdok.nl/rws/ahn/wmts/v1_0/dtm_05m/EPSG:3857/{z}/{x}/{y}.png",
          { attribution: "AHN © Rijkswaterstaat | PDOK", maxZoom: 19, opacity: 0.7 },
        );
      }
      return null;
    };
    const tileRegistry: Record<string, L.TileLayer> = {};
    const layerOpacity: Record<string, number> = {};
    const ensureTileLayer = (id: string): L.TileLayer | null => {
      if (!tileRegistry[id]) {
        const lyr = createTileLayer(id);
        if (lyr) tileRegistry[id] = lyr;
      }
      return tileRegistry[id] ?? null;
    };

    // Default: BRT on, matches GisLayerPanel's defaultOn.
    const brt = ensureTileLayer("brt");
    if (brt) {
      baseLayerRef.current = brt;
      brt.addTo(map);
    }

    broLayerRef.current = L.layerGroup().addTo(map);
    projectLayerRef.current = L.layerGroup().addTo(map);
    rasterLayerRef.current = L.layerGroup().addTo(map);
    placedLayerRef.current = L.layerGroup().addTo(map);
    coordLayerRef.current = L.layerGroup().addTo(map);
    handlesLayerRef.current = L.layerGroup().addTo(map);
    bagLayerRef.current = L.layerGroup();        // attached on toggle
    kadasterLayerRef.current = L.layerGroup();   // attached on toggle

    // ── GisLayerPanel event bridge ─────────────────────────────
    // The same panel that drives the Kaart view drives this map too
    // (App.tsx renders <GisLayerPanel /> in the sidebar for both
    // views). We listen for its `ogs:layer-toggle` / `ogs:layer-opacity`
    // / `ogs:topotijdreis-year` events and apply them to our own map.
    const onLayerToggle = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; enabled: boolean }>;
      const { id, enabled } = ce.detail;

      // Tile layers (BRT, luchtfoto, AHN).
      const tile = ensureTileLayer(id);
      if (tile) {
        if (enabled) {
          if (!map.hasLayer(tile)) tile.addTo(map);
          if (typeof layerOpacity[id] === "number") tile.setOpacity(layerOpacity[id]);
        } else {
          if (map.hasLayer(tile)) map.removeLayer(tile);
        }
        return;
      }

      // BAG / Kadaster WFS layer groups — already wired by the
      // `overlayLayers` state below; we mirror the boolean here so
      // that the GisLayerPanel toggle and the in-view toggles stay
      // in sync.
      if (id === "bag") {
        setOverlayLayers((s) => ({ ...s, bag: enabled }));
        return;
      }
      if (id === "kadaster") {
        setOverlayLayers((s) => ({ ...s, kadaster: enabled }));
        return;
      }
      // BRO sondering / boring toggles use the existing showBro flag
      // for this view (no separate boring layer here yet).
      if (id === "bro-sonderingen" || id === "bro-boringen") {
        setShowBro(enabled);
        return;
      }
    };
    const onLayerOpacity = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; opacity: number }>;
      const { id, opacity } = ce.detail;
      const clamped = Math.max(0, Math.min(1, opacity));
      layerOpacity[id] = clamped;
      const tile = tileRegistry[id];
      if (tile) tile.setOpacity(clamped);
    };
    let topoLayer: L.TileLayer | null = null;
    const onTopoYear = (e: Event) => {
      const ce = e as CustomEvent<{ year: number | null; serviceId: string | null }>;
      const { serviceId } = ce.detail;
      if (topoLayer && map.hasLayer(topoLayer)) map.removeLayer(topoLayer);
      topoLayer = null;
      if (!serviceId) return;
      // Reuse the same Kadaster ArcGIS service URL pattern as MapView
      // — this is a simplified version (no RD reprojection) suitable
      // for the paper view's limited zoom.
      topoLayer = L.tileLayer(
        `https://tiles.arcgis.com/tiles/nSZVuSZjHpEZZbRo/arcgis/rest/services/Historische_tijdreis_${serviceId}/MapServer/tile/{z}/{y}/{x}`,
        { attribution: "Topotijdreis © Kadaster", maxZoom: 19, opacity: 0.85 },
      );
      topoLayer.addTo(map);
    };
    window.addEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
    window.addEventListener("ogs:layer-opacity", onLayerOpacity as EventListener);
    window.addEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);

    // Click handler — three modes, in priority order:
    //   1. coordMode → drop an RD-coordinate tag at the click point
    //   2. placeMode → drop a free sondering marker
    //   3. otherwise → deselect anything that was selected
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (coordModeRef.current) {
        setCoordTags((prev) => [
          ...prev,
          {
            id: `T${String(prev.length + 1).padStart(2, "0")}`,
            lat: e.latlng.lat,
            lon: e.latlng.lng,
          },
        ]);
        // One-shot: leave coord mode after a single tag so the user
        // doesn't accidentally pepper the map.
        coordModeRef.current = false;
        setCoordMode(false);
        return;
      }
      if (placeModeRef.current) {
        setPlaced((prev) => {
          const nextId = `S${String(prev.length + 1).padStart(2, "0")}`;
          return [...prev, { id: nextId, lat: e.latlng.lat, lon: e.latlng.lng }];
        });
        return;
      }
      setSelection(null);
    });

    mapRef.current = map;

    // Initial sizing — wait for layout, then invalidate the map size.
    // The rAF can fire AFTER cleanup if the user navigates away mid-init,
    // in which case `map._panes` is undefined and `invalidateSize` throws
    // `Cannot read properties of undefined (reading '_leaflet_pos')`.
    let disposed = false;
    const raf = requestAnimationFrame(() => {
      if (disposed) return;
      // Belt-and-braces: confirm leaflet still considers the map alive.
      // After `.remove()` Leaflet clears `_panes`/`_mapPane`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = map as unknown as { _panes?: { mapPane?: HTMLElement } };
      if (!internal._panes?.mapPane) return;
      try {
        map.invalidateSize();
      } catch (e) {
        // Map was torn down during the frame — safe to swallow.
        console.debug("[SonderingstekeningView] invalidateSize after dispose", e);
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
      window.removeEventListener("ogs:layer-opacity", onLayerOpacity as EventListener);
      window.removeEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync map zoom to the chosen scale ──────────────────────────
  // We compute the field-width represented by the paper, then call
  // map.fitBounds() so 1 paper-mm corresponds to `scale` field-mm.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Same guard as the init effect — paneless map = torn down.
    const internal = map as unknown as { _panes?: { mapPane?: HTMLElement } };
    if (!internal._panes?.mapPane) return;
    try {
      map.invalidateSize();
    } catch {
      return;
    }
    const { wMm, hMm } = PAPER_MM[paperSize];
    const widthMeters = paperMmToMeters(wMm, scale);
    const heightMeters = paperMmToMeters(hMm, scale);
    const centre = map.getCenter();
    // Convert centre lat/lon to RD, then back to lat/lon for the corners.
    const [cxRd, cyRd] = WGS84_TO_RD.forward([centre.lng, centre.lat]);
    const halfW = widthMeters / 2;
    const halfH = heightMeters / 2;
    const swRd = [cxRd - halfW, cyRd - halfH];
    const neRd = [cxRd + halfW, cyRd + halfH];
    const swLL = WGS84_TO_RD.inverse(swRd);
    const neLL = WGS84_TO_RD.inverse(neRd);
    map.fitBounds(
      L.latLngBounds(L.latLng(swLL[1], swLL[0]), L.latLng(neLL[1], neLL[0])),
      { animate: false },
    );
  }, [paperSize, scale]);

  // ── Render project sondering markers ───────────────────────────
  useEffect(() => {
    const layer = projectLayerRef.current;
    if (!layer || !project) return;
    layer.clearLayers();
    for (const cpt of project.cpts) {
      if (!cpt.position) continue;
      // Convert RD to lat/lon.
      const ll = WGS84_TO_RD.inverse([cpt.position.x_rd, cpt.position.y_rd]);
      const marker = L.marker([ll[1], ll[0]], {
        icon: L.divIcon({
          className: "tek-project-marker",
          html: `<div class="tek-marker tek-marker-project" title="${cpt.id}">
                   <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                     fill="#d97706" stroke="#7c2d12" stroke-width="1" /></svg>
                 </div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 11],
        }),
      });
      marker.bindTooltip(cpt.metadata.source_file || cpt.id, { permanent: false });
      layer.addLayer(marker);
    }
  }, [project]);

  // ── Render placed-by-user sondering markers ────────────────────
  // Click on a marker → select it (so the user can delete with Del key
  // or via the toolbox). Visually highlights the selected marker with a
  // wider amber stroke.
  useEffect(() => {
    const layer = placedLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of placed) {
      const isSelected =
        selection?.kind === "marker" && selection.id === p.id;
      const fill = isSelected ? "#f59e0b" : "#2563eb";
      const stroke = isSelected ? "#92400e" : "#1e3a8a";
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "tek-placed-marker",
          html: `<div class="tek-marker tek-marker-placed${isSelected ? " selected" : ""}">
                   <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                     fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 1.6 : 1}" /></svg>
                   <span class="tek-marker-label">${p.id}</span>
                 </div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 11],
        }),
      });
      m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        setSelection({ kind: "marker", id: p.id });
      });
      layer.addLayer(m);
    }
  }, [placed, selection]);

  // ── Render raster sonderingen (single object per raster) ───────
  // Each raster expands into a grid of markers around its center, rotated
  // by `rotation` degrees. The bounding rectangle is drawn around them so
  // the user has something concrete to click to select the raster.
  useEffect(() => {
    rastersRef.current = rasters;
    const layer = rasterLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const r of rasters) {
      const isSelected =
        selection?.kind === "raster" && selection.id === r.id;
      const fill = isSelected ? "#f59e0b" : "#1e40af";
      const stroke = isSelected ? "#92400e" : "#1e3a8a";
      // Derived sondering markers — pure presentation, not interactive
      // (selection happens via the bounding-box click below).
      for (const pt of rasterPoints(r)) {
        const m = L.marker([pt.lat, pt.lon], {
          icon: L.divIcon({
            className: "tek-raster-marker",
            html: `<div class="tek-marker tek-marker-raster${isSelected ? " selected" : ""}">
                     <svg viewBox="0 0 10 10"><polygon points="1,1 9,1 5,9"
                       fill="${fill}" stroke="${stroke}" stroke-width="0.8" /></svg>
                   </div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 9],
          }),
          interactive: false,
        });
        layer.addLayer(m);
      }
      // Bounding rectangle — solid amber when selected, faint blue when not.
      const corners = rasterCornersLatLng(r);
      const rect = L.polygon(corners, {
        color: isSelected ? "#d97706" : "#3b82f6",
        weight: isSelected ? 2.5 : 1.2,
        fill: false,
        dashArray: isSelected ? undefined : "4 4",
        interactive: true,
      });
      rect.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        setSelection({ kind: "raster", id: r.id });
      });
      // Label showing rows × cols at the center.
      const lbl = L.marker([r.centerLat, r.centerLon], {
        icon: L.divIcon({
          className: "tek-raster-label",
          html: `<div class="tek-raster-label-pill">${r.id} · ${r.rows}×${r.cols} · ${r.spacingX.toFixed(0)}×${r.spacingY.toFixed(0)} m</div>`,
          iconSize: [120, 18],
          iconAnchor: [60, 9],
        }),
        interactive: false,
      });
      layer.addLayer(rect);
      layer.addLayer(lbl);
    }
  }, [rasters, selection]);

  // ── Render edit handles for the selected raster ─────────────────
  // We draw 4 corner handles (anisotropic resize), 4 edge midpoint
  // handles (drag-to-move) and one rotation button. Handles are
  // draggable Leaflet markers; their drag events update the raster
  // state, which re-renders the raster + handles in the next frame.
  //
  // CRITICAL: this effect is guarded by `draggingRef`. Without the
  // guard, every `setRasters` from a drag handler would re-run this
  // effect, `clearLayers()` would destroy the very marker Leaflet is
  // dragging, and the drag would die after one frame. Each handle's
  // dragstart/dragend flips the ref so the effect rebuilds once the
  // gesture is done — and the dragend callback bumps `handleRedraw`
  // to force the effect to actually run after the ref flips back.
  useEffect(() => {
    if (draggingRef.current) return;
    const layer = handlesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!selection || selection.kind !== "raster") return;
    const raster = rasters.find((r) => r.id === selection.id);
    if (!raster) return;

    const corners = rasterCornersLatLng(raster);
    const edgeMids = rasterEdgeMidpointsLatLng(raster);
    const [cxRd, cyRd] = WGS84_TO_RD.forward([raster.centerLon, raster.centerLat]);

    // Standard begin/end-drag plumbing shared by every handle on this
    // raster — pauses the rebuild effect, then triggers one final
    // refresh after release so the *other* handles (which aren't being
    // dragged) move to match the new raster geometry.
    const onDragStart = () => { draggingRef.current = true; };
    const onDragEnd = () => {
      draggingRef.current = false;
      // Bump a counter so the effect re-runs and lays out every handle
      // at the new geometry. Without this nudge the other handles stay
      // glued to their pre-drag positions until something else triggers
      // a render.
      setHandleRedraw((n) => n + 1);
    };

    // ── Corner handles ──────────────────────────────────────────
    // Dragging a corner stretches the raster independently in X and Y
    // (no longer uniform — the user wanted "langer en hoger" without
    // forcing a square). We un-rotate the drag latlng into raster-local
    // coordinates so the math works at any rotation.
    corners.forEach((corner) => {
      const handle = L.marker(corner, {
        icon: L.divIcon({
          className: "tek-handle tek-handle-corner",
          html: `<div class="tek-handle-dot"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        draggable: true,
      });
      handle.on("dragstart", onDragStart);
      handle.on("dragend", onDragEnd);
      handle.on("drag", (e) => {
        const ll = (e as L.LeafletEvent & { latlng: L.LatLng }).latlng;
        const [wx, wy] = WGS84_TO_RD.forward([ll.lng, ll.lat]);
        const rad = (-raster.rotation * Math.PI) / 180;
        const dx = wx - cxRd;
        const dy = wy - cyRd;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        // halfW / halfH = drag distance from center along local axes,
        // independently. Divide back out by the denominator used in
        // rasterHalfExtents to recover per-axis spacing.
        const halfW = Math.max(1, Math.abs(lx));
        const halfH = Math.max(1, Math.abs(ly));
        const colsDen = Math.max(0.5, (raster.cols - 1) / 2 + 0.3);
        const rowsDen = Math.max(0.5, (raster.rows - 1) / 2 + 0.3);
        const newSpacingX = Math.max(0.5, halfW / colsDen);
        const newSpacingY = Math.max(0.5, halfH / rowsDen);
        setRasters((prev) =>
          prev.map((r) =>
            r.id === raster.id
              ? { ...r, spacingX: newSpacingX, spacingY: newSpacingY }
              : r,
          ),
        );
      });
      handle.on("click", (ev) => L.DomEvent.stopPropagation(ev));
      layer.addLayer(handle);
    });

    // ── Edge midpoint move-handles ───────────────────────────────
    // Drag any edge midpoint to TRANSLATE the whole raster. Faster than
    // grabbing the center label and keeps "drag the edge to move" as a
    // discoverable interaction. The grab-anchor at drag start is the
    // raster center, so the drag delta directly becomes the new center.
    edgeMids.forEach((mid, idx) => {
      const dragStart = { cxRd, cyRd, mouseRd: [0, 0] as [number, number] };
      const handle = L.marker(mid, {
        icon: L.divIcon({
          className: "tek-handle tek-handle-edge",
          html: `<div class="tek-handle-edge-dot"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        draggable: true,
        // Custom cursor hint per edge orientation (NS for top/bottom,
        // EW for left/right). idx order: S, E, N, W.
      });
      handle.on("dragstart", (e) => {
        draggingRef.current = true;
        const ll = (e.target as L.Marker).getLatLng();
        const [mx, my] = WGS84_TO_RD.forward([ll.lng, ll.lat]);
        dragStart.mouseRd = [mx, my];
      });
      handle.on("dragend", onDragEnd);
      handle.on("drag", (e) => {
        const ll = (e as L.LeafletEvent & { latlng: L.LatLng }).latlng;
        const [mx, my] = WGS84_TO_RD.forward([ll.lng, ll.lat]);
        const dxRd = mx - dragStart.mouseRd[0];
        const dyRd = my - dragStart.mouseRd[1];
        const newCxRd = dragStart.cxRd + dxRd;
        const newCyRd = dragStart.cyRd + dyRd;
        const newLL = WGS84_TO_RD.inverse([newCxRd, newCyRd]);
        setRasters((prev) =>
          prev.map((r) =>
            r.id === raster.id
              ? { ...r, centerLat: newLL[1], centerLon: newLL[0] }
              : r,
          ),
        );
      });
      handle.on("click", (ev) => L.DomEvent.stopPropagation(ev));
      // Reference idx so eslint doesn't complain about unused param.
      void idx;
      layer.addLayer(handle);
    });

    // ── Rotate button ────────────────────────────────────────────
    // Big amber circular button above the top edge. Press-and-hold +
    // drag rotates the raster; releasing ends rotation. Uses Leaflet's
    // draggable marker primitive but with a beefier visual so the user
    // reads it as a "button" instead of a small dot. The visual arm
    // from center → button gives feedback on the rotation pivot.
    const rad = (raster.rotation * Math.PI) / 180;
    const { halfH } = rasterHalfExtents(raster);
    const armLen = halfH + Math.max(10, raster.spacingY * 0.6);
    const handleRdX = cxRd + -Math.sin(rad) * armLen;
    const handleRdY = cyRd + Math.cos(rad) * armLen;
    const handleLL = WGS84_TO_RD.inverse([handleRdX, handleRdY]);
    const rotHandle = L.marker([handleLL[1], handleLL[0]], {
      icon: L.divIcon({
        className: "tek-handle tek-handle-rotate",
        html: `<button class="tek-handle-rot-btn" type="button" title="Sleep om te roteren">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" />
            <polyline points="12,2 12,5 9,5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            <polyline points="4,14 4,11 7,11" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      draggable: true,
    });
    rotHandle.on("dragstart", onDragStart);
    rotHandle.on("dragend", onDragEnd);
    rotHandle.on("drag", (e) => {
      const ll = (e as L.LeafletEvent & { latlng: L.LatLng }).latlng;
      const [wx, wy] = WGS84_TO_RD.forward([ll.lng, ll.lat]);
      const dx = wx - cxRd;
      const dy = wy - cyRd;
      const newRotDeg = (Math.atan2(-dx, dy) * 180) / Math.PI;
      setRasters((prev) =>
        prev.map((r) => (r.id === raster.id ? { ...r, rotation: newRotDeg } : r)),
      );
    });
    rotHandle.on("click", (ev) => L.DomEvent.stopPropagation(ev));
    // Visual arm from center to rotate button so the user sees what's being rotated.
    const arm = L.polyline(
      [
        [raster.centerLat, raster.centerLon],
        [handleLL[1], handleLL[0]],
      ],
      { color: "#d97706", weight: 1.4, dashArray: "4 3", interactive: false },
    );
    layer.addLayer(arm);
    layer.addLayer(rotHandle);
  }, [selection, rasters, handleRedraw]);

  // ── BRO fetch + render whenever toggle / bounds change ─────────
  const refetchBro = useCallback(async () => {
    const map = mapRef.current;
    const layer = broLayerRef.current;
    if (!map || !layer) return;
    if (!showBro) {
      layer.clearLayers();
      return;
    }
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as
      [number, number, number, number];
    try {
      const features = await invoke<BroFeature[]>("fetch_bro_area", { bbox });
      layer.clearLayers();
      for (const f of features) {
        const m = L.marker([f.lat, f.lon], {
          icon: L.divIcon({
            className: "tek-bro-marker",
            html: `<div class="tek-marker tek-marker-bro" title="${f.id}">
                     <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                       fill="#a1a1aa" stroke="#52525b" stroke-width="1" /></svg>
                   </div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 11],
          }),
        });
        layer.addLayer(m);
      }
    } catch (err) {
      console.warn("fetch_bro_area (tekening) failed", err);
    }
  }, [showBro]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void refetchBro();
    const handler = () => void refetchBro();
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
  }, [refetchBro]);

  // ── Drag-drop file overlay handlers ───────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext === "pdf") {
      // For v1 just hold the raw blob URL — pdf.js render would be a
      // separate step. We embed via <iframe> as a basic preview.
      const src = URL.createObjectURL(file);
      setOverlay({ id: `o-${Date.now()}`, kind: "pdf", name: file.name, src });
    } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
      const src = URL.createObjectURL(file);
      setOverlay({ id: `o-${Date.now()}`, kind: "image", name: file.name, src });
    } else if (ext === "svg") {
      const txt = await file.text();
      const src = `data:image/svg+xml;utf8,${encodeURIComponent(txt)}`;
      setOverlay({ id: `o-${Date.now()}`, kind: "svg", name: file.name, src });
    } else if (ext === "dwg" || ext === "dxf") {
      setOverlay({ id: `o-${Date.now()}`, kind: "dwg", name: file.name });
      setToast("DWG/DXF parser komt eraan — bestand herkend maar nog niet weergegeven.");
      setTimeout(() => setToast(null), 4000);
    } else {
      setToast(`Bestandstype .${ext} wordt nog niet ondersteund`);
      setTimeout(() => setToast(null), 3000);
    }
  }, []);

  const handleFrameFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".svg")) {
      setToast("Tekeningkader moet een SVG-bestand zijn");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const txt = await file.text();
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(txt)}`;
    setFrame({ name: file.name, src });
  }, []);

  // ── Place a dynamic raster object at the current map center ────
  // Unlike the old `placeGrid` (which baked individual markers into
  // `placed[]`), this creates a single `PlacedRaster` parameterised by
  // rows × cols × spacing + rotation, so the user can stretch and
  // rotate it after placement via the corner / rotation handles.
  const placeRaster = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const nextId = `R${String(rasters.length + 1).padStart(2, "0")}`;
    const spacing = gridSpacing || DEFAULT_RASTER_SPACING;
    const r: PlacedRaster = {
      id: nextId,
      centerLat: c.lat,
      centerLon: c.lng,
      rows: DEFAULT_RASTER_ROWS,
      cols: DEFAULT_RASTER_COLS,
      spacingX: spacing,
      spacingY: spacing,
      rotation: 0,
    };
    setRasters((prev) => [...prev, r]);
    setSelection({ kind: "raster", id: nextId });
    setToast(
      `Raster ${nextId} geplaatst — hoeken slepen om op te rekken (X/Y onafhankelijk), randen om te verplaatsen, ronde knop om te roteren`,
    );
    setTimeout(() => setToast(null), 5000);
  }, [gridSpacing, rasters.length]);

  const clearPlaced = useCallback(() => {
    setPlaced([]);
    setRasters([]);
    setSelection(null);
  }, []);

  /** Delete whatever is currently selected (raster or single marker). */
  const deleteSelection = useCallback(() => {
    setSelection((sel) => {
      if (!sel) return null;
      if (sel.kind === "marker") {
        setPlaced((prev) => prev.filter((p) => p.id !== sel.id));
      } else if (sel.kind === "raster") {
        setRasters((prev) => prev.filter((r) => r.id !== sel.id));
      }
      return null;
    });
  }, []);

  /** Update the selected raster's parameters (rows/cols/spacing/rotation
   *  from the toolbox sliders). No-op if nothing or a single marker is
   *  selected. Used by the inline raster-edit panel below. */
  const updateSelectedRaster = useCallback(
    (patch: Partial<Omit<PlacedRaster, "id">>) => {
      if (!selection || selection.kind !== "raster") return;
      setRasters((prev) =>
        prev.map((r) => (r.id === selection.id ? { ...r, ...patch } : r)),
      );
    },
    [selection],
  );

  /** Duplicate the currently selected raster or marker. The copy is
   *  nudged ~10 m east + 10 m south so the user can see it as a distinct
   *  object instead of stacked on top of the source. Selection moves to
   *  the new copy so subsequent edits target the duplicate. */
  const copySelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "raster") {
      const src = rasters.find((r) => r.id === selection.id);
      if (!src) return;
      const [cx, cy] = WGS84_TO_RD.forward([src.centerLon, src.centerLat]);
      const ll = WGS84_TO_RD.inverse([cx + 10, cy - 10]);
      const nextId = `R${String(rasters.length + 1).padStart(2, "0")}`;
      const copy: PlacedRaster = { ...src, id: nextId, centerLat: ll[1], centerLon: ll[0] };
      setRasters((prev) => [...prev, copy]);
      setSelection({ kind: "raster", id: nextId });
    } else {
      const src = placed.find((p) => p.id === selection.id);
      if (!src) return;
      const [cx, cy] = WGS84_TO_RD.forward([src.lon, src.lat]);
      const ll = WGS84_TO_RD.inverse([cx + 10, cy - 10]);
      const nextId = `S${String(placed.length + 1).padStart(2, "0")}`;
      const copy: PlacedSondering = { ...src, id: nextId, lat: ll[1], lon: ll[0] };
      setPlaced((prev) => [...prev, copy]);
      setSelection({ kind: "marker", id: nextId });
    }
  }, [selection, rasters, placed]);

  /** Move the currently selected object by (dxMeters, dyMeters) in RD
   *  space. Positive dx = east, positive dy = north. Used by the move
   *  buttons on the ribbon to nudge a selection without grabbing a
   *  handle — handy when the user wants precise translations. */
  const moveSelection = useCallback(
    (dxMeters: number, dyMeters: number) => {
      if (!selection) return;
      if (selection.kind === "raster") {
        setRasters((prev) =>
          prev.map((r) => {
            if (r.id !== selection.id) return r;
            const [cx, cy] = WGS84_TO_RD.forward([r.centerLon, r.centerLat]);
            const ll = WGS84_TO_RD.inverse([cx + dxMeters, cy + dyMeters]);
            return { ...r, centerLat: ll[1], centerLon: ll[0] };
          }),
        );
      } else {
        setPlaced((prev) =>
          prev.map((p) => {
            if (p.id !== selection.id) return p;
            const [cx, cy] = WGS84_TO_RD.forward([p.lon, p.lat]);
            const ll = WGS84_TO_RD.inverse([cx + dxMeters, cy + dyMeters]);
            return { ...p, lat: ll[1], lon: ll[0] };
          }),
        );
      }
    },
    [selection],
  );

  // ── Delete key removes whatever is currently selected ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        // Don't intercept Backspace inside form inputs (title-block fields).
        const tgt = e.target as HTMLElement | null;
        const tag = tgt?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) {
          return;
        }
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, deleteSelection]);

  // ── Print to PDF (browser print restricted to the paper) ──────
  const printPdf = useCallback(() => {
    window.print();
  }, []);

  // ── Drag-drop overlay over the paper ──────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  // Toolbox file inputs.
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  // Ribbon-button bridge — listen for the global events dispatched by
  // SonderingstekeningTab so the user can click them from either place.
  useEffect(() => {
    const onTogglePlace = () => setPlaceMode((m) => !m);
    const onAddOverlay = () => overlayInputRef.current?.click();
    const onPrint = () => window.print();
    const onPlaceRaster = () => placeRaster();
    const onCoordTag = () => {
      coordModeRef.current = true;
      setCoordMode(true);
    };
    const onCopy = () => copySelection();
    const onDelete = () => deleteSelection();
    const onMove = (e: Event) => {
      const ce = e as CustomEvent<{ dx: number; dy: number }>;
      moveSelection(ce.detail.dx, ce.detail.dy);
    };
    window.addEventListener("ogs:tekening-toggle-place", onTogglePlace);
    window.addEventListener("ogs:tekening-add-overlay", onAddOverlay);
    window.addEventListener("ogs:tekening-print", onPrint);
    window.addEventListener("ogs:tekening-place-raster", onPlaceRaster);
    window.addEventListener("ogs:tekening-coord-tag", onCoordTag);
    window.addEventListener("ogs:tekening-copy", onCopy);
    window.addEventListener("ogs:tekening-delete", onDelete);
    window.addEventListener("ogs:tekening-move", onMove as EventListener);
    return () => {
      window.removeEventListener("ogs:tekening-toggle-place", onTogglePlace);
      window.removeEventListener("ogs:tekening-add-overlay", onAddOverlay);
      window.removeEventListener("ogs:tekening-print", onPrint);
      window.removeEventListener("ogs:tekening-place-raster", onPlaceRaster);
      window.removeEventListener("ogs:tekening-coord-tag", onCoordTag);
      window.removeEventListener("ogs:tekening-copy", onCopy);
      window.removeEventListener("ogs:tekening-delete", onDelete);
      window.removeEventListener("ogs:tekening-move", onMove as EventListener);
    };
  }, [placeRaster, copySelection, deleteSelection, moveSelection]);

  // ── Paper render — actual on-screen px from the chosen mm. ────
  // We pin paper width to 72% of the view; height follows the aspect
  // ratio. This keeps the paper looking like a paper even when the
  // window is small. (Real-scale rendering is enforced via map.fitBounds.)
  const paperStyle = useMemo(() => {
    const { wMm, hMm } = PAPER_MM[paperSize];
    const aspect = wMm / hMm;
    return {
      aspectRatio: `${aspect}`,
    } as React.CSSProperties;
  }, [paperSize]);

  return (
    <div className="tek-view" ref={containerRef}>
      <div className="tek-topbar">
        <div className="tek-topbar-group">
          <label className="tek-label">{`Papier`}</label>
          <select
            className="tek-select"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
          >
            {PAPER_SIZES.map((p) => (
              <option key={p} value={p}>{`${p} liggend`}</option>
            ))}
          </select>
        </div>
        <div className="tek-topbar-group">
          <label className="tek-label">{`Schaal`}</label>
          <select
            className="tek-select"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value) as Scale)}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>{`1:${s}`}</option>
            ))}
          </select>
        </div>
        {/* Layer toggles live in the GisLayerPanel on the left now —
            no more topbar checkboxes. The image-overlay width input
            (next group) stays inline because it's view-specific. */}
        {overlay && (overlay.kind === "image" || overlay.kind === "svg") && (
          <div className="tek-topbar-group">
            <label className="tek-label">{`Image breedte (m)`}</label>
            <input
              type="number"
              className="tek-select"
              style={{ width: 80 }}
              min={1}
              max={5000}
              step={1}
              value={overlay.widthMeters ?? 100}
              onChange={(e) =>
                setOverlay((o) =>
                  o ? { ...o, widthMeters: Math.max(1, Number(e.target.value) || 100) } : o,
                )
              }
            />
          </div>
        )}
        <div className="tek-topbar-spacer" />
        <button className="tek-btn tek-btn-primary" onClick={printPdf}>
          Exporteer als PDF
        </button>
      </div>

      <div className="tek-canvas">
        <div
          className={`tek-paper tek-paper-${paperSize}${dragOver ? " tek-paper-dragover" : ""}`}
          style={paperStyle}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {/* Frame (loaded SVG) sits behind everything, on top of the map */}
          {frame && (
            <img className="tek-frame-svg" src={frame.src} alt={frame.name} />
          )}
          {/* Embedded Leaflet map fills the paper */}
          <div ref={paperRef} className="tek-paper-map" />
          {/* Image/SVG overlays attach to the Leaflet map (see the
              imageOverlay effect) so they scale with zoom — no DOM
              overlay needed. PDF + DWG fall back to DOM since Leaflet
              can't render them directly. */}
          {overlay && overlay.kind === "pdf" && (
            <iframe
              className="tek-overlay tek-overlay-pdf"
              src={overlay.src}
              title={overlay.name}
            />
          )}
          {overlay && overlay.kind === "dwg" && (
            <div className="tek-overlay tek-overlay-stub">
              <div>
                <strong>{overlay.name}</strong>
                <p>DWG/DXF parser komt eraan</p>
              </div>
            </div>
          )}
          {/* Title block (Detailblad layout — mirrors page 2 of
              OpenAEC-style-book/preview-titleblock.html). A bottom-strip
              title bar with a project header row + 2×3 cell grid + logo
              cell on the left + format corner on the right. */}
          <div className="tek-titleblock-db">
            {/* Project bar — full width */}
            <div className="tek-db-project-bar">
              <span className="tek-dbp-title">{titleBlock.project || "Projectnaam"}</span>
              <span className="tek-dbp-address">{project?.title || "Straatnaam, huisnummer, projectplaats"}</span>
              <span className="tek-dbp-type">Sonderingstekening</span>
            </div>
            {/* Body grid: logo | metadata cells | format corner */}
            <div className="tek-db-body">
              <div className="tek-db-logo-cell">
                <svg width="34" height="38" viewBox="0 0 80 88" fill="none" aria-hidden>
                  <g transform="translate(40, 12)">
                    <polygon points="0,0 -30,17 0,34 30,17" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinejoin="round" />
                    <polygon points="-30,17 -30,56 0,73 0,34" fill="none" stroke="#D97706" strokeWidth="2" strokeLinejoin="round" />
                    <polygon points="30,17 30,56 0,73 0,34" fill="none" stroke="#A1A1AA" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
                  </g>
                </svg>
                <div className="tek-db-logo-text">Open<span>AEC</span></div>
                <div className="tek-db-logo-sub">Geotechniek</div>
              </div>
              <div className="tek-db-cells">
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">1e Datum</div>
                  <div className="tek-db-cell-val mono">{titleBlock.date || "—"}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Wijz.</div>
                  <div className="tek-db-cell-val mono">{titleBlock.version || "—"}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Schaal</div>
                  <div className="tek-db-cell-val mono">{titleBlock.scale}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Formaat</div>
                  <div className="tek-db-cell-val mono">{paperSize}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Projectnr</div>
                  <div className="tek-db-cell-val mono amber">{titleBlock.drawingNumber || "—"}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Auteur</div>
                  <div className="tek-db-cell-val">{titleBlock.drawnBy || "—"}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Kenmerk</div>
                  <div className="tek-db-cell-val mono amber">{titleBlock.drawingNumber || "—"}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Blad</div>
                  <div className="tek-db-cell-val mono">1 / 1</div>
                </div>
              </div>
              <div className="tek-db-geo">
                <div className="tek-db-geo-label">Formaat</div>
                <div className="tek-db-geo-format">{paperSize}</div>
              </div>
            </div>
          </div>
        </div>

        <aside className="tek-toolbox">
          <h4 className="tek-toolbox-title">Gereedschap</h4>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => overlayInputRef.current?.click()}
            >
              Tekening toevoegen
            </button>
            <input
              ref={overlayInputRef}
              type="file"
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.webp,.svg,.dwg,.dxf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            <p className="tek-tool-hint">Of sleep een PDF/JPG/SVG op het papier</p>
          </div>

          <div className="tek-tool-group">
            <label className="tek-tool-sub">Raster sonderingen</label>
            <div className="tek-tool-row">
              <select
                className="tek-select tek-select-sm"
                value={gridSpacing}
                onChange={(e) =>
                  setGridSpacing(Number(e.target.value) as typeof GRID_SPACINGS[number])
                }
              >
                {GRID_SPACINGS.map((g) => (
                  <option key={g} value={g}>{`${g} m`}</option>
                ))}
              </select>
              <button className="tek-tool-btn tek-tool-btn-sm" onClick={placeRaster}>
                Plaats raster
              </button>
            </div>
            <p className="tek-tool-hint">
              {`Standaard ${DEFAULT_RASTER_ROWS}×${DEFAULT_RASTER_COLS} — sleep de hoeken om op te rekken, de bovenste handle om te roteren`}
            </p>
          </div>

          {/* Inline edit panel — only when a raster is selected ───── */}
          {selection?.kind === "raster" && (() => {
            const r = rasters.find((x) => x.id === selection.id);
            if (!r) return null;
            return (
              <div className="tek-tool-group tek-tool-group-edit">
                <label className="tek-tool-sub">{`Geselecteerd: ${r.id}`}</label>
                <div className="tek-tool-row">
                  <label className="tek-numfield">
                    <span>Rijen</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={r.rows}
                      onChange={(e) =>
                        updateSelectedRaster({
                          rows: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </label>
                  <label className="tek-numfield">
                    <span>Kolommen</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={r.cols}
                      onChange={(e) =>
                        updateSelectedRaster({
                          cols: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="tek-tool-row">
                  <label className="tek-numfield">
                    <span>H.o.h. X</span>
                    <input
                      type="number"
                      min={0.5}
                      max={500}
                      step={0.5}
                      value={Number(r.spacingX.toFixed(2))}
                      onChange={(e) =>
                        updateSelectedRaster({
                          spacingX: Math.max(0.5, Number(e.target.value) || 0.5),
                        })
                      }
                    />
                  </label>
                  <label className="tek-numfield">
                    <span>H.o.h. Y</span>
                    <input
                      type="number"
                      min={0.5}
                      max={500}
                      step={0.5}
                      value={Number(r.spacingY.toFixed(2))}
                      onChange={(e) =>
                        updateSelectedRaster({
                          spacingY: Math.max(0.5, Number(e.target.value) || 0.5),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="tek-numfield tek-numfield-wide">
                  <span>{`Rotatie (°)`}</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round(r.rotation)}
                    onChange={(e) =>
                      updateSelectedRaster({ rotation: Number(e.target.value) })
                    }
                  />
                  <span className="tek-num-val">{`${Math.round(r.rotation)}°`}</span>
                </label>
                <button
                  className="tek-tool-btn tek-tool-btn-ghost"
                  onClick={deleteSelection}
                >
                  Verwijder raster
                </button>
              </div>
            );
          })()}

          {selection?.kind === "marker" && (
            <div className="tek-tool-group tek-tool-group-edit">
              <label className="tek-tool-sub">{`Geselecteerd: ${selection.id}`}</label>
              <button
                className="tek-tool-btn tek-tool-btn-ghost"
                onClick={deleteSelection}
              >
                Verwijder sondering
              </button>
            </div>
          )}

          <div className="tek-tool-group">
            <label className="tek-tool-sub">Plaatsen</label>
            <button
              className={`tek-tool-btn${placeMode ? " tek-tool-btn-active" : ""}`}
              onClick={() => setPlaceMode((m) => !m)}
            >
              {placeMode ? "Stop plaatsen" : "Sondering plaatsen"}
            </button>
            {(placed.length > 0 || rasters.length > 0) && (
              <button className="tek-tool-btn tek-tool-btn-ghost" onClick={clearPlaced}>
                {`Wis alles (${placed.length} markers, ${rasters.length} rasters)`}
              </button>
            )}
          </div>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => setTitleBlockOpen((v) => !v)}
            >
              {titleBlockOpen ? "Sluit Title block" : "Title block"}
            </button>
            {titleBlockOpen && (
              <div className="tek-tb-form">
                {(["project", "drawingNumber", "date", "drawnBy", "checkedBy", "version"] as const).map((k) => (
                  <label key={k} className="tek-tb-field">
                    <span>{k}</span>
                    <input
                      type="text"
                      value={titleBlock[k]}
                      onChange={(e) =>
                        setTitleBlock((tb) => ({ ...tb, [k]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => frameInputRef.current?.click()}
            >
              Tekeningkader laden
            </button>
            <input
              ref={frameInputRef}
              type="file"
              hidden
              accept=".svg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFrameFile(f);
                e.target.value = "";
              }}
            />
            {frame && (
              <p className="tek-tool-hint">{`Geladen: ${frame.name}`}</p>
            )}
          </div>
        </aside>
      </div>

      {toast && <div className="tek-toast">{toast}</div>}
    </div>
  );
}
