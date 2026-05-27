// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.test.ts
import { describe, it, expect } from "vitest";
import { computeSettlement } from "./settlement";
import { mobBase, mobShaft } from "./eurocode-curves";

describe("settlement bisection", () => {
  it("converges to sb where Rb+Rs equals Fc;tot", () => {
    // Rb_max=400, Rs_max=200, Fc_tot=300 → sb moet daar liggen waar
    // mobiliseerde Rb+Rs ≈ 300 kN
    const r = computeSettlement({
      fcTotSls: 300,
      fcTotUls: 350,
      rbCalMax: 400,
      rsCalMax: 200,
      deqMm: 219,
      EA_N: 1_356_065_000,
      ellM: 0.5,
      L_m: 14.84,
      deltaL_m: 5.5,
    });

    const total = mobAt(r.sls.sbMm, 219, 400, 200);
    expect(total).toBeCloseTo(300, 0); // ±1 kN
    expect(r.sls.s1Mm).toBeGreaterThan(r.sls.sbMm);
    expect(r.uls.sbMm).toBeGreaterThan(r.sls.sbMm); // hogere belasting → meer zakking
  });
});

function mobAt(sbMm: number, deqMm: number, rbMax: number, rsMax: number): number {
  return mobBase((sbMm / deqMm) * 100) * rbMax + mobShaft(sbMm) * rsMax;
}
