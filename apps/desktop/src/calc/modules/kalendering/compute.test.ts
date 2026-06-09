// apps/desktop/src/calc/modules/kalendering/compute.test.ts
import { describe, it, expect } from "vitest";
import { computeKalendering, computeDEqMm, resolveValblok } from "./compute";
import { computeEBlokKnm, VALBLOK_CATALOG, CUSTOM_VALBLOK_ID } from "./catalog";
import type { KalenderingInput } from "./types";

function baseInput(): KalenderingInput {
  return {
    valblokId: "vb-3000-1.2",
    customMassaKg: 3000,
    customValhoogteM: 1.2,
    paalSoort: "rond",
    diameterMm: 350,
    zijdeBMm: 350,
    conusweerstandMpa: 15,
    slagSetMm: 400,
  };
}

describe("computeEBlokKnm — slag-energie m·g·h", () => {
  it("3000 kg × 1.2 m → ~35.32 kNm", () => {
    expect(computeEBlokKnm(3000, 1.2)).toBeCloseTo(3000 * 9.81 * 1.2 / 1000, 2);
    expect(computeEBlokKnm(3000, 1.2)).toBeCloseTo(35.316, 2);
  });
  it("returns 0 for non-positive massa", () => {
    expect(computeEBlokKnm(0, 1)).toBe(0);
    expect(computeEBlokKnm(-100, 1)).toBe(0);
  });
  it("returns 0 for non-positive valhoogte", () => {
    expect(computeEBlokKnm(1000, 0)).toBe(0);
    expect(computeEBlokKnm(1000, -0.5)).toBe(0);
  });
  it("returns 0 for NaN inputs", () => {
    expect(computeEBlokKnm(NaN, 1)).toBe(0);
    expect(computeEBlokKnm(1000, NaN)).toBe(0);
  });
});

describe("computeDEqMm — equivalente diameter", () => {
  it("rond: D_eq = D", () => {
    const inp = baseInput();
    inp.paalSoort = "rond";
    inp.diameterMm = 350;
    expect(computeDEqMm(inp)).toBe(350);
  });
  it("rechthoekig: D_eq = √(a · b)", () => {
    const inp = baseInput();
    inp.paalSoort = "rechthoekig";
    inp.diameterMm = 400;
    inp.zijdeBMm = 250;
    expect(computeDEqMm(inp)).toBeCloseTo(Math.sqrt(400 * 250), 6);
    expect(computeDEqMm(inp)).toBeCloseTo(316.228, 2);
  });
  it("vierkante paal (a=b): D_eq = a", () => {
    const inp = baseInput();
    inp.paalSoort = "rechthoekig";
    inp.diameterMm = 350;
    inp.zijdeBMm = 350;
    expect(computeDEqMm(inp)).toBe(350);
  });
  it("rechthoekig met 0-zijde → 0", () => {
    const inp = baseInput();
    inp.paalSoort = "rechthoekig";
    inp.diameterMm = 300;
    inp.zijdeBMm = 0;
    expect(computeDEqMm(inp)).toBe(0);
  });
});

describe("resolveValblok", () => {
  it("returns catalog entry by id", () => {
    const inp = baseInput();
    inp.valblokId = "vb-3000-1.2";
    const v = resolveValblok(inp);
    expect(v?.id).toBe("vb-3000-1.2");
    expect(v?.massaKg).toBe(3000);
  });
  it("returns custom valblok with computed E_blok", () => {
    const inp = baseInput();
    inp.valblokId = CUSTOM_VALBLOK_ID;
    inp.customMassaKg = 4500;
    inp.customValhoogteM = 0.8;
    const v = resolveValblok(inp);
    expect(v?.id).toBe(CUSTOM_VALBLOK_ID);
    expect(v?.eBlokKnm).toBeCloseTo(4500 * 9.81 * 0.8 / 1000, 2);
  });
  it("returns null for invalid custom valblok", () => {
    const inp = baseInput();
    inp.valblokId = CUSTOM_VALBLOK_ID;
    inp.customMassaKg = 0;
    inp.customValhoogteM = 0;
    expect(resolveValblok(inp)).toBeNull();
  });
  it("returns null for unknown catalog id", () => {
    const inp = baseInput();
    inp.valblokId = "vb-unknown-bogus";
    expect(resolveValblok(inp)).toBeNull();
  });
});

describe("computeKalendering — Excel-formule reproductie", () => {
  // Excel formule: =AFRONDEN.BOVEN.EXCEL(400/(($F$13/($J$13*$J$13*D16)));1)
  //   met F13 = E_blok in kNm, J13 = diameter in m, D16 = q_c in MPa, 400 = slag-set in mm
  //
  // Algebraïsch: N = CEILING(400 × D² × q_c / E_blok)

  it("reproduceert de Excel-formule exact voor rond, 350 mm, 15 MPa, 3 ton/1.2 m", () => {
    const inp = baseInput();
    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);

    // Hand-berekening:
    // E_blok = 3000 × 9.81 × 1.2 / 1000 = 35.316 kNm
    // D_eq = 0.350 m
    // 400 × 0.350² × 15 / 35.316 = 400 × 0.1225 × 15 / 35.316
    //                            = 735 / 35.316 = 20.812
    // CEILING(20.812) = 21
    const expectedRatio = 400 * 0.350 * 0.350 * 15 / (3000 * 9.81 * 1.2 / 1000);
    expect(r.eBlokKnm).toBeCloseTo(35.316, 2);
    expect(r.dEqMm).toBe(350);
    expect(r.slagenPerSet).toBe(Math.ceil(expectedRatio));
    expect(r.slagenPerSet).toBe(21);
    // 21 slagen per 400 mm → 21 × (1000/400) = 52.5 slagen per meter
    expect(r.slagenPerMeter).toBeCloseTo(52.5, 1);
  });

  it("rechthoekige paal gebruikt D_eq = √(a·b)", () => {
    const inp = baseInput();
    inp.paalSoort = "rechthoekig";
    inp.diameterMm = 400;
    inp.zijdeBMm = 250;
    inp.conusweerstandMpa = 20;
    inp.valblokId = "vb-4000-1.5";

    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);

    const dEqM = Math.sqrt(0.400 * 0.250); // ≈ 0.3162
    const E = 4000 * 9.81 * 1.5 / 1000;    // ≈ 58.86 kNm
    const expectedRatio = 400 * dEqM * dEqM * 20 / E;
    expect(r.dEqMm).toBeCloseTo(316.228, 2);
    expect(r.slagenPerSet).toBe(Math.ceil(expectedRatio));
  });

  it("custom valblok wordt correct doorgegeven aan formule", () => {
    const inp = baseInput();
    inp.valblokId = CUSTOM_VALBLOK_ID;
    inp.customMassaKg = 2500;
    inp.customValhoogteM = 1.0;

    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);

    const E = 2500 * 9.81 * 1.0 / 1000; // ≈ 24.525 kNm
    expect(r.eBlokKnm).toBeCloseTo(E, 2);
    const expectedRatio = 400 * 0.350 * 0.350 * 15 / E;
    expect(r.slagenPerSet).toBe(Math.ceil(expectedRatio));
  });

  it("slagSet van 200 mm halveert slagen-per-set (lineair)", () => {
    const inp200 = baseInput();
    inp200.slagSetMm = 200;
    const inp400 = baseInput();
    inp400.slagSetMm = 400;

    const r200 = computeKalendering(inp200);
    const r400 = computeKalendering(inp400);

    expect(r200.ok && r400.ok).toBe(true);
    // 200 mm geeft de helft van de slagen van 400 mm (vóór CEILING):
    //   r200.ratio = 400/2 × ... / E = r400.ratio / 2
    // Beide worden naar boven afgerond — verschil mag max 1 zijn.
    expect(Math.abs(r400.slagenPerSet - 2 * r200.slagenPerSet)).toBeLessThanOrEqual(1);
  });

  it("slagen-per-meter is consistent met slagen-per-set", () => {
    const inp = baseInput();
    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);
    expect(r.slagenPerMeter).toBeCloseTo(r.slagenPerSet * (1000 / inp.slagSetMm), 6);
  });
});

describe("computeKalendering — foutmeldingen", () => {
  it("error bij onbekend valblok-id", () => {
    const inp = baseInput();
    inp.valblokId = "vb-niet-bestaand";
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/onbekend valblok/i);
  });

  it("error bij custom met 0 massa", () => {
    const inp = baseInput();
    inp.valblokId = CUSTOM_VALBLOK_ID;
    inp.customMassaKg = 0;
    inp.customValhoogteM = 1.0;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/custom valblok/i);
  });

  it("error bij ronde paal met 0 diameter", () => {
    const inp = baseInput();
    inp.diameterMm = 0;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/diameter/i);
  });

  it("error bij rechthoekig met 0 zijde b", () => {
    const inp = baseInput();
    inp.paalSoort = "rechthoekig";
    inp.diameterMm = 400;
    inp.zijdeBMm = 0;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/beide zijdes/i);
  });

  it("error bij q_c ≤ 0", () => {
    const inp = baseInput();
    inp.conusweerstandMpa = 0;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/conusweerstand/i);
  });

  it("error bij slag-set ≤ 0", () => {
    const inp = baseInput();
    inp.slagSetMm = 0;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/slag-set/i);
  });
});

describe("computeKalendering — waarschuwingen", () => {
  it("warning bij zeer hoge slagcount (> 200)", () => {
    const inp = baseInput();
    // Combineer grote paal + middelmatige qc + licht valblok:
    //   D = 800 mm, q_c = 25 MPa, E = 14.7 kNm (1.5 t × 1 m)
    //   N = 400 × 0.8² × 25 / 14.7 ≈ 435 slagen per set → triggert > 200.
    inp.diameterMm = 800;
    inp.conusweerstandMpa = 25;
    inp.valblokId = "vb-1500-1.0";
    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);
    expect(r.slagenPerSet).toBeGreaterThan(200);
    expect(r.warnings.some((w) => /hoge slagcount/i.test(w))).toBe(true);
  });

  it("warning bij zeer lage slagcount (< 3)", () => {
    const inp = baseInput();
    // Kleine paal + lage qc + zwaar valblok → heel weinig slagen.
    //   D = 200 mm, q_c = 2 MPa, E = 68.7 kNm (7 t × 1 m)
    //   N = 400 × 0.2² × 2 / 68.7 ≈ 0.47 → CEIL = 1 → < 3.
    inp.diameterMm = 200;
    inp.conusweerstandMpa = 2;
    inp.valblokId = "vb-7000-1.0";
    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);
    expect(r.slagenPerSet).toBeLessThan(3);
    expect(r.warnings.some((w) => /lage slagcount/i.test(w))).toBe(true);
  });

  it("warning bij q_c > 30 MPa", () => {
    const inp = baseInput();
    inp.conusweerstandMpa = 35;
    const r = computeKalendering(inp);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("q_c"))).toBe(true);
  });
});

describe("VALBLOK_CATALOG", () => {
  it("alle catalog-entries hebben consistente E_blok (m·g·h/1000)", () => {
    for (const v of VALBLOK_CATALOG) {
      const expected = v.massaKg * 9.81 * v.valhoogteM / 1000;
      expect(v.eBlokKnm).toBeCloseTo(expected, 2);
    }
  });
  it("heeft minstens 4 voorgedefinieerde blokken", () => {
    expect(VALBLOK_CATALOG.length).toBeGreaterThanOrEqual(4);
  });
});
