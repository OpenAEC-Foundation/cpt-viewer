// Verification-test tegen ExternPakket 2027.3.01 referentie-berekening
// uit `verification-files/Constructieberekeningen/Funderingspaal/984.pdf`.
//
// ExternPakket is een Nederlandse engineering-suite voor constructie-
// berekeningen; de PDF bevat een paaldraagvermogen-berekening voor
// een betongevulde stalen buispaal (Ø 219 mm) met sondering 1 als
// CPT-input. Doel: onze implementatie van NEN 9997-1 NB:2019 §7.6.2.3
// (Boer/Koppejan kritische-diepte-methode) moet binnen redelijke
// tolerantie dezelfde getallen produceren.
//
// De GEF (121882_1.GEF) wordt direct van schijf gelezen via de minimale
// gefParser-helper. Voor toekomstige extra cases (S3..S8) volstaat het
// om hun GEFs in __fixtures__/ te kopiëren en hier een test-case toe
// te voegen.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGef } from "./__fixtures__/gefParser";
import { computeBaseResistance } from "./parts/base-resistance";
import { getPileType } from "./catalog";

interface ExternPakketCase {
  name: string;
  gef: string;
  expected: {
    qcIMpa: number;
    qcIIMpa: number;
    qcIIIMpa: number;
    qbMaxMpa: number;
    rbCalMaxKn: number;
  };
}

// Verwachte waarden uit ExternPakket 984.pdf — alle 7 sonderingen uit het
// project (S1, S3..S8 — S2 ontbreekt in de bronberekening). Alle cases
// gebruiken dezelfde paal-geometrie (Ø219 mm buispaal, paalpunt NAP
// -14,50, gesloten punt geheid) — alleen de CPT-data verschilt.
const CASES: ExternPakketCase[] = [
  {
    name: "S1 (121882_1.gef)",
    gef: "121882_1.gef",
    expected: { qcIMpa: 17.97, qcIIMpa: 17.73, qcIIIMpa: 13.91, qbMaxMpa: 11.12, rbCalMaxKn: 419 },
  },
  {
    name: "S3 (121882_3.gef)",
    gef: "121882_3.gef",
    expected: { qcIMpa: 13.25, qcIIMpa: 11.75, qcIIIMpa: 11.75, qbMaxMpa: 8.49, rbCalMaxKn: 320 },
  },
  {
    name: "S4 (121882_4.gef)",
    gef: "121882_4.gef",
    expected: { qcIMpa: 17.64, qcIIMpa: 13.69, qcIIIMpa: 12.99, qbMaxMpa: 10.03, rbCalMaxKn: 378 },
  },
  {
    name: "S5 (121882_5.gef)",
    gef: "121882_5.gef",
    expected: { qcIMpa: 15.27, qcIIMpa: 14.51, qcIIIMpa: 11.01, qbMaxMpa: 9.06, rbCalMaxKn: 341 },
  },
  {
    name: "S6 (121882_6.gef)",
    gef: "121882_6.gef",
    expected: { qcIMpa: 15.06, qcIIMpa: 13.49, qcIIIMpa: 10.49, qbMaxMpa: 8.67, rbCalMaxKn: 326 },
  },
  {
    name: "S7 (121882_7.gef)",
    gef: "121882_7.gef",
    expected: { qcIMpa: 14.38, qcIIMpa: 14.36, qcIIIMpa: 4.08, qbMaxMpa: 6.46, rbCalMaxKn: 243 },
  },
  {
    name: "S8 (121882_8.gef)",
    gef: "121882_8.gef",
    expected: { qcIMpa: 10.38, qcIIMpa: 10.33, qcIIIMpa: 9.03, qbMaxMpa: 6.78, rbCalMaxKn: 255 },
  },
];

const PILE_TOP_NAP = 0.34;
const PILE_TOE_NAP = -14.5;
const DIAMETER_MM = 219;

describe("verification — ExternPakket 984.pdf (NEN 9997-1 NB:2019 §7.6.2.3)", () => {
  const pileType = getPileType("steel-pipe-driven-closed")!;

  for (const c of CASES) {
    describe(c.name, () => {
      const gefContent = readFileSync(
        resolve(__dirname, "__fixtures__", c.gef),
        "utf-8",
      );
      const cpt = parseGef(gefContent, c.name);
      const groundNap = cpt.metadata.ground_level_nap ?? 0;
      const pileToeDepth = groundNap - PILE_TOE_NAP;
      const result = computeBaseResistance(cpt, {
        pileToeDepth,
        diameterMm: DIAMETER_MM,
        pileType,
      });

      // Drie afzonderlijke its zodat een failure direct laat zien welk
      // gemiddelde (I/II/III) van het ExternPakket-resultaat afwijkt.
      it(`qc;I gemiddelde ≈ ${c.expected.qcIMpa} MPa (NEN 9997-1 NB:2019 §7.6.2.3)`, () => {
        // Tolerantie 0,5 MPa — accepteert kleine verschillen door:
        //   - andere interpolatie-strategie tussen CPT-meetpunten
        //   - andere dc-loop step-size (0,01·Deq vs ExternPakket's interne)
        //   - rounding van paalpunt op 0,5 m vs exacte NAP
        expect(result.qcIGemMpa).toBeCloseTo(c.expected.qcIMpa, 0);
      });
      it(`qc;II gemiddelde ≈ ${c.expected.qcIIMpa} MPa (afgekapt op qc;I)`, () => {
        expect(result.qcIIGemMpa).toBeCloseTo(c.expected.qcIIMpa, 0);
      });
      it(`qc;III gemiddelde ≈ ${c.expected.qcIIIMpa} MPa (continueerd lopende min)`, () => {
        expect(result.qcIIIGemMpa).toBeCloseTo(c.expected.qcIIIMpa, 0);
      });
      it(`q_b;max ≈ ${c.expected.qbMaxMpa} MPa`, () => {
        expect(result.qbMaxMpa).toBeCloseTo(c.expected.qbMaxMpa, 0);
      });
      it(`R_b;cal;max ≈ ${c.expected.rbCalMaxKn} kN`, () => {
        // Tolerantie 25 kN (~6%) — ExternPakket rondt intern af; cumulatieve
        // verschillen in qc;I/II/III sluipen door naar Rb.
        expect(result.rbCalMax).toBeGreaterThan(c.expected.rbCalMaxKn - 25);
        expect(result.rbCalMax).toBeLessThan(c.expected.rbCalMaxKn + 25);
      });

      // Diagnostiek: console.log de werkelijke waarden zodat een
      // mismatch direct visueel zichtbaar is in de test-output.
      it("diagnostiek — actual vs expected", () => {
        // eslint-disable-next-line no-console
        console.log(`\n${c.name}:`);
        // eslint-disable-next-line no-console
        console.log(`  qc;I    actual=${result.qcIGemMpa.toFixed(2)}  expected=${c.expected.qcIMpa}`);
        // eslint-disable-next-line no-console
        console.log(`  qc;II   actual=${result.qcIIGemMpa.toFixed(2)}  expected=${c.expected.qcIIMpa}`);
        // eslint-disable-next-line no-console
        console.log(`  qc;III  actual=${result.qcIIIGemMpa.toFixed(2)}  expected=${c.expected.qcIIIMpa}`);
        // eslint-disable-next-line no-console
        console.log(`  qb;max  actual=${result.qbMaxMpa.toFixed(2)}  expected=${c.expected.qbMaxMpa}`);
        // eslint-disable-next-line no-console
        console.log(`  Rb;cal  actual=${result.rbCalMax.toFixed(0)}  expected=${c.expected.rbCalMaxKn}`);
        expect(true).toBe(true);
      });
    });
  }
});
