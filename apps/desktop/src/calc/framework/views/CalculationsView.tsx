import { useEffect, useMemo, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useCalculationsStore } from "../store";
import { getCalcModule } from "../registry";
import { useCptStore } from "../../../store/useCptStore";
import { ComingSoonPanel } from "./ComingSoonPanel";
import { ProjectTreePanel } from "./ProjectTreePanel";
import { NewCalculationDialog } from "./NewCalculationDialog";
import type { ProjectContext } from "../types";
import "./CalculationsView.css";

/** Min/max breedte voor de zij-panelen (px). */
const PANE_MIN = 200;
const PANE_MAX = 600;
const LS_KEY_LEFT = "calc.leftPaneW";
const LS_KEY_INPUT = "calc.inputPaneW";
const LS_KEY_RIGHT = "calc.rightPaneW";

function loadPaneWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(PANE_MIN, Math.min(PANE_MAX, n));
  } catch {
    return fallback;
  }
}
function savePaneWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore — private-browsing of quota */
  }
}

/**
 * Top-level werkruimte voor de Berekeningen-tab. Toont een **4-pane**
 * layout conform Open Calculation Studio:
 *
 *   ┌──────────────┬─────────────┬──────────────────┬──────────────┐
 *   │ Verkenner    │ Invoer      │ Sondering        │ Uitkomsten   │
 *   │ (project-    │ (InputPanel │ (CPT-chart +     │ (ResultPanel │
 *   │  tree, calc- │  per actieve│  paal-elevation) │  formules +  │
 *   │  instances)  │  module)    │                  │  zakkings)   │
 *   └──────────────┴─────────────┴──────────────────┴──────────────┘
 *
 * Invoer-paneel staat DIRECT LINKS van de sondering — zo werkt de
 * gebruiker linksom (verkenner → invoer → visualisatie sondering →
 * uitkomsten). Alle drie de zij-panelen zijn resizable.
 */
export function CalculationsView() {
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

  // Resizable splitter-states — geladen uit localStorage zodat de
  // voorkeur tussen sessies bewaard blijft.
  const [leftWidth, setLeftWidth] = useState<number>(() =>
    loadPaneWidth(LS_KEY_LEFT, 260),
  );
  const [inputWidth, setInputWidth] = useState<number>(() =>
    loadPaneWidth(LS_KEY_INPUT, 300),
  );
  const [rightWidth, setRightWidth] = useState<number>(() =>
    loadPaneWidth(LS_KEY_RIGHT, 380),
  );

  useEffect(() => savePaneWidth(LS_KEY_LEFT, leftWidth), [leftWidth]);
  useEffect(() => savePaneWidth(LS_KEY_INPUT, inputWidth), [inputWidth]);
  useEffect(() => savePaneWidth(LS_KEY_RIGHT, rightWidth), [rightWidth]);

  useEffect(() => {
    const onOpen = () => setShowNewDialog(true);
    window.addEventListener("ogs:open-new-calc", onOpen);
    return () => window.removeEventListener("ogs:open-new-calc", onOpen);
  }, []);

  // ─── Splitter drag-handlers ───────────────────────────────────────
  // Generieke factory zodat we niet 3x dezelfde boilerplate hebben.
  // `delta` is +1 als rechts-slepen het paneel vergroot, -1 voor verkleinen.
  const makeDragHandler = (
    setter: (n: number) => void,
    currentValue: number,
    delta: 1 | -1,
  ) => (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = currentValue;
    const onMove = (m: MouseEvent) => {
      const newW = Math.max(
        PANE_MIN,
        Math.min(PANE_MAX, startW + delta * (m.clientX - startX)),
      );
      setter(newW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleLeftDrag = makeDragHandler(setLeftWidth, leftWidth, +1);
  // Input zit nu LINKS van de sondering — rechts slepen = input vergroten.
  const handleInputDrag = makeDragHandler(setInputWidth, inputWidth, +1);
  const handleRightDrag = makeDragHandler(setRightWidth, rightWidth, -1);

  const ctx: ProjectContext = useMemo(
    () => ({ cpts, activeCptId, projectMeta }),
    [cpts, activeCptId, projectMeta],
  );

  // Compute mid / input / right panel content per branch.
  let midContent: ReactNode;
  let inputContent: ReactNode = null;
  let rightContent: ReactNode = null;
  let showExperimentalBanner = false;

  if (!active) {
    midContent = (
      <div className="calc-empty-state">
        <p>Geen berekening geselecteerd.</p>
        <p className="calc-empty-hint">
          Maak een nieuwe berekening via "+" in de verkenner links.
        </p>
      </div>
    );
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
    } else if (mod.status === "coming-soon") {
      midContent = <ComingSoonPanel module={mod} />;
      rightContent = <ComingSoonPanel module={mod} />;
    } else {
      const input = active.instance.input as never;
      const result = mod.compute(input, ctx) as never;
      const onChange = (next: unknown) => {
        useCalculationsStore.getState().updateCalculation(
          active.docId,
          active.instance.id,
          { input: next },
        );
      };
      midContent = <mod.VisualPanel input={input} result={result} onChange={onChange} />;
      inputContent = (
        <>
          <h3 className="calc-pane-title">{mod.name}</h3>
          <mod.InputPanel input={input} result={result} onChange={onChange} />
        </>
      );
      rightContent = <mod.ResultPanel input={input} result={result} />;
      showExperimentalBanner = mod.status === "experimental";
    }
  }

  return (
    <div
      className={`calc-view${showExperimentalBanner ? " calc-view--experimental" : ""}`}
      style={{
        ["--calc-left-w" as never]: `${leftWidth}px`,
        ["--calc-input-w" as never]: `${inputWidth}px`,
        ["--calc-right-w" as never]: `${rightWidth}px`,
      }}
    >
      {showExperimentalBanner && (
        <div className="calc-experimental-banner" role="alert">
          <strong>⚠ CONCEPT — IN ONTWIKKELING.</strong>
          &nbsp;De getoonde resultaten zijn indicatief en mogen niet
          worden gebruikt voor toetsing bij vergunning of uitvoering.
        </div>
      )}
      {/* ─── 1. Verkenner — project-tree met alle berekeningen ─── */}
      <aside className="calc-pane calc-pane-left">
        <ProjectTreePanel onAddClick={() => setShowNewDialog(true)} />
      </aside>
      <div
        className="calc-splitter"
        onMouseDown={handleLeftDrag}
        role="separator"
        aria-orientation="vertical"
        aria-label="Verkenner breedte aanpassen"
        title="Sleep om de paneel-breedte aan te passen"
      />

      {/* ─── 2. Invoer — InputPanel per actieve module (LINKS van sondering) ─── */}
      <aside className="calc-pane calc-pane-input">{inputContent}</aside>
      <div
        className="calc-splitter"
        onMouseDown={handleInputDrag}
        role="separator"
        aria-orientation="vertical"
        aria-label="Invoer paneel breedte aanpassen"
        title="Sleep om de paneel-breedte aan te passen"
      />

      {/* ─── 3. Sondering — CPT-chart + paal-elevation ─── */}
      <main className="calc-pane calc-pane-mid">{midContent}</main>
      <div
        className="calc-splitter"
        onMouseDown={handleRightDrag}
        role="separator"
        aria-orientation="vertical"
        aria-label="Uitkomsten paneel breedte aanpassen"
        title="Sleep om de paneel-breedte aan te passen"
      />

      {/* ─── 4. Uitkomsten — ResultPanel met formules + zakkings ─── */}
      <aside className="calc-pane calc-pane-right">{rightContent}</aside>

      <NewCalculationDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
      />
    </div>
  );
}
