import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

const zoomOutIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" stroke-width="2"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" y1="21" x2="16.65" y2="16.65"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" y1="11" x2="14" y2="11"/></svg>`;
const zoomFitIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>`;
const settingsIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82h0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;

interface StartTabProps {
  onViewChange?: (view: string) => void;
  /** Hook the Home-tab's Projectinfo-knop into App.tsx's existing
   *  ProjectSettingsDialog state — bypasses the Ribbon prop-drill via
   *  a window-event the App-shell already listens for. */
  onOpenProjectSettings?: () => void;
}

export default function StartTab(props: StartTabProps = {}) {
  const { t } = useTranslation("ribbon");
  const openProjectSettings =
    props.onOpenProjectSettings ??
    (() => window.dispatchEvent(new CustomEvent("ogs:open-project-settings")));
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("project", "Project")}>
          <RibbonButton
            icon={settingsIcon}
            label={t("projectInfo", "Projectinfo")}
            size="large"
            onClick={openProjectSettings}
          />
        </RibbonGroup>
        <RibbonGroup label={t("zoom")}>
          <RibbonButton
            icon={zoomOutIcon}
            label={t("zoomOut")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-out"))}
          />
          <RibbonButton
            icon={zoomFitIcon}
            label={t("zoomFit")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-fit"))}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
