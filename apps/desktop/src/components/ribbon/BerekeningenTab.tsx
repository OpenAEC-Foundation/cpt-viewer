import { useMemo } from "react";
import { useCalculationsStore } from "../../calc/framework/store";
import { useCptStore } from "../../store/useCptStore";
import type { CalculationInstance } from "../../calc/framework/types";

// Stabiele empty-array fallback om de zustand re-render loop te
// voorkomen die `?? []` binnen een selector veroorzaakt.
const EMPTY_LIST: readonly never[] = [];

/** Ribbon-tab content voor "Berekeningen". Toont een knop "+ Nieuwe
 *  berekening" + lijst van bestaande berekeningen in het actieve
 *  project (snel-selecteer). */
export function BerekeningenTab() {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const byDoc = useCalculationsStore((s) => s.byDoc);
  const list = useMemo(
    () => (activeDocId ? byDoc.get(activeDocId) ?? EMPTY_LIST : EMPTY_LIST),
    [activeDocId, byDoc],
  ) as CalculationInstance[];
  const setActive = useCalculationsStore((s) => s.setActive);

  return (
    <div className="ribbon-content ribbon-berekeningen">
      <button
        className="ribbon-btn ribbon-btn-primary"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("ogs:open-new-calc"));
        }}
      >
        + Nieuwe berekening
      </button>
      <div className="ribbon-divider" />
      <div className="ribbon-calc-list">
        {list.length === 0 && (
          <span className="ribbon-empty">Nog geen berekeningen</span>
        )}
        {list.map((c) => (
          <button
            key={c.id}
            className="ribbon-btn ribbon-btn-tab"
            onClick={() => setActive(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
