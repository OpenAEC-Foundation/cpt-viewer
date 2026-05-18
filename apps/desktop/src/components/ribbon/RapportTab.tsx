import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { useCptStore } from "../../store/useCptStore";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

const downloadIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="7 10 12 15 17 10"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="15" x2="12" y2="3"/></svg>`;

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

  async function generatePdf() {
    const dst = await save({
      defaultPath: `${projectMeta.title}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dst) return;
    try {
      await invoke("generate_report", {
        cptIds: cpts.map((c) => c.id),
        project: projectMeta,
        outputPath: dst,
      });
    } catch (e) {
      console.error("generate_report failed", e);
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
            disabled={cpts.length === 0}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
