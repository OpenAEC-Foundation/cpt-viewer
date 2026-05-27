// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.test.ts
import { describe, it, expect } from "vitest";
import { computeBaseResistance } from "./base-resistance";
import { getPileType } from "../catalog";

describe("base resistance — synthetic constant qc", () => {
  // Synthetisch CPT met constant qc — dan zijn qc;I/II/III gemiddelden alle drie gelijk
  const constQc = 12; // MPa
  const cpt = {
    id: "x",
    points: Array.from({ length: 200 }, (_, i) => ({
      depth: i * 0.1, // 0 tot 20 m
      qc: constQc,
    })),
  };
  const pileType = getPileType("steel-pipe-driven-closed")!;
  const result = computeBaseResistance(cpt as never, {
    pileToeDepth: 14.84,
    diameterMm: 219,
    pileType,
  });

  it("qc;I, qc;II, qc;III gem all equal to input qc (constant case)", () => {
    expect(result.qcIGemMpa).toBeCloseTo(constQc, 1);
    expect(result.qcIIGemMpa).toBeCloseTo(constQc, 1);
    expect(result.qcIIIGemMpa).toBeCloseTo(constQc, 1);
  });

  it("qb;max = ½·αp·β·s·((qcI+qcII)/2 + qcIII)", () => {
    // = ½ · 0.7 · 1 · 1 · (12 + 12) = 8.4 MPa
    expect(result.qbMaxMpaRaw).toBeCloseTo(8.4, 1);
    expect(result.qbMaxMpa).toBeCloseTo(8.4, 1);
  });

  it("applies 15 MPa cap when raw qbMax exceeds it", () => {
    const bigQc = 50;
    const bigCpt = {
      id: "x",
      points: Array.from({ length: 200 }, (_, i) => ({ depth: i * 0.1, qc: bigQc })),
    };
    const r = computeBaseResistance(bigCpt as never, {
      pileToeDepth: 14.84,
      diameterMm: 219,
      pileType,
    });
    expect(r.qbMaxMpaRaw).toBeGreaterThan(15);
    expect(r.qbMaxMpa).toBe(15);
  });

  it("Rb;cal;max = Ab · qb;max", () => {
    // Ab = π/4 · 219² = 37 668 mm²
    // Rb = 37668 · 8.4 · 1e-3 = 316 kN
    expect(result.rbCalMax).toBeCloseTo(316, 0);
  });
});
