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
  /** Pan offset in meters (positive shifts the visible range deeper). */
  pan: number;
}

export interface ChartCurves {
  qc: boolean;
  fs: boolean;
  rf: boolean;
  u2: boolean;
}

export interface HitResult {
  cptId: string;
  depth: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  zone: RobertsonZone | null;
}

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
  qc: string;
  fs: string;
  rf: string;
  u2: string;
}

function readColors(): ChartColors {
  // Domain curve colors come from CSS variables so themes flow through.
  // The chart body still uses fixed dark surface colors because the original
  // vanilla chart was tuned for a dark canvas — light theme variants can
  // ride on top later once a design pass lands.
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const cs = root ? getComputedStyle(root) : null;
  const cssVar = (name: string, fallback: string): string => {
    if (!cs) return fallback;
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: "#0d1117",
    panelBg: "#0f1318",
    grid: "rgba(255,255,255,0.05)",
    gridMajor: "rgba(255,255,255,0.10)",
    border: "rgba(255,255,255,0.08)",
    text: "#6e7681",
    textBright: "#8b949e",
    headerBg: "#161b22",
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

  const qcMax = niceMax(Math.max(0.1, ...positive("qc")));
  const fsMax = niceMax(Math.max(0.01, ...positive("fs")));
  const rfMax = niceMax(Math.max(1, ...positive("rf")));

  const u2vals = points.map((p) => p.u2).filter((v): v is number => v != null);
  const hasU2 = u2vals.length > 10;
  let u2Max = 1;
  if (hasU2) {
    const u2pos = u2vals.filter((v) => v > 0);
    u2Max = niceMax(Math.max(0.01, ...(u2pos.length > 0 ? u2pos : [0.5])));
  }

  return { depthMin, depthMax, qcMax, fsMax, rfMax, u2Max, hasU2 };
}

/** Compute the visible depth window from base depth range + zoom + pan. */
function visibleDepthWindow(scales: CptScales, zoom: number, pan: number) {
  const fullRange = scales.depthMax - scales.depthMin;
  const visibleRange = fullRange / Math.max(0.05, zoom);
  const center = (scales.depthMin + scales.depthMax) / 2 + pan;
  return {
    depthViewMin: center - visibleRange / 2,
    depthViewMax: center + visibleRange / 2,
  };
}

function layoutShared(opts: ChartRenderOptions): SharedLayout {
  const narrow = opts.width < 280;
  const headerH = 28;
  const bottomPad = 4;
  const plotT = headerH;
  const plotB = opts.height - bottomPad;
  return {
    plotT,
    plotB,
    plotH: plotB - plotT,
    headerH,
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
  const depthW = narrow ? 30 : 42;
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
}

function computeAll(cpts: Cpt[], opts: ChartRenderOptions, shared: SharedLayout): CptComputed[] {
  if (cpts.length === 0) return [];
  const cptSlotWidth = opts.width / cpts.length;
  return cpts.map((cpt, i) => {
    const scales = computeScales(cpt.points);
    const layout = layoutCpt(i * cptSlotWidth, cptSlotWidth, scales.hasU2, shared.narrow);
    const { depthViewMin, depthViewMax } = visibleDepthWindow(scales, opts.zoom, opts.pan);
    const depths = cpt.points.map((p) => (p.depth != null ? Math.abs(p.depth) : null));
    return { cpt, scales, layout, depthViewMin, depthViewMax, depths };
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

function drawGridV(
  ctx: CanvasRenderingContext2D,
  colors: ChartColors,
  shared: SharedLayout,
  panel: PanelRect,
) {
  const steps = Math.max(2, Math.min(6, Math.floor(panel.w / 35)));
  for (let i = 1; i < steps; i++) {
    const x = Math.round(panel.l + (i / steps) * panel.w) + 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
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
  maxVal: number | null,
) {
  const cx = panel.l + panel.w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${shared.narrow ? 9 : 10}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(label, cx, 3);

  if (maxVal !== null && panel.w > 30) {
    ctx.font = `${shared.narrow ? 7 : 9}px "JetBrains Mono", monospace`;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.fillText("0", panel.l + 2, 15);
    ctx.textAlign = "right";
    ctx.fillText(fmtScale(maxVal), panel.l + panel.w - 2, 15);

    if (panel.w > 60) {
      ctx.textAlign = "center";
      ctx.fillText(fmtScale(maxVal / 2), cx, 15);
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

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${shared.narrow ? 8 : 9}px "JetBrains Mono", monospace`;
  ctx.fillStyle = colors.text;

  for (
    let d = Math.ceil(c.depthViewMin / step) * step;
    d <= c.depthViewMax;
    d = +(d + step).toFixed(6)
  ) {
    const y = depthToY(d, shared, c.depthViewMin, c.depthViewMax);
    if (y < shared.plotT + 6 || y > shared.plotB - 3) continue;
    ctx.fillText(d.toFixed(1), c.layout.cptLeft + c.layout.depthW - 4, y);
  }

  if (!shared.narrow) {
    ctx.save();
    ctx.translate(c.layout.cptLeft + 10, shared.plotT + shared.plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.fillStyle = colors.text;
    ctx.fillText("Diepte (m)", 0, 0);
    ctx.restore();
  }
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  shared: SharedLayout,
  c: CptComputed,
  panel: PanelRect,
  key: "qc" | "fs" | "rf" | "u2",
  maxVal: number,
  color: string,
  lineWidth: number,
) {
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
    const x = panel.l + (v / maxVal) * panel.w;
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
  const shared = layoutShared(opts);

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
    drawGridV(ctx, colors, shared, c.layout.qc);
    drawGridV(ctx, colors, shared, c.layout.fs);
    drawGridV(ctx, colors, shared, c.layout.rf);
    if (c.layout.u2) drawGridV(ctx, colors, shared, c.layout.u2);

    drawDepthAxis(ctx, colors, shared, c);

    // Title strip — show the CPT id so multi-CPT comparison is readable.
    if (cpts.length > 1) {
      ctx.fillStyle = colors.textBright;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "600 9px Inter, system-ui, sans-serif";
      const title = c.cpt.metadata.project_name
        ? `${c.cpt.id} — ${c.cpt.metadata.project_name}`
        : c.cpt.id;
      ctx.fillText(title, c.layout.cptLeft + 4, 2);
    }

    drawPanelHeader(ctx, colors, shared, c.layout.soil, "SBT", colors.textBright, null);
    drawPanelHeader(ctx, colors, shared, c.layout.qc,   "qc (MPa)", colors.qc, c.scales.qcMax);
    drawPanelHeader(ctx, colors, shared, c.layout.fs,   "fs (MPa)", colors.fs, c.scales.fsMax);
    drawPanelHeader(ctx, colors, shared, c.layout.rf,   "Rf (%)",   colors.rf, c.scales.rfMax);
    if (c.layout.u2) drawPanelHeader(ctx, colors, shared, c.layout.u2, "u2 (MPa)", colors.u2, c.scales.u2Max);

    if (curves.qc) drawCurve(ctx, shared, c, c.layout.qc, "qc", c.scales.qcMax, colors.qc, 1.8);
    if (curves.fs) drawCurve(ctx, shared, c, c.layout.fs, "fs", c.scales.fsMax, colors.fs, 1.4);
    if (curves.rf) drawCurve(ctx, shared, c, c.layout.rf, "rf", c.scales.rfMax, colors.rf, 1.4);
    if (curves.u2 && c.layout.u2) {
      drawCurve(ctx, shared, c, c.layout.u2, "u2", c.scales.u2Max, colors.u2, 1.4);
    }

    drawPanelBorder(ctx, colors, shared, c.layout.soil);
    drawPanelBorder(ctx, colors, shared, c.layout.qc);
    drawPanelBorder(ctx, colors, shared, c.layout.fs);
    drawPanelBorder(ctx, colors, shared, c.layout.rf);
    if (c.layout.u2) drawPanelBorder(ctx, colors, shared, c.layout.u2);
  }
}

// ─────────────────────────────────────────────────────────────
// Public: hitTest
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
  const shared = layoutShared(opts);
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
    qc: pt.qc,
    fs: pt.fs,
    rf: pt.rf,
    u2: pt.u2,
    zone: classifyRobertson(pt.qc, pt.rf),
  };
}
