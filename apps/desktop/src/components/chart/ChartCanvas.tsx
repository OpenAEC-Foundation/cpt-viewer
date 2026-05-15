import { useEffect, useRef, useState } from "react";
import { useCptStore } from "../../store/useCptStore";
import { renderChart, hitTest } from "./chart-renderer";

/**
 * Canvas-backed chart view of all open CPTs.
 *
 * Responsibilities (kept thin — drawing lives in `chart-renderer.ts`):
 *   - HiDPI-aware sizing (re-runs on ResizeObserver fires)
 *   - Wheel zoom + ribbon-driven zoom (via `ogs:zoom-*` custom events)
 *   - Mouse-move hover → updates `useCptStore().setHover`
 */
export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const setHover = useCptStore((s) => s.setHover);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState(0);

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
        { width: rect.width, height: rect.height, zoom, pan },
        { qc: true, fs: false, rf: true, u2: true },
      );
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [cpts, zoom, pan]);

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
    const onFit = () => { setZoom(1); setPan(0); };
    window.addEventListener("ogs:zoom-in",  onIn);
    window.addEventListener("ogs:zoom-out", onOut);
    window.addEventListener("ogs:zoom-fit", onFit);
    return () => {
      window.removeEventListener("ogs:zoom-in",  onIn);
      window.removeEventListener("ogs:zoom-out", onOut);
      window.removeEventListener("ogs:zoom-fit", onFit);
    };
  }, []);

  // ─── Hover ───
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(
      cpts,
      { width: rect.width, height: rect.height, zoom, pan },
      x,
      y,
    );
    setHover(
      hit
        ? {
            depth: hit.depth,
            qc: hit.qc,
            fs: hit.fs,
            rf: hit.rf,
            u2: hit.u2,
            soil: hit.zone?.name,
          }
        : null,
    );
  };
  const onLeave = () => setHover(null);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
    />
  );
}
