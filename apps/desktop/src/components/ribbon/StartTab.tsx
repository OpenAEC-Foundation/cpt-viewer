import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

const zoomOutIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" stroke-width="2"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" y1="21" x2="16.65" y2="16.65"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" y1="11" x2="14" y2="11"/></svg>`;
const zoomFitIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>`;

interface StartTabProps {
  onViewChange?: (view: string) => void;
}

export default function StartTab(_props: StartTabProps = {}) {
  const { t } = useTranslation("ribbon");
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
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
