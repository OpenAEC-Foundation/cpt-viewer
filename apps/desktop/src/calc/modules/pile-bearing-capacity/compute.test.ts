// apps/desktop/src/calc/modules/pile-bearing-capacity/compute.test.ts
import { describe, it, expect } from "vitest";
import { computePile } from "./compute";
import fixture3bm from "./__fixtures__/sondering-3bm-cgeo1.json";
import type { PileInput } from "./types";
import type { Cpt } from "../../../types/cpt";

describe("computePile — 3BM CGEO1 golden", () => {
  const input = { ...fixture3bm.input } as PileInput;
  // Build a synthetic CPT — 5 MPa boven -8 m, 12 MPa daaronder
  const cpt: Cpt = {
    id: "3BM-CGEO1",
    metadata: { source_file: "test", ground_level_nap: -0.5 },
    points: Array.from({ length: 200 }, (_, i) => {
      const d = i * 0.1; // 0..20 m
      const napDepth = -0.5 - d;
      const qc = napDepth > -8 ? 5 : 12;
      return { depth: d, depth_nap: napDepth, qc };
    }),
  };

  const exp = fixture3bm.expected;
  const result = computePile(input, cpt);

  it("computes Fnk;d matching ODS within 1 kN", () => {
    expect(result.ok).toBe(true);
    expect(result.negKleef.fnkD).toBeCloseTo(exp.fnkD, 0);
  });

  it("returns unity check + passes flag", () => {
    expect(result.summary.unityCheck).toBeGreaterThan(0);
    expect(typeof result.summary.passes).toBe("boolean");
  });
});
