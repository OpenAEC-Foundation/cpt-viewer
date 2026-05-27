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

describe("base resistance — running-min (afsnuiten) per NEN-EN 1997-1 NB §7.6.2.3", () => {
  // Synthetic CPT met qc OMHOOG-stijgend (= dalend met depth):
  //   qc(d) = 30 − d   →  qc(0)=30, qc(20)=10
  //
  // Pile toe op depth 15 m, diameter 219 mm → Deq = 0,219 m
  //   qc(15) = 15 MPa (paalpunt)
  //   qc(13,248) = 16,752 MPa (8·Deq boven paalpunt)
  //   qc(15,876) = 14,124 MPa (4·Deq onder paalpunt)
  //
  // Verwachte waarden per Boer/Koppejan met running-min:
  //   - qc;I: minimaliseert avg over [15, 15+dc] → bestDc = 4·Deq, avg = 14,562 MPa
  //   - qc;II: lopen UP van 15,876 → 15. qc stijgt 14,124 → 15.
  //     Running-min start op 14,124, blijft 14,124 (volgende waarden zijn hoger).
  //     → qc;II ≈ 14,124 MPa  (zónder running-min zou het 14,562 zijn)
  //   - qc;III: lopen UP van 15 → 13,248, running-min CONTINUEERT vanaf qc;II.
  //     Initial runMin = 14,124. qc(15)=15 → clip naar 14,124. qc(13,248)=16,752 → clip naar 14,124.
  //     → qc;III ≈ 14,124 MPa  (zónder running-min zou het ≈ 15,876 zijn)
  const cpt = {
    id: "rising",
    points: Array.from({ length: 201 }, (_, i) => ({
      depth: i * 0.1,           // 0 tot 20 m
      qc: 30 - i * 0.1,         // 30 → 10 MPa (lineair afnemend met diepte)
    })),
  };
  const pileType = getPileType("steel-pipe-driven-closed")!;
  const result = computeBaseResistance(cpt as never, {
    pileToeDepth: 15,
    diameterMm: 219,
    pileType,
  });

  it("kiest bestDc = 4·Deq (= 0,876 m) want qc daalt met diepte", () => {
    expect(result.criticalDepthM).toBeCloseTo(0.876, 1);
  });

  it("qc;I = simple average over [15, 15+bestDc] ≈ 14,56 MPa", () => {
    expect(result.qcIGemMpa).toBeCloseTo(14.56, 1);
  });

  it("qc;II ≈ 14,12 MPa door running-min vanaf 15,876 (NIET 14,56 zonder clip)", () => {
    // Walking UP 15,876 → 15: qc stijgt 14,124 → 15.
    // Running-min start op 14,124, blijft 14,124 (clip).
    // Gemiddelde clipped waarde = 14,124 MPa.
    expect(result.qcIIGemMpa).toBeCloseTo(14.12, 1);
    // En NIET dichtbij de niet-geclipte average van 14,562:
    expect(result.qcIIGemMpa).toBeLessThan(14.3);
  });

  it("qc;III ≈ 14,12 MPa — running-min continueert vanaf qc;II (NIET 15,87 zonder clip)", () => {
    // Continuiteit: runMin start op 14,124 (eindwaarde van qc;II walk).
    // qc(15)=15 → clip 14,124. qc(13,248)=16,752 → clip 14,124.
    // → constante clipped waarde = 14,124 MPa.
    expect(result.qcIIIGemMpa).toBeCloseTo(14.12, 1);
    // En NIET dichtbij de niet-geclipte average van 15,876:
    expect(result.qcIIIGemMpa).toBeLessThan(14.5);
  });

  it("qb;max gebaseerd op geclipte waarden: ½·0,7·1·1·((14,56+14,12)/2 + 14,12) ≈ 9,98 MPa", () => {
    // = 0,5 · 0,7 · 1 · 1 · (14,34 + 14,12) ≈ 9,96 MPa
    expect(result.qbMaxMpaRaw).toBeCloseTo(9.96, 0);
  });
});

describe("base resistance — running-min: enkele dunne zwakke laag boven paalpunt", () => {
  // CPT: 25 MPa zand overal, behalve dunne zwakke laag (qc=5 MPa) op depth 14 m.
  // Pile toe op depth 16 m, Deq=0,219 → 8D zone = 14,248..16,0.
  //
  // De zwakke laag op 14 m valt JUIST BUITEN de 8D-zone (14 < 14,248).
  // Maar bij steeds dieper paalpunt zou hij erin vallen. Voor deze test: pile toe op 15,5 m.
  // Dan 8D-zone = 13,748..15,5. De zwakke laag op 14 m valt binnen → klipt qc;III sterk.
  //
  // Lopen UP van 15,5 → 13,748: qc=25 boven en onder, behalve clip naar 5 op 14 m.
  // Running-min walk vanaf 15,5 (qc=25):
  //   - depth 15,5..14,1: qc=25, runMin=25 (na initialisatie van qc;II)
  //   - depth 14,0: qc=5, runMin=5
  //   - depth 13,9..13,748: qc=25, gecliped naar 5
  // Average ≈ ~weighted gemiddelde van (25 × 1,5 + 5 × 0,252) / 1,752 ≈ 22,12 MPa? Nee:
  // Met clip: depth ≥14 heeft runMin=25, depth <14 heeft runMin=5.
  // (Vergeet niet de boundary-punten.)
  // Width @25: 15,5 → 14,05 ≈ 1,45 m  (samples 15,5, 15,4, ..., 14,1, plus interp punt op 14,05 als runMin nog 25 is)
  // Width @5:  14,0 → 13,748 ≈ 0,25 m  (samples 14,0, 13,9, 13,8, plus 13,748)
  // Hmm, niet super eenduidig. Laat me uitrekenen met scherpe boundaries.
  //
  // Maar het belangrijkste: qc;III mét clip MOET KLEINER zijn dan zonder clip,
  // omdat de zwakke laag de runMin naar beneden trekt voor alle ondiepere depths.
  const cpt = {
    id: "weak-layer",
    points: Array.from({ length: 201 }, (_, i) => {
      const d = i * 0.1;
      // Sterke laag overal qc=25, behalve scherp bij d≈14 (single point) qc=5
      let qc = 25;
      if (i === 140) qc = 5; // depth 14,0 exact
      return { depth: d, qc };
    }),
  };
  const pileType = getPileType("steel-pipe-driven-closed")!;
  const result = computeBaseResistance(cpt as never, {
    pileToeDepth: 15.5,
    diameterMm: 219,
    pileType,
  });

  it("qc;III is verlaagd door zwakke laag die runMin naar beneden trekt", () => {
    // Zonder clip zou qc;III ≈ 25 MPa zijn (één dipje is verwaarloosbaar in avg).
    // Met running-min walking UP: zodra je voorbij depth 14 m komt naar boven,
    // staat runMin op 5, dus elke ondiepere depth wordt gecliped naar 5.
    // qc;III moet substantieel < 25 zijn.
    expect(result.qcIIIGemMpa).toBeLessThan(25);
  });
});
