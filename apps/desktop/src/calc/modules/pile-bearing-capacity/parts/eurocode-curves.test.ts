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
    expect(mobBase(1)).toBeCloseTo(0.46, 2);
    expect(mobShaft(2)).toBeCloseTo(0.59, 2);
  });

  // Werkpunten uit de externe referentie-berekening (984.pdf) — de
  // percentages zijn daar op hele procenten afgerond, dus ±1% marge.
  it("reproduceert de Figuur 7.n werkpunten uit het referentierapport", () => {
    const refs: Array<[sbOverDPct: number, pct: number]> = [
      [1.3 / 219 * 100, 36],
      [1.6 / 219 * 100, 39],
      [1.7 / 219 * 100, 40],
      [2.5 / 219 * 100, 49],
      [2.7 / 219 * 100, 50],
      [3.0 / 219 * 100, 53],
      [3.1 / 219 * 100, 53],
    ];
    for (const [x, pct] of refs) {
      expect(mobBase(x) * 100).toBeGreaterThanOrEqual(pct - 1.1);
      expect(mobBase(x) * 100).toBeLessThanOrEqual(pct + 1.1);
    }
  });

  it("reproduceert de Figuur 7.o werkpunten uit het referentierapport", () => {
    const refs: Array<[sbMm: number, pct: number]> = [
      [1.3, 49], [1.6, 53], [1.7, 54], [2.2, 62],
      [2.5, 65], [2.7, 69], [3.0, 72], [3.1, 73],
    ];
    for (const [x, pct] of refs) {
      expect(mobShaft(x) * 100).toBeGreaterThanOrEqual(pct - 1.5);
      expect(mobShaft(x) * 100).toBeLessThanOrEqual(pct + 1.5);
    }
  });
});
