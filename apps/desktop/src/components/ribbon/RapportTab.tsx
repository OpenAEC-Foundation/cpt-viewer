import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { useCptStore } from "../../store/useCptStore";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

const settingsIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82h0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
const downloadIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="7 10 12 15 17 10"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="15" x2="12" y2="3"/></svg>`;

interface RapportTabProps {
  onOpenProjectSettings: () => void;
}

export default function RapportTab({ onOpenProjectSettings }: RapportTabProps) {
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
        <RibbonGroup label={t("project")}>
          <RibbonButton
            icon={settingsIcon}
            label={t("projectInfo")}
            size="large"
            onClick={onOpenProjectSettings}
          />
        </RibbonGroup>
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
