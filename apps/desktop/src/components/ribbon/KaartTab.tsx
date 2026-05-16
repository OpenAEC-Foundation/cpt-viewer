import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

const broIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="9 22 9 12 15 12 15 22"/></svg>`;

// Ruler icon — for the measurement-tool button.
const measureIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.3 8.7L8.7 21.3a1 1 0 01-1.4 0L2.7 16.7a1 1 0 010-1.4L15.3 2.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4z"/><line stroke-linecap="round" stroke-width="2" x1="6" y1="14" x2="8" y2="16"/><line stroke-linecap="round" stroke-width="2" x1="9" y1="11" x2="11" y2="13"/><line stroke-linecap="round" stroke-width="2" x1="12" y1="8" x2="14" y2="10"/><line stroke-linecap="round" stroke-width="2" x1="15" y1="5" x2="17" y2="7"/></svg>`;

export default function KaartTab() {
  const { t } = useTranslation("ribbon");
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("map", "Kaart")}>
          <RibbonButton
            icon={broIcon}
            label={t("loadArea", "Laad gebied")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:bro-load-area"))}
          />
          <RibbonButton
            icon={measureIcon}
            label={t("measure", "Meten")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:measure-toggle"))}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
