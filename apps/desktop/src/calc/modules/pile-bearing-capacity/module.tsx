// apps/desktop/src/calc/modules/pile-bearing-capacity/module.tsx
//
// ⚠ ALPHA — nog in ontwikkeling. De berekening werkt, maar getallen zijn
//   nog NIET productie-geverifieerd. Niet gebruiken voor toetsing bij
//   vergunning of uitvoering. Module is hard-disabled via
//   NOT_PRODUCTION_READY in useExtensions.ts; CalculationsView toont een
//   prominente amber tussenstand-banner zodra deze module actief is.
//
import type { CalcModule, ProjectContext } from "../../framework/types";
import type { PileInput, PileResult } from "./types";
import { computePile } from "./compute";
import { PILE_TYPE_CATALOG, buildDefaultSoilLayers } from "./catalog";
import { InputPanel } from "./ui/InputPanel";
import { VisualPanel } from "./ui/VisualPanel";
import { ResultPanel } from "./ui/ResultPanel";

function defaultInput(ctx: ProjectContext): PileInput {
  const cpt = ctx.activeCptId ? ctx.cpts.get(ctx.activeCptId) : null;
  const groundNap = cpt?.metadata.ground_level_nap ?? 0;
  const pileTop = groundNap + 0.34;
  const pileToe = groundNap - 14;
  const water = groundNap - 0.5;
  return {
    cptId: ctx.activeCptId,
    pileTypeId: PILE_TYPE_CATALOG[0].id,
    diameterMm: 219,
    wallThicknessMm: 8.0,
    pileTopNap: pileTop,
    pileToeNap: pileToe,
    waterNap: water,
    excavationNap: groundNap,
    nEd: 0,
    nEk: 0,
    gammaM: 1.20,
    gammaFnk: 1.00,
    negKleefBottomNap: groundNap - 8,
    // Default: pos-kleef-bovenkant valt samen met neg-kleef-ondergrens.
    // Ondergrens van pos-kleef is altijd paalpunt (hard-coded in compute).
    // Engineer kan de bovenkant onafhankelijk omlaag zetten via de
    // draggable groene lijn in VisualPanel als er een zwakke laag tussen
    // neg-kleef en pos-kleef zit.
    posKleefTopNap: groundNap - 8,
    ksMinFactor: 0.25,
    soilProfile: buildDefaultSoilLayers(pileTop, pileToe, water),
  };
}

const pileModuleTyped: CalcModule<PileInput, PileResult> = {
  id: "pile-bearing-capacity",
  name: "Funderingspaal",
  subtitle: "Paaldraagvermogen (NEN-EN 1997-1 §7.6)",
  category: "pile",
  icon: "▼",
  norm: "NEN-EN 1997-1:2005+A1:2013+NB:2019",
  status: "experimental",
  defaultInput,
  compute: (input, ctx) => {
    const cpt = input.cptId ? ctx.cpts.get(input.cptId) ?? null : null;
    return computePile(input, cpt);
  },
  InputPanel,
  VisualPanel,
  ResultPanel,
  statusLine: (r) => ({
    text: r.ok ? `u.c. ${r.summary.unityCheck.toFixed(2)} ${r.summary.passes ? "✓" : "✗"}` : `Fout: ${r.error}`,
    ok: r.ok && r.summary.passes,
  }),
};

/** Geëxporteerd als unknown-getypeerde CalcModule zodat hij in
 *  CALC_REGISTRY (CalcModule[]) past — de generieke parameters zijn
 *  contravariant in `compute`/`defaultInput` waardoor TS de strakke
 *  PileInput-versie anders niet accepteert. */
export const pileBearingCapacityModule = pileModuleTyped as unknown as CalcModule;
