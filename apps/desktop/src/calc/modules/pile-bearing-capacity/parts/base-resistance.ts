// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts
import type { Cpt } from "../../../../types/cpt";
import type { PileTypeSpec, BaseResistanceResult } from "../types";

interface Args {
  pileToeDepth: number;        // depth onder maaiveld in m
  diameterMm: number;
  pileType: PileTypeSpec;
}

const PI = Math.PI;

export function computeBaseResistance(cpt: Cpt, args: Args): BaseResistanceResult {
  const D = args.diameterMm / 1000;        // m
  const Deq = D;                            // voor ronde palen
  const DeqMm = args.diameterMm;
  const Ab = (PI / 4) * args.diameterMm ** 2; // mm²

  // Functie: gemiddelde qc tussen depths [d1, d2] (in m vanaf maaiveld)
  // gebruikt depth-gewogen gemiddelde — geen running-min, gewoon
  // rekenkundig (interpolatie tussen meetpunten)
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

  // qc;II: terug van bestDc → 0 (omhoog naar paalpunt), running min van qc-waarden
  // We benaderen door simpelweg gemiddelde van qc in [paalpunt, paalpunt + bestDc]
  // — vereenvoudigde benadering voor v1; running-min komt in v2
  const qcIIGemMpa = avgQc(args.pileToeDepth, args.pileToeDepth + bestDc);

  // qc;III: gemiddelde qc van paalpunt naar omhoog tot 8·Deq
  const qcIIIGemMpa = avgQc(Math.max(0, args.pileToeDepth - 8 * Deq), args.pileToeDepth);

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
