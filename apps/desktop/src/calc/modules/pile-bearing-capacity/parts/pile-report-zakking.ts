// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/pile-report-zakking.ts
//
// Lastzakkingsdiagram-blad in de stijl van blad 4 van het externe
// referentierapport: bidirectionele x-as met schachtwrijving Rs naar
// LINKS en puntweerstand Rb naar RECHTS vanaf 0 kN in het midden;
// y-as = paalpunt-zakking s_b omlaag. Mobilisatiecurves (Figuur 7.n/7.o)
// als blauwe lijnen, rode verticalen op Rs;cal;max en Rb;cal;max, en het
// SLS-werkpunt met horizontale verbindingslijn + labels.

import type { jsPDF } from "jspdf";
import type { PileInput, PileResult } from "../types";

const COL_CURVE: [number, number, number] = [40, 60, 160];
const COL_MAX: [number, number, number] = [220, 50, 50];
const COL_GRID: [number, number, number] = [205, 205, 215];

export interface ZakkingPageArgs {
  doc: jsPDF;
  startY: number;
  name: string;
  input: PileInput;
  result: PileResult;
}

function niceCeil(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}

export function renderZakkingDiagram(args: ZakkingPageArgs): void {
  const { doc, startY, name, result } = args;
  const { settlement } = result;
  const rsMax = result.shaft.rsCalMax;
  const rbMax = result.base.rbCalMax;
  const wp = settlement.sls;

  // ─── Layout ────────────────────────────────────────────────────
  const plotL = 24;
  const plotR = 186;
  const plotT = startY + 14;
  const plotB = 262;

  // X-bereik: links Rs (negatief), rechts Rb. Ronde 100 kN stappen.
  const xLeftMax = niceCeil(rsMax * 1.15, 100);   // kN naar links
  const xRightMax = niceCeil(rbMax * 1.15, 100);  // kN naar rechts
  const xSpan = xLeftMax + xRightMax;
  const xOf = (kn: number): number =>
    plotL + ((kn + xLeftMax) / xSpan) * (plotR - plotL); // kn<0 = links (Rs)

  // Y-bereik: 0 → max zakking van de curve (0,1·Deq) — ronde 5 mm.
  const sMax = niceCeil(Math.max(...settlement.curve.map((p) => p.sbMm), 1), 5);
  const yOf = (mm: number): number => plotT + (mm / sMax) * (plotB - plotT);

  // ─── Titel ─────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(`Lastzakkingsdiagram — ${name}`, 14, startY + 6);

  // ─── Grid + as-labels ──────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60);
  doc.setLineWidth(0.15);
  doc.setDrawColor(...COL_GRID);
  // Verticale gridlijnen per 100 kN met label "<n> kN"
  for (let kn = -xLeftMax; kn <= xRightMax; kn += 100) {
    const x = xOf(kn);
    doc.line(x, plotT, x, plotB);
    doc.text(`${Math.abs(kn)} kN`, x, plotT - 1.5, { align: "center" });
  }
  // Horizontale gridlijnen per 5 mm + labels "10 mm" / "20 mm"
  for (let mm = 0; mm <= sMax; mm += 5) {
    const y = yOf(mm);
    doc.line(plotL, y, plotR, y);
    if (mm > 0 && mm % 10 === 0) {
      doc.text(`${mm} mm`, xOf(0) - 2, y - 1, { align: "right" });
    }
  }
  // Nul-as (verticaal, zwart)
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(xOf(0), plotT, xOf(0), plotB);
  doc.rect(plotL, plotT, plotR - plotL, plotB - plotT);

  // ─── Rode verticalen op Rs;cal;max (links) en Rb;cal;max (rechts) ──
  doc.setDrawColor(...COL_MAX);
  doc.setLineWidth(0.35);
  doc.line(xOf(-rsMax), plotT, xOf(-rsMax), plotB);
  doc.line(xOf(rbMax), plotT, xOf(rbMax), plotB);
  doc.setFontSize(7.5);
  doc.setTextColor(0);
  doc.text(`Rs;cal;max=${rsMax.toFixed(0)} kN`, xOf(-rsMax) + 1.5, plotB - 2);
  doc.text(`Rb;cal;max=${rbMax.toFixed(0)} kN`, xOf(rbMax) - 1.5, plotB - 2, { align: "right" });

  // ─── Mobilisatiecurves ─────────────────────────────────────────
  doc.setDrawColor(...COL_CURVE);
  doc.setLineWidth(0.45);
  // Rb-tak (rechts)
  let prev: { x: number; y: number } | null = null;
  for (const p of settlement.curve) {
    const pt = { x: xOf(p.rbKn), y: yOf(p.sbMm) };
    if (prev) doc.line(prev.x, prev.y, pt.x, pt.y);
    prev = pt;
  }
  // Rs-tak (links, gespiegeld)
  prev = null;
  for (const p of settlement.curve) {
    const pt = { x: xOf(-p.rsKn), y: yOf(p.sbMm) };
    if (prev) doc.line(prev.x, prev.y, pt.x, pt.y);
    prev = pt;
  }

  // ─── SLS-werkpunt ──────────────────────────────────────────────
  const wy = yOf(wp.sbMm);
  doc.setDrawColor(...COL_CURVE);
  doc.setLineWidth(0.5);
  doc.line(xOf(-wp.rsMobil), wy, xOf(wp.rbMobil), wy);
  doc.setFillColor(...COL_CURVE);
  doc.circle(xOf(-wp.rsMobil), wy, 0.9, "F");
  doc.circle(xOf(wp.rbMobil), wy, 0.9, "F");
  doc.circle(xOf(0), wy, 0.7, "F");
  // Label zakking bij werkpunt
  doc.setFontSize(7.5);
  doc.text(`${wp.sbMm.toFixed(1).replace(".", ",")} mm`, xOf(0) + 1.5, wy + 2.8);
  // Maatlijnen met labels Rs;1 / Rb;1 / Ftot;1 onder het werkpunt
  const dimY1 = wy + 9;
  const dimY2 = wy + 16;
  doc.setLineWidth(0.2);
  doc.setDrawColor(80);
  // Rs;1 + Rb;1 maatlijn
  doc.line(xOf(-wp.rsMobil), wy + 1.5, xOf(-wp.rsMobil), dimY1 + 1.5);
  doc.line(xOf(wp.rbMobil), wy + 1.5, xOf(wp.rbMobil), dimY2 + 1.5);
  doc.line(xOf(0), wy + 1.5, xOf(0), dimY2 + 1.5);
  doc.setFillColor(60, 60, 60);
  doc.circle(xOf(-wp.rsMobil), dimY1, 0.5, "F");
  doc.circle(xOf(0), dimY1, 0.5, "F");
  doc.line(xOf(-wp.rsMobil), dimY1, xOf(0), dimY1);
  doc.setTextColor(0);
  doc.text(
    `Rs;1=${wp.rsMobil.toFixed(0)} kN`,
    (xOf(-wp.rsMobil) + xOf(0)) / 2,
    dimY1 - 1.2,
    { align: "center" },
  );
  doc.circle(xOf(wp.rbMobil), dimY1, 0.5, "F");
  doc.line(xOf(0), dimY1, xOf(wp.rbMobil), dimY1);
  doc.text(
    `Rb;1=${wp.rbMobil.toFixed(0)} kN`,
    (xOf(0) + xOf(wp.rbMobil)) / 2,
    dimY1 - 1.2,
    { align: "center" },
  );
  // Ftot maatlijn (volledige breedte)
  doc.circle(xOf(-wp.rsMobil), dimY2, 0.5, "F");
  doc.circle(xOf(wp.rbMobil), dimY2, 0.5, "F");
  doc.line(xOf(-wp.rsMobil), dimY2, xOf(wp.rbMobil), dimY2);
  doc.text(
    `Ftot;1=${wp.fcTot.toFixed(0)} kN`,
    (xOf(-wp.rsMobil) + xOf(wp.rbMobil)) / 2,
    dimY2 - 1.2,
    { align: "center" },
  );
}
