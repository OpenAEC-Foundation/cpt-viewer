// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/ResultPanel.tsx
import { useMemo } from "react";
import type { PanelProps } from "../../../framework/types";
import type { PileInput, PileResult, SettlementResult } from "../types";
import "./styles.css";

// ─── Zakkingsdiagram ─────────────────────────────────────────────
// Compact SVG plot — totalKn (x) vs sbMm (y, positive going down).
// Two horizontal reference lines for SLS + ULS workpoints.

const ZK_W = 280;
const ZK_H = 220;
const ZK_M = { top: 24, right: 12, bottom: 36, left: 44 };
const ZK_PW = ZK_W - ZK_M.left - ZK_M.right;
const ZK_PH = ZK_H - ZK_M.top - ZK_M.bottom;

interface ZakkingsChartProps {
  settlement: SettlementResult;
}

function ZakkingsChart({ settlement }: ZakkingsChartProps) {
  const { curve, sls, uls } = settlement;

  const bounds = useMemo(() => {
    // x-bound: max of curve totalKn + workpoint Fc.
    const xVals = curve.map((p) => p.totalKn).concat([sls.fcTot, uls.fcTot]);
    const xMax = Math.max(1, Math.max(...xVals) * 1.05);
    const xStep = Math.ceil(xMax / 5 / 50) * 50;
    const xMaxSnap = xStep * 5;
    // y-bound: max sbMm of curve + workpoints (both positive-going-down).
    const yVals = curve.map((p) => p.sbMm).concat([sls.sbMm, uls.sbMm]);
    const yMax = Math.max(1, Math.max(...yVals) * 1.05);
    return { xMax: xMaxSnap, yMax };
  }, [curve, sls, uls]);

  const xToPx = (kn: number) => ZK_M.left + (kn / bounds.xMax) * ZK_PW;
  const yToPx = (mm: number) => ZK_M.top + (mm / bounds.yMax) * ZK_PH;

  // 50 points — direct computation is faster than memoization overhead.
  const path = curve.length === 0
    ? ""
    : curve
        .map((p, i) => `${i === 0 ? "M" : "L"}${xToPx(p.totalKn).toFixed(1)},${yToPx(p.sbMm).toFixed(1)}`)
        .join(" ");

  // X-ticks: 0 .. xMax in 5 steps.
  const xTicks = useMemo(() => {
    const step = bounds.xMax / 5;
    return Array.from({ length: 6 }, (_, i) => Math.round(i * step));
  }, [bounds.xMax]);
  // Y-ticks: 0 .. yMax in 4 steps.
  const yTicks = useMemo(() => {
    const step = bounds.yMax / 4;
    return Array.from({ length: 5 }, (_, i) => i * step);
  }, [bounds.yMax]);

  const ySls = yToPx(sls.sbMm);
  const yUls = yToPx(uls.sbMm);

  return (
    <svg
      className="pile-zakking-chart-svg"
      viewBox={`0 0 ${ZK_W} ${ZK_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Zakkingsdiagram"
    >
      {/* Plot background */}
      <rect
        x={ZK_M.left}
        y={ZK_M.top}
        width={ZK_PW}
        height={ZK_PH}
        className="pile-zakking-plot-bg"
      />

      {/* Grid + ticks */}
      {xTicks.map((kn) => {
        const x = xToPx(kn);
        return (
          <g key={`zx-${kn}`}>
            <line
              x1={x}
              x2={x}
              y1={ZK_M.top}
              y2={ZK_M.top + ZK_PH}
              className="pile-zakking-grid"
            />
            <text
              x={x}
              y={ZK_M.top + ZK_PH + 14}
              className="pile-zakking-axis-label"
              textAnchor="middle"
            >
              {kn}
            </text>
          </g>
        );
      })}
      {yTicks.map((mm, i) => {
        const y = yToPx(mm);
        return (
          <g key={`zy-${i}`}>
            <line
              x1={ZK_M.left}
              x2={ZK_M.left + ZK_PW}
              y1={y}
              y2={y}
              className="pile-zakking-grid"
            />
            <text
              x={ZK_M.left - 4}
              y={y + 3}
              className="pile-zakking-axis-label"
              textAnchor="end"
            >
              {mm.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* Axis titles */}
      <text
        x={ZK_M.left + ZK_PW / 2}
        y={ZK_H - 4}
        className="pile-zakking-axis-title"
        textAnchor="middle"
      >
        Belasting [kN]
      </text>
      <text
        x={10}
        y={ZK_M.top + ZK_PH / 2}
        className="pile-zakking-axis-title"
        textAnchor="middle"
        transform={`rotate(-90 10 ${ZK_M.top + ZK_PH / 2})`}
      >
        s_b [mm]
      </text>

      {/* SLS reference line — amber */}
      <line
        x1={ZK_M.left}
        x2={ZK_M.left + ZK_PW}
        y1={ySls}
        y2={ySls}
        className="pile-zakking-line-sls"
      />
      <text
        x={ZK_M.left + ZK_PW - 4}
        y={ySls - 3}
        className="pile-zakking-ref-label pile-zakking-ref-label--sls"
        textAnchor="end"
      >
        SLS Fc={sls.fcTot.toFixed(0)} kN · s_b={sls.sbMm.toFixed(1)} mm
      </text>

      {/* ULS reference line — blue */}
      <line
        x1={ZK_M.left}
        x2={ZK_M.left + ZK_PW}
        y1={yUls}
        y2={yUls}
        className="pile-zakking-line-uls"
      />
      <text
        x={ZK_M.left + ZK_PW - 4}
        y={yUls - 3}
        className="pile-zakking-ref-label pile-zakking-ref-label--uls"
        textAnchor="end"
      >
        ULS Fc={uls.fcTot.toFixed(0)} kN · s_b={uls.sbMm.toFixed(1)} mm
      </text>

      {/* Load-settlement curve — black */}
      {path && (
        <path d={path} className="pile-zakking-curve" fill="none" />
      )}

      {/* Plot border */}
      <rect
        x={ZK_M.left}
        y={ZK_M.top}
        width={ZK_PW}
        height={ZK_PH}
        className="pile-zakking-plot-border"
        fill="none"
      />
    </svg>
  );
}

// ─── ResultPanel ─────────────────────────────────────────────────

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
        <div className="pile-zakking-chart">
          <ZakkingsChart settlement={settlement} />
        </div>
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
