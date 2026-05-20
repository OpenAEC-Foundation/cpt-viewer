/**
 * Browser-zijdige GEF-parser — pure TypeScript port van cpt-core's
 * Rust GEF-parser (crates-warehouse/cpt-core/src/gef/*.rs).
 *
 * Bedoeld als fallback voor de webversie van de app waar de Rust
 * `open_cpt`-command via `invoke()` niet beschikbaar is. Voor de
 * desktop-versie blijft de Rust-parser autoritair (uitgebreidere
 * validatie + meer kolom-quantities) — deze TS-versie dekt de
 * BRO-CPT-Report dialect die in de praktijk 99% van de GEF-bestanden
 * is die gebruikers openen.
 *
 * Houd in sync met:
 *   - crates-warehouse/cpt-core/src/gef/header.rs
 *   - crates-warehouse/cpt-core/src/gef/data.rs
 *   - crates-warehouse/cpt-core/src/gef/columns.rs
 */

import type { Cpt, MeasurementPoint } from "./cpt";

/**
 * Sniff — is dit content waarschijnlijk een GEF-bestand? Werkt op de
 * eerste paar regels, geen volle parse.
 */
export function looksLikeGef(text: string): boolean {
  const head = text.slice(0, 2048);
  return /^#GEFID\s*=/m.test(head) || /^#TESTID\s*=/m.test(head);
}

/** GEF kolom-quantity → veldnaam in onze Cpt struct. */
type GefField =
  | "length"
  | "qc"
  | "fs"
  | "rf"
  | "u1"
  | "u2"
  | "u3"
  | "inclination"
  | "inclNs"
  | "inclEw"
  | "depth"
  | "time"
  | "correctedQc"
  | "netQc"
  | "poreRatio"
  | "speed"
  | "temp"
  | "electricCond"
  | "frictionTotal"
  | "unknown";

function fieldFromQuantity(q: number): GefField {
  switch (q) {
    case 1: return "length";
    case 2: return "qc";
    case 3: return "fs";
    case 4: return "rf";
    case 5: return "u1";
    case 6: return "u2";
    case 7: return "u3";
    case 8: return "inclination";
    case 9: return "inclNs";
    case 10: return "inclEw";
    case 11: return "depth";
    case 12: return "time";
    case 13: return "correctedQc";
    case 14: return "netQc";
    case 15: return "poreRatio";
    case 20: return "speed";
    case 21: return "temp";
    case 23: return "electricCond";
    case 39: return "frictionTotal";
    default: return "unknown";
  }
}

interface ColumnSpec {
  /** 1-based GEF kolom-index. */
  index: number;
  field: GefField;
}

interface GefHeader {
  testId?: string;
  projectId?: string;
  projectName?: string;
  companyId?: string;
  startDate?: string;       // ISO YYYY-MM-DD
  fileDate?: string;        // ISO YYYY-MM-DD
  xRd?: number;
  yRd?: number;
  zNap?: number;
  columns: ColumnSpec[];
  /** (1-based kolom-index, void waarde) — rauwe waarden die we als
   *  "geen meting" interpreteren. */
  columnVoid: Array<[number, number]>;
  extra: Record<string, string>;
}

/**
 * Parse een GEF-bestand naar onze Cpt-struct. Gooit een Error met een
 * uitleg-string als de header malformed is (b.v. ontbrekend `#EOH=`).
 */
export function parseGef(text: string, filename: string): Cpt {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const { header, dataStart } = parseHeader(lines);
  const { colSep, recSep } = extractSeparators(lines);
  const body = lines.slice(dataStart).join("\n");

  const records = recSep ? body.split(recSep) : body.split("\n");
  const points: MeasurementPoint[] = [];
  for (const rec of records) {
    const trimmed = rec.trim();
    if (!trimmed) continue;
    const tokens = colSep ? trimmed.split(colSep) : trimmed.split(/\s+/);
    const nums: number[] = [];
    for (const tok of tokens) {
      const v = parseNum(tok);
      if (v !== null) nums.push(v);
    }
    if (nums.length === 0) continue;
    const pt = buildPoint(nums, header);
    if (pt) points.push(pt);
  }

  return {
    id: header.testId ?? "Unknown",
    metadata: {
      project_name: header.projectName,
      project_number: header.projectId,
      // STARTDATE (echte meetdatum) heeft voorrang boven FILEDATE.
      date: header.startDate ?? header.fileDate,
      equipment: header.companyId,
      ground_level_nap: header.zNap,
      source_file: filename,
      extra: Object.keys(header.extra).length > 0 ? header.extra : undefined,
    },
    position:
      typeof header.xRd === "number" && typeof header.yRd === "number"
        ? { x_rd: header.xRd, y_rd: header.yRd, z_nap: header.zNap }
        : undefined,
    points,
  };
}

// ── Header parsing ───────────────────────────────────────────────

function parseHeader(lines: string[]): { header: GefHeader; dataStart: number } {
  const header: GefHeader = {
    columns: [],
    columnVoid: [],
    extra: {},
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "#EOH=" || line === "#EOH") {
      return { header, dataStart: i + 1 };
    }
    if (!line.startsWith("#")) continue;
    const rest = line.slice(1);
    const eqIdx = rest.indexOf("=");
    if (eqIdx < 0) continue;
    const key = rest.slice(0, eqIdx).trim().toUpperCase();
    const value = rest.slice(eqIdx + 1).trim();
    switch (key) {
      case "TESTID":
        header.testId = value;
        break;
      case "PROJECTID":
        header.projectId = value;
        break;
      case "PROJECTNAME":
        header.projectName = value;
        break;
      case "COMPANYID":
        // Eerste kolom van de comma-list — rest is meestal "wordt niet
        // uitgeleverd, -" of vergelijkbare placeholder.
        header.companyId = value.split(",")[0].trim();
        break;
      case "STARTDATE":
        header.startDate = parseFiledate(value);
        pushExtra(header.extra, key, value);
        break;
      case "FILEDATE":
        header.fileDate = parseFiledate(value);
        break;
      case "XYID":
        parseXyid(value, header);
        break;
      case "ZID":
        parseZid(value, header);
        break;
      case "COLUMNINFO":
        parseColumninfo(value, header);
        pushExtra(header.extra, key, value);
        break;
      case "COLUMNVOID":
        parseColumnvoid(value, header);
        pushExtra(header.extra, key, value);
        break;
      case "EOH":
      case "GEFID":
      case "COLUMNSEPARATOR":
      case "RECORDSEPARATOR":
      case "DATAFORMAT":
      case "COLUMN":
        pushExtra(header.extra, key, value);
        break;
      default:
        pushExtra(header.extra, key, value);
    }
  }
  throw new Error("GEF parse-fout: ontbrekende #EOH= terminator");
}

function pushExtra(extras: Record<string, string>, key: string, value: string): void {
  if (key in extras) extras[key] = `${extras[key]} | ${value}`;
  else extras[key] = value;
}

function parseFiledate(value: string): string | undefined {
  // FILEDATE format: "YYYY, MM, DD"
  const parts = value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  if (parts.length < 3) return undefined;
  const [y, mo, d] = parts;
  const yyyy = String(y).padStart(4, "0");
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseXyid(value: string, h: GefHeader): void {
  // XYID: "1, x, y, ..."
  const parts = value.split(",").map((s) => s.trim());
  if (parts.length < 3) return;
  const x = parseFloat(parts[1]);
  const y = parseFloat(parts[2]);
  if (!isNaN(x) && !isNaN(y)) {
    h.xRd = x;
    h.yRd = y;
  }
}

function parseZid(value: string, h: GefHeader): void {
  // ZID: "31000, z, ..."
  const parts = value.split(",").map((s) => s.trim());
  if (parts.length < 2) return;
  const z = parseFloat(parts[1]);
  if (!isNaN(z)) h.zNap = z;
}

function parseColumninfo(value: string, h: GefHeader): void {
  // COLUMNINFO: "<col>, <unit>, <name>, <quantity>"
  const parts = value.split(",").map((s) => s.trim());
  if (parts.length < 4) return;
  const col = parseInt(parts[0], 10);
  const q = parseInt(parts[3], 10);
  if (isNaN(col) || isNaN(q)) return;
  h.columns.push({ index: col, field: fieldFromQuantity(q) });
}

function parseColumnvoid(value: string, h: GefHeader): void {
  const parts = value.split(",").map((s) => s.trim());
  if (parts.length < 2) return;
  const c = parseInt(parts[0], 10);
  const v = parseFloat(parts[1]);
  if (!isNaN(c) && !isNaN(v)) h.columnVoid.push([c, v]);
}

// ── Data parsing ─────────────────────────────────────────────────

function extractSeparators(lines: string[]): { colSep?: string; recSep?: string } {
  let colSep: string | undefined;
  let recSep: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#COLUMNSEPARATOR=")) {
      const v = line.slice("#COLUMNSEPARATOR=".length).trim();
      if (v.length > 0) colSep = v[0];
    } else if (line.startsWith("#RECORDSEPARATOR=")) {
      const v = line.slice("#RECORDSEPARATOR=".length).trim();
      if (v.length > 0) recSep = v[0];
    }
  }
  return { colSep, recSep };
}

function parseNum(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Sommige GEF-velden bevatten een terminator-marker `!` of `*` aan
  // het einde — strippen voor we parseFloat aanroepen.
  const cleaned = trimmed.replace(/[!*]+$/g, "");
  if (!cleaned) return null;
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function buildPoint(nums: number[], header: GefHeader): MeasurementPoint | null {
  const p: MeasurementPoint = { depth: 0 };
  let haveDepth = false;

  for (const spec of header.columns) {
    const raw = nums[spec.index - 1];
    if (raw === undefined) continue;
    const voided = header.columnVoid.some(
      ([c, v]) => c === spec.index && Math.abs(raw - v) < 1e-6,
    );
    const value = voided ? undefined : raw;
    switch (spec.field) {
      case "length":
      case "depth":
        // Sign-normalize — sommige (Belgische) GEFs gebruiken een
        // negatieve diepte. Mirror bedrock-engineer/gef-parser-ts +
        // de Rust-parser: absolute waarde zodat positieve diepte =
        // onder maaiveld blijft.
        if (value !== undefined) {
          p.depth = Math.abs(value);
          haveDepth = true;
        }
        break;
      case "qc":
        p.qc = value;
        break;
      case "fs":
        p.fs = value;
        break;
      case "rf":
        p.rf = value;
        break;
      case "u2":
        p.u2 = value;
        break;
      case "inclination":
        p.inclination = value;
        break;
      default:
        // Andere kolommen worden (nog) niet in MeasurementPoint
        // opgeslagen — geen plek in de struct voor InclNs/EW, time,
        // speed enz.
        break;
    }
  }

  if (!haveDepth) return null;

  // Derive Rf = 100 * fs / qc als de kolom ontbreekt.
  if (p.rf === undefined && p.qc !== undefined && p.fs !== undefined && p.qc > 0) {
    p.rf = (100 * p.fs) / p.qc;
  }

  if (typeof header.zNap === "number") {
    p.depth_nap = header.zNap - p.depth;
  }

  return p;
}
