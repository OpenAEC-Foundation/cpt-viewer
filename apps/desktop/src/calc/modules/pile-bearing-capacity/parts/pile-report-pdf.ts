// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/pile-report-pdf.ts
//
// Multi-sondering paaldraagvermogen-rapport in ExternPakket 984.pdf-stijl.
// Genereert per sondering een complete uitwerking (algemeen, grondsoorten,
// qc-gemiddelden, negatieve kleef, puntdraag, schachtwrijving, zakking)
// + eindanalyse met statistische combinatie van alle sonderingen.
//
// Output: jsPDF document → Uint8Array bytes. Geschikt voor browser-download
// of opslag via Tauri-fs.

import { jsPDF } from "jspdf";
import type { PileInput, PileResult } from "../types";
import type { MultiCptSummary } from "./multi-cpt-summary";

export interface PileReportProject {
  /** Projectnummer (bv. "2705"). */
  number: string;
  /** Beschrijving (bv. "Funderingsherstel"). */
  description: string;
  /** Norm-referentie (bv. "NEN 9997-1:2025+C1:2025 nl"). */
  norm: string;
  /** Datum als ISO-string of vrij format (bv. "26-05-2026"). */
  date: string;
  /** Bedrijfsnaam / opsteller (bv. "3BM Bouwtechniek"). */
  author: string;
}

export interface PileReportSondering {
  /** Naam zoals "S1", "S3", "Sondering 1". */
  name: string;
  /** PileInput zoals gebruikt bij de berekening. */
  input: PileInput;
  /** Complete berekenings-resultaat van computePile(). */
  result: PileResult;
}

export interface PileReportInputs {
  project: PileReportProject;
  sonderingen: PileReportSondering[];
  /** Multi-CPT statistische eindanalyse. */
  summary: MultiCptSummary;
  /** Paaltype-naam voor de cover-tekst. */
  pileTypeName: string;
  /** Factoren αp, αs, αt uit de pile-catalog. */
  factors: { alphaP: number; alphaS: number; alphaT: number };
}

// ─── PDF layout constants ────────────────────────────────────────
const PAGE_W = 210; // A4 portrait mm
const PAGE_H = 297;
const M = { top: 14, right: 14, bottom: 18, left: 14 };
const CONTENT_W = PAGE_W - M.left - M.right;
const FOOTER_Y = PAGE_H - 8;
const HEADER_H = 18;

// ─── Cursor-state helper ─────────────────────────────────────────
// Houdt de y-positie bij + voegt automatisch nieuwe pagina's toe wanneer
// content beneden de footer-zone dreigt te komen. Per pagina worden header
// + footer geprint via een callback.

interface Cursor {
  doc: jsPDF;
  y: number;
  pageNo: number;
  totalPages: () => number;
  newPage: () => void;
  /** Reserveer ruimte (h mm); voeg pagina toe als het anders buiten valt. */
  reserve: (h: number) => void;
}

function makeCursor(doc: jsPDF, project: PileReportProject): Cursor {
  let pageNo = 1;
  const printChrome = () => {
    // Header — project info + paginanummer (rechts)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(project.author, M.left, 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `Project ${project.number} — ${project.description}`,
      M.left,
      12,
    );
    doc.text(`Datum: ${project.date}`, PAGE_W - M.right, 8, { align: "right" });
    doc.text(`Blad ${pageNo}`, PAGE_W - M.right, 12, { align: "right" });
    doc.setDrawColor(150);
    doc.line(M.left, 14, PAGE_W - M.right, 14);

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(
      "Open Geotechniek Studio — paaldraagvermogen-rapport",
      PAGE_W / 2,
      FOOTER_Y,
      { align: "center" },
    );
    doc.setTextColor(0);
  };
  printChrome();
  const cursor: Cursor = {
    doc,
    y: M.top + HEADER_H,
    pageNo,
    totalPages: () => pageNo,
    newPage: () => {
      doc.addPage();
      pageNo += 1;
      cursor.pageNo = pageNo;
      cursor.y = M.top + HEADER_H;
      printChrome();
    },
    reserve: (h: number) => {
      if (cursor.y + h > FOOTER_Y - 4) cursor.newPage();
    },
  };
  return cursor;
}

// ─── Render helpers ──────────────────────────────────────────────

function sectionTitle(c: Cursor, title: string): void {
  c.reserve(10);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(11);
  c.doc.setTextColor(20, 20, 80);
  c.doc.text(title, M.left, c.y);
  c.doc.setTextColor(0);
  c.y += 6;
}

function subTitle(c: Cursor, title: string): void {
  c.reserve(7);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(9.5);
  c.doc.text(title, M.left, c.y);
  c.y += 4.5;
}

function paragraph(c: Cursor, text: string, opts: { italic?: boolean; size?: number } = {}): void {
  const size = opts.size ?? 8;
  const lineH = size * 0.45;
  const lines = c.doc.splitTextToSize(text, CONTENT_W);
  c.reserve(lines.length * lineH + 1);
  c.doc.setFont("helvetica", opts.italic ? "italic" : "normal");
  c.doc.setFontSize(size);
  for (const line of lines) {
    c.doc.text(line, M.left, c.y);
    c.y += lineH;
  }
  c.y += 1;
}

/** Open Calculation Studio-stijl 3-regelige formule. */
function formula(c: Cursor, lhs: string, symbolic: string, filled: string, result: string): void {
  c.reserve(15);
  c.doc.setFont("courier", "normal");
  c.doc.setFontSize(9);
  const lhsW = 28;
  c.doc.text(lhs, M.left, c.y);
  c.doc.text("=", M.left + lhsW, c.y);
  c.doc.text(symbolic, M.left + lhsW + 4, c.y);
  c.y += 4;
  c.doc.text("=", M.left + lhsW, c.y);
  c.doc.text(filled, M.left + lhsW + 4, c.y);
  c.y += 4;
  c.doc.setFont("courier", "bold");
  c.doc.text("=", M.left + lhsW, c.y);
  c.doc.text(result, M.left + lhsW + 4, c.y);
  c.y += 5;
  c.doc.setFont("helvetica", "normal");
}

interface TableCol {
  label: string;
  width: number;
  align?: "left" | "right";
  bold?: boolean;
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

  // Header bg
  c.doc.setFillColor(230, 232, 240);
  c.doc.rect(M.left, c.y - rowH * 0.6, CONTENT_W, headerH, "F");
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(size);
  let x = M.left + 1;
  for (const col of cols) {
    const tx = col.align === "right" ? x + col.width - 1 : x;
    c.doc.text(col.label, tx, c.y, { align: col.align === "right" ? "right" : undefined });
    x += col.width;
  }
  c.y += headerH;

  // Body
  c.doc.setFont("helvetica", "normal");
  c.doc.setDrawColor(220);
  for (const row of rows) {
    let cx = M.left + 1;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const txt = row[i] ?? "";
      const tx = col.align === "right" ? cx + col.width - 1 : cx;
      c.doc.text(txt, tx, c.y, { align: col.align === "right" ? "right" : undefined });
      cx += col.width;
    }
    c.y += rowH;
  }

  // Summary row
  if (opts.summaryRow) {
    c.doc.setFillColor(245, 235, 215);
    c.doc.rect(M.left, c.y - rowH * 0.6, CONTENT_W, rowH, "F");
    c.doc.setFont("helvetica", "bold");
    let cx = M.left + 1;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const txt = opts.summaryRow[i] ?? "";
      const tx = col.align === "right" ? cx + col.width - 1 : cx;
      c.doc.text(txt, tx, c.y, { align: col.align === "right" ? "right" : undefined });
      cx += col.width;
    }
    c.y += rowH;
  }
  c.y += 2;
  c.doc.setDrawColor(0);
  c.doc.setFont("helvetica", "normal");
}

function spacer(c: Cursor, h: number): void {
  c.y += h;
}

// ─── Per-sondering sectie ────────────────────────────────────────

function renderSondering(c: Cursor, s: PileReportSondering, factors: PileReportInputs["factors"]): void {
  const { input, result } = s;
  const D = input.diameterMm / 1000;
  const Os = Math.PI * D;
  const Ab_mm2 = (Math.PI / 4) * input.diameterMm ** 2;

  c.newPage();
  sectionTitle(c, `FUNDERINGSPAAL: ${s.name}`);

  // Algemeen
  subTitle(c, "Algemeen");
  paragraph(c, `Paaltype: ${input.pileTypeId} — diameter D = ${input.diameterMm} mm  (D_eq = ${input.diameterMm} mm)`);
  paragraph(c, `Wanddikte: ${input.wallThicknessMm.toFixed(1)} mm`);
  paragraph(c, `Paalkop: NAP ${input.pileTopNap.toFixed(2)} m  ·  Paalpunt: NAP ${input.pileToeNap.toFixed(2)} m`);
  paragraph(c, `Waterniveau: NAP ${input.waterNap.toFixed(2)} m  ·  Ontgraving: NAP ${input.excavationNap.toFixed(2)} m`);
  paragraph(c, `Neg.kleef-onderkant: NAP ${input.negKleefBottomNap.toFixed(2)} m  ·  ksMin-factor: ${input.ksMinFactor.toFixed(2)}`);
  paragraph(c, `Belasting: N_Ed = ${input.nEd} kN  ·  N_k = ${input.nEk} kN  ·  γ_m = ${input.gammaM}  ·  γ_f,nk = ${input.gammaFnk}`);
  paragraph(c, `Factoren (Tabel 7.c): α_p = ${factors.alphaP}  ·  α_s = ${factors.alphaS}  ·  α_t = ${factors.alphaT}`);

  // Grondsoorten-overzicht
  subTitle(c, "Grondsoorten-profiel");
  table(
    c,
    [
      { label: "Laag", width: 30 },
      { label: "Van NAP", width: 22, align: "right" },
      { label: "Tot NAP", width: 22, align: "right" },
      { label: "h [m]", width: 18, align: "right" },
      { label: "γ_k [kN/m³]", width: 26, align: "right" },
      { label: "γ_w [kN/m³]", width: 26, align: "right" },
      { label: "Φ [°]", width: 18, align: "right" },
    ],
    input.soilProfile.map((l) => [
      l.kind,
      l.startNap.toFixed(2),
      l.endNap.toFixed(2),
      (l.startNap - l.endNap).toFixed(2),
      l.gammaK.toFixed(1),
      l.gammaW.toFixed(1),
      l.phi.toFixed(1),
    ]),
  );

  // Negatieve kleef — formules + per-laag tabel + totaal
  subTitle(c, "Negatieve kleef");
  formula(c, "O_s", "π · D", `π · ${D.toFixed(3)}`, `${Os.toFixed(3)} m`);
  paragraph(
    c,
    `Zone: van paalkop NAP ${input.pileTopNap.toFixed(2)} tot NAP ${input.negKleefBottomNap.toFixed(2)}  ·  ΔL_nk = ${result.negKleef.deltaLnk.toFixed(2)} m`,
  );
  if (result.negKleef.layers.length > 0) {
    table(
      c,
      [
        { label: "Laag", width: 28 },
        { label: "h [m]", width: 16, align: "right" },
        { label: "σ_top", width: 18, align: "right" },
        { label: "σ_bot", width: 18, align: "right" },
        { label: "σ_gem·h", width: 22, align: "right" },
        { label: "K_0", width: 18, align: "right" },
        { label: "tan(δ)", width: 20, align: "right" },
        { label: "K_0tanδ", width: 22, align: "right" },
        { label: "F_s;nk [kN]", width: 20, align: "right" },
      ],
      result.negKleef.layers.map((l) => [
        l.layer.kind,
        l.thickness.toFixed(2),
        l.sigmaRepTop.toFixed(1),
        l.sigmaRepBottom.toFixed(1),
        l.sigmaGemRep.toFixed(1),
        l.k0.toFixed(3),
        Math.tan(l.delta).toFixed(3),
        l.k0TanDelta.toFixed(3),
        l.fsNkRep.toFixed(1),
      ]),
      {
        summaryRow: [
          "Σ F_s;nk",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          result.negKleef.fnkRep.toFixed(1),
        ],
      },
    );
  } else {
    paragraph(c, "Geen lagen in de neg-kleef-zone.", { italic: true });
  }
  formula(
    c,
    "F_nk;rep",
    "Σ F_s;nk;i",
    result.negKleef.layers.map((l) => l.fsNkRep.toFixed(1)).join(" + ") || "0",
    `${result.negKleef.fnkRep.toFixed(1)} kN`,
  );
  formula(
    c,
    "F_nk;d",
    "γ_f,nk · F_nk;rep",
    `${input.gammaFnk.toFixed(2)} · ${result.negKleef.fnkRep.toFixed(1)}`,
    `${result.negKleef.fnkD.toFixed(1)} kN`,
  );

  // Puntdraagvermogen
  subTitle(c, "Puntdraagvermogen");
  paragraph(c, `q_c;I;gem = ${result.base.qcIGemMpa.toFixed(2)} MPa  ·  q_c;II;gem = ${result.base.qcIIGemMpa.toFixed(2)} MPa  ·  q_c;III;gem = ${result.base.qcIIIGemMpa.toFixed(2)} MPa`);
  paragraph(c, `d_crit = ${result.base.criticalDepthM.toFixed(2)} m  (= optimale critische diepte tussen 0,7·D_eq en 4·D_eq)`);
  formula(
    c,
    "q_b;max",
    "1/2 · α_p · β · s · ( (q_c;I+q_c;II)/2 + q_c;III )",
    `0,5 · ${factors.alphaP} · 1 · 1 · ((${result.base.qcIGemMpa.toFixed(2)}+${result.base.qcIIGemMpa.toFixed(2)})/2 + ${result.base.qcIIIGemMpa.toFixed(2)})`,
    `${result.base.qbMaxMpa.toFixed(2)} MPa${result.base.qbMaxMpaRaw > 15 ? " (gecapt op 15)" : ""}`,
  );
  formula(
    c,
    "R_b;cal;max",
    "A_b · q_b;max",
    `${Ab_mm2.toFixed(0)} · ${result.base.qbMaxMpa.toFixed(2)} · 10⁻³`,
    `${result.base.rbCalMax.toFixed(0)} kN`,
  );

  // Schachtwrijving
  subTitle(c, "Maximumschachtwrijving");
  if (result.shaft.perLayer.length > 0) {
    table(
      c,
      [
        { label: "Laag", width: 30 },
        { label: "Van NAP", width: 24, align: "right" },
        { label: "Tot NAP", width: 24, align: "right" },
        { label: "q_c;gem [MPa]", width: 30, align: "right" },
        { label: "q_s [MPa]", width: 26, align: "right" },
        { label: "R_s [kN]", width: 28, align: "right" },
      ],
      result.shaft.perLayer.map((l) => [
        l.layer.kind,
        l.layer.startNap.toFixed(2),
        l.layer.endNap.toFixed(2),
        l.qcGemMpa.toFixed(2),
        l.qsMpa.toFixed(3),
        l.rsLayer.toFixed(1),
      ]),
      {
        summaryRow: ["Σ", "", "", "", "", result.shaft.rsCalMax.toFixed(1)],
      },
    );
  }
  formula(
    c,
    "R_s;cal;max",
    "O_s · Σ α_s · q_c;gem;j · h_j",
    `${Os.toFixed(3)} · Σ ${factors.alphaS} · q_c;gem · h`,
    `${result.shaft.rsCalMax.toFixed(0)} kN`,
  );

  // Maximum gronddraagvermogen
  subTitle(c, "Maximum gronddraagvermogen");
  formula(
    c,
    "R_c;cal",
    "R_b;cal;max + R_s;cal;max",
    `${result.base.rbCalMax.toFixed(0)} + ${result.shaft.rsCalMax.toFixed(0)}`,
    `${(result.base.rbCalMax + result.shaft.rsCalMax).toFixed(0)} kN`,
  );

  // Zakking
  subTitle(c, "Zakking (lastzakkingslijn 1)");
  paragraph(c, `SLS — F_c;tot = ${result.settlement.sls.fcTot.toFixed(0)} kN  ·  s_b = ${result.settlement.sls.sbMm.toFixed(1)} mm  ·  s_1 = ${result.settlement.sls.s1Mm.toFixed(1)} mm  ·  s_el = ${result.settlement.sls.selMm.toFixed(1)} mm`);
  paragraph(c, `ULS — F_c;tot = ${result.settlement.uls.fcTot.toFixed(0)} kN  ·  s_b = ${result.settlement.uls.sbMm.toFixed(1)} mm  ·  s_1 = ${result.settlement.uls.s1Mm.toFixed(1)} mm`);
  paragraph(c, `Mobilisatie SLS: R_b;mobil = ${result.settlement.sls.rbMobil.toFixed(0)} kN  ·  R_s;mobil = ${result.settlement.sls.rsMobil.toFixed(0)} kN`);

  // Veerwaarde
  subTitle(c, "Veerwaarde");
  formula(
    c,
    "k_SLS",
    "F_c;tot / s_1",
    `${result.settlement.sls.fcTot.toFixed(0)} · 10³ / ${result.settlement.sls.s1Mm.toFixed(1)}`,
    `${result.spring.kSlsKnPerM.toFixed(0)} kN/m`,
  );
  paragraph(c, `k_min = ${result.spring.kMinKnPerM.toFixed(0)} kN/m  ·  k_max = ${result.spring.kMaxKnPerM.toFixed(0)} kN/m`);
}

// ─── Eindanalyse sectie ──────────────────────────────────────────

function renderEndAnalysis(
  c: Cursor,
  sonderingen: PileReportSondering[],
  summary: MultiCptSummary,
  totalNEd: number,
): void {
  c.newPage();
  sectionTitle(c, "Berekening netto maatgevend paaldraagvermogen");
  paragraph(c, `Aantal sonderingen: n = ${summary.n}`);
  paragraph(c, `Type bouwwerk: niet-stijf`, { italic: true });

  // Tabel: per sondering Rb / Rs / Rc / Fnk
  subTitle(c, "Per sondering — draagvermogen-componenten");
  table(
    c,
    [
      { label: "Sondering", width: 40 },
      { label: "R_b;cal [kN]", width: 32, align: "right" },
      { label: "R_s;cal [kN]", width: 32, align: "right" },
      { label: "R_c;cal [kN]", width: 32, align: "right" },
      { label: "F_nk;d [kN]", width: 28, align: "right" },
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
        "Gemiddeld",
        (
          sonderingen.reduce((a, s) => a + s.result.base.rbCalMax, 0) /
          sonderingen.length
        ).toFixed(0),
        (
          sonderingen.reduce((a, s) => a + s.result.shaft.rsCalMax, 0) /
          sonderingen.length
        ).toFixed(0),
        summary.rcCalMean.toFixed(0),
        summary.fnkDMean.toFixed(0),
      ],
    },
  );

  // Statistische analyse
  subTitle(c, "Statistische analyse (NEN 9997-1 NB §7.6.2.3 (5) + Tabel A.10b)");
  formula(
    c,
    "VC",
    "σ / R_c;cal;gem · 100%",
    `${summary.stdDev.toFixed(1)} / ${summary.rcCalMean.toFixed(0)} · 100%`,
    `${summary.variatieCoeffPct.toFixed(1)}%  (${summary.variatieCoeffPct < 12 ? "< 12% → gunstige ξ-waarden" : "≥ 12%"})`,
  );
  paragraph(c, `ξ_3 = ${summary.xi3.toFixed(2)}  ·  ξ_4 = ${summary.xi4.toFixed(2)}  (Tabel A.10b, n=${summary.n}, niet-stijf)`);

  formula(
    c,
    "(R_c;k)gem",
    "R_c;cal;gem / ξ_3",
    `${summary.rcCalMean.toFixed(0)} / ${summary.xi3.toFixed(2)}`,
    `${summary.rcKGem.toFixed(0)} kN`,
  );
  formula(
    c,
    "(R_c;k)min",
    "R_c;cal;min / ξ_4",
    `${summary.rcCalMin.toFixed(0)} / ${summary.xi4.toFixed(2)}`,
    `${summary.rcKMin.toFixed(0)} kN`,
  );
  formula(
    c,
    "R_c;d",
    "min((R_c;k)gem, (R_c;k)min) / γ_m",
    `min(${summary.rcKGem.toFixed(0)}, ${summary.rcKMin.toFixed(0)}) / ${(summary.rcK / summary.rcD).toFixed(2)}`,
    `${summary.rcD.toFixed(0)} kN`,
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
    "U.C.",
    "N_Ed / R_c;net;d",
    `${totalNEd} / ${summary.rcNetD.toFixed(0)}`,
    `${summary.unityCheck.toFixed(2)}  ${summary.passes ? "✓ VOLDOET" : "✗ VOLDOET NIET"}`,
  );

  spacer(c, 4);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(11);
  c.doc.setTextColor(summary.passes ? 22 : 180, summary.passes ? 130 : 30, 0);
  c.doc.text(
    `Conclusie: Funderingspaal ${summary.passes ? "VOLDOET" : "VOLDOET NIET"} (U.C. = ${summary.unityCheck.toFixed(2)})`,
    M.left,
    c.y + 6,
  );
  c.doc.setTextColor(0);
}

// ─── Hoofd-export ────────────────────────────────────────────────

export function generatePileReport(inputs: PileReportInputs): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c = makeCursor(doc, inputs.project);

  // ─── Cover-pagina ──────────────────────────────────────────
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(18);
  c.doc.text("Paaldraagvermogen-rapport", PAGE_W / 2, 50, { align: "center" });
  c.doc.setFontSize(13);
  c.doc.text(inputs.project.description, PAGE_W / 2, 60, { align: "center" });
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(10);
  c.doc.text(`Project ${inputs.project.number}`, PAGE_W / 2, 70, { align: "center" });
  c.doc.text(`Norm: ${inputs.project.norm}`, PAGE_W / 2, 76, { align: "center" });
  c.doc.text(`Paaltype: ${inputs.pileTypeName}`, PAGE_W / 2, 82, { align: "center" });
  c.doc.text(`Datum: ${inputs.project.date}`, PAGE_W / 2, 88, { align: "center" });
  c.doc.setFontSize(9);
  c.doc.text(
    `Aantal sonderingen: ${inputs.sonderingen.length}`,
    PAGE_W / 2, 100, { align: "center" },
  );

  c.y = 120;
  subTitle(c, "Inhoudsopgave");
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(9);
  let tocY = c.y;
  for (let i = 0; i < inputs.sonderingen.length; i++) {
    c.doc.text(
      `${i + 1}. Sondering ${inputs.sonderingen[i].name}`,
      M.left + 6, tocY,
    );
    tocY += 5;
  }
  c.doc.text(
    `${inputs.sonderingen.length + 1}. Statistische eindanalyse + conclusie`,
    M.left + 6, tocY,
  );
  c.y = tocY + 10;

  // ─── Loop per sondering ────────────────────────────────────
  // Hier zit de "loop" die de gebruiker vroeg — per sondering
  // wordt EXACT dezelfde sectie geproduceerd als in ExternPakket
  // 984.pdf, met alle waarden uit de bijhorende berekening.
  for (const s of inputs.sonderingen) {
    renderSondering(c, s, inputs.factors);
  }

  // ─── Eindanalyse (statistische combinatie) ─────────────────
  const totalNEd = inputs.sonderingen[0]?.input.nEd ?? 0;
  renderEndAnalysis(c, inputs.sonderingen, inputs.summary, totalNEd);

  return new Uint8Array(doc.output("arraybuffer"));
}
