// apps/desktop/src/calc/modules/ground-anchor/module.ts
//
// ⚠ ALPHA — nog in ontwikkeling. Niet productie-gereed: de berekening
//   is nog niet geverifieerd tegen norm-uitwerkingen en mag niet worden
//   gebruikt voor toetsing bij vergunning of uitvoering. Module is
//   hard-disabled via NOT_PRODUCTION_READY in useExtensions.ts.
//
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const groundAnchorModule = makeComingSoonModule({
  id: "ground-anchor",
  name: "Groutanker",
  subtitle: "Ankertrekproef + voorspanning",
  category: "anchor",
  icon: "⚓",
  norm: "EN 1537 / NEN-EN 1997-1 §8",
});
