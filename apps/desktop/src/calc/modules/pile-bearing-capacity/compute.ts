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

const E_STEEL_GPA = 210;

function computeEA_N(diameterMm: number, wallMm: number): number {
  // ringshape: A = π/4 · (D² − (D−2t)²) mm²
  const D = diameterMm;
  const innerD = Math.max(0, D - 2 * wallMm);
  const A_mm2 = (Math.PI / 4) * (D * D - innerD * innerD);
  // EA = E · A — E in N/mm² (1 GPa = 1000 N/mm²)
  return E_STEEL_GPA * 1000 * A_mm2;
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
  const EA = computeEA_N(input.diameterMm, input.wallThicknessMm);
  const L = input.pileTopNap - input.pileToeNap;
  const deltaL = input.negKleefBottomNap - input.pileToeNap;
  const ell = input.pileTopNap - input.excavationNap;

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
