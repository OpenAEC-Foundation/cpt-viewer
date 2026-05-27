// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts
import type { Cpt } from "../../../../types/cpt";
import type { PileTypeSpec, BaseResistanceResult } from "../types";

interface Args {
  pileToeDepth: number;        // depth onder maaiveld in m
  diameterMm: number;
  pileType: PileTypeSpec;
}

const PI = Math.PI;

/**
 * NORM-CITAAT — NEN 9997-1+C2:2017 NB:2019 §7.6.2.3 (Boer/Koppejan, "4D-8D-methode")
 * ────────────────────────────────────────────────────────────────────────────────
 * De maximale puntweerstand q_b;max van een paal wordt berekend uit drie
 * "trajectgemiddelden" van de gemeten conusweerstand q_c rondom de paalpunt:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  ← shallow                                              deep →      │
 *   │      ↑ 8·D_eq            paalpunt (h)        ↓ d_crit (0,7..4 D_eq) │
 *   │  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━●         │
 *   │  ←─── qc;III ──────────────→  ←─ qc;II ─→  ←─── qc;I ──→            │
 *   │  (up-walk, running-min      (up-walk,     (down-walk,               │
 *   │   continueert vanaf qc;II)   cap op qcI)   avg over d_crit)         │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 *   q_c;I    = rekenkundig gemiddelde van q_c op het traject
 *              [h, h + d_crit], waarbij d_crit zo gekozen wordt dat
 *              q_c;I MINIMUM is, en d_crit ∈ [0,7·D_eq, 4·D_eq].
 *
 *   q_c;II   = rekenkundig gemiddelde van q_c op het traject
 *              [h + d_crit, h] (omhoog gelopen), waarbij q_c-waarden
 *              hoger dan een eerdere (dieper liggende) afgekapte
 *              waarde worden vervangen door die eerdere lagere
 *              waarde — "lopende minimum". De afkap-walk start op
 *              q_c;I (initial running min) zodat ALLE waarden in
 *              dit traject zijn afgekapt op het q_c;I-niveau.
 *
 *   q_c;III  = rekenkundig gemiddelde van q_c op het traject
 *              [h, h − 8·D_eq] (omhoog gelopen), waarbij dezelfde
 *              afkapregel geldt: q_c-waarden hoger dan een eerdere
 *              lager liggende afgekapte waarde worden vervangen.
 *              De afkap-walk CONTINUEERT vanaf de eindwaarde van
 *              q_c;II (geen reset).
 *
 *   q_b;max  = ½ · α_p · β · s · ( (q_c;I + q_c;II) / 2 + q_c;III )
 *              gecapt op 15 MPa per §7.6.2.3(e).
 *
 * Het "lopend-minimum" loopt dus continu DEEP→SHALLOW over de hele
 * invloedszone, geïnitieerd op q_c;I en niet onderbroken bij de paalpunt.
 */

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
 * toe ("afsnuiten"). Elke nieuwe (ondiepere) qc-waarde wordt geclipt op de
 * lopende minimum (zie norm-citaat boven dit bestand).
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
 * @param initialMin    - start-waarde voor de runMin.
 *                        Voor qc;II: pass qcIGemMpa (cap-op-qcI conform norm).
 *                        Voor qc;III: pass qcIIWalk.finalMin (continueert).
 */
function clippedAvgQcUpward(
  cpt: Cpt,
  depthBottom: number,
  depthTop: number,
  initialMin: number,
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

  // qc;I: zoek de optimale critical depth dc ∈ [0,7·Deq, 4·Deq] die qc;I minimaliseert.
  // Down-walk: gewoon rekenkundig gemiddelde, GEEN running-min.
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
  // initialMin = qcIGemMpa: cap-op-qcI conform norm — geen enkele waarde
  // in de qc;II-walk mag de qc;I-gemiddelde overschrijden.
  const qcIIWalk = clippedAvgQcUpward(
    cpt,
    args.pileToeDepth + bestDc,
    args.pileToeDepth,
    qcIGemMpa,
  );
  const qcIIGemMpa = qcIIWalk.avg;

  // qc;III: continueer de running-min vanaf paalpunt → 8·Deq omhoog.
  // De runMin start op de eindwaarde van qc;II (continuiteit van de
  // afkap-walk door de hele invloedszone, conform norm-procedure).
  const qcIIIWalk = clippedAvgQcUpward(
    cpt,
    args.pileToeDepth,
    Math.max(0, args.pileToeDepth - 8 * Deq),
    qcIIWalk.finalMin,
  );
  const qcIIIGemMpa = qcIIIWalk.avg;

  // Concatenate clipped-points van qc;II en qc;III voor visualisatie. De
  // VisualPanel rendert deze als donkerblauwe "effectieve qc-curve" in de
  // 8D-zone (en optioneel in de dc-zone), zodat de gebruiker grafisch ziet
  // hoeveel qc er is afgesnuit.
  const clippedQcCurve = [...qcIIIWalk.clippedPoints, ...qcIIWalk.clippedPoints]
    .map((p) => ({ depth: p.depth, qcClipped: p.qcClipped }))
    .sort((a, b) => a.depth - b.depth);

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
    clippedQcCurve,
  };
}
