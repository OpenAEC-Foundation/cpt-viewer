import { useCallback, useEffect, useRef, useState } from "react";
import CropStage, { type CropStageHandle } from "./CropStage";
import "./ImageCropDialog.css";

/**
 * ImageCropDialog — modal crop step for the Sonderingstekening overlay
 * importer. The user picks a raster image (jpg/png/webp) via the
 * "Tekening" ribbon button or drag-drop; instead of dropping it onto
 * the paper straight away, the view first opens this dialog so the
 * user can trim white margins, scan borders, or just isolate the area
 * of the source they care about.
 *
 * Visual + interaction details live in `<CropStage>`. This component
 * owns just the dialog chrome (header, footer, buttons) plus the
 * keyboard shortcuts and the data-URL handoff to the caller.
 */

interface Props {
  imageSrc: string;
  fileName: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

export default function ImageCropDialog({
  imageSrc,
  fileName,
  onConfirm,
  onCancel,
}: Props) {
  const stageRef = useRef<CropStageHandle>(null);
  const [info, setInfo] = useState("…");

  const doConfirm = useCallback(() => {
    const dataUrl = stageRef.current?.commit();
    if (dataUrl) onConfirm(dataUrl);
  }, [onConfirm]);

  // Esc cancels, Enter confirms — match the platform-wide dialog norm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        doConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doConfirm, onCancel]);

  return (
    <div className="icrop-backdrop" onMouseDown={onCancel}>
      <div className="icrop-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="icrop-header">
          <span className="icrop-title">Afbeelding bijsnijden</span>
          <span className="icrop-filename" title={fileName}>
            {fileName}
          </span>
        </header>
        <CropStage
          ref={stageRef}
          imageSrc={imageSrc}
          onCropChange={(c) =>
            setInfo(`${c.cropWidthPx} × ${c.cropHeightPx} px`)
          }
        />
        <footer className="icrop-footer">
          <div className="icrop-info">{info}</div>
          <div className="icrop-actions">
            <button type="button" className="icrop-btn" onClick={onCancel}>
              Annuleren
            </button>
            <button
              type="button"
              className="icrop-btn icrop-btn-primary"
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
