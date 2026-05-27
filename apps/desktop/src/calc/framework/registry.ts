import type { CalcModule } from "./types";

/**
 * Single source of truth voor alle calc-modules. Modules registreren
 * zichzelf hier via een import + entry. Volgorde bepaalt de UI-volgorde
 * in de "Nieuwe berekening"-dialog.
 *
 * Voor v1 begint deze leeg — modules worden toegevoegd in latere tasks.
 * De smoke-test in registry.test.ts gebruikt een lokale dummy zodat
 * deze file niet altijd modules nodig heeft om te valideren.
 */
export const CALC_REGISTRY: CalcModule[] = [];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
