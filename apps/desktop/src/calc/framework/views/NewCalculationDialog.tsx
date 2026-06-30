import { useState, useMemo } from "react";
import { CALC_REGISTRY } from "../registry";
import { useCalculationsStore } from "../store";
import { useCptStore } from "../../../store/useCptStore";
import type { CalcCategory } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<CalcCategory, string> = {
  pile: "Palen",
  spread: "Funderingen",
  wall: "Wanden",
  anchor: "Ankers",
};

export function NewCalculationDialog({ open, onClose }: Props) {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const projectMeta = useCptStore((s) => s.projectMeta);
  const cpts = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const addCalc = useCalculationsStore((s) => s.addCalculation);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const grouped = useMemo(() => {
    const g: Record<string, typeof CALC_REGISTRY> = {};
    for (const m of CALC_REGISTRY) {
      (g[m.category] = g[m.category] ?? []).push(m);
    }
    return g;
  }, []);

  if (!open) return null;

  const handleAdd = () => {
    if (!selectedId || !activeDocId) return;
    const mod = CALC_REGISTRY.find((m) => m.id === selectedId);
    if (!mod) return;
    const ctx = { cpts, activeCptId, projectMeta };
    const input = mod.defaultInput(ctx);
    const finalName = name.trim() || `${mod.name} ${Date.now().toString(36).slice(-4)}`;
    // Atomic: input meegeven aan addCalculation in plaats van een aparte
    // updateCalc-aanroep. Met de oude 2-step (addCalc → updateCalc) was
    // er een korte tussenstand waarin `instance.input === {}` was, en
    // module-componenten die meteen renderden (VisualPanel/ResultPanel)
    // op `input.<veld>.toFixed()` crashten zonder defaults.
    addCalc(activeDocId, mod.id, finalName, input);
    onClose();
  };

  return (
    <div className="calc-modal-backdrop" onClick={onClose}>
      <div className="calc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="calc-modal-header">
          <h2>Nieuwe berekening</h2>
          <button className="calc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="calc-modal-body">
          <label className="calc-modal-field">
            <span>Naam</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bv. Hoofdgebouw paalfundering"
            />
          </label>

          <div className="calc-modal-modules">
            {(Object.keys(CATEGORY_LABELS) as CalcCategory[]).map((cat) => (
              <div key={cat} className="calc-modal-category">
                <div className="calc-modal-category-title">{CATEGORY_LABELS[cat]}</div>
                {(grouped[cat] ?? []).map((m) => (
                  <label key={m.id} className="calc-modal-module">
                    <input
                      type="radio"
                      name="module"
                      value={m.id}
                      checked={selectedId === m.id}
                      onChange={() => setSelectedId(m.id)}
                    />
                    <div className="calc-modal-module-text">
                      <div>
                        <strong>{m.name}</strong>
                        {m.status === "coming-soon" && (
                          <span className="calc-modal-alpha" title="Alpha — nog in ontwikkeling, niet productie-gereed">
                            {" "}CONCEPT — in ontwikkeling
                          </span>
                        )}
                        {m.status === "experimental" && (
                          <span className="calc-modal-alpha" title="Alpha — nog in ontwikkeling, niet productie-gereed">
                            {" "}CONCEPT — in ontwikkeling
                          </span>
                        )}
                      </div>
                      <small>{m.norm}</small>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="calc-modal-footer">
          <button onClick={onClose}>Annuleren</button>
          <button
            className="primary"
            disabled={!selectedId || !activeDocId}
            onClick={handleAdd}
          >
            Toevoegen
          </button>
        </div>
      </div>
    </div>
  );
}
