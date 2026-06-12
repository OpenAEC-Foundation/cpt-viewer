// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/pile-report-chart.ts
//
// Per-sondering visual-blad voor het paaldraagvermogen-rapport, in de
// stijl van blad 2 van het externe referentierapport (984.pdf):
//
//   - qc-grafiek (0–30 MPa) met blauwe meetcurve
//   - Rf-paneel rechts (10% → 0%, geïnverteerd)
//   - grondlagen-kolom met kleur per grondsoort
//   - paal-balk links met NEd/Nk-pijl (rood, omlaag) en Rb-pijl (blauw, omhoog)
//   - rood/blauwe kleef-balk in de grafiek (neg. kleef / pos. wrijving)
//   - NAP-niveaulijnen (ontgraving, paalkop, water, kleef-grens, paalpunt)
//   - 4D/8D-zones + afgeknotte qc-curve (running-min) + qc;I/II/III-legend
//
// Alle tekenwerk is jsPDF-vector (geen rasterafbeeldingen) zodat de
// PDF klein blijft en scherp print.

import type { jsPDF } from "jspdf";
import type { Cpt } from "../../../../types/cpt";
import type { PileInput, PileResult, SoilKind } from "../types";

// ─── Kleuren ─────────────────────────────────────────────────────
const COL_QC: [number, number, number] = [40, 60, 160];      // meetcurve blauw
const COL_GRID: [number, number, number] = [200, 200, 210];
const COL_NEG: [number, number, number] = [220, 40, 40];     // neg. kleef rood
const COL_POS: [number, number, number] = [40, 70, 200];     // pos. wrijving blauw
const COL_PILE: [number, number, number] = [150, 150, 155];
const COL_CLIP: [number, number, number] = [120, 20, 60];    // afgeknotte qc

const SOIL_FILL: Record<SoilKind, [number, number, number]> = {
  "sand-dry": [247, 228, 99],
  "sand-wet": [247, 228, 99],
  clay: [143, 191, 111],
  peat: [169, 113, 75],
};
const SOIL_SHORT: Record<SoilKind, string> = {
  "sand-dry": "Z",
  "sand-wet": "Z",
  clay: "K",
  peat: "V",
};

export interface ChartPageArgs {
  doc: jsPDF;
  /** Y-positie [mm] waar de chart-zone begint (na de header). */
  startY: number;
  name: string;
  input: PileInput;
  result: PileResult;
  cpt: Cpt;
}

function fmtNap(v: number): string {
  return `NAP ${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")} m`;
}

/** Render het visual-blad. Gaat uit van een verse pagina met chrome. */
export function renderSonderingChart(args: ChartPageArgs): void {
  const { doc, startY, name, input, result, cpt } = args;
  const D_m = input.diameterMm / 1000;

  // ─── Layout [mm] ───────────────────────────────────────────────
  const pileX = 22;        // hart van de losse paal-balk links
  const plotL = 40;        // qc-plot links
  const plotR = 130;       // qc-plot rechts (0–30 MPa)
  const soilL = 133;       // grondkolom
  const soilR = 143;
  const rfL = 150;         // Rf-paneel
  const rfR = 190;
  const plotT = startY + 14;
  const plotB = 268;       // onderkant chart-zone

  const qcMax = 30;        // MPa volledig bereik
  const rfMax = 10;        // %

  // Verticaal bereik [m NAP]
  const groundNap = cpt.metadata.ground_level_nap ?? 0;
  const deepestNap = Math.min(
    ...cpt.points.map((p) => p.depth_nap ?? groundNap - p.depth),
  );
  const topNap = Math.ceil(Math.max(groundNap, input.pileTopNap, input.excavationNap) + 0.6);
  const bottomNap = Math.floor(Math.max(deepestNap, input.pileToeNap - 8 * D_m - 3));
  const yOf = (nap: number): number =>
    plotT + ((topNap - nap) / (topNap - bottomNap)) * (plotB - plotT);
  const xOfQc = (qc: number): number =>
    plotL + (Math.min(qc, qcMax) / qcMax) * (plotR - plotL);
  const xOfRf = (rf: number): number =>
    rfR - (Math.min(rf, rfMax) / rfMax) * (rfR - rfL);

  // ─── Titel ─────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(`Sondering: ${name}`, 14, startY + 6);

  // ─── Grid + assen ──────────────────────────────────────────────
  doc.setLineWidth(0.15);
  doc.setDrawColor(...COL_GRID);
  // Horizontale gridlijnen elke 5 m + NAP-labels
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60);
  for (let nap = Math.floor(topNap / 5) * 5; nap >= bottomNap; nap -= 5) {
    if (nap > topNap) continue;
    const y = yOf(nap);
    doc.line(plotL, y, plotR, y);
    doc.line(rfL, y, rfR, y);
    doc.text(`${nap.toFixed(2).replace(".", ",")}`, plotL - 2, y + 1, { align: "right" });
  }
  // Verticale gridlijnen qc elke 10 MPa + toplabels
  for (let q = 0; q <= qcMax; q += 10) {
    const x = xOfQc(q);
    doc.line(x, plotT, x, plotB);
    doc.text(`${q} MPa`, x, plotT - 1.5, { align: q === 0 ? "left" : "center" });
  }
  // Rf-paneel rand + labels (10% links, 0% rechts)
  for (let r = 0; r <= rfMax; r += 5) {
    const x = xOfRf(r);
    doc.line(x, plotT, x, plotB);
  }
  doc.text("10 %", xOfRf(10), plotT - 1.5, { align: "center" });
  doc.text("0 %", xOfRf(0), plotT - 1.5, { align: "center" });
  // Plot-kaders
  doc.setDrawColor(120);
  doc.setLineWidth(0.25);
  doc.rect(plotL, plotT, plotR - plotL, plotB - plotT);
  doc.rect(rfL, plotT, rfR - rfL, plotB - plotT);

  // ─── 4D/8D zones (vóór de curve zodat de curve eroverheen tekent) ──
  const toe = input.pileToeNap;
  const critBelow = result.base.criticalDepthM; // m onder paalpunt (0,7D..4D)
  // qc;I/II-zone: paalpunt → kritische diepte eronder (lichtgele vulling,
  // matcht de qc;II-legend; qc;I doorloopt dezelfde zone omlaag)
  doc.setFillColor(248, 240, 180);
  doc.rect(plotL, yOf(toe), plotR - plotL, yOf(toe - critBelow) - yOf(toe), "F");
  // qc;III-zone: paalpunt → 8D erboven (roze vulling, matcht qc;III-legend)
  doc.setFillColor(240, 200, 205);
  doc.rect(plotL, yOf(toe + 8 * D_m), plotR - plotL, yOf(toe) - yOf(toe + 8 * D_m), "F");
  // 4D-grens (rood streep-punt) + 8D-grens (groen gestreept)
  doc.setLineDashPattern([2, 1], 0);
  doc.setDrawColor(200, 60, 60);
  doc.setLineWidth(0.25);
  doc.line(plotL, yOf(toe - 4 * D_m), plotR, yOf(toe - 4 * D_m));
  doc.setDrawColor(60, 160, 60);
  doc.line(plotL, yOf(toe + 8 * D_m), plotR, yOf(toe + 8 * D_m));
  doc.setLineDashPattern([], 0);
  // Brackets "8D" (boven paalpunt) en "4D" (onder paalpunt), links van plot
  doc.setFontSize(7);
  doc.setTextColor(0);
  const brX = plotL - 9;
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.line(brX, yOf(toe), brX, yOf(toe + 8 * D_m));
  doc.line(brX - 1, yOf(toe), brX + 1, yOf(toe));
  doc.line(brX - 1, yOf(toe + 8 * D_m), brX + 1, yOf(toe + 8 * D_m));
  doc.text("8D", brX - 1.5, (yOf(toe) + yOf(toe + 8 * D_m)) / 2 + 1, { align: "right" });
  doc.line(brX, yOf(toe), brX, yOf(toe - 4 * D_m));
  doc.line(brX - 1, yOf(toe - 4 * D_m), brX + 1, yOf(toe - 4 * D_m));
  doc.text("4D", brX - 1.5, (yOf(toe) + yOf(toe - 4 * D_m)) / 2 + 2.5, { align: "right" });

  // ─── qc-meetcurve ──────────────────────────────────────────────
  doc.setDrawColor(...COL_QC);
  doc.setLineWidth(0.3);
  let prev: { x: number; y: number } | null = null;
  for (const p of cpt.points) {
    const nap = p.depth_nap ?? groundNap - p.depth;
    if (nap > topNap || nap < bottomNap) { prev = null; continue; }
    const pt = { x: xOfQc(p.qc ?? 0), y: yOf(nap) };
    if (prev) doc.line(prev.x, prev.y, pt.x, pt.y);
    prev = pt;
  }

  // ─── Afgeknotte qc-curve (running-min, donkerrood) ─────────────
  if (result.base.clippedQcCurve && result.base.clippedQcCurve.length > 1) {
    doc.setDrawColor(...COL_CLIP);
    doc.setLineWidth(0.4);
    let pc: { x: number; y: number } | null = null;
    for (const p of result.base.clippedQcCurve) {
      const nap = groundNap - p.depth;
      if (nap > topNap || nap < bottomNap) { pc = null; continue; }
      const pt = { x: xOfQc(p.qcClipped), y: yOf(nap) };
      if (pc) doc.line(pc.x, pc.y, pt.x, pt.y);
      pc = pt;
    }
  }

  // ─── Rf-curve ──────────────────────────────────────────────────
  doc.setDrawColor(...COL_QC);
  doc.setLineWidth(0.3);
  let prevRf: { x: number; y: number } | null = null;
  for (const p of cpt.points) {
    const nap = p.depth_nap ?? groundNap - p.depth;
    if (nap > topNap || nap < bottomNap) { prevRf = null; continue; }
    const rf = p.rf ?? (p.fs !== undefined && p.qc ? (p.fs / p.qc) * 100 : undefined);
    if (rf === undefined) { prevRf = null; continue; }
    const pt = { x: xOfRf(rf), y: yOf(nap) };
    if (prevRf) doc.line(prevRf.x, prevRf.y, pt.x, pt.y);
    prevRf = pt;
  }

  // ─── Grondlagen-kolom ──────────────────────────────────────────
  doc.setLineWidth(0.15);
  for (const l of input.soilProfile) {
    const yT = yOf(Math.min(l.startNap, topNap));
    const yB = yOf(Math.max(l.endNap, bottomNap));
    if (yB <= yT) continue;
    doc.setFillColor(...SOIL_FILL[l.kind]);
    doc.setDrawColor(110);
    doc.rect(soilL, yT, soilR - soilL, yB - yT, "FD");
    if (yB - yT > 4) {
      doc.setFontSize(6.5);
      doc.setTextColor(40);
      doc.text(SOIL_SHORT[l.kind], (soilL + soilR) / 2, (yT + yB) / 2 + 1, { align: "center" });
    }
  }

  // ─── NAP-niveaulijnen + labels ─────────────────────────────────
  interface Level { nap: number; label: string; color: [number, number, number]; dash?: boolean }
  const levels: Level[] = [
    { nap: input.excavationNap, label: fmtNap(input.excavationNap), color: [150, 90, 60] },
    { nap: input.pileTopNap, label: fmtNap(input.pileTopNap), color: [0, 0, 0] },
    { nap: input.waterNap, label: fmtNap(input.waterNap), color: [60, 120, 220], dash: true },
    { nap: input.negKleefBottomNap, label: fmtNap(input.negKleefBottomNap), color: [0, 0, 0] },
    { nap: input.pileToeNap, label: fmtNap(input.pileToeNap), color: [0, 0, 0] },
  ];
  doc.setFontSize(7);
  // Stagger labels om overlap te voorkomen (sorteer op nap, alterneer x).
  const sorted = [...levels].sort((a, b) => b.nap - a.nap);
  sorted.forEach((lv, i) => {
    const y = yOf(lv.nap);
    doc.setDrawColor(...lv.color);
    doc.setLineWidth(0.25);
    if (lv.dash) doc.setLineDashPattern([2.2, 1.2], 0);
    doc.line(plotL, y, plotR, y);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(...lv.color);
    const lx = plotL + 22 + (i % 3) * 26;
    doc.text(lv.label, lx, y - 0.8);
  });
  doc.setTextColor(0);

  // ─── Paal-balk links + belasting-pijlen ────────────────────────
  const pTopY = yOf(input.pileTopNap);
  const pToeY = yOf(input.pileToeNap);
  doc.setFillColor(...COL_PILE);
  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.rect(pileX - 1.6, pTopY, 3.2, pToeY - pTopY, "FD");
  // NEd/Nk-pijl boven de paal (rood, omlaag)
  doc.setDrawColor(...COL_NEG);
  doc.setFillColor(...COL_NEG);
  doc.setLineWidth(0.6);
  doc.line(pileX, pTopY - 9, pileX, pTopY - 2.5);
  doc.triangle(pileX - 1.3, pTopY - 3, pileX + 1.3, pTopY - 3, pileX, pTopY - 0.5, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  doc.text(`NEd=${input.nEd} kN`, pileX - 4, pTopY - 12.5);
  doc.text(`Nk=${input.nEk} kN`, pileX - 4, pTopY - 9.5);
  // Rb-pijl onder paalpunt (blauw, omhoog)
  doc.setDrawColor(...COL_POS);
  doc.setFillColor(...COL_POS);
  doc.line(pileX, pToeY + 9, pileX, pToeY + 2.5);
  doc.triangle(pileX - 1.3, pToeY + 3, pileX + 1.3, pToeY + 3, pileX, pToeY + 0.5, "F");
  doc.setTextColor(0);
  doc.text(`${result.base.rbCalMax.toFixed(0)} kN`, pileX - 4, pToeY + 13);

  // ─── Kleef-balk in de grafiek (rood = neg, blauw = pos) ────────
  const kleefX = plotR + 1.2;
  const kleefY = yOf(input.negKleefBottomNap);
  doc.setFillColor(...COL_NEG);
  doc.rect(kleefX, pTopY, 1.8, kleefY - pTopY, "F");
  doc.setFillColor(...COL_POS);
  doc.rect(kleefX, kleefY, 1.8, pToeY - kleefY, "F");
  // Labels + pijlen: Fnk (rood omlaag, halverwege neg-zone) en Rs (blauw omhoog)
  const negMidY = (pTopY + kleefY) / 2;
  doc.setDrawColor(...COL_NEG);
  doc.setFillColor(...COL_NEG);
  doc.setLineWidth(0.6);
  doc.line(plotR - 8, negMidY - 5, plotR - 8, negMidY + 1);
  doc.triangle(plotR - 9.2, negMidY + 0.6, plotR - 6.8, negMidY + 0.6, plotR - 8, negMidY + 2.6, "F");
  doc.setTextColor(0);
  doc.text(`${result.negKleef.fnkD.toFixed(0)} kN`, plotR - 11, negMidY - 6.5, { align: "right" });
  const posMidY = (kleefY + pToeY) / 2;
  doc.setDrawColor(...COL_POS);
  doc.setFillColor(...COL_POS);
  doc.line(plotR - 8, posMidY + 5, plotR - 8, posMidY - 1);
  doc.triangle(plotR - 9.2, posMidY - 0.6, plotR - 6.8, posMidY - 0.6, plotR - 8, posMidY - 2.6, "F");
  doc.text(`${result.shaft.rsCalMax.toFixed(0)} kN`, plotR - 11, posMidY + 8, { align: "right" });

  // ─── qc;I/II/III legend (zoals referentie, midden-links) ───────
  const legX = plotL + 14;
  const legY = yOf((topNap + input.negKleefBottomNap) / 2) - 6;
  const legend: Array<{ sw: [number, number, number]; txt: string }> = [
    { sw: [240, 200, 205], txt: `qc;III;gem = ${result.base.qcIIIGemMpa.toFixed(2).replace(".", ",")} MPa` },
    { sw: [248, 240, 180], txt: `qc;II;gem = ${result.base.qcIIGemMpa.toFixed(2).replace(".", ",")} MPa` },
    { sw: [216, 232, 160], txt: `qc;I;gem = ${result.base.qcIGemMpa.toFixed(2).replace(".", ",")} MPa` },
  ];
  doc.setFontSize(7.5);
  legend.forEach((l, i) => {
    const y = legY + i * 5;
    doc.setFillColor(...l.sw);
    doc.setDrawColor(120);
    doc.setLineWidth(0.15);
    doc.rect(legX, y - 2.6, 6, 3.4, "FD");
    doc.setTextColor(0);
    doc.text(l.txt, legX + 7.5, y);
  });
}
