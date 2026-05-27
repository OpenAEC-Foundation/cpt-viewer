// apps/desktop/src/calc/framework/comingSoonModule.tsx
import type { ReactNode } from "react";
import type { CalcModule, CalcCategory, PanelProps } from "./types";
import { ComingSoonPanel } from "./views/ComingSoonPanel";

/** Factory voor een placeholder-module. Render-functies wijzen naar
 *  ComingSoonPanel zodat de UI in alle drie de panelen consistent
 *  een "🔜 Wordt gebouwd"-melding toont. */
export function makeComingSoonModule(opts: {
  id: string;
  name: string;
  subtitle: string;
  category: CalcCategory;
  icon: ReactNode;
  norm: string;
}): CalcModule {
  const wrap = (props: PanelProps<unknown, unknown>) => {
    void props;
    return <ComingSoonPanel module={mod} />;
  };
  const mod: CalcModule = {
    ...opts,
    status: "coming-soon",
    defaultInput: () => ({}),
    compute: () => ({}),
    InputPanel: wrap,
    VisualPanel: wrap,
    ResultPanel: wrap,
  };
  return mod;
}
