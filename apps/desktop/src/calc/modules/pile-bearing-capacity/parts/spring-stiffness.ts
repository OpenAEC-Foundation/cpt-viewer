// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/spring-stiffness.ts
import type { SettlementResult, SpringStiffnessResult } from "../types";

export function computeSpringStiffness(s: SettlementResult): SpringStiffnessResult {
  // k = Fc;tot / s1, in kN/m (s1 is in mm → ×1000)
  const kSls = s.sls.s1Mm > 0 ? (s.sls.fcTot / s.sls.s1Mm) * 1000 : 0;
  const kUls = s.uls.s1Mm > 0 ? (s.uls.fcTot / s.uls.s1Mm) * 1000 : 0;
  return {
    kSlsKnPerM: kSls,
    kUlsKnPerM: kUls,
    kMinKnPerM: kSls / Math.SQRT2,
    kMaxKnPerM: kSls * Math.SQRT2,
  };
}
