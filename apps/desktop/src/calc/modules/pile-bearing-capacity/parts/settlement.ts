// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.ts
import type { SettlementResult, SettlementWorkpoint } from "../types";
import { mobBase, mobShaft } from "./eurocode-curves";

export interface SettlementArgs {
  fcTotSls: number;            // kN — NEk + Fnk
  fcTotUls: number;            // kN — NEd + Fnk
  rbCalMax: number;            // kN
  rsCalMax: number;            // kN
  deqMm: number;
  EA_N: number;                // axiale stijfheid paal in N (E·A)
  ellM: number;                // l = paalkop − maaiveld
  L_m: number;                 // paallengte
  deltaL_m: number;            // schachtwrijvings-zone
}

function solveSb(fcTot: number, rbMax: number, rsMax: number, deqMm: number): number {
  let lo = 0;
  let hi = 0.05 * deqMm; // 5% verhouding als bovengrens
  // Als zelfs bij hi nog Rb+Rs < Fc;tot, vergroot tot 30%
  while (
    mobBase((hi / deqMm) * 100) * rbMax + mobShaft(hi) * rsMax < fcTot &&
    hi < 0.30 * deqMm
  ) {
    hi *= 2;
  }
  for (let i = 0; i < 50; i++) {
    const sb = (lo + hi) / 2;
    const tot = mobBase((sb / deqMm) * 100) * rbMax + mobShaft(sb) * rsMax;
    if (tot > fcTot) hi = sb;
    else lo = sb;
    if (hi - lo < 0.0001) break;
  }
  return (lo + hi) / 2;
}

function computeWorkpoint(fcTot: number, args: SettlementArgs): SettlementWorkpoint {
  const sbMm = solveSb(fcTot, args.rbCalMax, args.rsCalMax, args.deqMm);
  const rbMobil = mobBase((sbMm / args.deqMm) * 100) * args.rbCalMax;
  const rsMobil = mobShaft(sbMm) * args.rsCalMax;
  const fgem = (args.ellM * fcTot + 0.5 * args.deltaL_m * (fcTot - rbMobil)) / args.L_m;
  // s_el = F_gem·L / EA. Eenheden: F in kN (= ×10³ N), L in m, EA in N
  //   → s in m (= ×10³ mm). Samen: × 10⁶.
  //   Controle (referentie S1): 237 kN × 14,84 m × 10⁶ / 1,356·10⁹ N = 2,59 mm ✓
  const selMm = (args.L_m * fgem * 1e6) / args.EA_N;
  const s1Mm = sbMm + selMm;
  return { fcTot, sbMm, rbMobil, rsMobil, fgem, selMm, s1Mm };
}

export function computeSettlement(args: SettlementArgs): SettlementResult {
  const sls = computeWorkpoint(args.fcTotSls, args);
  const uls = computeWorkpoint(args.fcTotUls, args);

  // Curve voor het zakkings-diagram — 50 punten van sb=0 tot 0,1·Deq
  const curve: SettlementResult["curve"] = [];
  const maxSb = 0.1 * args.deqMm;
  for (let i = 0; i <= 50; i++) {
    const sb = (i / 50) * maxSb;
    const rb = mobBase((sb / args.deqMm) * 100) * args.rbCalMax;
    const rs = mobShaft(sb) * args.rsCalMax;
    curve.push({ sbMm: sb, rbKn: rb, rsKn: rs, totalKn: rb + rs });
  }

  return {
    sls,
    uls,
    curve,
    // Geometrie-echo voor rapport/ResultPanel (EA in N → kN).
    eaKn: args.EA_N / 1000,
    lM: args.L_m,
    ellM: args.ellM,
    deltaLM: args.deltaL_m,
  };
}
