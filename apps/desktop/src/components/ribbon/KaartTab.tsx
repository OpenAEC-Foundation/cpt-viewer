import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

const mapPinIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3" stroke-width="2"/></svg>`;
const trashIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;

export default function KaartTab() {
  const { t } = useTranslation("ribbon");
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label="BRO Data">
          <RibbonButton
            icon={mapPinIcon}
            label={t("loadArea")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:bro-load-area"))}
          />
        </RibbonGroup>
        <RibbonGroup label={t("map")}>
          <RibbonButton
            icon={trashIcon}
            label={t("clearMarkers")}
            size="large"
            onClick={() => window.dispatchEvent(new CustomEvent("ogs:bro-clear"))}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
