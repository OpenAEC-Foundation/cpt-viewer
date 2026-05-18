/**
 * Module-level cache van de volledige Sonderingstekening-state.
 *
 * Waarom geen Zustand:
 *   De tekening-state leeft van origine lokaal in SonderingstekeningView
 *   (complexe Leaflet-handlers, refs, drag-states). Een full-blown store
 *   zou die view forceren tot dubbele state-sync. We hebben alleen een
 *   buiten-de-view leesbare snapshot nodig op SAVE-tijd (Backstage →
 *   `save_project_ifcgis_full`) en een queue voor OPEN-tijd (laden van
 *   .ifcgis-bestand zet pending-restore, view consumeert op mount).
 *
 * Layout:
 *   - latest()    → de meest recente snapshot, gepubliceerd door
 *                   SonderingstekeningView via setLatest(...). Wordt
 *                   gebruikt door saveProject om de tekening-sectie van
 *                   het .ifcgis bestand te bouwen.
 *   - setLatest() → schrijf de huidige tekening-state vanuit de view.
 *   - setPendingRestore() → openProjectIfcgis zet hier de geladen
 *                   tekening-layout zodat de view die later kan
 *                   herstellen.
 *   - consumePendingRestore() → leest + wist; bedoeld voor de mount-
 *                   useEffect van SonderingstekeningView.
 *
 * Coordinate-system: lat/lon in WGS84 (EPSG:4326), zoals Leaflet
 * intern werkt. De conversie naar RD (EPSG:28992) doet de Rust-side
 * niet — `crs.epsg=28992` in het ifcgis bestand documenteert alleen
 * dat de ruwe CPT/Bore-data RD is; de tekening-coördinaten staan
 * expliciet in lat/lon.
 */

export interface TekeningMarker {
  id: string;
  kind: "sondering" | "bore";
  lat: number;
  lon: number;
  kleefmeting?: boolean;
}

export interface TekeningRaster {
  id: string;
  centerLat: number;
  centerLon: number;
  rows: number;
  cols: number;
  spacingX: number;
  spacingY: number;
  rotation: number;
}

export interface TekeningLine {
  id: string;
  kind: "line" | "dimension";
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
}

export interface TekeningCoordTag {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

export interface TekeningOverlay {
  id: string;
  name: string;
  kind: "image" | "svg" | "pdf" | "dwg";
  src?: string;
  widthMeters: number;
  centerLat?: number;
  centerLon?: number;
}

export interface TekeningTitleBlock {
  project: string;
  projectNumber: string;
  address: string;
  drawingNumber: string;
  scale: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  version: string;
}

export interface TekeningCenter {
  lat: number;
  lon: number;
  zoom: number;
}

export interface TekeningFullState {
  paperSize: "A2" | "A3";
  scale: number;
  center: TekeningCenter;
  markers: TekeningMarker[];
  rasters: TekeningRaster[];
  lines: TekeningLine[];
  coordTags: TekeningCoordTag[];
  overlay: TekeningOverlay | null;
  titleBlock: TekeningTitleBlock;
}

let latest: TekeningFullState | null = null;
let pendingRestore: TekeningFullState | null = null;

export function setLatestTekening(state: TekeningFullState): void {
  latest = state;
}

export function getLatestTekening(): TekeningFullState | null {
  return latest;
}

export function setPendingTekeningRestore(state: TekeningFullState | null): void {
  pendingRestore = state;
}

/**
 * Read + clear the pending-restore payload. Use this in the
 * SonderingstekeningView mount-effect so a freshly opened project
 * restores its tekening, and a subsequent re-mount doesn't re-apply
 * stale data.
 */
export function consumePendingTekeningRestore(): TekeningFullState | null {
  const r = pendingRestore;
  pendingRestore = null;
  return r;
}

/**
 * Convert the frontend TekeningFullState into the snake_case JSON
 * shape expected by Rust's `ifcgis::TekeningLayout`. Use during save.
 */
export function tekeningStateToIfcgis(s: TekeningFullState): unknown {
  return {
    paper_size: s.paperSize,
    scale: s.scale,
    center: { lat: s.center.lat, lon: s.center.lon, zoom: s.center.zoom },
    markers: s.markers.map((m) => ({
      id: m.id,
      kind: m.kind,
      lat: m.lat,
      lon: m.lon,
      ...(m.kleefmeting ? { kleefmeting: true } : {}),
    })),
    rasters: s.rasters.map((r) => ({
      id: r.id,
      center_lat: r.centerLat,
      center_lon: r.centerLon,
      rows: r.rows,
      cols: r.cols,
      spacing_x: r.spacingX,
      spacing_y: r.spacingY,
      rotation: r.rotation,
    })),
    lines: s.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      lat1: l.lat1,
      lon1: l.lon1,
      lat2: l.lat2,
      lon2: l.lon2,
    })),
    coord_tags: s.coordTags.map((c) => ({
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      ...(c.label ? { label: c.label } : {}),
    })),
    overlay: s.overlay
      ? {
          id: s.overlay.id,
          name: s.overlay.name,
          kind: s.overlay.kind,
          ...(s.overlay.src ? { src: s.overlay.src } : {}),
          width_meters: s.overlay.widthMeters,
          ...(s.overlay.centerLat !== undefined
            ? { center_lat: s.overlay.centerLat }
            : {}),
          ...(s.overlay.centerLon !== undefined
            ? { center_lon: s.overlay.centerLon }
            : {}),
        }
      : null,
  };
}

/**
 * Map a snake_case ifcgis tekening payload back into the frontend's
 * camelCase shape. Use during open (after invoke returns the JSON).
 */
export function tekeningStateFromIfcgis(j: unknown): TekeningFullState | null {
  if (!j || typeof j !== "object") return null;
  const t = j as Record<string, unknown>;
  const center = t.center as { lat: number; lon: number; zoom: number } | undefined;
  if (!center) return null;
  const markers = (Array.isArray(t.markers) ? t.markers : []).map(
    (m: Record<string, unknown>) => ({
      id: String(m.id),
      kind: (m.kind === "bore" ? "bore" : "sondering") as "sondering" | "bore",
      lat: Number(m.lat),
      lon: Number(m.lon),
      kleefmeting: Boolean(m.kleefmeting),
    }),
  );
  const rasters = (Array.isArray(t.rasters) ? t.rasters : []).map(
    (r: Record<string, unknown>) => ({
      id: String(r.id),
      centerLat: Number(r.center_lat),
      centerLon: Number(r.center_lon),
      rows: Number(r.rows),
      cols: Number(r.cols),
      spacingX: Number(r.spacing_x),
      spacingY: Number(r.spacing_y),
      rotation: Number(r.rotation),
    }),
  );
  const lines = (Array.isArray(t.lines) ? t.lines : []).map(
    (l: Record<string, unknown>) => ({
      id: String(l.id),
      kind: (l.kind === "dimension" ? "dimension" : "line") as
        | "line"
        | "dimension",
      lat1: Number(l.lat1),
      lon1: Number(l.lon1),
      lat2: Number(l.lat2),
      lon2: Number(l.lon2),
    }),
  );
  const coordTags = (Array.isArray(t.coord_tags) ? t.coord_tags : []).map(
    (c: Record<string, unknown>) => ({
      id: String(c.id),
      lat: Number(c.lat),
      lon: Number(c.lon),
      label: typeof c.label === "string" ? c.label : undefined,
    }),
  );
  const overlayObj = t.overlay as Record<string, unknown> | null | undefined;
  const overlay = overlayObj
    ? {
        id: String(overlayObj.id),
        name: String(overlayObj.name),
        kind: (["image", "svg", "pdf", "dwg"].includes(String(overlayObj.kind))
          ? overlayObj.kind
          : "image") as "image" | "svg" | "pdf" | "dwg",
        src: typeof overlayObj.src === "string" ? overlayObj.src : undefined,
        widthMeters: Number(overlayObj.width_meters ?? 100),
        centerLat:
          typeof overlayObj.center_lat === "number"
            ? overlayObj.center_lat
            : undefined,
        centerLon:
          typeof overlayObj.center_lon === "number"
            ? overlayObj.center_lon
            : undefined,
      }
    : null;
  return {
    paperSize: (t.paper_size === "A3" ? "A3" : "A2") as "A2" | "A3",
    scale: Number(t.scale) || 1000,
    center: {
      lat: Number(center.lat),
      lon: Number(center.lon),
      zoom: Number(center.zoom),
    },
    markers,
    rasters,
    lines,
    coordTags,
    overlay,
    titleBlock: {
      project: "",
      projectNumber: "",
      address: "",
      drawingNumber: "",
      scale: "",
      date: "",
      drawnBy: "",
      checkedBy: "",
      version: "",
    },
  };
}

/**
 * Convert a frontend TitleBlock to the snake_case shape expected by
 * Rust's `ifcgis::TitleBlock`. Used during save.
 */
export function titleBlockToIfcgis(tb: TekeningTitleBlock): unknown {
  return {
    project: tb.project,
    project_number: tb.projectNumber,
    address: tb.address,
    drawing_number: tb.drawingNumber,
    scale: tb.scale,
    date: tb.date,
    drawn_by: tb.drawnBy,
    checked_by: tb.checkedBy,
    version: tb.version,
  };
}

/** Inverse of `titleBlockToIfcgis`. */
export function titleBlockFromIfcgis(j: unknown): TekeningTitleBlock | null {
  if (!j || typeof j !== "object") return null;
  const t = j as Record<string, unknown>;
  return {
    project: String(t.project ?? ""),
    projectNumber: String(t.project_number ?? ""),
    address: String(t.address ?? ""),
    drawingNumber: String(t.drawing_number ?? ""),
    scale: String(t.scale ?? ""),
    date: String(t.date ?? ""),
    drawnBy: String(t.drawn_by ?? ""),
    checkedBy: String(t.checked_by ?? ""),
    version: String(t.version ?? ""),
  };
}
