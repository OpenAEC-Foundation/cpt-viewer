import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import proj4 from "proj4";
import { useCptStore } from "../../store/useCptStore";
import type { Cpt } from "../../types/cpt";
import {
  consumePendingTekeningRestore,
  getLatestTekening,
  setLatestTekening,
  type TekeningFullState,
} from "../../store/tekeningState";
import { fetchBagPanden, fetchKadasterPercelen } from "../../utils/pdokWfs";
import { AdressenLayer } from "../../utils/adressenLayer";
import ImageCropDialog from "./ImageCropDialog";
import PdfCropDialog from "./PdfCropDialog";
import OffertesDialog from "./OffertesDialog";
import IfcxPreviewDialog from "./IfcxPreviewDialog";
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

/**
 * Standaard kaartlocatie wanneer er GÉÉN sondering geopend is: de Grote
 * Kerk (Onze-Lieve-Vrouwekerk) in Dordrecht. Zodra er één sondering open
 * staat overschrijft de auto-fit (zie effect verderop) dit met de
 * sondering-locatie; sluit de gebruiker alle sonderingen, dan keert de
 * kaart hierheen terug. Eén plek voor de coördinaten zodat het overal
 * consistent is (init-fallback, default-state én auto-fit).
 */
const GROTE_KERK_DORDRECHT = { lat: 51.8136, lon: 4.66135, zoom: 17 } as const;

/**
 * Sleutel van de laatst uitgevoerde sondering-auto-fit — bewust op
 * MODULE-niveau (niet useRef) zodat hij tab-switch-remounts overleeft.
 * Eerste opening van een sondering → auto-fit; daaropvolgende remounts
 * met dezelfde sondering/papier → de opgeslagen (evt. handmatig
 * aangepaste) viewport wint. Zie het auto-fit- en restore-effect.
 */
let fittedTekeningKey: string | null = null;

// ── Paper geometry ───────────────────────────────────────────────
// All dimensions in millimetres. ISO A-series landscape.
type PaperSize = "A2" | "A3";
/** Print scale 1:N — was a fixed union (500/1000/2000/5000) but we
 *  now allow any positive integer so the user can type a custom value
 *  in the titleblock (e.g. 1:850). The dropdown in TekeningProperties
 *  still offers the four standard presets. */
type Scale = number;

const PAPER_MM: Record<PaperSize, { wMm: number; hMm: number }> = {
  A2: { wMm: 594, hMm: 420 },
  A3: { wMm: 420, hMm: 297 },
};

// SCALES + PAPER_SIZES arrays inline in TekeningProperties now.
const GRID_SPACINGS = [15, 20, 25] as const;
const DEFAULT_RASTER_ROWS = 3;
const DEFAULT_RASTER_COLS = 3;
const DEFAULT_RASTER_SPACING = 20; // metres

interface PlacedSondering {
  id: string;       // S01 / B01 — letter is afhankelijk van kind
  lat: number;
  lon: number;
  /** Object-type — "sondering" tekent het standaard driehoek-symbool,
   *  "bore" tekent het open-ring boringssymbool (zelfde icon-conventie
   *  als de BRO-laag op de Kaart-tab). */
  kind?: "sondering" | "bore";
  /**
   * Optional flag — when true the marker renders an extra horizontal
   * line under the triangle apex, indicating that the sondering has
   * "kleefmeting" (sleeve-friction) data. Toggled per marker in the
   * Eigenschappen panel.
   */
  kleefmeting?: boolean;
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
  /** Maximaal toegestane h-o-h-afstand (meters). Wanneer de gebruiker
   *  het raster groter sleept, worden er automatisch méér rijen/kolommen
   *  bijgemaakt zodat de werkelijke spacing nooit boven dit getal komt.
   *  Standaard 20 m (Dutch NEN-praktijk: 15/20/25 m grid). */
  maxSpacing?: number;
  /** Kleefmeting-streepje onder elke rastercel-driehoek (NEN-symbool
   *  voor sondering met plaatselijke wrijving). Per raster togglebaar
   *  in het Eigenschappen-paneel. */
  kleefmeting?: boolean;
}

/** A selection identifies which object the user is currently editing. */
type Selection =
  | { kind: "marker"; id: string }
  | { kind: "raster"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "line"; id: string }
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
  /** Projectnummer — los van de tekening-nr zodat in een multi-tekening
   *  project elk blad het gedeelde nummer kan dragen (e.g. "P25-0421")
   *  én een eigen tekeningnummer (e.g. "S-01"). */
  projectNumber: string;
  /** Adresregel onder de projectnaam (Straatnaam, huisnummer,
   *  projectplaats). Vroeger gevuld met `project.title` als fallback —
   *  dat gaf "Nieuw project" dubbel onder de projectnaam. Nu een
   *  zelfstandig veld, ingevuld via het Eigenschappen-paneel of
   *  inline in het titleblock. */
  address: string;
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

/**
 * Free-line annotation drawn on the paper. Two latlng endpoints.
 * `kind = "dimension"` adds end-tick marks + a metre-distance label
 * at the midpoint (Dutch maatlijn style); `kind = "line"` is a plain
 * polyline (a/b dashed for guides if the user wants in v2).
 */
interface DrawnLine {
  id: string;
  kind: "line" | "dimension";
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  /** Optionele override-kleur (hex, b.v. "#1F4FA8"). Wanneer gezet
   *  overrijdt de kind-default (dimension=amber, line=donkergrijs).
   *  Gebruiker zet deze via de kleur-picker in TekeningProperties
   *  zodra een lijn geselecteerd is. */
  color?: string;
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

// `paperMmToMeters` helper verwijderd — de schaal-effect berekent nu
// rechtstreeks targetMPerPx en zet de zoom via `setView` ipv via een
// bbox + fitBounds.

// Per-print-scale segment table verwijderd — schaalbar werkt nu
// volledig op `mPerPx` uit de live Leaflet-projectie. Zie ScaleBar
// component onderaan dit bestand.

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

// ── CAD-geometrie-helpers ────────────────────────────────────────
// Lijnen worden bewaard als lat/lon-paren. Voor euclidische
// berekeningen (snijpunt, parallel, spiegelen) projecteren we
// telkens naar RD New (EPSG:28992) — daar zijn afstanden in meters
// en is een loodrechte vector écht loodrecht. Resultaten gaan
// terug via WGS84_TO_RD.inverse zodat ze direct in DrawnLine-state
// passen.

/** Punt in RD-meters (x = oost, y = noord). */
type RdPoint = readonly [number, number];

/** Lat/lon → RD-meters via de projectie boven in dit bestand. */
const llToRd = (lat: number, lon: number): RdPoint => {
  const [x, y] = WGS84_TO_RD.forward([lon, lat]);
  return [x, y];
};

/** RD-meters → { lat, lon } voor opname in DrawnLine-state. */
const rdToLl = ([x, y]: RdPoint): { lat: number; lon: number } => {
  const ll = WGS84_TO_RD.inverse([x, y]);
  return { lat: ll[1], lon: ll[0] };
};

/**
 * Snijpunt van twee oneindige lijnen door A-B en C-D in RD.
 * Geeft het punt + de parameters t (langs AB) en u (langs CD).
 * Retourneert `null` als de lijnen parallel zijn (det ≈ 0).
 * Het is aan de caller om te kijken of het snijpunt binnen de
 * segmenten valt (0 ≤ t ≤ 1, 0 ≤ u ≤ 1) — voor trim/extend
 * willen we juist ook snijpunten buiten het segment kunnen
 * gebruiken (extend verlengt tot de oneindige referentielijn).
 */
function lineIntersectionRd(
  a: RdPoint, b: RdPoint, c: RdPoint, d: RdPoint,
): { p: RdPoint; t: number; u: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const det = rx * sy - ry * sx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / det;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / det;
  return { p: [a[0] + t * rx, a[1] + t * ry] as RdPoint, t, u };
}

/**
 * Spiegel een punt P over de lijn door A-B (RD).
 * Standaard-formule:  P' = P - 2 × ((P-A) - ((P-A)·n̂)n̂)
 * waarbij n̂ de eenheidsvector langs AB is.
 */
function mirrorPointRd(p: RdPoint, a: RdPoint, b: RdPoint): RdPoint {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return p; // graf is een punt — geen spiegelas
  const nx = dx / len;
  const ny = dy / len;
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const proj = apx * nx + apy * ny;
  const projX = proj * nx;
  const projY = proj * ny;
  const perpX = apx - projX;
  const perpY = apy - projY;
  return [p[0] - 2 * perpX, p[1] - 2 * perpY] as RdPoint;
}

/**
 * Parallel-lijn van A-B op afstand `dist` meters, aan de zijde
 * die door `side` wordt aangewezen: side = +1 → links van A→B
 * (loodrecht (-dy, dx)), side = -1 → rechts. Voor offset-tool
 * bepaalt de hint-klik op welke zijde de kopie komt door op het
 * teken van het kruisproduct (B-A) × (clickRd - A) te kijken.
 */
function offsetLineRd(
  a: RdPoint, b: RdPoint, dist: number, side: 1 | -1,
): { a: RdPoint; b: RdPoint } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { a, b };
  // Loodrechte eenheidsvector — links van A→B is (-dy, dx)/len.
  const nx = (-dy / len) * dist * side;
  const ny = (dx / len) * dist * side;
  return {
    a: [a[0] + nx, a[1] + ny] as RdPoint,
    b: [b[0] + nx, b[1] + ny] as RdPoint,
  };
}

/**
 * Bepaal aan welke zijde van segment A-B het punt P ligt.
 * Geeft +1 voor "links" (positief kruisproduct in RD),
 * -1 voor "rechts", 0 als P precies op de lijn ligt.
 */
function sideOfLineRd(p: RdPoint, a: RdPoint, b: RdPoint): 1 | -1 | 0 {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

export default function SonderingstekeningView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Available area for the paper (inner size of `.tek-canvas`). Tracked
  // via ResizeObserver so the paper's pixel size can be recomputed to
  // always fit the whole sheet inside the visible canvas, while still
  // respecting the physical A2 / A3 ratio and proportional sizing.
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>(
    { w: 0, h: 0 },
  );
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
  /**
   * WFS snap-features — vlakke lijst van Polygon / MultiPolygon features
   * uit BAG + Kadaster die binnen het huidige map-viewport vallen. Wordt
   * gevuld door reloadBagOverlay / reloadKadasterOverlay en gelezen door
   * de mousemove-snap-handler. We bewaren BAG en Kadaster apart zodat
   * een toggle op één van de lagen alleen die set leegmaakt.
   */
  const snapBagFeaturesRef = useRef<GeoJSON.Feature[]>([]);
  const snapKadasterFeaturesRef = useRef<GeoJSON.Feature[]>([]);
  /**
   * Layer voor de oranje snap-marker (cirkel + outline). Tekent één
   * marker op de dichtsbijzijnde vertex / edge-projectie binnen de
   * 12 px threshold. Leeg wanneer er niets te snappen valt.
   */
  const snapLayerRef = useRef<L.LayerGroup | null>(null);
  const snapMarkerRef = useRef<L.Marker | null>(null);
  /**
   * Live snap-LatLng — wordt door mousemove gezet naar de positie van
   * de actuele snap-marker, of `null` als er geen snap is. De map-click
   * handler leest dit ref zodat een klik op een snap-positie het
   * geplaatste object op exact de polygon-hoek of edge-projectie
   * neerzet ipv op de cursor-positie.
   */
  const activeSnapRef = useRef<L.LatLng | null>(null);
  const placedLayerRef = useRef<L.LayerGroup | null>(null);
  /**
   * Preview-laag voor teken-tools: rubber-band lijn tussen de eerste
   * draw-klik en de cursor, en het live RD-coördinaat-label tijdens
   * coord-mode. Lazy aangemaakt in de mousemove-handler; leeggemaakt
   * zodra de tool uit gaat of de tweede klik valt.
   */
  const drawPreviewLayerRef = useRef<L.LayerGroup | null>(null);
  const rasterLayerRef = useRef<L.LayerGroup | null>(null);
  const handlesLayerRef = useRef<L.LayerGroup | null>(null);
  const coordLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLayerRef = useRef<L.ImageOverlay | null>(null);
  // Aparte handle-layer voor de geselecteerde image-overlay (4 hoek-
  // handles voor schalen). Gescheiden van `handlesLayerRef` zodat ze
  // elkaars markers niet wegvegen wanneer beide effects runnen.
  const overlayHandlesLayerRef = useRef<L.LayerGroup | null>(null);
  // Cache van de natural aspect-ratio van de overlay-image (height/
  // width), zodat resize-handles de hoogte proportioneel berekenen
  // zonder elke keer een nieuwe Image() te laden. Wordt door het
  // overlay-init effect gevuld.
  const overlayAspectRef = useRef<number>(1);
  const broLayerRef = useRef<L.LayerGroup | null>(null);
  const projectLayerRef = useRef<L.LayerGroup | null>(null);
  // Place-mode is een driewaardig flag: null = uit, "sondering" of
  // "bore" voor het objecttype dat de volgende kaartklik moet plaatsen.
  // Ref + state om zowel in de map-click handler als in de UI te
  // kunnen lezen.
  const placeModeRef = useRef<null | "sondering" | "bore">(null);
  // Whether the next map click should drop an RD-coordinate tag (vs.
  // place a sondering or just deselect). Ref so the bound map handler
  // always sees the latest value without re-binding.
  const coordModeRef = useRef(false);
  // Live snapshot of the latest rasters list, so drag-handler closures
  // (registered once per render) always read the fresh value when fired.
  const rastersRef = useRef<PlacedRaster[]>([]);
  // Refs voor snap-handler: read live state zonder de mousemove-closure
  // bij elke render opnieuw te binden. Gevuld door synchroniserende
  // useEffects verderop in de file.
  const placedRef = useRef<PlacedSondering[]>([]);
  const drawnLinesRef = useRef<DrawnLine[]>([]);
  const coordTagsRef = useRef<CoordTag[]>([]);
  const projectRef = useRef<{ cpts: Cpt[] } | null>(null);
  // Laatste cursor-positie op de tekening (in lat/lng). Wordt door
  // de map-mousemove gevuld zodat de M/G-sneltoets de huidige cursor-
  // positie als anchor kan gebruiken zonder dat de gebruiker eerst
  // hoeft te bewegen.
  const lastMouseLLRef = useRef<{ lat: number; lng: number } | null>(null);
  // Sync de refs bij elke render — closure-captures in de mousemove-
  // snap-handler kunnen zo de live waarden lezen zonder dat ze
  // opnieuw gebound hoeven te worden (handler zit in [] deps init-
  // effect).
  // NB: dit gebruikt geen useEffect zodat de update synchroon met
  // de render meekomt — useEffect heeft een frame-vertraging.
  /**
   * True while the user is mid-drag on any raster handle. Used by the
   * handle-render effect to skip rebuilding the handle markers — otherwise
   * each `setRasters` from the drag handler triggers an effect re-run that
   * destroys the very marker Leaflet is dragging, and the drag dies.
   */
  const draggingRef = useRef(false);

  const [paperSize, setPaperSize] = useState<PaperSize>("A3");
  const [scale, setScale] = useState<Scale>(500);
  const [showBro, setShowBro] = useState(true);
  const [placeMode, setPlaceMode] = useState<null | "sondering" | "bore">(null);
  // gridSpacing remains as a constant default — the in-view dropdown is
  // gone, future ribbon control could re-introduce a setter if needed.
  const [gridSpacing] = useState<typeof GRID_SPACINGS[number]>(20);
  const [placed, setPlaced] = useState<PlacedSondering[]>([]);
  const [rasters, setRasters] = useState<PlacedRaster[]>([]);
  const [coordTags, setCoordTags] = useState<CoordTag[]>([]);
  const [coordMode, setCoordMode] = useState(false);
  // Select-mode: wanneer true, plain drag op het papier tekent een
  // amber selectie-rechthoek (zonder Shift). Toggled door de
  // "Selecteren" ribbon-knop.
  const [selectMode, setSelectMode] = useState(false);
  const selectModeRef = useRef(false);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);
  // Custom logo data-URL — vervangt het standaard OpenAEC-driehoek-
  // logo in de titleblock-cel. Wordt via een file-input gewisseld
  // (klik op het logo). Null = default OpenAEC-logo.
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  /**
   * Currently-active drawing tool. When non-null, the next map click
   * starts a new line segment; the click after completes it. Set via
   * the ribbon's Lijn / Maatlijn buttons. `"line"` = plain polyline,
   * `"dimension"` = polyline + end-tick marks + metre-distance label.
   */
  const [drawMode, setDrawMode] = useState<"line" | "dimension" | null>(null);
  const drawModeRef = useRef<"line" | "dimension" | null>(null);
  const drawStartRef = useRef<{ lat: number; lon: number } | null>(null);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const drawnLayerRef = useRef<L.LayerGroup | null>(null);
  /**
   * Actieve CAD-edit-tool. Eén van:
   *   - "trim":   klik eerst de referentielijn, dan het stuk dat WEG moet
   *   - "extend": klik eerst de referentielijn, dan het endpoint dat verlengt
   *   - "mirror": klik twee punten op de kaart om de spiegelas te zetten
   *               (werkt op huidige `selection` — lijn of marker)
   *   - "offset": vraag eerst de afstand in m, dan klik aan de zijde
   *               waar de parallel-lijn moet komen
   *   - "movedrag": sleep-handle op het geselecteerde object actief
   *               (renderd als amber drag-handle op het center; geen
   *               map-click flow want het is gewoon een drag)
   * Wordt door de ribbon-knoppen gezet via ogs:tekening-cad-* events;
   * gereset op Escape, op completion, en op select-mode-knop.
   */
  type CadMode = "trim" | "extend" | "mirror" | "offset" | "movedrag" | null;
  const [cadMode, setCadMode] = useState<CadMode>(null);
  const cadModeRef = useRef<CadMode>(null);
  /**
   * Cross-step state voor multi-klik CAD-tools.
   * - trim/extend: refLineId van de eerste klik (referentielijn) zodat
   *   de tweede klik weet welke lijn geknipt/verlengd moet worden
   * - mirror: eerste klik-punt van de spiegelas (lat/lon) — tweede
   *   klik completeert de as en past de spiegeling toe op de huidige
   *   selectie
   * - offset: bewaarde brondata (gekozen lijn + afstand in m) tussen
   *   de offset-start (op de geselecteerde lijn) en de hint-klik
   */
  const cadStepRef = useRef<
    | { kind: "trim-ref"; refLineId: string }
    | { kind: "extend-ref"; refLineId: string }
    | { kind: "mirror-axis"; lat: number; lon: number }
    | { kind: "offset-hint"; lineId: string; dist: number }
    | null
  >(null);
  /**
   * Bump-counter used to force the handle-render effect to run again
   * after a drag ends — the actual raster state may already be at the
   * post-drag value (the drag handler called `setRasters` repeatedly
   * while the rebuild was suppressed by `draggingRef`), so we need an
   * unrelated dep to actually re-trigger the layout pass.
   */
  const [handleRedraw, setHandleRedraw] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  // Mirror van `selection` zodat ribbon-event-handlers (in een useEffect
  // met [] deps) altijd de huidige selectie kunnen lezen zonder dat we
  // ze elke keer opnieuw moeten registreren.
  const selectionRef = useRef<Selection>(null);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  // Multi-selectie: ontstaat door Shift+drag een rechthoek op het papier
  // te tekenen. Bevat een mix van marker / raster / overlay / line /
  // coord-tag-ids. Het Delete-event verwijdert ze allemaal in één
  // keer. Wordt automatisch gewist bij iedere plain (geen-shift) klik
  // op de kaart of bij Escape.
  type MultiItem =
    | { kind: "marker"; id: string }
    | { kind: "raster"; id: string }
    | { kind: "overlay"; id: string }
    | { kind: "line"; id: string }
    | { kind: "coord"; id: string };
  const [multiSelection, setMultiSelection] = useState<MultiItem[]>([]);
  const multiSelectionRef = useRef<MultiItem[]>([]);
  useEffect(() => { multiSelectionRef.current = multiSelection; }, [multiSelection]);
  // Rotatie (graden, klokwise) voor de actieve image/svg overlay.
  // Wordt door de ribbon-rotate-knop opgehoogd en als CSS transform
  // toegepast in een effect dat de Leaflet imageOverlay DOM-element
  // bewerkt. Markers + rasters hebben hun eigen rotatie elders.
  const [overlayRotation, setOverlayRotation] = useState(0);
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
  // Pending crop — when the user picks a raster image we first open the
  // ImageCropDialog so they can trim borders before the overlay lands on
  // the paper. `src` is an object URL we own and must revoke on close.
  const [cropPending, setCropPending] = useState<
    { src: string; name: string } | null
  >(null);
  // Same idea, but for PDF input: we hand the object URL to
  // PdfCropDialog which renders the page picker, then the crop stage.
  const [pdfCropPending, setPdfCropPending] = useState<
    { src: string; name: string } | null
  >(null);
  // Open-state voor de "Vraag 3 offertes"-dialog. Wordt getriggerd
  // door het `ogs:tekening-request-quotes` event vanuit de ribbon.
  const [offertesOpen, setOffertesOpen] = useState(false);
  // Open-state voor de IFCX-preview dialog (read-only viewer).
  const [ifcxPreviewOpen, setIfcxPreviewOpen] = useState(false);
  const [frame, setFrame] = useState<FrameSvg | null>(null);
  // Live "meters per CSS pixel" for the visible map — keeps the scale
  // bar correct even when the Leaflet view doesn't exactly match the
  // requested print scale (e.g. Web Mercator distortion at NL
  // latitude, or aspect-ratio mismatch between paper-map and bbox).
  const [mPerPx, setMPerPx] = useState(0);
  // Flag die getoggled wordt zodra de Leaflet-map zijn eerste
  // invalidateSize heeft afgemaakt. Triggert het scale-effect om
  // 1:N opnieuw toe te passen — anders bailt het bij mount omdat
  // map.latLngToContainerPoint nog geen panes had en blijft de
  // startzoom (b.v. 18) staan i.p.v. 1:500 (Z≈19.5).
  const [mapReady, setMapReady] = useState(0);
  // Live centre + zoom van de Leaflet kaart. Wordt bijgewerkt op
  // moveend / zoomend; uitsluitend gebruikt door de save-snapshot
  // zodat een opgeslagen .ifcgis op exact dezelfde viewport opent.
  const [mapView, setMapView] = useState<{
    lat: number;
    lon: number;
    zoom: number;
  }>({ lat: GROTE_KERK_DORDRECHT.lat, lon: GROTE_KERK_DORDRECHT.lon, zoom: GROTE_KERK_DORDRECHT.zoom });
  // Freeze viewport — when true the Leaflet map cannot be panned or
  // zoomed (drag / scroll-wheel / pinch / double-click / box / keyboard
  // are all disabled). The ribbon's freeze toggle dispatches
  // `ogs:tekening-toggle-freeze`; we mirror the flag back via
  // `ogs:tekening-freeze-changed` so the ribbon button can show its
  // active state.
  const [frozen, setFrozen] = useState(false);
  // Move-modus (Revit "MV" / Blender "G"-style): wanneer aan staat,
  // volgt het geselecteerde object de cursor — een klik commit, Esc
  // cancelt. Gestart door de keyboard-shortcut, niet door een ribbon-
  // knop (zelfde idee als CAD-software).
  const [moveMode, setMoveMode] = useState<
    | { kind: "overlay"; id: string }
    | { kind: "marker"; id: string }
    | { kind: "line"; id: string }
    | { kind: "raster"; id: string }
    | null
  >(null);
  const moveModeRef = useRef<typeof moveMode>(null);
  useEffect(() => { moveModeRef.current = moveMode; }, [moveMode]);
  // Snapshot van de originele posities + anchor-cursor op het moment
  // dat move-modus startte. Tijdens mousemove berekenen we cursor-delta
  // en passen die toe op de oorspronkelijke posities — zodat een
  // geselecteerde lijn (2 endpoints) als geheel meebeweegt en niet één
  // endpoint elke frame opnieuw wordt verlegd.
  const moveAnchorRef = useRef<{
    anchorLat: number;
    anchorLon: number;
    // overlay: center / marker: lat,lon / line: lat1,lon1,lat2,lon2 /
    // raster: centerLat,centerLon
    origin: Record<string, number>;
  } | null>(null);
  // Image-overlay z-index toggle: false = onder lijnen/markers (default,
  // achtergrond) / true = boven alles (handig om de afbeelding kort als
  // hoofd-content te zien). Geforceerd via CSS-klasse op het IMG.
  const [overlayInForeground, setOverlayInForeground] = useState(false);
  // CSS-zoom + pan op het hele papier wanneer frozen aanstaat —
  // gebruiker-verzoek: bij freeze mag je wél vrij in/uitzoomen (naar de
  // cursor toe, niet vast aan linksboven) én pannen op de tekening
  // (incl. kader), zonder dat de Leaflet-map zelf reageert. `z`
  // vermenigvuldigt met paperLayout.viewScale; x/y verschuiven de
  // stage in canvas-pixels.
  const [tekView, setTekView] = useState({ z: 1, x: 0, y: 0 });
  // Reset zoom+pan wanneer freeze uitgaat zodat de volgende freeze
  // weer op 100% en gecentreerd start.
  useEffect(() => {
    if (!frozen) setTekView({ z: 1, x: 0, y: 0 });
  }, [frozen]);
  // Ref-spiegel zodat de pan-drag-handler (init-effect, [] deps) de
  // actuele zoom/pan kan lezen zonder her-binden per wijziging.
  const tekViewRef = useRef(tekView);
  useEffect(() => { tekViewRef.current = tekView; }, [tekView]);
  const frozenRef = useRef(false);
  useEffect(() => { frozenRef.current = frozen; }, [frozen]);
  // titleBlockOpen state removed — title block is edited via the
  // right-side TekeningProperties panel now, no in-view modal needed.
  const [titleBlock, setTitleBlock] = useState<TitleBlockData>({
    project: "",
    projectNumber: "",
    address: "",
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

  // ── Move-mode keyboard-shortcuts (M = MV in Revit, G in Blender) ─
  // Start een vrije verplaatsing van het geselecteerde object: cursor
  // volgt het object, een klik commit, Esc cancelt (en herstelt de
  // originele positie). Geeft de gebruiker zonder ribbon-tussenstap
  // een snelle "move-grip" zoals in CAD/3D-software.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Sneltoets alleen op M/m of G/g, en niet wanneer focus op een
      // input/textarea zit (anders kan de gebruiker geen "G" typen in
      // een tekstveld).
      if (e.key !== "m" && e.key !== "M" && e.key !== "g" && e.key !== "G") return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      if (!selection) return;
      const map = mapRef.current;
      if (!map) return;
      // Bepaal originele positie + bouw delta-base
      const cursorLL = lastMouseLLRef.current;
      if (!cursorLL) return;
      let origin: Record<string, number> | null = null;
      if (selection.kind === "overlay" && overlay && overlay.id === selection.id) {
        const cLat = overlay.centerLat ?? map.getCenter().lat;
        const cLon = overlay.centerLon ?? map.getCenter().lng;
        origin = { centerLat: cLat, centerLon: cLon };
      } else if (selection.kind === "marker") {
        const m = placed.find((p) => p.id === selection.id);
        if (m) origin = { lat: m.lat, lon: m.lon };
      } else if (selection.kind === "line") {
        const l = drawnLines.find((x) => x.id === selection.id);
        if (l) origin = { lat1: l.lat1, lon1: l.lon1, lat2: l.lat2, lon2: l.lon2 };
      } else if (selection.kind === "raster") {
        const r = rasters.find((x) => x.id === selection.id);
        if (r) origin = { centerLat: r.centerLat, centerLon: r.centerLon };
      }
      if (!origin) return;
      e.preventDefault();
      moveAnchorRef.current = {
        anchorLat: cursorLL.lat,
        anchorLon: cursorLL.lng,
        origin,
      };
      setMoveMode(selection);
    };
    const onKeyCancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!moveModeRef.current) return;
      // Restore originele positie + clear move-modus
      const anchor = moveAnchorRef.current;
      const mm = moveModeRef.current;
      if (anchor && mm) {
        if (mm.kind === "overlay") {
          setOverlay((ov) =>
            ov && ov.id === mm.id
              ? { ...ov, centerLat: anchor.origin.centerLat, centerLon: anchor.origin.centerLon }
              : ov,
          );
        } else if (mm.kind === "marker") {
          setPlaced((prev) => prev.map((p) =>
            p.id === mm.id ? { ...p, lat: anchor.origin.lat, lon: anchor.origin.lon } : p,
          ));
        } else if (mm.kind === "line") {
          setDrawnLines((prev) => prev.map((l) =>
            l.id === mm.id
              ? { ...l, lat1: anchor.origin.lat1, lon1: anchor.origin.lon1, lat2: anchor.origin.lat2, lon2: anchor.origin.lon2 }
              : l,
          ));
        } else if (mm.kind === "raster") {
          setRasters((prev) => prev.map((r) =>
            r.id === mm.id
              ? { ...r, centerLat: anchor.origin.centerLat, centerLon: anchor.origin.centerLon }
              : r,
          ));
        }
      }
      moveAnchorRef.current = null;
      setMoveMode(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyCancel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyCancel);
    };
  }, [selection, overlay, placed, drawnLines, rasters]);

  // ── Auto-fit scale + center op project-sonderingen ──────────────
  // Wanneer een project met >= 1 positionele CPTs actief wordt, kiezen
  // we de KLEINSTE preset-schaal (500/1000/2000/5000) waar alle
  // sonderingen met 25% marge in passen op het papier, en pannen we
  // de map naar het geografisch midden. Re-runt bij elke project-
  // wissel zodat een nieuw project altijd zoom-fit toont, ook bij
  // tab-switches. Gebruiker-verzoek: "ga ik naar Situatietekening
  // met 2 sonderingen dan moet zoom-fit van die sonderingen
  // overrulen op de standaard locatie".
  //
  // De fit-guard leeft op MODULE-niveau (zie `fittedTekeningKey` boven de
  // component) zodat hij tab-switch-remounts overleeft: de eerste keer dat
  // een sondering opent zoomt de kaart erheen, maar wie daarna handmatig
  // pant/zoomt en even naar een andere tab gaat, krijgt bij terugkomst de
  // eigen framing terug (de viewport-restore mag dan panTo'en) i.p.v.
  // opnieuw de auto-fit. Een useRef was hier fout: die is vers per mount,
  // waardoor élke tab-switch opnieuw fitte en handmatig werk weggooide.
  useEffect(() => {
    const map = mapRef.current;
    // `map` kan nog null zijn als dit effect vóór de map-init draait; het
    // draait dan opnieuw zodra `mapReady` bumpt (init doet dat in een rAF).
    // Dáárom staat mapReady in de deps — vroeger ontbrak die, waardoor de
    // fit nooit gebeurde als het project al actief was vóór de map bestond.
    if (!map) return;
    const positioned = (project?.cpts ?? []).filter((c) => c.position != null);
    // Auto-fit geldt ALLÉÉN wanneer er sondering(en) open staan. Géén
    // sondering → het kaartcentrum komt van de init (Grote Kerk Dordrecht
    // bij een verse start) of van de viewport-restore (eerder getekende
    // inhoud). Auto-fit bemoeit zich daar niet mee, anders zou het die
    // default/herstelde viewport overschrijven.
    if (positioned.length === 0) return;
    // Sleutel onderscheidt "déze sondering(en) op dit papier" zodat we niet
    // elke render opnieuw fitten (handmatige pan/zoom blijft staan) maar wél
    // reageren op openen/wisselen + papierwissel.
    const key = `cpts:${activeDocId}:${paperSize}`;
    if (fittedTekeningKey === key) return;
    fittedTekeningKey = key;

    // ── Centreer + kies de kleinste preset-schaal ──
    // Center op geografisch midden in RD-meters.
    const meanX =
      positioned.reduce((s, c) => s + c.position!.x_rd, 0) / positioned.length;
    const meanY =
      positioned.reduce((s, c) => s + c.position!.y_rd, 0) / positioned.length;
    const ll = WGS84_TO_RD.inverse([meanX, meanY]);
    // Bounds in RD-meters.
    const xs = positioned.map((c) => c.position!.x_rd);
    const ys = positioned.map((c) => c.position!.y_rd);
    const widthM = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const heightM = Math.max(1, Math.max(...ys) - Math.min(...ys));
    // 25% marge + 20m absolute marge (zodat 1-sondering-projecten
    // niet op 1:500 staan met de driehoek tegen de paper-rand).
    const fitW = widthM * 1.25 + 20;
    const fitH = heightM * 1.25 + 20;
    const PAPER_W_MM: Record<PaperSize, number> = { A2: 574, A3: 400 };
    const PAPER_H_MM: Record<PaperSize, number> = { A2: 411, A3: 217 };
    const usableW = PAPER_W_MM[paperSize];
    const usableH = PAPER_H_MM[paperSize];
    const PRESETS: number[] = [500, 1000, 2000, 5000];
    let pick: number | null = null;
    for (const N of PRESETS) {
      const maxW = (usableW * N) / 1000;
      const maxH = (usableH * N) / 1000;
      if (maxW >= fitW && maxH >= fitH) { pick = N; break; }
    }
    if (!pick) pick = 5000; // groter dan 5000m × 2.5 = onwaarschijnlijk
    // Pan + set scale; de scale-effect (deps [paperSize, scale, mapReady])
    // past het map-zoomniveau aan zodat 1:N exact uitkomt.
    map.panTo([ll[1], ll[0]], { animate: false });
    if (pick !== scale) setScale(pick);
    setMapReady((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, activeDocId, paperSize, mapReady]);

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

  useEffect(() => {
    drawModeRef.current = drawMode;
    // Reset the in-flight start point whenever the tool toggles off,
    // en ruim de rubber-band preview op.
    if (!drawMode) {
      drawStartRef.current = null;
      drawPreviewLayerRef.current?.clearLayers();
    }
  }, [drawMode]);

  // Map-mousemove handler: registreert cursor-positie + verzorgt move-
  // mode (M/G-shortcut). De handler zit in een afzonderlijke useEffect
  // op mapRef + moveMode zodat hij her-binden niet de hele map opnieuw
  // initialiseert.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onMM = (e: L.LeafletMouseEvent) => {
      lastMouseLLRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };

      // ── Teken-previews ────────────────────────────────────────
      // Rubber-band: na de 1e draw-klik loopt er live een stippellijn
      // van het startpunt naar de cursor (snap-positie als die er is),
      // met een meter-label bij maatlijnen. Coord-mode: het RD-
      // coördinaat van de cursor volgt live mee, zodat "één klik en
      // hij zit erop" ook visueel klopt.
      const previewCursor = activeSnapRef.current ?? e.latlng;
      const wantsLinePreview = !!drawModeRef.current && !!drawStartRef.current;
      const wantsCoordPreview = !!coordModeRef.current;
      if (wantsLinePreview || wantsCoordPreview) {
        if (!drawPreviewLayerRef.current) {
          drawPreviewLayerRef.current = L.layerGroup().addTo(map);
        }
        const layer = drawPreviewLayerRef.current;
        layer.clearLayers();
        if (wantsLinePreview) {
          const start = drawStartRef.current!;
          const isDim = drawModeRef.current === "dimension";
          layer.addLayer(
            L.polyline(
              [[start.lat, start.lon], [previewCursor.lat, previewCursor.lng]],
              {
                color: isDim ? "#d97706" : "#36363e",
                weight: 1.6,
                opacity: 0.8,
                dashArray: "6 5",
                interactive: false,
              },
            ),
          );
          if (isDim) {
            const dist = map.distance(
              [start.lat, start.lon],
              [previewCursor.lat, previewCursor.lng],
            );
            const mid = L.latLng(
              (start.lat + previewCursor.lat) / 2,
              (start.lon + previewCursor.lng) / 2,
            );
            const lbl = dist < 1 ? `${(dist * 100).toFixed(0)} cm`
              : dist < 1000 ? `${dist.toFixed(2)} m`
              : `${(dist / 1000).toFixed(2)} km`;
            layer.addLayer(
              L.marker(mid, {
                icon: L.divIcon({
                  className: "tek-dim-label tek-dim-label-preview",
                  html: `<span>${lbl}</span>`,
                  iconSize: [160, 36],
                  iconAnchor: [80, 18],
                }),
                interactive: false,
              }),
            );
          }
        }
        if (wantsCoordPreview) {
          const [xRd, yRd] = WGS84_TO_RD.forward([
            previewCursor.lng,
            previewCursor.lat,
          ]);
          layer.addLayer(
            L.marker(previewCursor, {
              icon: L.divIcon({
                className: "tek-coord-preview",
                html: `<span>${xRd.toFixed(2)} / ${yRd.toFixed(2)}</span>`,
                iconSize: [180, 20],
                iconAnchor: [-10, 24],
              }),
              interactive: false,
            }),
          );
        }
      } else if (drawPreviewLayerRef.current) {
        drawPreviewLayerRef.current.clearLayers();
      }

      const mm = moveModeRef.current;
      const anchor = moveAnchorRef.current;
      if (!mm || !anchor) return;
      const dLat = e.latlng.lat - anchor.anchorLat;
      const dLon = e.latlng.lng - anchor.anchorLon;
      if (mm.kind === "overlay") {
        setOverlay((ov) =>
          ov && ov.id === mm.id
            ? { ...ov, centerLat: anchor.origin.centerLat + dLat, centerLon: anchor.origin.centerLon + dLon }
            : ov,
        );
      } else if (mm.kind === "marker") {
        setPlaced((prev) => prev.map((p) =>
          p.id === mm.id ? { ...p, lat: anchor.origin.lat + dLat, lon: anchor.origin.lon + dLon } : p,
        ));
      } else if (mm.kind === "line") {
        setDrawnLines((prev) => prev.map((l) =>
          l.id === mm.id
            ? {
                ...l,
                lat1: anchor.origin.lat1 + dLat, lon1: anchor.origin.lon1 + dLon,
                lat2: anchor.origin.lat2 + dLat, lon2: anchor.origin.lon2 + dLon,
              }
            : l,
        ));
      } else if (mm.kind === "raster") {
        setRasters((prev) => prev.map((r) =>
          r.id === mm.id
            ? { ...r, centerLat: anchor.origin.centerLat + dLat, centerLon: anchor.origin.centerLon + dLon }
            : r,
        ));
      }
    };
    const onClick = () => {
      // Klik in move-modus = commit (positie blijft staan zoals nu).
      if (moveModeRef.current) {
        moveAnchorRef.current = null;
        setMoveMode(null);
      }
    };
    map.on("mousemove", onMM);
    map.on("click", onClick);
    return () => {
      map.off("mousemove", onMM);
      map.off("click", onClick);
    };
  }, [mapReady]);

  // Sync snap-target refs zodat de mousemove-snap-handler altijd live
  // state ziet (handler zit in een [] -deps init-effect closure).
  useEffect(() => {
    placedRef.current = placed;
  }, [placed]);
  useEffect(() => {
    drawnLinesRef.current = drawnLines;
  }, [drawnLines]);
  useEffect(() => {
    coordTagsRef.current = coordTags;
  }, [coordTags]);
  useEffect(() => {
    projectRef.current = project ? { cpts: project.cpts } : null;
  }, [project]);

  // Mirror cadMode → ref zodat de map-click handler (in mapInitEffect
  // met [] deps) altijd de actuele tool kent. Bij uitschakelen ook de
  // step-state wissen — anders blijft een halve trim/mirror "open" als
  // de gebruiker tussendoor een andere tool kiest.
  useEffect(() => {
    cadModeRef.current = cadMode;
    if (!cadMode) cadStepRef.current = null;
  }, [cadMode]);

  // ── CAD-toetsencombinaties: TR = trim, RO = roteer +90°, MV = move ─
  // Twee losse toetsen binnen 800 ms (AutoCAD-stijl commando's). "M"
  // start move-modus al direct (zie M/G-shortcut), dus MV werkt sowieso;
  // we vangen hem hier expliciet zodat de "V" geen bijeffect heeft.
  useEffect(() => {
    let prev: { key: string; t: number } | null = null;
    const CHORDS: Record<string, () => void> = {
      tr: () => window.dispatchEvent(new CustomEvent("ogs:tekening-cad-trim")),
      ro: () =>
        window.dispatchEvent(
          new CustomEvent("ogs:tekening-rotate", { detail: { deg: 90 } }),
        ),
      // mv: geen actie nodig — "m" heeft move-modus dan al gestart.
      mv: () => {},
    };
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k.length !== 1 || !/[a-z]/.test(k)) { prev = null; return; }
      const now = Date.now();
      if (prev && now - prev.t < 800) {
        const chord = prev.key + k;
        const fire = CHORDS[chord];
        if (fire) {
          e.preventDefault();
          fire();
          prev = null;
          return;
        }
      }
      prev = { key: k, t: now };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Render freehand lines + dimensions ──────────────────────
  useEffect(() => {
    const layer = drawnLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const ln of drawnLines) {
      // Lijn dikker + amber wanneer geselecteerd zodat de gebruiker
      // visueel feedback krijgt na een klik in select-mode of na een
      // mirror/offset-source-keuze.
      const isSelected = selection?.kind === "line" && selection.id === ln.id;
      const baseColor = ln.color
        ?? (ln.kind === "dimension" ? "#d97706" : "#36363e");
      const line = L.polyline(
        [[ln.lat1, ln.lon1], [ln.lat2, ln.lon2]],
        {
          color: isSelected ? "#d97706" : baseColor,
          weight: isSelected ? 3.2 : 2,
          opacity: 0.9,
          // De zichtbare lijn vangt zelf geen kliks meer — dat doet de
          // brede onzichtbare hit-lijn hieronder. Een 2px-stroke was
          // vrijwel niet aan te klikken, waardoor trim/extend/offset en
          // selecteren "niet leken te werken".
          interactive: false,
        },
      );
      const hitLine = L.polyline(
        [[ln.lat1, ln.lon1], [ln.lat2, ln.lon2]],
        { color: "#000", weight: 14, opacity: 0.001, interactive: true },
      );
      hitLine.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        // CAD-tools onderscheppen de lijn-klik VOOR de normale
        // select-flow. Het klikpunt zelf hebben we nodig (vooral voor
        // trim: welke kant van het snijpunt moet weg?) — Leaflet geeft
        // dat via ev.latlng.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const evAny = ev as L.LeafletMouseEvent;
        const clickLat = evAny.latlng?.lat ?? ln.lat1;
        const clickLon = evAny.latlng?.lng ?? ln.lon1;
        const cad = cadModeRef.current;
        if (cad === "trim" || cad === "extend") {
          handleCadLineClickRef.current?.(cad, ln.id, clickLat, clickLon);
          return;
        }
        if (cad === "offset") {
          // Bron-lijn voor offset gekozen — vraag direct de afstand
          // en bewaar in step-state; volgende klik op de kaart bepaalt
          // de zijde.
          const raw = window.prompt(
            "Offset-afstand in meters? (positief getal)",
            "1",
          );
          if (raw === null) return;
          const dist = parseFloat(raw.replace(",", "."));
          if (!Number.isFinite(dist) || dist <= 0) return;
          cadStepRef.current = { kind: "offset-hint", lineId: ln.id, dist };
          setToast(
            `Offset ${dist} m — klik aan de zijde waar de kopie moet komen`,
          );
          setTimeout(() => setToast(null), 3500);
          return;
        }
        // Default-gedrag: selecteer de lijn (i.p.v. direct verwijderen
        // — Delete-toets / ribbon-knop wist 'm). Komt overeen met hoe
        // markers / rasters reageren.
        setSelection({ kind: "line", id: ln.id });
      });
      layer.addLayer(line);
      layer.addLayer(hitLine);
      if (ln.kind === "dimension") {
        // Compute great-circle distance in metres + render a small
        // amber label at the midpoint.
        const mapInst = mapRef.current;
        if (mapInst) {
          const dist = mapInst.distance([ln.lat1, ln.lon1], [ln.lat2, ln.lon2]);
          const mid = L.latLng((ln.lat1 + ln.lat2) / 2, (ln.lon1 + ln.lon2) / 2);
          const distLbl = dist < 1
            ? `${(dist * 100).toFixed(0)} cm`
            : dist < 1000
              ? `${dist.toFixed(2)} m`
              : `${(dist / 1000).toFixed(2)} km`;
          const label = L.marker(mid, {
            icon: L.divIcon({
              className: "tek-dim-label",
              html: `<span>${distLbl}</span>`,
              iconSize: [160, 36], /* 2× — gebruiker-verzoek */
              iconAnchor: [80, 18],
            }),
            interactive: false,
          });
          layer.addLayer(label);
          // Add small tick marks at each end perpendicular to the line.
          const tick = (lat: number, lon: number) =>
            L.circleMarker([lat, lon], {
              radius: 4,
              color: "#d97706",
              weight: 2,
              fillColor: "#fff",
              fillOpacity: 1,
              interactive: false,
            });
          layer.addLayer(tick(ln.lat1, ln.lon1));
          layer.addLayer(tick(ln.lat2, ln.lon2));
        }
      }
    }
  }, [drawnLines, selection]);

  // ── CAD line-click bridge ────────────────────────────────────
  // De lijn-render-effect maakt per render een verse `line.on("click")`
  // closure. Om de trim/extend-logica (die afhangt van actuele state)
  // niet bij elke render opnieuw te hoeven schrijven, parkeren we de
  // handler in een ref. Het render-effect leest `handleCadLineClickRef.current`
  // op event-time, dus de laatst-gezette closure wint.
  const handleCadLineClickRef = useRef<
    | ((mode: "trim" | "extend", lineId: string, clickLat: number, clickLon: number) => void)
    | null
  >(null);
  useEffect(() => {
    handleCadLineClickRef.current = (mode, lineId, clickLat, clickLon) => {
      const step = cadStepRef.current;
      // Stap 1 — referentielijn kiezen.
      if (!step || (step.kind !== "trim-ref" && step.kind !== "extend-ref")) {
        cadStepRef.current =
          mode === "trim"
            ? { kind: "trim-ref", refLineId: lineId }
            : { kind: "extend-ref", refLineId: lineId };
        setToast(
          mode === "trim"
            ? "Trim — klik nu de lijn die geknipt moet worden (het deel waar je klikt valt weg)"
            : "Extend — klik nu het uiteinde van de lijn dat verlengd moet worden",
        );
        setTimeout(() => setToast(null), 4500);
        return;
      }
      // Stap 2 — doel-lijn kiezen. Mag niet dezelfde zijn als de
      // referentielijn (anders snijdt hij met zichzelf en krijg je
      // geen zinvol resultaat).
      const refId = step.refLineId;
      if (lineId === refId) {
        setToast("Kies een andere lijn dan de referentielijn");
        setTimeout(() => setToast(null), 2400);
        return;
      }
      const refLine = drawnLines.find((l) => l.id === refId);
      const tgtLine = drawnLines.find((l) => l.id === lineId);
      if (!refLine || !tgtLine) {
        cadStepRef.current = null;
        return;
      }
      const refA = llToRd(refLine.lat1, refLine.lon1);
      const refB = llToRd(refLine.lat2, refLine.lon2);
      const tgtA = llToRd(tgtLine.lat1, tgtLine.lon1);
      const tgtB = llToRd(tgtLine.lat2, tgtLine.lon2);
      const inter = lineIntersectionRd(refA, refB, tgtA, tgtB);
      if (!inter) {
        setToast("Lijnen zijn parallel — geen snijpunt");
        setTimeout(() => setToast(null), 2800);
        cadStepRef.current = null;
        setCadMode(null);
        return;
      }
      const clickRd = llToRd(clickLat, clickLon);
      if (mode === "trim") {
        // Knip op het snijpunt. Twee scenario's:
        //  (a) snijpunt valt BINNEN het target-segment (0 ≤ u ≤ 1)
        //      → splits het in twee delen, gooi het deel weg waar
        //      de gebruiker klikte.
        //  (b) snijpunt valt BUITEN het target-segment → niets te
        //      knippen (trim doet niets als de lijnen elkaar niet
        //      écht raken). Toast + reset.
        if (inter.u < 0.001 || inter.u > 0.999) {
          setToast(
            "Snijpunt ligt buiten de lijn — trim doet hier niets (gebruik Extend om eerst te verlengen)",
          );
          setTimeout(() => setToast(null), 4200);
          cadStepRef.current = null;
          setCadMode(null);
          return;
        }
        // Bepaal welke kant van het snijpunt de gebruiker aanklikte.
        // Projecteer de klik op de target-lijn (param tHit langs
        // tgtA→tgtB) en vergelijk met inter.u.
        const tgtDx = tgtB[0] - tgtA[0];
        const tgtDy = tgtB[1] - tgtA[1];
        const tgtLen2 = tgtDx * tgtDx + tgtDy * tgtDy;
        const tHitNum = tgtLen2 > 0
          ? ((clickRd[0] - tgtA[0]) * tgtDx + (clickRd[1] - tgtA[1]) * tgtDy) /
            tgtLen2
          : 0;
        const interLL = rdToLl(inter.p);
        // Houd het deel ZONDER de klik. Als de klik vóór het snijpunt
        // ligt (tHit < u) blijft het deel ná het snijpunt (u → 1)
        // bestaan; anders andersom.
        const replacement: DrawnLine =
          tHitNum < inter.u
            ? { ...tgtLine, lat1: interLL.lat, lon1: interLL.lon }
            : { ...tgtLine, lat2: interLL.lat, lon2: interLL.lon };
        setDrawnLines((prev) =>
          prev.map((l) => (l.id === tgtLine.id ? replacement : l)),
        );
        setToast("Lijn getrimd");
        setTimeout(() => setToast(null), 1800);
      } else {
        // EXTEND — verleng het endpoint van de target dat het dichtst
        // bij de klik ligt, tot aan de oneindige referentielijn. Het
        // snijpunt zit per definitie op de referentie-lijn; we passen
        // alleen het endpoint aan dat verlengd moet worden.
        const distA = Math.hypot(clickRd[0] - tgtA[0], clickRd[1] - tgtA[1]);
        const distB = Math.hypot(clickRd[0] - tgtB[0], clickRd[1] - tgtB[1]);
        const interLL = rdToLl(inter.p);
        const patch: Partial<DrawnLine> =
          distA < distB
            ? { lat1: interLL.lat, lon1: interLL.lon }
            : { lat2: interLL.lat, lon2: interLL.lon };
        setDrawnLines((prev) =>
          prev.map((l) => (l.id === tgtLine.id ? { ...l, ...patch } : l)),
        );
        setToast("Lijn verlengd tot referentielijn");
        setTimeout(() => setToast(null), 1800);
      }
      // Tool reset — gebruiker moet voor een volgende trim/extend
      // opnieuw de knop indrukken. Voorkomt per-ongeluk-knippen.
      cadStepRef.current = null;
      setCadMode(null);
    };
  }, [drawnLines]);

  // Bridge voor mirror + offset-hint, beide click op de map (geen
  // specifieke lijn). Net als de line-click-bridge in een ref zodat
  // de map.on("click") closure de actuele state ziet.
  const handleCadMapClickRef = useRef<
    | ((mode: "mirror" | "offset", lat: number, lon: number) => void)
    | null
  >(null);
  useEffect(() => {
    handleCadMapClickRef.current = (mode, lat, lon) => {
      if (mode === "mirror") {
        // Vereist een geselecteerde lijn als bron — anders heeft
        // spiegelen geen object om op te werken (markers / rasters
        // worden niet ondersteund in v1, voorkomt extra UX-complexiteit).
        const sel = selectionRef.current;
        if (!sel || sel.kind !== "line") {
          setToast(
            "Selecteer eerst een lijn (klik er op) voordat je Mirror gebruikt",
          );
          setTimeout(() => setToast(null), 3500);
          return;
        }
        const step = cadStepRef.current;
        if (!step || step.kind !== "mirror-axis") {
          // Eerste klik — zet eerste-aspunt.
          cadStepRef.current = { kind: "mirror-axis", lat, lon };
          setToast("Mirror — klik nu het tweede punt van de spiegelas");
          setTimeout(() => setToast(null), 3000);
          return;
        }
        // Tweede klik — completeer de as en spiegel de geselecteerde
        // lijn. Beide endpoints worden via mirrorPointRd over de as
        // (in RD) gereflecteerd; resultaat overschrijft de oude lijn
        // (in v1; voor een kopie kan de gebruiker eerst Kopiëren
        // gebruiken en daarna Mirror).
        const line = drawnLines.find((l) => l.id === sel.id);
        if (!line) {
          cadStepRef.current = null;
          setCadMode(null);
          return;
        }
        const axisA = llToRd(step.lat, step.lon);
        const axisB = llToRd(lat, lon);
        const p1 = mirrorPointRd(llToRd(line.lat1, line.lon1), axisA, axisB);
        const p2 = mirrorPointRd(llToRd(line.lat2, line.lon2), axisA, axisB);
        const p1LL = rdToLl(p1);
        const p2LL = rdToLl(p2);
        setDrawnLines((prev) =>
          prev.map((l) =>
            l.id === line.id
              ? {
                  ...l,
                  lat1: p1LL.lat, lon1: p1LL.lon,
                  lat2: p2LL.lat, lon2: p2LL.lon,
                }
              : l,
          ),
        );
        setToast("Lijn gespiegeld over de as");
        setTimeout(() => setToast(null), 1800);
        cadStepRef.current = null;
        setCadMode(null);
        return;
      }
      // OFFSET hint-klik — zoek de eerder gekozen bron-lijn op,
      // bepaal de zijde door het kruisproduct met de klikpositie,
      // en maak een nieuwe parallel-lijn met een verse id.
      if (mode === "offset") {
        const step = cadStepRef.current;
        if (!step || step.kind !== "offset-hint") {
          setToast("Offset — klik eerst op een lijn om de bron te kiezen");
          setTimeout(() => setToast(null), 3000);
          return;
        }
        const src = drawnLines.find((l) => l.id === step.lineId);
        if (!src) {
          cadStepRef.current = null;
          setCadMode(null);
          return;
        }
        const a = llToRd(src.lat1, src.lon1);
        const b = llToRd(src.lat2, src.lon2);
        const click = llToRd(lat, lon);
        const side = sideOfLineRd(click, a, b);
        // sideOfLineRd geeft 0 als de klik exact op de lijn ligt —
        // val terug op +1 (links) zodat er ALTIJD een resultaat komt
        // in plaats van een ongedefinieerde no-op.
        const dir: 1 | -1 = side === -1 ? -1 : 1;
        const off = offsetLineRd(a, b, step.dist, dir);
        const aLL = rdToLl(off.a);
        const bLL = rdToLl(off.b);
        setDrawnLines((prev) => {
          const sameKindCount = prev.filter((p) => p.kind === src.kind).length;
          const prefix = src.kind === "dimension" ? "D" : "L";
          const newId = `${prefix}${String(sameKindCount + 1).padStart(2, "0")}`;
          return [
            ...prev,
            {
              id: newId,
              kind: src.kind,
              lat1: aLL.lat, lon1: aLL.lon,
              lat2: bLL.lat, lon2: bLL.lon,
            },
          ];
        });
        setToast(`Parallel-lijn op ${step.dist} m geplaatst`);
        setTimeout(() => setToast(null), 1800);
        cadStepRef.current = null;
        setCadMode(null);
      }
    };
  }, [drawnLines]);

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
        {
          attribution: "BGT © Geonovum / Kadaster | PDOK",
          maxZoom: 24,
          maxNativeZoom: 20,
          opacity: 0.85,
        },
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
        // Snap-cache leegmaken zodat de mousemove-handler geen
        // ghost-snaps op de oude features doet nadat de gebruiker
        // de laag heeft uitgezet.
        snapBagFeaturesRef.current = [];
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
        snapKadasterFeaturesRef.current = [];
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
      // Gebouw-contour BLAUW (was rood) — de boring-markers zijn rood,
      // dus een rode gebouw-omtrek liep daarmee door elkaar. Blauw geeft
      // een duidelijk onderscheid tussen bebouwing en sonderingen/boringen.
      style: () => ({
        color: "#2563EB",
        weight: 1.1,
        fillColor: "rgb(192,192,192)",
        fillOpacity: 0.85,
        opacity: 0.95,
      }),
    }).addTo(layer);
    // Snap-cache: bewaar alleen polygon-features (de enige geometrie
    // waarop vertex/edge-snap zin heeft) zodat de mousemove-handler
    // niet bij elke beweging hoeft te filteren.
    snapBagFeaturesRef.current = (fc.features ?? []).filter(
      (f) =>
        f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
    );
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
    snapKadasterFeaturesRef.current = (fc.features ?? []).filter(
      (f) =>
        f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
    );
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

  // ── WFS-snap: mousemove → cursor "magnetisch" aan polygon-hoeken ─
  //
  // Wanneer de gebruiker in een place-mode is (sondering / boring /
  // coord-tag / draw-line / draw-dimension) EN minstens één van BAG /
  // Kadaster aan staat, scannen we bij elke mouse-move alle features
  // in de snap-cache (zie reloadBagOverlay / reloadKadasterOverlay)
  // en zoeken het dichtsbijzijnde snap-punt — zowel polygon-vertices
  // (hoeken) als loodrechte projecties op polygon-edges (de "snap
  // aan rand"-variant). De cursor "klikt vast" wanneer de pixel-
  // afstand onder de SNAP_THRESHOLD ligt.
  //
  // Performance: mousemove kan honderden keren per seconde vuren
  // op snelle hardware. We throttlen via requestAnimationFrame zodat
  // de scan max één keer per frame (≈ 60 Hz) gebeurt. Voor v1 scannen
  // we ALLE polygonen die de WFS-fetch heeft teruggegeven; bij een
  // typische A2-zoom is dat enkele tientallen / honderden — prima
  // voor één frame. Bij grotere sets is een RBush-spatial-index een
  // logische v2-stap.
  //
  // Snap is ALLEEN actief als er ook iets te plaatsen is — anders zou
  // de oranje cirkel constant flikkeren tijdens normaal pan/zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const SNAP_THRESHOLD_PX = 12;
    let rafId: number | null = null;
    let pendingEvent: L.LeafletMouseEvent | null = null;

    const clearSnap = () => {
      const layer = snapLayerRef.current;
      if (layer && snapMarkerRef.current) {
        layer.removeLayer(snapMarkerRef.current);
        snapMarkerRef.current = null;
      }
      activeSnapRef.current = null;
    };

    /**
     * Loodrechte projectie van punt p op het segment [a, b], in
     * container-pixel-ruimte (Leaflet's `L.Point`). Geeft ook terug
     * of het projectie-punt BINNEN het segment valt (anders is de
     * dichtsbijzijnde punt een endpoint — die telt al als vertex).
     */
    const projectOnSegment = (
      p: L.Point,
      a: L.Point,
      b: L.Point,
    ): { point: L.Point; dist: number; inside: boolean } | null => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 <= 0.0001) return null;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      const inside = t >= 0 && t <= 1;
      const cx = a.x + t * dx;
      const cy = a.y + t * dy;
      const ex = p.x - cx;
      const ey = p.y - cy;
      return { point: L.point(cx, cy), dist: Math.hypot(ex, ey), inside };
    };

    /**
     * Itereer alle linear-rings (Polygon = 1+ rings, MultiPolygon =
     * lijst van polygons) en voeg ze als een vlakke lijst van
     * coord-arrays toe. Eerste ring = buitencontour, rest = gaten —
     * voor snap-doeleinden behandelen we ze allemaal hetzelfde.
     */
    const collectRings = (feat: GeoJSON.Feature): GeoJSON.Position[][] => {
      const out: GeoJSON.Position[][] = [];
      const g = feat.geometry;
      if (!g) return out;
      if (g.type === "Polygon") {
        for (const r of g.coordinates) out.push(r);
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) for (const r of poly) out.push(r);
      }
      return out;
    };

    const runSnap = () => {
      rafId = null;
      const ev = pendingEvent;
      pendingEvent = null;
      if (!ev) return;

      // Snap is alleen relevant als er ook een actieve plaatsing-mode
      // is — anders zou de marker tijdens gewoon pan/zoom flikkeren.
      const inPlaceMode =
        !!placeModeRef.current ||
        !!coordModeRef.current ||
        !!drawModeRef.current ||
        // CAD-tools die op de map klikken — mirror-asklik en offset-
        // hint-klik — profiteren ook van WFS-snap zodat een
        // spiegelas perfect op een perceel-hoek kan eindigen.
        cadModeRef.current === "mirror" ||
        cadModeRef.current === "offset";
      if (!inPlaceMode) {
        if (activeSnapRef.current) clearSnap();
        return;
      }

      const bagOn = !!bagLayerRef.current && map.hasLayer(bagLayerRef.current);
      const kadOn =
        !!kadasterLayerRef.current && map.hasLayer(kadasterLayerRef.current);
      // GEEN early-return meer wanneer BAG/Kadaster uit zijn — we
      // willen óók snappen aan geplaatste sonderingen + line-endpoints
      // zelfs zonder WFS-overlay aan.

      const candidates: GeoJSON.Feature[] = [];
      if (bagOn) candidates.push(...snapBagFeaturesRef.current);
      if (kadOn) candidates.push(...snapKadasterFeaturesRef.current);
      // GEEN early-return meer wanneer er geen BAG/Kadaster features
      // zijn — we willen ook snappen aan geplaatste sonderingen/
      // boringen, project-CPTs en line-endpoints (gebruiker-verzoek).

      const cursor = ev.containerPoint;
      const bounds = map.getBounds();
      let best: { latlng: L.LatLng; dist: number } | null = null;

      // ── EXTRA snap-targets: geplaatste sonderingen + project-CPTs +
      //    lijn-endpoints. Gebruiker wil dat een RD-coord-klik op een
      //    sondering exact naar die sondering-positie snapt, en dat
      //    lijnen aan elkaar (en aan sonderingen) snappen.
      const considerPoint = (lat: number, lon: number) => {
        // Skip duidelijk buiten viewport — bespaart pixel-converts.
        if (
          lon < bounds.getWest() - 0.001 ||
          lon > bounds.getEast() + 0.001 ||
          lat < bounds.getSouth() - 0.001 ||
          lat > bounds.getNorth() + 0.001
        ) {
          return;
        }
        const ll = L.latLng(lat, lon);
        const px = map.latLngToContainerPoint(ll);
        const d = Math.hypot(px.x - cursor.x, px.y - cursor.y);
        if (d < SNAP_THRESHOLD_PX && (!best || d < best.dist)) {
          best = { latlng: ll, dist: d };
        }
      };
      // Geplaatste sonderingen + boringen
      for (const p of placedRef.current ?? []) {
        considerPoint(p.lat, p.lon);
      }
      // Project-CPT-markers (uit de actieve project-tab; via ref zodat
      // de [] -deps closure live waarden ziet).
      for (const cpt of projectRef.current?.cpts ?? []) {
        if (!cpt.position) continue;
        const ll = WGS84_TO_RD.inverse([cpt.position.x_rd, cpt.position.y_rd]);
        considerPoint(ll[1], ll[0]);
      }
      // Lijn-endpoints (zowel start- als eindpunt van elke getrokken lijn)
      for (const l of drawnLinesRef.current ?? []) {
        considerPoint(l.lat1, l.lon1);
        considerPoint(l.lat2, l.lon2);
      }
      // Coord-tag-posities — ook handig om RD-tags op exact dezelfde
      // plek te kunnen herplaatsen.
      for (const c of coordTagsRef.current ?? []) {
        considerPoint(c.lat, c.lon);
      }

      for (const feat of candidates) {
        for (const ring of collectRings(feat)) {
          // Vertex- + edge-snap in één pass.
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i];
            // Skip vertices buiten het zichtbare gebied — die zijn
            // bijna nooit interessant en sparen pixel-converts.
            if (
              lon < bounds.getWest() - 0.001 ||
              lon > bounds.getEast() + 0.001 ||
              lat < bounds.getSouth() - 0.001 ||
              lat > bounds.getNorth() + 0.001
            ) {
              continue;
            }
            const ll = L.latLng(lat, lon);
            const px = map.latLngToContainerPoint(ll);
            const d = Math.hypot(px.x - cursor.x, px.y - cursor.y);
            if (d < SNAP_THRESHOLD_PX && (!best || d < best.dist)) {
              best = { latlng: ll, dist: d };
            }
            // Edge-snap: loodrechte projectie op segment [i, i+1].
            if (i < ring.length - 1) {
              const [lon2, lat2] = ring[i + 1];
              const ll2 = L.latLng(lat2, lon2);
              const px2 = map.latLngToContainerPoint(ll2);
              const proj = projectOnSegment(cursor, px, px2);
              if (
                proj &&
                proj.inside &&
                proj.dist < SNAP_THRESHOLD_PX &&
                (!best || proj.dist < best.dist)
              ) {
                best = {
                  latlng: map.containerPointToLatLng(proj.point),
                  dist: proj.dist,
                };
              }
            }
          }
        }
      }

      if (!best) {
        if (activeSnapRef.current) clearSnap();
        return;
      }

      const layer = snapLayerRef.current;
      if (!layer) return;
      // Hergebruik bestaande marker indien al gerenderd — `setLatLng`
      // is goedkoper dan opnieuw bouwen + addTo.
      if (snapMarkerRef.current) {
        snapMarkerRef.current.setLatLng(best.latlng);
      } else {
        const m = L.marker(best.latlng, {
          icon: L.divIcon({
            className: "tek-snap-marker",
            html: `<div class="tek-snap-marker-inner"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
          interactive: false,
          keyboard: false,
        });
        layer.addLayer(m);
        snapMarkerRef.current = m;
      }
      activeSnapRef.current = best.latlng;
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      pendingEvent = e;
      // requestAnimationFrame throttle — max één scan per render-frame
      // (≈ 16 ms / 60 FPS), wat ruim onder de 33 ms / 30 FPS-target uit
      // de spec ligt en visueel vloeiend aanvoelt zonder de CPU te
      // sloopen op laptop-trackpad-bursts.
      if (rafId !== null) return;
      rafId = requestAnimationFrame(runSnap);
    };
    const onMouseOut = () => {
      // Cursor verlaat de kaart-container — snap altijd uit zodat de
      // marker niet "blijft hangen" op de laatste snap-positie.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingEvent = null;
      if (activeSnapRef.current) clearSnap();
    };
    const onMoveEnd = () => {
      // Polygon pixel-posities veranderen na pan/zoom — oude snap-
      // marker is dan niet meer accuraat. Wis 'm; de volgende
      // mousemove rebuilt op het nieuwe viewport.
      if (activeSnapRef.current) clearSnap();
    };

    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("moveend", onMoveEnd);
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearSnap();
    };
  }, []);

  // The legacy base-layer dropdown is gone — base/overlay toggles are
  // now driven by the GisLayerPanel sidebar via `ogs:layer-toggle`
  // events (see the init effect above). This effect is intentionally
  // empty so `baseLayerKey` is preserved purely for back-compat if
  // any older code still reads it.

  // ── Render RD-coordinate tags ─────────────────────────────────
  // Callout-style layout: een markerpunt op de exacte lat/lon, dan
  // een schuine leader-lijn naar een tekstkader rechtsboven met de
  // RD-coördinaten. iconAnchor zit op het puntje van de leader zodat
  // de tag visueel op de juiste plek "hangt", ook bij zoomwisselingen.
  useEffect(() => {
    const layer = coordLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    // Layout-constanten — handgekozen zodat het kader naast het punt
    // staat zonder erop te overlappen, en de leader een natuurlijke
    // 30-45° hoek krijgt. Alle pixel-waardes 2× — gebruiker-verzoek
    // RD-coordinaat 2x zo groot.
    const W = 300;
    const H = 112;
    const dotX = 8;
    const dotY = H - 8;
    const leaderEndX = 68;
    const leaderEndY = 28;
    const boxX = leaderEndX;
    const boxY = 4;
    const boxW = W - boxX - 4;
    for (const t of coordTags) {
      const [x, y] = WGS84_TO_RD.forward([t.lon, t.lat]);
      const html =
        `<div class="tek-coord-tag" style="width:${W}px;height:${H}px;position:relative;">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;inset:0;pointer-events:none;">
            <line x1="${dotX}" y1="${dotY}" x2="${leaderEndX}" y2="${leaderEndY}"
                  stroke="#7c2d12" stroke-width="2.6" />
            <circle cx="${dotX}" cy="${dotY}" r="6.4"
                    fill="#d97706" stroke="#7c2d12" stroke-width="2.4" />
          </svg>
          <div class="tek-coord-text" style="position:absolute;left:${boxX}px;top:${boxY}px;width:${boxW}px;">
            <strong>x:</strong> ${x.toFixed(1)}<br>
            <strong>y:</strong> ${y.toFixed(1)}
            ${t.label ? `<br><em>${t.label}</em>` : ""}
          </div>
        </div>`;
      const m = L.marker([t.lat, t.lon], {
        icon: L.divIcon({
          className: "tek-coord-icon",
          html,
          iconSize: [W, H],
          // Anchor on the dot so the tag stays on the actual point.
          iconAnchor: [dotX, dotY],
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
      overlayAspectRef.current = aspect;
      const heightM = widthM * aspect;
      const [cxRd, cyRd] = WGS84_TO_RD.forward([cLon, cLat]);
      const swLL = WGS84_TO_RD.inverse([cxRd - widthM / 2, cyRd - heightM / 2]);
      const neLL = WGS84_TO_RD.inverse([cxRd + widthM / 2, cyRd + heightM / 2]);
      const bounds = L.latLngBounds(
        L.latLng(swLL[1], swLL[0]),
        L.latLng(neLL[1], neLL[0]),
      );
      const isSelected =
        selection?.kind === "overlay" && selection.id === overlay.id;
      const fgClass = overlayInForeground ? " tek-overlay-foreground" : "";
      const ov = L.imageOverlay(overlay.src!, bounds, {
        opacity: 0.92,
        interactive: true,
        className: (isSelected ? "tek-overlay-img selected" : "tek-overlay-img") + fgClass,
      });
      ov.on("click", (e) => {
        // While the user is in a draw / place / coord mode, the click
        // is meant for the map (start/end point of a line, place a new
        // sondering, drop an RD-tag). Let it bubble through to the
        // map.on("click") handler instead of selecting the overlay.
        if (drawModeRef.current || placeModeRef.current || coordModeRef.current) {
          return;
        }
        L.DomEvent.stopPropagation(e);
        setSelection({ kind: "overlay", id: overlay.id });
      });
      ov.addTo(map);
      overlayLayerRef.current = ov;
    };
    img.src = overlay.src;
  }, [overlay, selection, overlayInForeground]);

  // Reset overlay-rotatie wanneer de gebruiker een NIEUWE overlay
  // importeert (anders zou de volgende image meteen op de oude hoek
  // staan, wat verwarrend is).
  useEffect(() => {
    setOverlayRotation(0);
  }, [overlay?.id]);

  // Pas overlay-rotatie toe via CSS transform op het Leaflet <img>
  // element. L.ImageOverlay heeft .getElement() dat het onderliggende
  // DOM-element teruggeeft. We forceren transform-origin: center zodat
  // de afbeelding om zijn middelpunt draait, niet om de bounds-hoek.
  useEffect(() => {
    const ov = overlayLayerRef.current;
    if (!ov) return;
    const el = ov.getElement();
    if (!el) return;
    el.style.transform = `rotate(${overlayRotation}deg)`;
    el.style.transformOrigin = "center center";
  }, [overlayRotation, overlay?.id]);

  // ── DEV-only: expose setOverlay + setSelection + useCptStore op
  // window zodat de Claude-Preview MCP een test-overlay/project kan
  // injecteren tijdens E2E-verificatie. In productie strip Vite deze
  // block via dead-code elimination (`import.meta.env.DEV === false`).
  // Pure debug-hulp, niets functioneels voor de eindgebruiker.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __ogsTestSetOverlay?: (o: OverlayDrop | null) => void;
      __ogsTestSetSelection?: (s: { kind: "overlay"; id: string } | null) => void;
      __ogsTestStore?: typeof useCptStore;
    };
    w.__ogsTestSetOverlay = setOverlay;
    w.__ogsTestSetSelection = setSelection;
    w.__ogsTestStore = useCptStore;
    return () => {
      delete w.__ogsTestSetOverlay;
      delete w.__ogsTestSetSelection;
      delete w.__ogsTestStore;
    };
  }, []);

  // ── Resize-handles voor geselecteerde image-overlay ─────────────
  // Wanneer de gebruiker de overlay heeft geselecteerd verschijnen er
  // 4 amber hoek-handles + 4 edge-handles op de bounds. Slepen aan
  // een hoek schaalt de overlay proportioneel (de aspect-ratio is
  // vast — afgeleid uit de natural image-dimensies in het init
  // effect). Slepen aan een edge schaalt alleen in die richting (de
  // overlay krijgt dan een eigen aspect-override; voor nu houden we
  // het simpel en passen we widthMeters uniform aan zodat de aspect
  // gerespecteerd blijft).
  useEffect(() => {
    const map = mapRef.current;
    const layer = overlayHandlesLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!overlay || (overlay.kind !== "image" && overlay.kind !== "svg")) return;
    if (selection?.kind !== "overlay" || selection.id !== overlay.id) return;
    const widthM = overlay.widthMeters ?? 100;
    const cLat = overlay.centerLat ?? map.getCenter().lat;
    const cLon = overlay.centerLon ?? map.getCenter().lng;
    const aspect = overlayAspectRef.current || 1;
    const heightM = widthM * aspect;
    const [cxRd, cyRd] = WGS84_TO_RD.forward([cLon, cLat]);

    // Vier hoek-handles op (±halfW, ±halfH) in lokale RD-coords.
    const cornerOffsets: Array<[number, number]> = [
      [-1, -1],
      [+1, -1],
      [+1, +1],
      [-1, +1],
    ];
    for (const [sx, sy] of cornerOffsets) {
      const cornerX = cxRd + (sx * widthM) / 2;
      const cornerY = cyRd + (sy * heightM) / 2;
      const ll = WGS84_TO_RD.inverse([cornerX, cornerY]);
      const handle = L.marker([ll[1], ll[0]], {
        icon: L.divIcon({
          className: "tek-handle tek-handle-corner",
          html: `<div class="tek-handle-dot"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        draggable: true,
      });
      handle.on("dragstart", () => {
        draggingRef.current = true;
        // Kaart-pan hard uit tijdens de handle-drag — anders sleept het
        // hele scherm mee met de resize (gebruiker-klacht).
        try { mapRef.current?.dragging.disable(); } catch { /* noop */ }
      });
      handle.on("drag", (e) => {
        const ll2 = (e as L.LeafletEvent & { latlng: L.LatLng }).latlng;
        const [dragRdX, dragRdY] = WGS84_TO_RD.forward([ll2.lng, ll2.lat]);
        // Nieuwe halve breedte = afstand-x van center; halve hoogte
        // wordt door aspect-ratio bepaald. We dwingen min 2m zodat
        // de overlay niet per ongeluk verdwijnt in 1 sleep-impuls.
        const halfW = Math.max(1, Math.abs(dragRdX - cxRd));
        const halfH = Math.max(1, Math.abs(dragRdY - cyRd));
        // Gebruik de grootste delta zodat slepen aan elke hoek de
        // overlay groeit/krimpt — anders zou diagonaal-slepen alleen
        // de X-component pakken.
        const newWidthM = Math.max(2, 2 * Math.max(halfW, halfH / aspect));
        setOverlay((prev) =>
          prev ? { ...prev, widthMeters: newWidthM } : prev,
        );
      });
      handle.on("dragend", () => {
        draggingRef.current = false;
        try { if (!frozenRef.current) mapRef.current?.dragging.enable(); } catch { /* noop */ }
      });
      handle.on("click", (ev) => L.DomEvent.stopPropagation(ev));
      layer.addLayer(handle);
    }
    // Cleanup gebeurt automatisch wanneer overlay/selection wijzigt
    // — effect re-runt, clearLayers() bovenaan veegt alles weg.
  }, [overlay, selection]);

  // ── Init Leaflet map inside the paper rect ─────────────────────
  useEffect(() => {
    if (!paperRef.current) return;
    // Bepaal de initiële view-positie volgens prioriteit:
    //   1. Project-sonderingen — als het actieve project CPTs met
    //      posities heeft, centreer op het geografisch midden van
    //      die sonderingen. Anders zou de Situatietekening op
    //      Dordrecht openen terwijl de echte sonderingen elders
    //      liggen — gebruiker-verzoek "tekening op dezelfde plek
    //      als de sonderingen".
    //   2. Laatste Kaart-viewport (lastMapView) — wat de gebruiker
    //      het laatst zag op de Kaart-tab.
    //   3. Fallback Lange Geldersekade 2, 3311CJ Dordrecht (home-base).
    const seed = useCptStore.getState().lastMapView;
    const docState = useCptStore.getState();
    const activeDoc = docState.documents.find(
      (d) => d.id === docState.activeDocId,
    );
    let projectCenter: { lat: number; lon: number } | null = null;
    if (activeDoc && activeDoc.kind === "project") {
      const positioned = Array.from(activeDoc.cpts.values()).filter(
        (c) => c.position != null,
      );
      if (positioned.length > 0) {
        // Geografisch midden in RD-meters → terug naar lat/lon.
        // De auto-fit-scale (preset-keuze + zoom) wordt gedaan door een
        // aparte useEffect verderop op `[project, activeDocId, paperSize]`,
        // zodat tab-switches en project-wissels óók opnieuw fitten.
        const meanX =
          positioned.reduce((s, c) => s + c.position!.x_rd, 0) /
          positioned.length;
        const meanY =
          positioned.reduce((s, c) => s + c.position!.y_rd, 0) /
          positioned.length;
        const ll = WGS84_TO_RD.inverse([meanX, meanY]);
        projectCenter = { lat: ll[1], lon: ll[0] };
      }
    } else if (activeDoc && activeDoc.kind === "cpt") {
      // Losse CPT-tab: gebruik direct die positie.
      const pos = activeDoc.cpt.position;
      if (pos) {
        const ll = WGS84_TO_RD.inverse([pos.x_rd, pos.y_rd]);
        projectCenter = { lat: ll[1], lon: ll[0] };
      }
    }
    const startLat = projectCenter?.lat ?? seed?.lat ?? GROTE_KERK_DORDRECHT.lat;
    const startLon = projectCenter?.lon ?? seed?.lon ?? GROTE_KERK_DORDRECHT.lon;
    // Bij project-locatie: relatief ingezoomd zodat alle sonderingen
    // binnen 1:500-papier passen. Anders neem de Kaart-zoom of — als er
    // niets geopend is — de Grote-Kerk-Dordrecht default-zoom.
    const startZoom = projectCenter ? 18 : (seed?.zoom ?? GROTE_KERK_DORDRECHT.zoom);
    const map = L.map(paperRef.current, {
      zoomControl: false,
      attributionControl: false,
      // preferCanvas: FALSE op de Situatietekening — anders worden
      // alle polylines op een groot DOM-canvas getekend dat in dezelfde
      // overlay-pane zit als de image-underlay. Dat canvas vangt elke
      // klik via z-index, waardoor: (a) image-overlay onder canvas niet
      // selecteerbaar is, of (b) als we de image z-index bumpen,
      // polylines onder de image niet meer selecteerbaar zijn. Met SVG-
      // rendering (`preferCanvas: false`) krijgt elke polyline een eigen
      // <path> element met hit-detection op de stroke, zodat clicks op
      // een lijn de lijn raken en clicks naast de lijn doorvallen naar
      // de image. Beide tegelijk selecteerbaar zonder z-index-strijd.
      preferCanvas: false,
      // Vloeiende muiswiel-zoom: `zoomSnap: 0` zet de snap-stepping uit
      // zodat fractionele zoom-niveaus worden bewaard. `wheelDebounceTime`
      // accumuleert wheel-events kort zodat een trackpad-zwiep één
      // animatie wordt; `wheelPxPerZoomLevel` (px voor één hele
      // zoom-eenheid) bepaalt hoe gevoelig de wheel reageert.
      zoomSnap: 0,
      zoomDelta: 0.25,
      wheelDebounceTime: 40,
      wheelPxPerZoomLevel: 80,
      // maxZoom: 24 zodat 1:100/1:200 schalen ook bereikbaar zijn
      // (1:500 vereist al Z≈19.5, 1:100 vereist Z≈22). Tile-layers
      // kunnen tot Z19 of Z20 leveren — daarboven upscalen ze (zie
      // `createTileLayer` waar elk tile-laag `maxZoom: 24` +
      // `maxNativeZoom` krijgt).
      maxZoom: 24,
      minZoom: 2,
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
    // Voor CAD-tekening-schalen (1:100 / 1:200) zijn zoom-niveaus tot
    // ~22 nodig. PDOK serveert tot Z19-20; daarboven moeten tegels
    // upscalen. Dat doet Leaflet automatisch als `maxNativeZoom` op
    // de werkelijke tile-bron-limit staat en `maxZoom` op de gewenste
    // weergave-limit. Anders clamp-t Leaflet de map-zoom op
    // `tile.maxZoom` (default 18), wat de "1:699 lock" veroorzaakt:
    // gebruiker vraagt 1:500 (Z≈19.5) maar Leaflet stopt op Z19 →
    // liveScale rond op 1:699.
    const T_MAX_ZOOM = 24;        // bovengrens van de Leaflet-zoom
    const T_NATIVE_MAX = 19;      // PDOK tegels stoppen rond Z19
    const T_NATIVE_MAX_LUCHT = 20; // luchtfoto-WMTS soms tot Z20
    const createTileLayer = (id: string): L.TileLayer | null => {
      if (id === "brt") {
        return L.tileLayer(
          "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
          {
            attribution: "Kaartgegevens © Kadaster | PDOK",
            maxZoom: T_MAX_ZOOM,
            maxNativeZoom: T_NATIVE_MAX,
          },
        );
      }
      if (id === "luchtfoto-actueel") {
        return L.tileLayer(
          "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
          {
            attribution: "Luchtfoto © PDOK",
            maxZoom: T_MAX_ZOOM,
            maxNativeZoom: T_NATIVE_MAX_LUCHT,
          },
        );
      }
      const yearMatch = /^luchtfoto-(\d{4})$/.exec(id);
      if (yearMatch) {
        const layerId = yearLayerIds[yearMatch[1]];
        if (!layerId) return null;
        return L.tileLayer(
          `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${layerId}/EPSG:3857/{z}/{x}/{y}.jpeg`,
          {
            attribution: "Luchtfoto © PDOK",
            maxZoom: T_MAX_ZOOM,
            maxNativeZoom: T_NATIVE_MAX_LUCHT,
          },
        );
      }
      if (id === "ahn") {
        return L.tileLayer(
          "https://service.pdok.nl/rws/ahn/wmts/v1_0/dtm_05m/EPSG:3857/{z}/{x}/{y}.png",
          {
            attribution: "AHN © Rijkswaterstaat | PDOK",
            maxZoom: T_MAX_ZOOM,
            maxNativeZoom: T_NATIVE_MAX,
            opacity: 0.7,
          },
        );
      }
      if (id === "bestemmingsplan") {
        // PDOK Ruimtelijkeplannen — gemeentelijke bestemmingsplannen
        // via WMS-as-tile. Transparant zodat ondergrond leesbaar blijft.
        // Endpoint v2_0/v3_0 zijn 404; alleen v1_0 leeft. De visueel-
        // bruikbare layer is `enkelbestemming` (gekleurde zonering),
        // niet `bestemmingsplangebied` (bestaat niet meer).
        return L.tileLayer.wms(
          "https://service.pdok.nl/kadaster/plu/wms/v1_0",
          {
            layers: "enkelbestemming",
            format: "image/png",
            transparent: true,
            attribution: "Ruimtelijkeplannen © Kadaster | PDOK",
            maxZoom: T_MAX_ZOOM,
            opacity: 0.7,
          },
        );
      }
      // Adressen is intentionally NOT returned here — it's a vector
      // WFS overlay handled by the AdressenLayer instance and routed
      // separately in the toggle/opacity handlers below.
      return null;
    };
    let adressenLayer: AdressenLayer | null = null;
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
    overlayHandlesLayerRef.current = L.layerGroup().addTo(map);
    bagLayerRef.current = L.layerGroup();        // attached on toggle
    kadasterLayerRef.current = L.layerGroup();   // attached on toggle
    drawnLayerRef.current = L.layerGroup().addTo(map);  // freehand lines / dimensions
    // Snap-indicator layer — always attached zodat de WFS-snap-handler
    // direct een marker kan inhangen wanneer de cursor in place-mode is.
    // Eén losse L.LayerGroup ipv direct in placedLayer zodat clearLayers
    // op de hoofd-layer de snap-marker niet wegveegt.
    snapLayerRef.current = L.layerGroup().addTo(map);

    // ── GisLayerPanel event bridge ─────────────────────────────
    // The same panel that drives the Kaart view drives this map too
    // (App.tsx renders <GisLayerPanel /> in the sidebar for both
    // views). We listen for its `ogs:layer-toggle` / `ogs:layer-opacity`
    // / `ogs:topotijdreis-year` events and apply them to our own map.
    const onLayerToggle = (e: Event) => {
      const ce = e as CustomEvent<{ view?: string; id: string; enabled: boolean }>;
      // GisLayerPanel keeps a separate set of toggles for the Kaart
      // ("map") and Sonderingstekening ("tekening") views. Only react
      // when the event is for this view; otherwise toggling on the
      // other tab would also affect this Leaflet instance. Older callers
      // that omit `view` are treated as tekening-targeted (the legacy
      // default for this view was "events are mine").
      if (ce.detail.view && ce.detail.view !== "tekening") return;
      const { id, enabled } = ce.detail;

      // Adressen — vector WFS overlay routed through AdressenLayer.
      // Lazily constructed so the WFS fetching only spins up if the
      // user actually enables the layer.
      if (id === "adressen") {
        if (enabled) {
          if (!adressenLayer) adressenLayer = new AdressenLayer();
          if (!map.hasLayer(adressenLayer.group)) {
            adressenLayer.group.addTo(map);
          }
          adressenLayer.attach(map);
          if (typeof layerOpacity[id] === "number") {
            adressenLayer.setOpacity(layerOpacity[id]);
          }
        } else if (adressenLayer) {
          adressenLayer.detach();
          if (map.hasLayer(adressenLayer.group)) {
            map.removeLayer(adressenLayer.group);
          }
        }
        return;
      }

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
      const ce = e as CustomEvent<{ view?: string; id: string; opacity: number }>;
      // Per-view filter — see onLayerToggle comment above.
      if (ce.detail.view && ce.detail.view !== "tekening") return;
      const { id, opacity } = ce.detail;
      const clamped = Math.max(0, Math.min(1, opacity));
      layerOpacity[id] = clamped;
      if (id === "adressen") {
        adressenLayer?.setOpacity(clamped);
        return;
      }
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

    // Click handler — modes in priority order:
    //   1. drawMode (line/dimension) → collect two endpoints
    //   2. coordMode → drop an RD-coordinate tag
    //   3. placeMode → drop a free sondering marker
    //   4. otherwise → deselect anything that was selected
    //
    // WFS-snap: als de mousemove-handler een snap-positie heeft
    // bepaald (activeSnapRef.current ≠ null) gebruiken we díe ipv
    // de raw cursor-positie. Werkt voor draw-, coord- én place-mode
    // zodat alle interactieve plaatsing aan BAG/Kadaster-hoeken kan
    // snappen.
    map.on("click", (e: L.LeafletMouseEvent) => {
      const snapped = activeSnapRef.current;
      const effLat = snapped ? snapped.lat : e.latlng.lat;
      const effLon = snapped ? snapped.lng : e.latlng.lng;
      // CAD-tools die op de MAP klikken (mirror, offset-hint) ipv op
      // een lijn. Lijn-gebaseerde CAD-clicks (trim/extend/offset-source)
      // worden al door line.on("click") afgehandeld en stoppen daar
      // de propagatie, dus dit pad ziet alleen de "lege" klikken.
      const cad = cadModeRef.current;
      if (cad === "mirror" || cad === "offset") {
        handleCadMapClickRef.current?.(cad, effLat, effLon);
        return;
      }
      if (drawModeRef.current) {
        if (!drawStartRef.current) {
          drawStartRef.current = { lat: effLat, lon: effLon };
          return;
        }
        const start = drawStartRef.current;
        const kind = drawModeRef.current;
        drawStartRef.current = null;
        setDrawMode(null);
        drawModeRef.current = null;
        // Ortho-mode: bij Shift-vasthouden tijdens de 2e klik snappen
        // we de lijn-hoek naar de dichtsbijzijnde 45°-veelvoud (0°, 45°,
        // 90°, …) berekend in RD-meters t.o.v. het startpunt. Resultaat:
        // horizontale/verticale of mooie diagonale lijnen zonder dat de
        // gebruiker zijn cursor precies moet uitlijnen. Gebruiker-
        // verzoek: ortho-tekenfunctionaliteit.
        let snapLat = effLat;
        let snapLon = effLon;
        if (e.originalEvent && (e.originalEvent as MouseEvent).shiftKey) {
          const [sxRd, syRd] = WGS84_TO_RD.forward([start.lon, start.lat]);
          const [exRd, eyRd] = WGS84_TO_RD.forward([effLon, effLat]);
          const dx = exRd - sxRd;
          const dy = eyRd - syRd;
          const dist = Math.hypot(dx, dy);
          if (dist > 0) {
            const ang = Math.atan2(dy, dx);
            // Snap-stap = 45° (PI/4). Voor 30°/15° kan dit later.
            const STEP = Math.PI / 4;
            const snappedAng = Math.round(ang / STEP) * STEP;
            const newX = sxRd + dist * Math.cos(snappedAng);
            const newY = syRd + dist * Math.sin(snappedAng);
            const ll = WGS84_TO_RD.inverse([newX, newY]);
            snapLon = ll[0];
            snapLat = ll[1];
          }
        }
        setDrawnLines((prev) => [
          ...prev,
          {
            id: `${kind === "dimension" ? "D" : "L"}${String(prev.length + 1).padStart(2, "0")}`,
            kind,
            lat1: start.lat,
            lon1: start.lon,
            lat2: snapLat,
            lon2: snapLon,
          },
        ]);
        return;
      }
      if (coordModeRef.current) {
        setCoordTags((prev) => [
          ...prev,
          {
            id: `T${String(prev.length + 1).padStart(2, "0")}`,
            lat: effLat,
            lon: effLon,
          },
        ]);
        coordModeRef.current = false;
        setCoordMode(false);
        return;
      }
      if (placeModeRef.current) {
        const kind = placeModeRef.current;
        const prefix = kind === "bore" ? "B" : "S";
        setPlaced((prev) => {
          // Tel alleen objects van hetzelfde kind voor de auto-id zodat
          // S- en B-nummers onafhankelijk doorlopen.
          const sameKindCount = prev.filter(
            (p) => (p.kind ?? "sondering") === kind,
          ).length;
          const nextId = `${prefix}${String(sameKindCount + 1).padStart(2, "0")}`;
          // Sonderingen krijgen standaard het kleefmeting-streepje onder de
          // driehoek (NEN-symbool: vrijwel elke moderne elektrische conus
          // meet plaatselijke wrijving). Uit te zetten per marker in het
          // Eigenschappen-paneel.
          return [
            ...prev,
            {
              id: nextId,
              lat: effLat,
              lon: effLon,
              kind,
              ...(kind === "sondering" ? { kleefmeting: true } : {}),
            },
          ];
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
      // Signal dat de map ready is — triggert het scale-effect om
      // 1:N opnieuw toe te passen (bij eerste mount bailt het anders
      // omdat panes nog niet beschikbaar waren).
      setMapReady((n) => n + 1);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("ogs:layer-toggle", onLayerToggle as EventListener);
      window.removeEventListener("ogs:layer-opacity", onLayerOpacity as EventListener);
      window.removeEventListener("ogs:topotijdreis-year", onTopoYear as EventListener);
      adressenLayer?.detach();
      adressenLayer = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync map zoom to the chosen scale ──────────────────────────
  // We compute the field-width represented by the paper, then call
  // map.fitBounds() so 1 paper-mm corresponds to `scale` field-mm.
  //
  // Re-runs on canvasSize changes too — when the user resizes the
  // window the paper element gets new pixel dimensions, and Leaflet
  // needs an `invalidateSize` + refit so the tile layer covers the
  // new viewport area instead of staying at its initial size (which
  // is what made the map look mostly empty after a resize).
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
    // Bereken het target zoom-niveau via Leaflet's eigen CRS-math
    // (`getScaleZoom`) zodat de gevraagde 1:N exact wordt benaderd.
    // De oudere Web-Mercator-formule met EARTH_C raakte er enkele
    // promille naast omdat Leaflet's `map.distance` (waarop liveScale
    // is gebaseerd) een net andere aardradius gebruikt (haversine R
    // 6371008 vs Mercator R_eq 6378137). Door rechtstreeks de Leaflet
    // scale-functie te gebruiken werkt 1:500 ook echt 1:500.
    //
    // Belangrijk: gebruik EXACT dezelfde paperPxW als waarmee de paper
    // div gerenderd wordt (wMm × 96/25.4). Anders berekent dit effect
    // een andere targetMPerPx dan wat de schaalbar en de title-block
    // live-scale uitrekenen, en blijft er een paar promille verschil
    // staan. Inline (niet via paperLayout) omdat dit effect eerder in
    // het component-lichaam staat dan de paperLayout useMemo.
    const MM_TO_PX = 96 / 25.4;
    const { wMm } = PAPER_MM[paperSize];
    const paperPxW = wMm * MM_TO_PX;
    if (paperPxW <= 0) return;
    // Doel-mPerPx: 1 paper-mm = scale × 1 real-mm, en paperPxW px =
    // paperMmW mm op papier, dus mPerPx = (wMm × scale / 1000) / paperPxW.
    const targetMPerPx = (wMm * scale) / 1000 / paperPxW;
    if (!Number.isFinite(targetMPerPx) || targetMPerPx <= 0) return;
    const centre = map.getCenter();

    // Meet de actuele mPerPx van de map via dezelfde methode als de
    // liveScale read-out (map.distance over 100 container-pixels).
    // Daarmee zit de unit-conversion-mismatch in beide richtingen
    // gelijk en wordt de scale exact.
    const measureMPerPx = (): number | null => {
      try {
        const p1 = map.latLngToContainerPoint(centre);
        const p2 = L.point(p1.x + 100, p1.y);
        const ll2 = map.containerPointToLatLng(p2);
        const dist = map.distance(centre, ll2);
        return Number.isFinite(dist) && dist > 0 ? dist / 100 : null;
      } catch {
        return null;
      }
    };

    // Iteratieve refinement: in praktijk mist één setView het doel
    // soms met ~0.4% (b.v. 1:500 → 1:498) door de combinatie van
    // floating-point in getScaleZoom + de R_haversine/R_eq-mismatch
    // tussen distance-measurement en CRS-projectie. Door 2-3x te
    // meten + bij te stellen convergeert het naar < 0.1% drift,
    // wat liveScale.Math.round netjes op de gevraagde 1:N landt.
    //
    // Stop conditie: 0.0002 = 0.02% absolute drift in mPerPx (één
    // pixel-rounding kan zoveel veroorzaken; verder is nutteloos).
    let cur = measureMPerPx();
    if (cur === null) {
      // Map nog niet projectie-klaar — schedule retry. Gebeurt
      // typisch op de eerste mount voordat de rAF in init-effect
      // invalidateSize heeft gedaan. Een tweede tick is genoeg.
      const retryId = window.setTimeout(() => {
        // Bump mapReady zodat het effect opnieuw runt met deps-check.
        setMapReady((n) => n + 1);
      }, 50);
      return () => window.clearTimeout(retryId);
    }
    // 8 iteraties + strenger tolerance (1e-5 = 0.001%) zodat liveScale's
    // Math.round netjes op het gevraagde 1:N getal landt en niet net erna
    // (1:504 ipv 1:500). Praktisch convergeert het binnen 2-3 stappen.
    for (let iter = 0; iter < 8; iter++) {
      const ratio = cur / targetMPerPx;
      if (Math.abs(ratio - 1) < 1e-5) break;
      const fromZoom = map.getZoom();
      const newZoom = map.getScaleZoom(ratio, fromZoom);
      if (!Number.isFinite(newZoom)) break;
      // Clamp moet boven de targets uitkomen: 1:100 vereist Z≈22
      // op NL-breedte; 24 is veilig en sluit aan op map.options.maxZoom.
      const clamped = Math.max(2, Math.min(24, newZoom));
      map.setView(centre, clamped, { animate: false });
      // Re-meet voor de volgende iteratie. setView met animate:false
      // is synchroon dus de nieuwe state is direct beschikbaar.
      const next = measureMPerPx();
      if (next === null) break;
      cur = next;
    }
    // Sync de mPerPx-state direct met de gemeten waarde aan het einde
    // van de iteratie, zodat de live-scale-display (1:N input) onmiddel-
    // lijk het juiste getal toont. Anders moet er eerst een moveend-
    // event komen — en als de iteratie en moveend-meting marginal
    // verschillen door tile-load-resize, ziet de gebruiker b.v. 1:504
    // ipv 1:500 ondanks dat de iteratie convergeerde.
    if (cur !== null && cur > 0) setMPerPx(cur);
    // canvasSize.w/h staat NIET in de deps — paperPxW hangt alleen
    // van paperSize af (vaste mm × dpi). Window-resizes veranderen
    // de visuele weergave via CSS transform, maar de DOM-pixelmaat
    // van de paper div blijft gelijk; we hoeven dan niet opnieuw te
    // zoomen.
    //
    // mapReady = mount-trigger zodat het effect opnieuw runt nadat
    // de map-init zijn invalidateSize heeft gedaan. Zonder dit zou
    // het effect op mount bailen (map.latLngToContainerPoint heeft
    // nog geen panes) en de startzoom (b.v. 18) ipv 1:500 (Z≈19.5)
    // blijven staan.
  }, [paperSize, scale, mapReady]);

  // ── Render project sondering markers ───────────────────────────
  useEffect(() => {
    const layer = projectLayerRef.current;
    if (!layer || !project) return;
    layer.clearLayers();
    for (const cpt of project.cpts) {
      if (!cpt.position) continue;
      // Convert RD to lat/lon.
      const ll = WGS84_TO_RD.inverse([cpt.position.x_rd, cpt.position.y_rd]);
      // NEN-symbool: sondering mét kleefmeting = driehoek met horizontaal
      // streepje onder de punt. Echte CPT's met fs-data krijgen het
      // streepje automatisch (vrijwel elke moderne elektrische conus).
      const hasKleef = cpt.points.some((pt) => pt.fs != null);
      const marker = L.marker([ll[1], ll[0]], {
        icon: L.divIcon({
          className: "tek-project-marker",
          html: `<div class="tek-marker tek-marker-project" title="${cpt.id}">
                   <svg viewBox="0 0 12 14" overflow="visible"><polygon points="1,1 11,1 6,11"
                     fill="#d97706" stroke="#7c2d12" stroke-width="1" />${
                       hasKleef
                         ? `<line x1="1" y1="13" x2="11" y2="13" stroke="#7c2d12" stroke-width="1.3" stroke-linecap="round" />`
                         : ""
                     }</svg>
                 </div>`,
          /* 4× origineel — gebruiker-verzoek nogmaals 2x. Hoogte 56 zodat de
             12×14-viewBox met streepje dezelfde driehoek-grootte houdt;
             anchor blijft op de driehoekspunt (y=11 × schaal 4 = 44). */
          iconSize: [48, 56],
          iconAnchor: [24, 44],
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
      const isBore = (p.kind ?? "sondering") === "bore";
      const fill = isSelected
        ? "rgba(245,158,11,0.45)"
        : isBore
          ? "#FECACA"
          : "none";
      const stroke = isSelected ? "#92400e" : isBore ? "#7F1D1D" : "#1e3a8a";
      const strokeWidth = isSelected ? 1.6 : 1.2;
      // Boring = open cirkel met midden-dot (zelfde conventie als de
      // BRO-laag op de Kaart). Sondering = driehoek (Dutch CPT symbol).
      const symbolSvg = isBore
        ? `<svg viewBox="0 0 14 14" overflow="visible">
             <circle cx="7" cy="7" r="5.5" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
             <circle cx="7" cy="7" r="1.3" fill="${stroke}" />
           </svg>`
        : `<svg viewBox="0 0 12 14" overflow="visible">
             <polygon points="1,1 11,1 6,11"
               fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
             ${
               p.kleefmeting
                 ? `<line x1="1" y1="13" x2="11" y2="13" stroke="${stroke}" stroke-width="${strokeWidth + 0.3}" stroke-linecap="round" />`
                 : ""
             }
           </svg>`;
      /* 4× origineel — gebruiker wil markers nog 2x groter dan vorige fix */
      const iconSize: [number, number] = isBore ? [56, 56] : [48, 56];
      const iconAnchor: [number, number] = isBore
        ? [28, 28]
        : [24, p.kleefmeting ? 48 : 44];
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: isBore ? "tek-placed-bore-marker" : "tek-placed-marker",
          html: `<div class="tek-marker ${isBore ? "tek-marker-bore" : "tek-marker-placed"}${isSelected ? " selected" : ""}">
                   ${symbolSvg}
                   <span class="tek-marker-label">${p.id}</span>
                 </div>`,
          iconSize,
          iconAnchor,
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
      // Derived sondering markers — nu WEL klikbaar zodat je het raster
      // ook door op een sondering-symbool te klikken selecteert (niet
      // alleen via het dunne kader). Per cel krijgt elke sondering een
      // doorlopend nummer: cellIdx = rIdx * cols + cIdx + 1, wat een
      // herkenbaar R01-S01, R01-S02, … oplevert.
      const selectThisRaster = (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev);
        setSelection({ kind: "raster", id: r.id });
      };
      for (const pt of rasterPoints(r)) {
        const cellIdx = pt.rIdx * r.cols + pt.cIdx + 1;
        const cellLabel = `${r.id}-S${String(cellIdx).padStart(2, "0")}`;
        const m = L.marker([pt.lat, pt.lon], {
          icon: L.divIcon({
            className: "tek-raster-marker",
            html: `<div class="tek-marker tek-marker-raster${isSelected ? " selected" : ""}">
                     <svg viewBox="0 0 10 12" overflow="visible"><polygon points="1,1 9,1 5,9"
                       fill="${fill}" stroke="${stroke}" stroke-width="0.8" />${
                         r.kleefmeting
                           ? `<line x1="1" y1="10.8" x2="9" y2="10.8" stroke="${stroke}" stroke-width="1" stroke-linecap="round" />`
                           : ""
                       }</svg>
                     <span class="tek-marker-label tek-raster-cell-label">${cellLabel}</span>
                   </div>`,
            iconSize: [40, 40], /* 4× origineel */
            iconAnchor: [20, 36],
          }),
          interactive: true,
        });
        m.on("click", selectThisRaster);
        layer.addLayer(m);
      }
      // Bounding rectangle. Een transparante vulling (fill: true met lage
      // opacity) maakt het HELE vlak klikbaar — met fill: false ving
      // alleen de 1,2px-stippellijn kliks, waardoor het raster in de
      // praktijk niet te selecteren was.
      const corners = rasterCornersLatLng(r);
      const rect = L.polygon(corners, {
        color: isSelected ? "#d97706" : "#3b82f6",
        weight: isSelected ? 2.5 : 1.2,
        fill: true,
        fillColor: isSelected ? "#f59e0b" : "#3b82f6",
        fillOpacity: isSelected ? 0.1 : 0.04,
        dashArray: isSelected ? undefined : "4 4",
        interactive: true,
      });
      rect.on("click", selectThisRaster);
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
    const onDragStart = () => {
      draggingRef.current = true;
      // Kaart-pan hard uit tijdens raster-handle-drags — anders pant
      // het hele scherm mee met het vergroten/roteren van het raster.
      try { mapRef.current?.dragging.disable(); } catch { /* noop */ }
    };
    const onDragEnd = () => {
      draggingRef.current = false;
      try { if (!frozenRef.current) mapRef.current?.dragging.enable(); } catch { /* noop */ }
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
        // halfW / halfH = drag distance from center along local axes.
        // Auto-densificatie: bereken hoeveel rijen/kolommen passen
        // wanneer we de spacing onder maxSpacing willen houden. Het
        // raster groeit organisch — sleep groter = méér sonderingen.
        // Werkelijke spacing wordt zo gekozen dat de buitenste markers
        // EXACT op de drag-positie zitten (binnen halfW, niet er buiten).
        const halfW = Math.max(1, Math.abs(lx));
        const halfH = Math.max(1, Math.abs(ly));
        const maxSp = Math.max(1, raster.maxSpacing ?? DEFAULT_RASTER_SPACING);
        // cols = aantal markers in X. (cols-1) gaten passen in 2*halfW.
        // gap = 2*halfW / (cols-1); we willen gap ≤ maxSp →
        //   cols-1 ≥ 2*halfW / maxSp → cols = Math.ceil(2*halfW/maxSp) + 1
        const newCols = Math.max(2, Math.ceil((2 * halfW) / maxSp) + 1);
        const newRows = Math.max(2, Math.ceil((2 * halfH) / maxSp) + 1);
        const newSpacingX = Math.max(0.5, (2 * halfW) / (newCols - 1));
        const newSpacingY = Math.max(0.5, (2 * halfH) / (newRows - 1));
        setRasters((prev) =>
          prev.map((r) =>
            r.id === raster.id
              ? {
                  ...r,
                  rows: newRows,
                  cols: newCols,
                  spacingX: newSpacingX,
                  spacingY: newSpacingY,
                }
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
            iconSize: [24, 24], /* 2× */
            iconAnchor: [12, 22],
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
      // PDFs go through PdfCropDialog: a page picker (thumbnails)
      // followed by the same crop UI as raster images. The result is
      // a PNG data URL, so the overlay ends up as a normal `image`
      // overlay — Leaflet renders it the same way and the user can
      // export it through the existing PDF print pipeline.
      const src = URL.createObjectURL(file);
      setPdfCropPending({ src, name: file.name });
    } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
      // Raster images get a crop step first. The dialog returns a
      // PNG data URL of the cropped region; we drop the original object
      // URL once the user has confirmed or cancelled to avoid leaks.
      const src = URL.createObjectURL(file);
      setCropPending({ src, name: file.name });
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
      maxSpacing: spacing, // standaard = initiële h-o-h (NEN 15/20/25 m)
    };
    setRasters((prev) => [...prev, r]);
    setSelection({ kind: "raster", id: nextId });
    setToast(
      `Raster ${nextId} geplaatst — sleep een hoek om uit te rekken (er komen automatisch sonderingen bij op max ${spacing} m h-o-h)`,
    );
    setTimeout(() => setToast(null), 5000);
  }, [gridSpacing, rasters.length]);

  const clearPlaced = useCallback(() => {
    setPlaced([]);
    setRasters([]);
    setSelection(null);
  }, []);

  /** Delete whatever is currently selected (raster / marker / overlay). */
  const deleteSelection = useCallback(() => {
    // Multi-selection (van Shift+drag-rect) heeft voorrang — als die
    // niet leeg is, verwijderen we ALLES daarin en negeren we de
    // single-selectie. Anders pakt de oude single-select-flow het.
    const multi = multiSelectionRef.current;
    if (multi.length > 0) {
      const markerIds = new Set(multi.filter((m) => m.kind === "marker").map((m) => m.id));
      const rasterIds = new Set(multi.filter((m) => m.kind === "raster").map((m) => m.id));
      const lineIds = new Set(multi.filter((m) => m.kind === "line").map((m) => m.id));
      const coordIds = new Set(multi.filter((m) => m.kind === "coord").map((m) => m.id));
      const overlayHit = multi.some((m) => m.kind === "overlay");
      if (markerIds.size > 0) setPlaced((prev) => prev.filter((p) => !markerIds.has(p.id)));
      if (rasterIds.size > 0) setRasters((prev) => prev.filter((r) => !rasterIds.has(r.id)));
      if (lineIds.size > 0) setDrawnLines((prev) => prev.filter((l) => !lineIds.has(l.id)));
      if (coordIds.size > 0) setCoordTags((prev) => prev.filter((c) => !coordIds.has(c.id)));
      if (overlayHit) setOverlay(null);
      setMultiSelection([]);
      setSelection(null);
      setToast(`${multi.length} object(en) verwijderd`);
      setTimeout(() => setToast(null), 1800);
      return;
    }
    setSelection((sel) => {
      if (!sel) return null;
      if (sel.kind === "marker") {
        setPlaced((prev) => prev.filter((p) => p.id !== sel.id));
      } else if (sel.kind === "raster") {
        setRasters((prev) => prev.filter((r) => r.id !== sel.id));
      } else if (sel.kind === "overlay") {
        setOverlay(null);
      } else if (sel.kind === "line") {
        // Lijn-selectie is nieuw (kwam vroeger niet voor in deze
        // switch omdat lijnen direct werden verwijderd op klik);
        // nu moeten Delete-toets en ribbon-knop de geselecteerde
        // lijn netjes uit drawnLines halen.
        setDrawnLines((prev) => prev.filter((l) => l.id !== sel.id));
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
    } else if (selection.kind === "line") {
      // Lijn-kopie: schuif beide endpoints 10 m oost + 10 m zuid op
      // (zelfde offset-conventie als raster/marker zodat de UX
      // consistent voelt) en geef de kopie een nieuwe id binnen
      // de juiste prefix-reeks (L of D).
      const src = drawnLines.find((l) => l.id === selection.id);
      if (!src) return;
      const a = llToRd(src.lat1, src.lon1);
      const b = llToRd(src.lat2, src.lon2);
      const a2 = rdToLl([a[0] + 10, a[1] - 10]);
      const b2 = rdToLl([b[0] + 10, b[1] - 10]);
      const prefix = src.kind === "dimension" ? "D" : "L";
      const sameKindCount = drawnLines.filter((l) => l.kind === src.kind).length;
      const nextId = `${prefix}${String(sameKindCount + 1).padStart(2, "0")}`;
      const copy: DrawnLine = {
        id: nextId,
        kind: src.kind,
        lat1: a2.lat, lon1: a2.lon,
        lat2: b2.lat, lon2: b2.lon,
      };
      setDrawnLines((prev) => [...prev, copy]);
      setSelection({ kind: "line", id: nextId });
    } else if (selection.kind === "marker") {
      const src = placed.find((p) => p.id === selection.id);
      if (!src) return;
      const [cx, cy] = WGS84_TO_RD.forward([src.lon, src.lat]);
      const ll = WGS84_TO_RD.inverse([cx + 10, cy - 10]);
      const nextId = `S${String(placed.length + 1).padStart(2, "0")}`;
      const copy: PlacedSondering = { ...src, id: nextId, lat: ll[1], lon: ll[0] };
      setPlaced((prev) => [...prev, copy]);
      setSelection({ kind: "marker", id: nextId });
    }
    // overlay-selectie heeft geen Copy in v1 — alleen één overlay
    // ondersteund, dus dupliceren overschrijft de bestaande.
  }, [selection, rasters, placed, drawnLines]);

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
      } else if (selection.kind === "line") {
        // Beide endpoints met dezelfde RD-delta verschuiven — equivalent
        // van "lijn translaten" zonder rotatie.
        setDrawnLines((prev) =>
          prev.map((l) => {
            if (l.id !== selection.id) return l;
            const a = llToRd(l.lat1, l.lon1);
            const b = llToRd(l.lat2, l.lon2);
            const a2 = rdToLl([a[0] + dxMeters, a[1] + dyMeters]);
            const b2 = rdToLl([b[0] + dxMeters, b[1] + dyMeters]);
            return {
              ...l,
              lat1: a2.lat, lon1: a2.lon,
              lat2: b2.lat, lon2: b2.lon,
            };
          }),
        );
      } else if (selection.kind === "marker") {
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

  // ── Keyboard shortcuts on a selected object ─────────────────────
  // Matches Open PDF Studio / Open 2D Studio conventions:
  //   Delete / Backspace → verwijderen
  //   Ctrl+D             → kopiëren (duplicate naast huidige object)
  //   Pijltjestoetsen    → verplaatsen met 1 m (Shift = 5 m)
  // Each shortcut is suppressed inside form inputs so the title-block
  // fields keep their normal text-editing behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName ?? "";
      const inForm =
        tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable;
      if (inForm) return;

      // Escape — universele "stop" voor de tekening: actieve tool reset,
      // selectie weg. Werkt ook als er niks geselecteerd is.
      if (e.key === "Escape") {
        e.preventDefault();
        setSelection(null);
        setDrawMode(null); drawModeRef.current = null; drawStartRef.current = null;
        setPlaceMode(null); placeModeRef.current = null;
        setCoordMode(false); coordModeRef.current = false;
        setCadMode(null); cadModeRef.current = null; cadStepRef.current = null;
        return;
      }

      if (!selection) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        copySelection();
        return;
      }
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(0, step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(0, -step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, deleteSelection, copySelection, moveSelection]);

  // Print-to-PDF stays wired via the ribbon's ogs:tekening-print
  // event (defined below). No standalone button needed anymore.

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
    const onTogglePlace = () =>
      setPlaceMode((m) => (m === "sondering" ? null : "sondering"));
    const onTogglePlaceBore = () =>
      setPlaceMode((m) => (m === "bore" ? null : "bore"));
    const onAddOverlay = () => overlayInputRef.current?.click();
    // Print-to-PDF — wat WebView2 nodig heeft:
    //   1. Set de paper FYSIEK op A2/A3 mm-grootte vóór de print-dialog
    //      opent (anders zien tiles + Leaflet-handlers de oude grootte
    //      en laden ze niets bij voor het uitgebreide oppervlak).
    //   2. Forceer Leaflet om opnieuw de tile-grid te berekenen, en
    //      wacht een tick tot de tiles binnen zijn.
    //   3. Open de print-dialog met een @page-regel die exact aan A2/A3
    //      landscape voldoet, plus visibility-hiding voor alles buiten
    //      `.tek-paper`.
    //   4. Restore de oude paper-grootte nadat de dialog gesloten is.
    // Vraag-3-offertes opent een dialog met sondeerbedrijven
    // (catalogus in src/data/sondeerbedrijven.ts). De project-
    // locatie en metadata pakt de dialog uit zijn eigen props
    // via een force-rerender (de open-state in de view).
    const onRequestQuotes = () => {
      setOffertesOpen(true);
    };
    const onIfcxPreview = () => {
      setIfcxPreviewOpen(true);
    };
    const onPrint = () => {
      const isA2 = paperSize === "A2";
      const pageW = isA2 ? "594mm" : "420mm";
      const pageH = isA2 ? "420mm" : "297mm";
      // Inline print-styles. Twee fases:
      //   (a) SCHERM-fase tijdens `body.tek-printing`: paper wordt
      //       op A2/A3 mm-grootte gezet zodat Leaflet de juiste
      //       tile-grid kan opbouwen, MAAR off-screen via
      //       `left: -100vw` zodat de gebruiker niets ziet. Anders
      //       "explodeert" het papier over de hele app tijdens de
      //       print-dialog (594mm ≈ 2245px op 96dpi).
      //   (b) PRINT-fase (@media print): paper wordt naar (0,0)
      //       gezet en zichtbaar gemaakt; al het andere is verborgen
      //       via visibility:hidden.
      const css =
        // Page rule met expliciete mm-dimensies zodat WebView2 geen
        // 'A2'-naam hoeft te kennen.
        `@page { size: ${pageW} ${pageH}; margin: 0; }\n` +
        // SCHERM-fase: paper off-screen op de juiste mm-grootte.
        // pointer-events: none zodat de UI achter het off-screen
        // papier nog steeds gewoon klikbaar is (anders zou de
        // gebruiker per ongeluk niet meer met de ribbon kunnen
        // werken na cancel).
        `body.tek-printing .tek-paper {\n` +
        `  position: fixed !important;\n` +
        `  left: -100vw !important; top: 0 !important;\n` +
        `  width: ${pageW} !important;\n` +
        `  height: ${pageH} !important;\n` +
        `  max-width: none !important; max-height: none !important;\n` +
        `  margin: 0 !important;\n` +
        `  box-shadow: none !important;\n` +
        `  border: none !important;\n` +
        `  transform: none !important;\n` +
        `  z-index: 99999 !important;\n` +
        `  pointer-events: none !important;\n` +
        `}\n` +
        // Stage-wrapper ook off-screen + verberg de in-canvas
        // representatie. De stage was de "kijkglas"-laag in de
        // gewone view; tijdens print willen we hem volledig uit
        // de weg.
        `body.tek-printing .tek-paper-stage {\n` +
        `  visibility: hidden !important;\n` +
        `}\n` +
        // PRINT-fase: paper naar (0,0) brengen en zichtbaar maken.
        // body * { visibility: hidden } verbergt eerst álles, dan
        // .tek-paper en al zijn kinderen weer zichtbaar.
        `@media print {\n` +
        `  html, body { background: white !important; margin: 0 !important; padding: 0 !important; }\n` +
        `  body * { visibility: hidden !important; }\n` +
        `  body.tek-printing .tek-paper {\n` +
        `    left: 0 !important;\n` +
        `    visibility: visible !important;\n` +
        `  }\n` +
        `  .tek-paper * { visibility: visible !important; }\n` +
        `  /* Zorg dat oude box-shadow van de leaflet tiles niet roeit. */\n` +
        `  .leaflet-tile { box-shadow: none !important; }\n` +
        `}\n`;
      const styleEl = document.createElement("style");
      styleEl.id = "tek-print-style";
      styleEl.textContent = css;
      document.head.appendChild(styleEl);

      // Stap 1: paper naar A2/A3 mm-grootte op het scherm (verborgen
      // achter andere elementen door de z-index, maar wel pixel-
      // correct voor Leaflet).
      document.body.classList.add("tek-printing");

      // Stap 2: forceer Leaflet om de nieuwe container-grootte te zien
      // en de tile-grid opnieuw te bouwen. invalidateSize triggert
      // ook een moveend zodat WMS-overlays herfetchen.
      requestAnimationFrame(() => {
        try { mapRef.current?.invalidateSize(); } catch { /* noop */ }
        // Stap 3: wacht een halve seconde tot tiles binnen zijn,
        // dan de print-dialog. Een korte delay is hier essentieel —
        // zonder dit print je een halflege kaart met grijze tegels.
        window.setTimeout(() => {
          window.print();
          // Stap 4: cleanup nadat de gebruiker de dialog gesloten heeft.
          // `afterprint` event is betrouwbaarder dan een timer.
          const cleanup = () => {
            document.body.classList.remove("tek-printing");
            const el = document.getElementById("tek-print-style");
            el?.parentNode?.removeChild(el);
            try { mapRef.current?.invalidateSize(); } catch { /* noop */ }
            window.removeEventListener("afterprint", cleanup);
          };
          window.addEventListener("afterprint", cleanup);
          // Fallback voor browsers die geen afterprint vuren.
          window.setTimeout(cleanup, 8000);
        }, 600);
      });
    };
    // ── Exporteer PDF — rastert het papier ZOALS HET OP HET SCHERM
    // staat en schrijft een echt PDF-bestand (geen print-dialog).
    //
    // BEWUST géén off-screen-vergroting naar ware mm-grootte (zoals de
    // print-route doet): html-to-image moet dan honderden extra
    // Leaflet-tiles als data-URL's in één gigantische SVG inlinen en
    // dat crashte de WebView2-renderer (OOM → white screen). Het
    // schermformaat heeft alleen de al geladen tiles; scherpte komt van
    // de dynamische pixelratio (doel ±3000 px breed ≈ 180 dpi op A3).
    // Zware imports lazy zodat de tekening-tab er niet trager van opent.
    let exporting = false;
    const doExportPdf = async () => {
      if (exporting) return;
      const paperEl = document.querySelector<HTMLElement>(".tek-paper");
      if (!paperEl || paperEl.clientWidth < 50) return;
      exporting = true;
      const snap = getLatestTekening();
      const isA2 = (snap?.paperSize ?? "A3") === "A2";
      const wMm = isA2 ? 594 : 420;
      const hMm = isA2 ? 420 : 297;
      setToast("PDF exporteren…");
      try {
        const { toPng } = await import("html-to-image");
        const ratio = Math.max(1, Math.min(3, 3000 / paperEl.clientWidth));
        const dataUrl = await toPng(paperEl, {
          pixelRatio: ratio,
          backgroundColor: "#ffffff",
        });

        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [wMm, hMm] });
        doc.addImage(dataUrl, "PNG", 0, 0, wMm, hMm);
        const fname = `${(snap?.titleBlock?.project || "situatietekening").replace(/[\\/:*?"<>|]/g, "_")}.pdf`;

        const { IS_TAURI } = await import("../../utils/platform");
        if (IS_TAURI) {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const dst = await save({ defaultPath: fname, filters: [{ name: "PDF", extensions: ["pdf"] }] });
          if (dst) {
            const { writeFile } = await import("@tauri-apps/plugin-fs");
            await writeFile(dst, new Uint8Array(doc.output("arraybuffer")));
            setToast("PDF geëxporteerd");
          } else {
            setToast(null);
          }
        } else {
          // Web-fallback: gewone browser-download.
          doc.save(fname);
          setToast("PDF geëxporteerd");
        }
      } catch (err) {
        console.error("tekening-export-pdf failed", err);
        setToast("PDF-export mislukt");
      } finally {
        exporting = false;
        setTimeout(() => setToast(null), 3000);
      }
    };
    const onExportPdf = () => { void doExportPdf(); };
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
    // Roteer het geselecteerde object met `deg` graden (klokwise = +).
    // Werkt op:
    //   - raster: rotation-property optellen (modulo 360 voor netheid)
    //   - overlay (image/svg): we voegen rotation toe via een
    //     custom CSS-transform op de Leaflet imageOverlay element
    //     en bewaren de hoek in een nieuwe state (overlayRotation).
    //   - marker / coord-tag: nog niet rotatable (rond symbool of
    //     puur tekstlabel — rotatie heeft daar geen visuele zin)
    const onRotate = (e: Event) => {
      const ce = e as CustomEvent<{ deg: number }>;
      const deg = Number(ce.detail.deg) || 0;
      if (!deg) return;
      const sel = selectionRef.current;
      if (!sel) {
        setToast("Selecteer eerst een object om te roteren");
        setTimeout(() => setToast(null), 2200);
        return;
      }
      if (sel.kind === "raster") {
        setRasters((prev) =>
          prev.map((r) =>
            r.id === sel.id
              ? { ...r, rotation: ((r.rotation + deg) % 360 + 360) % 360 }
              : r,
          ),
        );
      } else if (sel.kind === "overlay" && overlayLayerRef.current) {
        setOverlayRotation((d) => ((d + deg) % 360 + 360) % 360);
      } else {
        setToast("Dit objecttype kun je niet roteren");
        setTimeout(() => setToast(null), 2200);
      }
    };
    // Properties-panel ↔ view bridge.
    const onSetTitleBlock = (e: Event) => {
      const ce = e as CustomEvent<{ field: keyof TitleBlockData; value: string }>;
      setTitleBlock((tb) => ({ ...tb, [ce.detail.field]: ce.detail.value }));
    };
    const onUpdateSelectedRaster = (e: Event) => {
      const ce = e as CustomEvent<{ patch: Partial<Omit<PlacedRaster, "id">> }>;
      updateSelectedRaster(ce.detail.patch);
    };
    const onRequestSnapshot = () => publishSnapshotRef.current?.();
    const onLoadFrame = () => frameInputRef.current?.click();
    const onClearAll = () => { clearPlaced(); setDrawnLines([]); setCoordTags([]); };
    const onDrawLine = () => { setDrawMode("line"); drawModeRef.current = "line"; drawStartRef.current = null; };
    const onDrawDim = () => { setDrawMode("dimension"); drawModeRef.current = "dimension"; drawStartRef.current = null; };
    // CAD-edit-tools — schakelen elkaar uit (één actieve tool tegelijk)
    // en wissen alle andere placement-modes zodat de eerste klik
    // gegarandeerd naar de juiste CAD-handler gaat. cadStepRef wordt
    // expliciet gereset; de cadMode-useEffect doet dat ook bij elk
    // wisselen van mode, maar hier wissen we 'm vooraf voor de zekerheid.
    const startCadMode = (m: "trim" | "extend" | "mirror" | "offset") => {
      setDrawMode(null); drawModeRef.current = null; drawStartRef.current = null;
      setPlaceMode(null); placeModeRef.current = null;
      setCoordMode(false); coordModeRef.current = false;
      cadStepRef.current = null;
      setCadMode(m); cadModeRef.current = m;
      // Korte hint per tool — vertelt wat de volgende klik doet.
      const hints: Record<typeof m, string> = {
        trim: "Trim — klik eerst op de referentielijn (snij-rand)",
        extend: "Extend — klik eerst op de referentielijn (waar tot verlengd wordt)",
        mirror: "Mirror — selecteer eerst een lijn (klik er op), klik dan twee punten voor de spiegelas",
        offset: "Offset — klik een lijn om de bron te kiezen (afstand wordt daarna gevraagd)",
      };
      setToast(hints[m]);
      setTimeout(() => setToast(null), 4500);
    };
    const onCadTrim = () => startCadMode("trim");
    const onCadExtend = () => startCadMode("extend");
    const onCadMirror = () => startCadMode("mirror");
    const onCadOffset = () => startCadMode("offset");
    // Select-tool: cancel any active draw/place/coord/cad mode + zet
    // selectMode aan zodat plain drag op het papier een selectie-
    // rechthoek tekent (zonder Shift te hoeven indrukken). Toggle:
    // tweede klik op Selecteren zet de mode weer uit.
    const onSelectMode = () => {
      setDrawMode(null); drawModeRef.current = null; drawStartRef.current = null;
      setPlaceMode(null); placeModeRef.current = null;
      setCoordMode(false); coordModeRef.current = false;
      setCadMode(null); cadModeRef.current = null; cadStepRef.current = null;
      setSelectMode((m) => {
        const next = !m;
        // Broadcast naar de ribbon-tab zodat de Selecteren-knop kan
        // highlighten wanneer de mode aan staat.
        window.dispatchEvent(
          new CustomEvent("ogs:tekening-select-mode-changed", {
            detail: { active: next },
          }),
        );
        return next;
      });
    };
    // Freeze toggle from the ribbon. We flip the state here; a separate
    // effect (below) handles enabling/disabling the actual Leaflet
    // interaction handlers and emits `ogs:tekening-freeze-changed` so
    // the ribbon button stays in sync.
    const onToggleFreeze = () => setFrozen((f) => !f);
    // Properties-panel emits this when the user resizes the selected
    // image overlay via the width-input. Patch the overlay state — the
    // imageOverlay effect re-runs on `overlay` change and rebuilds the
    // bounds at the new width.
    const onUpdateOverlay = (e: Event) => {
      const ce = e as CustomEvent<{ widthMeters: number }>;
      const w = Number(ce.detail.widthMeters);
      if (!Number.isFinite(w) || w <= 0) return;
      setOverlay((ov) => (ov ? { ...ov, widthMeters: w } : ov));
    };
    // Toggle kleefmeting flag for the selected placed marker.
    const onSetKleefmeting = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; kleefmeting: boolean }>;
      setPlaced((prev) =>
        prev.map((p) =>
          p.id === ce.detail.id ? { ...p, kleefmeting: ce.detail.kleefmeting } : p,
        ),
      );
    };
    // Toggle de image-overlay's z-stack-positie: foreground = boven
    // alles (z-index 250), background = onder lijnen/markers (default).
    const onSetOverlayLayer = (e: Event) => {
      const ce = e as CustomEvent<{ foreground: boolean }>;
      setOverlayInForeground(!!ce.detail.foreground);
    };
    // Wijzig de override-kleur van een geselecteerde lijn (via de
    // kleur-picker in TekeningProperties). Kleur null = terug naar de
    // kind-default (dimension=amber, line=donkergrijs).
    const onSetLineColor = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; color: string | null }>;
      setDrawnLines((prev) =>
        prev.map((l) =>
          l.id === ce.detail.id
            ? { ...l, color: ce.detail.color ?? undefined }
            : l,
        ),
      );
    };
    const onSetPaperSize = (e: Event) => {
      const ce = e as CustomEvent<{ paperSize: PaperSize }>;
      setPaperSize(ce.detail.paperSize);
    };
    const onSetScale = (e: Event) => {
      const ce = e as CustomEvent<{ scale: Scale }>;
      setScale(ce.detail.scale);
    };
    const onSetPlacedId = (e: Event) => {
      const ce = e as CustomEvent<{ oldId: string; newId: string }>;
      setPlaced((prev) =>
        prev.map((p) => (p.id === ce.detail.oldId ? { ...p, id: ce.detail.newId } : p)),
      );
      // Also update selection so the Properties panel shows the new id.
      setSelection((sel) =>
        sel?.kind === "marker" && sel.id === ce.detail.oldId
          ? { kind: "marker", id: ce.detail.newId }
          : sel,
      );
    };
    window.addEventListener("ogs:tekening-load-frame", onLoadFrame);
    window.addEventListener("ogs:tekening-clear-all", onClearAll);
    window.addEventListener("ogs:tekening-set-papersize", onSetPaperSize as EventListener);
    window.addEventListener("ogs:tekening-set-scale", onSetScale as EventListener);
    window.addEventListener("ogs:tekening-set-placed-id", onSetPlacedId as EventListener);
    window.addEventListener("ogs:tekening-draw-line", onDrawLine);
    window.addEventListener("ogs:tekening-draw-dimension", onDrawDim);
    window.addEventListener("ogs:tekening-cad-trim", onCadTrim);
    window.addEventListener("ogs:tekening-cad-extend", onCadExtend);
    window.addEventListener("ogs:tekening-cad-mirror", onCadMirror);
    window.addEventListener("ogs:tekening-cad-offset", onCadOffset);
    window.addEventListener("ogs:tekening-select-mode", onSelectMode);
    window.addEventListener("ogs:tekening-set-kleefmeting", onSetKleefmeting as EventListener);
    window.addEventListener("ogs:tekening-set-line-color", onSetLineColor as EventListener);
    window.addEventListener("ogs:tekening-set-overlay-layer", onSetOverlayLayer as EventListener);
    window.addEventListener("ogs:tekening-toggle-freeze", onToggleFreeze);
    window.addEventListener("ogs:tekening-update-selected-overlay", onUpdateOverlay as EventListener);
    window.addEventListener("ogs:tekening-toggle-place", onTogglePlace);
    window.addEventListener("ogs:tekening-toggle-place-bore", onTogglePlaceBore);
    window.addEventListener("ogs:tekening-add-overlay", onAddOverlay);
    window.addEventListener("ogs:tekening-print", onPrint);
    window.addEventListener("ogs:tekening-export-pdf", onExportPdf);
    window.addEventListener("ogs:tekening-request-quotes", onRequestQuotes);
    window.addEventListener("ogs:tekening-ifcx-preview", onIfcxPreview);
    window.addEventListener("ogs:tekening-place-raster", onPlaceRaster);
    window.addEventListener("ogs:tekening-coord-tag", onCoordTag);
    window.addEventListener("ogs:tekening-copy", onCopy);
    window.addEventListener("ogs:tekening-delete", onDelete);
    window.addEventListener("ogs:tekening-move", onMove as EventListener);
    window.addEventListener("ogs:tekening-rotate", onRotate as EventListener);
    window.addEventListener("ogs:tekening-set-titleblock", onSetTitleBlock as EventListener);
    window.addEventListener(
      "ogs:tekening-update-selected-raster",
      onUpdateSelectedRaster as EventListener,
    );
    window.addEventListener("ogs:tekening-request-snapshot", onRequestSnapshot);
    return () => {
      window.removeEventListener("ogs:tekening-toggle-place", onTogglePlace);
      window.removeEventListener("ogs:tekening-toggle-place-bore", onTogglePlaceBore);
      window.removeEventListener("ogs:tekening-add-overlay", onAddOverlay);
      window.removeEventListener("ogs:tekening-print", onPrint);
      window.removeEventListener("ogs:tekening-export-pdf", onExportPdf);
      window.removeEventListener("ogs:tekening-request-quotes", onRequestQuotes);
      window.removeEventListener("ogs:tekening-ifcx-preview", onIfcxPreview);
      window.removeEventListener("ogs:tekening-place-raster", onPlaceRaster);
      window.removeEventListener("ogs:tekening-coord-tag", onCoordTag);
      window.removeEventListener("ogs:tekening-copy", onCopy);
      window.removeEventListener("ogs:tekening-delete", onDelete);
      window.removeEventListener("ogs:tekening-move", onMove as EventListener);
      window.removeEventListener("ogs:tekening-rotate", onRotate as EventListener);
      window.removeEventListener("ogs:tekening-set-titleblock", onSetTitleBlock as EventListener);
      window.removeEventListener(
        "ogs:tekening-update-selected-raster",
        onUpdateSelectedRaster as EventListener,
      );
      window.removeEventListener("ogs:tekening-request-snapshot", onRequestSnapshot);
      window.removeEventListener("ogs:tekening-load-frame", onLoadFrame);
      window.removeEventListener("ogs:tekening-clear-all", onClearAll);
      window.removeEventListener("ogs:tekening-set-papersize", onSetPaperSize as EventListener);
      window.removeEventListener("ogs:tekening-set-scale", onSetScale as EventListener);
      window.removeEventListener("ogs:tekening-set-placed-id", onSetPlacedId as EventListener);
      window.removeEventListener("ogs:tekening-draw-line", onDrawLine);
      window.removeEventListener("ogs:tekening-draw-dimension", onDrawDim);
      window.removeEventListener("ogs:tekening-cad-trim", onCadTrim);
      window.removeEventListener("ogs:tekening-cad-extend", onCadExtend);
      window.removeEventListener("ogs:tekening-cad-mirror", onCadMirror);
      window.removeEventListener("ogs:tekening-cad-offset", onCadOffset);
      window.removeEventListener("ogs:tekening-select-mode", onSelectMode);
      window.removeEventListener("ogs:tekening-set-kleefmeting", onSetKleefmeting as EventListener);
      window.removeEventListener("ogs:tekening-set-line-color", onSetLineColor as EventListener);
      window.removeEventListener("ogs:tekening-set-overlay-layer", onSetOverlayLayer as EventListener);
      window.removeEventListener("ogs:tekening-toggle-freeze", onToggleFreeze);
      window.removeEventListener("ogs:tekening-update-selected-overlay", onUpdateOverlay as EventListener);
    };
  }, [placeRaster, copySelection, deleteSelection, moveSelection, updateSelectedRaster, clearPlaced]);

  // Publish state snapshots whenever titleBlock / selection / rasters
  // change, so the right-side TekeningProperties panel mirrors the
  // current state. Wrapped in a ref so the static listener above can
  // also trigger an on-demand re-publish (used by the panel on mount).
  const publishSnapshotRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const selectedRaster =
      selection?.kind === "raster"
        ? rasters.find((r) => r.id === selection.id) ?? null
        : null;
    const selectedMarker =
      selection?.kind === "marker"
        ? placed.find((p) => p.id === selection.id) ?? null
        : null;
    const selectedOverlay =
      selection?.kind === "overlay" && overlay && overlay.id === selection.id
        ? overlay
        : null;
    const selectedLine =
      selection?.kind === "line"
        ? drawnLines.find((l) => l.id === selection.id) ?? null
        : null;
    // Live print-scale derived from the actual Leaflet zoom + paper.
    // 1 paper-mm = (paperPxW / paperMmW) px, which represents
    // (paperPxW / paperMmW) × mPerPx meters → so scale = 1000 × that.
    // We compute paperPxW inline as `paperMmW × MM_TO_PX` (mirroring
    // the paperLayout useMemo below) zodat de snapshot exact dezelfde
    // pixel-grootte gebruikt als het schaal-setting effect. Anders
    // verschijnt 1:500 als 1:502 in de title-block read-out.
    const MM_TO_PX = 96 / 25.4;
    const snapMmW = PAPER_MM[paperSize].wMm;
    const snapPxW = snapMmW * MM_TO_PX;
    const liveScale =
      mPerPx > 0 && snapPxW > 0
        ? Math.round((snapPxW / snapMmW) * mPerPx * 1000)
        : scale;
    const snapshot = {
      titleBlock,
      paperSize,
      scale,
      liveScale,
      frozen,
      selectionKind: selection?.kind ?? null,
      selectionId: selection?.id ?? null,
      selectedMarker: selectedMarker
        ? { id: selectedMarker.id, kleefmeting: !!selectedMarker.kleefmeting }
        : null,
      selectedRaster: selectedRaster
        ? {
            id: selectedRaster.id,
            rows: selectedRaster.rows,
            cols: selectedRaster.cols,
            spacingX: selectedRaster.spacingX,
            spacingY: selectedRaster.spacingY,
            rotation: selectedRaster.rotation,
            kleefmeting: !!selectedRaster.kleefmeting,
          }
        : null,
      selectedOverlay: selectedOverlay
        ? {
            id: selectedOverlay.id,
            name: selectedOverlay.name,
            widthMeters: selectedOverlay.widthMeters ?? 100,
            foreground: overlayInForeground,
          }
        : null,
      selectedLine: selectedLine
        ? {
            id: selectedLine.id,
            kind: selectedLine.kind,
            color: selectedLine.color,
          }
        : null,
    };
    publishSnapshotRef.current = () => {
      window.dispatchEvent(
        new CustomEvent("ogs:tekening-state-snapshot", { detail: snapshot }),
      );
    };
    publishSnapshotRef.current();
  }, [titleBlock, selection, rasters, placed, paperSize, scale, frozen, overlay, mPerPx, drawnLines, overlayInForeground]);

  // ── Mirror complete tekening-state naar de module-level singleton ─
  // Aparte effect (los van het snapshot event boven) zodat we ALLE
  // arrays en de mapView meegeven — die zitten niet in het snapshot
  // event omdat TekeningProperties die niet hoeft te zien. Backstage's
  // saveProject leest uit deze singleton om het .ifcgis te bouwen.
  useEffect(() => {
    const full: TekeningFullState = {
      paperSize,
      scale,
      center: mapView,
      markers: placed.map((p) => ({
        id: p.id,
        kind: p.kind === "bore" ? "bore" : "sondering",
        lat: p.lat,
        lon: p.lon,
        kleefmeting: !!p.kleefmeting,
      })),
      rasters: rasters.map((r) => ({
        id: r.id,
        centerLat: r.centerLat,
        centerLon: r.centerLon,
        rows: r.rows,
        cols: r.cols,
        spacingX: r.spacingX,
        spacingY: r.spacingY,
        rotation: r.rotation,
      })),
      lines: drawnLines.map((l) => ({
        id: l.id,
        kind: l.kind,
        lat1: l.lat1,
        lon1: l.lon1,
        lat2: l.lat2,
        lon2: l.lon2,
      })),
      coordTags: coordTags.map((c) => ({
        id: c.id,
        lat: c.lat,
        lon: c.lon,
        label: c.label,
      })),
      overlay: overlay
        ? {
            id: overlay.id,
            name: overlay.name,
            kind: overlay.kind,
            src: overlay.src,
            widthMeters: overlay.widthMeters ?? 100,
            centerLat: overlay.centerLat,
            centerLon: overlay.centerLon,
          }
        : null,
      titleBlock,
    };
    setLatestTekening(full);
  }, [
    paperSize,
    scale,
    mapView,
    placed,
    rasters,
    drawnLines,
    coordTags,
    overlay,
    titleBlock,
  ]);

  // ── Restore pending tekening state op mount ────────────────────
  // Bij het openen van een .ifcgis met `tekening`-sectie zet
  // openProjectIfcgisFull een pending payload klaar. Wij consumeren
  // die hier zodra de view mount — de Leaflet-init effect leest
  // het mapView-center via useEffect-volgorde NIET, dus we doen
  // het via een setView na een korte tick zodra de map bestaat.
  useEffect(() => {
    // Twee restore-bronnen:
    //  1. pendingTekeningRestore — gevuld door openProjectIfcgisFull
    //     bij het laden van een .ifcgis. Eenmalig per open-actie.
    //  2. latestTekening singleton — gevuld door deze view zelf op
    //     iedere state-mutatie. Bij tab-switch unmount de view, maar
    //     de singleton blijft staan. Bij re-mount herstellen we het
    //     zodat scale/paperSize/markers niet weg zijn.
    // Pending wint (expliciete open-actie). Anders val terug op
    // latest zodat tab-switch geen state wist. Onthoud OF het een
    // expliciete open was — dat bepaalt straks of we óók de opgeslagen
    // viewport terugzetten (zie de panTo-conditie verderop).
    const explicit = consumePendingTekeningRestore();
    const pending = explicit ?? getLatestTekening();
    if (!pending) return;
    setPaperSize(pending.paperSize);
    setScale(pending.scale);
    setTitleBlock(pending.titleBlock);
    setPlaced(
      pending.markers.map((m) => ({
        id: m.id,
        kind: m.kind,
        lat: m.lat,
        lon: m.lon,
        kleefmeting: !!m.kleefmeting,
      })),
    );
    setRasters(
      pending.rasters.map((r) => ({
        id: r.id,
        centerLat: r.centerLat,
        centerLon: r.centerLon,
        rows: r.rows,
        cols: r.cols,
        spacingX: r.spacingX,
        spacingY: r.spacingY,
        rotation: r.rotation,
      })),
    );
    setDrawnLines(
      pending.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        lat1: l.lat1,
        lon1: l.lon1,
        lat2: l.lat2,
        lon2: l.lon2,
      })),
    );
    setCoordTags(
      pending.coordTags.map((c) => ({
        id: c.id,
        lat: c.lat,
        lon: c.lon,
        label: c.label,
      })),
    );
    if (pending.overlay) {
      setOverlay({
        id: pending.overlay.id,
        name: pending.overlay.name,
        kind: pending.overlay.kind,
        src: pending.overlay.src,
        widthMeters: pending.overlay.widthMeters,
        centerLat: pending.overlay.centerLat,
        centerLon: pending.overlay.centerLon,
      });
    } else {
      setOverlay(null);
    }
    setMapView(pending.center);
    // Herstel de opgeslagen VIEWPORT alleen wanneer dat de sondering-fit
    // niet in de weg zit:
    //  • expliciete .ifcgis-open → altijd (de gebruiker opent díe tekening);
    //  • geen sondering open     → altijd (default/getekende positie);
    //  • sondering open, maar de auto-fit voor déze sondering is al eens
    //    gedaan (fittedTekeningKey match) → óók herstellen: de gebruiker
    //    heeft de fit al gezien en mogelijk handmatig gepand/gezoomd —
    //    die framing mag een tab-switch overleven.
    // Alleen bij een VERSE sondering (key-mismatch) wint de auto-fit en
    // slaan we de restore over — dat was de oorspronkelijke bug ("zoomt
    // niet naar de sondering").
    const ds = useCptStore.getState();
    const activeD = ds.documents.find((d) => d.id === ds.activeDocId);
    const soundingOpen =
      activeD?.kind === "cpt"
        ? activeD.cpt.position != null
        : activeD?.kind === "project"
          ? Array.from(activeD.cpts.values()).some((c) => c.position != null)
          : false;
    const alreadyFitted =
      fittedTekeningKey === `cpts:${ds.activeDocId}:${pending.paperSize}`;
    if (explicit != null || !soundingOpen || alreadyFitted) {
      // Zet de Leaflet-map naar het opgeslagen CENTRE, maar laat de
      // ZOOM aan het scale-setter effect over — dat berekent de exacte
      // zoom voor 1:N en wint anders een race-condition (saved-zoom
      // 18 zou de scale-effect's 19.5 overschrijven). Wacht een tick
      // zodat de map-init zeker klaar is. panTo behoudt huidige zoom.
      const id = window.setTimeout(() => {
        const map = mapRef.current;
        if (!map) return;
        try {
          map.panTo([pending.center.lat, pending.center.lon], { animate: false });
          // Trigger scale-effect re-run zodat 1:N opnieuw wordt toegepast
          // op de nieuwe centre-positie (mPerPx kan iets verschillen
          // door cos(lat) verschil tussen oude en nieuwe centre).
          setMapReady((n) => n + 1);
        } catch {
          /* map nog niet klaar — accepteer dat */
        }
      }, 50);
      return () => window.clearTimeout(id);
    }
    // Bewust eenmalig op mount — als er later opnieuw een project
    // wordt geopend, remount React de view normaal gesproken niet
    // (zelfde tab) dus de openProjectIfcgisFull-flow moet zelf een
    // event dispatchen om dit opnieuw te triggeren. v2-werk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Track canvas size (for fit-to-view paper) ──────────────────
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setCanvasSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Freeze viewport — disable / enable Leaflet interaction ─────
  // When `frozen` is true the user can no longer pan, zoom, or use
  // double-click / pinch / keyboard to move the map. This is the
  // "lock the drawing in place" affordance from the ribbon. We also
  // broadcast the new state so the ribbon button can flip its icon /
  // active styling, and add a CSS class to the paper so the cursor
  // hint changes too.
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      const handlers = [
        map.dragging,
        map.scrollWheelZoom,
        map.touchZoom,
        map.doubleClickZoom,
        map.boxZoom,
        map.keyboard,
      ];
      for (const h of handlers) {
        if (!h) continue;
        if (frozen) h.disable();
        else h.enable();
      }
    }
    window.dispatchEvent(
      new CustomEvent("ogs:tekening-freeze-changed", { detail: { frozen } }),
    );
  }, [frozen]);

  // ── Multi-select drag-rectangle ───────────────────────────────
  // Shift+drag op het papier tekent een amber rechthoek; op mouseup
  // gaan alle bevatte markers / rasters / lijnen / coord-tags / image-
  // overlays in `multiSelection`. Plain klik (zonder shift) of Esc
  // wist hem. De Delete-handler in deleteSelection() pakt vervolgens
  // multiSelection in bulk op.
  useEffect(() => {
    const map = mapRef.current;
    const container = paperRef.current;
    if (!map || !container) return;
    // Leaflet's eigen boxZoom (Shift+drag = inzoomen op bbox) zit ons
    // in de weg — onze Shift+drag is voor multi-select. Uitzetten.
    try { map.boxZoom.disable(); } catch { /* noop */ }
    let dragStart: L.LatLng | null = null;
    let rect: L.Rectangle | null = null;

    const onMouseDown = (e: MouseEvent) => {
      // Trigger op Shift+drag (oude gedrag) OF wanneer selectMode
      // aan staat via de Selecteren-knop (plain drag = rechthoek).
      if (!e.shiftKey && !selectModeRef.current) return;
      if (placeModeRef.current || drawModeRef.current || coordModeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      // mouseEventToContainerPoint compenseert voor CSS transform:scale
      // op het papier — anders zou het selectie-kader 1/viewScale-px
      // verschoven beginnen t.o.v. waar de cursor klikt.
      const cp = map.mouseEventToContainerPoint(e);
      dragStart = map.containerPointToLatLng(cp);
      map.dragging.disable();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStart) return;
      const cp = map.mouseEventToContainerPoint(e);
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
      const cp = map.mouseEventToContainerPoint(e);
      const end = map.containerPointToLatLng(cp);
      const bounds = L.latLngBounds(dragStart, end);
      const dragPx = Math.abs(
        map.latLngToContainerPoint(dragStart).distanceTo(cp),
      );
      if (dragPx > 5) {
        const hits: MultiItem[] = [];
        // Markers (CPTs + boringen)
        for (const m of placed) {
          if (bounds.contains([m.lat, m.lon])) {
            hits.push({ kind: "marker", id: m.id });
          }
        }
        // Rasters — match op center
        for (const r of rasters) {
          if (bounds.contains([r.centerLat, r.centerLon])) {
            hits.push({ kind: "raster", id: r.id });
          }
        }
        // Coord-tags
        for (const c of coordTags) {
          if (bounds.contains([c.lat, c.lon])) {
            hits.push({ kind: "coord", id: c.id });
          }
        }
        // Lijnen / maatlijnen — match wanneer EEN van de twee endpoints
        // binnen de box valt (volle-include zou te strikt zijn voor
        // lange lijnen).
        for (const l of drawnLines) {
          if (
            bounds.contains([l.lat1, l.lon1]) ||
            bounds.contains([l.lat2, l.lon2])
          ) {
            hits.push({ kind: "line", id: l.id });
          }
        }
        // Overlay — match wanneer overlay-center binnen bounds
        if (overlay && overlay.centerLat != null && overlay.centerLon != null) {
          if (bounds.contains([overlay.centerLat, overlay.centerLon])) {
            hits.push({ kind: "overlay", id: overlay.id });
          }
        }
        setMultiSelection(hits);
        setSelection(null);
        if (hits.length > 0) {
          setToast(`${hits.length} object(en) geselecteerd — Delete om te verwijderen`);
          setTimeout(() => setToast(null), 2800);
        }
      }
      rect?.remove();
      rect = null;
      dragStart = null;
      // Freeze respecteren: de select-drag schakelde dragging tijdelijk
      // uit, maar onvoorwaardelijk her-inschakelen hief de freeze op —
      // daarna kon je 'bevroren' kaarten gewoon weer verslepen.
      if (!frozenRef.current) map.dragging.enable();
    };

    container.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && multiSelectionRef.current.length > 0) {
        setMultiSelection([]);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      container.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKey);
      rect?.remove();
      // Dit effect her-runt bij elke placed/rasters/lines/overlay-mutatie;
      // de cleanup mag een actieve freeze dus NIET opheffen (dat gebeurde
      // eerst wél — elk geplaatst object 'ontdooide' de kaart stilletjes).
      try { if (!frozenRef.current) map.dragging.enable(); } catch { /* map weg */ }
    };
  }, [placed, rasters, coordTags, drawnLines, overlay]);

  // ── Track meters-per-pixel for the scale bar ──────────────────
  // Sampled at the map centre by measuring the great-circle distance
  // between two pixels exactly 100 px apart. Re-runs on moveend +
  // zoomend so the schaalbar always reflects the *actual* rendered
  // scale, not the requested print scale (which can differ due to
  // Web Mercator distortion + container aspect-ratio fitBounds).
  //
  // Tweede taak: bewaar de centrum-lat/lon + zoom in `mapView`-state
  // zodat de tekening-state-snapshot (voor save naar .ifcgis) altijd
  // het actuele viewport bevat — anders zou je een project opslaan
  // dat naar het verkeerde gebied terug-laadt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const internal = map as unknown as { _panes?: { mapPane?: HTMLElement } };
      if (!internal._panes?.mapPane) return;
      try {
        const center = map.getCenter();
        const p1 = map.latLngToContainerPoint(center);
        const p2 = L.point(p1.x + 100, p1.y);
        const ll2 = map.containerPointToLatLng(p2);
        const dist = map.distance(center, ll2);
        if (Number.isFinite(dist) && dist > 0) setMPerPx(dist / 100);
        setMapView({ lat: center.lat, lon: center.lng, zoom: map.getZoom() });
      } catch {
        /* map torn down mid-frame — ignore */
      }
    };
    update();
    map.on("moveend", update);
    map.on("zoomend", update);
    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Paper render — vaste mm-grootte + CSS-transform voor de view ─
  // Het papier rendert ALTIJD op zijn werkelijke A2/A3 px-grootte
  // (594mm × 96/25.4 ≈ 2245 px voor A2). Op het scherm wordt het via
  // `transform: scale(viewScale)` verkleind zodat het hele kader in
  // de canvas past. Zo werkt een tekenprogramma (CAD): het papier
  // heeft een fysiek formaat, de viewport is een 'kijkglas' dat zoomt.
  // Title-block, schaalbar en kaartmarges staan in vaste paper-px op
  // het papier — die schalen automatisch mee met de view, blijven
  // dus visueel proportioneel hetzelfde t.o.v. het papier.
  //
  // Belangrijk: gebruik de exacte MM_TO_PX float (geen Math.round)
  // zodat de schaal-berekening pixel-perfect uitkomt. Anders schiet
  // bv. 1:500 naar 1:502.
  const paperLayout = useMemo(() => {
    const MM_TO_PX = 96 / 25.4;
    const { wMm, hMm } = PAPER_MM[paperSize];
    const pxW = wMm * MM_TO_PX;
    const pxH = hMm * MM_TO_PX;
    const pad = 32;
    const availW = Math.max(120, canvasSize.w - pad);
    const availH = Math.max(120, canvasSize.h - pad);
    // viewScale clamp op 1 zodat grote vensters het papier niet
    // verder vergroten dan zijn natuurlijke mm-grootte (anders worden
    // pixels onnodig vergroot).
    const viewScale = Math.min(availW / pxW, availH / pxH, 1);
    return { pxW, pxH, mmW: wMm, mmH: hMm, viewScale };
  }, [paperSize, canvasSize.w, canvasSize.h]);

  // Paper-zelf: vaste mm-px-grootte. Transform: scale verkleint het
  // visueel. transform-origin: 0 0 zodat het bij de linkerbovenhoek
  // van de stage uitlijnt — anders zit het halverwege buiten beeld.
  // Effectieve scale = base view-fit × user-zoom (alleen actief tijdens
  // freeze; zie wheel-handler hieronder).
  const effectiveScale = paperLayout.viewScale * tekView.z;
  const paperStyle = useMemo<React.CSSProperties>(
    () => ({
      width: `${paperLayout.pxW}px`,
      height: `${paperLayout.pxH}px`,
      transform: `scale(${effectiveScale})`,
      transformOrigin: "0 0",
      position: "absolute",
      left: 0,
      top: 0,
    }),
    [paperLayout.pxW, paperLayout.pxH, effectiveScale],
  );
  // Stage-wrapper: heeft de zichtbare (gescaled) afmetingen, zodat de
  // canvas-flex-layout de paper netjes kan centreren. Zonder deze
  // wrapper kent CSS de echte gescaled-grootte niet (transform raakt
  // alleen rendering, niet de layout-box). De pan-offset (alleen bij
  // freeze ≠ 0) verschuift de stage als geheel.
  const paperStageStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "relative",
      width: `${paperLayout.pxW * effectiveScale}px`,
      height: `${paperLayout.pxH * effectiveScale}px`,
      flex: "0 0 auto",
      transform: `translate(${tekView.x}px, ${tekView.y}px)`,
    }),
    [paperLayout.pxW, paperLayout.pxH, effectiveScale, tekView.x, tekView.y],
  );

  // Wheel-zoom op de canvas wanneer frozen aanstaat — zoomt NAAR DE
  // CURSOR toe (het punt onder de muis blijft op zijn plek) i.p.v. vast
  // aan linksboven, door de pan-offset mee te schalen. Native
  // addEventListener met passive:false zodat preventDefault werkt
  // (React's onWheel is standaard passive).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!frozenRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      setTekView((v) => {
        const nz = Math.min(8, Math.max(0.25, v.z * factor));
        const f = nz / v.z;
        // Cursor-punt vasthouden: pan zo bijstellen dat (cx,cy) —
        // gemeten t.o.v. het canvas-midden (flex-centrering) — vóór en
        // ná de zoom op hetzelfde schermpunt ligt.
        return { z: nz, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pan-drag op het bevroren papier: plain klik+sleep verschuift de
  // stage (CSS-translate). Alleen actief bij freeze en zonder actieve
  // plaats/teken/coord-modus zodat een gewone klik die tools blijft
  // bedienen; een drag-drempel van 3 px laat klikken ongemoeid.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let start: { mx: number; my: number; x: number; y: number } | null = null;
    let panning = false;
    const onDown = (e: MouseEvent) => {
      if (!frozenRef.current || e.button !== 0 || e.shiftKey) return;
      if (placeModeRef.current || drawModeRef.current || coordModeRef.current || cadModeRef.current) return;
      const v = tekViewRef.current;
      start = { mx: e.clientX, my: e.clientY, x: v.x, y: v.y };
    };
    const onMove = (e: MouseEvent) => {
      if (!start) return;
      const dx = e.clientX - start.mx;
      const dy = e.clientY - start.my;
      if (!panning && Math.hypot(dx, dy) < 3) return;
      panning = true;
      e.preventDefault();
      setTekView((v) => ({ ...v, x: start!.x + dx, y: start!.y + dy }));
    };
    const onUp = () => {
      start = null;
      panning = false;
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      className={`tek-view${frozen ? " tek-view-frozen" : ""}`}
      ref={containerRef}
    >
      {/* Topbar verwijderd — papier + schaal worden gestuurd vanuit
          de TekeningProperties paneel rechts. Export PDF is uit het
          topbar gehaald (gebruik Bestand → Print of de ribbon-PDF
          knop). */}
      <div className="tek-canvas" ref={canvasRef}>
        <div className="tek-paper-stage" style={paperStageStyle}>
        <div
          className={`tek-paper tek-paper-${paperSize}${dragOver ? " tek-paper-dragover" : ""}${frozen ? " tek-paper-frozen" : ""}${placeMode || drawMode || coordMode ? " tek-paper-placing" : ""}`}
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
          {/* Schaalstok — bovenop de kaart-viewport, linksonder net
              boven het titleblock. Bar-lengte wordt afgeleid uit de
              ACTUELE Leaflet meters-per-pixel (mPerPx), zodat hij
              zowel het print-scale als de extra zoom van de gebruiker
              correct weergeeft. */}
          <ScaleBar mPerPx={mPerPx} paperPxW={paperLayout.pxW} />
          {/* Noordpijl — rechtsboven, vaste mm-grootte op papier
              (~22mm hoog). Rotatie 0 = noord boven (Web Mercator
              heeft geen rotatie). Bedrukt op het papier zoals een
              traditionele tekening; bedoeld vooral voor de PDF-print. */}
          <NorthArrow />
          {/* Title block (Detailblad layout — mirrors page 2 of
              OpenAEC-style-book/preview-titleblock.html). A bottom-strip
              title bar with a project header row + 2×3 cell grid + logo
              cell on the left + format corner on the right. */}
          <div className="tek-titleblock-db">
            {/* Project bar — full width */}
            <div className="tek-db-project-bar">
              {/* Klikbare projectnaam — opens inline edit. Werkt
                  zelfde als de schaal-cel: klik = focus, Enter/blur
                  = commit, Escape = cancel. Pointer-events: auto
                  via titleblock-classes. */}
              <input
                className="tek-dbp-title tek-dbp-edit"
                type="text"
                value={titleBlock.project}
                placeholder="Projectnaam"
                onChange={(e) =>
                  setTitleBlock((tb) => ({ ...tb, project: e.target.value }))
                }
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.currentTarget.blur();
                  }
                }}
                title="Klik om de projectnaam aan te passen"
              />
              <input
                className="tek-dbp-address tek-dbp-edit"
                type="text"
                value={titleBlock.address}
                placeholder="Straatnaam, huisnummer, projectplaats"
                onChange={(e) =>
                  setTitleBlock((tb) => ({ ...tb, address: e.target.value }))
                }
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.currentTarget.blur();
                  }
                }}
                title="Klik om het adres aan te passen"
              />
              <span className="tek-dbp-type">Situatietekening</span>
            </div>
            {/* Body grid: logo | metadata cells | format corner */}
            <div className="tek-db-body">
              {/* Klikbare logo-cel. Toont default OpenAEC-driehoek
                  of een custom geüpload logo (image/svg data-URL).
                  Klik = open file picker; bij selectie wordt het
                  bestand als data-URL bewaard en hier gerenderd. */}
              <button
                type="button"
                className="tek-db-logo-cell tek-db-logo-clickable"
                onClick={() => logoInputRef.current?.click()}
                title="Klik om je eigen logo te kiezen (PNG / JPG / SVG)"
              >
                {customLogo ? (
                  <img
                    src={customLogo}
                    alt="Bedrijfslogo"
                    className="tek-db-logo-custom"
                  />
                ) : (
                  <>
                    <svg width="34" height="38" viewBox="0 0 80 88" fill="none" aria-hidden>
                      <g transform="translate(40, 12)">
                        <polygon points="0,0 -30,17 0,34 30,17" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinejoin="round" />
                        <polygon points="-30,17 -30,56 0,73 0,34" fill="none" stroke="#D97706" strokeWidth="2" strokeLinejoin="round" />
                        <polygon points="30,17 30,56 0,73 0,34" fill="none" stroke="#A1A1AA" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
                      </g>
                    </svg>
                    <div className="tek-db-logo-text">Open<span>AEC</span></div>
                    <div className="tek-db-logo-sub">Geotechniek</div>
                  </>
                )}
              </button>
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
                  <ScaleCellEditor
                    liveScale={
                      mPerPx > 0
                        ? Math.round(
                            ((paperLayout.pxW / paperLayout.mmW) * mPerPx) * 1000,
                          )
                        : scale
                    }
                  />
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Formaat</div>
                  <div className="tek-db-cell-val mono">{paperSize}</div>
                </div>
                <div className="tek-db-cell">
                  <div className="tek-db-cell-label">Projectnr</div>
                  <div className="tek-db-cell-val mono amber">{titleBlock.projectNumber || "—"}</div>
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
        </div>

        {/* Toolbox aside is gone — all visible buttons moved to the
            ribbon (SonderingstekeningTab) and the right-side Properties
            panel (TekeningProperties). Only the hidden file inputs
            survive here so the ribbon's "Tekening toevoegen" / "Kader
            laden" buttons can trigger them. */}
        <div style={{ display: "none" }} aria-hidden>
          <input
            ref={overlayInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.svg,.dwg,.dxf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={frameInputRef}
            type="file"
            accept=".svg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFrameFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              // FileReader → data-URL zodat het logo zelfcontained
              // in state staat (overleeft een tab-switch + komt
              // mee in een .ifcgis title-block).
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === "string") {
                  setCustomLogo(reader.result);
                }
              };
              reader.onerror = () => {
                setToast("Kon logo niet lezen");
                setTimeout(() => setToast(null), 2200);
              };
              reader.readAsDataURL(f);
            }}
          />
        </div>
      </div>

      {toast && <div className="tek-toast">{toast}</div>}

      {/* Crop step for raster-image overlays. Shown after the user
          picks a jpg/png/webp via the ribbon or drag-drop, before the
          image lands on the paper. Confirm → setOverlay with the
          cropped PNG; cancel → drop the object URL and forget. */}
      {cropPending && (
        <ImageCropDialog
          imageSrc={cropPending.src}
          fileName={cropPending.name}
          onCancel={() => {
            URL.revokeObjectURL(cropPending.src);
            setCropPending(null);
          }}
          onConfirm={(croppedDataUrl) => {
            URL.revokeObjectURL(cropPending.src);
            setOverlay({
              id: `o-${Date.now()}`,
              kind: "image",
              name: cropPending.name,
              src: croppedDataUrl,
            });
            setCropPending(null);
          }}
        />
      )}

      {/* Two-phase PDF importer: page picker → crop stage. On confirm
          the cropped PNG becomes a normal image overlay so the rest
          of the pipeline (Leaflet imageOverlay, PDF export, etc.)
          doesn't need to know it came from a PDF. */}
      {pdfCropPending && (
        <PdfCropDialog
          pdfSrc={pdfCropPending.src}
          fileName={pdfCropPending.name}
          onCancel={() => {
            URL.revokeObjectURL(pdfCropPending.src);
            setPdfCropPending(null);
          }}
          onConfirm={(croppedDataUrl) => {
            URL.revokeObjectURL(pdfCropPending.src);
            setOverlay({
              id: `o-${Date.now()}`,
              kind: "image",
              name: pdfCropPending.name,
              src: croppedDataUrl,
            });
            setPdfCropPending(null);
          }}
        />
      )}

      {/* Vraag-3-offertes dialog — gevuld met de actuele project-
          locatie (eerste geplaatste marker, anders mapView-center),
          titleBlock-velden, en het totaal aantal sonderingen
          (losse markers + raster-cellen). De dialog sorteert
          sondeerbedrijven op afstand en biedt mailto-aanvragen. */}
      <OffertesDialog
        open={offertesOpen}
        onClose={() => setOffertesOpen(false)}
        projectName={titleBlock.project || project?.title || ""}
        projectNumber={
          titleBlock.projectNumber || project?.number || ""
        }
        projectLat={placed[0]?.lat ?? mapView.lat}
        projectLon={placed[0]?.lon ?? mapView.lon}
        projectAddress={titleBlock.address}
        aantalSonderingen={
          placed.length + rasters.reduce((s, r) => s + r.rows * r.cols, 0)
        }
      />

      {/* IFCX preview — leest dezelfde payload als de save-flow en
          laat de gebruiker zien welke IFC-entities er in het
          .ifcgis bestand komen wanneer ze opslaan. */}
      <IfcxPreviewDialog
        open={ifcxPreviewOpen}
        onClose={() => setIfcxPreviewOpen(false)}
      />
    </div>
  );
}

/**
 * Schaalbar / scale-bar — een papier-print-stijl meetlat in de hoek
 * van de tekening. Werkt op basis van de ACTUELE meters-per-pixel
 * van Leaflet (mPerPx), niet de print-schaal: zo blijft hij correct
 * wanneer de gebruiker met de muiswiel in/uit zoomt, en wanneer
 * Leaflet's Web Mercator-projectie + container-aspect zorgen dat de
 * echte schaal afwijkt van het 1:N getal in de TekeningProperties.
 *
 * De bar streeft naar ≈ 25% van de paper-breedte; daarbinnen wordt
 * een 'nette' rond meter-aantal uit een ladder gekozen, en de bar
 * krijgt 4 (10/20/40/...) of 5 (50/100/500/...) segmenten zodat de
 * onderschriften altijd hele meters zijn.
 */
const SCALE_BAR_LADDER = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
];
function pickNiceScaleMeters(maxM: number): number {
  let best = SCALE_BAR_LADDER[0];
  for (const v of SCALE_BAR_LADDER) {
    if (v <= maxM) best = v;
    else break;
  }
  return best;
}
/**
 * Inline-editable Schaal-cel voor het titleblock. Toont de live-
 * berekende schaal als "1:N"; klikken/focussen schakelt naar bewerken,
 * Enter of blur stuurt `ogs:tekening-set-scale` met de getypte waarde
 * (accepteert "1:850", "850", "1 : 850" en wat-niet) — dat reset de
 * Leaflet fitBounds zodat de tekening exact die schaal aanneemt.
 */
function ScaleCellEditor({ liveScale }: { liveScale: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? `1:${liveScale}`;
  const commit = () => {
    if (draft === null) return;
    // Pak het laatste hele getal uit de string — pakt "850", "1:850",
    // "1 : 850" en "schaal 1:850" allemaal correct.
    const m = draft.match(/(\d+)\s*$/);
    const n = m ? parseInt(m[1], 10) : NaN;
    if (Number.isFinite(n) && n >= 50 && n <= 100000) {
      window.dispatchEvent(
        new CustomEvent("ogs:tekening-set-scale", { detail: { scale: n } }),
      );
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      className="tek-db-cell-val mono tek-db-cell-input"
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        if (draft === null) setDraft(value);
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      title="Klik om de schaal aan te passen (bv. 1:850)"
    />
  );
}

/**
 * Noordpijl rechtsboven op het papier. Traditionele bouwkundige
 * vorm: een pijl met "N" boven. Zwart gevuld met witte achtergrond
 * + dunne border zodat hij over elke base-layer leesbaar blijft.
 * Vaste mm-grootte op het papier (CSS px = 96/25.4 × mm).
 */
function NorthArrow() {
  // 3x grotere noordpijl (was 40×60, nu 120×180). Zelfde viewBox
  // zodat de SVG-paths niet hoeven te schalen — alleen de
  // weergavegrootte verandert.
  return (
    <div className="tek-north-arrow" aria-label="Noordpijl">
      <svg viewBox="0 0 40 60" width="120" height="180" xmlns="http://www.w3.org/2000/svg">
        {/* Witte ronde achtergrond zodat de pijl over luchtfoto leesbaar is */}
        <circle cx="20" cy="32" r="18" fill="white" stroke="#111" strokeWidth="0.8" />
        {/* N letter boven de pijl */}
        <text
          x="20"
          y="14"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize="11"
          fontWeight="700"
          fill="#111"
        >
          N
        </text>
        {/* Pijl: zwarte halve = noordpunt, witte halve = zuidpunt.
            Klassieke kompas-stijl. */}
        <polygon points="20,18 14,46 20,40" fill="#111" stroke="#111" strokeWidth="0.4" />
        <polygon points="20,18 26,46 20,40" fill="white" stroke="#111" strokeWidth="0.4" />
        {/* Center punt */}
        <circle cx="20" cy="40" r="1.2" fill="#111" />
      </svg>
    </div>
  );
}

function ScaleBar({
  mPerPx,
  paperPxW,
}: {
  mPerPx: number;
  paperPxW: number;
}) {
  // Tot Leaflet klaar is met initialiseren is mPerPx 0 — nog niets
  // te tonen, anders division-by-zero.
  if (!mPerPx || !Number.isFinite(mPerPx) || mPerPx <= 0) return null;

  // Schaalbalk "moet meebewegen met de schaal": kies een vaste meter-
  // waarde per scale-range, en laat de visuele breedte VARIËREN met
  // de huidige print-schaal. Dat is hoe een traditionele bouwkundig-
  // schaalbalk werkt: bij 1:500 is een 25 m bar 50mm breed op papier,
  // bij 1:1000 is dezelfde 25m maar 25mm breed.
  //
  // Print-schaal afleiden uit de actuele mPerPx + paper-grootte:
  //   scale_N = mPerPx × paperPxW / paperMmW × 1000
  //           = mPerPx × MM_TO_PX × 1000   (paperPxW/paperMmW = MM_TO_PX)
  // Bij 1:500 en MM_TO_PX = 3.78 → N ≈ 500.
  const MM_TO_PX = 96 / 25.4;
  const printN = mPerPx * MM_TO_PX * 1000;

  // Gebruiker-verzoek: schaalbalk ALTIJD in stappen van 5 meter met
  // labels 0 / 5 / 10 / 15 / ... De count varieert per print-schaal
  // zodat de bar een redelijke papier-lengte heeft (~50mm target):
  //
  //   1:500  →  5 stappen ×5m = 25m bar = 50mm op papier
  //   1:1000 → 10 stappen ×5m = 50m bar = 50mm op papier
  //   1:2000 → cap op 12 → 60m bar = 30mm
  //   1:5000 → cap op 12 → 60m bar = 12mm (klein maar leesbaar)
  //
  // Cap op 12 segmenten zodat de label-rij niet ondoorzienlijk wordt
  // bij hele zoom-out-scales. Safety-net pakt extreme zoom-IN scenarios
  // (1:100 en kleiner) waar 5m al > 60% papier zou worden.
  const TARGET_BAR_PX = 50 * MM_TO_PX;
  let segM = 5;
  let count = Math.round(TARGET_BAR_PX / (segM / mPerPx));
  count = Math.max(4, Math.min(12, count));
  let totalM = segM * count;
  // Safety-net: als de bar buitenproportioneel breed wordt (b.v.
  // extreme zoom-in zoals 1:100 waar 5m al > 60% paper is), val
  // terug op een nice-round value zodat de bar nog binnen het papier
  // past — labels dan dynamisch gegenereerd uit pickNiceScaleMeters.
  const proposedPx = totalM / mPerPx;
  if (proposedPx > paperPxW * 0.6) {
    const targetPx = Math.max(80, paperPxW * 0.25);
    totalM = pickNiceScaleMeters(targetPx * mPerPx);
    const fd = parseInt(String(totalM).charAt(0), 10);
    count = fd === 5 || fd === 1 ? 5 : 4;
    segM = totalM / count;
  }
  void printN;
  const barPx = totalM / mPerPx;
  const segPx = barPx / count;

  // Tick-onderschriften.
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(+(i * segM).toFixed(2));

  /* Padding + label-ruimte 2× (gebruiker-verzoek: schaalstok-teksten
     groter). svgH groeit van 24 → 40 zodat de 14pt labels eronder
     passen, "m"-eenheid offset mee-geschaald. */
  const padding = 8;
  const svgW = Math.round(barPx + padding * 2 + 24);
  const svgH = 40;
  const barY = 4;
  const barH = 10;

  return (
    <div className="tek-scale-bar">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
        {/* Bar buitenkader */}
        <rect
          x={padding}
          y={barY}
          width={barPx}
          height={barH}
          fill="none"
          stroke="#111"
          strokeWidth="0.8"
        />
        {/* Alternerende zwart/wit segmenten */}
        {Array.from({ length: count }).map((_, i) => (
          <rect
            key={i}
            x={padding + i * segPx}
            y={barY}
            width={segPx}
            height={barH}
            fill={i % 2 === 0 ? "#111" : "#fff"}
            stroke="#111"
            strokeWidth="0.5"
          />
        ))}
        {/* Tick-labels onder de bar — fontSize 7 → 14 (gebruiker-verzoek
            "schaalstof teksten 2x zo groot"). */}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={padding + i * segPx}
            y={barY + barH + 16}
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="14"
            fontWeight="600"
            textAnchor="middle"
            fill="#111"
          >
            {Number.isInteger(t) ? t : t.toFixed(1)}
          </text>
        ))}
        {/* "m" eenheid achter de laatste tick */}
        <text
          x={padding + barPx + 6}
          y={barY + barH + 16}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="14"
          fontWeight="600"
          fill="#111"
        >
          m
        </text>
      </svg>
    </div>
  );
}
