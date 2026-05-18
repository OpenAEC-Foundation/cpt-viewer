import { useCallback, useEffect, useRef, useState } from "react";
import CropStage, { type CropStageHandle } from "./CropStage";
import "./ImageCropDialog.css";
import "./PdfCropDialog.css";

/**
 * PdfCropDialog — two-phase modal for using a PDF as a tekening overlay.
 *
 * Phase 1 — page picker
 *   The PDF is parsed with pdfjs-dist and every page is rendered to a
 *   small thumbnail (scale 0.4) on a background task. The user picks
 *   one page by clicking its thumbnail.
 *
 * Phase 2 — crop
 *   The chosen page is re-rendered at higher resolution (scale 2.0)
 *   into an off-screen canvas, the PNG data URL of that render goes
 *   into the shared `<CropStage>` (same crop UI as for raster images),
 *   and the user trims away whatever they don't need. On confirm we
 *   hand the cropped PNG data URL back to the caller.
 *
 * The dialog re-uses `ImageCropDialog.css` so the chrome looks identical
 * to the raster crop step; the page-picker grid + back-button live in
 * a small `PdfCropDialog.css` next to this file.
 */

interface Props {
  /** Object URL pointing at the PDF blob. Owned by the caller. */
  pdfSrc: string;
  fileName: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

// Render-scale tuning. Thumbnail scale is small enough that even
// 100-page reports stay responsive; the page-crop scale is generous
// so the user has plenty of resolution to crop into.
const THUMB_SCALE = 0.4;
const PAGE_SCALE = 2.0;

export default function PdfCropDialog({
  pdfSrc,
  fileName,
  onConfirm,
  onCancel,
}: Props) {
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 1-indexed page number — null while the user is still picking.
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  // PNG data URL of the chosen page at PAGE_SCALE.
  const [pageImage, setPageImage] = useState<string | null>(null);
  const stageRef = useRef<CropStageHandle>(null);
  const [info, setInfo] = useState("…");

  // ── Phase 1: load PDF and render thumbnails ──────────────────
  // We load the document once on mount and re-use the resulting
  // PDFDocumentProxy for both the thumbnail walk and the high-res
  // page render later. pdfjs's `getDocument` is cached internally
  // by URL so multiple loads of the same blob are cheap.
  //
  // pdfjs-dist is loaded *lazily* via a dynamic import so the
  // (relatively large) library and its Web Worker only land in the
  // browser when the user actually opens a PDF. This also keeps any
  // pdfjs init failure isolated to this dialog instead of blocking
  // the whole app at startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getDocument } = await import("../../utils/pdfjsSetup");
        const task = getDocument(pdfSrc);
        const doc = await task.promise;
        const out: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: THUMB_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          // pdfjs ≥ 5 requires `canvas` in the render params; older
          // versions accepted just `canvasContext`. We pass both so
          // we don't depend on which subminor is installed.
          await page.render({
            canvasContext: ctx,
            canvas,
            viewport,
          } as Parameters<typeof page.render>[0]).promise;
          out.push(canvas.toDataURL("image/png"));
          page.cleanup();
        }
        if (!cancelled) setThumbs(out);
      } catch (err) {
        if (!cancelled) {
          console.error("PDF load failed", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfSrc]);

  // ── Phase 2: render the picked page at higher resolution ─────
  useEffect(() => {
    if (selectedPage === null) return;
    let cancelled = false;
    (async () => {
      try {
        setPageImage(null);
        const { getDocument } = await import("../../utils/pdfjsSetup");
        const task = getDocument(pdfSrc);
        const doc = await task.promise;
        const page = await doc.getPage(selectedPage);
        const viewport = page.getViewport({ scale: PAGE_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({
          canvasContext: ctx,
          canvas,
          viewport,
        } as Parameters<typeof page.render>[0]).promise;
        if (!cancelled) setPageImage(canvas.toDataURL("image/png"));
        page.cleanup();
      } catch (err) {
        if (!cancelled) {
          console.error("PDF page render failed", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfSrc, selectedPage]);

  const doConfirm = useCallback(() => {
    const dataUrl = stageRef.current?.commit();
    if (dataUrl) onConfirm(dataUrl);
  }, [onConfirm]);

  // Keyboard shortcuts: Esc cancels, Enter advances in the right phase.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && selectedPage !== null && pageImage) {
        e.preventDefault();
        doConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, selectedPage, pageImage, doConfirm]);

  // ── Render ───────────────────────────────────────────────────

  // Hard failure: PDF could not be parsed at all.
  if (error) {
    return (
      <div className="icrop-backdrop" onMouseDown={onCancel}>
        <div
          className="icrop-dialog"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="icrop-header">
            <span className="icrop-title">PDF kan niet worden ingelezen</span>
            <span className="icrop-filename" title={fileName}>
              {fileName}
            </span>
          </header>
          <div className="pcrop-error">{error}</div>
          <footer className="icrop-footer">
            <div />
            <div className="icrop-actions">
              <button
                type="button"
                className="icrop-btn"
                onClick={onCancel}
              >
                Sluiten
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // Phase 2 — page chosen, crop UI showing.
  if (selectedPage !== null) {
    return (
      <div className="icrop-backdrop" onMouseDown={onCancel}>
        <div
          className="icrop-dialog"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="icrop-header pcrop-header">
            <button
              type="button"
              className="icrop-btn pcrop-back-btn"
              onClick={() => {
                setSelectedPage(null);
                setPageImage(null);
              }}
              title="Andere pagina kiezen"
            >
              ← Andere pagina
            </button>
            <span className="icrop-title">
              Pagina {selectedPage} bijsnijden
            </span>
            <span className="icrop-filename" title={fileName}>
              {fileName}
            </span>
          </header>
          {pageImage ? (
            <CropStage
              ref={stageRef}
              imageSrc={pageImage}
              onCropChange={(c) =>
                setInfo(`${c.cropWidthPx} × ${c.cropHeightPx} px`)
              }
            />
          ) : (
            <div className="pcrop-loading">Pagina wordt gerenderd…</div>
          )}
          <footer className="icrop-footer">
            <div className="icrop-info">{pageImage ? info : ""}</div>
            <div className="icrop-actions">
              <button
                type="button"
                className="icrop-btn"
                onClick={onCancel}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="icrop-btn icrop-btn-primary"
                disabled={!pageImage}
                onClick={doConfirm}
              >
                Bijsnijden &amp; toevoegen
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // Phase 1 — page picker (default).
  return (
    <div className="icrop-backdrop" onMouseDown={onCancel}>
      <div
        className="icrop-dialog pcrop-picker-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="icrop-header">
          <span className="icrop-title">PDF — selecteer pagina</span>
          <span className="icrop-filename" title={fileName}>
            {fileName}
          </span>
        </header>
        {thumbs ? (
          <div className="pcrop-thumbs">
            {thumbs.map((src, i) => (
              <button
                key={i}
                type="button"
                className="pcrop-thumb"
                onClick={() => setSelectedPage(i + 1)}
                title={`Pagina ${i + 1}`}
              >
                <img src={src} alt={`Pagina ${i + 1}`} />
                <span className="pcrop-thumb-label">Pagina {i + 1}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pcrop-loading">PDF wordt ingelezen…</div>
        )}
        <footer className="icrop-footer">
          <div className="icrop-info">
            {thumbs
              ? `${thumbs.length} pagina${thumbs.length === 1 ? "" : "'s"}`
              : ""}
          </div>
          <div className="icrop-actions">
            <button type="button" className="icrop-btn" onClick={onCancel}>
              Annuleren
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
