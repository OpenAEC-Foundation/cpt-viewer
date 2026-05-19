import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Modal from "../Modal";
import { useCptStore } from "../../store/useCptStore";
import {
  getLatestTekening,
  tekeningStateToIfcgis,
  titleBlockToIfcgis,
  buildDeliverable,
  getAllLayerLive,
  getEnabledLayerIds,
} from "../../store/tekeningState";
import { catalogToIfcgisLayers } from "../../utils/gisLayerCatalog";
import "./IfcxPreviewDialog.css";

/**
 * IfcxPreviewDialog — live preview van de IFCX-shaped JSON die in
 * het .ifcgis-bestand komt te staan. Bouwt dezelfde payload als
 * `saveProject` in Backstage en geeft 'm aan de Rust-command
 * `preview_project_ifcx` die de IFC4x3-spec-conform conversie doet.
 *
 * Read-only preview — geen save-knop hier. De gebruiker kan kopiëren
 * voor inspectie of vergelijking. Komt uit `Bestand → Project
 * opslaan` automatisch in de uiteindelijke .ifcgis.
 */

export interface IfcxPreviewDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function IfcxPreviewDialog({ open, onClose }: IfcxPreviewDialogProps) {
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId),
    [documents, activeDocId],
  );

  const [ifcxText, setIfcxText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-genereer telkens als de dialog opent OF het actieve document
  // verandert (anders krijg je een stale preview).
  useEffect(() => {
    if (!open) return;
    if (!activeDoc) {
      setIfcxText("");
      setError("Geen actief document — open of maak een project om een IFCX-preview te zien.");
      return;
    }
    if (activeDoc.kind !== "project") {
      setIfcxText("");
      setError("De IFCX-preview werkt alleen voor project-documenten. Voor losse sonderingen of boringen gebruik de IFC-tab.");
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        // Identieke payload als Backstage.saveProject. Gehouden
        // inline (niet gedeeld als helper) zodat het zonder side-
        // effects in deze dialog past — een gedeelde helper zou
        // moeten weten of-ie save of preview produceert.
        const meta = activeDoc.meta;
        const projectInfo = {
          type: "OpenGeoProject",
          title: meta.title,
          client: meta.client,
          location: meta.location,
          project_number: meta.project_number,
          author: meta.author,
          date: meta.date.slice(0, 10),
        };
        const cpts = Array.from(activeDoc.cpts.values());
        const bores = Array.from(activeDoc.bores.values());
        const tekState = getLatestTekening();
        const tekening = tekState ? tekeningStateToIfcgis(tekState) : null;
        const titleBlock = tekState
          ? titleBlockToIfcgis(tekState.titleBlock)
          : null;
        const liveLayerOverrides = getAllLayerLive();
        const gis = {
          epsg: 28992,
          name: "Amersfoort / RD New",
          center: tekState
            ? {
                lat: tekState.center.lat,
                lon: tekState.center.lon,
                zoom: tekState.center.zoom,
              }
            : null,
          layers: catalogToIfcgisLayers(liveLayerOverrides),
        };
        const deliverable = tekState
          ? buildDeliverable({
              projectName: meta.title,
              projectNumber: meta.project_number,
              tek: tekState,
              activeLayerIds: getEnabledLayerIds(),
            })
          : null;
        const payload = {
          header: {
            schema: "ifcgis-0.3",
            originating_system: "Open Geotechniek Studio",
            timestamp: new Date().toISOString(),
          },
          project: projectInfo,
          cpts,
          bores,
          crs: { epsg: 28992, name: "Amersfoort / RD New" },
          gis,
          ...(tekening ? { tekening } : {}),
          ...(titleBlock ? { title_block: titleBlock } : {}),
          ...(deliverable ? { deliverable } : {}),
        };
        const text = await invoke<string>("preview_project_ifcx", { payload });
        setIfcxText(text);
      } catch (err) {
        console.error("preview_project_ifcx failed", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, activeDoc]);

  const onCopy = async () => {
    if (!ifcxText) return;
    try {
      await navigator.clipboard.writeText(ifcxText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="IFCX-preview — wat komt er in het .ifcgis bestand"
      width={900}
      height="78vh"
      className="ifcx-preview-modal"
      footer={
        <div className="ifcx-preview-footer">
          <span className="ifcx-preview-info">
            {ifcxText
              ? `${ifcxText.length.toLocaleString("nl-NL")} bytes IFCX (IFC4X3_ADD2)`
              : ""}
          </span>
          <button
            type="button"
            className="ifcx-preview-btn-secondary"
            onClick={onClose}
          >
            Sluiten
          </button>
          <button
            type="button"
            className="ifcx-preview-btn-primary"
            onClick={() => void onCopy()}
            disabled={!ifcxText}
          >
            {copied ? "Gekopieerd" : "Kopieer JSON"}
          </button>
        </div>
      }
    >
      <p className="ifcx-preview-hint">
        Dit is exact de inhoud die in het <code>.ifcgis</code> bestand
        komt te staan wanneer je het project opslaat — IFC5-alpha
        (IFCX) shaped JSON met IfcProject, IfcSite, IfcBorehole,
        IfcAnnotation entities en cross-references via <code>#id</code>.
      </p>
      {loading && (
        <div className="ifcx-preview-status">IFCX genereren…</div>
      )}
      {error && (
        <div className="ifcx-preview-error">
          <strong>Kon geen preview maken:</strong>
          <pre>{error}</pre>
          <p className="ifcx-preview-hint">
            Tip: voor de IFCX-conversie moet de Rust-side de
            <code>to_ifcx_json</code> functie hebben (ifcgis-0.4+).
            Herstart de Tauri-dev-app als je net een nieuwe cpt-core
            build hebt gemaakt.
          </p>
        </div>
      )}
      {ifcxText && !error && (
        <pre className="ifcx-preview-content">{ifcxText}</pre>
      )}
    </Modal>
  );
}
