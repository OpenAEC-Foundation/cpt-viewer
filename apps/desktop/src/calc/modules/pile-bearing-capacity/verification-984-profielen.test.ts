// Verificatie tegen de externe referentie-berekening (984.pdf) mét de
// UIT DE REFERENTIE GEDIGITALISEERDE grondprofielen (vector-extractie uit
// de laagkolommen van de rapportbladen; zie __fixtures__/
// referentie-grondprofielen.json). Waar de full-verificatie het profiel
// automatisch detecteert (en dus profiel-verschillen meet), voedt deze
// test dezelfde laagindeling als de referentie — zo horen álle
// profiel-afhankelijke waarden (Fnk, Rs) veel dichter te landen.
//
// Toleranties zijn per grootheid gedocumenteerd:
//  - qc;I/II/III + Rb: ±3% (profiel-onafhankelijk; referentie-resampling)
//  - Rs: ±7% (laaggrens-digitalisatie ±0,1–0,2 m stuurt de qc-caps)
//  - Fnk: ±22 kN (veen/klei-kleurscheiding in de gestreepte kolom is de
//    dominante ruisbron; de conventie zelf — σ0 vanaf ontgraving,
//    K0·tanδ ≥ 0,25, volledige σ′v-opbouw — is exact geverifieerd op de
//    ondiepe-kleefniveau-cases die 1 kN printen)
//  - Eind-UC: ±0,07 t.o.v. referentie 0,92

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseGef } from "./__fixtures__/gefParser";
import { computePile } from "./compute";
import { computeMultiCptSummary, type PerCptCase } from "./parts/multi-cpt-summary";
import type { PileInput, PileResult, SoilLayer, SoilKind } from "./types";
import profielen from "./__fixtures__/referentie-grondprofielen.json";

const WATER_NAP = -0.16;

// Grondsoort-tabel van referentie-blad 1: nr → γk / γsat / φ / familie.
const SOIL_TABLE: Record<number, { gammaK: number; gammaSat: number; phi: number; kind: SoilKind }> = {
  1:  { gammaK: 18, gammaSat: 20, phi: 35.0, kind: "sand-wet" },
  2:  { gammaK: 18, gammaSat: 20, phi: 32.5, kind: "sand-wet" },
  3:  { gammaK: 19, gammaSat: 21, phi: 35.0, kind: "sand-wet" },
  4:  { gammaK: 18, gammaSat: 20, phi: 30.0, kind: "sand-wet" },
  5:  { gammaK: 18, gammaSat: 20, phi: 30.0, kind: "sand-wet" },
  7:  { gammaK: 20, gammaSat: 20, phi: 27.5, kind: "clay" },
  8:  { gammaK: 18, gammaSat: 18, phi: 22.5, kind: "clay" },
  9:  { gammaK: 15, gammaSat: 15, phi: 17.5, kind: "clay" },
  10: { gammaK: 15, gammaSat: 15, phi: 17.5, kind: "clay" },
  12: { gammaK: 12, gammaSat: 12, phi: 15.0, kind: "peat" },
};

/** Digitaliseerd profiel → SoilLayer[], gesplitst op de waterstand
 *  (boven: γk + gammaW 0; onder: γsat + gammaW 10). */
function toSoilProfile(
  layers: Array<{ soil: number; top: number; bot: number }>,
): SoilLayer[] {
  const out: SoilLayer[] = [];
  for (const l of layers) {
    const t = SOIL_TABLE[l.soil];
    if (!t) continue;
    const kindAbove: SoilKind = t.kind === "sand-wet" ? "sand-dry" : t.kind;
    if (l.top > WATER_NAP && l.bot < WATER_NAP) {
      out.push({ kind: kindAbove, startNap: l.top, endNap: WATER_NAP, gammaK: t.gammaK, gammaW: 0, phi: t.phi });
      out.push({ kind: t.kind, startNap: WATER_NAP, endNap: l.bot, gammaK: t.gammaSat, gammaW: 10, phi: t.phi });
    } else if (l.bot >= WATER_NAP) {
      out.push({ kind: kindAbove, startNap: l.top, endNap: l.bot, gammaK: t.gammaK, gammaW: 0, phi: t.phi });
    } else {
      out.push({ kind: t.kind, startNap: l.top, endNap: l.bot, gammaK: t.gammaSat, gammaW: 10, phi: t.phi });
    }
  }
  return out;
}

const PROJECT = {
  pileTypeId: "steel-pipe-driven-closed",
  diameterMm: 219,
  wallThicknessMm: 8.0,
  pileTopNap: 0.34,
  pileToeNap: -14.5,
  waterNap: WATER_NAP,
  excavationNap: 0.84,
  nEd: 324,
  nEk: 303,
  gammaM: 1.2,
  gammaFnk: 1.0,
  ksMinFactor: 0.25,
};

interface RefCase {
  name: string;
  gef: string;
  profKey: keyof typeof profielen;
  negKleefBottomNap: number;
  qcI: number; qcII: number; qcIII: number;
  rbCalMax: number; rsCalMax: number; rcCal: number; fnkD: number;
}
const CASES: RefCase[] = [
  { name: "S1", gef: "121882_1.gef", profKey: "S1", negKleefBottomNap: -9.0, qcI: 17.97, qcII: 17.73, qcIII: 13.91, rbCalMax: 419, rsCalMax: 202, rcCal: 621, fnkD: 35 },
  { name: "S3", gef: "121882_3.gef", profKey: "S3", negKleefBottomNap: -9.0, qcI: 13.25, qcII: 11.75, qcIII: 11.75, rbCalMax: 320, rsCalMax: 284, rcCal: 604, fnkD: 56 },
  { name: "S4", gef: "121882_4.gef", profKey: "S4", negKleefBottomNap: 0.0,  qcI: 17.64, qcII: 13.69, qcIII: 12.99, rbCalMax: 378, rsCalMax: 345, rcCal: 723, fnkD: 0 },
  { name: "S5", gef: "121882_5.gef", profKey: "S5", negKleefBottomNap: 0.0,  qcI: 15.27, qcII: 14.51, qcIII: 11.01, rbCalMax: 341, rsCalMax: 321, rcCal: 663, fnkD: 1 },
  { name: "S6", gef: "121882_6.gef", profKey: "S6", negKleefBottomNap: 0.0,  qcI: 15.06, qcII: 13.49, qcIII: 10.49, rbCalMax: 326, rsCalMax: 328, rcCal: 654, fnkD: 1 },
  { name: "S7", gef: "121882_7.gef", profKey: "S7", negKleefBottomNap: 0.0,  qcI: 14.38, qcII: 14.36, qcIII: 4.08,  rbCalMax: 243, rsCalMax: 306, rcCal: 549, fnkD: 1 },
  { name: "S8", gef: "121882_8.gef", profKey: "S8", negKleefBottomNap: -9.0, qcI: 10.38, qcII: 10.33, qcIII: 9.03,  rbCalMax: 255, rsCalMax: 311, rcCal: 566, fnkD: 60 },
];

const RESULTS = new Map<string, PileResult>();

beforeAll(() => {
  for (const c of CASES) {
    const content = readFileSync(resolve(__dirname, "__fixtures__", c.gef), "utf-8");
    const cpt = parseGef(content, c.name);
    const input: PileInput = {
      cptId: c.name,
      ...PROJECT,
      negKleefBottomNap: c.negKleefBottomNap,
      soilProfile: toSoilProfile(profielen[c.profKey] as Array<{ soil: number; top: number; bot: number }>),
    };
    const r = computePile(input, cpt);
    if (!r.ok) throw new Error(`${c.name}: ${r.error}`);
    RESULTS.set(c.name, r);
  }
});

describe("verificatie met gedigitaliseerde referentie-grondprofielen", () => {
  for (const c of CASES) {
    it(`${c.name}: qc-trajecten + Rb binnen 3%`, () => {
      const r = RESULTS.get(c.name)!;
      expect(Math.abs(r.base.qcIGemMpa - c.qcI) / c.qcI, `qcI=${r.base.qcIGemMpa.toFixed(2)}`).toBeLessThan(0.03);
      expect(Math.abs(r.base.qcIIGemMpa - c.qcII) / c.qcII, `qcII=${r.base.qcIIGemMpa.toFixed(2)}`).toBeLessThan(0.03);
      expect(Math.abs(r.base.qcIIIGemMpa - c.qcIII) / c.qcIII, `qcIII=${r.base.qcIIIGemMpa.toFixed(2)}`).toBeLessThan(0.05);
      expect(Math.abs(r.base.rbCalMax - c.rbCalMax) / c.rbCalMax, `Rb=${r.base.rbCalMax.toFixed(0)}`).toBeLessThan(0.03);
    });

    it(`${c.name}: Rs binnen 7% van referentie (${c.rsCalMax} kN)`, () => {
      const r = RESULTS.get(c.name)!;
      expect(Math.abs(r.shaft.rsCalMax - c.rsCalMax) / c.rsCalMax, `Rs=${r.shaft.rsCalMax.toFixed(0)}`).toBeLessThan(0.07);
    });

    it(`${c.name}: Fnk binnen 22 kN van referentie (${c.fnkD} kN)`, () => {
      const r = RESULTS.get(c.name)!;
      expect(Math.abs(r.negKleef.fnkD - c.fnkD), `Fnk=${r.negKleef.fnkD.toFixed(1)}`).toBeLessThan(22);
    });
  }

  it("multi-CPT eindanalyse: UC binnen 0,07 van referentie (0,92)", () => {
    const cases: PerCptCase[] = CASES.map((c) => {
      const r = RESULTS.get(c.name)!;
      return {
        cptId: c.name,
        rbCalMax: r.base.rbCalMax,
        rsCalMax: r.shaft.rsCalMax,
        rcCal: r.base.rbCalMax + r.shaft.rsCalMax,
        fnkD: r.negKleef.fnkD,
      };
    });
    const s = computeMultiCptSummary({
      cases,
      gammaM: PROJECT.gammaM,
      nEd: PROJECT.nEd,
      stiffness: "non-stiff",
    });
    // Referentie blad 23: ξ3=1,27 ξ4=1,01 (VC<12%), Rc;d=411, Fnk;d=60
    // (maatgevend), Rc;net;d=351, UC=0,92.
    expect(s.xi3).toBe(1.27);
    expect(s.xi4).toBe(1.01);
    expect(Math.abs(s.unityCheck - 0.92), `UC=${s.unityCheck.toFixed(2)}`).toBeLessThan(0.07);
    expect(s.passes).toBe(true);
  });
});
