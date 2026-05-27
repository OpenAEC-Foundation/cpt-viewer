// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.ts
import type { SummaryResult } from "../types";

export interface SummaryArgs {
  rbCalMax: number;
  rsCalMax: number;
  fnkD: number;
  nEd: number;
  gammaM: number;
}

export function computeSummary(args: SummaryArgs): SummaryResult {
  // Tabel A.10a n=1: ξ3 = ξ4 = 1.39
  const xi3 = 1.39;
  const xi4 = 1.39;
  const rcCal = args.rbCalMax + args.rsCalMax;
  const rcK = rcCal / xi3;
  const rcD = rcK / args.gammaM;
  const rcNetD = rcD - args.fnkD;
  const unityCheck = rcNetD > 0 ? args.nEd / rcNetD : Infinity;
  return {
    xi3,
    xi4,
    rcCal,
    rcK,
    rcD,
    rcNetD,
    unityCheck,
    passes: unityCheck <= 1,
  };
}
