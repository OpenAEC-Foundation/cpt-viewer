/**
 * Browser-zijdige BRO CPT XML-parser — pure TypeScript port van de
 * Rust parser in crates-warehouse/cpt-core/src/bro/mod.rs.
 *
 * Bedoeld als fallback voor de webversie zodat een gebruiker een
 * BRO sondering kan openen ("Open in viewer" knop op de Kaart, of
 * "Maak project + voeg toe") zonder dat invoke('open_cpt') hoeft.
 *
 * Verwacht een `dispatchDataResponse` payload zoals geserveerd door
 * https://publiek.broservices.nl/sr/cpt/v1/objects/{broId}. De
 * Rust-parser is autoritair (uitgebreidere validatie); deze TS-versie
 * dekt het 99%-formaat dat de publieke endpoint teruggeeft.
 *
 * Sync met:
 *   - crates-warehouse/cpt-core/src/bro/mod.rs
 *   - crates-warehouse/cpt-core/src/bro/columns.rs
 */

import type { Cpt, MeasurementPoint } from "./cpt";

/** BRO 25-koloms data-array — vaste volgorde per BRO IMBRO/A standaard. */
const COLUMN_ORDER = [
  "length",
  "depth",
  "elapsedTime",
  "qc",
  "correctedQc",
  "netQc",
  "magX",
  "magY",
  "magZ",
  "magTotal",
  "electricCond",
  "inclEw",
  "inclNs",
  "inclX",
  "inclY",
  "inclination",
  "magInclination",
  "magDeclination",
  "fs",
  "poreRatio",
  "temp",
  "u1",
  "u2",
  "u3",
  "rf",
] as const;

const VOID_VALUE = -999999.0;

/** Sniff — is dit XML waarschijnlijk een BRO CPT dispatch-document? */
export function looksLikeBroCptXml(xml: string): boolean {
  const head = xml.slice(0, 4096);
  return (
    /<\s*CPT_O\b/.test(head) ||
    /<\s*[\w-]+:CPT_O\b/.test(head) ||
    head.includes("xsd/dscpt/") ||
    head.includes("xsd/cptcommon/")
  );
}

/**
 * Parse een BRO CPT XML naar onze Cpt-struct. Throws met een uitleg-
 * string als verplichte velden ontbreken (broId of cptResult/values).
 */
export function parseBroCptXml(xml: string, filename: string): Cpt {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const errs = doc.getElementsByTagName("parsererror");
  if (errs.length > 0) {
    throw new Error(`BRO CPT XML parse-fout: ${errs[0].textContent ?? ""}`);
  }

  const broId = textByLocalName(doc.documentElement, "broId");
  if (!broId) throw new Error("BRO CPT: ontbrekende broId");

  // ── RD-coordinaten ───────────────────────────────────────────
  // deliveredLocation/pos = RD (EPSG:28992). standardizedLocation
  // gebruiken we niet (die is WGS84) want we willen RD in Position.
  let xRd: number | undefined;
  let yRd: number | undefined;
  const deliveredLoc = findByLocalName(doc.documentElement, "deliveredLocation");
  if (deliveredLoc) {
    const pos = textByLocalName(deliveredLoc, "pos");
    if (pos) {
      const parts = pos.trim().split(/\s+/).map((s) => parseFloat(s));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        xRd = parts[0];
        yRd = parts[1];
      }
    }
  }

  // ── Verticale offset (Z-NAP) ────────────────────────────────
  let zNap: number | undefined;
  const verticalPos = findByLocalName(doc.documentElement, "deliveredVerticalPosition");
  if (verticalPos) {
    const offset = textByLocalName(verticalPos, "offset");
    if (offset) {
      const v = parseFloat(offset);
      if (!isNaN(v)) zNap = v;
    }
  }

  // ── Rapportdatum ────────────────────────────────────────────
  let date: string | undefined;
  const reportDateEl = findByLocalName(doc.documentElement, "researchReportDate");
  if (reportDateEl) {
    const d = textByLocalName(reportDateEl, "date");
    if (d) date = d;
  }

  // ── Extras (curated whitelist) ─────────────────────────────
  const EXTRA_FIELDS = [
    "objectIdAccountableParty",
    "qualityRegime",
    "qualityClass",
    "accuracyClass",
    "deliveryContext",
    "surveyPurpose",
    "cptStandard",
    "researchOperator",
    "researchReportSubmittedBy",
    "stopCriterion",
    "cptMethod",
    "predrilledDepth",
    "finalDepth",
    "finalDepthBoring",
    "groundwaterLevel",
    "conePenetrometerType",
    "conePenetrometerName",
    "conePenetrometerDescription",
    "coneSurfaceArea",
    "coneSurfaceQuotient",
    "frictionSleeveSurfaceArea",
    "frictionSleeveSurfaceQuotient",
    "frictionSleeveDistance",
    "conePresentationLength",
    "linearSlopeDetected",
    "verticalDatum",
    "localVerticalReferencePoint",
    "horizontalPositioningMethod",
    "deliveredVerticalPositioningMethod",
    "calibrationOperator",
    "calibrationDate",
    "dissipationTestPerformed",
    "sondageIdAccountableParty",
    "sondageId",
  ];
  const extra: Record<string, string> = {};
  for (const name of EXTRA_FIELDS) {
    const v = textByLocalName(doc.documentElement, name);
    if (v) extra[name] = v;
  }

  // ── Data-block uit cptResult/values ────────────────────────
  // Let op: we wíllen specifiek cptResult/values, NIET
  // dissipationTest/values. We zoeken dus eerst cptResult en
  // pakken daaruit values.
  const cptResult = findByLocalName(doc.documentElement, "cptResult");
  const dataBlock = cptResult ? textByLocalName(cptResult, "values") : undefined;
  if (!dataBlock) {
    throw new Error("BRO CPT: ontbrekend cptResult/values data-block");
  }

  // ── Parse data-block ───────────────────────────────────────
  const points = parseDataBlock(dataBlock, zNap);
  // BRO is niet altijd op diepte gesorteerd — sorteren zodat de
  // chart-polyline niet zigzagt.
  points.sort((a, b) => a.depth - b.depth);

  return {
    id: broId,
    metadata: {
      project_name: undefined,
      project_number: undefined,
      date,
      equipment: undefined,
      ground_level_nap: zNap,
      source_file: filename,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    },
    position:
      typeof xRd === "number" && typeof yRd === "number"
        ? { x_rd: xRd, y_rd: yRd, z_nap: zNap }
        : undefined,
    points,
  };
}

// ── Data parsing ──────────────────────────────────────────────────

function parseDataBlock(block: string, zNap: number | undefined): MeasurementPoint[] {
  // Records gescheiden door ';', kolommen door ','. Elke "record" is
  // 25 floats. VOID_VALUE = -999999 betekent "geen meting".
  const out: MeasurementPoint[] = [];
  const records = block.split(";");
  for (const rec of records) {
    const trimmed = rec.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(",");
    if (tokens.length < COLUMN_ORDER.length) continue;
    const nums: (number | undefined)[] = tokens.map((s) => {
      const v = parseFloat(s.trim());
      if (isNaN(v)) return undefined;
      if (Math.abs(v - VOID_VALUE) < 0.5) return undefined;
      return v;
    });
    const pt = buildPoint(nums, zNap);
    if (pt) out.push(pt);
  }
  return out;
}

function buildPoint(
  nums: (number | undefined)[],
  zNap: number | undefined,
): MeasurementPoint | null {
  const p: MeasurementPoint = { depth: 0 };
  let haveDepth = false;

  for (let i = 0; i < COLUMN_ORDER.length; i++) {
    const v = nums[i];
    const field = COLUMN_ORDER[i];
    switch (field) {
      case "depth":
        if (v !== undefined) {
          p.depth = v;
          haveDepth = true;
        }
        break;
      case "length":
        // Length is alleen fallback als er geen Depth-kolom is.
        if (!haveDepth && v !== undefined) {
          p.depth = v;
          haveDepth = true;
        }
        break;
      case "qc":
        p.qc = v;
        break;
      case "fs":
        p.fs = v;
        break;
      case "rf":
        p.rf = v;
        break;
      case "u2":
        p.u2 = v;
        break;
      case "inclination":
        p.inclination = v;
        break;
      default:
        // Andere kolommen (magX/Y/Z, elapsedTime, electricCond, …)
        // worden niet opgeslagen in MeasurementPoint.
        break;
    }
  }
  if (!haveDepth) return null;

  // Derive Rf = 100 * fs / qc als de kolom ontbreekt.
  if (p.rf === undefined && p.qc !== undefined && p.fs !== undefined && p.qc > 0) {
    p.rf = (100 * p.fs) / p.qc;
  }

  if (typeof zNap === "number") {
    p.depth_nap = zNap - p.depth;
  }

  return p;
}

// ── DOM helpers ──────────────────────────────────────────────────

function findByLocalName(root: Element, name: string): Element | null {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) return all[i];
  }
  return null;
}

function textByLocalName(root: Element, name: string): string | undefined {
  const el = findByLocalName(root, name);
  return el?.textContent?.trim() || undefined;
}
