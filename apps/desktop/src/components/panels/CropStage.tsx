import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/**
 * CropStage — the shared crop UI used by both ImageCropDialog
 * (raster overlay import) and PdfCropDialog (pdf-page overlay import).
 *
 * Renders the image inside a dimmed mask with a draggable / resizable
 * amber crop rectangle (8 handles + rule-of-thirds guides). The parent
 * owns the dialog chrome (header / footer / buttons) and calls
 * `.commit()` via the forwarded ref to obtain a PNG data URL of the
 * cropped region at the image's natural resolution.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Drag =
  | null
  | { kind: "move"; offsetX: number; offsetY: number }
  | { kind: "resize"; handle: Handle; orig: Rect };

export interface CropStageHandle {
  /** Crop the underlying image to a PNG data URL at natural resolution.
   *  Returns null if the image hasn't loaded yet. */
  commit(): string | null;
}

interface CropStageProps {
  imageSrc: string;
  /** Live notification of the current crop dimensions in source-image
   *  pixels — wire into a footer info string in the parent dialog. */
  onCropChange?: (info: { cropWidthPx: number; cropHeightPx: number }) => void;
}

const MIN_SIZE = 24;

const CropStage = forwardRef<CropStageHandle, CropStageProps>(function CropStage(
  { imageSrc, onCropChange },
  ref,
) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [display, setDisplay] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  // Drag state in a ref so mousemove doesn't trigger React renders.
  const dragRef = useRef<Drag>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Cache the decoded image so .commit() can `drawImage` synchronously
  // without waiting for a second load round-trip.
  const decodedRef = useRef<HTMLImageElement | null>(null);

  // ── Load image + initialise crop ─────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      decodedRef.current = img;
      const maxW = Math.min(window.innerWidth - 80, 1100);
      const maxH = Math.min(window.innerHeight - 260, 720);
      const s = Math.min(
        maxW / img.naturalWidth,
        maxH / img.naturalHeight,
        1, // never upscale
      );
      const dw = Math.round(img.naturalWidth * s);
      const dh = Math.round(img.naturalHeight * s);
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setDisplay({ w: dw, h: dh });
      const pad = 0.05;
      setCrop({
        x: Math.round(dw * pad),
        y: Math.round(dh * pad),
        w: Math.round(dw * (1 - 2 * pad)),
        h: Math.round(dh * (1 - 2 * pad)),
      });
    };
    img.src = imageSrc;
    return () => {
      decodedRef.current = null;
    };
  }, [imageSrc]);

  // ── Emit current crop dimensions ─────────────────────────────
  useEffect(() => {
    if (!natural || display.w === 0 || !onCropChange) return;
    onCropChange({
      cropWidthPx: Math.round((crop.w / display.w) * natural.w),
      cropHeightPx: Math.round((crop.h / display.h) * natural.h),
    });
  }, [natural, display, crop, onCropChange]);

  // ── Imperative .commit() — crop image to PNG data URL ────────
  useImperativeHandle(
    ref,
    () => ({
      commit() {
        const img = decodedRef.current;
        if (!img || !natural || display.w === 0) return null;
        // Map the display-space crop back onto the image's natural
        // resolution so the export isn't bounded by the dialog scale.
        const sx = (crop.x / display.w) * natural.w;
        const sy = (crop.y / display.h) * natural.h;
        const sw = (crop.w / display.w) * natural.w;
        const sh = (crop.h / display.h) * natural.h;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw));
        canvas.height = Math.max(1, Math.round(sh));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      },
    }),
    [natural, display, crop],
  );

  // ── Mouse handling ───────────────────────────────────────────
  const onStageMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drag.kind === "move") {
        setCrop((c) => {
          const nx = Math.max(0, Math.min(display.w - c.w, x - drag.offsetX));
          const ny = Math.max(0, Math.min(display.h - c.h, y - drag.offsetY));
          return { ...c, x: nx, y: ny };
        });
        return;
      }

      const { handle, orig } = drag;
      let nx = orig.x;
      let ny = orig.y;
      let nw = orig.w;
      let nh = orig.h;
      if (handle.includes("e")) {
        nw = Math.max(MIN_SIZE, Math.min(display.w - orig.x, x - orig.x));
      }
      if (handle.includes("w")) {
        const right = orig.x + orig.w;
        nx = Math.max(0, Math.min(right - MIN_SIZE, x));
        nw = right - nx;
      }
      if (handle.includes("s")) {
        nh = Math.max(MIN_SIZE, Math.min(display.h - orig.y, y - orig.y));
      }
      if (handle.includes("n")) {
        const bottom = orig.y + orig.h;
        ny = Math.max(0, Math.min(bottom - MIN_SIZE, y));
        nh = bottom - ny;
      }
      setCrop({ x: nx, y: ny, w: nw, h: nh });
    },
    [display.w, display.h],
  );

  const onStageMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onRectMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = {
      kind: "move",
      offsetX: x - crop.x,
      offsetY: y - crop.y,
    };
  };

  const onHandleMouseDown = (handle: Handle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: "resize", handle, orig: { ...crop } };
  };

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <div
      ref={stageRef}
      className="icrop-stage"
      style={{ width: display.w || "auto", height: display.h || "auto" }}
      onMouseMove={onStageMouseMove}
      onMouseUp={onStageMouseUp}
      onMouseLeave={onStageMouseUp}
    >
      <img
        className="icrop-img"
        src={imageSrc}
        alt=""
        draggable={false}
      />
      {/* Four dimmed strips outside the crop rectangle */}
      <div
        className="icrop-mask"
        style={{ left: 0, top: 0, width: display.w, height: crop.y }}
      />
      <div
        className="icrop-mask"
        style={{
          left: 0,
          top: crop.y + crop.h,
          width: display.w,
          height: Math.max(0, display.h - crop.y - crop.h),
        }}
      />
      <div
        className="icrop-mask"
        style={{ left: 0, top: crop.y, width: crop.x, height: crop.h }}
      />
      <div
        className="icrop-mask"
        style={{
          left: crop.x + crop.w,
          top: crop.y,
          width: Math.max(0, display.w - crop.x - crop.w),
          height: crop.h,
        }}
      />
      {/* The crop rectangle */}
      <div
        className="icrop-rect"
        style={{
          left: crop.x,
          top: crop.y,
          width: crop.w,
          height: crop.h,
        }}
        onMouseDown={onRectMouseDown}
      >
        <div className="icrop-grid icrop-grid-v" style={{ left: "33.33%" }} />
        <div className="icrop-grid icrop-grid-v" style={{ left: "66.66%" }} />
        <div className="icrop-grid icrop-grid-h" style={{ top: "33.33%" }} />
        <div className="icrop-grid icrop-grid-h" style={{ top: "66.66%" }} />
        {handles.map((h) => (
          <div
            key={h}
            className={`icrop-handle icrop-h-${h}`}
            onMouseDown={onHandleMouseDown(h)}
          />
        ))}
      </div>
    </div>
  );
});

export default CropStage;
