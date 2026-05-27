// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/InputPanel.tsx
import { useCptStore } from "../../../../store/useCptStore";
import { PILE_TYPE_CATALOG } from "../catalog";
import type { PileInput, PileResult } from "../types";
import "./styles.css";

interface Props {
  input: PileInput;
  result: PileResult;
  onChange?: (next: PileInput) => void;
}

export function InputPanel({ input, onChange }: Props) {
  const cpts = useCptStore((s) => s.cpts);
  const set = <K extends keyof PileInput>(key: K, value: PileInput[K]) => {
    if (!onChange) return;
    onChange({ ...input, [key]: value });
  };

  return (
    <div className="pile-input">
      <fieldset>
        <legend>Sondering</legend>
        <select value={input.cptId ?? ""} onChange={(e) => set("cptId", e.target.value || null)}>
          <option value="">— kies CPT —</option>
          {Array.from(cpts.values()).map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>Paal</legend>
        <label>Type
          <select value={input.pileTypeId} onChange={(e) => set("pileTypeId", e.target.value)}>
            {PILE_TYPE_CATALOG.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>Diameter [mm]<input type="number" value={input.diameterMm} onChange={(e) => set("diameterMm", +e.target.value)} /></label>
        <label>Wanddikte [mm]<input type="number" step="0.1" value={input.wallThicknessMm} onChange={(e) => set("wallThicknessMm", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Paalniveaus [m NAP]</legend>
        <label>Paalkop<input type="number" step="0.01" value={input.pileTopNap} onChange={(e) => set("pileTopNap", +e.target.value)} /></label>
        <label>Paalpunt<input type="number" step="0.01" value={input.pileToeNap} onChange={(e) => set("pileToeNap", +e.target.value)} /></label>
        <label>Water<input type="number" step="0.01" value={input.waterNap} onChange={(e) => set("waterNap", +e.target.value)} /></label>
        <label>Ontgraving<input type="number" step="0.01" value={input.excavationNap} onChange={(e) => set("excavationNap", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Belasting [kN]</legend>
        <label>NEd<input type="number" value={input.nEd} onChange={(e) => set("nEd", +e.target.value)} /></label>
        <label>NEk<input type="number" value={input.nEk} onChange={(e) => set("nEk", +e.target.value)} /></label>
        <label>γm<input type="number" step="0.01" value={input.gammaM} onChange={(e) => set("gammaM", +e.target.value)} /></label>
        <label>γf,nk<input type="number" step="0.01" value={input.gammaFnk} onChange={(e) => set("gammaFnk", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Negatieve kleef</legend>
        <label>Onderkant zone [m NAP]
          <input type="number" step="0.01" value={input.negKleefBottomNap} onChange={(e) => set("negKleefBottomNap", +e.target.value)} />
        </label>
        <label>K0·tan(δ) minimum<input type="number" step="0.01" value={input.ksMinFactor} onChange={(e) => set("ksMinFactor", +e.target.value)} /></label>
        {/* Soil layers editor — v2 */}
      </fieldset>

      <fieldset>
        <legend>Positieve kleef</legend>
        <label>Bovenkant traject [m NAP]
          {/* Default = neg-kleef-ondergrens (pos-kleef begint waar neg-kleef
              ophoudt). Engineer kan dit ONAFHANKELIJK omlaag zetten als er
              een zwakke laag in een tussenstuk zit. Ondergrens van pos-kleef
              is altijd paalpunt (vast). */}
          <input
            type="number"
            step="0.01"
            value={input.posKleefTopNap ?? input.negKleefBottomNap}
            onChange={(e) => set("posKleefTopNap", +e.target.value)}
          />
        </label>
      </fieldset>
    </div>
  );
}
