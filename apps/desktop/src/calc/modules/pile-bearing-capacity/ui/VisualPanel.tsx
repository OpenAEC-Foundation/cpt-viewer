// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/VisualPanel.tsx
import { useCptStore } from "../../../../store/useCptStore";
import type { PanelProps } from "../../../framework/types";
import type { PileInput, PileResult } from "../types";

export function VisualPanel({ input, result }: PanelProps<PileInput, PileResult>) {
  const cpt = useCptStore((s) => (input.cptId ? s.cpts.get(input.cptId) : null));
  if (!cpt) {
    return <div className="pile-visual-empty">Geen sondering geselecteerd</div>;
  }
  return (
    <div className="pile-visual">
      <h3>Sondering: {cpt.id}</h3>
      <table>
        <tbody>
          <tr><th>Paalkop</th><td>NAP {input.pileTopNap.toFixed(2)} m</td></tr>
          <tr><th>Paalpunt</th><td>NAP {input.pileToeNap.toFixed(2)} m</td></tr>
          <tr><th>Neg. kleef tot</th><td>NAP {input.negKleefBottomNap.toFixed(2)} m (ΔL={result.negKleef.deltaLnk.toFixed(1)} m)</td></tr>
          <tr><th>F<sub>nk;d</sub></th><td>{result.negKleef.fnkD.toFixed(0)} kN</td></tr>
          <tr><th>R<sub>s;cal;max</sub></th><td>{result.shaft.rsCalMax.toFixed(0)} kN</td></tr>
          <tr><th>R<sub>b;cal;max</sub></th><td>{result.base.rbCalMax.toFixed(0)} kN</td></tr>
        </tbody>
      </table>
      <p style={{ color: "#888", fontSize: "12px", marginTop: "20px" }}>
        Volledige CPT-chart met overlays komt in iteratie 2.
      </p>
    </div>
  );
}
