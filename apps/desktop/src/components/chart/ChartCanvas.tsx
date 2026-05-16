import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCptStore } from "../../store/useCptStore";
import {
  renderChart,
  hitTest,
  hitTestSplitter,
  hitTestMarker,
  hitTestMarkerIndex,
  pickMarkerAt,
  moveMarkerTo,
} from "./chart-renderer";

type Marker = { nap?: number; depth?: number };

/**
 * Canvas-backed chart view of all open CPTs.
 *
 * Responsibilities (kept thin — drawing lives in `chart-renderer.ts`):
 *   - HiDPI-aware sizing (re-runs on ResizeObserver fires)
 *   - Wheel zoom + ribbon-driven zoom (via `ogs:zoom-*` custom events)
 *   - Bi-directional pan (drag in empty area)
 *   - Drag-to-resize between adjacent CPT columns (splitter handles)
 *   - Mouse-move hover → updates `useCptStore().setHover`
 *   - Re-render on `data-theme` attribute changes via MutationObserver
 */
export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cptsMap = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const hiddenCptIds = useCptStore((s) => s.hiddenCptIds);
  const cpts = useMemo(
    () => Array.from(cptsMap.values()).filter((c) => !hiddenCptIds.has(c.id)),
    [cptsMap, hiddenCptIds],
  );
  const setHover = useCptStore((s) => s.setHover);
  const [zoom, setZoom] = useState(1.0);
  const [panY, setPanY] = useState(0);
  const [panX, setPanX] = useState(0);
  /** Per-CPT column width ratios. Length must match cpts.length. */
  const [columnRatios, setColumnRatios] = useState<number[]>([]);
  /** Reference markers — list of horizontal lines. Double-click adds; right-click deletes one. */
  const [markers, setMarkers] = useState<Marker[]>([]);
  /** Right-click context menu for marker (screen coords + which marker idx). */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; markerIdx: number } | null>(null);
  /** Hover indicator — depth + which CPT is under the cursor. */
  const [hoverIndicator, setHoverIndicator] = useState<{ cptId: string; depth: number } | null>(null);
  /** Bumps whenever document.documentElement[data-theme] changes. */
  const [themeTick, setThemeTick] = useState(0);
  /** Cursor hint depending on what's under the pointer. */
  const [cursor, setCursor] = useState<string>("crosshair");

  // Reset ratios whenever the open-CPT count changes.
  useEffect(() => {
    setColumnRatios((prev) => {
      if (prev.length === cpts.length) return prev;
      return new Array(cpts.length).fill(1);
    });
  }, [cpts.length]);

  // ─── Watch for theme changes so the chart redraws ───
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          setThemeTick((t) => t + 1);
          return;
        }
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Build a stable options object for the renderer + hit-tests.
  const renderOpts = useCallback(
    (width: number, height: number) => ({
      width,
      height,
      zoom,
      panX,
      panY,
      columnRatios:
        columnRatios.length === cpts.length ? columnRatios : new Array(cpts.length).fill(1),
      markers: markers.length > 0 ? markers : undefined,
      hover: hoverIndicator ?? undefined,
      activeCptId: activeCptId ?? undefined,
    }),
    [zoom, panX, panY, columnRatios, cpts.length, markers, hoverIndicator, activeCptId],
  );

  // ─── Render whenever inputs change or the canvas resizes ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      renderChart(
        ctx,
        cpts,
        renderOpts(rect.width, rect.height),
        { qc: true, fs: true, rf: true, u2: true },
      );
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
    // themeTick is intentionally a dep — the observer doesn't trigger React,
    // so we use the tick as a redraw signal.
  }, [cpts, renderOpts, themeTick]);

  // ─── Wheel zoom ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ─── External zoom controls from the Ribbon ───
  useEffect(() => {
    const onIn  = () => setZoom((z) => Math.min(8, z * 1.25));
    const onOut = () => setZoom((z) => Math.max(0.2, z * 0.8));
    const onFit = () => { setZoom(1); setPanY(0); setPanX(0); };
    window.addEventListener("ogs:zoom-in",  onIn);
    window.addEventListener("ogs:zoom-out", onOut);
    window.addEventListener("ogs:zoom-fit", onFit);
    return () => {
      window.removeEventListener("ogs:zoom-in",  onIn);
      window.removeEventListener("ogs:zoom-out", onOut);
      window.removeEventListener("ogs:zoom-fit", onFit);
    };
  }, []);

  // Helpers used by the mouse handlers.
  const getRect = () => canvasRef.current?.getBoundingClientRect();

  // Update cursor based on what's under the pointer (when not dragging).
  const updateCursor = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      const opts = renderOpts(rect.width, rect.height);
      if (markers.length > 0 && hitTestMarker(cpts, opts, x, y)) {
        setCursor("ns-resize");
        return;
      }
      const split = hitTestSplitter(cpts, opts, x, y);
      if (split !== null) {
        setCursor("col-resize");
      } else {
        setCursor("crosshair");
      }
    },
    [cpts, renderOpts, markers],
  );

  // ─── Splitter drag (resize columns) + pan drag ───
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = getRect();
      if (!rect) return;
      const x0 = e.clientX - rect.left;
      const y0 = e.clientY - rect.top;
      const opts = renderOpts(rect.width, rect.height);

      // 0. If we hit a marker line, drag THAT marker.
      const hitIdx = markers.length > 0 ? hitTestMarkerIndex(cpts, opts, x0, y0) : null;
      if (hitIdx !== null) {
        e.preventDefault();
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        setCursor("ns-resize");
        setHover(null);
        const onMove = (ev: MouseEvent) => {
          const r = getRect();
          if (!r) return;
          const x = ev.clientX - r.left;
          const y = ev.clientY - r.top;
          const o = renderOpts(r.width, r.height);
          setMarkers((curr) => {
            if (hitIdx >= curr.length) return curr;
            const next = curr.slice();
            next[hitIdx] = moveMarkerTo(cpts, o, next[hitIdx], x, y);
            return next;
          });
        };
        const onUp = () => {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          setCursor("crosshair");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      // 1. Splitter takes priority.
      const splitIdx = hitTestSplitter(cpts, opts, x0, y0);
      if (splitIdx !== null) {
        e.preventDefault();
        const startRatios = columnRatios.length === cpts.length
          ? columnRatios.slice()
          : new Array(cpts.length).fill(1);
        // Total width is preserved; convert px delta to ratio delta.
        // Sum of ratios == cpts.length (initial), normalized internally.
        const totalRatio = startRatios.reduce((a, b) => a + b, 0);
        const widthPerRatio = rect.width / totalRatio;

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - rect.left - x0;
          const dRatio = dx / widthPerRatio;
          // Don't let either side collapse below ~10% of its original width.
          const minA = startRatios[splitIdx] * 0.1;
          const minB = startRatios[splitIdx + 1] * 0.1;
          const newA = startRatios[splitIdx] + dRatio;
          const newB = startRatios[splitIdx + 1] - dRatio;
          if (newA < minA || newB < minB) return;
          // Also keep absolute pixels usable so the layoutCpt math stays safe.
          const minPx = 80;
          if (newA * widthPerRatio < minPx || newB * widthPerRatio < minPx) {
            // For very narrow canvases minPx may exceed the available space —
            // fall back to the 10% guard above.
            if (rect.width / cpts.length >= minPx) return;
          }
          const next = startRatios.slice();
          next[splitIdx] = newA;
          next[splitIdx + 1] = newB;
          setColumnRatios(next);
        };
        const onUp = () => {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        // Suppress hover updates while we're resizing.
        setHover(null);
        return;
      }

      // 2. Otherwise: pan. Left-click anywhere in the canvas pans.
      e.preventDefault();
      const startPanY = panY;
      // Horizontal pan disabled — qc/fs/Rf axes are pinned to their nominal
      // ranges (qc 0-30, Rf 0-10, etc.). Pan is vertical-only.
      // Translate pixel deltas into data deltas using the FIRST cpt's
      // scale as a reference — multi-CPT columns share the same depth-zoom
      // factor so this stays consistent across columns.
      // For depth: dyMeters = dy / plotH * (depthRange / zoom).
      // We approximate plotH by full canvas minus a small chrome strip.
      const plotH = Math.max(1, rect.height - 32);
      // depthRange is per-CPT; use the first CPT's depth range as the ruler.
      // (Multi-CPT panning is a single shared offset — close enough for UX.)
      const firstCpt = cpts[0];
      const fallbackDepthRange = 30;
      const depthRange = firstCpt
        ? Math.max(
            1,
            Math.ceil(
              Math.max(
                ...firstCpt.points.map((p) => (p.depth != null ? Math.abs(p.depth) : 0)),
              ) * 1.02 + 0.5,
            ),
          )
        : fallbackDepthRange;
      const visibleDepth = depthRange / Math.max(0.05, zoom);

      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      setCursor("grabbing");
      setHover(null);

      const onMove = (ev: MouseEvent) => {
        const dy = ev.clientY - rect.top - y0;
        // Drag DOWN slides the viewport UP through the data (exposes shallower
        // depths) — decrease panY. Vertical only by request; horizontal panning
        // would shift the qc/fs/Rf axes which the user wants pinned.
        const dyMeters = (dy / plotH) * visibleDepth;
        setPanY(startPanY - dyMeters);
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setCursor("crosshair");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [cpts, columnRatios, renderOpts, panX, panY, zoom, setHover, markers],
  );

  // ─── Double-click: ADD a new horizontal reference marker ───
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const newMarker = pickMarkerAt(cpts, renderOpts(rect.width, rect.height), x, y);
    if (newMarker) setMarkers((curr) => [...curr, newMarker]);
  };

  // ─── Right-click on a marker → context menu (Verwijderen for that marker) ───
  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (markers.length === 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = hitTestMarkerIndex(cpts, renderOpts(rect.width, rect.height), x, y);
    if (idx !== null) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, markerIdx: idx });
    }
  };
  // Dismiss the menu on any other click.
  useEffect(() => {
    if (!contextMenu) return;
    const onAnyClick = () => setContextMenu(null);
    window.addEventListener("mousedown", onAnyClick);
    return () => window.removeEventListener("mousedown", onAnyClick);
  }, [contextMenu]);

  // ─── Hover ───
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    updateCursor(x, y, rect);
    const hit = hitTest(cpts, renderOpts(rect.width, rect.height), x, y);
    setHover(
      hit
        ? {
            depth: hit.depth,
            depthNap: hit.depthNap,
            qc: hit.qc,
            fs: hit.fs,
            rf: hit.rf,
            u2: hit.u2,
            soil: hit.zone?.name,
          }
        : null,
    );
    // Hover indicator on the chart: bullets on each curve at the hovered depth.
    setHoverIndicator(hit ? { cptId: hit.cptId, depth: hit.depth } : null);
  };
  const onLeave = () => {
    setHover(null);
    setHoverIndicator(null);
    setCursor("crosshair");
  };

  // ─── Escape clears ALL markers ───
  useEffect(() => {
    if (markers.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMarkers([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markers]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ width: "100%", height: "100%", display: "block", cursor }}
      />
      {contextMenu && (
        <div
          className="chart-context-menu"
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="chart-context-item"
            onClick={() => {
              setMarkers((curr) => curr.filter((_, i) => i !== contextMenu.markerIdx));
              setContextMenu(null);
            }}
          >
            Verwijderen
          </button>
          {markers.length > 1 && (
            <button
              type="button"
              className="chart-context-item"
              onClick={() => { setMarkers([]); setContextMenu(null); }}
            >
              Alles verwijderen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
