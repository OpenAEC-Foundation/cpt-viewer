// apps/desktop/src/calc/modules/spread-foundation-undrained/module.ts
//
// ⚠ ALPHA — nog in ontwikkeling. Niet productie-gereed: de berekening
//   is nog niet geverifieerd tegen norm-uitwerkingen en mag niet worden
//   gebruikt voor toetsing bij vergunning of uitvoering. Module is
//   hard-disabled via NOT_PRODUCTION_READY in useExtensions.ts.
//
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const spreadFoundationUndrainedModule = makeComingSoonModule({
  id: "spread-foundation-undrained",
  name: "Fundering op staal — ongedraineerd",
  subtitle: "Bezwijken ongedraineerde grond (NEN-EN 1997-1 §6.5.2)",
  category: "spread",
  icon: "▭",
  norm: "NEN-EN 1997-1 §6.5",
});
