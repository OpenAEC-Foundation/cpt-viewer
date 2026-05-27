// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/ResultPanel.tsx
import type { PanelProps } from "../../../framework/types";
import type { PileInput, PileResult } from "../types";

export function ResultPanel({ result }: PanelProps<PileInput, PileResult>) {
  if (!result.ok) {
    return <div className="pile-result-error">⚠️ {result.error}</div>;
  }
  const { negKleef, base, shaft, settlement, spring, summary } = result;
  return (
    <div className="pile-result">
      {result.warnings.length > 0 && (
        <div className="pile-warnings">
          {result.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      <section>
        <h3>Negatieve kleef</h3>
        <table className="pile-formula-table">
          <thead><tr><th>Laag</th><th>σ·Os·K₀tanδ</th><th>F<sub>s;nk</sub></th></tr></thead>
          <tbody>
            {negKleef.layers.map((l, i) => (
              <tr key={i}>
                <td>{l.layer.kind}</td>
                <td>{l.sigmaGemRep.toFixed(1)} · {l.k0TanDelta.toFixed(3)}</td>
                <td><strong>{l.fsNkRep.toFixed(1)} kN</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>F<sub>nk;d</sub> = γ<sub>f,nk</sub> · ΣF<sub>s;nk</sub> = <strong>{negKleef.fnkD.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Puntdraagvermogen</h3>
        <p>q<sub>c;I;gem</sub> = {base.qcIGemMpa.toFixed(2)} MPa, q<sub>c;II;gem</sub> = {base.qcIIGemMpa.toFixed(2)}, q<sub>c;III;gem</sub> = {base.qcIIIGemMpa.toFixed(2)}</p>
        <p>q<sub>b;max</sub> = {base.qbMaxMpa.toFixed(2)} MPa {base.qbMaxMpaRaw > 15 && "(gecapt op 15)"}</p>
        <p>R<sub>b;cal;max</sub> = A<sub>b</sub> · q<sub>b;max</sub> = <strong>{base.rbCalMax.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Maximumschachtwrijving</h3>
        <p>R<sub>s;cal;max</sub> = <strong>{shaft.rsCalMax.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Maximum gronddraagvermogen</h3>
        <p>R<sub>c;cal</sub> = <strong>{summary.rcCal.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Zakking</h3>
        <p>SLS: s<sub>b</sub>={settlement.sls.sbMm.toFixed(1)} mm, s<sub>1</sub>={settlement.sls.s1Mm.toFixed(1)} mm</p>
        <p>ULS: s<sub>b</sub>={settlement.uls.sbMm.toFixed(1)} mm, s<sub>1</sub>={settlement.uls.s1Mm.toFixed(1)} mm</p>
      </section>

      <section>
        <h3>Veerwaarde</h3>
        <p>k<sub>SLS</sub> = <strong>{spring.kSlsKnPerM.toFixed(0)} kN/m</strong></p>
        <p>k<sub>min</sub> = {spring.kMinKnPerM.toFixed(0)} / k<sub>max</sub> = {spring.kMaxKnPerM.toFixed(0)} kN/m</p>
      </section>

      <section>
        <h3>Samenvatting</h3>
        <p>R<sub>c;d</sub> = {summary.rcD.toFixed(0)} kN</p>
        <p>R<sub>c;net;d</sub> = {summary.rcNetD.toFixed(0)} kN</p>
        <p className={summary.passes ? "pile-pass" : "pile-fail"}>
          Unity check: N<sub>Ed</sub> / R<sub>c;net;d</sub> = <strong>{summary.unityCheck.toFixed(2)}</strong>
          {summary.passes ? " ✓ voldoet" : " ✗ voldoet NIET"}
        </p>
      </section>
    </div>
  );
}
