import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCalculationsStore } from "../store";
import { getCalcModule } from "../registry";
import { useCptStore } from "../../../store/useCptStore";
import { ComingSoonPanel } from "./ComingSoonPanel";
import { ProjectTreePanel } from "./ProjectTreePanel";
import { NewCalculationDialog } from "./NewCalculationDialog";
import type { ProjectContext } from "../types";
import "./CalculationsView.css";

/**
 * Top-level werkruimte voor de Berekeningen-tab. Toont een 3-pane
 * layout: library + input links, visualisatie midden, uitvoer rechts.
 * Module-specifieke panelen worden via de CalcModule's InputPanel /
 * VisualPanel / ResultPanel exports geleverd.
 *
 * Het linker-paneel toont altijd de `<ProjectTreePanel />` (library
 * van calc-instances binnen het actieve project). Onder de tree
 * verschijnt — voor zover van toepassing — de module-specifieke
 * `<InputPanel />`. Mid en rechter paneel reageren op de geselecteerde
 * berekening: leeg-state, coming-soon placeholder of de module-eigen
 * Visual/Result panelen.
 */
export function CalculationsView() {
  // Subscribe naar PRIMITIEVE velden — `getActive()` als selector
  // levert elke render een nieuw {docId, instance}-object op waardoor
  // zustand een infinite re-render loop triggert. We pakken de bron-
  // velden los op en bouwen `active` zelf met useMemo.
  const activeCalcId = useCalculationsStore((s) => s.activeCalcId);
  const byDoc = useCalculationsStore((s) => s.byDoc);
  const active = useMemo(() => {
    if (!activeCalcId) return null;
    for (const [docId, list] of byDoc) {
      const inst = list.find((c) => c.id === activeCalcId);
      if (inst) return { docId, instance: inst };
    }
    return null;
  }, [activeCalcId, byDoc]);

  const cpts = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const projectMeta = useCptStore((s) => s.projectMeta);

  const [showNewDialog, setShowNewDialog] = useState(false);

  // De Berekeningen-ribbon-tab dispatcht `ogs:open-new-calc` zodat de
  // "+ Nieuwe berekening"-knop daar — buiten dit component — toch deze
  // dialog opent. Voorkomt prop-drilling tussen Ribbon en CalculationsView.
  useEffect(() => {
    const onOpen = () => setShowNewDialog(true);
    window.addEventListener("ogs:open-new-calc", onOpen);
    return () => window.removeEventListener("ogs:open-new-calc", onOpen);
  }, []);

  const ctx: ProjectContext = useMemo(
    () => ({ cpts, activeCptId, projectMeta }),
    [cpts, activeCptId, projectMeta],
  );

  // Compute left-(below-tree), mid, right panel content per branch.
  let leftBelowTree: ReactNode = null;
  let midContent: ReactNode;
  let rightContent: ReactNode;

  if (!active) {
    midContent = (
      <div className="calc-empty-state">
        <p>Geen berekening geselecteerd.</p>
        <p className="calc-empty-hint">
          Maak een nieuwe berekening via "+" in het project-paneel.
        </p>
      </div>
    );
    rightContent = null;
  } else {
    const mod = getCalcModule(active.instance.moduleId);
    if (!mod) {
      midContent = (
        <div className="calc-empty-state">
          <p>
            Onbekend module-type: <code>{active.instance.moduleId}</code>
          </p>
        </div>
      );
      rightContent = null;
    } else if (mod.status === "coming-soon") {
      midContent = <ComingSoonPanel module={mod} />;
      rightContent = <ComingSoonPanel module={mod} />;
    } else {
      // Available module — render alle drie de module-specifieke panelen.
      const input = active.instance.input as never;
      const result = mod.compute(input, ctx) as never;
      const onChange = (next: unknown) => {
        useCalculationsStore.getState().updateCalculation(
          active.docId,
          active.instance.id,
          { input: next },
        );
      };
      leftBelowTree = (
        <>
          <h3 className="calc-pane-title">{mod.name}</h3>
          <mod.InputPanel input={input} result={result} onChange={onChange} />
        </>
      );
      midContent = <mod.VisualPanel input={input} result={result} />;
      rightContent = <mod.ResultPanel input={input} result={result} />;
    }
  }

  return (
    <div className="calc-view">
      <aside className="calc-pane calc-pane-left">
        <ProjectTreePanel onAddClick={() => setShowNewDialog(true)} />
        {leftBelowTree}
      </aside>
      <main className="calc-pane calc-pane-mid">{midContent}</main>
      <aside className="calc-pane calc-pane-right">{rightContent}</aside>
      <NewCalculationDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
      />
    </div>
  );
}
