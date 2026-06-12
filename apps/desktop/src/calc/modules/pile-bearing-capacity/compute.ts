// apps/desktop/src/calc/modules/pile-bearing-capacity/compute.ts
import type { Cpt } from "../../../types/cpt";
import type { PileInput, PileResult } from "./types";
import { getPileType } from "./catalog";
import { computeNegKleef } from "./parts/negative-skin-friction";
import { computeBaseResistance } from "./parts/base-resistance";
import { computeShaftFriction } from "./parts/shaft-friction";
import { computeSettlement } from "./parts/settlement";
import { computeSpringStiffness } from "./parts/spring-stiffness";
import { computeSummary } from "./parts/summary";

// E-moduli [N/mm²] voor de axiale paalstijfheid EA.
//  - Staal: 210 000 (EN 1993-1-1)
//  - Betonvulling stalen buispaal: 7 500 — lange-duur/gescheurde waarde
//    zoals in de externe referentie-berekening (EA_totaal = 1 356 065 kN
//    voor D219×8: 5303 mm² × 210 000 + 32 365 mm² × 7 500).
//  - Prefab voorgespannen beton: 36 000 (C45/55, korte-duur E_cm).
const E_STEEL = 210_000;
const E_CONCRETE_FILL = 7_500;
const E_CONCRETE_PREFAB = 36_000;

function computeEA_N(
  diameterMm: number,
  wallMm: number,
  material: "steel" | "concrete",
  isCircular: boolean,
): number {
  const D = diameterMm;
  if (material === "concrete") {
    // Massieve betonpaal — vierkant (a×a) of rond.
    const A_mm2 = isCircular ? (Math.PI / 4) * D * D : D * D;
    return E_CONCRETE_PREFAB * A_mm2;
  }
  // Stalen buis met gesloten punt — in den natte gevuld met beton:
  // EA = E_s·A_ring + E_b;vulling·A_kern.
  const innerD = Math.max(0, D - 2 * wallMm);
  const aRing_mm2 = (Math.PI / 4) * (D * D - innerD * innerD);
  const aCore_mm2 = (Math.PI / 4) * innerD * innerD;
  return E_STEEL * aRing_mm2 + E_CONCRETE_FILL * aCore_mm2;
}

function emptyResult(error: string): PileResult {
  return {
    ok: false,
    error,
    warnings: [],
    negKleef: { layers: [], fnkRep: 0, fnkD: 0, bottomNap: 0, deltaLnk: 0 },
    base: { deqMm: 0, qcIGemMpa: 0, qcIIGemMpa: 0, qcIIIGemMpa: 0, criticalDepthM: 0, qbMaxMpaRaw: 0, qbMaxMpa: 0, abMm2: 0, rbCalMax: 0 },
    shaft: { perLayer: [], rsCalMax: 0 },
    settlement: { sls: anyZero(), uls: anyZero(), curve: [] },
    spring: { kSlsKnPerM: 0, kUlsKnPerM: 0, kMinKnPerM: 0, kMaxKnPerM: 0 },
    summary: { xi3: 1.39, xi4: 1.39, rcCal: 0, rcK: 0, rcD: 0, rcNetD: 0, unityCheck: 0, passes: false },
  };
}
function anyZero() {
  return { fcTot: 0, sbMm: 0, rbMobil: 0, rsMobil: 0, fgem: 0, selMm: 0, s1Mm: 0 };
}

export function computePile(input: PileInput, cpt: Cpt | null): PileResult {
  if (!cpt) return emptyResult("Geen actieve sondering");
  const pileType = getPileType(input.pileTypeId);
  if (!pileType) return emptyResult(`Onbekend paaltype: ${input.pileTypeId}`);

  const groundNap = cpt.metadata.ground_level_nap ?? 0;
  const pileToeDepth = groundNap - input.pileToeNap;

  // Edge-case: sondering te ondiep
  const lastDepth = cpt.points[cpt.points.length - 1]?.depth ?? 0;
  const Deq = input.diameterMm / 1000;
  if (lastDepth < pileToeDepth + 0.7 * Deq) {
    return emptyResult(
      `Sondering te ondiep (reikt tot ${lastDepth.toFixed(1)} m, vereist ≥ ${(pileToeDepth + 0.7 * Deq).toFixed(1)} m)`,
    );
  }

  const negKleef = computeNegKleef(input);
  const base = computeBaseResistance(cpt, {
    pileToeDepth,
    diameterMm: input.diameterMm,
    pileType,
  });
  // Positief schachtwrijvings-traject: van posKleefTopNap (boven, default
  // = negKleefBottomNap) tot pileToeNap (onder, ALTIJD paalpunt — geen
  // exclusion-zone bij paalpunt per gebruikers-wens). Engineer kan de
  // bovenkant onafhankelijk omlaag zetten als er een zwakke laag tussen
  // neg-kleef en pos-kleef zit.
  const posKleefTopNap = input.posKleefTopNap ?? input.negKleefBottomNap;
  const shaft = computeShaftFriction(cpt, {
    pileType,
    diameterMm: input.diameterMm,
    negKleefBottomNap: posKleefTopNap, // = top van shaft-friction-zone
    pileToeNap: input.pileToeNap,
  }, input.soilProfile);

  const fcTotSls = input.nEk + negKleef.fnkD;
  const fcTotUls = input.nEd + negKleef.fnkD;
  const EA = computeEA_N(
    input.diameterMm,
    input.wallThicknessMm,
    pileType.material ?? "steel",
    pileType.isCircular,
  );
  const L = input.pileTopNap - input.pileToeNap;
  // ΔL = lengte van het positieve schachtwrijvings-traject; λ (ell) =
  // paaldeel ZONDER positieve wrijving (paalkop → bovenkant pos-kleef).
  // Conform art. 7.6.4.2: F_gem = (λ·F + ½·ΔL·(F − Rb)) / L. In de
  // referentie-uitwerking: λ = 9,34 m bij kleefniveau NAP −9,00 en
  // paalkop NAP +0,34 (NIET paalkop − ontgraving).
  const deltaL = posKleefTopNap - input.pileToeNap;
  const ell = input.pileTopNap - posKleefTopNap;

  const settlement = computeSettlement({
    fcTotSls,
    fcTotUls,
    rbCalMax: base.rbCalMax,
    rsCalMax: shaft.rsCalMax,
    deqMm: base.deqMm,
    EA_N: EA,
    ellM: ell,
    L_m: L,
    deltaL_m: deltaL,
  });

  const spring = computeSpringStiffness(settlement);

  const summary = computeSummary({
    rbCalMax: base.rbCalMax,
    rsCalMax: shaft.rsCalMax,
    fnkD: negKleef.fnkD,
    nEd: input.nEd,
    gammaM: input.gammaM,
  });

  const warnings: string[] = [];
  if (base.qbMaxMpaRaw > 15) {
    warnings.push(`qb;max gecapt op 15 MPa (ruwe waarde ${base.qbMaxMpaRaw.toFixed(2)} MPa)`);
  }

  return {
    ok: true,
    warnings,
    negKleef,
    base,
    shaft,
    settlement,
    spring,
    summary,
  };
}
