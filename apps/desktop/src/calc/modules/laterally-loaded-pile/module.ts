// apps/desktop/src/calc/modules/laterally-loaded-pile/module.ts
//
// ⚠ ALPHA — nog in ontwikkeling. Niet productie-gereed: de berekening
//   is nog niet geverifieerd tegen norm-uitwerkingen en mag niet worden
//   gebruikt voor toetsing bij vergunning of uitvoering. Module is
//   hard-disabled via NOT_PRODUCTION_READY in useExtensions.ts.
//
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const laterallyLoadedPileModule = makeComingSoonModule({
  id: "laterally-loaded-pile",
  name: "Horizontaal belaste paal",
  subtitle: "Dwarsbelasting + buigmoment in de paal",
  category: "pile",
  icon: "↔",
  norm: "CUR 166 / NEN 9997-1 §7.7",
});
