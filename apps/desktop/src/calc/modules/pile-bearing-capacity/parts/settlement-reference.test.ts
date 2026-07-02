// Harde verificatie van de COMPLETE zakkings- en veerwaarde-keten tegen
// de 8 werkpunten uit de externe referentie-berekening (984.pdf, bladen
// 3/6/9/12/15/18/21/26). In tegenstelling tot de full-verificatie voeren
// we hier de Rb;cal;max / Rs;cal;max / Fnk van de REFERENTIE zelf in —
// zo testen we de keten (curves → sb-solver → Fgem → s_el → s1 → k)
// geïsoleerd van grondprofiel-verschillen: zelfde input ⇒ zelfde output.
//
// Toleranties: het referentierapport print sb/s1 op 1 decimaal en de
// mobilisatie-percentages als gehele procenten; strakker dan ±0,15 mm /
// ±2% op k is daardoor niet zinvol, ruimer verbergt echte fouten.

import { describe, it, expect } from "vitest";
import { computeSettlement } from "./settlement";
import { computeSpringStiffness } from "./spring-stiffness";

/** EA van de stalen buispaal D219×8 mm met betonvulling — exact zoals in
 *  de referentie (blad 3: s_el = L·F_gem / 1 356 065). */
const EA_N = 1.356065e9;
const NK = 303;
const NED = 324;

interface RefWorkpoint {
  name: string;
  rbCalMax: number;   // kN — referentie Rb;cal;max
  rsCalMax: number;   // kN — referentie Rs;cal;max
  fnk: number;        // kN — referentie Fnk;d
  lM: number;         // paallengte
  deltaLM: number;    // positieve-kleeftraject ΔL
  // Verwachte keten-uitkomsten (zelfde blad):
  sbMm: number;
  rbMobil: number;    // kN
  rsMobil: number;    // kN
  fgem: number;       // kN
  selMm: number;
  s1Mm: number;
  kKnPerM: number;
  kMinKnPerM: number;
  kMaxKnPerM: number;
}

const REF: RefWorkpoint[] = [
  { name: "S1", rbCalMax: 419, rsCalMax: 202, fnk: 35, lM: 14.84, deltaLM: 5.5,
    sbMm: 2.5, rbMobil: 206, rsMobil: 132, fgem: 237, selMm: 2.6, s1Mm: 5.0,
    kKnPerM: 66945, kMinKnPerM: 47337, kMaxKnPerM: 94675 },
  { name: "S3", rbCalMax: 320, rsCalMax: 284, fnk: 56, lM: 14.84, deltaLM: 5.5,
    sbMm: 2.7, rbMobil: 163, rsMobil: 196, fgem: 262, selMm: 2.9, s1Mm: 5.6,
    kKnPerM: 64387, kMinKnPerM: 45528, kMaxKnPerM: 91057 },
  { name: "S8", rbCalMax: 255, rsCalMax: 311, fnk: 60, lM: 14.84, deltaLM: 5.5,
    sbMm: 3.1, rbMobil: 136, rsMobil: 226, fgem: 270, selMm: 3.0, s1Mm: 6.1,
    kKnPerM: 59466, kMinKnPerM: 42049, kMaxKnPerM: 84097 },
  { name: "S4", rbCalMax: 378, rsCalMax: 345, fnk: 0, lM: 14.84, deltaLM: 14.5,
    sbMm: 1.3, rbMobil: 135, rsMobil: 168, fgem: 89, selMm: 1.0, s1Mm: 2.3,
    kKnPerM: 131952, kMinKnPerM: 93304, kMaxKnPerM: 186609 },
  { name: "S5", rbCalMax: 341, rsCalMax: 321, fnk: 1, lM: 14.84, deltaLM: 14.5,
    sbMm: 1.6, rbMobil: 133, rsMobil: 171, fgem: 90, selMm: 1.0, s1Mm: 2.6,
    kKnPerM: 115888, kMinKnPerM: 81945, kMaxKnPerM: 163890 },
  { name: "S6", rbCalMax: 326, rsCalMax: 328, fnk: 1, lM: 14.84, deltaLM: 14.5,
    sbMm: 1.7, rbMobil: 127, rsMobil: 177, fgem: 93, selMm: 1.0, s1Mm: 2.7,
    kKnPerM: 111770, kMinKnPerM: 79033, kMaxKnPerM: 158067 },
  { name: "S7", rbCalMax: 243, rsCalMax: 306, fnk: 1, lM: 14.84, deltaLM: 14.5,
    sbMm: 2.2, rbMobil: 114, rsMobil: 190, fgem: 100, selMm: 1.1, s1Mm: 3.3,
    kKnPerM: 92402, kMinKnPerM: 65338, kMaxKnPerM: 130676 },
  // S2-paal (blad 26): langere paal (17,34 m), ΔL = 8,0 m.
  { name: "S2", rbCalMax: 265, rsCalMax: 301, fnk: 53, lM: 17.34, deltaLM: 8.0,
    sbMm: 3.0, rbMobil: 140, rsMobil: 216, fgem: 242, selMm: 3.1, s1Mm: 6.1,
    kKnPerM: 58319, kMinKnPerM: 41238, kMaxKnPerM: 82476 },
];

describe("zakkingsketen — 8 referentie-werkpunten exact (referentie-inputs)", () => {
  for (const r of REF) {
    it(`${r.name}: sb/s1/k-keten reproduceert blad-waarden`, () => {
      const settlement = computeSettlement({
        fcTotSls: NK + r.fnk,
        fcTotUls: NED + r.fnk,
        rbCalMax: r.rbCalMax,
        rsCalMax: r.rsCalMax,
        deqMm: 219,
        EA_N,
        ellM: r.lM - r.deltaLM,
        L_m: r.lM,
        deltaL_m: r.deltaLM,
      });
      const w = settlement.sls;
      const spring = computeSpringStiffness(settlement);

      // Zakkingen op ±0,15 mm (referentie print 1 decimaal).
      expect(w.sbMm, `${r.name} sb`).toBeGreaterThan(r.sbMm - 0.15);
      expect(w.sbMm, `${r.name} sb`).toBeLessThan(r.sbMm + 0.15);
      expect(w.selMm, `${r.name} s_el`).toBeGreaterThan(r.selMm - 0.15);
      expect(w.selMm, `${r.name} s_el`).toBeLessThan(r.selMm + 0.15);
      expect(w.s1Mm, `${r.name} s1`).toBeGreaterThan(r.s1Mm - 0.15);
      expect(w.s1Mm, `${r.name} s1`).toBeLessThan(r.s1Mm + 0.15);

      // Gemobiliseerde weerstanden + Fgem op ±5 kN (integer-afronding
      // in de referentie + curve-aflezing op hele procenten).
      expect(Math.abs(w.rbMobil - r.rbMobil), `${r.name} Rb;mob=${w.rbMobil.toFixed(1)}`).toBeLessThan(5);
      expect(Math.abs(w.rsMobil - r.rsMobil), `${r.name} Rs;mob=${w.rsMobil.toFixed(1)}`).toBeLessThan(5);
      expect(Math.abs(w.fgem - r.fgem), `${r.name} Fgem=${w.fgem.toFixed(1)}`).toBeLessThan(5);

      // Veerwaarden: k = Fc;tot/s1, dus de haalbare k-precisie volgt
      // rechtstreeks uit de s1-printprecisie (±0,15 mm op 1 decimaal):
      // tolerantie = max(2%, 0,16 mm / s1;ref). Bij s1 = 2,7 mm is dat
      // ~6% — strakker claimen dan de bron print zou schijnzekerheid zijn.
      const kTol = Math.max(0.02, 0.16 / r.s1Mm);
      expect(Math.abs(spring.kSlsKnPerM - r.kKnPerM) / r.kKnPerM, `${r.name} k=${spring.kSlsKnPerM.toFixed(0)} vs ${r.kKnPerM}`).toBeLessThan(kTol);
      expect(Math.abs(spring.kMinKnPerM - r.kMinKnPerM) / r.kMinKnPerM, `${r.name} kmin`).toBeLessThan(kTol);
      expect(Math.abs(spring.kMaxKnPerM - r.kMaxKnPerM) / r.kMaxKnPerM, `${r.name} kmax`).toBeLessThan(kTol);

      // Evenwicht: gemobiliseerd Rb+Rs = Fc;tot (solver-invariant).
      expect(Math.abs(w.rbMobil + w.rsMobil - (NK + r.fnk))).toBeLessThan(0.5);
    });
  }
});
