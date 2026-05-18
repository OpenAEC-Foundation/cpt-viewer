import * as L from "leaflet";
import {
  fetchKadasterHuisnummerLabel,
  fetchKadasterStraatLabel,
  type WfsBBox,
} from "./pdokWfs";
import "./adressenLayer.css";

/**
 * Adressen-overlay: street + house-number labels rendered as Leaflet
 * `divIcon` markers backed by PDOK BAG WFS data.
 *
 * Why WFS instead of a labels-WMS tile or CartoDB labels: the user wants
 * authoritative Dutch street-name / huisnummer data with exact positions
 * (so they can be re-styled for the Sonderingstekening print) instead of
 * server-rasterised tiles. We fetch `bag:openbareruimte` (street polygons
 * → centroid) and `bag:nummeraanduiding` (point features) and render one
 * `L.marker` per result using a transparent `L.divIcon` that holds the
 * actual text.
 *
 * The overlay is *zoom-gated* on the renderer side: at very low zoom it
 * would otherwise either fetch thousands of features or render unreadable
 * text. House numbers appear from z ≥ 17, street labels from z ≥ 15.
 *
 * Each `AdressenLayer` owns:
 *   - a `LayerGroup` that's attached to / detached from the map by the
 *     existing GIS-layer-toggle machinery,
 *   - an in-flight `AbortController` so a fast map-pan doesn't pile up
 *     overlapping requests,
 *   - and the latest fetched bbox so a tiny mouse-wiggle inside the
 *     viewport doesn't trigger redundant work.
 */
export class AdressenLayer {
  /** Public — the actual Leaflet layer the toggle machinery uses. */
  readonly group: L.LayerGroup;

  private map: L.Map | null = null;
  private inflight: AbortController | null = null;
  private lastBboxKey = "";
  private opacity = 1;
  private listeners: { event: string; handler: () => void }[] = [];

  constructor() {
    this.group = L.layerGroup();
  }

  /** Attach the layer to a map. Idempotent. */
  attach(map: L.Map): void {
    if (this.map) return;
    this.map = map;
    const refresh = () => void this.refresh();
    map.on("moveend", refresh);
    map.on("zoomend", refresh);
    this.listeners = [
      { event: "moveend", handler: refresh },
      { event: "zoomend", handler: refresh },
    ];
    // Initial fetch — guarded by zoom thresholds in `refresh()`.
    void this.refresh();
  }

  /** Detach + clear. After this the LayerGroup is empty and quiet. */
  detach(): void {
    if (!this.map) return;
    for (const l of this.listeners) {
      this.map.off(l.event, l.handler);
    }
    this.listeners = [];
    this.inflight?.abort();
    this.inflight = null;
    this.lastBboxKey = "";
    this.group.clearLayers();
    this.map = null;
  }

  /** Set CSS opacity of every label currently in the group. */
  setOpacity(value: number): void {
    this.opacity = Math.max(0, Math.min(1, value));
    this.group.eachLayer((layer) => {
      const m = layer as L.Marker;
      if (m.setOpacity) m.setOpacity(this.opacity);
    });
  }

  /** Re-fetch + redraw for the current viewport. Safe to call many times. */
  async refresh(): Promise<void> {
    const map = this.map;
    if (!map) return;
    const zoom = map.getZoom();
    // Anything below 13 is mostly noise (entire neighbourhoods of streets
    // smushed into a few px). Streets from z≥13, huisnummers from z≥16.
    if (zoom < 13) {
      this.inflight?.abort();
      this.inflight = null;
      this.group.clearLayers();
      this.lastBboxKey = "";
      return;
    }
    const b = map.getBounds();
    const bbox: WfsBBox = {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    };
    // Cheap dedupe — if the viewport didn't change meaningfully since
    // the last fetch we skip the round-trip. Coarse rounding so a tiny
    // sub-arcsec wiggle doesn't re-fetch.
    const key = [
      zoom,
      bbox.south.toFixed(5),
      bbox.west.toFixed(5),
      bbox.north.toFixed(5),
      bbox.east.toFixed(5),
    ].join(",");
    if (key === this.lastBboxKey) return;
    this.lastBboxKey = key;

    // Cancel any in-flight fetch and start a new pair.
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const fetchStart = performance.now();
    try {
      const tasks: Promise<GeoJSON.FeatureCollection | null>[] = [
        fetchKadasterStraatLabel(bbox, ctrl.signal),
      ];
      if (zoom >= 16) {
        tasks.push(fetchKadasterHuisnummerLabel(bbox, ctrl.signal));
      } else {
        tasks.push(Promise.resolve(null));
      }
      const [streets, numbers] = await Promise.all(tasks);
      if (ctrl.signal.aborted || this.map !== map) {
        // Stale response — drop the bbox-key so the next refresh tries again.
        this.lastBboxKey = "";
        return;
      }
      // Visible debug feedback so the user (or we) can verify what the
      // WFS actually returned — open devtools (F12) and look for the
      // "[adressenLayer]" prefix.
      const streetsN = streets?.features.length ?? 0;
      const numbersN = numbers?.features.length ?? 0;
      const ms = Math.round(performance.now() - fetchStart);
      console.info(
        `[adressenLayer] z=${zoom} → ${streetsN} straatlabels / ${numbersN} huisnr-reeksen (${ms}ms)`,
      );
      this.group.clearLayers();
      if (streets) this.renderStreets(streets);
      if (numbers) this.renderHouseNumbers(numbers);
    } catch (err) {
      console.warn("[adressenLayer] refresh failed", err);
      // Allow retry on next pan/zoom.
      this.lastBboxKey = "";
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  // ── private rendering ────────────────────────────────────────

  private renderStreets(fc: GeoJSON.FeatureCollection): void {
    let rendered = 0;
    for (const f of fc.features) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const tekst =
        typeof props.tekst === "string"
          ? props.tekst
          : typeof props.text === "string"
            ? props.text
            : null;
      if (!tekst) continue;
      const point = pointCoord(f.geometry);
      if (!point) continue;
      const rot = labelRotation(props);
      const upper = tekst.toUpperCase();
      const styleAttr = `--rot:${rot}deg`;
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: "adres-label adres-label-street",
          html: `<span style="${styleAttr}">${escapeHtml(upper)}</span>`,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        opacity: this.opacity,
      });
      this.group.addLayer(marker);
      rendered++;
    }
    console.info(`[adressenLayer] streets rendered: ${rendered}`);
  }

  private renderHouseNumbers(fc: GeoJSON.FeatureCollection): void {
    let rendered = 0;
    for (const f of fc.features) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const tekst =
        typeof props.tekst === "string"
          ? props.tekst
          : typeof props.text === "string"
            ? props.text
            : null;
      if (!tekst) continue;
      const point = pointCoord(f.geometry);
      if (!point) continue;
      const rot = labelRotation(props);
      const styleAttr = `--rot:${rot}deg`;
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: "adres-label adres-label-number",
          html: `<span style="${styleAttr}">${escapeHtml(tekst)}</span>`,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        opacity: this.opacity,
      });
      this.group.addLayer(marker);
      rendered++;
    }
    console.info(`[adressenLayer] huisnummers rendered: ${rendered}`);
  }
}

/** Read the BGT `hoek` rotation property (degrees, compass-style:
 *  0 = north / vertical-up). Returns a CSS-friendly rotation where
 *  0 = horizontal text reading left→right, positive = rotate clockwise
 *  (standard CSS rotate direction). We also clamp the angle into the
 *  ±90° range so labels never read upside-down — flipping the sign of
 *  the upper / lower hemisphere keeps every street name right-side-up. */
function labelRotation(props: Record<string, unknown>): number {
  const raw =
    typeof props.hoek === "number"
      ? props.hoek
      : typeof props.rotation === "number"
        ? props.rotation
        : 0;
  // Kadaster's `hoek` voor OpenbareRuimteNaam / Nummeraanduidingreeks
  // is gemeten in graden CW vanaf horizontaal (lees-richting), met
  // de oorsprong op het plaatsingspunt — dezelfde conventie als CSS
  // `rotate()`. Eerder werd het sign onterecht geflipt waardoor de
  // straatnamen tegen de straat-as in roteerden; nu geven we de
  // ruwe waarde door en normaliseren alleen voor leesbaarheid.
  let deg = raw;
  // Normalise to (-180, 180].
  while (deg > 180) deg -= 360;
  while (deg <= -180) deg += 360;
  // Keep within ±90° so text never reads upside-down.
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return Math.round(deg * 10) / 10;
}

// ─── helpers ────────────────────────────────────────────────────

/** Approximate centroid for a GeoJSON geometry (Point/Polygon/MultiPolygon).
 *  Pure JS averaging — good enough for label positioning of municipal
 *  street polygons; no turf dependency. */
function centroid(geom: GeoJSON.Geometry | null): L.LatLngTuple | null {
  if (!geom) return null;
  if (geom.type === "Point") {
    const c = geom.coordinates;
    return [c[1], c[0]];
  }
  if (geom.type === "Polygon") {
    return averageCoords(geom.coordinates[0]);
  }
  if (geom.type === "MultiPolygon") {
    // Pick the largest ring by point count — usually the dominant body.
    let best: GeoJSON.Position[] | null = null;
    for (const poly of geom.coordinates) {
      const outer = poly[0];
      if (!best || outer.length > best.length) best = outer;
    }
    return best ? averageCoords(best) : null;
  }
  if (geom.type === "LineString") {
    return averageCoords(geom.coordinates);
  }
  if (geom.type === "MultiLineString") {
    let best: GeoJSON.Position[] | null = null;
    for (const line of geom.coordinates) {
      if (!best || line.length > best.length) best = line;
    }
    return best ? averageCoords(best) : null;
  }
  return null;
}

function averageCoords(coords: GeoJSON.Position[]): L.LatLngTuple | null {
  if (!coords.length) return null;
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c[0];
    sy += c[1];
  }
  return [sy / coords.length, sx / coords.length];
}

function pointCoord(geom: GeoJSON.Geometry | null): L.LatLngTuple | null {
  if (!geom) return null;
  if (geom.type === "Point") {
    return [geom.coordinates[1], geom.coordinates[0]];
  }
  return centroid(geom);
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPE[c] ?? c);
}
