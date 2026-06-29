// apps/desktop/src/calc/framework/registry.ts
import type { CalcModule } from "./types";
import { pileBearingCapacityModule } from "../modules/pile-bearing-capacity/module";
import { kalenderingModule } from "../modules/kalendering/module";
import { spreadFoundationDrainedModule } from "../modules/spread-foundation-drained/module";
import { spreadFoundationUndrainedModule } from "../modules/spread-foundation-undrained/module";
import { laterallyLoadedPileModule } from "../modules/laterally-loaded-pile/module";
import { sheetPileWallModule } from "../modules/sheet-pile-wall/module";
import { groundAnchorModule } from "../modules/ground-anchor/module";

/** Productie-gerede modules die PUBLIEK mogen verschijnen. Verplaats een
 *  module hierheen vanuit DEV_ONLY_MODULES om hem vrij te geven. Bewust
 *  expliciet (niet via een status-string) zodat vrijgave een doelbewuste
 *  code-wijziging is, niet een per ongeluk omgezette vlag.
 *
 *  Funderingspaal staat hier weer in op uitdrukkelijk verzoek. Hij houdt
 *  zijn status "experimental": in de UI verschijnt dus de prominente
 *  tussenstand-banner (CalculationsView) + ALPHA-badge (NewCalculation-
 *  Dialog), zodat publiek duidelijk is dat het een in-ontwikkeling-
 *  berekening is en niet geschikt voor toetsing. */
const PUBLIC_MODULES: CalcModule[] = [
  pileBearingCapacityModule,     // vrijgegeven (mét experimental-waarschuwing)
];

/** Modules die nog NIET vrijgegeven zijn (experimental / coming-soon).
 *  Alleen beschikbaar in desktop- en dev-builds. In de publieke webbuild
 *  (VITE_PUBLIC_WEB="1") wordt de tak hieronder die deze lijst gebruikt
 *  weg-ge-tree-shaket door Rollup, zodat de bijbehorende reken- en UI-code
 *  NIET in de publieke bundle terechtkomt (niet alleen onzichtbaar — echt
 *  afwezig). Kalendering blijft hier: niet vrijgeven (gebruikersinstructie). */
const DEV_ONLY_MODULES: CalcModule[] = [
  kalenderingModule,             // ← NIET vrijgeven (expliciete instructie)
  laterallyLoadedPileModule,
  spreadFoundationDrainedModule,
  spreadFoundationUndrainedModule,
  sheetPileWallModule,
  groundAnchorModule,
];

/** live.yml zet VITE_PUBLIC_WEB="1"; Vite vervangt dit statisch waardoor
 *  Rollup de niet-genomen tak (incl. DEV_ONLY_MODULES en al hun imports)
 *  volledig elimineert in de publieke build. */
const IS_PUBLIC_WEB = import.meta.env.VITE_PUBLIC_WEB === "1";

export const CALC_REGISTRY: CalcModule[] = IS_PUBLIC_WEB
  ? PUBLIC_MODULES
  : [...PUBLIC_MODULES, ...DEV_ONLY_MODULES];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
