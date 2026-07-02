import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { useCptStore } from "../../store/useCptStore";
import { getCurrentReportSections } from "../../store/reportSectionsState";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

const downloadIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="7 10 12 15 17 10"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="15" x2="12" y2="3"/></svg>`;
const openIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3h7v7"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14 21 3"/></svg>`;

// `onOpenProjectSettings` is no longer used here — the Projectinfo
// button has moved to the Home tab. Kept in the prop signature so the
// Ribbon wiring (which still forwards it) doesn't have to change.
interface RapportTabProps {
  onOpenProjectSettings?: () => void;
}

export default function RapportTab(_props: RapportTabProps) {
  const { t } = useTranslation("ribbon");
  const cptsMap = useCptStore((s) => s.cpts);
  const cpts = useMemo(() => Array.from(cptsMap.values()), [cptsMap]);
  const projectMeta = useCptStore((s) => s.projectMeta);
  const [busy, setBusy] = useState(false);

  async function generatePdf() {
    const dst = await save({
      defaultPath: `${projectMeta.title}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dst) return;
    setBusy(true);
    try {
      await invoke("generate_report", {
        cptIds: cpts.map((c) => c.id),
        project: projectMeta,
        outputPath: dst,
        // De actuele sectie-vinkjes uit de rapport-preview — zonder deze
        // parameter exporteerde de ribbon-knop altijd de standaardsecties
        // en negeerde hij stilletjes wat de gebruiker had aangevinkt.
        sections: getCurrentReportSections(),
      });
    } catch (e) {
      console.error("generate_report failed", e);
    } finally {
      setBusy(false);
    }
  }

  /** Genereer met de actuele vinkjes en open direct in de systeem-viewer
   *  (via temp-bestand — window.open werkt niet in de Tauri-webview). */
  async function openPdf() {
    setBusy(true);
    try {
      const bytes = await invoke<number[]>("preview_report", {
        cptIds: cpts.map((c) => c.id),
        project: projectMeta,
        sections: getCurrentReportSections(),
      });
      await invoke("open_report_pdf", { bytes });
    } catch (e) {
      console.error("open_report_pdf failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("output")}>
          <RibbonButton
            icon={downloadIcon}
            label={t("generatePdf")}
            size="large"
            onClick={() => void generatePdf()}
            disabled={cpts.length === 0 || busy}
          />
          <RibbonButton
            icon={openIcon}
            label={t("openPdf", "Open PDF")}
            size="large"
            onClick={() => void openPdf()}
            disabled={cpts.length === 0 || busy}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
