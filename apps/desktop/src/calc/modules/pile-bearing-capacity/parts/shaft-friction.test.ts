// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/shaft-friction.test.ts
import { describe, it, expect } from "vitest";
import { computeShaftFriction } from "./shaft-friction";
import { getPileType } from "../catalog";
import type { SoilLayer } from "../types";

const pileType = getPileType("steel-pipe-driven-closed")!;

describe("shaft friction", () => {
  it("sums α_s · qc · h per layer × Os, capped per soil-kind", () => {
    // 1 zandlaag 3 m dik, qc=5 MPa, D=168mm
    // Os = π·0.168 = 0.5278 m
    // qs;max = αs·qc = 0.008·5 = 0.04 MPa < 0.15 cap voor zand
    // Rs = Os · qs · h × 1000 = 0.5278 · 0.04 · 3 × 1000 = 63.3 kN
    const layers: SoilLayer[] = [
      { kind: "sand-wet", startNap: -5, endNap: -8, gammaK: 17, gammaW: 10, phi: 32.5 },
    ];
    // Synthetische CPT: qc constant 5 MPa
    const cpt = {
      id: "x",
      metadata: { ground_level_nap: 0 },
      points: Array.from({ length: 100 }, (_, i) => ({ depth: i * 0.1, depth_nap: -i * 0.1, qc: 5 })),
    };
    const result = computeShaftFriction(cpt as never, {
      pileType,
      diameterMm: 168,
      negKleefBottomNap: -5,
      pileToeNap: -8,
    }, layers);

    expect(result.perLayer.length).toBe(1);
    expect(result.rsCalMax).toBeCloseTo(63.3, 0);
  });

  it("caps qs at 0.02 MPa for peat regardless of αs·qc", () => {
    const layers: SoilLayer[] = [
      { kind: "peat", startNap: -5, endNap: -7, gammaK: 13, gammaW: 10, phi: 15 },
    ];
    const cpt = {
      id: "x",
      metadata: { ground_level_nap: 0 },
      points: Array.from({ length: 100 }, (_, i) => ({ depth: i * 0.1, depth_nap: -i * 0.1, qc: 50 })),
    };
    const result = computeShaftFriction(cpt as never, {
      pileType,
      diameterMm: 168,
      negKleefBottomNap: -5,
      pileToeNap: -7,
    }, layers);
    // qs zonder cap: 0.008·50=0.4 MPa, met cap=0.02 MPa
    // Rs = 0.5278 · 0.02 · 2 × 1000 = 21.1 kN
    expect(result.perLayer[0].qsMpa).toBe(0.02);
    expect(result.rsCalMax).toBeCloseTo(21.1, 0);
  });
});
