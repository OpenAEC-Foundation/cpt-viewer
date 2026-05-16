import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import proj4 from "proj4";
import { useCptStore } from "../../store/useCptStore";
import "./SonderingstekeningView.css";

/**
 * SonderingstekeningView — drawing-board view for a project sondering plan.
 *
 * Layout: a paper-sized rectangle (A2/A3 landscape) with an embedded
 * Leaflet map showing project + BRO sonderingen, plus an overlay layer
 * for user-placed markers, a title block, and a drawing frame. The
 * paper is rendered at screen scale 1:n where n is the user-chosen
 * scale (1:500 / 1:1000 / 1:2000 / 1:5000) — the map is fitted so
 * one millimetre of paper at the chosen scale corresponds to one
 * map-metre in the field.
 *
 * State is local to this component for v1 — paper layout is per session
 * and not persisted. Drag-drop of PDF/JPG/SVG drops the file as an
 * overlay over the paper. DWG/DXF support is stubbed (see the toolbox).
 */

// RD New (EPSG:28992) for map distance/scale calculations.
proj4.defs(
  "EPSG:28992",
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 " +
    "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
    "+towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 " +
    "+units=m +no_defs",
);
const WGS84_TO_RD = proj4("WGS84", "EPSG:28992");

// ── Paper geometry ───────────────────────────────────────────────
// All dimensions in millimetres. ISO A-series landscape.
type PaperSize = "A2" | "A3";
type Scale = 500 | 1000 | 2000 | 5000;

const PAPER_MM: Record<PaperSize, { wMm: number; hMm: number }> = {
  A2: { wMm: 594, hMm: 420 },
  A3: { wMm: 420, hMm: 297 },
};

const SCALES: Scale[] = [500, 1000, 2000, 5000];
const PAPER_SIZES: PaperSize[] = ["A2", "A3"];
const GRID_SPACINGS = [15, 20, 25] as const;

interface PlacedSondering {
  id: string;       // S01, S02, ...
  lat: number;
  lon: number;
}

interface OverlayDrop {
  id: string;
  kind: "pdf" | "image" | "svg" | "dwg";
  name: string;
  src?: string;     // data URL for image/svg/pdf-page-render
}

interface TitleBlockData {
  project: string;
  drawingNumber: string;
  scale: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  version: string;
}

interface FrameSvg {
  name: string;
  src: string;      // data URL
}

interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
  kind: "cpt" | "bore";
  registration_date?: string;
  extra: Record<string, string>;
}

// Convert a paper dimension (mm) at the chosen scale to map metres.
// e.g. 100 mm on paper at scale 1:1000 -> 100 metres in reality.
const paperMmToMeters = (mm: number, scale: Scale) => (mm / 1000) * scale;

export default function SonderingstekeningView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const placedLayerRef = useRef<L.LayerGroup | null>(null);
  const broLayerRef = useRef<L.LayerGroup | null>(null);
  const projectLayerRef = useRef<L.LayerGroup | null>(null);
  const placeModeRef = useRef(false);

  const [paperSize, setPaperSize] = useState<PaperSize>("A2");
  const [scale, setScale] = useState<Scale>(1000);
  const [showBro, setShowBro] = useState(true);
  const [placeMode, setPlaceMode] = useState(false);
  const [gridSpacing, setGridSpacing] = useState<typeof GRID_SPACINGS[number]>(20);
  const [placed, setPlaced] = useState<PlacedSondering[]>([]);
  const [overlay, setOverlay] = useState<OverlayDrop | null>(null);
  const [frame, setFrame] = useState<FrameSvg | null>(null);
  const [titleBlockOpen, setTitleBlockOpen] = useState(false);
  const [titleBlock, setTitleBlock] = useState<TitleBlockData>({
    project: "",
    drawingNumber: "",
    scale: `1:${1000}`,
    date: new Date().toISOString().slice(0, 10),
    drawnBy: "",
    checkedBy: "",
    version: "1.0",
  });
  const [toast, setToast] = useState<string | null>(null);

  // Pull project info to seed the title block + render project markers.
  const project = useCptStore((s) => {
    const doc = s.documents.find((d) => d.id === s.activeDocId);
    if (!doc) return null;
    if (doc.kind === "project") {
      return {
        title: doc.meta.title,
        number: doc.meta.project_number,
        cpts: Array.from(doc.cpts.values()),
      };
    }
    return {
      title: doc.cpt.metadata.project_name ?? doc.title,
      number: doc.cpt.metadata.project_number ?? "",
      cpts: [doc.cpt],
    };
  });

  // Auto-seed title block from active doc the first time the project changes.
  useEffect(() => {
    if (!project) return;
    setTitleBlock((tb) => ({
      ...tb,
      project: tb.project || project.title || "",
      drawingNumber: tb.drawingNumber || project.number || "",
      scale: `1:${scale}`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.title, project?.number]);

  // Keep title block scale field in sync when scale changes.
  useEffect(() => {
    setTitleBlock((tb) => ({ ...tb, scale: `1:${scale}` }));
  }, [scale]);

  useEffect(() => {
    placeModeRef.current = placeMode;
  }, [placeMode]);

  // ── Init Leaflet map inside the paper rect ─────────────────────
  useEffect(() => {
    if (!paperRef.current) return;
    const map = L.map(paperRef.current, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    }).setView([52.156, 5.388], 14);

    L.tileLayer(
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "Kaartgegevens © Kadaster | PDOK", maxZoom: 19 },
    ).addTo(map);

    broLayerRef.current = L.layerGroup().addTo(map);
    projectLayerRef.current = L.layerGroup().addTo(map);
    placedLayerRef.current = L.layerGroup().addTo(map);

    // Click-to-place handler — when placeMode is active, drop a marker.
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!placeModeRef.current) return;
      setPlaced((prev) => {
        const nextId = `S${String(prev.length + 1).padStart(2, "0")}`;
        return [...prev, { id: nextId, lat: e.latlng.lat, lon: e.latlng.lng }];
      });
    });

    mapRef.current = map;

    // Initial sizing — wait for layout, then invalidate the map size.
    requestAnimationFrame(() => map.invalidateSize());
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync map zoom to the chosen scale ──────────────────────────
  // We compute the field-width represented by the paper, then call
  // map.fitBounds() so 1 paper-mm corresponds to `scale` field-mm.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    const { wMm, hMm } = PAPER_MM[paperSize];
    const widthMeters = paperMmToMeters(wMm, scale);
    const heightMeters = paperMmToMeters(hMm, scale);
    const centre = map.getCenter();
    // Convert centre lat/lon to RD, then back to lat/lon for the corners.
    const [cxRd, cyRd] = WGS84_TO_RD.forward([centre.lng, centre.lat]);
    const halfW = widthMeters / 2;
    const halfH = heightMeters / 2;
    const swRd = [cxRd - halfW, cyRd - halfH];
    const neRd = [cxRd + halfW, cyRd + halfH];
    const swLL = WGS84_TO_RD.inverse(swRd);
    const neLL = WGS84_TO_RD.inverse(neRd);
    map.fitBounds(
      L.latLngBounds(L.latLng(swLL[1], swLL[0]), L.latLng(neLL[1], neLL[0])),
      { animate: false },
    );
  }, [paperSize, scale]);

  // ── Render project sondering markers ───────────────────────────
  useEffect(() => {
    const layer = projectLayerRef.current;
    if (!layer || !project) return;
    layer.clearLayers();
    for (const cpt of project.cpts) {
      if (!cpt.position) continue;
      // Convert RD to lat/lon.
      const ll = WGS84_TO_RD.inverse([cpt.position.x_rd, cpt.position.y_rd]);
      const marker = L.marker([ll[1], ll[0]], {
        icon: L.divIcon({
          className: "tek-project-marker",
          html: `<div class="tek-marker tek-marker-project" title="${cpt.id}">
                   <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                     fill="#d97706" stroke="#7c2d12" stroke-width="1" /></svg>
                 </div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 11],
        }),
      });
      marker.bindTooltip(cpt.metadata.source_file || cpt.id, { permanent: false });
      layer.addLayer(marker);
    }
  }, [project]);

  // ── Render placed-by-user sondering markers ────────────────────
  useEffect(() => {
    const layer = placedLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of placed) {
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "tek-placed-marker",
          html: `<div class="tek-marker tek-marker-placed">
                   <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                     fill="#2563eb" stroke="#1e3a8a" stroke-width="1" /></svg>
                   <span class="tek-marker-label">${p.id}</span>
                 </div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 11],
        }),
      });
      layer.addLayer(m);
    }
  }, [placed]);

  // ── BRO fetch + render whenever toggle / bounds change ─────────
  const refetchBro = useCallback(async () => {
    const map = mapRef.current;
    const layer = broLayerRef.current;
    if (!map || !layer) return;
    if (!showBro) {
      layer.clearLayers();
      return;
    }
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as
      [number, number, number, number];
    try {
      const features = await invoke<BroFeature[]>("fetch_bro_area", { bbox });
      layer.clearLayers();
      for (const f of features) {
        const m = L.marker([f.lat, f.lon], {
          icon: L.divIcon({
            className: "tek-bro-marker",
            html: `<div class="tek-marker tek-marker-bro" title="${f.id}">
                     <svg viewBox="0 0 12 12"><polygon points="1,1 11,1 6,11"
                       fill="#a1a1aa" stroke="#52525b" stroke-width="1" /></svg>
                   </div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 11],
          }),
        });
        layer.addLayer(m);
      }
    } catch (err) {
      console.warn("fetch_bro_area (tekening) failed", err);
    }
  }, [showBro]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void refetchBro();
    const handler = () => void refetchBro();
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
  }, [refetchBro]);

  // ── Drag-drop file overlay handlers ───────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext === "pdf") {
      // For v1 just hold the raw blob URL — pdf.js render would be a
      // separate step. We embed via <iframe> as a basic preview.
      const src = URL.createObjectURL(file);
      setOverlay({ id: `o-${Date.now()}`, kind: "pdf", name: file.name, src });
    } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
      const src = URL.createObjectURL(file);
      setOverlay({ id: `o-${Date.now()}`, kind: "image", name: file.name, src });
    } else if (ext === "svg") {
      const txt = await file.text();
      const src = `data:image/svg+xml;utf8,${encodeURIComponent(txt)}`;
      setOverlay({ id: `o-${Date.now()}`, kind: "svg", name: file.name, src });
    } else if (ext === "dwg" || ext === "dxf") {
      setOverlay({ id: `o-${Date.now()}`, kind: "dwg", name: file.name });
      setToast("DWG/DXF parser komt eraan — bestand herkend maar nog niet weergegeven.");
      setTimeout(() => setToast(null), 4000);
    } else {
      setToast(`Bestandstype .${ext} wordt nog niet ondersteund`);
      setTimeout(() => setToast(null), 3000);
    }
  }, []);

  const handleFrameFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".svg")) {
      setToast("Tekeningkader moet een SVG-bestand zijn");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const txt = await file.text();
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(txt)}`;
    setFrame({ name: file.name, src });
  }, []);

  // ── Grid-of-sonderingen generator ─────────────────────────────
  const placeGrid = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const [westRd, southRd] = WGS84_TO_RD.forward([b.getWest(), b.getSouth()]);
    const [eastRd, northRd] = WGS84_TO_RD.forward([b.getEast(), b.getNorth()]);
    const out: PlacedSondering[] = [];
    let counter = placed.length + 1;
    for (let y = southRd; y <= northRd; y += gridSpacing) {
      for (let x = westRd; x <= eastRd; x += gridSpacing) {
        const ll = WGS84_TO_RD.inverse([x, y]);
        out.push({
          id: `S${String(counter).padStart(2, "0")}`,
          lat: ll[1],
          lon: ll[0],
        });
        counter += 1;
        if (out.length > 200) break; // safety cap
      }
      if (out.length > 200) break;
    }
    setPlaced((prev) => [...prev, ...out]);
    setToast(`${out.length} sonderingen geplaatst op raster ${gridSpacing} m`);
    setTimeout(() => setToast(null), 3000);
  }, [gridSpacing, placed.length]);

  const clearPlaced = useCallback(() => {
    setPlaced([]);
  }, []);

  // ── Print to PDF (browser print restricted to the paper) ──────
  const printPdf = useCallback(() => {
    window.print();
  }, []);

  // ── Drag-drop overlay over the paper ──────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  // Toolbox file inputs.
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  // Ribbon-button bridge — listen for the global events dispatched by
  // SonderingstekeningTab so the user can click them from either place.
  useEffect(() => {
    const onTogglePlace = () => setPlaceMode((m) => !m);
    const onAddOverlay = () => overlayInputRef.current?.click();
    const onPrint = () => window.print();
    window.addEventListener("ogs:tekening-toggle-place", onTogglePlace);
    window.addEventListener("ogs:tekening-add-overlay", onAddOverlay);
    window.addEventListener("ogs:tekening-print", onPrint);
    return () => {
      window.removeEventListener("ogs:tekening-toggle-place", onTogglePlace);
      window.removeEventListener("ogs:tekening-add-overlay", onAddOverlay);
      window.removeEventListener("ogs:tekening-print", onPrint);
    };
  }, []);

  // ── Paper render — actual on-screen px from the chosen mm. ────
  // We pin paper width to 72% of the view; height follows the aspect
  // ratio. This keeps the paper looking like a paper even when the
  // window is small. (Real-scale rendering is enforced via map.fitBounds.)
  const paperStyle = useMemo(() => {
    const { wMm, hMm } = PAPER_MM[paperSize];
    const aspect = wMm / hMm;
    return {
      aspectRatio: `${aspect}`,
    } as React.CSSProperties;
  }, [paperSize]);

  return (
    <div className="tek-view" ref={containerRef}>
      <div className="tek-topbar">
        <div className="tek-topbar-group">
          <label className="tek-label">{`Papier`}</label>
          <select
            className="tek-select"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
          >
            {PAPER_SIZES.map((p) => (
              <option key={p} value={p}>{`${p} liggend`}</option>
            ))}
          </select>
        </div>
        <div className="tek-topbar-group">
          <label className="tek-label">{`Schaal`}</label>
          <select
            className="tek-select"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value) as Scale)}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>{`1:${s}`}</option>
            ))}
          </select>
        </div>
        <div className="tek-topbar-group">
          <label className="tek-checkbox">
            <input
              type="checkbox"
              checked={showBro}
              onChange={(e) => setShowBro(e.target.checked)}
            />
            <span>BRO sonderingen</span>
          </label>
        </div>
        <div className="tek-topbar-spacer" />
        <button className="tek-btn tek-btn-primary" onClick={printPdf}>
          Exporteer als PDF
        </button>
      </div>

      <div className="tek-canvas">
        <div
          className={`tek-paper tek-paper-${paperSize}${dragOver ? " tek-paper-dragover" : ""}`}
          style={paperStyle}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {/* Frame (loaded SVG) sits behind everything, on top of the map */}
          {frame && (
            <img className="tek-frame-svg" src={frame.src} alt={frame.name} />
          )}
          {/* Embedded Leaflet map fills the paper */}
          <div ref={paperRef} className="tek-paper-map" />
          {/* Optional dropped overlay (PDF/JPG/SVG) */}
          {overlay && overlay.src && overlay.kind !== "pdf" && (
            <img
              className="tek-overlay"
              src={overlay.src}
              alt={overlay.name}
              draggable={false}
            />
          )}
          {overlay && overlay.kind === "pdf" && (
            <iframe
              className="tek-overlay tek-overlay-pdf"
              src={overlay.src}
              title={overlay.name}
            />
          )}
          {overlay && overlay.kind === "dwg" && (
            <div className="tek-overlay tek-overlay-stub">
              <div>
                <strong>{overlay.name}</strong>
                <p>DWG/DXF parser komt eraan</p>
              </div>
            </div>
          )}
          {/* Title block (renders bottom-right corner) */}
          <div className="tek-titleblock">
            <div className="tek-titleblock-grid">
              <span className="tek-tb-label">Project</span>
              <span className="tek-tb-value">{titleBlock.project || "—"}</span>
              <span className="tek-tb-label">Tekening</span>
              <span className="tek-tb-value">{titleBlock.drawingNumber || "—"}</span>
              <span className="tek-tb-label">Schaal</span>
              <span className="tek-tb-value">{titleBlock.scale}</span>
              <span className="tek-tb-label">Datum</span>
              <span className="tek-tb-value">{titleBlock.date || "—"}</span>
              <span className="tek-tb-label">Getekend</span>
              <span className="tek-tb-value">{titleBlock.drawnBy || "—"}</span>
              <span className="tek-tb-label">Gecontr.</span>
              <span className="tek-tb-value">{titleBlock.checkedBy || "—"}</span>
              <span className="tek-tb-label">Versie</span>
              <span className="tek-tb-value">{titleBlock.version || "—"}</span>
            </div>
          </div>
        </div>

        <aside className="tek-toolbox">
          <h4 className="tek-toolbox-title">Gereedschap</h4>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => overlayInputRef.current?.click()}
            >
              Tekening toevoegen
            </button>
            <input
              ref={overlayInputRef}
              type="file"
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.webp,.svg,.dwg,.dxf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            <p className="tek-tool-hint">Of sleep een PDF/JPG/SVG op het papier</p>
          </div>

          <div className="tek-tool-group">
            <label className="tek-tool-sub">Raster sonderingen</label>
            <div className="tek-tool-row">
              <select
                className="tek-select tek-select-sm"
                value={gridSpacing}
                onChange={(e) =>
                  setGridSpacing(Number(e.target.value) as typeof GRID_SPACINGS[number])
                }
              >
                {GRID_SPACINGS.map((g) => (
                  <option key={g} value={g}>{`${g} m`}</option>
                ))}
              </select>
              <button className="tek-tool-btn tek-tool-btn-sm" onClick={placeGrid}>
                Plaats raster
              </button>
            </div>
          </div>

          <div className="tek-tool-group">
            <label className="tek-tool-sub">Plaatsen</label>
            <button
              className={`tek-tool-btn${placeMode ? " tek-tool-btn-active" : ""}`}
              onClick={() => setPlaceMode((m) => !m)}
            >
              {placeMode ? "Stop plaatsen" : "Sondering plaatsen"}
            </button>
            {placed.length > 0 && (
              <button className="tek-tool-btn tek-tool-btn-ghost" onClick={clearPlaced}>
                {`Wis ${placed.length} markers`}
              </button>
            )}
          </div>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => setTitleBlockOpen((v) => !v)}
            >
              {titleBlockOpen ? "Sluit Title block" : "Title block"}
            </button>
            {titleBlockOpen && (
              <div className="tek-tb-form">
                {(["project", "drawingNumber", "date", "drawnBy", "checkedBy", "version"] as const).map((k) => (
                  <label key={k} className="tek-tb-field">
                    <span>{k}</span>
                    <input
                      type="text"
                      value={titleBlock[k]}
                      onChange={(e) =>
                        setTitleBlock((tb) => ({ ...tb, [k]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="tek-tool-group">
            <button
              className="tek-tool-btn"
              onClick={() => frameInputRef.current?.click()}
            >
              Tekeningkader laden
            </button>
            <input
              ref={frameInputRef}
              type="file"
              hidden
              accept=".svg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFrameFile(f);
                e.target.value = "";
              }}
            />
            {frame && (
              <p className="tek-tool-hint">{`Geladen: ${frame.name}`}</p>
            )}
          </div>
        </aside>
      </div>

      {toast && <div className="tek-toast">{toast}</div>}
    </div>
  );
}
