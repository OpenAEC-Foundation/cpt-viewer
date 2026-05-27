// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/VisualPanel.tsx
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useCptStore } from "../../../../store/useCptStore";
import type { PanelProps } from "../../../framework/types";
import type { Cpt, MeasurementPoint } from "../../../../types/cpt";
import type { PileInput, PileResult } from "../types";
import "./styles.css";

/** Velden die via drag-to-edit aanpasbaar zijn in de chart. */
type DraggableField =
  | "pileTopNap"
  | "pileToeNap"
  | "negKleefBottomNap"
  | "excavationNap"
  | "waterNap";

interface DragState {
  field: DraggableField;
  startClientY: number;
  startNap: number;
}

// ─── Chart geometry ──────────────────────────────────────────────
// SVG-coordinates: x→right, y→down. We work in a fixed viewBox so
// the chart scales crisply via preserveAspectRatio="xMidYMid meet".
const VB_W = 600;
const VB_H = 800;
const MARGIN = { top: 36, right: 100, bottom: 28, left: 64 };
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;

function formatNap(n: number): string {
  // "NAP +3,88" / "NAP -10,46" — Dutch decimal-comma, signed.
  const sign = n >= 0 ? "+" : "-";
  return `NAP ${sign}${Math.abs(n).toFixed(2).replace(".", ",")} m`;
}

function downsample<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) return arr;
  const step = arr.length / target;
  const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)]);
  // Always include last point so the curve doesn't visually end early.
  out.push(arr[arr.length - 1]);
  return out;
}

interface ChartBounds {
  napTop: number;    // top of plot (high)
  napBot: number;    // bottom of plot (low)
  qcMax: number;     // x-axis upper bound (MPa)
  napToY: (nap: number) => number;
  qcToX: (qc: number) => number;
}

function buildBounds(points: MeasurementPoint[], input: PileInput): ChartBounds {
  // Find the data extent. Prefer depth_nap; fall back to depth if missing.
  const naps: number[] = [];
  for (const p of points) {
    const nap = p.depth_nap ?? -p.depth;
    if (Number.isFinite(nap)) naps.push(nap);
  }
  // Annotation NAP-values to include in the chart range so they're always visible.
  const overlayNaps = [
    input.pileTopNap,
    input.pileToeNap,
    input.waterNap,
    input.excavationNap,
    input.negKleefBottomNap,
  ].filter((n) => Number.isFinite(n));
  const allNaps = [...naps, ...overlayNaps];

  let napTop = Math.max(...allNaps);
  let napBot = Math.min(...allNaps);
  // Pad a little so labels at the very top/bottom aren't clipped.
  const pad = Math.max(0.5, (napTop - napBot) * 0.04);
  napTop += pad;
  napBot -= pad;
  if (!Number.isFinite(napTop) || !Number.isFinite(napBot) || napTop === napBot) {
    napTop = 5;
    napBot = -20;
  }

  // qc-axis: round up to a nice number above max·1.1.
  let qcMaxRaw = 0;
  for (const p of points) {
    if (typeof p.qc === "number" && Number.isFinite(p.qc)) {
      if (p.qc > qcMaxRaw) qcMaxRaw = p.qc;
    }
  }
  const qcWithMargin = Math.max(5, qcMaxRaw * 1.1);
  // Snap to next multiple of 5.
  const qcMax = Math.ceil(qcWithMargin / 5) * 5;

  const napToY = (nap: number) =>
    MARGIN.top + ((napTop - nap) / (napTop - napBot)) * PLOT_H;
  const qcToX = (qc: number) =>
    MARGIN.left + (qc / qcMax) * PLOT_W;
  return { napTop, napBot, qcMax, napToY, qcToX };
}

function buildDepthTicks(napTop: number, napBot: number): number[] {
  const range = napTop - napBot;
  // Pick step so we get ~8-12 ticks.
  const candidate = range / 10;
  const candidates = [0.5, 1, 2, 2.5, 5, 10];
  let step = 1;
  for (const c of candidates) {
    if (c >= candidate) { step = c; break; }
    step = c;
  }
  const start = Math.ceil(napBot / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= napTop; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function buildQcTicks(qcMax: number): number[] {
  const step = qcMax / 5;
  const ticks: number[] = [];
  for (let i = 0; i <= 5; i++) ticks.push(Math.round(i * step));
  return ticks;
}

// ─── Sub-component: the actual chart ─────────────────────────────

interface ChartProps {
  cpt: Cpt;
  input: PileInput;
  result: PileResult;
  onChange?: (next: PileInput) => void;
}

function CptOverlayChart({ cpt, input, result, onChange }: ChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const bounds = useMemo(() => buildBounds(cpt.points, input), [cpt.points, input]);
  const qcPath = useMemo(() => {
    // Build a polyline from the qc curve. Downsample to ~500 pts.
    const points = cpt.points.filter(
      (p) => typeof p.qc === "number" && Number.isFinite(p.qc),
    );
    const sample = downsample(points, 500);
    return sample
      .map((p) => {
        const nap = p.depth_nap ?? -p.depth;
        return `${bounds.qcToX(p.qc as number).toFixed(1)},${bounds.napToY(nap).toFixed(1)}`;
      })
      .join(" ");
  }, [cpt.points, bounds]);

  const depthTicks = useMemo(
    () => buildDepthTicks(bounds.napTop, bounds.napBot),
    [bounds.napTop, bounds.napBot],
  );
  const qcTicks = useMemo(() => buildQcTicks(bounds.qcMax), [bounds.qcMax]);

  // Zone heights: 8·Deq above paalpunt (light blue), 4·Deq below (light red).
  const deqM = result.base.deqMm / 1000;
  const zoneAboveTop = input.pileToeNap + 8 * deqM;
  const zoneBelowBot = input.pileToeNap - 4 * deqM;

  // Convert NAP-y values up-front for readability.
  const yPileTop = bounds.napToY(input.pileTopNap);
  const yPileToe = bounds.napToY(input.pileToeNap);
  const yWater = bounds.napToY(input.waterNap);
  const yExcavation = bounds.napToY(input.excavationNap);
  const yNkBot = bounds.napToY(input.negKleefBottomNap);
  const yZoneAboveTop = bounds.napToY(Math.min(zoneAboveTop, bounds.napTop));
  const yZoneBelowBot = bounds.napToY(Math.max(zoneBelowBot, bounds.napBot));

  // Right-margin label positions — qc;I, qc;II, qc;III, qb;max all sit
  // somewhere inside the 8D/4D zone, so we anchor each label at the mid
  // of its respective band (rough but readable).
  const xRightLabel = MARGIN.left + PLOT_W + 6;

  // ─── Drag-to-edit ──────────────────────────────────────────────
  // Mouse-Y in screen-px → viewBox-px → NAP-m via dezelfde lineaire
  // mapping als napToY (geïnverteerd). Snappen op 0,05 m raster.
  const draggable = !!onChange;

  const startDrag = (field: DraggableField, startNap: number) =>
    (e: ReactMouseEvent<SVGElement>) => {
      if (!onChange) return;
      e.preventDefault();
      e.stopPropagation();
      setDrag({ field, startClientY: e.clientY, startNap });
    };

  useEffect(() => {
    if (!drag || !onChange) return;
    const svg = svgRef.current;
    if (!svg) return;

    const onMove = (e: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.height === 0) return;
      // viewBox-y per screen-px. SVG uses preserveAspectRatio="xMidYMid meet"
      // so the effective scale is uniform; height-based ratio is correct.
      const vbPerScreenPx = VB_H / rect.height;
      const dyVb = (e.clientY - drag.startClientY) * vbPerScreenPx;
      // NAP increases UPWARDS while SVG-y increases DOWNWARDS — dus -dy.
      const napPerVbPx = (bounds.napTop - bounds.napBot) / PLOT_H;
      let newNap = drag.startNap - dyVb * napPerVbPx;
      // Snap to nearest 0,05 m.
      newNap = Math.round(newNap * 20) / 20;
      // Voorkom no-op-updates (zelfde waarde → geen onChange-storm).
      const current = input[drag.field];
      if (newNap === current) return;
      onChange({ ...input, [drag.field]: newNap });
    };
    const onUp = () => setDrag(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onChange, input, bounds.napTop, bounds.napBot]);

  // Body-cursor lock tijdens drag: voorkomt text-cursor flicker bij snel
  // bewegen over labels of buiten de SVG.
  useEffect(() => {
    if (!drag) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "ns-resize";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [drag]);

  return (
    <svg
      ref={svgRef}
      className="pile-cpt-chart-svg"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="CPT-grafiek met paaloverlays"
    >
      {/* ─── Plot background ─── */}
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={PLOT_W}
        height={PLOT_H}
        className="pile-cpt-plot-bg"
      />

      {/* ─── Neg.kleef-zone (paalkop → neg.kleef-grens) — orange band ─── */}
      {input.negKleefBottomNap < input.pileTopNap && (
        <rect
          x={MARGIN.left}
          y={Math.min(yPileTop, yNkBot)}
          width={PLOT_W}
          height={Math.abs(yNkBot - yPileTop)}
          className="pile-cpt-zone-negkleef"
        />
      )}

      {/* ─── 8D zone above paalpunt — light blue ─── */}
      {yZoneAboveTop < yPileToe && (
        <rect
          x={MARGIN.left}
          y={yZoneAboveTop}
          width={PLOT_W}
          height={yPileToe - yZoneAboveTop}
          className="pile-cpt-zone-8d"
        />
      )}

      {/* ─── 4D zone below paalpunt — light red ─── */}
      {yZoneBelowBot > yPileToe && (
        <rect
          x={MARGIN.left}
          y={yPileToe}
          width={PLOT_W}
          height={yZoneBelowBot - yPileToe}
          className="pile-cpt-zone-4d"
        />
      )}

      {/* ─── Grid lines + depth ticks (y-axis) ─── */}
      {depthTicks.map((nap) => {
        const y = bounds.napToY(nap);
        if (y < MARGIN.top || y > MARGIN.top + PLOT_H) return null;
        return (
          <g key={`d-${nap}`}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_W}
              y1={y}
              y2={y}
              className="pile-cpt-grid"
            />
            <text
              x={MARGIN.left - 6}
              y={y + 3}
              className="pile-cpt-axis-label"
              textAnchor="end"
            >
              {nap.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* ─── qc ticks (x-axis, top) ─── */}
      {qcTicks.map((qc) => {
        const x = bounds.qcToX(qc);
        return (
          <g key={`q-${qc}`}>
            <line
              x1={x}
              x2={x}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_H}
              className="pile-cpt-grid-vert"
            />
            <text
              x={x}
              y={MARGIN.top - 6}
              className="pile-cpt-axis-label"
              textAnchor="middle"
            >
              {qc}
            </text>
          </g>
        );
      })}

      {/* ─── Axis titles ─── */}
      <text
        x={MARGIN.left + PLOT_W / 2}
        y={MARGIN.top - 22}
        className="pile-cpt-axis-title"
        textAnchor="middle"
      >
        q_c [MPa]
      </text>
      <text
        x={18}
        y={MARGIN.top + PLOT_H / 2}
        className="pile-cpt-axis-title"
        textAnchor="middle"
        transform={`rotate(-90 18 ${MARGIN.top + PLOT_H / 2})`}
      >
        m NAP
      </text>

      {/* ─── qc curve ─── */}
      {qcPath && (
        <polyline
          points={qcPath}
          className="pile-cpt-qc-curve"
          fill="none"
        />
      )}

      {/* ─── Paalkop ─── solid */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yPileTop}
        y2={yPileTop}
        className={`pile-cpt-line-paalkop${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "pileTopNap" ? " pile-niveau-dragging" : ""}`}
      />
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yPileTop}
          y2={yPileTop}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("pileTopNap", input.pileTopNap)}
        />
      )}
      <text
        x={MARGIN.left + 4}
        y={yPileTop - 4}
        className="pile-cpt-overlay-label"
      >
        Paalkop {formatNap(input.pileTopNap)}
      </text>

      {/* ─── Ontgraving ─── dashed */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yExcavation}
        y2={yExcavation}
        className={`pile-cpt-line-ontgraving${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "excavationNap" ? " pile-niveau-dragging" : ""}`}
      />
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yExcavation}
          y2={yExcavation}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("excavationNap", input.excavationNap)}
        />
      )}
      <text
        x={MARGIN.left + 4}
        y={yExcavation - 4}
        className="pile-cpt-overlay-label"
      >
        Ontgraving {formatNap(input.excavationNap)}
      </text>

      {/* ─── Water ─── triangle marker + dotted line */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yWater}
        y2={yWater}
        className={`pile-cpt-line-water${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "waterNap" ? " pile-niveau-dragging" : ""}`}
      />
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yWater}
          y2={yWater}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("waterNap", input.waterNap)}
        />
      )}
      <polygon
        points={`${MARGIN.left + 10},${yWater - 6} ${MARGIN.left + 16},${yWater} ${MARGIN.left + 4},${yWater}`}
        className="pile-cpt-marker-water"
      />
      <text
        x={MARGIN.left + 22}
        y={yWater + 4}
        className="pile-cpt-overlay-label"
      >
        Water {formatNap(input.waterNap)}
      </text>

      {/* ─── Neg.kleef-grens ─── solid */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yNkBot}
        y2={yNkBot}
        className={`pile-cpt-line-negkleef${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "negKleefBottomNap" ? " pile-niveau-dragging" : ""}`}
      />
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yNkBot}
          y2={yNkBot}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("negKleefBottomNap", input.negKleefBottomNap)}
        />
      )}
      <text
        x={MARGIN.left + 4}
        y={yNkBot - 4}
        className="pile-cpt-overlay-label"
      >
        Neg.kleef-grens {formatNap(input.negKleefBottomNap)}
      </text>

      {/* ─── Paalpunt ─── bold red */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yPileToe}
        y2={yPileToe}
        className={`pile-cpt-line-paalpunt${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "pileToeNap" ? " pile-niveau-dragging" : ""}`}
      />
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yPileToe}
          y2={yPileToe}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("pileToeNap", input.pileToeNap)}
        />
      )}
      <text
        x={MARGIN.left + 4}
        y={yPileToe + 14}
        className="pile-cpt-overlay-label pile-cpt-overlay-label--strong"
      >
        Paalpunt {formatNap(input.pileToeNap)}
      </text>

      {/* ─── Right-margin: qc;I / qc;II / qc;III ─── */}
      <text
        x={xRightLabel}
        y={(yZoneAboveTop + yPileToe) / 2 - 6}
        className="pile-cpt-side-label"
      >
        q_c;I={result.base.qcIGemMpa.toFixed(2)}
      </text>
      <text
        x={xRightLabel}
        y={(yZoneAboveTop + yPileToe) / 2 + 6}
        className="pile-cpt-side-label"
      >
        q_c;II={result.base.qcIIGemMpa.toFixed(2)}
      </text>
      <text
        x={xRightLabel}
        y={(yPileToe + yZoneBelowBot) / 2}
        className="pile-cpt-side-label"
      >
        q_c;III={result.base.qcIIIGemMpa.toFixed(2)}
      </text>
      <text
        x={xRightLabel}
        y={yPileToe + 28}
        className="pile-cpt-side-label pile-cpt-side-label--strong"
      >
        q_b;max={result.base.qbMaxMpa.toFixed(2)}
      </text>

      {/* ─── Plot border ─── */}
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={PLOT_W}
        height={PLOT_H}
        className="pile-cpt-plot-border"
        fill="none"
      />
    </svg>
  );
}

// ─── Top-level VisualPanel ───────────────────────────────────────

export function VisualPanel({ input, result, onChange }: PanelProps<PileInput, PileResult>) {
  const cpt = useCptStore((s) => (input.cptId ? s.cpts.get(input.cptId) : null));

  if (!cpt) {
    return (
      <div className="pile-visual">
        <div className="pile-visual-empty">Geen sondering geselecteerd</div>
      </div>
    );
  }
  if (!cpt.points || cpt.points.length === 0) {
    return (
      <div className="pile-visual">
        <h3>Sondering: {cpt.id}</h3>
        <div className="pile-visual-empty">Geen meetwaarden in deze CPT</div>
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="pile-visual">
        <h3>Sondering: {cpt.id}</h3>
        <div className="pile-visual-empty">
          Geen geldig rekenresultaat — controleer invoer.
        </div>
      </div>
    );
  }

  return (
    <div className="pile-visual">
      <h3>Sondering: {cpt.id}</h3>
      <div className="pile-cpt-chart">
        <CptOverlayChart cpt={cpt} input={input} result={result} onChange={onChange} />
      </div>
      <p className="pile-visual-footnote">
        q<sub>c;I</sub>={result.base.qcIGemMpa.toFixed(2)} /
        q<sub>c;II</sub>={result.base.qcIIGemMpa.toFixed(2)} /
        q<sub>c;III</sub>={result.base.qcIIIGemMpa.toFixed(2)} MPa
        {" • "}
        R<sub>b</sub>={result.base.rbCalMax.toFixed(0)} kN /
        R<sub>s</sub>={result.shaft.rsCalMax.toFixed(0)} kN /
        F<sub>nk;d</sub>={result.negKleef.fnkD.toFixed(0)} kN
      </p>
    </div>
  );
}
