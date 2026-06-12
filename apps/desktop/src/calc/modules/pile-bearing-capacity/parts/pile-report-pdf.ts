// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/pile-report-pdf.ts
//
// Multi-sondering paaldraagvermogen-rapport in de stijl van het externe
// referentierapport (984.pdf). Opbouw:
//
//   blad 1            — projectblad (ALGEMEEN + FUNDERINGSPAAL + grondsoorten)
//   per sondering     — visual-blad (CPT + paal + zones)
//                       berekening-blad (neg. kleef → puntdraag → schacht →
//                                        Rc;cal → zakking → veerwaarde)
//                       lastzakkingsdiagram-blad
//   slotblad          — statistische eindanalyse (§7.6.2.3 (5) + Tabel A.10b)
//
// Alle pagina's krijgen de referentie-stijl header (Berekeningsnummer /
// Revisie / Blad N van M / Projectnummer / Datum / Projectomschrijving /
// Onderdeel) en een footer met eigen branding. Output: jsPDF → Uint8Array.

import { jsPDF } from "jspdf";
import type { Cpt } from "../../../../types/cpt";
import type { PileInput, PileResult } from "../types";
import type { MultiCptSummary } from "./multi-cpt-summary";
import { renderSonderingChart } from "./pile-report-chart";
import { renderZakkingDiagram } from "./pile-report-zakking";

export interface PileReportProject {
  /** Projectnummer (bv. "2705"). */
  number: string;
  /** Beschrijving (bv. "Funderingsherstel"). */
  description: string;
  /** Norm-referentie (bv. "NEN 9997-1:2025+C1:2025 nl"). */
  norm: string;
  /** Datum (bv. "26-05-2026"). */
  date: string;
  /** Bedrijfsnaam / opsteller. */
  author: string;
  /** Berekeningsnummer (header; bv. "5.2"). */
  berekeningsnummer?: string;
  /** Revisie (header; default "0"). */
  revisie?: string;
  /** Onderdeel (header; bv. "Wapening en funderingspalen"). */
  onderdeel?: string;
  /** Ontwerplevensduur in jaren (projectblad; default 50). */
  ontwerplevensduur?: number;
  /** Gevolgklasse (projectblad; bv. "CC1"). */
  gevolgklasse?: string;
}

export interface PileReportSondering {
  /** Naam zoals "S1", "S3". */
  name: string;
  /** PileInput zoals gebruikt bij de berekening. */
  input: PileInput;
  /** Complete berekenings-resultaat van computePile(). */
  result: PileResult;
  /** CPT-data voor het visual-blad. Zonder cpt wordt dat blad overgeslagen. */
  cpt?: Cpt;
}

export interface PileReportInputs {
  project: PileReportProject;
  sonderingen: PileReportSondering[];
  /** Multi-CPT statistische eindanalyse. */
  summary: MultiCptSummary;
  /** Paaltype-naam voor het projectblad. */
  pileTypeName: string;
  /** Factoren αp, αs, αt uit de pile-catalog. */
  factors: { alphaP: number; alphaS: number; alphaT: number };
}

// ─── PDF layout constants ────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const M = { top: 14, right: 14, bottom: 18, left: 14 };
const CONTENT_W = PAGE_W - M.left - M.right;
const FOOTER_Y = PAGE_H - 8;
const HEADER_BOTTOM = 34; // y waar content begint (na referentie-header)
const TOTAL_PAGES_TOKEN = "{tp}";

// ─── Getal-notatie (NL: decimaal-komma) ──────────────────────────
function nl(v: number, dec = 2): string {
  return v.toFixed(dec).replace(".", ",");
}
function nlNap(v: number): string {
  return `NAP ${v >= 0 ? "+" : ""}${nl(v, 2)} m`;
}

// ─── WinAnsi-sanitizer ───────────────────────────────────────────
// De standaard-14 PDF-fonts (helvetica/courier) ondersteunen alleen
// WinAnsi (CP1252). Griekse letters en wiskundige tekens buiten die
// codepage worden door jsPDF verminkt (codepoint & 0xFF) én forceren
// 16-bit rendering met kapotte letterspatiëring. Daarom translitereren
// we alle formule-symbolen naar WinAnsi-veilige equivalenten — dezelfde
// conventie die het externe referentierapport in zijn tekstlaag
// hanteert ("a p =0,70", "g f,nk", "D L nk", "x 3 = 1,27").
const WINANSI_MAP: Array<[RegExp, string]> = [
  [/α/g, "a"],
  [/β/g, "b"],
  [/γ/g, "g"],
  [/δ/g, "d"],
  [/λ/g, "l"],
  [/σ/g, "s"],
  [/ξ/g, "x"],
  [/Σ/g, "S"],
  [/Δ/g, "D"],
  [/φ/g, "phi"],
  [/→/g, "->"],
  [/−/g, "-"],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/√/g, "V"],
  [/⁻/g, "-"],
  [/ξ/g, "x"],
];
function winAnsi(s: string): string {
  let out = s;
  for (const [re, repl] of WINANSI_MAP) out = out.replace(re, repl);
  return out;
}

// ─── Cursor + chrome ─────────────────────────────────────────────
interface Cursor {
  doc: jsPDF;
  y: number;
  pageNo: number;
  newPage: () => void;
  reserve: (h: number) => void;
}

function makeCursor(doc: jsPDF, project: PileReportProject): Cursor {
  let pageNo = 1;
  const printChrome = () => {
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(9.5);
    doc.setTextColor(0);
    doc.text(project.author, M.left, 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const rows: Array<[string, string, number]> = [
      ["Berekeningsnummer", project.berekeningsnummer ?? "-", 13.5],
      ["Projectnummer", project.number, 18],
      ["Projectomschrijving", project.description, 22.5],
      ["Onderdeel", project.onderdeel ?? "Funderingspalen", 27],
    ];
    for (const [label, value, y] of rows) {
      doc.text(label, M.left, y);
      doc.text(`: ${value}`, M.left + 33, y);
    }
    doc.text("Revisie", 105, 13.5);
    doc.text(`: ${project.revisie ?? "0"}`, 122, 13.5);
    doc.text("Datum", 105, 18);
    doc.text(`: ${project.date}`, 122, 18);
    doc.text(`Blad ${pageNo} van ${TOTAL_PAGES_TOKEN}`, PAGE_W - M.right, 13.5, { align: "right" });

    doc.setDrawColor(40);
    doc.setLineWidth(0.4);
    doc.line(M.left, 29.5, PAGE_W - M.right, 29.5);

    // Footer — eigen branding.
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.setFont("helvetica", "italic");
    doc.text("Open Geotechniek Studio", PAGE_W - M.right, FOOTER_Y, { align: "right" });
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
  };
  printChrome();
  const cursor: Cursor = {
    doc,
    y: HEADER_BOTTOM + 4,
    pageNo,
    newPage: () => {
      doc.addPage();
      pageNo += 1;
      cursor.pageNo = pageNo;
      cursor.y = HEADER_BOTTOM + 4;
      printChrome();
    },
    reserve: (h: number) => {
      if (cursor.y + h > FOOTER_Y - 5) cursor.newPage();
    },
  };
  return cursor;
}

// ─── Render helpers ──────────────────────────────────────────────

/** Sectiekop met optionele norm-artikel-referentie rechts uitgelijnd. */
function sectionTitle(c: Cursor, title: string, artRef?: string): void {
  c.reserve(10);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(10);
  c.doc.setTextColor(0);
  c.doc.text(winAnsi(title), M.left, c.y);
  if (artRef) {
    c.doc.setFont("helvetica", "normal");
    c.doc.setFontSize(8);
    c.doc.setTextColor(90);
    c.doc.text(winAnsi(artRef), PAGE_W - M.right, c.y, { align: "right" });
    c.doc.setTextColor(0);
  }
  c.y += 5.5;
}

function paragraph(c: Cursor, text: string, opts: { italic?: boolean; size?: number; indent?: number } = {}): void {
  const size = opts.size ?? 8.5;
  const lineH = size * 0.45;
  const lines = c.doc.splitTextToSize(winAnsi(text), CONTENT_W - (opts.indent ?? 0));
  c.reserve(lines.length * lineH + 1);
  c.doc.setFont("helvetica", opts.italic ? "italic" : "normal");
  c.doc.setFontSize(size);
  for (const line of lines) {
    c.doc.text(line, M.left + (opts.indent ?? 0), c.y);
    c.y += lineH;
  }
  c.y += 1;
}

/** 3-regelige formule (symbolisch → ingevuld → resultaat) met optionele
 *  verwijzing rechts (bv. "...(7.6)" of "...(Figuur 7.n)"). */
function formula(
  c: Cursor,
  lhs: string,
  symbolic: string,
  filled: string | null,
  result: string,
  ref?: string,
): void {
  const rows = 2 + (filled ? 1 : 0);
  c.reserve(rows * 4 + 3);
  c.doc.setFont("courier", "normal");
  c.doc.setFontSize(8.5);
  const lhsW = 30;
  c.doc.text(winAnsi(lhs), M.left, c.y);
  c.doc.text("=", M.left + lhsW, c.y);
  c.doc.text(winAnsi(symbolic), M.left + lhsW + 4, c.y);
  if (ref) {
    c.doc.setFont("helvetica", "normal");
    c.doc.setFontSize(7.5);
    c.doc.setTextColor(90);
    c.doc.text(winAnsi(ref), PAGE_W - M.right, c.y, { align: "right" });
    c.doc.setTextColor(0);
    c.doc.setFont("courier", "normal");
    c.doc.setFontSize(8.5);
  }
  c.y += 4;
  if (filled) {
    c.doc.text("=", M.left + lhsW, c.y);
    c.doc.text(winAnsi(filled), M.left + lhsW + 4, c.y);
    c.y += 4;
  }
  c.doc.setFont("courier", "bold");
  c.doc.text("=", M.left + lhsW, c.y);
  c.doc.text(winAnsi(result), M.left + lhsW + 4, c.y);
  c.y += 5;
  c.doc.setFont("helvetica", "normal");
}

interface TableCol {
  label: string;
  width: number;
  align?: "left" | "right";
}

function table(
  c: Cursor,
  cols: TableCol[],
  rows: string[][],
  opts: { summaryRow?: string[]; size?: number } = {},
): void {
  const size = opts.size ?? 7.5;
  const rowH = size * 0.55 + 0.5;
  const headerH = rowH + 1;
  const sumH = opts.summaryRow ? rowH : 0;
  const totalH = headerH + rows.length * rowH + sumH + 2;
  c.reserve(totalH);

  c.doc.setFillColor(232, 234, 240);
  c.doc.rect(M.left, c.y - rowH * 0.6, CONTENT_W, headerH, "F");
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(size);
  let x = M.left + 1;
  for (const col of cols) {
    const tx = col.align === "right" ? x + col.width - 1 : x;
    c.doc.text(winAnsi(col.label), tx, c.y, { align: col.align === "right" ? "right" : undefined });
    x += col.width;
  }
  c.y += headerH;

  c.doc.setFont("helvetica", "normal");
  for (const row of rows) {
    let cx = M.left + 1;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const tx = col.align === "right" ? cx + col.width - 1 : cx;
      c.doc.text(winAnsi(row[i] ?? ""), tx, c.y, { align: col.align === "right" ? "right" : undefined });
      cx += col.width;
    }
    c.y += rowH;
  }

  if (opts.summaryRow) {
    c.doc.setFillColor(245, 238, 220);
    c.doc.rect(M.left, c.y - rowH * 0.6, CONTENT_W, rowH, "F");
    c.doc.setFont("helvetica", "bold");
    let cx = M.left + 1;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const tx = col.align === "right" ? cx + col.width - 1 : cx;
      c.doc.text(winAnsi(opts.summaryRow[i] ?? ""), tx, c.y, { align: col.align === "right" ? "right" : undefined });
      cx += col.width;
    }
    c.y += rowH;
  }
  c.y += 2;
  c.doc.setFont("helvetica", "normal");
}

function kv(c: Cursor, label: string, value: string): void {
  c.reserve(5);
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(8.5);
  c.doc.text(winAnsi(label), M.left, c.y);
  c.doc.text(winAnsi(value), M.left + 52, c.y);
  c.y += 4.2;
}

// ─── Blad 1 — projectblad ────────────────────────────────────────

function renderProjectBlad(c: Cursor, inputs: PileReportInputs): void {
  const p = inputs.project;
  const first = inputs.sonderingen[0];

  sectionTitle(c, "ALGEMEEN");
  kv(c, "Ontwerplevensduur", `: ${p.ontwerplevensduur ?? 50} jaren`);
  kv(c, "Gevolgklasse", `: ${p.gevolgklasse ?? "CC1"}`);
  c.y += 3;

  sectionTitle(c, "FUNDERINGSPAAL");
  kv(c, "Gehanteerde normen", `: ${p.norm}`);
  c.y += 2;

  if (first) {
    const inp = first.input;
    const L = inp.pileTopNap - inp.pileToeNap;
    kv(c, "Type paal", `: ${inputs.pileTypeName}`);
    kv(c, "Paallengte", `: ${nl(L, 2)} m`);
    kv(
      c,
      "Factoren",
      `: αp = ${nl(inputs.factors.alphaP, 2)}   αs = ${inputs.factors.alphaS.toFixed(3).replace(".", ",")}   αt = ${inputs.factors.alphaT.toFixed(3).replace(".", ",")}   Lastzakkingslijn: 1`,
    );
    kv(c, "Diameter", `: D = ${inp.diameterMm} mm  (D_eq = ${inp.diameterMm} mm)`);
    kv(c, "Wanddikte", `: ${nl(inp.wallThicknessMm, 1)} mm`);
    kv(c, "Paalkopniveau", `: ${nlNap(inp.pileTopNap)}`);
    kv(c, "Paalpuntniveau", `: ${nlNap(inp.pileToeNap)}`);
    kv(c, "Waterniveau", `: ${nlNap(inp.waterNap)}`);
    kv(c, "Ontgravingsniveau", `: ${nlNap(inp.excavationNap)}`);
    kv(c, "Belasting", `: N_Ed = ${inp.nEd} kN   N_k = ${inp.nEk} kN`);
    kv(c, "Partiële factoren", `: γ_m = ${nl(inp.gammaM, 2)}   γ_f,nk = ${nl(inp.gammaFnk, 2)}`);
    kv(c, "Paalgroep", `: geen paalgroep`);
    c.y += 3;

    // Grondsoorten-tabel: unieke kinds over alle sonderingen.
    sectionTitle(c, "Grondsoorten");
    const seen = new Map<string, { gammaK: number; gammaW: number; phi: number }>();
    for (const s of inputs.sonderingen) {
      for (const l of s.input.soilProfile) {
        const key = `${l.kind}|${l.gammaK}|${l.gammaW}|${l.phi}`;
        if (!seen.has(key)) seen.set(key, { gammaK: l.gammaK, gammaW: l.gammaW, phi: l.phi });
      }
    }
    const KIND_LABEL: Record<string, string> = {
      "sand-dry": "Zand",
      "sand-wet": "Zand",
      clay: "Klei",
      peat: "Veen",
    };
    table(
      c,
      [
        { label: "Grondsoort", width: 60 },
        { label: "γ_k [kN/m³]", width: 35, align: "right" },
        { label: "γ_w-aandeel [kN/m³]", width: 45, align: "right" },
        { label: "φ [°]", width: 30, align: "right" },
      ],
      Array.from(seen.entries()).map(([key, v]) => {
        const kind = key.split("|")[0];
        const base = KIND_LABEL[kind] ?? kind;
        // gammaW = 0 → laag (deel) boven GWS gemodelleerd.
        const suffix = v.gammaW === 0 ? " (boven GWS)" : " (onder GWS)";
        return [base + suffix, nl(v.gammaK, 0), nl(v.gammaW, 0), nl(v.phi, 1)];
      }),
    );

    c.y += 2;
    sectionTitle(c, "Berekening");
    paragraph(c, `D_eq = ${first.input.diameterMm} mm`);
    paragraph(
      c,
      `Aantal sonderingen in deze analyse: ${inputs.sonderingen.length} (${inputs.sonderingen.map((s) => s.name).join(", ")})`,
    );
  }
}

// ─── Berekening-blad per sondering ───────────────────────────────

function renderBerekeningBlad(c: Cursor, s: PileReportSondering, factors: PileReportInputs["factors"]): void {
  const { input, result } = s;
  const D = input.diameterMm / 1000;
  const Os = Math.PI * D;
  const wp = result.settlement.sls;
  const L = result.settlement.lM ?? input.pileTopNap - input.pileToeNap;
  const ell = result.settlement.ellM ?? input.pileTopNap - input.negKleefBottomNap;
  const deltaL = result.settlement.deltaLM ?? input.negKleefBottomNap - input.pileToeNap;
  const eaKn = result.settlement.eaKn ?? 0;

  c.newPage();
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(11);
  c.doc.text(`Berekening — sondering ${s.name}`, M.left, c.y);
  c.y += 7;

  // ─── Negatieve kleef ───────────────────────────────────────────
  sectionTitle(c, "Negatieve kleef", "art. 7.3.2.2 (d)");
  paragraph(c, `Niv. negatieve/positieve kleef: ${nlNap(input.negKleefBottomNap)}`);
  paragraph(c, `ΔL_nk = ${nl(result.negKleef.deltaLnk, 2)} m`);

  const nk = result.negKleef;
  const k0tdUniform =
    nk.layers.length > 0 && nk.layers.every((l) => Math.abs(l.k0TanDelta - nk.layers[0].k0TanDelta) < 1e-9)
      ? nk.layers[0].k0TanDelta
      : null;
  const sigmaSum = k0tdUniform !== null && k0tdUniform > 0 && Os > 0
    ? nk.fnkRep / (Os * k0tdUniform)
    : null;
  formula(
    c,
    "F_nk;rep",
    "O_s;gem · K_0tan(δ) · Σ ((σ_v,i-1 + σ_v,i)/2 · h_i)",
    sigmaSum !== null
      ? `${nl(Os, 2)} × ${nl(k0tdUniform!, 2)} × ${nl(sigmaSum, 0)}`
      : nk.layers.map((l) => nl(l.fsNkRep, 1)).join(" + ") || "0",
    `${nl(nk.fnkRep, 0)} kN`,
  );
  formula(
    c,
    "F_nk;d",
    "γ_f,nk · F_nk;rep",
    `${nl(input.gammaFnk, 2)} × ${nl(nk.fnkRep, 0)}`,
    `${nl(nk.fnkD, 0)} kN`,
  );
  if (nk.layers.length > 0) {
    table(
      c,
      [
        { label: "Laag", width: 24 },
        { label: "h [m]", width: 16, align: "right" },
        { label: "σ_top [kPa]", width: 22, align: "right" },
        { label: "σ_bot [kPa]", width: 22, align: "right" },
        { label: "σ_gem·h", width: 20, align: "right" },
        { label: "K_0·tanδ", width: 20, align: "right" },
        { label: "F_s;nk [kN]", width: 24, align: "right" },
      ],
      nk.layers.map((l) => [
        l.layer.kind,
        nl(l.thickness, 2),
        nl(l.sigmaRepTop, 1),
        nl(l.sigmaRepBottom, 1),
        nl(l.sigmaGemRep, 1),
        nl(l.k0TanDelta, 3),
        nl(l.fsNkRep, 1),
      ]),
      { summaryRow: ["Σ", "", "", "", "", "", nl(nk.fnkRep, 1)], size: 7 },
    );
  }

  // ─── Puntdraagvermogen ─────────────────────────────────────────
  sectionTitle(c, "Puntdraagvermogen", "art. 7.6.2.3 (e)");
  const capNote = result.base.qbMaxMpaRaw > 15 ? `${nl(result.base.qbMaxMpa, 2)} MPa (afgekapt op 15,00 MPa)` : `${nl(result.base.qbMaxMpa, 2)} MPa < 15,00 MPa`;
  formula(
    c,
    "q_b;max",
    "1/2 · α_p · β · s · ((q_c;I;gem + q_c;II;gem)/2 + q_c;III;gem)",
    `1/2 × ${nl(factors.alphaP, 2)} × 1,0 × 1,0 × ((${nl(result.base.qcIGemMpa, 2)} + ${nl(result.base.qcIIGemMpa, 2)})/2 + ${nl(result.base.qcIIIGemMpa, 2)})`,
    capNote,
  );
  formula(
    c,
    "R_b;cal;max",
    "A_b · q_b;max",
    `${result.base.abMm2.toFixed(0)} × ${nl(result.base.qbMaxMpa, 2)} × 10^-3`,
    `${result.base.rbCalMax.toFixed(0)} kN`,
  );

  // ─── Maximumschachtwrijving ────────────────────────────────────
  sectionTitle(c, "Maximumschachtwrijving", "art. 7.6.2.3 (c)");
  paragraph(c, `ΔL = ${nl(deltaL, 1)} m`);
  const shaftSum = Os > 0 ? result.shaft.rsCalMax / Os : 0;
  formula(
    c,
    "R_s;cal;max",
    "O_s;gem · Σ (α_s · q_c;j;gem · h_j)",
    `${nl(Os, 3)} × ${nl(shaftSum, 0)}`,
    `${result.shaft.rsCalMax.toFixed(0)} kN`,
  );
  if (result.shaft.perLayer.length > 0) {
    table(
      c,
      [
        { label: "Laag", width: 24 },
        { label: "Van NAP", width: 22, align: "right" },
        { label: "Tot NAP", width: 22, align: "right" },
        { label: "q_c;gem [MPa]", width: 28, align: "right" },
        { label: "q_s [MPa]", width: 24, align: "right" },
        { label: "R_s [kN]", width: 24, align: "right" },
      ],
      result.shaft.perLayer.map((l) => [
        l.layer.kind,
        nl(l.layer.startNap, 2),
        nl(l.layer.endNap, 2),
        nl(l.qcGemMpa, 2),
        nl(l.qsMpa, 3),
        nl(l.rsLayer, 1),
      ]),
      { summaryRow: ["Σ", "", "", "", "", nl(result.shaft.rsCalMax, 1)], size: 7 },
    );
  }

  // ─── Maximum gronddraagvermogen ────────────────────────────────
  sectionTitle(c, "Maximum gronddraagvermogen van de paal", "art. 7.6.2.3 (3)");
  formula(
    c,
    "R_c;cal",
    "R_b;cal;max + R_s;cal;max",
    `${result.base.rbCalMax.toFixed(0)} + ${result.shaft.rsCalMax.toFixed(0)}`,
    `${(result.base.rbCalMax + result.shaft.rsCalMax).toFixed(0)} kN`,
    "...(7.6)",
  );

  // ─── Zakking ───────────────────────────────────────────────────
  sectionTitle(c, "Berekening van de zakking van de paal", "art. 7.6.4.2 (4)");
  formula(
    c,
    "F_c;tot",
    "N_k + F_nk",
    `${input.nEk} + ${nl(nk.fnkD, 0)}`,
    `${wp.fcTot.toFixed(0)} kN`,
  );
  paragraph(c, "Lastzakkingslijn 1:", { italic: true });
  const rbPct = result.base.rbCalMax > 0 ? (wp.rbMobil / result.base.rbCalMax) * 100 : 0;
  const rsPct = result.shaft.rsCalMax > 0 ? (wp.rsMobil / result.shaft.rsCalMax) * 100 : 0;
  formula(
    c,
    "s_b/D_eq · 100",
    `${nl(wp.sbMm, 1)} / ${input.diameterMm} · 100 = ${nl((wp.sbMm / input.diameterMm) * 100, 1)} %`,
    `→ R_b;1 = ${rbPct.toFixed(0)}% · R_b;cal;max = ${rbPct.toFixed(0)}/100 × ${result.base.rbCalMax.toFixed(0)}`,
    `${wp.rbMobil.toFixed(0)} kN`,
    "...(Figuur 7.n)",
  );
  formula(
    c,
    "s_b",
    `${nl(wp.sbMm, 1)} mm`,
    `→ R_s;1 = ${rsPct.toFixed(0)}% · R_s;cal;max = ${rsPct.toFixed(0)}/100 × ${result.shaft.rsCalMax.toFixed(0)}`,
    `${wp.rsMobil.toFixed(0)} kN`,
    "...(Figuur 7.o)",
  );
  formula(
    c,
    "F_gem",
    "(λ·F_c;tot + 0,5·ΔL·(F_c;tot − R_b;1)) / L",
    `(${nl(ell, 1)} × ${wp.fcTot.toFixed(0)} + 0,5 × ${nl(deltaL, 1)} × (${wp.fcTot.toFixed(0)} − ${wp.rbMobil.toFixed(0)})) / ${nl(L, 1)}`,
    `${wp.fgem.toFixed(0)} kN`,
  );
  formula(
    c,
    "s_el",
    "L · F_gem / EA",
    `${nl(L, 1)} × ${wp.fgem.toFixed(0)} × 10³ / ${eaKn.toFixed(0)}`,
    `${nl(wp.selMm, 1)} mm`,
  );
  formula(
    c,
    "s_1",
    "s_b + s_el",
    `${nl(wp.sbMm, 1)} + ${nl(wp.selMm, 1)}`,
    `${nl(wp.s1Mm, 1)} mm`,
    "art. 7.6.4.2 (j)",
  );

  // ─── Veerwaarde ────────────────────────────────────────────────
  sectionTitle(c, "Veerwaarde");
  formula(
    c,
    "k_1",
    "F_c;tot / s_1",
    `${wp.fcTot.toFixed(0)} × 10³ / ${nl(wp.s1Mm, 1)}`,
    `${result.spring.kSlsKnPerM.toFixed(0)} kN/m`,
  );
  formula(
    c,
    "k_min",
    "k_1 / √2",
    `${result.spring.kSlsKnPerM.toFixed(0)} / 1,414`,
    `${result.spring.kMinKnPerM.toFixed(0)} kN/m`,
  );
  formula(
    c,
    "k_max",
    "k_1 · √2",
    `${result.spring.kSlsKnPerM.toFixed(0)} × 1,414`,
    `${result.spring.kMaxKnPerM.toFixed(0)} kN/m`,
  );
  paragraph(
    c,
    `ULS-werkpunt: F_c;tot = ${result.settlement.uls.fcTot.toFixed(0)} kN → s_b = ${nl(result.settlement.uls.sbMm, 1)} mm, s_1 = ${nl(result.settlement.uls.s1Mm, 1)} mm.`,
    { italic: true, size: 7.5 },
  );
}

// ─── Slotblad — statistische eindanalyse ─────────────────────────

function renderEndAnalysis(
  c: Cursor,
  sonderingen: PileReportSondering[],
  summary: MultiCptSummary,
  totalNEd: number,
): void {
  c.newPage();
  sectionTitle(c, "Berekening netto maatgevend paaldraagvermogen", "art. 7.6.2.3 (5)");
  paragraph(c, `Aantal sonderingen n = ${summary.n}`);

  table(
    c,
    [
      { label: "Sondering", width: 36 },
      { label: "R_b;cal [kN]", width: 32, align: "right" },
      { label: "R_s;cal [kN]", width: 32, align: "right" },
      { label: "R_c;cal [kN]", width: 32, align: "right" },
      { label: "F_nk;d [kN]", width: 30, align: "right" },
    ],
    sonderingen.map((s) => [
      s.name,
      s.result.base.rbCalMax.toFixed(0),
      s.result.shaft.rsCalMax.toFixed(0),
      (s.result.base.rbCalMax + s.result.shaft.rsCalMax).toFixed(0),
      s.result.negKleef.fnkD.toFixed(0),
    ]),
    {
      summaryRow: [
        "Gem. / max",
        (sonderingen.reduce((a, s) => a + s.result.base.rbCalMax, 0) / sonderingen.length).toFixed(0),
        (sonderingen.reduce((a, s) => a + s.result.shaft.rsCalMax, 0) / sonderingen.length).toFixed(0),
        summary.rcCalMean.toFixed(0),
        summary.fnkDMean.toFixed(0),
      ],
    },
  );

  paragraph(c, "Type bouwwerk: Niet-stijf");
  formula(
    c,
    "VC",
    "σ / (R_c;cal)_gem · 100%",
    `${summary.stdDev.toFixed(0)} / ${summary.rcCalMean.toFixed(0)} × 100% = ${nl(summary.variatieCoeffPct, 1)}%`,
    `${nl(summary.variatieCoeffPct, 1)}% ${summary.variatieCoeffPct < 12 ? "< 12%" : "≥ 12%"} → n = ${summary.n}`,
  );
  formula(
    c,
    "ξ3 ; ξ4",
    "Tabel A.10b (niet-stijf)",
    null,
    `ξ3 = ${nl(summary.xi3, 2)}   ξ4 = ${nl(summary.xi4, 2)}`,
    "...(tabel A.10)",
  );
  formula(
    c,
    "(R_c;k)_gem",
    "(R_c;cal)_gem / ξ3",
    `${summary.rcCalMean.toFixed(0)} / ${nl(summary.xi3, 2)}`,
    `${summary.rcKGem.toFixed(0)} kN`,
  );
  formula(
    c,
    "(R_c;k)_min",
    "(R_c;cal)_min / ξ4",
    `${summary.rcCalMin.toFixed(0)} / ${nl(summary.xi4, 2)}`,
    `${summary.rcKMin.toFixed(0)} kN`,
  );
  const gammaM = sonderingen[0]?.input.gammaM ?? 1.2;
  formula(
    c,
    "R_c;d",
    "min((R_c;k)_gem ; (R_c;k)_min) / γ_m",
    `min(${summary.rcKGem.toFixed(0)} ; ${summary.rcKMin.toFixed(0)}) / ${nl(gammaM, 2)}`,
    `${summary.rcD.toFixed(0)} kN`,
    "...(7.8)",
  );
  formula(
    c,
    "R_c;net;d",
    "R_c;d − F_nk;d",
    `${summary.rcD.toFixed(0)} − ${summary.fnkDMean.toFixed(0)}`,
    `${summary.rcNetD.toFixed(0)} kN`,
  );
  formula(
    c,
    "NEd/Rc;net;d",
    `${totalNEd} / ${summary.rcNetD.toFixed(0)}`,
    null,
    `${nl(summary.unityCheck, 2)} ${summary.unityCheck <= 1 ? "< 1,0 → voldoet" : "> 1,0 → voldoet niet!"}`,
  );

  c.y += 4;
  c.reserve(12);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(12);
  if (summary.passes) c.doc.setTextColor(20, 120, 40);
  else c.doc.setTextColor(190, 30, 30);
  c.doc.text(
    `Funderingspaal ${summary.passes ? "voldoet" : "voldoet niet!"}`,
    M.left,
    c.y,
  );
  c.doc.setTextColor(0);
}

// ─── Hoofd-export ────────────────────────────────────────────────

export function generatePileReport(inputs: PileReportInputs): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c = makeCursor(doc, inputs.project);

  // Blad 1 — projectblad
  renderProjectBlad(c, inputs);

  // Per sondering: visual → berekening → lastzakkingsdiagram
  for (const s of inputs.sonderingen) {
    if (s.cpt) {
      c.newPage();
      renderSonderingChart({
        doc,
        startY: HEADER_BOTTOM,
        name: s.name,
        input: s.input,
        result: s.result,
        cpt: s.cpt,
      });
    }
    renderBerekeningBlad(c, s, inputs.factors);
    c.newPage();
    renderZakkingDiagram({
      doc,
      startY: HEADER_BOTTOM,
      name: s.name,
      input: s.input,
      result: s.result,
    });
  }

  // Slotblad — statistische eindanalyse
  const totalNEd = inputs.sonderingen[0]?.input.nEd ?? 0;
  renderEndAnalysis(c, inputs.sonderingen, inputs.summary, totalNEd);

  // Vervang het {tp}-token door het werkelijke paginatotaal.
  if (typeof doc.putTotalPages === "function") {
    doc.putTotalPages(TOTAL_PAGES_TOKEN);
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
