// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/negative-skin-friction.test.ts
import { describe, it, expect } from "vitest";
import { computeNegKleef } from "./negative-skin-friction";
import fixture from "../__fixtures__/sondering-3bm-cgeo1.json";
import type { PileInput } from "../types";

const input = fixture.input as PileInput;
const exp = fixture.expected;

describe("negative skin friction — 3BM CGEO1", () => {
  const result = computeNegKleef(input);

  it("computes per-layer Fs;nk;rep matching ODS CGEO1 within 0.5 kN", () => {
    const perLayer = result.layers.map((l) => l.fsNkRep);
    expect(perLayer.length).toBe(4);
    perLayer.forEach((v, i) => {
      expect(v).toBeCloseTo(exp.negKleefPerLayer[i], 0);
    });
  });

  it("totals Fnk;d to 40.2 kN", () => {
    expect(result.fnkD).toBeCloseTo(exp.fnkD, 0);
  });

  it("applies K0·tan(δ) min-cap of 0.25", () => {
    // Voor zand droog (Φ=32,5°): K0=0.463, δ=24.4°, tan=0.453, product=0.21 → cap naar 0.25
    const sandDry = result.layers.find((l) => l.layer.kind === "sand-dry");
    expect(sandDry).toBeDefined();
    expect(sandDry!.k0TanDelta).toBeCloseTo(0.25, 2);
  });
});
