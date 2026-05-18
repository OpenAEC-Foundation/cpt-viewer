/**
 * GIS-laag catalog — single source of truth voor alle kaart-lagen
 * waar de app mee werkt. Bevat URL-templates, layer-namen, attribution
 * etc. zodat:
 *
 *   1. MapView consistent dezelfde URLs kan opbouwen
 *   2. Bij `.ifcgis`-save de FULL layer-config in het bestand komt —
 *      een ander programma dat het bestand leest weet exact welke
 *      WMTS/WMS endpoints aangesproken moeten worden om de kaart te
 *      reconstrueren (de gebruiker vroeg expliciet om dat ifcgis
 *      "alle informatie om deze kaart te maken" bevat).
 *
 * Niet IN dit bestand: de runtime "enabled" en "opacity" state per
 * laag — die zit in MapView en wordt op save-tijd opgehaald.
 */

export type LayerKind = "wmts" | "wms" | "wfs" | "tile";
export type LayerGroup = "base" | "overlay" | "data";

export interface GisLayerCatalogEntry {
  id: string;
  label: string;
  group: LayerGroup;
  kind: LayerKind;
  /** URL-template (voor wmts/tile: met `{z}/{x}/{y}`) of base-endpoint
   *  (voor wms/wfs zonder query-string). */
  url: string;
  /** Voor WMS/WFS: de `LAYERS=`/`typeNames`-waarde. */
  layerName?: string;
  /** Voor WMS: optionele `STYLES=`. */
  style?: string;
  attribution?: string;
  minZoom?: number;
  maxZoom?: number;
  /** Default-aan state bij een vers project. Wordt overschreven door
   *  de live MapView-state op save-tijd als die beschikbaar is. */
  defaultEnabled: boolean;
  /** Default-opacity (0..1). */
  defaultOpacity: number;
}

const PDOK_ATTRIBUTION = "© PDOK";

export const GIS_LAYER_CATALOG: GisLayerCatalogEntry[] = [
  // ── Base layers ─────────────────────────────────────────────
  {
    id: "brt",
    label: "Topografie (BRT)",
    group: "base",
    kind: "wmts",
    url: "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
    attribution: PDOK_ATTRIBUTION + " / Kadaster",
    defaultEnabled: true,
    defaultOpacity: 1,
  },
  {
    id: "luchtfoto-actueel",
    label: "Luchtfoto (actueel)",
    group: "base",
    kind: "wmts",
    url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
    attribution: PDOK_ATTRIBUTION + " / Beeldmateriaal NL",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  // Luchtfoto per jaar — `Year_ortho25` patroon
  ...[2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016].map(
    (year): GisLayerCatalogEntry => ({
      id: `luchtfoto-${year}`,
      label: `Luchtfoto ${year}`,
      group: "base",
      kind: "wmts",
      url: `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${year}_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg`,
      attribution: PDOK_ATTRIBUTION + " / Beeldmateriaal NL",
      defaultEnabled: false,
      defaultOpacity: 1,
    }),
  ),

  // ── Overlays ───────────────────────────────────────────────
  {
    id: "adressen",
    label: "Adressen + straten",
    group: "overlay",
    kind: "wfs",
    url: "https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0",
    layerName: "kadastralekaart:OpenbareRuimteNaam,kadastralekaart:Nummeraanduidingreeks",
    attribution: PDOK_ATTRIBUTION + " / Kadaster",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  {
    id: "ahn",
    label: "AHN hoogtekaart",
    group: "overlay",
    kind: "wmts",
    url: "https://service.pdok.nl/rws/ahn/wmts/v1_0/dtm_05m/EPSG:3857/{z}/{x}/{y}.png",
    attribution: PDOK_ATTRIBUTION + " / Rijkswaterstaat",
    defaultEnabled: false,
    defaultOpacity: 0.7,
  },
  {
    id: "kadaster",
    label: "Kadastrale grenzen",
    group: "overlay",
    kind: "wfs",
    url: "https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0",
    layerName: "kadastralekaart:Perceel",
    attribution: PDOK_ATTRIBUTION + " / Kadaster",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  {
    id: "bag",
    label: "BAG (gebouwen)",
    group: "overlay",
    kind: "wfs",
    url: "https://service.pdok.nl/lv/bag/wfs/v2_0",
    layerName: "bag:pand",
    attribution: PDOK_ATTRIBUTION + " / Kadaster",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  {
    id: "bgt",
    label: "BGT topografie",
    group: "overlay",
    kind: "wmts",
    url: "https://service.pdok.nl/lv/bgt/wmts/v1_0/standaardvisualisatie/EPSG:3857/{z}/{x}/{y}.png",
    attribution: PDOK_ATTRIBUTION + " / Geonovum",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  {
    id: "bestemmingsplan",
    label: "Bestemmingsplan",
    group: "overlay",
    kind: "wms",
    url: "https://service.pdok.nl/kadaster/plu/wms/v3_0",
    layerName: "plu:Plangebied",
    attribution: PDOK_ATTRIBUTION + " / Kadaster",
    defaultEnabled: false,
    defaultOpacity: 0.6,
  },

  // ── Data layers ────────────────────────────────────────────
  {
    id: "bro-sonderingen",
    label: "BRO Sonderingen",
    group: "data",
    kind: "wfs",
    url: "https://api.bro.nl/sr/cpt/v1/characteristics/searches",
    attribution: "© BRO / TNO Geologische Dienst",
    defaultEnabled: true,
    defaultOpacity: 1,
  },
  {
    id: "bro-boringen",
    label: "BRO Boringen",
    group: "data",
    kind: "wfs",
    url: "https://api.bro.nl/sr/bhr/v2/characteristics/searches",
    attribution: "© BRO / TNO Geologische Dienst",
    defaultEnabled: false,
    defaultOpacity: 1,
  },
  {
    id: "project-sonderingen",
    label: "Project sonderingen",
    group: "data",
    kind: "tile",
    url: "internal://project-sonderingen",
    defaultEnabled: true,
    defaultOpacity: 1,
  },
];

/**
 * Lookup a layer entry by id. Returns undefined if unknown — saves a
 * forward-compat path: een nieuwere ifcgis kan een laag noemen die
 * deze app-versie nog niet heeft, en we kunnen die info gewoon
 * doorgeven aan de Rust-side zonder hier te crashen.
 */
export function getCatalogEntry(id: string): GisLayerCatalogEntry | undefined {
  return GIS_LAYER_CATALOG.find((e) => e.id === id);
}

/**
 * Convert the catalog (eventueel met live enabled/opacity-overrides)
 * naar de snake_case JSON-shape die Rust's `ifcgis::GisLayer` verwacht.
 * `overrides` mag null zijn — dan worden defaults gebruikt.
 */
export function catalogToIfcgisLayers(
  overrides?: Map<string, { enabled: boolean; opacity: number }>,
): unknown[] {
  return GIS_LAYER_CATALOG.map((e) => {
    const o = overrides?.get(e.id);
    return {
      id: e.id,
      label: e.label,
      group: e.group,
      kind: e.kind,
      url: e.url,
      ...(e.layerName ? { layer_name: e.layerName } : {}),
      ...(e.style ? { style: e.style } : {}),
      enabled: o?.enabled ?? e.defaultEnabled,
      opacity: o?.opacity ?? e.defaultOpacity,
      ...(e.attribution ? { attribution: e.attribution } : {}),
      ...(e.minZoom != null ? { min_zoom: e.minZoom } : {}),
      ...(e.maxZoom != null ? { max_zoom: e.maxZoom } : {}),
    };
  });
}
