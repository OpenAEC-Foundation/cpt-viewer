import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

// Ruler icon — for the measurement-tool button.
const measureIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.3 8.7L8.7 21.3a1 1 0 01-1.4 0L2.7 16.7a1 1 0 010-1.4L15.3 2.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4z"/><line stroke-linecap="round" stroke-width="2" x1="6" y1="14" x2="8" y2="16"/><line stroke-linecap="round" stroke-width="2" x1="9" y1="11" x2="11" y2="13"/><line stroke-linecap="round" stroke-width="2" x1="12" y1="8" x2="14" y2="10"/><line stroke-linecap="round" stroke-width="2" x1="15" y1="5" x2="17" y2="7"/></svg>`;

/**
 * Kaart ribbon — minimal toolset. BRO archive reloads automatically when
 * the map view changes (moveend), so "Laad gebied" is gone. Only the
 * measurement tool remains because it's a modal interaction.
 */
export default function KaartTab() {
  const { t } = useTranslation("ribbon");
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("map", "Kaart")}>
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
