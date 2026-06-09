// apps/desktop/src/calc/modules/kalendering/module.tsx
//
// ⚠ ALPHA — nog in ontwikkeling. De formule is rechtstreeks uit het
//   project-template overgenomen en is een empirische benadering, géén
//   norm-formule. De berekening is NIET productie-geverifieerd. Niet
//   gebruiken voor toetsing bij vergunning of uitvoering. CalculationsView
//   toont een prominente amber tussenstand-banner zodra deze module actief
//   is. Voor projectberekeningen blijft de Funderingspaal-module leidend.
//
import type { CalcModule, ProjectContext } from "../../framework/types";
import type { KalenderingInput, KalenderingResult } from "./types";
import { computeKalendering } from "./compute";
import { DEFAULT_VALBLOK_ID } from "./catalog";
import { InputPanel } from "./ui/InputPanel";
import { VisualPanel } from "./ui/VisualPanel";
import { ResultPanel } from "./ui/ResultPanel";

function defaultInput(_ctx: ProjectContext): KalenderingInput {
  void _ctx;
  return {
    valblokId: DEFAULT_VALBLOK_ID,
    customMassaKg: 3000,
    customValhoogteM: 1.2,
    paalSoort: "rond",
    diameterMm: 350,
    zijdeBMm: 350,
    conusweerstandMpa: 15,
    slagSetMm: 400,
  };
}

const kalenderingModuleTyped: CalcModule<KalenderingInput, KalenderingResult> = {
  id: "kalendering",
  name: "Kalendering",
  subtitle: "Verwacht aantal heislagen per set",
  category: "pile",
  icon: "🔨",
  norm: "Empirische projectformule (≠ norm)",
  status: "experimental",
  defaultInput,
  compute: (input) => computeKalendering(input),
  InputPanel,
  VisualPanel,
  ResultPanel,
  statusLine: (r) => ({
    text: r.ok
      ? `${r.slagenPerSet} slagen / set`
      : `Fout: ${r.error ?? "—"}`,
    ok: r.ok,
  }),
};

/** Geëxporteerd als unknown-getypeerde CalcModule zodat hij in
 *  CALC_REGISTRY (CalcModule[]) past — generieke parameters zijn
 *  contravariant in compute/defaultInput. Zie pile-bearing-capacity
 *  module.tsx voor dezelfde pattern. */
export const kalenderingModule = kalenderingModuleTyped as unknown as CalcModule;
