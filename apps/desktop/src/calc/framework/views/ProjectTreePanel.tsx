import { useMemo, useState } from "react";
import { useCalculationsStore } from "../store";
import { useCptStore } from "../../../store/useCptStore";
import { getCalcModule } from "../registry";
import type { CalculationInstance } from "../types";

interface Props {
  onAddClick: () => void;
}

/** Library-tree per actief project — lijst van calc-instances. */
// Stabiele referentie voor de empty-array fallback — als we `?? []`
// binnen een zustand-selector returnen, krijgt zustand elke render een
// nieuwe array-referentie en triggert dat een infinite re-render loop.
const EMPTY_LIST: readonly never[] = [];

export function ProjectTreePanel({ onAddClick }: Props) {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeCalcId = useCalculationsStore((s) => s.activeCalcId);
  // Subscribe naar byDoc als geheel (stabiele Map-referentie), derive
  // de lijst via useMemo. Voorheen: nieuwe `[]` op elke selector-call
  // → zustand re-render loop.
  const byDoc = useCalculationsStore((s) => s.byDoc);
  const list = useMemo(
    () => (activeDocId ? byDoc.get(activeDocId) ?? EMPTY_LIST : EMPTY_LIST),
    [activeDocId, byDoc],
  ) as CalculationInstance[];
  const setActive = useCalculationsStore((s) => s.setActive);
  const remove = useCalculationsStore((s) => s.removeCalculation);
  const duplicate = useCalculationsStore((s) => s.duplicate);
  const update = useCalculationsStore((s) => s.updateCalculation);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  if (!activeDocId) {
    return (
      <div className="calc-tree-empty">
        <p>Open een project om berekeningen toe te voegen.</p>
      </div>
    );
  }

  // Group per category
  const grouped = list.reduce<Record<string, CalculationInstance[]>>((acc, c) => {
    const mod = getCalcModule(c.moduleId);
    const cat = mod?.category ?? "other";
    (acc[cat] = acc[cat] ?? []).push(c);
    return acc;
  }, {});

  const categoryNames: Record<string, string> = {
    pile: "Palen",
    spread: "Funderingen",
    wall: "Wanden",
    anchor: "Ankers",
    other: "Overig",
  };

  return (
    <div className="calc-tree">
      <button className="calc-tree-add" onClick={onAddClick}>
        + Nieuwe berekening
      </button>

      {list.length === 0 && (
        <p className="calc-tree-empty-hint">
          Nog geen berekeningen. Klik op "+" om er een toe te voegen.
        </p>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="calc-tree-group">
          <div className="calc-tree-group-title">{categoryNames[cat] ?? cat}</div>
          <ul>
            {items.map((c) => {
              const mod = getCalcModule(c.moduleId);
              const isActive = c.id === activeCalcId;
              const isRenaming = renaming === c.id;
              return (
                <li key={c.id} className={isActive ? "active" : ""}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => {
                        if (draftName.trim()) {
                          update(activeDocId, c.id, { name: draftName.trim() });
                        }
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      className="calc-tree-item"
                      onClick={() => setActive(c.id)}
                      onDoubleClick={() => {
                        setRenaming(c.id);
                        setDraftName(c.name);
                      }}
                      title={`${mod?.name ?? c.moduleId} — ${c.updatedAt}`}
                    >
                      <span className="calc-tree-item-name">{c.name}</span>
                      {mod?.status === "coming-soon" && (
                        <span className="calc-tree-badge">🔜</span>
                      )}
                    </button>
                  )}
                  <div className="calc-tree-actions">
                    <button
                      onClick={() => duplicate(activeDocId, c.id)}
                      title="Dupliceren"
                    >
                      ⎘
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Verwijder "${c.name}"?`)) {
                          remove(activeDocId, c.id);
                        }
                      }}
                      title="Verwijderen"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
