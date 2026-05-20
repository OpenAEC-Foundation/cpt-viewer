/**
 * Browser-zijdige client voor de BRO publieke REST-API
 * (https://publiek.broservices.nl). Wordt gebruikt als fallback in de
 * webversie van de app waar de Tauri Rust-commands (`fetch_bro_area`,
 * `fetch_bro_bores`, `fetch_bro_cpt`, `fetch_bro_bore`) niet
 * beschikbaar zijn.
 *
 * BRO publiceert sinds 2024 nette CORS-headers
 * (`access-control-allow-origin: *` of het exacte deploy-domain), dus
 * directe `fetch()` vanuit de browser werkt zonder proxy.
 *
 * Houd de XML-parser in sync met:
 *   apps/desktop/src-tauri/src/commands/bro_api.rs
 */

const BRO_BASE = "https://publiek.broservices.nl";
const SEARCH_START_DATE = "2017-01-01";

/** Mirror van Rust `BroFeature` — gebruikt door MapView's markers. */
export interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
  /** "cpt" | "bore" — bepaalt marker-styling op de kaart. */
  kind: "cpt" | "bore";
  registration_date?: string;
  /** Loose key/value bag voor popup-rendering. */
  extra: Record<string, string>;
}

export interface BroBBox {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}

/**
 * Zoek alle CPT (sondering) BRO-objecten in een bounding box.
 * Mirrors `fetch_bro_area` in bro_api.rs.
 */
export async function fetchBroCpts(bbox: BroBBox): Promise<BroFeature[]> {
  const url = `${BRO_BASE}/sr/cpt/v1/characteristics/searches`;
  const xml = await postCharacteristics(url, bbox);
  return parseCharacteristics(xml, "cpt");
}

/**
 * Zoek alle BHR-GT (boring) BRO-objecten in een bounding box.
 * Mirrors `fetch_bro_bores` in bro_api.rs.
 */
export async function fetchBroBores(bbox: BroBBox): Promise<BroFeature[]> {
  const url = `${BRO_BASE}/sr/bhrgt/v2/characteristics/searches`;
  const xml = await postCharacteristics(url, bbox);
  return parseCharacteristics(xml, "bore");
}

// Internal helper signature — narrow type so buildFeatureFromDoc can
// produce the union-typed BroFeature with kind narrowed.
type BroKind = "cpt" | "bore";

/** Get full CPT dispatch XML. */
export async function fetchBroCptXml(broId: string): Promise<string> {
  const url = `${BRO_BASE}/sr/cpt/v1/objects/${encodeURIComponent(broId)}`;
  const r = await fetch(url, { headers: { Accept: "application/xml" } });
  if (!r.ok) throw new Error(`BRO CPT ${broId}: HTTP ${r.status}`);
  return r.text();
}

/** Get full BHR-GT dispatch XML. */
export async function fetchBroBoreXml(broId: string): Promise<string> {
  const url = `${BRO_BASE}/sr/bhrgt/v2/objects/${encodeURIComponent(broId)}`;
  const r = await fetch(url, { headers: { Accept: "application/xml" } });
  if (!r.ok) throw new Error(`BRO BHR ${broId}: HTTP ${r.status}`);
  return r.text();
}

// ── Internals ─────────────────────────────────────────────────────

async function postCharacteristics(url: string, bbox: BroBBox): Promise<string> {
  // BRO API verwacht JSON in maar emit XML uit (~500 KB voor een paar
  // honderd features). endDate moet ≤ vandaag zijn anders 400.
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    registrationPeriod: {
      beginDate: SEARCH_START_DATE,
      endDate: today,
    },
    area: {
      boundingBox: {
        lowerCorner: { lat: bbox.min_lat, lon: bbox.min_lon },
        upperCorner: { lat: bbox.max_lat, lon: bbox.max_lon },
      },
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/xml",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const snippet = (await r.text()).slice(0, 400);
    throw new Error(`BRO HTTP ${r.status}: ${snippet}`);
  }
  return r.text();
}

/**
 * Parse een `dispatchCharacteristicsResponse` payload naar BroFeatures.
 * Werkt met DOMParser + localName-matching (namespace-agnostisch). De
 * Rust-versie gebruikt quick-xml streaming; wij doen DOM omdat de
 * payload klein genoeg is (~500 KB) en de browser DOMParser optimaal
 * is voor XML.
 */
function parseCharacteristics(xml: string, kind: BroKind): BroFeature[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const errs = doc.getElementsByTagName("parsererror");
  if (errs.length > 0) {
    throw new Error(`BRO XML parse-fout: ${errs[0].textContent ?? "unknown"}`);
  }

  // Rejection-response heeft géén dispatchDocument — alleen
  // <rejectionReason>. Geef een herkenbare error.
  const rejections = getAllByLocalName(doc.documentElement, "rejectionReason");
  const docs = getAllByLocalName(doc.documentElement, "dispatchDocument");
  if (docs.length === 0 && rejections.length > 0) {
    throw new Error(`BRO rejection: ${rejections[0].textContent ?? "unknown"}`);
  }

  const out: BroFeature[] = [];
  for (const d of docs) {
    const f = buildFeatureFromDoc(d, kind);
    if (f) out.push(f);
  }
  return out;
}

function buildFeatureFromDoc(el: Element, kind: BroKind): BroFeature | null {
  const broId = textByLocalName(el, "broId");
  if (!broId) return null;

  // standardizedLocation bevat WGS84 lat/lon (EPSG:4258).
  // deliveredLocation bevat RD-coords — die negeren we.
  const stdLoc = findByLocalName(el, "standardizedLocation");
  if (!stdLoc) return null;
  const pos = textByLocalName(stdLoc, "pos");
  if (!pos) return null;
  const parts = pos.trim().split(/\s+/).map((s) => parseFloat(s));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const lat = parts[0];
  const lon = parts[1];

  const extra: Record<string, string> = {};
  let depth: number | undefined;
  let regDate: string | undefined;

  // Whitelist van interessante velden (mirror van Rust note_end).
  const noteText = (name: string, label: string) => {
    const v = textByLocalName(el, name);
    if (v) extra[label] = v;
    return v;
  };
  const noteFloat = (name: string, label: string, unit?: string) => {
    const v = textByLocalName(el, name);
    if (!v) return undefined;
    const n = parseFloat(v);
    if (isNaN(n)) return undefined;
    const formatted = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
    extra[label + (unit ? ` (${unit})` : "")] = formatted;
    return n;
  };

  const reg = textByLocalName(el, "objectRegistrationTime");
  if (reg) {
    regDate = reg.split("T")[0];
    extra["Geregistreerd"] = regDate;
  }

  // researchReportDate kan genest zijn: <researchReportDate><date>YYYY-MM-DD</date></researchReportDate>.
  const rrd = findByLocalName(el, "researchReportDate");
  if (rrd) {
    const d = textByLocalName(rrd, "date");
    if (d) extra["Rapportdatum"] = d;
  }

  depth = noteFloat("finalDepth", "Einddiepte", "m");
  const depthBore = noteFloat("finalDepthBoring", "Einddiepte boring", "m");
  if (depth === undefined) depth = depthBore;
  noteFloat("predrilledDepth", "Voorboring", "m");
  noteFloat("offset", "Maaiveld t.o.v. NAP", "m");

  noteText("qualityRegime", "Kwaliteitsregime");
  noteText("qualityClass", "Kwaliteitsklasse");
  noteText("cptStandard", "CPT-norm");
  noteText("surveyPurpose", "Onderzoeksdoel");
  noteText("discipline", "Discipline");
  noteText("stopCriterion", "Stopcriterium");
  noteText("deliveryAccountableParty", "Bronhouder");
  noteText("rockReached", "Vaste rots bereikt");
  noteText("verticalDatum", "Verticaal datum");

  const dereg = textByLocalName(el, "deregistered");
  if (dereg && dereg !== "nee") extra["Uitgeschreven"] = dereg;

  return {
    id: broId,
    lat,
    lon,
    depth,
    kind,
    registration_date: regDate,
    extra,
  };
}

// ── DOM helpers ──────────────────────────────────────────────────

function findByLocalName(root: Element, name: string): Element | null {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) return all[i];
  }
  return null;
}

function getAllByLocalName(root: Element, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}

function textByLocalName(root: Element, name: string): string | undefined {
  const el = findByLocalName(root, name);
  return el?.textContent?.trim() || undefined;
}
