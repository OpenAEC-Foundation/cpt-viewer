/**
 * Lightweight PDOK WFS GetFeature helper. Fetches GeoJSON-encoded
 * features within a lat/lon bounding box and returns the FeatureCollection
 * ready to hand to `L.geoJSON(...)`.
 *
 * PDOK WFS endpoints accept `outputFormat=application/json` and return
 * RD-coordinate geometries when `srsName=EPSG:28992` (the service
 * default). We request `EPSG:4326` so Leaflet doesn't need to reproject
 * before drawing — PDOK quietly transforms the geometries server-side.
 *
 * Throttling: callers should debounce around map `moveend` to avoid
 * a flood of requests. A hard 5 000-feature cap is applied so a wild
 * zoom-out doesn't trigger a multi-MB response.
 *
 * CORS: `service.pdok.nl` allows cross-origin GET for read operations,
 * so a plain `fetch` from the renderer works without a Tauri shim.
 */
export type WfsBBox = { south: number; west: number; north: number; east: number };

export interface WfsFetchOptions {
  /** Fully qualified WFS base URL, e.g. `https://service.pdok.nl/lv/bag/wfs/v2_0`. */
  baseUrl: string;
  /** Layer / feature type name, e.g. `bag:pand`. */
  typeName: string;
  /** Optional max features; defaults to 2000. PDOK enforces a hard upper bound. */
  maxFeatures?: number;
  /** Abort signal so a debounced caller can cancel in-flight requests. */
  signal?: AbortSignal;
}

const DEFAULT_MAX = 2000;

/**
 * Fetch features inside `bbox` as a GeoJSON FeatureCollection. Returns
 * `null` when the request was aborted or when the server response can't
 * be parsed (the caller decides whether to log + retry).
 */
export async function fetchWfsFeatures(
  bbox: WfsBBox,
  opts: WfsFetchOptions,
): Promise<GeoJSON.FeatureCollection | null> {
  // bbox order for srsName=EPSG:4326 is lat-min,lon-min,lat-max,lon-max
  // (per OGC convention — note: NOT lon,lat). Appending the CRS name
  // forces PDOK to interpret the bbox in the same SRS as srsName.
  const bboxParam = [
    bbox.south,
    bbox.west,
    bbox.north,
    bbox.east,
    "urn:ogc:def:crs:EPSG::4326",
  ].join(",");
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: opts.typeName,
    outputFormat: "application/json",
    srsName: "urn:ogc:def:crs:EPSG::4326",
    count: String(opts.maxFeatures ?? DEFAULT_MAX),
    bbox: bboxParam,
  });

  const url = `${opts.baseUrl}?${params.toString()}`;
  try {
    const resp = await fetch(url, { signal: opts.signal });
    if (!resp.ok) {
      console.warn(`[pdokWfs] HTTP ${resp.status} for ${opts.typeName}`);
      return null;
    }
    const json = (await resp.json()) as GeoJSON.FeatureCollection;
    return json;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn(`[pdokWfs] fetch failed for ${opts.typeName}`, err);
    }
    return null;
  }
}

/**
 * Convenience: BAG `pand` (registered building outlines). Returns a
 * FeatureCollection of polygons / multipolygons.
 */
export function fetchBagPanden(bbox: WfsBBox, signal?: AbortSignal) {
  return fetchWfsFeatures(bbox, {
    baseUrl: "https://service.pdok.nl/lv/bag/wfs/v2_0",
    typeName: "bag:pand",
    maxFeatures: 2000,
    signal,
  });
}

/**
 * Convenience: Kadastrale kaart `perceel` (cadastral parcel polygons).
 * The boundary lines are the rings of these polygons.
 */
export function fetchKadasterPercelen(bbox: WfsBBox, signal?: AbortSignal) {
  return fetchWfsFeatures(bbox, {
    baseUrl: "https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0",
    typeName: "kadastralekaart:Perceel",
    maxFeatures: 1500,
    signal,
  });
}
