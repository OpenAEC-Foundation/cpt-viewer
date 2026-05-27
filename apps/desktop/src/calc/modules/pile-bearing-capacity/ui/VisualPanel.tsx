// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/VisualPanel.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useCptStore } from "../../../../store/useCptStore";
import type { PanelProps } from "../../../framework/types";
import type { Cpt, MeasurementPoint } from "../../../../types/cpt";
import type { PileInput, PileResult } from "../types";
import { getPileType } from "../catalog";
import "./styles.css";

/** Velden die via drag-to-edit aanpasbaar zijn in de chart. */
type DraggableField =
  | "pileTopNap"
  | "pileToeNap"
  | "negKleefBottomNap"
  | "posKleefTopNap"
  | "excavationNap"
  | "waterNap";

interface DragState {
  field: DraggableField;
  startClientY: number;
  startNap: number;
}

interface PanState {
  startClientY: number;
  startNapMin: number;
  startNapMax: number;
}

interface ZoomDomain {
  napMin: number;   // lage NAP-waarde (onderkant van zicht)
  napMax: number;   // hoge NAP-waarde (bovenkant van zicht)
}

// ─── Chart geometry ──────────────────────────────────────────────
// SVG-coordinates: x→right, y→down. We work in a fixed viewBox so
// the chart scales crisply via preserveAspectRatio="xMidYMid meet".
const VB_W = 720;          // extra breedte voor pile-column + arrows
const VB_H = 800;
const MARGIN = { top: 36, right: 180, bottom: 28, left: 64 };
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;

// ─── Pile-column geometry (rechts van de plot, links van labels) ───
const PILE_COL_X = MARGIN.left + PLOT_W + 12;   // start van de pile-kolom
const PILE_COL_W = 60;                           // pile + arrows zone breedte
const PILE_COL_CENTER = PILE_COL_X + PILE_COL_W / 2;
// Visuele paal-breedte: clamp tussen min/max zodat alle palen herkenbaar
// blijven (anders zou 168 mm paal vs 1500 mm-as in pixels lachwekkend zijn).
const PILE_GFX_MIN_W = 14;
const PILE_GFX_MAX_W = 36;
const PILE_PAALPUNT_HEIGHT = 18; // pixels voor de tapered tip

/** Minimaal zoom-bereik in m NAP (anders wordt het onleesbaar). */
const MIN_ZOOM_SPAN_M = 0.5;

function formatNap(n: number): string {
  // "NAP +3,88" / "NAP -10,46" — Dutch decimal-comma, signed.
  const sign = n >= 0 ? "+" : "-";
  return `NAP ${sign}${Math.abs(n).toFixed(2).replace(".", ",")} m`;
}

function formatMeters(n: number): string {
  // "0,88 m" — Dutch decimal-comma, 2 decimalen.
  return `${n.toFixed(2).replace(".", ",")} m`;
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

interface FullDataExtent {
  fullNapTop: number;  // hoogste NAP in data + padding
  fullNapBot: number;  // laagste NAP in data + padding
}

function computeFullExtent(points: MeasurementPoint[], input: PileInput): FullDataExtent {
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
  return { fullNapTop: napTop, fullNapBot: napBot };
}

function buildBounds(
  points: MeasurementPoint[],
  fullExtent: FullDataExtent,
  zoom: ZoomDomain | null,
): ChartBounds {
  // Use zoom-domain when active, otherwise full data extent.
  const napTop = zoom ? zoom.napMax : fullExtent.fullNapTop;
  const napBot = zoom ? zoom.napMin : fullExtent.fullNapBot;

  // qc-axis: round up to a nice number above max·1.1.
  // NOTE: qc auto-scales op de volledige data (niet alleen op zoom-bereik),
  // zodat de x-as niet "danst" bij zoomen.
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
  const candidates = [0.25, 0.5, 1, 2, 2.5, 5, 10];
  let step = 1;
  for (const c of candidates) {
    if (c >= candidate) { step = c; break; }
    step = c;
  }
  const start = Math.ceil(napBot / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= napTop; v += step) {
    // Houd alleen 2 decimalen om floating-point-rommel te vermijden.
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function buildQcTicks(qcMax: number): number[] {
  const step = qcMax / 5;
  const ticks: number[] = [];
  for (let i = 0; i <= 5; i++) ticks.push(Math.round(i * step));
  return ticks;
}

// ─── Sub-component: pile graphic (rect/polygon + force arrows) ───
// Wordt binnen de SVG van de CPT-chart gerendered zodat de pile in
// dezelfde NAP-coordinaten als de chart staat (en mee-zoomt). Alle
// content wordt geclipt aan het plot-bereik via #pile-plot-clip.

interface PileGraphicProps {
  input: PileInput;
  result: PileResult;
  material: "steel" | "concrete";
  isCircular: boolean;
  yPileTop: number;     // SVG-y van paalkop (na clamp)
  yPileToe: number;     // SVG-y van paalpunt (na clamp)
  yNkBot: number;       // SVG-y van neg.kleef-grens
  plotTop: number;      // SVG-y van plot-rand boven (clip-grens)
  plotBottom: number;   // SVG-y van plot-rand onder
  /** SVG-y van de onderkant van de wapeningskorf (= 4·D vanaf paalkop,
   *  geclampt op paalpunt). Wapeningskorf-graphic wordt alleen gerenderd
   *  voor betongevulde stalen buispalen (composiet). */
  yRebarBot: number;
  /** True als deze paal een wapeningskorf heeft (betongevulde stalen
   *  buispaal). Voor pure stalen of pure betonpalen → false. */
  hasRebarCage: boolean;
}

function PileGraphic({
  input,
  result,
  material,
  isCircular,
  yPileTop,
  yPileToe,
  yNkBot,
  plotTop,
  plotBottom,
  yRebarBot,
  hasRebarCage,
}: PileGraphicProps) {
  // Kleurpalet per materiaal — beige voor beton (#d4a574), grijs voor staal.
  const fill = material === "concrete" ? "#d4a574" : "#9ca3af";
  const stroke = "#374151";

  // Visuele paal-breedte — gemapped uit werkelijke diameter via min/max
  // clamp zodat heel kleine of heel grote palen nog herkenbaar zijn.
  const diaPx = Math.max(
    PILE_GFX_MIN_W,
    Math.min(PILE_GFX_MAX_W, input.diameterMm / 10),
  );
  const cx = PILE_COL_CENTER;
  const xPileLeft = cx - diaPx / 2;
  const xPileRight = cx + diaPx / 2;

  // Pile-body verticaal: clamp aan plot zodat de paal niet de assen
  // overschrijdt als hij gedeeltelijk buiten beeld valt (bij zoom).
  // Note: yPileTop kan kleiner zijn dan plotTop bij zoom — clip dan.
  const yTopClamped = Math.max(plotTop, Math.min(plotBottom, yPileTop));
  const yToeClamped = Math.max(plotTop, Math.min(plotBottom, yPileToe));
  const bodyH = yToeClamped - yTopClamped;

  // Tip-tekening: voor staal een korte spitse pyramide (gesloten punt),
  // voor beton een tapered tip (langer). Hoogte = PILE_PAALPUNT_HEIGHT,
  // maar alleen tekenen als yToe binnen plot-bereik valt.
  const tipVisible = yPileToe < plotBottom - 1; // niet net buiten zicht
  const tipH = material === "concrete" ? PILE_PAALPUNT_HEIGHT : PILE_PAALPUNT_HEIGHT * 0.6;
  const yTipBot = Math.min(plotBottom, yPileToe + tipH);
  const tipPath = `M${xPileLeft},${yToeClamped} L${xPileRight},${yToeClamped} L${cx},${yTipBot} z`;

  // ─── Force-arrows: schaal alle pijlen relatief t.o.v. de max van de
  // drie. Maximum visuele lengte = 28 px zodat het binnen PILE_COL_W past. ──
  const Fnk = result.negKleef.fnkD;
  const Rs = result.shaft.rsCalMax;
  const Rb = result.base.rbCalMax;
  const Fmax = Math.max(Fnk, Rs, Rb, 1);
  const arrowLenFor = (f: number) => Math.max(6, Math.min(28, (f / Fmax) * 28));

  // Neg.kleef-pijl: omlaag, boven de neg.kleef-grens. Alleen tonen als de
  // zone in zicht is en > 0 kN (anders rommel).
  const yNkBotClamped = Math.max(plotTop, Math.min(plotBottom, yNkBot));
  const yNkMid = (yTopClamped + yNkBotClamped) / 2;
  const showFnk = Fnk > 0.5 && yNkBot > yPileTop && yNkBot < plotBottom && yPileTop > plotTop - 1;

  // Schacht-pijlen (omhoog): 2-3 pijlen verdeeld over de shaft-zone.
  // De shaft-zone loopt van neg.kleef-grens tot paalpunt.
  const shaftTop = Math.max(plotTop, yNkBotClamped);
  const shaftBot = yToeClamped;
  const shaftH = shaftBot - shaftTop;
  const showRs = Rs > 0.5 && shaftH > 30;
  const shaftArrowYs: number[] = [];
  if (showRs) {
    // Aantal pijlen schalen met zone-hoogte (1 per 60 px, min 1, max 3).
    const n = Math.max(1, Math.min(3, Math.floor(shaftH / 60)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      shaftArrowYs.push(shaftTop + t * shaftH);
    }
  }

  // Paalpunt-pijl (omhoog onder paalpunt) — alleen als tip in zicht.
  const showRb = Rb > 0.5 && tipVisible && yPileToe < plotBottom - 20;

  // Force-arrow x-positie: nét rechts van de paal (1 px gap).
  const xArrowStart = xPileRight + 4;
  const xArrowLineHead = (lenPx: number) => xArrowStart + lenPx;

  // Wapeningskorf-geometrie binnen pile-body. Korf reikt van paalkop tot
  // yRebarBot (= 4·D vanaf paalkop, geclampt op paalpunt). 3 verticale
  // longitudinale staven + 3 horizontale beugels suggereren de korf.
  const rebarTop = Math.max(plotTop, yTopClamped);
  const rebarBot = Math.min(plotBottom, yRebarBot);
  const rebarH = rebarBot - rebarTop;
  const showRebar = hasRebarCage && rebarH > 6;
  // 3 longitudinale staven verspreid over de paal-breedte. Vermijd de
  // randstaven (vallen samen met de buis-wand).
  const longTs = [0.28, 0.5, 0.72];
  // 3 horizontale beugels op vaste t-fracties van de korf.
  const stirrupTs = [0.15, 0.5, 0.85];

  return (
    <g clipPath="url(#pile-plot-clip)" className="pile-gfx">
      {/* Pile-body: voor stalen buispaal (hasRebarCage=true) tekenen we
          het composiet: buitenste ring (staal) + binnenkern (beton). Voor
          pure stalen of pure betonpalen: één rect met material-kleur. */}
      {bodyH > 0 && (
        hasRebarCage ? (
          <>
            {/* Buitenste staal-buis: grijs */}
            <rect
              x={xPileLeft}
              y={yTopClamped}
              width={diaPx}
              height={bodyH}
              fill="#9ca3af"
              stroke={stroke}
              strokeWidth={1.5}
              rx={isCircular ? diaPx / 2 : 0}
              ry={isCircular ? Math.min(diaPx / 2, 6) : 0}
            />
            {/* Beton-vulling: beige rect binnen de staal-buis. Inset =
                wanddikte van de paal (clamp aan visueel zinvol). */}
            {(() => {
              const wallPx = Math.max(1.5, Math.min(diaPx * 0.18, input.wallThicknessMm / 6));
              const innerW = diaPx - 2 * wallPx;
              const innerX = xPileLeft + wallPx;
              const innerRx = isCircular ? Math.max(0, innerW / 2) : 0;
              if (innerW <= 0) return null;
              return (
                <rect
                  x={innerX}
                  y={yTopClamped + wallPx}
                  width={innerW}
                  height={Math.max(0, bodyH - 2 * wallPx)}
                  fill="#d4a574"
                  stroke="none"
                  rx={innerRx}
                  ry={isCircular ? Math.min(innerRx, 6) : 0}
                />
              );
            })()}
          </>
        ) : (
          <rect
            x={xPileLeft}
            y={yTopClamped}
            width={diaPx}
            height={bodyH}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
            rx={isCircular ? diaPx / 2 : 0}
            ry={isCircular ? Math.min(diaPx / 2, 6) : 0}
          />
        )
      )}
      {/* Tip — alleen tekenen als paalpunt in zicht is. */}
      {tipVisible && (
        <path d={tipPath} fill={fill} stroke={stroke} strokeWidth={1.5} />
      )}

      {/* ─── Wapeningskorf (alleen voor betongevulde stalen buispaal) ───
          3 verticale longitudinale staven + 3 horizontale beugels over
          de bovenste 4·D van de paal. Geeft een industrieel-uitziend
          korf-patroon binnenin de beton-vulling. */}
      {showRebar && (
        <g className="pile-gfx-rebar">
          {longTs.map((t, i) => (
            <line
              key={`long-${i}`}
              x1={xPileLeft + diaPx * t}
              x2={xPileLeft + diaPx * t}
              y1={rebarTop}
              y2={rebarBot}
              className="pile-gfx-rebar-long"
            />
          ))}
          {stirrupTs.map((t, i) => {
            const y = rebarTop + rebarH * t;
            if (y < plotTop || y > plotBottom) return null;
            return (
              <line
                key={`stir-${i}`}
                x1={xPileLeft + 1.5}
                x2={xPileLeft + diaPx - 1.5}
                y1={y}
                y2={y}
                className="pile-gfx-rebar-stir"
              />
            );
          })}
        </g>
      )}

      {/* ─── Force-arrows ─── */}
      {showFnk && (
        <g className="pile-gfx-arrow pile-gfx-arrow--fnk">
          <line
            x1={xArrowStart}
            x2={xArrowStart + arrowLenFor(Fnk)}
            y1={yNkMid - 8}
            y2={yNkMid + 4}
            stroke="#dc2626"
            strokeWidth={1.5}
            markerEnd="url(#pile-arrow-down)"
          />
          <text
            x={xArrowLineHead(arrowLenFor(Fnk)) + 4}
            y={yNkMid}
            className="pile-gfx-arrow-label"
            fill="#dc2626"
          >
            F_nk={Fnk.toFixed(0)} kN
          </text>
        </g>
      )}

      {showRs && shaftArrowYs.map((y, i) => (
        <g key={`rs-${i}`} className="pile-gfx-arrow pile-gfx-arrow--rs">
          <line
            x1={xArrowStart}
            x2={xArrowStart + arrowLenFor(Rs)}
            y1={y + 4}
            y2={y - 8}
            stroke="#16a34a"
            strokeWidth={1.2}
            markerEnd="url(#pile-arrow-up)"
          />
          {/* Label alleen bij eerste pijl. */}
          {i === 0 && (
            <text
              x={xArrowLineHead(arrowLenFor(Rs)) + 4}
              y={y}
              className="pile-gfx-arrow-label"
              fill="#16a34a"
            >
              R_s={Rs.toFixed(0)} kN
            </text>
          )}
        </g>
      ))}

      {showRb && (
        <g className="pile-gfx-arrow pile-gfx-arrow--rb">
          <line
            x1={cx}
            x2={cx}
            y1={Math.min(plotBottom - 1, yPileToe + tipH + arrowLenFor(Rb) + 4)}
            y2={Math.min(plotBottom - 1, yPileToe + tipH + 2)}
            stroke="#16a34a"
            strokeWidth={2}
            markerEnd="url(#pile-arrow-up)"
          />
          <text
            x={cx + 8}
            y={Math.min(plotBottom - 4, yPileToe + tipH + arrowLenFor(Rb) / 2 + 4)}
            className="pile-gfx-arrow-label pile-gfx-arrow-label--strong"
            fill="#16a34a"
          >
            R_b={Rb.toFixed(0)} kN
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Sub-component: paal-doorsnede (cross-section) ───────────────
// Toont een schematische dwarsdoorsnede van de paal: voor een betongevulde
// stalen buispaal (composiet) wordt de stalen ring, betonkern, longitudinale
// wapeningsstaven en transverse beugel getekend. Voor prefab voorgespannen
// betonpalen worden 4 hoek-voorspandraden getekend. Gerendered ONDER de
// CPT-chart in een aparte div zodat hij niet meeschaalt met de plot-zoom.

interface PileCrossSectionProps {
  diameterMm: number;
  wallThicknessMm: number;
  material: "steel" | "concrete";
  isCircular: boolean;
  hasRebarCage: boolean;
}

function PileCrossSection({
  diameterMm,
  wallThicknessMm,
  material,
  isCircular,
  hasRebarCage,
}: PileCrossSectionProps) {
  const SIZE = 120;
  const PAD = 10;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = SIZE / 2 - PAD;                  // outer radius/halfwidth in px
  // Schaal: paal-px per mm — gebruikt voor wanddikte-mapping (max 18% van R
  // zodat smalle wanden visueel zichtbaar blijven op kleine palen).
  const pxPerMm = (R * 2) / diameterMm;
  const wallPx = Math.max(2, Math.min(R * 0.18, wallThicknessMm * pxPerMm));
  const innerR = Math.max(1, R - wallPx);

  // Wapeningstaven (alleen voor composiet): 6 stuks op een ring binnen beton.
  const rebarRingR = innerR * 0.78;
  const rebarDotR = Math.max(1.5, wallPx * 0.45);
  const N_REBARS = 6;
  const rebarPositions = Array.from({ length: N_REBARS }, (_, i) => {
    const angle = (2 * Math.PI * i) / N_REBARS - Math.PI / 2; // start bovenaan
    return {
      cx: CX + rebarRingR * Math.cos(angle),
      cy: CY + rebarRingR * Math.sin(angle),
    };
  });

  return (
    <svg
      className="pile-cross-section-svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="Paal-doorsnede"
    >
      {isCircular ? (
        material === "steel" ? (
          <>
            {/* Stalen buis (ring) — grijs gevuld */}
            <circle cx={CX} cy={CY} r={R} fill="#9ca3af" stroke="#374151" strokeWidth={1.5} />
            {/* Beton-vulling — beige binnen-cirkel */}
            <circle cx={CX} cy={CY} r={innerR} fill="#d4a574" stroke="none" />
            {hasRebarCage && (
              <>
                {/* Transverse beugel (stirrup) — donkere stippellijn */}
                <circle
                  cx={CX}
                  cy={CY}
                  r={rebarRingR}
                  fill="none"
                  stroke="#374151"
                  strokeWidth={0.6}
                  strokeDasharray="2 1.5"
                />
                {/* Longitudinale wapeningstaven — donkere stippen */}
                {rebarPositions.map((p, i) => (
                  <circle key={i} cx={p.cx} cy={p.cy} r={rebarDotR} fill="#374151" />
                ))}
              </>
            )}
          </>
        ) : (
          /* Pure beton ronde paal (boorpaal etc.) — beige cirkel */
          <circle cx={CX} cy={CY} r={R} fill="#d4a574" stroke="#374151" strokeWidth={1.5} />
        )
      ) : (
        <>
          {/* Vierkante prefab betonpaal — beige rechthoek */}
          <rect x={PAD} y={PAD} width={R * 2} height={R * 2} fill="#d4a574" stroke="#374151" strokeWidth={1.5} />
          {/* Voorspandraden — 4 hoek-stippen */}
          {[
            [PAD + R * 0.4, PAD + R * 0.4],
            [PAD + R * 1.6, PAD + R * 0.4],
            [PAD + R * 0.4, PAD + R * 1.6],
            [PAD + R * 1.6, PAD + R * 1.6],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2} fill="#374151" />
          ))}
        </>
      )}
    </svg>
  );
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
  const [pan, setPan] = useState<PanState | null>(null);
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null);

  // Paaltype voor visualisatie (material, shape).
  const pileType = getPileType(input.pileTypeId);
  const pileMaterial: "steel" | "concrete" = pileType?.material ?? "steel";
  const pileIsCircular = pileType?.isCircular ?? true;

  const fullExtent = useMemo(
    () => computeFullExtent(cpt.points, input),
    [cpt.points, input],
  );
  const bounds = useMemo(
    () => buildBounds(cpt.points, fullExtent, zoomDomain),
    [cpt.points, fullExtent, zoomDomain],
  );
  // Volledige qc-puntenlijst (gefilterd + gedownsampled) — basis voor alle
  // qc-curve-segmenten. We splitsen later op NAP-range zodat we per zone
  // (8D / dc / 4D-max / overig) een andere kleur kunnen geven, conform de
  // norm-visualisatie in ExternPakket + referentienorm.
  const qcPoints = useMemo(() => {
    const filtered = cpt.points.filter(
      (p) => typeof p.qc === "number" && Number.isFinite(p.qc),
    );
    const sample = downsample(filtered, 500);
    return sample.map((p) => ({
      nap: p.depth_nap ?? -p.depth,
      qc: p.qc as number,
    }));
  }, [cpt.points]);

  // Bouw een polyline-points-string voor punten waarvan NAP in [napBot, napTop]
  // valt. We snijden ook op de zone-grenzen via lineaire interpolatie zodat
  // de gekleurde segmenten exact tot aan de paalpunt/zone-grens lopen
  // (anders zou de bold-segment net binnen of buiten de zone eindigen).
  const qcSegmentPoints = useCallback(
    (napTop: number, napBot: number): string => {
      // napTop > napBot (NAP is opwaarts; top is hoger). We willen alle
      // punten waarvan nap ∈ [napBot, napTop], inclusief geïnterpoleerde
      // grenspunten op napTop en napBot.
      const lo = Math.min(napTop, napBot);
      const hi = Math.max(napTop, napBot);
      const inside: { nap: number; qc: number }[] = [];
      for (let i = 0; i < qcPoints.length; i++) {
        const p = qcPoints[i];
        if (p.nap >= lo && p.nap <= hi) inside.push(p);
        // Detecteer kruisingen met de boven- en ondergrens en voeg
        // geïnterpoleerde punten toe zodat het segment netjes tot aan
        // de grens loopt (anders ontstaat er een gat op de grens).
        if (i > 0) {
          const prev = qcPoints[i - 1];
          for (const bound of [lo, hi]) {
            const a = prev.nap - bound;
            const b = p.nap - bound;
            if (a === 0 || b === 0) continue; // al meegenomen via inside
            if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
              const t = a / (a - b);
              const qcAtBound = prev.qc + t * (p.qc - prev.qc);
              inside.push({ nap: bound, qc: qcAtBound });
            }
          }
        }
      }
      // Sorteer op NAP aflopend (top → bot) zodat de polyline-volgorde
      // overeenkomt met de visuele top-naar-onder volgorde.
      inside.sort((a, b) => b.nap - a.nap);
      if (inside.length < 2) return "";
      return inside
        .map((p) => `${bounds.qcToX(p.qc).toFixed(1)},${bounds.napToY(p.nap).toFixed(1)}`)
        .join(" ");
    },
    [qcPoints, bounds],
  );

  // Basis-curve (alle punten, dunne grijze lijn) — onveranderd t.o.v.
  // origineel maar nu zonder zone-kleuring (die komt eroverheen als
  // afzonderlijke gekleurde segmenten).
  const qcPathFull = useMemo(() => {
    if (qcPoints.length < 2) return "";
    return qcPoints
      .map((p) => `${bounds.qcToX(p.qc).toFixed(1)},${bounds.napToY(p.nap).toFixed(1)}`)
      .join(" ");
  }, [qcPoints, bounds]);

  const depthTicks = useMemo(
    () => buildDepthTicks(bounds.napTop, bounds.napBot),
    [bounds.napTop, bounds.napBot],
  );
  const qcTicks = useMemo(() => buildQcTicks(bounds.qcMax), [bounds.qcMax]);

  // Zone heights:
  //   - 8·Deq above paalpunt (light blue) — invloed-zone qc;III
  //   - 4·Deq MAX below paalpunt (very light red) — outer bound voor dc-zoekruimte
  //   - dc actual below paalpunt (light red, opacity hoger) — werkelijke kritische diepte
  //     zoals gekozen door computeBaseResistance (0,7..4·Deq, geoptimaliseerd voor qb;max-min)
  const deqM = result.base.deqMm / 1000;
  const zone8DM = 8 * deqM;
  const zone4DMaxM = 4 * deqM;
  const zoneDcM = result.base.criticalDepthM; // actual dc, ∈ [0,7·Deq..4·Deq]
  const zoneAboveTop = input.pileToeNap + zone8DM;
  const zone4DMaxBot = input.pileToeNap - zone4DMaxM;
  const zoneDcBot = input.pileToeNap - zoneDcM;

  // Gekleurde qc-curve-segmenten per zone. Berekend in useMemo zodat ze
  // alleen herberekenen wanneer de relevante NAP-grens of qc-data wijzigt.
  // Volgorde van renderen (grijs → 4D-outer dashed → dc bold → 8D bold)
  // bepaalt overschilder-priorit; bold-segmenten komen bovenop grijs.
  const qcSeg8D = useMemo(
    () => qcSegmentPoints(zoneAboveTop, input.pileToeNap),
    [qcSegmentPoints, zoneAboveTop, input.pileToeNap],
  );
  const qcSegDc = useMemo(
    () => qcSegmentPoints(input.pileToeNap, zoneDcBot),
    [qcSegmentPoints, input.pileToeNap, zoneDcBot],
  );
  // 4D-outer: alleen het deel BUITEN dc (van dc-bot tot 4D-max-bot)
  // wordt als dunne dashed-rode lijn getekend, anders zou de bold dc-lijn
  // gewoon overschreven worden door deze faint outer.
  const qcSeg4DOuter = useMemo(
    () => qcSegmentPoints(zoneDcBot, zone4DMaxBot),
    [qcSegmentPoints, zoneDcBot, zone4DMaxBot],
  );

  // Convert NAP-y values up-front for readability.
  const yPileTop = bounds.napToY(input.pileTopNap);
  const yPileToe = bounds.napToY(input.pileToeNap);
  const yWater = bounds.napToY(input.waterNap);
  const yExcavation = bounds.napToY(input.excavationNap);
  const yNkBot = bounds.napToY(input.negKleefBottomNap);
  // Pos-kleef BOVENKANT — default = neg-kleef-ondergrens (pos-kleef begint
  // waar neg-kleef ophoudt). Optional veld in PileInput voor back-compat.
  // Ondergrens van pos-kleef is altijd paalpunt (hard-coded in compute).
  const posKleefTopNap = input.posKleefTopNap ?? input.negKleefBottomNap;
  const yPosKleefTop = bounds.napToY(posKleefTopNap);
  // Zone-grenzen worden geclamped tot het zichtbare plot-bereik, zodat de
  // dashed boundary altijd op de plotrand zit als de zone gedeeltelijk buiten
  // beeld valt. Voor het label-midden gebruiken we de ECHTE NAP-waarde
  // (anders zou bij het uit-beeld scrollen het label "wegschuiven").
  const zoneAboveTopClamped = Math.min(zoneAboveTop, bounds.napTop);
  const zone4DMaxBotClamped = Math.max(zone4DMaxBot, bounds.napBot);
  const zoneDcBotClamped = Math.max(zoneDcBot, bounds.napBot);
  const yZoneAboveTop = bounds.napToY(zoneAboveTopClamped);
  const yZone4DMaxBot = bounds.napToY(zone4DMaxBotClamped);
  const yZoneDcBot = bounds.napToY(zoneDcBotClamped);

  // Right-margin label positions — qc;I, qc;II, qc;III, qb;max all sit
  // somewhere inside de 8D/4D-zone. Labels staan rechts ván de pile-kolom
  // zodat ze niet over de paal-graphic heen vallen.
  const xRightLabel = PILE_COL_X + PILE_COL_W + 8;

  // Is een zone (deels) zichtbaar binnen het huidige plot-bereik?
  const zone8DVisible =
    zoneAboveTop > input.pileToeNap && // zone bestaat
    zoneAboveTopClamped > input.pileToeNap && // bovengrens van zichtbare deel > paalpunt
    input.pileToeNap >= bounds.napBot && input.pileToeNap <= bounds.napTop;
  const zone4DMaxVisible =
    zone4DMaxBot < input.pileToeNap &&
    zone4DMaxBotClamped < input.pileToeNap &&
    input.pileToeNap >= bounds.napBot && input.pileToeNap <= bounds.napTop;
  const zoneDcVisible =
    zoneDcBot < input.pileToeNap &&
    zoneDcBotClamped < input.pileToeNap &&
    input.pileToeNap >= bounds.napBot && input.pileToeNap <= bounds.napTop;

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
      // posKleefTopNap kan undefined zijn in oude IFCX-files; fall-back
      // naar negKleefBottomNap (default = pos-kleef begint waar neg-kleef
      // ophoudt).
      const current = drag.field === "posKleefTopNap"
        ? (input.posKleefTopNap ?? input.negKleefBottomNap)
        : input[drag.field];
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

  // ─── Pan-to-shift (alleen bij ingezoomd) ───────────────────────
  useEffect(() => {
    if (!pan) return;
    const svg = svgRef.current;
    if (!svg) return;

    const onMove = (e: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.height === 0) return;
      const vbPerScreenPx = VB_H / rect.height;
      const dyVb = (e.clientY - pan.startClientY) * vbPerScreenPx;
      // NAP-delta: schuiven naar beneden in pixels = napMin/napMax verlagen
      // (chart inhoud schuift mee met de muis: omlaag = lagere NAP-waarden).
      const napPerVbPx = (pan.startNapMax - pan.startNapMin) / PLOT_H;
      // Natural "grab"-pan: muis naar beneden slepen = data volgt mee omlaag,
      // dus wat boven het zicht zat (hogere NAP) komt in zicht aan de bovenkant.
      // → positief dyVb (mouse-down) → napMin/napMax stijgen.
      const napDelta = dyVb * napPerVbPx;
      let nMin = pan.startNapMin + napDelta;
      let nMax = pan.startNapMax + napDelta;
      const span = pan.startNapMax - pan.startNapMin;
      // Clamp aan volledige data-extent.
      if (nMax > fullExtent.fullNapTop) {
        nMax = fullExtent.fullNapTop;
        nMin = nMax - span;
      }
      if (nMin < fullExtent.fullNapBot) {
        nMin = fullExtent.fullNapBot;
        nMax = nMin + span;
      }
      setZoomDomain({ napMin: nMin, napMax: nMax });
    };
    const onUp = () => setPan(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pan, fullExtent.fullNapTop, fullExtent.fullNapBot]);

  // Body-cursor lock tijdens drag of pan: voorkomt text-cursor flicker bij
  // snel bewegen over labels of buiten de SVG.
  useEffect(() => {
    if (!drag && !pan) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = drag ? "ns-resize" : "grabbing";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [drag, pan]);

  // ─── Shared zoom-logic — gebruikt door wheel én buttons ────────
  // Past een zoom-factor toe rond een specifieke NAP-anker (0..1 ratio
  // binnen huidig zicht). factor < 1 = inzoomen, factor > 1 = uitzoomen.
  // anchorRatio = 0.5 → midden van zicht (gebruikt door + / − knoppen).
  const applyZoom = useCallback((factor: number, anchorRatio: number = 0.5) => {
    const currentMin = zoomDomain ? zoomDomain.napMin : fullExtent.fullNapBot;
    const currentMax = zoomDomain ? zoomDomain.napMax : fullExtent.fullNapTop;
    const anchorNap = currentMax - anchorRatio * (currentMax - currentMin);
    const newSpan = (currentMax - currentMin) * factor;
    const dataRange = fullExtent.fullNapTop - fullExtent.fullNapBot;
    const clampedSpan = Math.max(MIN_ZOOM_SPAN_M, Math.min(dataRange, newSpan));
    // Houd anker op dezelfde positie binnen het nieuwe bereik.
    let nMin = anchorNap - (1 - anchorRatio) * clampedSpan;
    let nMax = nMin + clampedSpan;
    if (nMin < fullExtent.fullNapBot) {
      nMin = fullExtent.fullNapBot;
      nMax = nMin + clampedSpan;
    }
    if (nMax > fullExtent.fullNapTop) {
      nMax = fullExtent.fullNapTop;
      nMin = nMax - clampedSpan;
    }
    if (clampedSpan >= dataRange - 1e-6) {
      setZoomDomain(null);
    } else {
      setZoomDomain({ napMin: nMin, napMax: nMax });
    }
  }, [zoomDomain, fullExtent.fullNapTop, fullExtent.fullNapBot]);

  // Knop: zoom in op paalpunt-zone met 1 m padding boven/onder.
  const zoomToPile = useCallback(() => {
    const napBot = input.pileToeNap - 1;
    const napTop = input.pileTopNap + 1;
    // Clamp aan data-extent en min-span.
    const dataRange = fullExtent.fullNapTop - fullExtent.fullNapBot;
    const span = Math.max(MIN_ZOOM_SPAN_M, Math.min(dataRange, napTop - napBot));
    let nMin = Math.max(fullExtent.fullNapBot, napBot);
    let nMax = nMin + span;
    if (nMax > fullExtent.fullNapTop) {
      nMax = fullExtent.fullNapTop;
      nMin = nMax - span;
    }
    setZoomDomain({ napMin: nMin, napMax: nMax });
  }, [input.pileToeNap, input.pileTopNap, fullExtent.fullNapTop, fullExtent.fullNapBot]);

  const resetZoom = useCallback(() => setZoomDomain(null), []);

  // ─── Mouse-wheel zoom (anchored op cursor-NAP) ─────────────────
  // Via native event-listener i.p.v. React-prop, anders kan preventDefault()
  // niet werken (React maakt 'wheel' standaard passive bij passive scroll).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.height === 0) return;
      // Cursor-positie in viewBox-y, omgezet naar NAP via huidige bounds.
      const vbY = (e.clientY - rect.top) * (VB_H / rect.height);
      // Outside plot-vertical-range: ignore (klikt op marges).
      if (vbY < MARGIN.top || vbY > MARGIN.top + PLOT_H) return;
      // Anchor-ratio: 0 = top van zicht, 1 = bottom van zicht.
      const anchorRatio = (vbY - MARGIN.top) / PLOT_H;
      // Zoom-factor: scroll-up = inzoomen (0.8), scroll-down = uitzoomen (1.25).
      const factor = e.deltaY < 0 ? 0.8 : 1.25;
      applyZoom(factor, anchorRatio);
    };
    // Passive: false zodat preventDefault() page-scroll tegenhoudt.
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
    };
  }, [applyZoom]);

  // Achtergrond-mousedown → start pan (alleen als ingezoomd). Niveau-line-
  // drag heeft prioriteit via stopPropagation() in startDrag().
  const handleBgMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (!zoomDomain) return;
    e.preventDefault();
    setPan({
      startClientY: e.clientY,
      startNapMin: zoomDomain.napMin,
      startNapMax: zoomDomain.napMax,
    });
  };

  const handleDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // Niet resetten als gebruiker dubbelklikte op een niveau-line (om edit-
    // toekomstige feature niet te blokkeren). Voor nu: altijd reset.
    e.preventDefault();
    setZoomDomain(null);
  };

  const bgCursorClass = zoomDomain
    ? (pan ? "pile-cpt-bg-pan-active" : "pile-cpt-bg-pan-ready")
    : "pile-cpt-bg-zoom-ready";

  return (
    <>
      <div className="pile-chart-controls" role="toolbar" aria-label="Chart zoom">
        <button
          type="button"
          className="pile-chart-ctrl-btn"
          title="Zoom in (of scrollwiel omhoog)"
          aria-label="Zoom in"
          onClick={() => applyZoom(0.8)}
        >
          +
        </button>
        <button
          type="button"
          className="pile-chart-ctrl-btn"
          title="Zoom uit (of scrollwiel omlaag)"
          aria-label="Zoom uit"
          onClick={() => applyZoom(1.25)}
        >
          −
        </button>
        <button
          type="button"
          className="pile-chart-ctrl-btn"
          title="Zoom op paalpunt (1 m padding rondom de paal)"
          aria-label="Zoom op paalpunt"
          onClick={zoomToPile}
        >
          ⌂
        </button>
        {zoomDomain && (
          <button
            type="button"
            className="pile-chart-ctrl-btn pile-chart-ctrl-btn--reset"
            title="Reset zoom (of dubbelklik op de grafiek)"
            aria-label="Reset zoom"
            onClick={resetZoom}
          >
            ↺
          </button>
        )}
      </div>
      <svg
        ref={svgRef}
        className="pile-cpt-chart-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="CPT-grafiek met paaloverlays"
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {/* Clip-path: pile en arrows clippen aan het plot-bereik
              zodat ze niet over de assen heen tekenen bij zoom. */}
          <clipPath id="pile-plot-clip">
            <rect
              x={MARGIN.left + PLOT_W + 4}
              y={MARGIN.top}
              width={PILE_COL_W + 60}
              height={PLOT_H}
            />
          </clipPath>
          {/* Arrowhead marker — pijl-omlaag voor Fnk + omhoog voor Rs/Rb. */}
          <marker
            id="pile-arrow-down"
            viewBox="0 0 10 10"
            refX="5"
            refY="9"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,0 L5,10 z" fill="#dc2626" />
          </marker>
          <marker
            id="pile-arrow-up"
            viewBox="0 0 10 10"
            refX="5"
            refY="1"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,10 L10,10 L5,0 z" fill="#16a34a" />
          </marker>
          {/* Gradient voor pos-kleef arcering: van LINKS donker-groen (bij
              y-as = vlak naast paal) naar RECHTS licht-groen (bij qc-curve).
              Dit visualiseert dat de "wrijvings-capaciteit" sterker is dicht
              bij de paal-as dan ver weg. */}
          <linearGradient
            id="pile-cpt-poskleef-grad"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        {/* ─── Plot background (ook pan-hitbox) ─── */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={PLOT_W}
          height={PLOT_H}
          className={`pile-cpt-plot-bg ${bgCursorClass}`}
          onMouseDown={handleBgMouseDown}
        />

      {/* ─── Neg.kleef-zone (paalkop → neg.kleef-grens) — orange band ─── */}
      {input.negKleefBottomNap < input.pileTopNap && (
        <rect
          x={MARGIN.left}
          y={Math.min(yPileTop, yNkBot)}
          width={PLOT_W}
          height={Math.abs(yNkBot - yPileTop)}
          className="pile-cpt-zone-negkleef"
          pointerEvents="none"
        />
      )}

      {/* ─── Pos.kleef-zone (posKleefTopNap → paalpunt) — groen POLYGON ───
              Met linear gradient: LINKS donker-groen (bij y-as, dicht bij
              paal-as) naar RECHTS licht-groen (bij qc-curve). Polygon-stijl
              identiek aan 8D-arcering — loopt langs de y-as en de qc-curve. */}
      {posKleefTopNap > input.pileToeNap && (() => {
        const seg = qcSegmentPoints(posKleefTopNap, input.pileToeNap);
        if (!seg) return null;
        return (
          <polygon
            points={[
              `${MARGIN.left.toFixed(1)},${yPosKleefTop.toFixed(1)}`,
              seg,
              `${MARGIN.left.toFixed(1)},${yPileToe.toFixed(1)}`,
            ].join(" ")}
            fill="url(#pile-cpt-poskleef-grad)"
            pointerEvents="none"
          />
        );
      })()}

      {/* ─── 8D zone above paalpunt — light blue POLYGON ───
              Het polygon loopt langs de y-as (links) → langs de qc-curve
              (rechts via qcSeg8D, gesorteerd top→bot) → terug naar start.
              Hierdoor zit de blauwe arcering ALLEEN tussen plot-links en
              de qc-curve — niet over de hele plot-breedte. Conform
              ExternPakket/referentienorm visualisatiestijl voor de qc;III-invloed. */}
      {zone8DVisible && qcSeg8D && (
        <polygon
          points={[
            `${MARGIN.left.toFixed(1)},${yZoneAboveTop.toFixed(1)}`,
            qcSeg8D,
            `${MARGIN.left.toFixed(1)},${yPileToe.toFixed(1)}`,
          ].join(" ")}
          className="pile-cpt-zone-8d"
          pointerEvents="none"
        />
      )}

      {/* ─── 4D MAX outer band below paalpunt — heel licht rood, dashed bounds ─── */}
      {/*    Visualiseert de outer bound waar dc maximaal naar kan reiken (4·Deq). */}
      {zone4DMaxVisible && (
        <rect
          x={MARGIN.left}
          y={yPileToe}
          width={PLOT_W}
          height={yZone4DMaxBot - yPileToe}
          className="pile-cpt-zone-4d-max"
          pointerEvents="none"
        />
      )}

      {/* ─── dc INNER band below paalpunt — lichtrood, opacity hoger ─── */}
      {/*    Werkelijke kritische diepte zoals gekozen door computeBaseResistance. */}
      {zoneDcVisible && (
        <rect
          x={MARGIN.left}
          y={yPileToe}
          width={PLOT_W}
          height={yZoneDcBot - yPileToe}
          className="pile-cpt-zone-dc"
          pointerEvents="none"
        />
      )}

      {/* ─── 8D / 4D max / dc dashed boundary lines + right-margin labels ─── */}
      {zone8DVisible && (
        <>
          {/* Bovengrens 8D-zone (alleen tekenen als de échte top in zicht is). */}
          {zoneAboveTop <= bounds.napTop && (
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_W}
              y1={yZoneAboveTop}
              y2={yZoneAboveTop}
              className="pile-cpt-zone-boundary"
              pointerEvents="none"
            />
          )}
          <text
            x={xRightLabel}
            y={(yZoneAboveTop + yPileToe) / 2 - 18}
            className="pile-cpt-zone-label pile-cpt-zone-label--8d"
            pointerEvents="none"
          >
            8D = {formatMeters(zone8DM)}
          </text>
        </>
      )}
      {zone4DMaxVisible && (
        <>
          {/* Ondergrens 4D-max (alleen tekenen als de échte bot in zicht is). */}
          {zone4DMaxBot >= bounds.napBot && (
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_W}
              y1={yZone4DMaxBot}
              y2={yZone4DMaxBot}
              className="pile-cpt-zone-boundary pile-cpt-zone-boundary--4d-max"
              pointerEvents="none"
            />
          )}
          <text
            x={xRightLabel}
            y={(yPileToe + yZone4DMaxBot) / 2 + 18}
            className="pile-cpt-zone-label pile-cpt-zone-label--4d"
            pointerEvents="none"
          >
            4D max = {formatMeters(zone4DMaxM)}
          </text>
        </>
      )}
      {zoneDcVisible && (
        <>
          {/* Ondergrens dc-zone (alleen tekenen als de échte bot in zicht is). */}
          {zoneDcBot >= bounds.napBot && (
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_W}
              y1={yZoneDcBot}
              y2={yZoneDcBot}
              className="pile-cpt-zone-boundary pile-cpt-zone-boundary--dc"
              pointerEvents="none"
            />
          )}
          <text
            x={xRightLabel}
            y={(yPileToe + yZoneDcBot) / 2 + 4}
            className="pile-cpt-zone-label pile-cpt-zone-label--dc"
            pointerEvents="none"
          >
            dc = {formatMeters(zoneDcM)}
          </text>
        </>
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
              pointerEvents="none"
            />
            <text
              x={MARGIN.left - 6}
              y={y + 3}
              className="pile-cpt-axis-label"
              textAnchor="end"
              pointerEvents="none"
            >
              {Number.isInteger(nap) ? nap.toFixed(0) : nap.toFixed(2).replace(/\.?0+$/, "")}
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
              pointerEvents="none"
            />
            <text
              x={x}
              y={MARGIN.top - 6}
              className="pile-cpt-axis-label"
              textAnchor="middle"
              pointerEvents="none"
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
        pointerEvents="none"
      >
        q_c [MPa]
      </text>
      <text
        x={18}
        y={MARGIN.top + PLOT_H / 2}
        className="pile-cpt-axis-title"
        textAnchor="middle"
        transform={`rotate(-90 18 ${MARGIN.top + PLOT_H / 2})`}
        pointerEvents="none"
      >
        m NAP
      </text>

      {/* ─── qc curve ───
          Conform ExternPakket + referentienorm-norm-visualisatie: de qc-polyline is
          opgesplitst in gekleurde segmenten per invloed-zone. De basis is
          dun grijs (overal), en de zone-segmenten worden er bovenop
          getekend in zone-kleur.
          Rendering volgorde (achter → voor):
            1. grijze basis-curve (alle punten)
            2. 4D-max outer (dashed dun rood, dc-bot → 4D-bot)
            3. dc-zone (bold rood, paalpunt → dc-bot)
            4. 8D-zone (bold blauw, paalpunt → 8D-top)
          */}
      {qcPathFull && (
        <polyline
          points={qcPathFull}
          className="pile-cpt-qc-curve pile-cpt-qc-curve--base"
          fill="none"
          pointerEvents="none"
        />
      )}
      {qcSeg4DOuter && (
        <polyline
          points={qcSeg4DOuter}
          className="pile-cpt-qc-curve pile-cpt-qc-curve--4d-outer"
          fill="none"
          pointerEvents="none"
        />
      )}
      {qcSegDc && (
        <polyline
          points={qcSegDc}
          className="pile-cpt-qc-curve pile-cpt-qc-curve--dc"
          fill="none"
          pointerEvents="none"
        />
      )}
      {qcSeg8D && (
        <polyline
          points={qcSeg8D}
          className="pile-cpt-qc-curve pile-cpt-qc-curve--8d"
          fill="none"
          pointerEvents="none"
        />
      )}

      {/* ─── Clipped (running-min) qc-curve ───
              De "effectieve" qc-curve na toepassing van de afkapregel uit
              NEN 9997-1 NB:2019 §7.6.2.3. Wordt getekend als donkerblauwe
              stippellijn over de qc;II + qc;III invloed-zone, zodat
              zichtbaar is hoeveel qc er is "weggesnoept" t.o.v. de raw
              meetwaarden. Coordinaten via depth → NAP via groundNap. */}
      {result.base.clippedQcCurve && result.base.clippedQcCurve.length >= 2 && (() => {
        const groundNap = cpt.metadata.ground_level_nap ?? 0;
        const path = result.base.clippedQcCurve
          .map((p) => {
            const nap = groundNap - p.depth;
            return `${bounds.qcToX(p.qcClipped).toFixed(1)},${bounds.napToY(nap).toFixed(1)}`;
          })
          .join(" ");
        return (
          <polyline
            points={path}
            className="pile-cpt-qc-curve pile-cpt-qc-curve--clipped"
            fill="none"
            pointerEvents="none"
          />
        );
      })()}

      {/* ─── Paalkop ─── solid */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yPileTop}
        y2={yPileTop}
        className={`pile-cpt-line-paalkop${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "pileTopNap" ? " pile-niveau-dragging" : ""}`}
        pointerEvents="none"
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
        pointerEvents="none"
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
        pointerEvents="none"
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
        pointerEvents="none"
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
        pointerEvents="none"
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
        pointerEvents="none"
      />
      <text
        x={MARGIN.left + 22}
        y={yWater + 4}
        className="pile-cpt-overlay-label"
        pointerEvents="none"
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
        pointerEvents="none"
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
        pointerEvents="none"
      >
        Neg.kleef-grens {formatNap(input.negKleefBottomNap)}
      </text>

      {/* ─── Pos.kleef-bovenkant ─── dashed groen, altijd zichtbaar (ook
              als gelijk aan neg-kleef-bot — anders weet de gebruiker niet
              dat hij hem kan slepen). Ondergrens van pos-kleef is altijd
              paalpunt en wordt visueel gevormd door de paalpunt-lijn. */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yPosKleefTop}
        y2={yPosKleefTop}
        className={`pile-cpt-line-poskleef${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "posKleefTopNap" ? " pile-niveau-dragging" : ""}`}
        pointerEvents="none"
      />
      <text
        x={MARGIN.left + 4}
        y={yPosKleefTop - 4}
        className="pile-cpt-overlay-label pile-cpt-overlay-label--poskleef"
        pointerEvents="none"
      >
        Pos.kleef-top {formatNap(posKleefTopNap)}
      </text>
      {draggable && (
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_W}
          y1={yPosKleefTop}
          y2={yPosKleefTop}
          className="pile-niveau-hitbox"
          onMouseDown={startDrag("posKleefTopNap", posKleefTopNap)}
        />
      )}

      {/* ─── Paalpunt ─── bold red */}
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={yPileToe}
        y2={yPileToe}
        className={`pile-cpt-line-paalpunt${draggable ? " pile-niveau-draggable" : ""}${drag?.field === "pileToeNap" ? " pile-niveau-dragging" : ""}`}
        pointerEvents="none"
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
        pointerEvents="none"
      >
        Paalpunt {formatNap(input.pileToeNap)} (D_eq = {result.base.deqMm.toFixed(0)} mm)
      </text>

      {/* ─── Pile graphic — paal-elevation in eigen kolom rechts van plot,
              inclusief wapeningskorf voor betongevulde stalen buispalen ─── */}
      <PileGraphic
        input={input}
        result={result}
        material={pileMaterial}
        isCircular={pileIsCircular}
        yPileTop={yPileTop}
        yPileToe={yPileToe}
        yNkBot={yNkBot}
        plotTop={MARGIN.top}
        plotBottom={MARGIN.top + PLOT_H}
        yRebarBot={bounds.napToY(
          Math.max(input.pileToeNap, input.pileTopNap - 4 * (input.diameterMm / 1000)),
        )}
        hasRebarCage={pileMaterial === "steel"}
      />

      {/* ─── In-chart gemiddelde qc-waarden per invloed-zone ───
          Voor elke zone tekenen we een vertikale dashed lijn op
          x = xScale(gemiddelde) over de zone-hoogte, plus een tekst-label
          met halo voor leesbaarheid. Dit is hoe ExternPakket + referentienorm de
          gemiddelde qc-waarde "rechtuit" tegenover de werkelijke curve
          visualiseren — zie verification-files/Constructieberekeningen/
          Funderingspaal/984.pdf.
       */}
      {zone8DVisible && (
        <>
          <line
            x1={bounds.qcToX(result.base.qcIIIGemMpa)}
            x2={bounds.qcToX(result.base.qcIIIGemMpa)}
            y1={yZoneAboveTop}
            y2={yPileToe}
            className="pile-cpt-qc-gem pile-cpt-qc-gem--8d"
            pointerEvents="none"
          />
          <text
            x={bounds.qcToX(result.base.qcIIIGemMpa) + 6}
            y={bounds.napToY((input.pileToeNap + zoneAboveTopClamped) / 2)}
            className="pile-qc-label pile-qc-label--8d"
            pointerEvents="none"
          >
            qc;III;gem = {result.base.qcIIIGemMpa.toFixed(2)} MPa
          </text>
        </>
      )}
      {zoneDcVisible && (
        <>
          {/* qc;I — gemiddelde van paalpunt tot dc-bot */}
          <line
            x1={bounds.qcToX(result.base.qcIGemMpa)}
            x2={bounds.qcToX(result.base.qcIGemMpa)}
            y1={yPileToe}
            y2={yZoneDcBot}
            className="pile-cpt-qc-gem pile-cpt-qc-gem--dc"
            pointerEvents="none"
          />
          <text
            x={bounds.qcToX(result.base.qcIGemMpa) + 6}
            y={bounds.napToY(input.pileToeNap - zoneDcM / 2)}
            className="pile-qc-label pile-qc-label--dc"
            pointerEvents="none"
          >
            qc;I;gem = {result.base.qcIGemMpa.toFixed(2)} MPa
          </text>
          {/* qc;II — zelfde verticale range als qc;I, eigen kleur/dasharray */}
          <line
            x1={bounds.qcToX(result.base.qcIIGemMpa)}
            x2={bounds.qcToX(result.base.qcIIGemMpa)}
            y1={yPileToe}
            y2={yZoneDcBot}
            className="pile-cpt-qc-gem pile-cpt-qc-gem--dc2"
            pointerEvents="none"
          />
          <text
            x={bounds.qcToX(result.base.qcIIGemMpa) + 6}
            y={bounds.napToY(input.pileToeNap - zoneDcM / 2) + 14}
            className="pile-qc-label pile-qc-label--dc2"
            pointerEvents="none"
          >
            qc;II;gem = {result.base.qcIIGemMpa.toFixed(2)} MPa
          </text>
        </>
      )}

      {/* ─── Right-margin: qb;max (compacter — qc;I/II/III staan nu in-chart) ─── */}
      <text
        x={xRightLabel}
        y={yPileToe + 28}
        className="pile-cpt-side-label pile-cpt-side-label--strong"
        pointerEvents="none"
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
          pointerEvents="none"
        />
      </svg>
    </>
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

  // Pile-type bepaalt material + vorm voor de cross-section onderaan.
  const pileType = getPileType(input.pileTypeId);
  const csMaterial: "steel" | "concrete" = pileType?.material ?? "steel";
  const csIsCircular = pileType?.isCircular ?? true;
  // Wapeningskorf alleen voor stalen buispalen (betongevulde composiet);
  // bij prefab voorgespannen beton zien we voorspandraden i.p.v. korf.
  const csHasRebar = csMaterial === "steel";
  // Korf-lengte in mm voor de info-tekst — 4·D vanaf paalkop, geclampt op
  // paallengte zodat we geen onzin-getal tonen voor korte palen.
  const pileLengthMm = Math.max(0, (input.pileTopNap - input.pileToeNap) * 1000);
  const rebarCageLenMm = Math.min(pileLengthMm, 4 * input.diameterMm);

  return (
    <div className="pile-visual">
      <h3>Sondering: {cpt.id}</h3>
      <div className="pile-cpt-chart">
        <CptOverlayChart cpt={cpt} input={input} result={result} onChange={onChange} />
      </div>
      <div className="pile-cross-section-row">
        <PileCrossSection
          diameterMm={input.diameterMm}
          wallThicknessMm={input.wallThicknessMm}
          material={csMaterial}
          isCircular={csIsCircular}
          hasRebarCage={csHasRebar}
        />
        <div className="pile-cross-section-info">
          <div className="pile-cross-section-title">Doorsnede</div>
          <table className="pile-cross-section-table">
            <tbody>
              <tr>
                <td>{csIsCircular ? "ø" : "□"}</td>
                <td>{input.diameterMm.toFixed(0)} mm</td>
              </tr>
              {csMaterial === "steel" && (
                <tr>
                  <td>wand</td>
                  <td>{input.wallThicknessMm.toFixed(1)} mm</td>
                </tr>
              )}
              {csHasRebar && (
                <tr>
                  <td>wapeningskorf</td>
                  <td>4·D = {rebarCageLenMm.toFixed(0)} mm</td>
                </tr>
              )}
              <tr>
                <td>materiaal</td>
                <td>
                  {csMaterial === "steel"
                    ? "Stalen buispaal, betongevuld"
                    : "Prefab voorgespannen beton"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
