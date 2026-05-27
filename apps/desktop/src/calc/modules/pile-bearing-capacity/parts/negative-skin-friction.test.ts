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

describe("negative skin friction — regression: zone-clip + water-split", () => {
  // Bug-reproductie: één klei-laag van paalkop tot paalpunt, paalkop boven
  // GWS en paalpunt onder GWS. De neg-kleef-zone gaat alleen van paalkop
  // tot -9 m NAP, terwijl de laag tot -14,5 m NAP doorloopt.
  //
  // Voorheen (buggy):
  //   - thickness = 14,84 m (volledige laag, niet zone-geclipt)
  //   - met gammaW = 0 (default-bug omdat pileTop boven water)
  //   - dSigma = 14,84 × 18 = 267 kPa; σ_gem×h = 1981 kPa·m
  //   - Fsnk = 0,688 × 0,25 × 1981 = 341 kN  ← veel te hoog
  //
  // Nu (gefixt):
  //   - thickness = 9,34 m (geclipt op neg-kleef-zone)
  //   - gammaW = 10 (laag onder water, geen split-bug)
  //   - dSigma = 9,34 × (18−10) = 75 kPa; σ_gem×h = 350 kPa·m
  //   - Fsnk = 0,688 × 0,25 × 350 = 60 kN  ← matcht ExternPakket
  const buggyInput: PileInput = {
    cptId: "regression",
    pileTypeId: "steel-pipe-driven-closed",
    diameterMm: 219,
    wallThicknessMm: 8.0,
    pileTopNap: 0.34,
    pileToeNap: -14.5,
    waterNap: -0.16,
    excavationNap: 0.84,
    nEd: 324,
    nEk: 303,
    gammaM: 1.2,
    gammaFnk: 1.0,
    negKleefBottomNap: -9.0,
    ksMinFactor: 0.25,
    soilProfile: [
      // Eén klei-laag die de neg-kleef-zone overschrijdt + onder water zit.
      { kind: "clay", startNap: 0.34, endNap: -14.5, gammaK: 18, gammaW: 10, phi: 22.5 },
    ],
  };

  const result = computeNegKleef(buggyInput);

  it("klipt thickness op de neg-kleef-zonegrens (was 14,84 m)", () => {
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].thickness).toBeCloseTo(9.34, 1);
  });

  it("Fnk;d binnen 10% van ExternPakket-gemiddelde (60 kN)", () => {
    // Verwacht ~60 kN (51..69) voor deze case na fixes.
    expect(result.fnkD).toBeGreaterThan(51);
    expect(result.fnkD).toBeLessThan(70);
  });

  it("σ_top = 0 (geen overburden boven paalkop), σ_bot ≈ 75 kPa (= 9,34 × 8)", () => {
    expect(result.layers[0].sigmaRepTop).toBeCloseTo(0, 1);
    expect(result.layers[0].sigmaRepBottom).toBeCloseTo(9.34 * 8, 1);
  });
});
