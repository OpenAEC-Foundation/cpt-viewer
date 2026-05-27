// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.test.ts
import { describe, it, expect } from "vitest";
import { computeSummary } from "./summary";

describe("summary — n=1 case", () => {
  it("uses ξ3=ξ4=1.39 for n=1", () => {
    const r = computeSummary({ rbCalMax: 419, rsCalMax: 202, fnkD: 35, nEd: 324, gammaM: 1.2 });
    expect(r.xi3).toBeCloseTo(1.39, 2);
    expect(r.xi4).toBeCloseTo(1.39, 2);
    expect(r.rcCal).toBe(621);
    expect(r.rcK).toBeCloseTo(447, 0); // 621/1.39
    expect(r.rcD).toBeCloseTo(372, 0);  // 447/1.20
    expect(r.rcNetD).toBeCloseTo(337, 0); // 372-35
    expect(r.unityCheck).toBeCloseTo(324 / 337, 2);
    expect(r.passes).toBe(true);
  });

  it("flags unity > 1 as failing", () => {
    const r = computeSummary({ rbCalMax: 100, rsCalMax: 50, fnkD: 30, nEd: 500, gammaM: 1.2 });
    expect(r.unityCheck).toBeGreaterThan(1);
    expect(r.passes).toBe(false);
  });
});
