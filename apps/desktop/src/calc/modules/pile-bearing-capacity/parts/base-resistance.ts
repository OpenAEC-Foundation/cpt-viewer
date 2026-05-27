// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts
import type { Cpt } from "../../../../types/cpt";
import type { PileTypeSpec, BaseResistanceResult } from "../types";

interface Args {
  pileToeDepth: number;        // depth onder maaiveld in m
  diameterMm: number;
  pileType: PileTypeSpec;
}

const PI = Math.PI;

/** Resultaat van een afgekapte (running-min) walk-up over qc-waarden. */
interface ClippedWalkResult {
  /** Gewogen gemiddelde van de geclipte qc-waarden over de walk. */
  avg: number;
  /** Eindwaarde van de running-min — gebruikt om de walk te CONTINUEREN
   *  in een aansluitende zone (qc;II → qc;III, conform Boer/Koppejan). */
  finalMin: number;
  /** Geclipte sample-punten, gesorteerd op stijgende diepte — beschikbaar
   *  voor visualisatie (bv. effectieve qc-curve naast de raw curve). */
  clippedPoints: Array<{ depth: number; qcRaw: number; qcClipped: number }>;
}

/**
 * Walk de qc-waarden van een CPT van DEEP → SHALLOW en pas een running-min
 * toe ("afsnuiten"): elke nieuwe qc-waarde mag niet groter zijn dan de
 * lopende min. Dit is de Boer/Koppejan procedure uit
 * NEN-EN 1997-1+C2:2017 NB:2019 §7.6.2.3 voor qc;II en qc;III.
 *
 * Sample-strategie:
 *   - Alle CPT-meetpunten met depth ∈ (depthTop, depthBottom)
 *   - Plus geïnterpoleerde randpunten op exact depthTop en depthBottom
 *     (zodat de walk netjes tot aan de zone-grens loopt)
 *
 * Integratie: trapezium-regel op de geclipte waarden over de walk-range
 * (gesorteerd op depth ascending, want de runMin is monotonisch
 * niet-stijgend naar shallower → de clipped curve is monotonisch
 * niet-dalend met depth).
 *
 * @param cpt           - de CPT data
 * @param depthBottom   - diepste rand van de zone (hogere depth-waarde)
 * @param depthTop      - ondiepste rand van de zone (lagere depth-waarde)
 * @param initialMin    - start-waarde voor de runMin (Infinity = geen prior).
 *                        Voor qc;III: pass de finalMin uit de qc;II walk
 *                        zodat de runMin continueert.
 */
function clippedAvgQcUpward(
  cpt: Cpt,
  depthBottom: number,
  depthTop: number,
  initialMin: number = Infinity,
): ClippedWalkResult {
  if (depthBottom <= depthTop) {
    return { avg: 0, finalMin: initialMin, clippedPoints: [] };
  }

  // Helper: lineaire interpolatie van qc op exact depth d, zoekend door de
  // CPT-segmenten. Returnt null als d buiten data-range valt.
  const qcAt = (d: number): number | null => {
    for (let i = 0; i < cpt.points.length - 1; i++) {
      const a = cpt.points[i], b = cpt.points[i + 1];
      if (a.qc == null || b.qc == null) continue;
      if (a.depth <= d && d <= b.depth) {
        const span = b.depth - a.depth;
        if (span <= 0) return a.qc;
        const t = (d - a.depth) / span;
        return a.qc + t * (b.qc - a.qc);
      }
    }
    return null;
  };

  // Verzamel samples: CPT-punten binnen de range + geïnterpoleerde grenzen.
  const samples: Array<{ depth: number; qc: number }> = [];
  const EPS = 1e-6;

  const qcBoundaryTop = qcAt(depthTop);
  if (qcBoundaryTop !== null) {
    samples.push({ depth: depthTop, qc: qcBoundaryTop });
  }
  const qcBoundaryBot = qcAt(depthBottom);
  if (qcBoundaryBot !== null) {
    samples.push({ depth: depthBottom, qc: qcBoundaryBot });
  }
  for (const p of cpt.points) {
    if (p.qc == null) continue;
    if (p.depth > depthTop + EPS && p.depth < depthBottom - EPS) {
      samples.push({ depth: p.depth, qc: p.qc });
    }
  }

  if (samples.length < 2) {
    return { avg: 0, finalMin: initialMin, clippedPoints: [] };
  }

  // Sorteer DEEP → SHALLOW (walking upward) en pas running-min toe.
  samples.sort((a, b) => b.depth - a.depth);
  let runMin = initialMin;
  const clippedDesc = samples.map((s) => {
    runMin = Math.min(runMin, s.qc);
    return { depth: s.depth, qcRaw: s.qc, qcClipped: runMin };
  });

  // Re-sort ascending op depth voor trapezium-integratie.
  const clippedAsc = [...clippedDesc].sort((a, b) => a.depth - b.depth);

  let sumQ = 0;
  let sumW = 0;
  for (let i = 0; i < clippedAsc.length - 1; i++) {
    const w = clippedAsc[i + 1].depth - clippedAsc[i].depth;
    if (w <= 0) continue;
    sumQ += ((clippedAsc[i].qcClipped + clippedAsc[i + 1].qcClipped) / 2) * w;
    sumW += w;
  }
  const avg = sumW > 0 ? sumQ / sumW : 0;

  return { avg, finalMin: runMin, clippedPoints: clippedAsc };
}

export function computeBaseResistance(cpt: Cpt, args: Args): BaseResistanceResult {
  const D = args.diameterMm / 1000;        // m
  const Deq = D;                            // voor ronde palen
  const DeqMm = args.diameterMm;
  const Ab = (PI / 4) * args.diameterMm ** 2; // mm²

  // Functie: gemiddelde qc tussen depths [d1, d2] (in m vanaf maaiveld)
  // gebruikt depth-gewogen gemiddelde — geen running-min, gewoon
  // rekenkundig (interpolatie tussen meetpunten). Alléén gebruikt voor de
  // qc;I-optimalisatie (de "down-walk"); qc;II en qc;III gebruiken
  // clippedAvgQcUpward conform Boer/Koppejan.
  const avgQc = (d1: number, d2: number): number => {
    let sumQ = 0, sumW = 0;
    for (let i = 0; i < cpt.points.length - 1; i++) {
      const a = cpt.points[i], b = cpt.points[i + 1];
      if (b.depth <= d1 || a.depth >= d2) continue;
      const lo = Math.max(a.depth, d1);
      const hi = Math.min(b.depth, d2);
      const w = hi - lo;
      if (w <= 0) continue;
      const qa = a.qc ?? 0, qb = b.qc ?? 0;
      // Gemiddelde qc over de overlapping zone (lineaire interpolatie)
      const fracA = (lo - a.depth) / (b.depth - a.depth || 1);
      const fracB = (hi - a.depth) / (b.depth - a.depth || 1);
      const qLo = qa + (qb - qa) * fracA;
      const qHi = qa + (qb - qa) * fracB;
      sumQ += ((qLo + qHi) / 2) * w;
      sumW += w;
    }
    return sumW > 0 ? sumQ / sumW : 0;
  };

  // qc;I: zoek de optimale critical depth dc ∈ [0,7·Deq, 4·Deq] die qb minimaliseert
  let bestDc = 0.7 * Deq;
  let bestQc1 = avgQc(args.pileToeDepth, args.pileToeDepth + bestDc);
  for (let dc = 0.7 * Deq; dc <= 4 * Deq; dc += 0.01 * Deq) {
    const q = avgQc(args.pileToeDepth, args.pileToeDepth + dc);
    if (q < bestQc1) {
      bestQc1 = q;
      bestDc = dc;
    }
  }
  const qcIGemMpa = bestQc1;

  // qc;II: running-min walking UP van (paalpunt + bestDc) → paalpunt.
  // Conform NEN-EN 1997-1+C2:2017 NB:2019 §7.6.2.3 (Boer/Koppejan):
  // de qc-waarden op de "up-walk" mogen niet stijgen — elke nieuwe
  // (ondiepere) waarde wordt geclipt op de lopende min.
  const qcIIWalk = clippedAvgQcUpward(
    cpt,
    args.pileToeDepth + bestDc,   // diepste rand
    args.pileToeDepth,             // ondiepste rand = paalpunt
  );
  const qcIIGemMpa = qcIIWalk.avg;

  // qc;III: continueer de running-min vanaf paalpunt → 8·Deq omhoog.
  // De runMin start op de eindwaarde van qc;II (continuiteit van de walk
  // door de hele invloedszone, conform norm-procedure).
  const qcIIIWalk = clippedAvgQcUpward(
    cpt,
    args.pileToeDepth,
    Math.max(0, args.pileToeDepth - 8 * Deq),
    qcIIWalk.finalMin,
  );
  const qcIIIGemMpa = qcIIIWalk.avg;

  // qb;max formule 7.6.2.3(e)
  const { alphaP, beta, s } = args.pileType;
  const qbMaxMpaRaw = 0.5 * alphaP * beta * s * ((qcIGemMpa + qcIIGemMpa) / 2 + qcIIIGemMpa);
  const qbMaxMpa = Math.min(qbMaxMpaRaw, 15);

  const rbCalMax = (Ab * qbMaxMpa) / 1000; // kN: mm² × MPa × 1e-3

  return {
    deqMm: DeqMm,
    qcIGemMpa,
    qcIIGemMpa,
    qcIIIGemMpa,
    criticalDepthM: bestDc,
    qbMaxMpaRaw,
    qbMaxMpa,
    abMm2: Ab,
    rbCalMax,
  };
}
