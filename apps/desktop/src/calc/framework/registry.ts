// apps/desktop/src/calc/framework/registry.ts
import type { CalcModule } from "./types";
import { pileBearingCapacityModule } from "../modules/pile-bearing-capacity/module";
import { kalenderingModule } from "../modules/kalendering/module";
import { spreadFoundationDrainedModule } from "../modules/spread-foundation-drained/module";
import { spreadFoundationUndrainedModule } from "../modules/spread-foundation-undrained/module";
import { laterallyLoadedPileModule } from "../modules/laterally-loaded-pile/module";
import { sheetPileWallModule } from "../modules/sheet-pile-wall/module";
import { groundAnchorModule } from "../modules/ground-anchor/module";

export const CALC_REGISTRY: CalcModule[] = [
  pileBearingCapacityModule,     // ← experimental, in actieve ontwikkeling
  kalenderingModule,             // ← experimental, in actieve ontwikkeling
  laterallyLoadedPileModule,
  spreadFoundationDrainedModule,
  spreadFoundationUndrainedModule,
  sheetPileWallModule,
  groundAnchorModule,
];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
