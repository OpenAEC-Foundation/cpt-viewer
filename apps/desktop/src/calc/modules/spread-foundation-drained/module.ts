// apps/desktop/src/calc/modules/spread-foundation-drained/module.ts
//
// ⚠ ALPHA — nog in ontwikkeling. Niet productie-gereed: de berekening
//   is nog niet geverifieerd tegen norm-uitwerkingen en mag niet worden
//   gebruikt voor toetsing bij vergunning of uitvoering. Module is
//   hard-disabled via NOT_PRODUCTION_READY in useExtensions.ts.
//
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const spreadFoundationDrainedModule = makeComingSoonModule({
  id: "spread-foundation-drained",
  name: "Fundering op staal — gedraineerd",
  subtitle: "Bezwijken gedraineerde grond (NEN-EN 1997-1 §6.5.2)",
  category: "spread",
  icon: "▭",
  norm: "NEN-EN 1997-1 §6.5",
});
