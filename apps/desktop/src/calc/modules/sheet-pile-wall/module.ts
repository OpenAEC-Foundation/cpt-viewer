// apps/desktop/src/calc/modules/sheet-pile-wall/module.ts
//
// ⚠ ALPHA — nog in ontwikkeling. Niet productie-gereed: de berekening
//   is nog niet geverifieerd tegen norm-uitwerkingen en mag niet worden
//   gebruikt voor toetsing bij vergunning of uitvoering. Module is
//   hard-disabled via NOT_PRODUCTION_READY in useExtensions.ts.
//
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const sheetPileWallModule = makeComingSoonModule({
  id: "sheet-pile-wall",
  name: "Damwandberekening",
  subtitle: "Gronddruk + buigmoment + zakking",
  category: "wall",
  icon: "▌",
  norm: "CUR 166 / NEN-EN 1997-1 §9",
});
