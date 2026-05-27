import { useMemo } from "react";
import { useCalculationsStore } from "../store";
import { getCalcModule } from "../registry";
import { useCptStore } from "../../../store/useCptStore";
import { ComingSoonPanel } from "./ComingSoonPanel";
import type { ProjectContext } from "../types";
import "./CalculationsView.css";

/**
 * Top-level werkruimte voor de Berekeningen-tab. Toont een 3-pane
 * layout: library + input links, visualisatie midden, uitvoer rechts.
 * Module-specifieke panelen worden via de CalcModule's InputPanel /
 * VisualPanel / ResultPanel exports geleverd.
 */
export function CalculationsView() {
  const active = useCalculationsStore((s) => s.getActive());
  const cpts = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const projectMeta = useCptStore((s) => s.projectMeta);

  const ctx: ProjectContext = useMemo(
    () => ({ cpts, activeCptId, projectMeta }),
    [cpts, activeCptId, projectMeta],
  );

  if (!active) {
    return (
      <div className="calc-view calc-view-empty">
        <div className="calc-empty-state">
          <p>Geen berekening geselecteerd.</p>
          <p className="calc-empty-hint">
            Maak een nieuwe berekening via "+" in het project-paneel.
          </p>
        </div>
      </div>
    );
  }

  const mod = getCalcModule(active.instance.moduleId);
  if (!mod) {
    return (
      <div className="calc-view calc-view-empty">
        <div className="calc-empty-state">
          <p>Onbekend module-type: <code>{active.instance.moduleId}</code></p>
        </div>
      </div>
    );
  }

  // Coming-soon: korte placeholder in plaats van échte berekening
  if (mod.status === "coming-soon") {
    return (
      <div className="calc-view">
        <aside className="calc-pane calc-pane-left">
          <h3 className="calc-pane-title">Project</h3>
          <p className="calc-empty-hint">Library volgt — Task 7</p>
        </aside>
        <main className="calc-pane calc-pane-mid">
          <ComingSoonPanel module={mod} />
        </main>
        <aside className="calc-pane calc-pane-right">
          <ComingSoonPanel module={mod} />
        </aside>
      </div>
    );
  }

  // Available module: render de drie module-specifieke panelen
  const input = active.instance.input as never;
  const result = mod.compute(input, ctx) as never;
  const onChange = (next: unknown) => {
    useCalculationsStore.getState().updateCalculation(
      active.docId,
      active.instance.id,
      { input: next },
    );
  };

  return (
    <div className="calc-view">
      <aside className="calc-pane calc-pane-left">
        <h3 className="calc-pane-title">{mod.name}</h3>
        <mod.InputPanel input={input} result={result} onChange={onChange} />
      </aside>
      <main className="calc-pane calc-pane-mid">
        <mod.VisualPanel input={input} result={result} />
      </main>
      <aside className="calc-pane calc-pane-right">
        <mod.ResultPanel input={input} result={result} />
      </aside>
    </div>
  );
}
