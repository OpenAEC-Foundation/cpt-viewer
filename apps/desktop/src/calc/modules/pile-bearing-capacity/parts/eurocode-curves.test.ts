// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.test.ts
import { describe, it, expect } from "vitest";
import { mobBase, mobShaft } from "./eurocode-curves";

describe("Eurocode lastzakkingslijn 1 curves", () => {
  it("returns 0 at sb=0", () => {
    expect(mobBase(0)).toBe(0);
    expect(mobShaft(0)).toBe(0);
  });
  it("returns ~1 at large sb", () => {
    expect(mobBase(10)).toBe(1);
    expect(mobShaft(20)).toBe(1);
  });
  it("interpolates between control-points", () => {
    expect(mobBase(1)).toBeCloseTo(0.45, 2);
    expect(mobShaft(2)).toBeCloseTo(0.55, 2);
  });
});
