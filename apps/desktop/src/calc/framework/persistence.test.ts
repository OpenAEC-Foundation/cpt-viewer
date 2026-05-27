// apps/desktop/src/calc/framework/persistence.test.ts
import { describe, it, expect } from "vitest";
import { toIfcxArray, fromIfcxArray } from "./persistence";
import type { CalculationInstance } from "./types";

const sample: CalculationInstance[] = [
  {
    id: "u1",
    moduleId: "pile-bearing-capacity",
    name: "Hoofdgebouw",
    input: { pile_top_nap: 0.34, pile_toe_nap: -14.5, diameter_mm: 219 },
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T11:30:00Z",
    cptRefs: ["CPT000000004317"],
  },
];

describe("calc persistence", () => {
  it("toIfcxArray converts camelCase keys to snake_case", () => {
    const out = toIfcxArray(sample);
    expect(out[0]).toMatchObject({
      id: "u1",
      module_id: "pile-bearing-capacity",
      name: "Hoofdgebouw",
      created_at: "2026-05-21T10:00:00Z",
      updated_at: "2026-05-21T11:30:00Z",
      cpt_refs: ["CPT000000004317"],
    });
    // input payload is doorgegeven zonder transformatie
    expect(out[0].input).toEqual(sample[0].input);
  });

  it("fromIfcxArray converts snake_case back to camelCase", () => {
    const raw = toIfcxArray(sample);
    const back = fromIfcxArray(raw);
    expect(back).toEqual(sample);
  });

  it("fromIfcxArray ignores entries with missing required fields", () => {
    const broken = [{ id: "x", name: "no module" }];
    expect(fromIfcxArray(broken)).toEqual([]);
  });

  it("fromIfcxArray accepts empty / undefined", () => {
    expect(fromIfcxArray([])).toEqual([]);
    expect(fromIfcxArray(undefined)).toEqual([]);
  });
});
