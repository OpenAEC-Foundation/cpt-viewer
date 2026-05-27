// apps/desktop/src/calc/modules/sheet-pile-wall/module.ts
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const sheetPileWallModule = makeComingSoonModule({
  id: "sheet-pile-wall",
  name: "Damwandberekening",
  subtitle: "Gronddruk + buigmoment + zakking",
  category: "wall",
  icon: "▌",
  norm: "CUR 166 / NEN-EN 1997-1 §9",
});
