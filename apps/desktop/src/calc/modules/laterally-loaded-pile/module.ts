// apps/desktop/src/calc/modules/laterally-loaded-pile/module.ts
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const laterallyLoadedPileModule = makeComingSoonModule({
  id: "laterally-loaded-pile",
  name: "Horizontaal belaste paal",
  subtitle: "Dwarsbelasting + buigmoment in de paal",
  category: "pile",
  icon: "↔",
  norm: "CUR 166 / NEN 9997-1 §7.7",
});
