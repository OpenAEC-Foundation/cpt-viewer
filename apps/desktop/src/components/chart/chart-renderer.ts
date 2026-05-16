/**
 * CPT Chart Renderer — pure Canvas drawing.
 *
 * Ported from `_archive/vanilla-js/js/cpt-chart.js`.
 *
 * Renders one or more CPTs side-by-side as stacked panels:
 *   [Depth axis] [SBT strip] [qc] [fs] [Rf] [u2 (optional)]   per CPT
 *
 * Each CPT gets a depth axis on its left side so multi-CPT comparison
 * remains readable. Depth grows downward (m below ground).
 *
 * Public API:
 *   - renderChart(ctx, cpts, opts, curves)
 *   - hitTest(cpts, opts, x, y) → HitResult | null
 *   - hitTestSplitter(cpts, opts, x, y) → splitter index (between cols i and i+1) | null
 *   - computeColumnLayout(cpts, opts) → array of { left, width } per CPT
 *
 * Purity contract: no DOM mutation, no React, no event handlers, no
 * window globals beyond `getComputedStyle(document.documentElement)`
 * which is read once at the top of renderChart.
 */
import type { Cpt, MeasurementPoint } from "../../types/cpt";

// ─────────────────────────────────────────────────────────────
// Robertson SBT (1990) — simplified Dutch-practice approximation.
// Mirrors `_archive/vanilla-js/js/robertson.js` and (eventually)
// `crates-warehouse/cpt-core/src/robertson.rs`.
// ─────────────────────────────────────────────────────────────

export interface RobertsonZone {
  zone: number;
  name: string;
  color: string;
}

export const ROBERTSON_ZONES: RobertsonZone[] = [
  { zone: 1, name: "Gevoelig fijnkorrelig", color: "#00BCD4" },
  { zone: 2, name: "Organisch / veen",      color: "#795548" },
  { zone: 3, name: "Klei",                  color: "#4CAF50" },
  { zone: 4, name: "Silt mengsels",         color: "#8BC34A" },
  { zone: 5, name: "Zand mengsels",         color: "#FFC107" },
  { zone: 6, name: "Zand",                  color: "#FF9800" },
  { zone: 7, name: "Grof zand / grind",     color: "#FF5722" },
  { zone: 8, name: "Zeer vast zand/klei",   color: "#F44336" },
  { zone: 9, name: "Zeer vast fijnkorrelig", color: "#9C27B0" },
];

export function classifyRobertson(qc: number | undefined, rf: number | undefined): RobertsonZone | null {
  if (qc == null || rf == null) return null;
  if (qc <= 0 || rf < 0) return null;

  if (qc > 25) {
    if (rf < 1) return ROBERTSON_ZONES[6];
    return ROBERTSON_ZONES[7];
  }
  if (qc > 10) {
    if (rf < 0.5) return ROBERTSON_ZONES[6];
    if (rf < 1.5) return ROBERTSON_ZONES[5];
    if (rf < 3) return ROBERTSON_ZONES[4];
    return ROBERTSON_ZONES[7];
  }
  if (qc > 5) {
    if (rf < 1) return ROBERTSON_ZONES[5];
    if (rf < 2) return ROBERTSON_ZONES[4];
    if (rf < 4) return ROBERTSON_ZONES[3];
    if (rf < 6) return ROBERTSON_ZONES[2];
    return ROBERTSON_ZONES[8];
  }
  if (qc > 2) {
    if (rf < 1) return ROBERTSON_ZONES[4];
    if (rf < 2.5) return ROBERTSON_ZONES[3];
    if (rf < 5) return ROBERTSON_ZONES[2];
    if (rf < 8) return ROBERTSON_ZONES[1];
    return ROBERTSON_ZONES[0];
  }
  if (qc > 0.5) {
    if (rf < 1.5) return ROBERTSON_ZONES[3];
    if (rf < 4) return ROBERTSON_ZONES[2];
    if (rf < 8) return ROBERTSON_ZONES[1];
    return ROBERTSON_ZONES[0];
  }
  if (rf < 5) return ROBERTSON_ZONES[2];
  if (rf < 10) return ROBERTSON_ZONES[1];
  return ROBERTSON_ZONES[0];
}

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface ChartRenderOptions {
  width: number;
  height: number;
  /** 1.0 = depth range fits. >1 zooms in (smaller visible range). */
  zoom: number;
  /** Vertical pan offset in meters (positive shifts the visible range deeper). */
  panY: number;
  /** Horizontal pan as a fraction of each axis maximum (0 = default). */
  panX: number;
  /**
   * Per-CPT column width ratios. Sum is normalized internally.
   * Length must equal `cpts.length`; otherwise renderer falls back to even split.
   */
  columnRatios?: number[];
  /**
   * Optional reference marker(s) — horizontal lines drawn across all panels.
   * Each marker is anchored either to NAP (preferred: shared across CPTs)
   * or to depth (fallback for CPTs without known ground-level).
   *
   * Backwards compat: `marker` (singular) is still accepted for existing
   * callers; if both are present the singular is appended to `markers`.
   */
  markers?: { nap?: number; depth?: number }[];
  marker?: { nap?: number; depth?: number };
  /**
   * Optional hover indicator — short dashed line + bullets on every curve
   * at the hovered depth, with value labels. Set by ChartCanvas on mousemove.
   */
  hover?: { cptId: string; depth: number };
  /** Currently-active CPT id — drawn with an amber accent in its tab strip. */
  activeCptId?: string | null;
}

export interface ChartCurves {
  qc: boolean;
  fs: boolean;
  rf: boolean;
  u2: boolean;
}

export interface HitResult {
  cptId: string;
  /** Depth below ground level in metres. */
  depth: number;
  /** Depth relative to NAP (m), if the CPT has a known ground-level. */
  depthNap?: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  zone: RobertsonZone | null;
}

/** Width (px) of the splitter hit zone between adjacent CPT columns. */
export const SPLITTER_HALF_WIDTH = 4;

/** Vertical hit zone (px) for grabbing the horizontal reference marker. */
export const MARKER_HALF_HEIGHT = 5;

// ─────────────────────────────────────────────────────────────
// Internal layout helpers
// ─────────────────────────────────────────────────────────────

interface PanelRect {
  l: number;
  w: number;
}

interface CptLayout {
  cptLeft: number;   // left x of this CPT's column group
  cptWidth: number;
  hasU2: boolean;
  depthW: number;
  soil: PanelRect;
  qc: PanelRect;
  fs: PanelRect;
  rf: PanelRect;
  u2?: PanelRect;
}

interface SharedLayout {
  plotT: number;
  plotB: number;
  plotH: number;
  headerH: number;
  /** Height of the per-CPT name tab strip above the chart panels (0 if a single CPT). */
  tabH: number;
  narrow: boolean;
}

interface CptScales {
  depthMin: number;
  depthMax: number;
  qcMax: number;
  fsMax: number;
  rfMax: number;
  u2Max: number;
  hasU2: boolean;
}

interface ChartColors {
  bg: string;
  panelBg: string;
  grid: string;
  gridMajor: string;
  border: string;
  text: string;
  textBright: string;
  headerBg: string;
  splitter: string;
  qc: string;
  fs: string;
  rf: string;
  u2: string;
}

function readColors(): ChartColors {
  // Both surface and curve colors come from CSS variables so the chart
  // tracks the active theme. The fallbacks match OpenAEC light defaults.
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const cs = root ? getComputedStyle(root) : null;
  const cssVar = (name: string, fallback: string): string => {
    if (!cs) return fallback;
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  const bg = cssVar("--theme-bg", "#FAFAF9");
  const panelBg = cssVar("--theme-bg-elevated", cssVar("--theme-bg-lighter", "#FFFFFF"));
  const text = cssVar("--theme-text", "#36363E");
  const gridLine = cssVar("--theme-border-subtle", "#E7E5E4");
  const gridMajor = cssVar("--theme-border", "#D6D3D1");
  return {
    bg,
    panelBg,
    grid: gridLine,
    gridMajor,
    border: gridMajor,
    text,
    textBright: text,
    headerBg: panelBg,
    splitter: gridMajor,
    qc: cssVar("--domain-cpt-qc", "#D97706"),
    fs: cssVar("--domain-cpt-fs", "#EA580C"),
    rf: cssVar("--domain-cpt-rf", "#F59E0B"),
    u2: cssVar("--domain-cpt-u2", "#2563EB"),
  };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  if (n <= 1.0) return p;
  if (n <= 1.5) return 1.5 * p;
  if (n <= 2.0) return 2 * p;
  if (n <= 3.0) return 3 * p;
  if (n <= 5.0) return 5 * p;
  return 10 * p;
}

function niceStep(range: number, targetSteps: number): number {
  if (range <= 0) return 1;
  const raw = range / Math.max(2, targetSteps);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  if (n <= 1) return p;
  if (n <= 2) return 2 * p;
  if (n <= 5) return 5 * p;
  return 10 * p;
}

function fmtScale(v: number): string {
  if (v === 0) return "0";
  if (v >= 10) return v % 1 === 0 ? v.toString() : v.toFixed(0);
  if (v >= 1) return v % 1 === 0 ? v.toString() : v.toFixed(1);
  if (v >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

/** Compute per-CPT data scales (depth bounds, qc/fs/rf maxes, has-u2). */
function computeScales(points: MeasurementPoint[]): CptScales {
  const depths = points
    .map((p) => (p.depth != null ? Math.abs(p.depth) : null))
    .filter((d): d is number => d !== null);
  const depthMin = 0;
  const depthMax = depths.length ? Math.ceil(Math.max(...depths) * 1.02 + 0.5) : 30;

  const positive = (k: keyof MeasurementPoint) =>
    points
      .map((p) => p[k])
      .filter((v): v is number => typeof v === "number" && v > 0);

  // Pinned axis ranges per Dutch geotechnical convention:
  //   qc default 0-30 MPa (auto-extends if measured peak exceeds 30)
  //   Rf  default 0-10 %  (auto-extends if measured peak exceeds 10)
  // fs is auto-fit because its scale varies more by soil type.
  const qcPeak = Math.max(0, ...positive("qc"));
  const rfPeak = Math.max(0, ...positive("rf"));
  const qcMax = qcPeak > 30 ? niceMax(qcPeak) : 30;
  const fsMax = niceMax(Math.max(0.01, ...positive("fs")));
  const rfMax = rfPeak > 10 ? niceMax(rfPeak) : 10;

  const u2vals = points.map((p) => p.u2).filter((v): v is number => v != null);
  const hasU2 = u2vals.length > 10;
  let u2Max = 1;
  if (hasU2) {
    const u2pos = u2vals.filter((v) => v > 0);
    u2Max = niceMax(Math.max(0.01, ...(u2pos.length > 0 ? u2pos : [0.5])));
  }

  return { depthMin, depthMax, qcMax, fsMax, rfMax, u2Max, hasU2 };
}

/** Compute the visible depth window from base depth range + zoom + panY. */
function visibleDepthWindow(scales: CptScales, zoom: number, panY: number) {
  const fullRange = scales.depthMax - scales.depthMin;
  const visibleRange = fullRange / Math.max(0.05, zoom);
  const center = (scales.depthMin + scales.depthMax) / 2 + panY;
  return {
    depthViewMin: center - visibleRange / 2,
    depthViewMax: center + visibleRange / 2,
  };
}

function layoutShared(opts: ChartRenderOptions, cptCount: number = 1): SharedLayout {
  const narrow = opts.width < 280;
  const headerH = 28;
  // When showing multiple CPTs we reserve a 24px strip ABOVE the panels for
  // a centred CPT-name tab per column. Single-CPT view keeps the chart taller.
  const tabH = cptCount > 1 ? 24 : 0;
  const bottomPad = 4;
  const plotT = headerH + tabH;
  const plotB = opts.height - bottomPad;
  return {
    plotT,
    plotB,
    plotH: plotB - plotT,
    headerH,
    tabH,
    narrow,
  };
}

/** Per-CPT column layout inside its allocated horizontal slot. */
function layoutCpt(
  cptLeft: number,
  cptWidth: number,
  hasU2: boolean,
  narrow: boolean,
): CptLayout {
  // Depth axis is wider when narrow=false to fit stacked depth/NAP labels.
  const depthW = narrow ? 36 : 50;
  const soilW = narrow ? 14 : 22;
  const gap = 1;

  const avail = cptWidth - depthW - soilW - gap * (hasU2 ? 5 : 4);

  let qcW: number, fsW: number, rfW: number, u2W: number;
  if (hasU2) {
    qcW = Math.floor(avail * 0.35);
    fsW = Math.floor(avail * 0.20);
    rfW = Math.floor(avail * 0.22);
    u2W = avail - qcW - fsW - rfW;
  } else {
    qcW = Math.floor(avail * 0.45);
    fsW = Math.floor(avail * 0.25);
    rfW = avail - qcW - fsW;
    u2W = 0;
  }

  let x = cptLeft + depthW;
  const soilL = x; x += soilW + gap;
  const qcL   = x; x += qcW + gap;
  const fsL   = x; x += fsW + gap;
  const rfL   = x; x += rfW + gap;
  const u2L   = x;

  const layout: CptLayout = {
    cptLeft,
    cptWidth,
    hasU2,
    depthW,
    soil: { l: soilL, w: soilW },
    qc:   { l: qcL,   w: qcW },
    fs:   { l: fsL,   w: fsW },
    rf:   { l: rfL,   w: rfW },
  };
  if (hasU2) layout.u2 = { l: u2L, w: u2W };
  return layout;
}

/** Convert depth (m) to canvas y. */
function depthToY(d: number, shared: SharedLayout, depthViewMin: number, depthViewMax: number): number {
  return shared.plotT + ((d - depthViewMin) / (depthViewMax - depthViewMin)) * shared.plotH;
}

/** Convert canvas y to depth (m). */
function yToDepth(y: number, shared: SharedLayout, depthViewMin: number, depthViewMax: number): number {
  return depthViewMin + ((y - shared.plotT) / shared.plotH) * (depthViewMax - depthViewMin);
}

/** Lightweight per-CPT computed state used by render + hit-test. */
interface CptComputed {
  cpt: Cpt;
  scales: CptScales;
  layout: CptLayout;
  depthViewMin: number;
  depthViewMax: number;
  depths: (number | null)[];
  /**
   * Per-axis "view min" / "view max" — the bounds currently visible.
   * Width = scales.{q,f,r,u}Max / zoom so horizontal zoom mirrors depth zoom.
   * Min = panX * scales.{q,f,r,u}Max so horizontal pan slides the window.
   */
  qcViewMin: number;
  qcViewMax: number;
  fsViewMin: number;
  fsViewMax: number;
  rfViewMin: number;
  rfViewMax: number;
  u2ViewMin: number;
  u2ViewMax: number;
}

/**
 * Compute per-CPT column slot widths from `columnRatios`.
 * Falls back to an even split when ratios are missing or mis-shaped.
 */
function computeSlotWidths(opts: ChartRenderOptions, cptCount: number): number[] {
  if (cptCount <= 0) return [];
  const ratios =
    opts.columnRatios && opts.columnRatios.length === cptCount
      ? opts.columnRatios
      : new Array(cptCount).fill(1);
  const sum = ratios.reduce((a, b) => a + Math.max(0.0001, b), 0);
  return ratios.map((r) => (Math.max(0.0001, r) / sum) * opts.width);
}

function computeAll(cpts: Cpt[], opts: ChartRenderOptions, shared: SharedLayout): CptComputed[] {
  if (cpts.length === 0) return [];
  const slotWidths = computeSlotWidths(opts, cpts.length);
  const zoom = Math.max(0.05, opts.zoom);
  const panX = Number.isFinite(opts.panX) ? opts.panX : 0;

  // Pass 1 — per-CPT base scales.
  const scalesArr = cpts.map((cpt) => computeScales(cpt.points));

  // Pass 2 — compute a SHARED NAP window across all CPTs that have
  // `ground_level_nap`. This keeps NAP=0 anchored at the same y-pixel for
  // every CPT in a multi-CPT view, so cross-CPT comparison is honest.
  // Top of the chart = the highest ground level; bottom = the deepest NAP
  // point reached by any CPT. CPTs without NAP fall back to their own
  // depth range (legacy behavior).
  let sharedNapTop: number | null = null;     // highest NAP value (top of chart)
  let sharedNapBottom: number | null = null;  // most negative NAP (bottom of chart)
  for (let i = 0; i < cpts.length; i++) {
    const groundNap = cpts[i].metadata.ground_level_nap;
    if (typeof groundNap !== "number") continue;
    const napAtBottom = groundNap - scalesArr[i].depthMax;
    if (sharedNapTop === null || groundNap > sharedNapTop) sharedNapTop = groundNap;
    if (sharedNapBottom === null || napAtBottom < sharedNapBottom) sharedNapBottom = napAtBottom;
  }
  const haveSharedNap = sharedNapTop !== null && sharedNapBottom !== null && sharedNapTop > sharedNapBottom;

  let cursor = 0;
  return cpts.map((cpt, i) => {
    const scales = scalesArr[i];
    const slotW = slotWidths[i];
    const layout = layoutCpt(cursor, slotW, scales.hasU2, shared.narrow);
    cursor += slotW;

    // Depth view: prefer the shared-NAP window (mapped back into this
    // CPT's depth-below-ground frame). Fall back to per-CPT depth window
    // if this CPT lacks ground_level_nap or if no CPT in the set has it.
    const groundNap = cpt.metadata.ground_level_nap;
    let cptDepthViewMin: number;
    let cptDepthViewMax: number;
    if (haveSharedNap && typeof groundNap === "number") {
      // depth = groundNap - nap, so the depth at sharedNapTop (top of chart)
      // is `groundNap - sharedNapTop`. For CPTs whose ground level is below
      // the highest, this yields a negative depth (i.e. the chart top is
      // ABOVE this CPT's surface) — the curve naturally starts further
      // down because drawCurve is clipped to the panel.
      const fullMin = groundNap - sharedNapTop!;
      const fullMax = groundNap - sharedNapBottom!;
      const fullRange = fullMax - fullMin;
      const visibleRange = fullRange / Math.max(0.05, zoom);
      const center = (fullMin + fullMax) / 2 + opts.panY;
      cptDepthViewMin = center - visibleRange / 2;
      cptDepthViewMax = center + visibleRange / 2;
    } else {
      const win = visibleDepthWindow(scales, opts.zoom, opts.panY);
      cptDepthViewMin = win.depthViewMin;
      cptDepthViewMax = win.depthViewMax;
    }

    const depths = cpt.points.map((p) => (p.depth != null ? Math.abs(p.depth) : null));
    const qcWindow = Math.max(0.1,  scales.qcMax / zoom);
    const fsWindow = Math.max(0.01, scales.fsMax / zoom);
    const rfWindow = Math.max(0.1,  scales.rfMax / zoom);
    const u2Window = Math.max(0.01, scales.u2Max / zoom);
    const qcViewMin = panX * scales.qcMax;
    const fsViewMin = panX * scales.fsMax;
    const rfViewMin = panX * scales.rfMax;
    const u2ViewMin = panX * scales.u2Max;
    return {
      cpt, scales, layout,
      depthViewMin: cptDepthViewMin,
      depthViewMax: cptDepthViewMax,
      depths,
      qcViewMin,
      qcViewMax: qcViewMin + qcWindow,
      fsViewMin,
      fsViewMax: fsViewMin + fsWindow,
      rfViewMin,
      rfViewMax: rfViewMin + rfWindow,
      u2ViewMin,
      u2ViewMax: u2ViewMin + u2Window,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Drawing primitives
// ─────────────────────────────────────────────────────────────

function drawSoilStrip(
  ctx: CanvasRenderingContext2D,
  shared: SharedLayout,
  c: CptComputed,
) {
  const p = c.layout.soil;
  // Build classified bands on the fly — same simple consecutive-merge logic
  // as Robertson.mergeLayers but without thin-layer pruning, so the strip
  // matches the chart 1:1.
  let bandStartDepth: number | null = null;
  let bandZone: RobertsonZone | null = null;
  let bandLastDepth = 0;

  const flush = () => {
    if (bandZone == null || bandStartDepth == null) return;
    const y1 = Math.max(depthToY(bandStartDepth, shared, c.depthViewMin, c.depthViewMax), shared.plotT);
    const y2 = Math.min(depthToY(bandLastDepth, shared, c.depthViewMin, c.depthViewMax), shared.plotB);
    if (y2 <= y1) return;
    ctx.fillStyle = bandZone.color;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(p.l, y1, p.w, y2 - y1);
    // Light wash behind qc panel.
    ctx.globalAlpha = 0.08;
    ctx.fillRect(c.layout.qc.l, y1, c.layout.qc.w, y2 - y1);
    ctx.globalAlpha = 1;
  };

  for (let i = 0; i < c.cpt.points.length; i++) {
    const d = c.depths[i];
    if (d == null) continue;
    const pt = c.cpt.points[i];
    const z = classifyRobertson(pt.qc, pt.rf);
    if (z == null) continue;

    if (bandZone == null) {
      bandZone = z;
      bandStartDepth = d;
      bandLastDepth = d;
    } else if (z.zone === bandZone.zone) {
      bandLastDepth = d;
    } else {
      flush();
      bandZone = z;
      bandStartDepth = d;
      bandLastDepth = d;
    }
  }
  flush();
}

function drawGridH(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  c: CptComputed,
) {
  const range = c.depthViewMax - c.depthViewMin;
  const step = niceStep(range, 8);
  const totalL = c.layout.soil.l;
  const lastPanel = c.layout.u2 ?? c.layout.rf;
  const totalR = lastPanel.l + lastPanel.w;

  for (
    let d = Math.ceil(c.depthViewMin / step) * step;
    d <= c.depthViewMax;
    d = +(d + step).toFixed(6)
  ) {
    const y = Math.round(depthToY(d, shared, c.depthViewMin, c.depthViewMax)) + 0.5;
    if (y < shared.plotT || y > shared.plotB) continue;
    const major = Math.abs(d - Math.round(d)) < 0.001;
    ctx.strokeStyle = major ? colors.gridMajor : colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(totalL, y);
    ctx.lineTo(totalR, y);
    ctx.stroke();
  }
}

/**
 * Pick a step from a fixed candidate ladder (largest first).
 * Returns the smallest step such that no more than ~12 ticks land in the
 * visible range. This guarantees grid lines always sit on "logical"
 * positions (multiples of 5, 1, 0.5, 0.1 …) regardless of zoom — no more
 * weird off-grid divisions like 2/4/6/8 when the user zoomed qc to 0–15.
 */
function pickLadderStep(range: number, ladder: number[], maxTicks = 12): number {
  if (range <= 0) return ladder[0];
  for (const s of ladder) {
    if (range / s <= maxTicks) return s;
  }
  return ladder[ladder.length - 1];
}

/** Default ladder for qc / fs / u2 (MPa) and rf (%) — covers reasonable zoom range. */
const QC_LADDER = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const FS_LADDER = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
const RF_LADDER = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05];
const U2_LADDER = FS_LADDER;

function drawGridV(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  panel: PanelRect,
  minVal: number,
  maxVal: number,
  ladder: number[] = QC_LADDER,
) {
  const range = maxVal - minVal;
  if (range <= 0) return;
  const step = pickLadderStep(range, ladder);
  // Major step = the largest step in the ladder (e.g. 5 for qc) — those
  // ticks get a heavier line. Always emphasises the "primary" grid.
  const majorStep = ladder[0];

  ctx.lineWidth = 1;
  for (
    let v = Math.ceil(minVal / step) * step;
    v <= maxVal + 1e-9;
    v = +(v + step).toFixed(6)
  ) {
    if (Math.abs(v - minVal) < 1e-9) continue;   // skip the panel edge
    if (Math.abs(v - maxVal) < 1e-9) continue;
    const x = Math.round(panel.l + ((v - minVal) / range) * panel.w) + 0.5;
    // A line is "major" when it sits on a multiple of the largest ladder
    // step. Concretely for qc that's every multiple of 5 MPa, even when
    // we're also drawing 1-MPa lines because the user zoomed in.
    const ratio = v / majorStep;
    const major = Math.abs(ratio - Math.round(ratio)) < 1e-6;
    ctx.strokeStyle = major ? colors.gridMajor : colors.grid;
    ctx.beginPath();
    ctx.moveTo(x, shared.plotT);
    ctx.lineTo(x, shared.plotB);
    ctx.stroke();
  }
}

function drawPanelHeader(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  panel: PanelRect,
  label: string,
  color: string,
  minVal: number | null,
  maxVal: number | null,
) {
  const cx = panel.l + panel.w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Pick a font size that lets the longer Dutch labels still fit. We
  // measure the text and step down once if it'd overflow the panel.
  let labelFont = `600 ${shared.narrow ? 9 : 10}px Inter, system-ui, sans-serif`;
  ctx.font = labelFont;
  let displayLabel = label;
  let textW = ctx.measureText(displayLabel).width;
  if (textW > panel.w - 4) {
    labelFont = `600 ${shared.narrow ? 8 : 9}px Inter, system-ui, sans-serif`;
    ctx.font = labelFont;
    textW = ctx.measureText(displayLabel).width;
    if (textW > panel.w - 4) {
      // Last resort: trim with an ellipsis so we never spill into a neighbour.
      while (displayLabel.length > 2 && ctx.measureText(displayLabel + "…").width > panel.w - 4) {
        displayLabel = displayLabel.slice(0, -1);
      }
      displayLabel += "…";
    }
  }
  ctx.fillStyle = color;
  ctx.fillText(displayLabel, cx, 3);

  if (maxVal !== null && panel.w > 30) {
    ctx.font = `${shared.narrow ? 7 : 9}px "JetBrains Mono", monospace`;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.fillText(fmtScale(minVal ?? 0), panel.l + 2, 15);
    ctx.textAlign = "right";
    ctx.fillText(fmtScale(maxVal), panel.l + panel.w - 2, 15);

    if (panel.w > 60) {
      ctx.textAlign = "center";
      ctx.fillText(fmtScale(((minVal ?? 0) + maxVal) / 2), cx, 15);
    }
  }
}

function drawDepthAxis(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  c: CptComputed,
) {
  const range = c.depthViewMax - c.depthViewMin;
  const step = niceStep(range, 8);
  const groundNap = c.cpt.metadata.ground_level_nap;
  const hasNap = typeof groundNap === "number";
  const labelRight = c.layout.cptLeft + c.layout.depthW - 4;
  const depthFont = `${shared.narrow ? 8 : 9}px "JetBrains Mono", monospace`;

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = depthFont;
  ctx.fillStyle = colors.text;

  for (
    let d = Math.ceil(c.depthViewMin / step) * step;
    d <= c.depthViewMax;
    d = +(d + step).toFixed(6)
  ) {
    const y = depthToY(d, shared, c.depthViewMin, c.depthViewMax);
    if (y < shared.plotT + 6 || y > shared.plotB - 3) continue;

    // Show NAP value if ground-level is known, else fall back to depth
    // below ground (always reported as a negative number — convention:
    // depth grows downward, so deeper = more negative).
    const label = hasNap
      ? formatNap(groundNap! - d)
      : (-d).toFixed(1);
    ctx.fillText(label, labelRight, y);
  }

  if (!shared.narrow) {
    ctx.save();
    ctx.translate(c.layout.cptLeft + 10, shared.plotT + shared.plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.fillStyle = colors.text;
    ctx.fillText(hasNap ? "NAP (m)" : "Diepte (m)", 0, 0);
    ctx.restore();
  }
}

/** Format an NAP value: "+2.50" or "-12.50". */
function formatNap(v: number): string {
  if (v >= 0) return `+${v.toFixed(2)}`;
  return v.toFixed(2);
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  shared: SharedLayout,
  c: CptComputed,
  panel: PanelRect,
  key: "qc" | "fs" | "rf" | "u2",
  minVal: number,
  maxVal: number,
  color: string,
  lineWidth: number,
) {
  const span = maxVal - minVal;
  if (span <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.l, shared.plotT, panel.w, shared.plotH);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < c.cpt.points.length; i++) {
    const d = c.depths[i];
    const v = c.cpt.points[i][key];
    if (d == null || v == null) {
      started = false;
      continue;
    }
    const x = panel.l + ((v - minVal) / span) * panel.w;
    const y = depthToY(d, shared, c.depthViewMin, c.depthViewMax);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawPanelBorder(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  panel: PanelRect,
) {
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.l + 0.5, shared.plotT + 0.5, panel.w - 1, shared.plotH - 1);
}

/**
 * Draw a thin vertical splitter between two adjacent CPT columns.
 * The splitter sits at the boundary x and is purely a visual cue —
 * hit-testing is handled by `hitTestSplitter`.
 */
function drawSplitter(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  x: number,
  height: number,
) {
  // Slightly stronger than the panel border so it reads as draggable.
  ctx.fillStyle = colors.splitter;
  const w = 2;
  ctx.fillRect(Math.round(x) - w / 2, shared.plotT, w, height);
  // Grip dots at vertical midpoint
  const cy = shared.plotT + height / 2;
  ctx.fillStyle = colors.text;
  ctx.globalAlpha = 0.55;
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(Math.round(x) - 1, Math.round(cy + i * 6), 2, 2);
  }
  ctx.globalAlpha = 1;
}

/** Convert a marker (NAP-anchored or depth-anchored) to a depth in this CPT's frame. */
function markerDepthForCpt(c: CptComputed, marker: { nap?: number; depth?: number }): number | null {
  if (marker.nap != null) {
    const groundNap = c.cpt.metadata.ground_level_nap;
    if (typeof groundNap === "number") return groundNap - marker.nap;
    // CPT has no NAP reference but marker is in NAP — use the depth-fallback
    // if the caller provided one; otherwise we can't place the marker here.
    if (marker.depth != null) return marker.depth;
    return null;
  }
  if (marker.depth != null) return marker.depth;
  return null;
}

/**
 * Draw the horizontal reference marker across all panels of a single CPT.
 * Blue line + grip dots at the right edge + depth/NAP label at the right.
 *
 * Also draws colored bullets + value labels at each curve intersection,
 * so the marker reports qc/fs/Rf/u2 at its anchored depth — like the
 * hover indicator, but persistent.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  c: CptComputed,
  marker: { nap?: number; depth?: number },
) {
  const depth = markerDepthForCpt(c, marker);
  if (depth == null) return;
  if (depth < c.depthViewMin || depth > c.depthViewMax) return;
  const y = Math.round(depthToY(depth, shared, c.depthViewMin, c.depthViewMax)) + 0.5;

  const lastPanel = c.layout.u2 ?? c.layout.rf;
  const xStart = c.layout.soil.l;
  const xEnd = lastPanel.l + lastPanel.w;

  // Use OpenAEC info-blue for the reference marker (visually distinct
  // from the amber qc curve and the orange fs curve).
  const markerColor = colors.u2;

  ctx.strokeStyle = markerColor;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(xStart, y);
  ctx.lineTo(xEnd, y);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Grip dots near the right edge — visual hint that you can drag.
  ctx.fillStyle = markerColor;
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(xEnd - 8 + i * 4, Math.round(y) - 1, 2, 2);
  }

  // ── Per-curve intersection bullets + value labels ──
  // Find the closest measurement point to the marker depth (same logic
  // as drawHoverIndicator) and draw a colored bullet + value on every
  // curve so the marker reports qc/fs/Rf/u2 at its anchored depth.
  let bestI = -1;
  let bestDist = Infinity;
  for (let i = 0; i < c.cpt.points.length; i++) {
    const dPt = c.depths[i];
    if (dPt == null) continue;
    const dist = Math.abs(dPt - depth);
    if (dist < bestDist) { bestDist = dist; bestI = i; }
  }
  if (bestI >= 0) {
    const pt = c.cpt.points[bestI];
    type Series = { panel: PanelRect; min: number; max: number; color: string; value?: number; fmt: (v: number) => string };
    const series: Series[] = [
      { panel: c.layout.qc, min: c.qcViewMin, max: c.qcViewMax, color: colors.qc, value: pt.qc, fmt: (v) => v.toFixed(2) },
      { panel: c.layout.fs, min: c.fsViewMin, max: c.fsViewMax, color: colors.fs, value: pt.fs, fmt: (v) => v.toFixed(3) },
      { panel: c.layout.rf, min: c.rfViewMin, max: c.rfViewMax, color: colors.rf, value: pt.rf, fmt: (v) => v.toFixed(2) },
    ];
    if (c.layout.u2) {
      series.push({ panel: c.layout.u2, min: c.u2ViewMin, max: c.u2ViewMax, color: colors.u2, value: pt.u2, fmt: (v) => v.toFixed(3) });
    }

    ctx.font = '600 9px "JetBrains Mono", monospace';
    for (const s of series) {
      if (s.value == null) continue;
      const span = s.max - s.min;
      if (span <= 0) continue;
      const t = Math.max(0, Math.min(1, (s.value - s.min) / span));
      const bx = s.panel.l + t * s.panel.w;
      // White halo + filled colored bullet (matches curve color).
      ctx.fillStyle = colors.bg;
      ctx.beginPath();
      ctx.arc(bx, y, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(bx, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      // Value label — placed above the bullet, with a halo for readability.
      const txt = s.fmt(s.value);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const labelY = Math.max(shared.plotT + 10, y - 7);
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(txt, bx, labelY);
      ctx.fillStyle = s.color;
      ctx.fillText(txt, bx, labelY);
    }
  }

  // Depth label on the right side, anchored to the marker line.
  const groundNap = c.cpt.metadata.ground_level_nap;
  let label: string;
  if (marker.nap != null) {
    label = formatNap(marker.nap);
  } else if (typeof groundNap === "number" && marker.depth != null) {
    label = formatNap(groundNap - marker.depth);
  } else if (marker.depth != null) {
    label = `${(-marker.depth).toFixed(1)} m`;
  } else {
    return;
  }
  ctx.font = '600 9px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textPad = 4;
  const w = ctx.measureText(label).width + textPad * 2;
  const h = 14;
  // Background pill behind the label so it stays readable over curves
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = markerColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Rounded rect (manual)
  const rx = xEnd + 2, ry = y - h / 2, rw = w, rh = h, rr = 3;
  ctx.moveTo(rx + rr, ry);
  ctx.lineTo(rx + rw - rr, ry);
  ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr);
  ctx.lineTo(rx + rw, ry + rh - rr);
  ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr);
  ctx.lineTo(rx + rr, ry + rh);
  ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr);
  ctx.lineTo(rx, ry + rr);
  ctx.arcTo(rx, ry, rx + rr, ry, rr);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = markerColor;
  ctx.fillText(label, rx + textPad, y);
}

/**
 * Normalize the markers list from `ChartRenderOptions`. Combines `markers`
 * (plural) and `marker` (singular, legacy) into a single ordered array.
 * Returns an empty array if neither is provided.
 */
function collectMarkers(opts: ChartRenderOptions): { nap?: number; depth?: number }[] {
  const list: { nap?: number; depth?: number }[] = [];
  if (opts.markers && opts.markers.length > 0) list.push(...opts.markers);
  if (opts.marker) list.push(opts.marker);
  return list;
}

/**
 * Hit-test the horizontal marker. Returns true if (x, y) is within the
 * MARKER_HALF_HEIGHT band of the marker on any CPT.
 */
/**
 * Hover indicator: short horizontal line at the hovered depth + a filled
 * bullet on each curve (qc, fs, rf, u2) with a value label next to it.
 */
function drawHoverIndicator(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  c: CptComputed,
  hoverDepth: number,
) {
  if (hoverDepth < c.depthViewMin || hoverDepth > c.depthViewMax) return;
  const y = depthToY(hoverDepth, shared, c.depthViewMin, c.depthViewMax);

  // Find the measurement point closest to the hovered depth.
  let bestI = -1;
  let bestDist = Infinity;
  for (let i = 0; i < c.cpt.points.length; i++) {
    const d = c.depths[i];
    if (d == null) continue;
    const dist = Math.abs(d - hoverDepth);
    if (dist < bestDist) { bestDist = dist; bestI = i; }
  }
  if (bestI < 0) return;
  const pt = c.cpt.points[bestI];

  // Faint horizontal guide line across the panels.
  const lastPanel = c.layout.u2 ?? c.layout.rf;
  const xStart = c.layout.soil.l;
  const xEnd = lastPanel.l + lastPanel.w;
  ctx.save();
  ctx.strokeStyle = colors.text;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xStart, Math.round(y) + 0.5);
  ctx.lineTo(xEnd, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.restore();

  type Series = { panel: PanelRect; min: number; max: number; color: string; value?: number; label: string; fmt: (v: number) => string };
  const series: Series[] = [
    { panel: c.layout.qc, min: c.qcViewMin, max: c.qcViewMax, color: colors.qc, value: pt.qc, label: "qc", fmt: (v) => v.toFixed(2) },
    { panel: c.layout.fs, min: c.fsViewMin, max: c.fsViewMax, color: colors.fs, value: pt.fs, label: "fs", fmt: (v) => v.toFixed(3) },
    { panel: c.layout.rf, min: c.rfViewMin, max: c.rfViewMax, color: colors.rf, value: pt.rf, label: "Rf", fmt: (v) => v.toFixed(2) },
  ];
  if (c.layout.u2) {
    series.push({ panel: c.layout.u2, min: c.u2ViewMin, max: c.u2ViewMax, color: colors.u2, value: pt.u2, label: "u2", fmt: (v) => v.toFixed(3) });
  }

  ctx.font = '600 9px "JetBrains Mono", monospace';
  for (const s of series) {
    if (s.value == null) continue;
    const span = s.max - s.min;
    if (span <= 0) continue;
    // Clamp x to panel range so the bullet stays visible even for off-scale values.
    const t = Math.max(0, Math.min(1, (s.value - s.min) / span));
    const x = s.panel.l + t * s.panel.w;
    // White halo + filled colored bullet
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    // Value label — place above the bullet, inside the panel.
    const txt = s.fmt(s.value);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const labelY = Math.max(shared.plotT + 10, y - 7);
    // Halo for readability
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.bg;
    ctx.strokeText(txt, x, labelY);
    ctx.fillStyle = s.color;
    ctx.fillText(txt, x, labelY);
  }
}

export function hitTestMarker(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  x: number,
  y: number,
): boolean {
  return hitTestMarkerIndex(cpts, opts, x, y) !== null;
}

/**
 * Like hitTestMarker but returns the INDEX of the hit marker (in the
 * combined `markers + marker` order, see collectMarkers) so callers can
 * identify *which* marker the user grabbed. Returns null on miss.
 *
 * If multiple markers overlap at a single (x,y), the closest one wins.
 */
export function hitTestMarkerIndex(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  x: number,
  y: number,
): number | null {
  const markers = collectMarkers(opts);
  if (markers.length === 0) return null;
  if (cpts.length === 0) return null;
  const shared = layoutShared(opts, cpts.length);
  if (y < shared.plotT || y > shared.plotB) return null;
  const computed = computeAll(cpts, opts, shared);
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (const c of computed) {
    if (x < c.layout.soil.l) continue;
    const lastPanel = c.layout.u2 ?? c.layout.rf;
    const xEnd = lastPanel.l + lastPanel.w;
    if (x > xEnd + 60) continue;   // include label area
    for (let mi = 0; mi < markers.length; mi++) {
      const depth = markerDepthForCpt(c, markers[mi]);
      if (depth == null) continue;
      if (depth < c.depthViewMin || depth > c.depthViewMax) continue;
      const my = depthToY(depth, shared, c.depthViewMin, c.depthViewMax);
      const d = Math.abs(y - my);
      if (d <= MARKER_HALF_HEIGHT && d < bestDist) {
        bestDist = d;
        bestIdx = mi;
      }
    }
  }
  return bestIdx;
}

/**
 * Convert a canvas (x, y) into the marker shape that should be created for
 * a double-click at that location. Picks NAP-anchored if the CPT under the
 * cursor has a known ground-level, otherwise falls back to depth-anchored.
 */
export function pickMarkerAt(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  x: number,
  y: number,
): { nap?: number; depth?: number } | null {
  if (cpts.length === 0) return null;
  const shared = layoutShared(opts, cpts.length);
  if (y < shared.plotT || y > shared.plotB) return null;
  const computed = computeAll(cpts, opts, shared);
  let owner: CptComputed | null = null;
  for (const c of computed) {
    if (x >= c.layout.cptLeft && x < c.layout.cptLeft + c.layout.cptWidth) {
      owner = c;
      break;
    }
  }
  if (!owner) owner = computed[0];
  const depth = yToDepth(y, shared, owner.depthViewMin, owner.depthViewMax);
  const groundNap = owner.cpt.metadata.ground_level_nap;
  if (typeof groundNap === "number") {
    return { nap: groundNap - depth };
  }
  return { depth };
}

/**
 * Update an existing marker so it lands at canvas y in the CPT under cursor.
 * Returns the new marker shape (preserves anchor kind: nap stays nap, depth stays depth).
 */
export function moveMarkerTo(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  marker: { nap?: number; depth?: number },
  x: number,
  y: number,
): { nap?: number; depth?: number } {
  if (cpts.length === 0) return marker;
  const shared = layoutShared(opts, cpts.length);
  const computed = computeAll(cpts, opts, shared);
  let owner: CptComputed | null = null;
  for (const c of computed) {
    if (x >= c.layout.cptLeft && x < c.layout.cptLeft + c.layout.cptWidth) {
      owner = c;
      break;
    }
  }
  if (!owner) owner = computed[0];
  const clampedY = Math.max(shared.plotT, Math.min(shared.plotB, y));
  const depth = yToDepth(clampedY, shared, owner.depthViewMin, owner.depthViewMax);
  const groundNap = owner.cpt.metadata.ground_level_nap;
  if (marker.nap != null && typeof groundNap === "number") {
    return { nap: groundNap - depth };
  }
  return { depth };
}

// ─────────────────────────────────────────────────────────────
// Public: renderChart
// ─────────────────────────────────────────────────────────────

export function renderChart(
  ctx: CanvasRenderingContext2D,
  cpts: Cpt[],
  opts: ChartRenderOptions,
  curves: ChartCurves,
): void {
  if (opts.width <= 0 || opts.height <= 0) return;
  const colors = readColors();
  const shared = layoutShared(opts, cpts.length);

  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, opts.width, opts.height);

  // Header strip
  ctx.fillStyle = colors.headerBg;
  ctx.fillRect(0, 0, opts.width, shared.headerH);

  if (cpts.length === 0) return;

  const computed = computeAll(cpts, opts, shared);

  for (const c of computed) {
    // Panel backgrounds
    ctx.fillStyle = colors.panelBg;
    ctx.fillRect(c.layout.soil.l, shared.plotT, c.layout.soil.w, shared.plotH);
    ctx.fillRect(c.layout.qc.l,   shared.plotT, c.layout.qc.w,   shared.plotH);
    ctx.fillRect(c.layout.fs.l,   shared.plotT, c.layout.fs.w,   shared.plotH);
    ctx.fillRect(c.layout.rf.l,   shared.plotT, c.layout.rf.w,   shared.plotH);
    if (c.layout.u2) ctx.fillRect(c.layout.u2.l, shared.plotT, c.layout.u2.w, shared.plotH);

    drawSoilStrip(ctx, shared, c);

    drawGridH(ctx, colors, shared, c);
    drawGridV(ctx, colors, shared, c.layout.qc, c.qcViewMin, c.qcViewMax, QC_LADDER);
    drawGridV(ctx, colors, shared, c.layout.fs, c.fsViewMin, c.fsViewMax, FS_LADDER);
    drawGridV(ctx, colors, shared, c.layout.rf, c.rfViewMin, c.rfViewMax, RF_LADDER);
    if (c.layout.u2) drawGridV(ctx, colors, shared, c.layout.u2, c.u2ViewMin, c.u2ViewMax, U2_LADDER);

    drawDepthAxis(ctx, colors, shared, c);

    // Tab strip — when multiple CPTs are shown, each column gets its own
    // tall (24px) header tab with the CPT id centred and a coloured under-bar.
    // Active CPT (if any) gets an amber accent so the user can tell which
    // panel is "selected" in the project context.
    if (cpts.length > 1 && shared.tabH > 0) {
      const tabTop = shared.headerH;
      const tabBot = shared.plotT;
      const tabL = c.layout.cptLeft;
      const tabW = c.layout.cptWidth;
      const isActive = c.cpt.id === opts.activeCptId;

      // Tab background — slightly raised look so it reads as a tab/handle.
      ctx.fillStyle = isActive ? "#FFF3E0" : colors.panelBg;
      ctx.fillRect(tabL, tabTop, tabW, tabBot - tabTop);
      // Bottom border (thicker for active)
      ctx.strokeStyle = isActive ? colors.qc : colors.gridMajor;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tabL, tabBot - 0.5);
      ctx.lineTo(tabL + tabW, tabBot - 0.5);
      ctx.stroke();
      // Vertical separators between adjacent tabs.
      ctx.strokeStyle = colors.gridMajor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tabL + 0.5, tabTop + 4);
      ctx.lineTo(tabL + 0.5, tabBot - 4);
      ctx.moveTo(tabL + tabW - 0.5, tabTop + 4);
      ctx.lineTo(tabL + tabW - 0.5, tabBot - 4);
      ctx.stroke();

      // Centred CPT id — bigger so it reads at a glance.
      ctx.fillStyle = isActive ? colors.qc : colors.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${isActive ? "700" : "600"} 12px Inter, system-ui, sans-serif`;
      // Truncate if too wide for the tab.
      let label = c.cpt.id;
      const padding = 12;
      while (label.length > 3 && ctx.measureText(label).width > tabW - padding) {
        label = label.slice(0, -1);
      }
      if (label !== c.cpt.id) label += "…";
      ctx.fillText(label, tabL + tabW / 2, tabTop + (tabBot - tabTop) / 2);
    }

    drawPanelHeader(ctx, colors, shared, c.layout.soil, "SBT", colors.textBright, null, null);
    drawPanelHeader(ctx, colors, shared, c.layout.qc,   "Conusweerstand (qc, MPa)",  colors.qc, c.qcViewMin, c.qcViewMax);
    drawPanelHeader(ctx, colors, shared, c.layout.fs,   "Plaatselijke wrijving (fs, MPa)", colors.fs, c.fsViewMin, c.fsViewMax);
    drawPanelHeader(ctx, colors, shared, c.layout.rf,   "Wrijvingsgetal (Rf, %)",   colors.rf, c.rfViewMin, c.rfViewMax);
    if (c.layout.u2) drawPanelHeader(ctx, colors, shared, c.layout.u2, "Waterspanning (u2, MPa)", colors.u2, c.u2ViewMin, c.u2ViewMax);

    if (curves.qc) drawCurve(ctx, shared, c, c.layout.qc, "qc", c.qcViewMin, c.qcViewMax, colors.qc, 1.8);
    if (curves.fs) drawCurve(ctx, shared, c, c.layout.fs, "fs", c.fsViewMin, c.fsViewMax, colors.fs, 1.4);
    if (curves.rf) drawCurve(ctx, shared, c, c.layout.rf, "rf", c.rfViewMin, c.rfViewMax, colors.rf, 1.4);
    if (curves.u2 && c.layout.u2) {
      drawCurve(ctx, shared, c, c.layout.u2, "u2", c.u2ViewMin, c.u2ViewMax, colors.u2, 1.4);
    }

    drawPanelBorder(ctx, colors, shared, c.layout.soil);
    drawPanelBorder(ctx, colors, shared, c.layout.qc);
    drawPanelBorder(ctx, colors, shared, c.layout.fs);
    drawPanelBorder(ctx, colors, shared, c.layout.rf);
    if (c.layout.u2) drawPanelBorder(ctx, colors, shared, c.layout.u2);

    // Optional reference marker(s) — horizontal lines spanning all panels.
    const allMarkers = collectMarkers(opts);
    for (const m of allMarkers) {
      drawMarker(ctx, colors, shared, c, m);
    }

    // Hover indicator — only for the CPT under the cursor.
    if (opts.hover && opts.hover.cptId === c.cpt.id) {
      drawHoverIndicator(ctx, colors, shared, c, opts.hover.depth);
    }
  }

  // Splitters between adjacent CPT columns. Drawn last so they sit on top.
  if (computed.length > 1) {
    const splitterH = shared.plotB - shared.plotT;
    for (let i = 0; i < computed.length - 1; i++) {
      const left = computed[i];
      const x = left.layout.cptLeft + left.layout.cptWidth;
      drawSplitter(ctx, colors, shared, x, splitterH);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Public: hitTest + hitTestSplitter
// ─────────────────────────────────────────────────────────────

/**
 * Hit-test a pointer position against the chart.
 *
 * Strategy: pick the CPT whose column the pointer is in, convert y to a
 * depth, then snap to the nearest measurement point and report its values.
 * Returns null if the pointer is outside the plot area or no CPT data
 * matches.
 */
export function hitTest(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  x: number,
  y: number,
): HitResult | null {
  if (cpts.length === 0) return null;
  const shared = layoutShared(opts, cpts.length);
  if (y < shared.plotT || y > shared.plotB) return null;

  const computed = computeAll(cpts, opts, shared);

  // Which CPT column owns x?
  let owner: CptComputed | null = null;
  for (const c of computed) {
    if (x >= c.layout.cptLeft && x < c.layout.cptLeft + c.layout.cptWidth) {
      owner = c;
      break;
    }
  }
  if (!owner) return null;

  const depth = yToDepth(y, shared, owner.depthViewMin, owner.depthViewMax);

  // Find nearest measurement.
  let bestI = -1;
  let bestDist = Infinity;
  for (let i = 0; i < owner.depths.length; i++) {
    const d = owner.depths[i];
    if (d == null) continue;
    const dist = Math.abs(d - depth);
    if (dist < bestDist) {
      bestDist = dist;
      bestI = i;
    }
  }
  if (bestI < 0) return null;

  const pt = owner.cpt.points[bestI];
  return {
    cptId: owner.cpt.id,
    depth: owner.depths[bestI]!,
    depthNap: pt.depth_nap ?? undefined,
    qc: pt.qc,
    fs: pt.fs,
    rf: pt.rf,
    u2: pt.u2,
    zone: classifyRobertson(pt.qc, pt.rf),
  };
}

/**
 * Hit-test the splitter regions between adjacent CPT columns.
 * Returns the index `i` if (x, y) is within `SPLITTER_HALF_WIDTH` of the
 * boundary between columns `i` and `i+1`, else null. Y must be in the
 * plot area for a hit.
 */
export function hitTestSplitter(
  cpts: Cpt[],
  opts: ChartRenderOptions,
  x: number,
  y: number,
): number | null {
  if (cpts.length < 2) return null;
  const shared = layoutShared(opts, cpts.length);
  if (y < shared.plotT || y > shared.plotB) return null;

  const slotWidths = computeSlotWidths(opts, cpts.length);
  let cursor = 0;
  for (let i = 0; i < cpts.length - 1; i++) {
    cursor += slotWidths[i];
    if (Math.abs(x - cursor) <= SPLITTER_HALF_WIDTH) return i;
  }
  return null;
}

/**
 * Compute the per-CPT slot widths the renderer would use, for callers that
 * need to derive layout (eg. drag handlers) without re-running the full
 * layout. Returned widths sum to `opts.width`.
 */
export function computeColumnLayout(
  cpts: Cpt[],
  opts: ChartRenderOptions,
): { left: number; width: number }[] {
  if (cpts.length === 0) return [];
  const slotWidths = computeSlotWidths(opts, cpts.length);
  let cursor = 0;
  return slotWidths.map((w) => {
    const out = { left: cursor, width: w };
    cursor += w;
    return out;
  });
}
