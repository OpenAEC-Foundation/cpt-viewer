// apps/desktop/src/calc/modules/kalendering/ui/VisualPanel.test.tsx
//
// Regression test voor white-screen bug (juni 2026):
// VisualPanel mag NIET crashen als `input` een lege object is.
// Dat kon gebeuren in de korte tussenstand tussen `addCalc` (input={})
// en `updateCalc({input: defaultInput})` in NewCalculationDialog.
// De bug zat in:
//   q_c = {input.conusweerstandMpa.toFixed(1)} MPa
// → TypeError als conusweerstandMpa undefined was.
//
// Fix-richting in de code:
//  1. NewCalculationDialog roept addCalc nu atomisch aan MET de input
//  2. VisualPanel gebruikt een `fmt()`-helper die undefined naar "—" mapt
//
// Deze test dekt fix #2 — fix #1 voorkomt het hoofdpad, fix #2 maakt
// de component robuust voor elke andere route waar partial input
// binnenkomt (bv. persistence loading van een oud .ifcgeo-bestand).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VisualPanel } from "./VisualPanel";
import type { KalenderingInput, KalenderingResult } from "../types";

const emptyResult: KalenderingResult = {
  ok: false,
  error: "lege input",
  warnings: [],
  eBlokKnm: 0,
  dEqMm: 0,
  slagenPerSet: 0,
  slagenPerMeter: 0,
};

describe("VisualPanel — defensief tegen partial input", () => {
  it("rendert zonder crash bij volledig lege input ({})", () => {
    // Cast naar KalenderingInput — runtime is dit een {} object zoals
    // het uit `addCalculation(docId, moduleId, name)` zonder input-arg
    // kwam (vóór de atomic-input-fix).
    const empty = {} as unknown as KalenderingInput;
    expect(() => {
      render(<VisualPanel input={empty} result={emptyResult} />);
    }).not.toThrow();
  });

  it("rendert '—' voor undefined q_c i.p.v. crash", () => {
    const empty = {} as unknown as KalenderingInput;
    const { container } = render(<VisualPanel input={empty} result={emptyResult} />);
    // De q_c-tekst moet aanwezig zijn, maar met "—" als placeholder
    expect(container.textContent).toMatch(/q_c\s*=\s*—\s*MPa/);
  });

  it("rendert correct met volledige geldige input", () => {
    const full: KalenderingInput = {
      valblokId: "vb-3000-1.2",
      customMassaKg: 3000,
      customValhoogteM: 1.2,
      paalSoort: "rond",
      diameterMm: 350,
      zijdeBMm: 350,
      conusweerstandMpa: 15,
      slagSetMm: 400,
    };
    const fullResult: KalenderingResult = {
      ok: true,
      warnings: [],
      eBlokKnm: 35.316,
      dEqMm: 350,
      slagenPerSet: 21,
      slagenPerMeter: 52.5,
    };
    const { container } = render(<VisualPanel input={full} result={fullResult} />);
    expect(container.textContent).toMatch(/q_c\s*=\s*15\.0\s*MPa/);
    expect(container.textContent).toMatch(/D\s*=\s*350\s*mm/);
  });
});
